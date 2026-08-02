#!/usr/bin/env python3
"""Serve the lab and bridge saved browser projects to native C++/Polyscope."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import subprocess
import threading
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

try:
    from .polyscope_viewer import normalize_document
except ImportError:
    from polyscope_viewer import normalize_document


MAX_BODY = 32 * 1024 * 1024
ALLOWED_CALLBACKS = {
    "cpp/include/HodgeFaceCallbacks.hh",
    "cpp/include/HodgeProjectionCallbacks.hh",
    "cpp/include/VertexFieldCallbacks.hh",
}


def local_capabilities(viewer_available: bool) -> dict:
    return {
        "mode": "connected",
        "actions": {
            "openPolyscope": viewer_available,
            "buildNativeVertexField": True,
        },
        "workspace": ".lab-workspace/current",
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path("dist"))
    parser.add_argument("--port", type=int, default=4174)
    parser.add_argument("--viewer", type=Path, help="Optional geometry-lab-viewer executable")
    parser.add_argument(
        "--native-experiment",
        type=Path,
        default=Path("build/native/geometry-lab-vertex-field"),
        help="Native experiment launched after a connected build",
    )
    return parser.parse_args()


def validate_snapshot(source: object) -> dict:
    normalize_document(source)
    if not isinstance(source, dict):
        raise ValueError("Expected a Geometry Processing Lab JSON object")
    return source


def validate_project(source: object) -> tuple[dict, dict[str, str]]:
    if not isinstance(source, dict):
        raise ValueError("Expected a project object")
    problem = source.get("problem")
    source_files = source.get("sourceFiles")
    if not isinstance(problem, dict) or not isinstance(source_files, dict):
        raise ValueError("Project requires problem and sourceFiles objects")
    if problem.get("schema") != "geometry-lab/problem@1":
        raise ValueError("Unsupported problem schema")
    if problem.get("kernel") != "vertex-field":
        raise ValueError("The connected native runner currently supports vertex-field")
    normalized: dict[str, str] = {}
    for path, contents in source_files.items():
        if path not in ALLOWED_CALLBACKS or not isinstance(contents, str):
            raise ValueError(f"Unsupported source file: {path!r}")
        normalized[path] = contents
    if "cpp/include/VertexFieldCallbacks.hh" not in normalized:
        raise ValueError("Project is missing VertexFieldCallbacks.hh")
    return problem, normalized


def native_arguments(problem: dict) -> list[str]:
    parameters = problem.get("parameters", {})
    objective = parameters.get("objective", {})
    solver = problem.get("solver", {})
    return [
        "--grid",
        str(parameters.get("gridSize", 12)),
        "--seed",
        str(parameters.get("seed", 17)),
        "--steps",
        str(solver.get("iterationsPerStep", 1)),
        "--data",
        str(objective.get("dataWeight", 1.0)),
        "--smoothness",
        str(objective.get("connectionSmoothnessWeight", 0.35)),
        "--integrability",
        str(objective.get("integrabilityWeight", 4.0)),
        "--length",
        str(objective.get("lengthWeight", 0.08)),
        "--target-length",
        str(objective.get("targetLength", 0.85)),
        "--noise",
        str(parameters.get("initializationNoise", 0.25)),
    ]


def atomic_write(path: Path, contents: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(contents, encoding="utf-8")
    os.replace(temporary, path)


def main() -> None:
    args = parse_args()
    root = args.root.resolve()
    if not root.is_dir():
        raise SystemExit(f"Static root does not exist: {root}. Run npm run build first.")
    bridge_directory = (Path.cwd() / ".lab-bridge").resolve()
    bridge_directory.mkdir(parents=True, exist_ok=True)
    snapshot_path = bridge_directory / "current.geometry-view.json"
    viewer_process: subprocess.Popen[bytes] | None = None
    native_process: subprocess.Popen[bytes] | None = None
    workspace = (Path.cwd() / ".lab-workspace" / "current").resolve()
    native_build_lock = threading.Lock()

    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *handler_args, **handler_kwargs):
            super().__init__(*handler_args, directory=str(root), **handler_kwargs)

        def do_GET(self) -> None:  # noqa: N802
            if self.path != "/api/local-capabilities":
                super().do_GET()
                return
            body = (json.dumps(local_capabilities(args.viewer is not None)) + "\n").encode()
            self.send_response(HTTPStatus.OK)
            self.send_header("content-type", "application/json")
            self.send_header("cache-control", "no-store")
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_POST(self) -> None:  # noqa: N802
            nonlocal viewer_process, native_process
            if self.path not in {"/api/polyscope", "/api/native-project"}:
                self.send_error(HTTPStatus.NOT_FOUND)
                return
            try:
                length = int(self.headers.get("content-length", "0"))
                if length <= 0 or length > MAX_BODY:
                    raise ValueError("Invalid request size")
                payload = json.loads(self.rfile.read(length))
                if self.path == "/api/polyscope":
                    source = validate_snapshot(payload)
                    atomic_write(snapshot_path, json.dumps(source, indent=2) + "\n")
                    if args.viewer and (
                        viewer_process is None or viewer_process.poll() is not None
                    ):
                        viewer_process = subprocess.Popen(
                            [str(args.viewer.resolve()), str(snapshot_path)]
                        )
                    response = {"ok": True}
                else:
                    problem, source_files = validate_project(payload)
                    if not native_build_lock.acquire(blocking=False):
                        self.send_error(HTTPStatus.CONFLICT, "A native build is already running")
                        return
                    try:
                        atomic_write(
                            workspace / "experiments" / "problem.json",
                            json.dumps(problem, indent=2) + "\n",
                        )
                        for relative_path, contents in source_files.items():
                            atomic_write(workspace / relative_path, contents)
                        callback_directory = workspace / "cpp" / "include"
                        configure = subprocess.run(
                            [
                                "cmake",
                                "--preset",
                                "native",
                                f"-DGEOMETRY_LAB_CALLBACK_DIR={callback_directory}",
                            ],
                            cwd=Path.cwd(),
                            capture_output=True,
                            text=True,
                            timeout=180,
                        )
                        if configure.returncode:
                            raise RuntimeError(configure.stdout + configure.stderr)
                        build = subprocess.run(
                            [
                                "cmake",
                                "--build",
                                "--preset",
                                "native",
                                "--target",
                                "geometry-lab-vertex-field",
                            ],
                            cwd=Path.cwd(),
                            capture_output=True,
                            text=True,
                            timeout=300,
                        )
                        if build.returncode:
                            raise RuntimeError(build.stdout + build.stderr)
                        executable = args.native_experiment.resolve()
                        if not executable.is_file():
                            raise RuntimeError(f"Native experiment was not built: {executable}")
                        if native_process is not None and native_process.poll() is None:
                            native_process.terminate()
                        native_process = subprocess.Popen(
                            [str(executable), *native_arguments(problem)],
                            cwd=Path.cwd(),
                        )
                    finally:
                        native_build_lock.release()
                    response = {
                        "ok": True,
                        "workspace": str(workspace),
                        "build": build.stdout[-4000:],
                    }
                body = (json.dumps(response) + "\n").encode()
                self.send_response(HTTPStatus.ACCEPTED)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            except (ValueError, json.JSONDecodeError) as error:
                self.send_error(HTTPStatus.BAD_REQUEST, str(error))
            except (RuntimeError, subprocess.TimeoutExpired) as error:
                self.send_error(HTTPStatus.INTERNAL_SERVER_ERROR, str(error))

    address = ("127.0.0.1", args.port)
    print(f"Geometry Processing Lab: http://{address[0]}:{address[1]}")
    print(f"Snapshot bridge: {snapshot_path}")
    print(f"Editable native project: {workspace}")
    server = ThreadingHTTPServer(address, Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nGeometry Processing Lab bridge stopped.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
