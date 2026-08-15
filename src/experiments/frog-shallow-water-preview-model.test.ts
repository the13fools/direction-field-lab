import { describe, expect, it } from "vitest";

import frogSource from "../assets/treefrog.obj?raw";
import {
  parseFrogTriangleMesh,
  type FrogEigenbasis,
  type FrogTriangleMesh,
} from "./frog-surface-fluid-model";
import { FrogShallowWaterPreviewModel } from "./frog-shallow-water-preview-model";

function makeTestEigenbasis(mesh: FrogTriangleMesh): FrogEigenbasis {
  const vertexCount = mesh.positions.length / 3;
  const modeCount = 36;
  const eigenvalues = Float64Array.from({ length: modeCount }, (_, mode) => (mode + 1) * (mode + 2));
  const modes = new Float32Array(vertexCount * modeCount);
  for (let mode = 0; mode < modeCount; mode += 1) {
    for (let vertex = 0; vertex < vertexCount; vertex += 1) {
      const offset = 3 * vertex;
      modes[mode * vertexCount + vertex] = Math.sin((mode + 1) * (
        0.41 * mesh.positions[offset]!
        + 0.67 * mesh.positions[offset + 1]!
        - 0.29 * mesh.positions[offset + 2]!
      ));
    }
  }
  return { vertexCount, modeCount, eigenvalues, modes };
}

describe("frog shallow-water story preview", () => {
  it("keeps its standing-wave mass centered and velocity tangent", () => {
    const mesh = parseFrogTriangleMesh(frogSource);
    const basis = makeTestEigenbasis(mesh);
    const model = new FrogShallowWaterPreviewModel(mesh, basis, 12);
    expect(model.waveModeIndices).toEqual([18, 31]);
    model.step(0.08);
    expect(Math.abs(model.massDrift())).toBeLessThan(1e-8);
    expect(model.ambientRechartDefect()).toBeLessThan(1e-12);
    expect(Math.min(...model.stateAt().height)).toBeGreaterThan(0.75);
  });

  it("walks material probes across triangles without leaving barycentric coordinates", () => {
    const mesh = parseFrogTriangleMesh(frogSource);
    const basis = makeTestEigenbasis(mesh);
    const model = new FrogShallowWaterPreviewModel(mesh, basis, 18);
    for (let step = 0; step < 20; step += 1) model.step(0.012);
    for (const particle of model.particles) {
      expect(particle.face).toBeGreaterThanOrEqual(0);
      expect(particle.face).toBeLessThan(mesh.faces.length / 3);
      expect(Math.min(...particle.barycentric)).toBeGreaterThan(-1e-7);
      expect(particle.barycentric.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 8);
    }
  });
});
