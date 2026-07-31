#!/usr/bin/env python3
"""Serve the built lab and expose a small local-only Polyscope snapshot bridge."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import subprocess
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

from polyscope_viewer import normalize_document


MAX_BODY = 32 * 1024 * 1024


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path("dist"))
    parser.add_argument("--port", type=int, default=4174)
    parser.add_argument("--viewer", type=Path, help="Optional geometry-lab-viewer executable")
    return parser.parse_args()


def validate_snapshot(source: object) -> dict:
    normalize_document(source)
    if not isinstance(source, dict):
        raise ValueError("Expected a Geometry Processing Lab JSON object")
    return source


def main() -> None:
    args = parse_args()
    root = args.root.resolve()
    if not root.is_dir():
        raise SystemExit(f"Static root does not exist: {root}. Run npm run build first.")
    bridge_directory = (Path.cwd() / ".lab-bridge").resolve()
    bridge_directory.mkdir(parents=True, exist_ok=True)
    snapshot_path = bridge_directory / "current.geometry-view.json"
    viewer_process: subprocess.Popen[bytes] | None = None

    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *handler_args, **handler_kwargs):
            super().__init__(*handler_args, directory=str(root), **handler_kwargs)

        def do_POST(self) -> None:  # noqa: N802
            nonlocal viewer_process
            if self.path != "/api/polyscope":
                self.send_error(HTTPStatus.NOT_FOUND)
                return
            try:
                length = int(self.headers.get("content-length", "0"))
                if length <= 0 or length > MAX_BODY:
                    raise ValueError("Invalid request size")
                source = validate_snapshot(json.loads(self.rfile.read(length)))
                temporary = snapshot_path.with_suffix(".tmp")
                temporary.write_text(json.dumps(source, indent=2) + "\n", encoding="utf-8")
                os.replace(temporary, snapshot_path)
                if args.viewer and (viewer_process is None or viewer_process.poll() is not None):
                    viewer_process = subprocess.Popen([str(args.viewer.resolve()), str(snapshot_path)])
                body = b'{"ok":true}\n'
                self.send_response(HTTPStatus.ACCEPTED)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            except (ValueError, json.JSONDecodeError) as error:
                self.send_error(HTTPStatus.BAD_REQUEST, str(error))

    address = ("127.0.0.1", args.port)
    print(f"Geometry Processing Lab: http://{address[0]}:{address[1]}")
    print(f"Snapshot bridge: {snapshot_path}")
    server = ThreadingHTTPServer(address, Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nGeometry Processing Lab bridge stopped.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
