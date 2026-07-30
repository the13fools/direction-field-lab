import { describe, expect, it } from "vitest";

import {
  periodicGridFaces,
  torusPositions,
  vertexFieldFromOneForm,
  whitneyFaceField,
} from "./hodge-visualization";

describe("Hodge field visualization", () => {
  it("builds a closed periodic triangulation", () => {
    expect(torusPositions(7)).toHaveLength(7 * 7 * 3);
    expect(periodicGridFaces(7)).toHaveLength(7 * 7 * 2 * 3);
  });

  it("Whitney-interpolates signed edge integrals into a face vector", () => {
    const positions = new Float32Array([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
    ]);
    const edges = new Int32Array([0, 1, 1, 2, 2, 0]);
    const faces = new Int32Array([0, 1, 2]);
    // Integrals of the constant field (1, 0) along the three oriented edges.
    const samples = whitneyFaceField(positions, edges, faces, new Float64Array([1, -1, 0]));

    expect(samples).toHaveLength(1);
    expect(samples[0]!.center).toEqual([1 / 3, 1 / 3, 0]);
    expect(samples[0]!.vector[0]).toBeCloseTo(1, 12);
    expect(samples[0]!.vector[1]).toBeCloseTo(0, 12);
    expect(samples[0]!.vector[2]).toBeCloseTo(0, 12);
  });

  it("reconstructs a tangent field at vertices", () => {
    const positions = new Float32Array([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
    ]);
    const samples = vertexFieldFromOneForm(
      positions,
      new Int32Array([0, 1, 1, 2, 2, 0]),
      new Int32Array([0, 1, 2]),
      new Float64Array([1, -1, 0]),
    );

    expect(samples).toHaveLength(3);
    for (const sample of samples) {
      expect(sample.vector[0]).toBeCloseTo(1, 12);
      expect(sample.vector[1]).toBeCloseTo(0, 12);
      expect(sample.vector[2]).toBeCloseTo(0, 12);
      expect(sample.normal).toEqual([0, 0, 1]);
    }
  });
});
