"""Precompute intrinsic cotangent Laplace--Beltrami modes for treefrog.obj."""

from __future__ import annotations

import argparse
import struct
from pathlib import Path

import numpy as np
from scipy.sparse import coo_matrix, diags
from scipy.sparse.linalg import eigsh


def load_obj(path: Path) -> tuple[np.ndarray, np.ndarray]:
    vertices: list[list[float]] = []
    faces: list[list[int]] = []
    for line in path.read_text(encoding="utf8").splitlines():
        if line.startswith("v "):
            vertices.append([float(value) for value in line.split()[1:4]])
        elif line.startswith("f "):
            face = [int(value.split("/")[0]) - 1 for value in line.split()[1:]]
            if len(face) != 3:
                raise ValueError("treefrog.obj must be triangulated")
            faces.append(face)
    positions = np.asarray(vertices, dtype=np.float64)
    triangles = np.asarray(faces, dtype=np.int32)
    center = 0.5 * (positions.min(axis=0) + positions.max(axis=0))
    scale = 2.65 / np.ptp(positions, axis=0).max()
    return (positions - center) * scale, triangles


def cotangent_system(positions: np.ndarray, faces: np.ndarray):
    vertex_count = len(positions)
    rows: list[int] = []
    columns: list[int] = []
    values: list[float] = []
    diagonal = np.zeros(vertex_count, dtype=np.float64)
    mass = np.zeros(vertex_count, dtype=np.float64)

    for face in faces:
        a, b, c = positions[face]
        twice_area = np.linalg.norm(np.cross(b - a, c - a))
        area = 0.5 * twice_area
        mass[face] += area / 3.0
        cotangents = (
            np.dot(b - a, c - a) / twice_area,
            np.dot(a - b, c - b) / twice_area,
            np.dot(a - c, b - c) / twice_area,
        )
        opposite_edges = ((face[1], face[2]), (face[0], face[2]), (face[0], face[1]))
        for (left, right), cotangent in zip(opposite_edges, cotangents, strict=True):
            weight = 0.5 * cotangent
            rows.extend((left, right))
            columns.extend((right, left))
            values.extend((-weight, -weight))
            diagonal[left] += weight
            diagonal[right] += weight

    indices = np.arange(vertex_count)
    rows.extend(indices.tolist())
    columns.extend(indices.tolist())
    values.extend(diagonal.tolist())
    stiffness = coo_matrix((values, (rows, columns)), shape=(vertex_count, vertex_count)).tocsr()
    return stiffness, diags(mass), mass


def write_basis(
    path: Path,
    eigenvalues: np.ndarray,
    eigenvectors: np.ndarray,
) -> np.ndarray:
    modes = eigenvectors.T.astype("<f4")
    with path.open("wb") as output:
        output.write(b"LBE2")
        output.write(struct.pack("<III", 2, modes.shape[1], modes.shape[0]))
        output.write(np.asarray(eigenvalues, dtype="<f8").tobytes())
        output.write(modes.tobytes())
    return modes.astype(np.float64)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--modes", type=int, default=80)
    args = parser.parse_args()

    positions, faces = load_obj(args.input)
    stiffness, mass_matrix, mass = cotangent_system(positions, faces)
    # Include the constant mode, then discard it.
    eigenvalues, eigenvectors = eigsh(
        stiffness,
        k=args.modes + 1,
        M=mass_matrix,
        sigma=1e-9,
        which="LM",
        tol=1e-9,
    )
    order = np.argsort(eigenvalues)
    eigenvalues = eigenvalues[order][1 : args.modes + 1]
    eigenvectors = eigenvectors[:, order][:, 1 : args.modes + 1]
    for mode in range(eigenvectors.shape[1]):
        vector = eigenvectors[:, mode]
        norm = np.sqrt(np.sum(mass * vector * vector))
        vector /= max(norm, 1e-30)
        pivot = np.argmax(np.abs(vector))
        if vector[pivot] < 0:
            vector *= -1

    args.output.parent.mkdir(parents=True, exist_ok=True)
    stored_modes = write_basis(args.output, eigenvalues, eigenvectors)
    residuals = []
    for mode, eigenvalue in enumerate(eigenvalues):
        vector = eigenvectors[:, mode]
        residual = stiffness @ vector - eigenvalue * (mass * vector)
        residuals.append(np.linalg.norm(residual) / max(1e-30, np.linalg.norm(eigenvalue * mass * vector)))
    stored_residuals = []
    for mode, eigenvalue in enumerate(eigenvalues):
        vector = stored_modes[mode]
        residual = stiffness @ vector - eigenvalue * (mass * vector)
        stored_residuals.append(
            np.linalg.norm(residual) / max(1e-30, np.linalg.norm(eigenvalue * mass * vector))
        )
    print(
        f"wrote {len(eigenvalues)} modes for {len(positions)} vertices; "
        f"lambda=[{eigenvalues[0]:.6g}, {eigenvalues[-1]:.6g}], "
        f"solve residual={max(residuals):.3e}, stored float32 residual={max(stored_residuals):.3e}"
    )


if __name__ == "__main__":
    main()
