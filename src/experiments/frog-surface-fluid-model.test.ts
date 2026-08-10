import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { FrogSurfaceFluidModel, parseFrogTriangleMesh } from "./frog-surface-fluid-model";

const frogSource = readFileSync(new URL("../assets/treefrog.obj", import.meta.url), "utf8");

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
    const model = new FrogSurfaceFluidModel(mesh, {
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
