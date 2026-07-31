#!/usr/bin/env python3
"""View Geometry Processing Lab snapshots in Polyscope.

The parser is dependency-free. NumPy and Polyscope are imported only after the
document has been validated, so format tests do not need a graphics stack.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


VIEW_SCHEMA = "geometry-lab/view@1"
RESULT_SCHEMA = "geometry-lab/result@2"


def _flat_numbers(value: Any, width: int, label: str) -> list[list[float]]:
    if (
        not isinstance(value, list)
        or not value
        or len(value) % width
        or any(not isinstance(entry, (int, float)) for entry in value)
    ):
        raise ValueError(f"{label} must be a non-empty flat numeric array with width {width}")
    return [value[index : index + width] for index in range(0, len(value), width)]


def _flat_indices(value: Any, width: int, vertex_count: int, label: str) -> list[list[int]]:
    rows = _flat_numbers(value, width, label)
    if any(
        not float(index).is_integer() or index < 0 or index >= vertex_count
        for row in rows
        for index in row
    ):
        raise ValueError(f"{label} contains an index outside its mesh")
    return [[int(index) for index in row] for row in rows]


def _view_document(source: dict[str, Any]) -> dict[str, Any]:
    if source.get("primitive") != "curve-network":
        raise ValueError("geometry-lab/view@1 currently supports only curve-network")
    positions = _flat_numbers(source.get("positions"), 3, "positions")
    edges = _flat_indices(source.get("edges"), 2, len(positions), "edges")
    return {
        "schema": VIEW_SCHEMA,
        "meshes": [
            {
                "id": "result",
                "name": source.get("name", "Geometry Lab result"),
                "positions": positions,
                "faces": [],
                "edges": edges,
            }
        ],
        "fields": [],
        "messages": [],
    }


def _result_document(source: dict[str, Any]) -> dict[str, Any]:
    meshes: list[dict[str, Any]] = []
    mesh_sizes: dict[str, dict[str, int]] = {}
    for index, mesh in enumerate(source.get("meshes", [])):
        if not isinstance(mesh, dict) or not isinstance(mesh.get("id"), str):
            raise ValueError(f"meshes[{index}] needs a string id")
        positions = _flat_numbers(mesh.get("positions"), 3, f"meshes[{index}].positions")
        faces = (
            _flat_indices(mesh["faces"], 3, len(positions), f"meshes[{index}].faces")
            if mesh.get("faces")
            else []
        )
        edges = (
            _flat_indices(mesh["edges"], 2, len(positions), f"meshes[{index}].edges")
            if mesh.get("edges")
            else []
        )
        if not faces and not edges:
            raise ValueError(f"meshes[{index}] needs faces or edges")
        meshes.append(
            {
                "id": mesh["id"],
                "name": mesh.get("name", mesh["id"]),
                "positions": positions,
                "faces": faces,
                "edges": edges,
            }
        )
        mesh_sizes[mesh["id"]] = {
            "vertex": len(positions),
            "dual-cell": len(positions),
            "face": len(faces),
            "edge": len(edges),
        }

    fields: list[dict[str, Any]] = []
    for index, field in enumerate(source.get("fields", [])):
        if not isinstance(field, dict):
            raise ValueError(f"fields[{index}] must be an object")
        mesh_id = field.get("meshId")
        association = field.get("association")
        components = field.get("components")
        if mesh_id not in mesh_sizes:
            raise ValueError(f"fields[{index}] refers to unknown mesh {mesh_id}")
        if association not in {"vertex", "dual-cell", "face", "edge"}:
            raise ValueError(f"fields[{index}] has an unknown association")
        if not isinstance(components, int) or components < 1 or components > 4:
            raise ValueError(f"fields[{index}].components must be an integer from 1 to 4")
        values = _flat_numbers(field.get("values"), components, f"fields[{index}].values")
        if len(values) != mesh_sizes[mesh_id][association]:
            raise ValueError(f"fields[{index}].values does not match its association")
        normalized = {**field, "values": values}
        if field.get("frame") == "local-tangent":
            normalized["basisX"] = _flat_numbers(
                field.get("basisX"), 3, f"fields[{index}].basisX"
            )
            normalized["basisY"] = _flat_numbers(
                field.get("basisY"), 3, f"fields[{index}].basisY"
            )
            if (
                len(normalized["basisX"]) != len(values)
                or len(normalized["basisY"]) != len(values)
            ):
                raise ValueError(f"fields[{index}] tangent bases do not match its association")
        if field.get("frame") == "oriented-edge":
            orientations = field.get("orientations")
            if (
                association != "edge"
                or not isinstance(orientations, list)
                or len(orientations) != len(values)
                or any(value not in (0, 1, False, True) for value in orientations)
            ):
                raise ValueError(f"fields[{index}] needs one orientation per edge")
            normalized["orientations"] = [bool(value) for value in orientations]
        fields.append(normalized)

    return {
        "schema": RESULT_SCHEMA,
        "meshes": meshes,
        "fields": fields,
        "messages": source.get("messages", []),
    }


def normalize_document(source: Any) -> dict[str, Any]:
    if not isinstance(source, dict):
        raise ValueError("The snapshot must be a JSON object")
    if source.get("schema") == VIEW_SCHEMA:
        return _view_document(source)
    if source.get("schema") == RESULT_SCHEMA:
        return _result_document(source)
    raise ValueError(f"Unsupported snapshot schema {source.get('schema')!r}")


def load_document(path: Path) -> dict[str, Any]:
    return normalize_document(json.loads(path.read_text(encoding="utf-8")))


def _ambient_vectors(values: Any, components: int, numpy: Any) -> Any:
    vectors = numpy.asarray(values, dtype=float)
    if components == 3:
        return vectors
    if components == 2:
        return numpy.column_stack([vectors, numpy.zeros(len(vectors))])
    raise ValueError("Ambient vectors must have two or three components")


def register_document(document: dict[str, Any], ps: Any, numpy: Any) -> None:
    ps.remove_all_structures()
    structures: dict[str, dict[str, Any]] = {}
    for mesh in document["meshes"]:
        positions = numpy.asarray(mesh["positions"], dtype=float)
        surface = None
        network = None
        if mesh["faces"]:
            surface = ps.register_surface_mesh(
                mesh["name"],
                positions,
                numpy.asarray(mesh["faces"], dtype=int),
                smooth_shade=True,
                edge_width=1,
            )
        if mesh["edges"]:
            network_name = mesh["name"] if surface is None else f"{mesh['name']} · edges"
            network = ps.register_curve_network(
                network_name,
                positions,
                numpy.asarray(mesh["edges"], dtype=int),
            )
        structures[mesh["id"]] = {"surface": surface, "network": network}

    for field in document["fields"]:
        targets = structures[field["meshId"]]
        association = field["association"]
        values = numpy.asarray(field["values"], dtype=float)
        name = field.get("label", field.get("id", "field"))
        surface = targets["surface"]
        network = targets["network"]

        if field.get("frame") == "oriented-edge":
            if surface is None:
                raise ValueError(f"{name} is a one-form but its mesh has no faces")
            surface.add_one_form_vector_quantity(
                name,
                values[:, 0],
                numpy.asarray(field["orientations"], dtype=bool),
                enabled=True,
            )
        elif field.get("frame") == "local-tangent":
            if surface is None:
                raise ValueError(f"{name} is tangent data but its mesh has no faces")
            surface.add_tangent_vector_quantity(
                name,
                values,
                numpy.asarray(field["basisX"], dtype=float),
                numpy.asarray(field["basisY"], dtype=float),
                defined_on="vertices" if association in {"vertex", "dual-cell"} else "faces",
                enabled=True,
            )
        elif field.get("valueType") == "scalar":
            if association == "edge" and network is not None:
                network.add_scalar_quantity(name, values[:, 0], defined_on="edges", enabled=True)
            elif surface is not None:
                surface.add_scalar_quantity(
                    name,
                    values[:, 0],
                    defined_on="vertices" if association in {"vertex", "dual-cell"} else "faces",
                    enabled=True,
                )
        elif field.get("valueType") == "vector":
            vectors = _ambient_vectors(values, field["components"], numpy)
            if association == "edge" and network is not None:
                network.add_vector_quantity(name, vectors, defined_on="edges", enabled=True)
            elif surface is not None:
                surface.add_vector_quantity(
                    name,
                    vectors,
                    defined_on="vertices" if association in {"vertex", "dual-cell"} else "faces",
                    vectortype="ambient",
                    enabled=True,
                )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Open geometry-lab/view@1 or geometry-lab/result@2 in Polyscope."
    )
    parser.add_argument("snapshot", type=Path)
    parser.add_argument(
        "--no-watch",
        action="store_true",
        help="Open once instead of reloading when another process replaces the snapshot.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    try:
        import numpy
        import polyscope as ps
    except ImportError as error:
        raise SystemExit(
            "Install the optional viewer with: "
            "python3 -m pip install -r requirements-polyscope.txt"
        ) from error

    snapshot = args.snapshot.resolve()
    last_write_ns = -1

    def reload_if_changed() -> None:
        nonlocal last_write_ns
        try:
            write_ns = snapshot.stat().st_mtime_ns
            if write_ns == last_write_ns:
                return
            register_document(load_document(snapshot), ps, numpy)
            last_write_ns = write_ns
            print(f"Loaded {snapshot}")
        except (OSError, ValueError, json.JSONDecodeError) as error:
            print(f"Snapshot reload failed: {error}")

    ps.set_program_name("Geometry Processing Lab · Python")
    ps.set_open_imgui_window_for_user_callback(False)
    ps.init()
    reload_if_changed()
    if not args.no_watch:
        ps.set_user_callback(reload_if_changed)
    ps.show()


if __name__ == "__main__":
    main()
