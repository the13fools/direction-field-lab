import { describe, expect, it } from "vitest";

import {
  periodicGridFaces,
  periodicVertexFieldFromOneForm,
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

  it("reconstructs a constant periodic 1-form before lifting it to the torus", () => {
    const gridSize = 5;
    const faces = periodicGridFaces(gridSize);
    const edgeRecords = new Map<string, [number, number]>();
    const key = (a: number, b: number) => a < b ? `${a}:${b}` : `${b}:${a}`;
    for (let face = 0; face < faces.length / 3; face += 1) {
      const vertices = [faces[3 * face]!, faces[3 * face + 1]!, faces[3 * face + 2]!];
      for (let corner = 0; corner < 3; corner += 1) {
        const tail = vertices[corner]!;
        const head = vertices[(corner + 1) % 3]!;
        if (!edgeRecords.has(key(tail, head))) edgeRecords.set(key(tail, head), [tail, head]);
      }
    }
    const edges = Int32Array.from([...edgeRecords.values()].flat());
    const values = new Float64Array(edgeRecords.size);
    let edge = 0;
    for (const [tail, head] of edgeRecords.values()) {
      const tailX = tail % gridSize;
      const headX = head % gridSize;
      let dx = headX - tailX;
      if (dx > gridSize / 2) dx -= gridSize;
      if (dx < -gridSize / 2) dx += gridSize;
      values[edge] = dx;
      edge += 1;
    }

    const reconstructed = periodicVertexFieldFromOneForm(gridSize, edges, values);
    expect(reconstructed).toHaveLength(gridSize * gridSize * 2);
    for (let vertex = 0; vertex < gridSize * gridSize; vertex += 1) {
      expect(reconstructed[2 * vertex]).toBeCloseTo(1, 12);
      expect(reconstructed[2 * vertex + 1]).toBeCloseTo(0, 12);
    }
  });
});
