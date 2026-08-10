import { describe, expect, it } from "vitest";
import frogSource from "../assets/treefrog.obj?raw";

import {
  FrogSurfaceFluidModel,
  parseFrogTriangleMesh,
  type FrogEigenbasis,
  type FrogTriangleMesh,
} from "./frog-surface-fluid-model";

function makeTestEigenbasis(mesh: FrogTriangleMesh, modeCount: number): FrogEigenbasis {
  const vertexCount = mesh.positions.length / 3;
  const eigenvalues = new Float64Array(modeCount);
  const modes = new Float32Array(modeCount * vertexCount);
  for (let mode = 0; mode < modeCount; mode += 1) {
    eigenvalues[mode] = (mode + 1) * (mode + 2);
    let maximum = 0;
    const values = new Float64Array(vertexCount);
    for (let vertex = 0; vertex < vertexCount; vertex += 1) {
      const offset = 3 * vertex;
      values[vertex] = Math.sin((mode + 1) * (
        0.41 * mesh.positions[offset]!
        + 0.67 * mesh.positions[offset + 1]!
        - 0.29 * mesh.positions[offset + 2]!
      ));
      maximum = Math.max(maximum, Math.abs(values[vertex]!));
    }
    for (let vertex = 0; vertex < vertexCount; vertex += 1) {
      modes[mode * vertexCount + vertex] = values[vertex]! / Math.max(1e-14, maximum);
    }
  }
  return { vertexCount, modeCount, eigenvalues, modes };
}

describe("tree-frog surface fluid", () => {
  it("parses the closed triangle surface and builds face adjacency", () => {
    const mesh = parseFrogTriangleMesh(frogSource);
    expect(mesh.positions.length / 3).toBe(9665);
    expect(mesh.faces.length / 3).toBe(19326);
    expect([...mesh.faceNeighbors].every((neighbor) => neighbor >= 0)).toBe(true);
    expect([...mesh.vertexAreas].every((area) => Number.isFinite(area) && area > 0)).toBe(true);
  });

  it("projects a finite tangent Clebsch field and keeps particles on the mesh", () => {
    const mesh = parseFrogTriangleMesh(frogSource);
    const model = new FrogSurfaceFluidModel(mesh, makeTestEigenbasis(mesh, 8), {
      projection: "clebsch-projected",
      modeCount: 8,
      maxBand: 4,
      particleCount: 24,
    });
    const samples = model.fieldSamples();
    expect(samples.length).toBeGreaterThan(150);
    for (const sample of samples.slice(0, 40)) {
      expect(Object.values(sample.velocity).every(Number.isFinite)).toBe(true);
      const normalVelocity = sample.velocity.x * sample.normal.x
        + sample.velocity.y * sample.normal.y
        + sample.velocity.z * sample.normal.z;
      expect(normalVelocity).toBeCloseTo(0, 8);
    }
    model.step(2);
    for (const particle of model.particles) {
      expect(Object.values(model.particlePosition(particle)).every(Number.isFinite)).toBe(true);
    }
  });
});
