import { describe, expect, it } from "vitest";
import frogSource from "../assets/treefrog.obj?raw";

import {
  parseFrogTriangleMesh,
  type FrogEigenbasis,
  type FrogTriangleMesh,
} from "./frog-surface-fluid-model";
import {
  ControlledClebschSurfaceModel,
  evaluateTaylorGreenClebsch,
} from "./clebsch-surface-model";
import type { Vec3 } from "./random-surface-fluid-model";

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function makeTestEigenbasis(mesh: FrogTriangleMesh, modeCount = 7): FrogEigenbasis {
  const vertexCount = mesh.positions.length / 3;
  const eigenvalues = new Float64Array(modeCount);
  const modes = new Float32Array(modeCount * vertexCount);
  for (let mode = 0; mode < modeCount; mode += 1) {
    eigenvalues[mode] = (mode + 1) * (mode + 2);
    let maximum = 0;
    for (let vertex = 0; vertex < vertexCount; vertex += 1) {
      const offset = 3 * vertex;
      const value = Math.sin((mode + 1) * (
        0.37 * mesh.positions[offset]!
        - 0.51 * mesh.positions[offset + 1]!
        + 0.73 * mesh.positions[offset + 2]!
      ));
      modes[mode * vertexCount + vertex] = value;
      maximum = Math.max(maximum, Math.abs(value));
    }
    for (let vertex = 0; vertex < vertexCount; vertex += 1) {
      const index = mode * vertexCount + vertex;
      modes[index] = modes[index]! / Math.max(maximum, 1e-14);
    }
  }
  return { vertexCount, modeCount, eigenvalues, modes };
}

describe("controlled Clebsch fields on surfaces", () => {
  it("turns vorticity off when the two label differentials are parallel", () => {
    const model = new ControlledClebschSurfaceModel({ crossing: 0 });
    const sample = model.sampleParameter("plane", 0.41, 1.13);
    expect(sample.vorticity).toBeCloseTo(0, 12);
  });

  it("creates vorticity when the two label foliations cross", () => {
    const model = new ControlledClebschSurfaceModel({ crossing: 1 });
    const sample = model.sampleParameter("plane", 0.41, 1.13);
    expect(Math.abs(sample.vorticity)).toBeGreaterThan(0.1);
  });

  it("keeps every metric-dual differential tangent to the sphere", () => {
    const model = new ControlledClebschSurfaceModel();
    const sample = model.sampleSphere({ x: 0.42, y: -0.31, z: 0.85 });
    for (const vector of [sample.dAlpha, sample.dBeta, sample.dPhi, sample.alphaDBeta, sample.velocity, sample.projectedVelocity]) {
      expect(dot(vector, sample.normal)).toBeCloseTo(0, 12);
    }
  });

  it("lets the exact potential change velocity without changing vorticity", () => {
    const model = new ControlledClebschSurfaceModel({ potentialStrength: 0.1 });
    const first = model.sampleSphere({ x: 0.42, y: -0.31, z: 0.85 });
    model.reset({ potentialStrength: 0.9 });
    const second = model.sampleSphere({ x: 0.42, y: -0.31, z: 0.85 });
    expect(second.vorticity).toBeCloseTo(first.vorticity, 12);
    expect(second.velocity).not.toEqual(first.velocity);
    expect(second.projectedVelocity).toEqual(first.projectedVelocity);
  });

  it("builds a finite tangent coexact reconstruction on the torus", () => {
    const model = new ControlledClebschSurfaceModel({ crossing: 1 });
    const sample = model.sampleParameter("torus", 0.41, 1.13);
    expect(Object.values(sample.projectedVelocity).every(Number.isFinite)).toBe(true);
    expect(dot(sample.projectedVelocity, sample.normal)).toBeCloseTo(0, 10);
    expect(magnitude(sample.projectedVelocity)).toBeGreaterThan(1e-4);
  });

  it("uses the frog triangle metric to produce finite tangent samples", () => {
    const mesh = parseFrogTriangleMesh(frogSource);
    const model = new ControlledClebschSurfaceModel({}, mesh, makeTestEigenbasis(mesh));
    for (const vertex of [0, 1100, 4200, 9000]) {
      const sample = model.sampleFrogVertex(vertex);
      expect(Object.values(sample).flatMap((value) => typeof value === "number" ? [value] : Object.values(value)).every(Number.isFinite)).toBe(true);
      for (const vector of [sample.dAlpha, sample.dBeta, sample.dPhi, sample.velocity, sample.projectedVelocity]) {
        expect(dot(vector, sample.normal)).toBeCloseTo(0, 7);
      }
    }
  });
});

const TAYLOR_GREEN_POINTS: ReadonlyArray<readonly [number, number]> = [
  [0.31, 0.77],
  [1.42, 2.13],
  [4.81, 5.37],
];

describe("Taylor–Green periodic-plane test case", () => {
  it("assembles the exact vortex from a globally periodic Clebsch triple", () => {
    const amplitude = 0.83;
    for (const [u, v] of TAYLOR_GREEN_POINTS) {
      const fields = evaluateTaylorGreenClebsch(u, v, amplitude, 0);
      const assembled = [
        fields.dPhi[0] + fields.alpha * fields.dBeta[0],
        fields.dPhi[1] + fields.alpha * fields.dBeta[1],
      ];
      expect(assembled[0]).toBeCloseTo(amplitude * Math.sin(u) * Math.cos(v), 12);
      expect(assembled[1]).toBeCloseTo(-amplitude * Math.cos(u) * Math.sin(v), 12);
      expect(fields.dAlpha[0] * fields.dBeta[1] - fields.dAlpha[1] * fields.dBeta[0])
        .toBeCloseTo(fields.vorticityDensity, 12);
    }
  });

  it("projects away exact contamination without changing Taylor–Green vorticity", () => {
    const model = new ControlledClebschSurfaceModel({ labelStrength: 1, potentialStrength: 0 });
    for (const [u, v] of TAYLOR_GREEN_POINTS) {
      const clean = model.sampleTaylorGreenPlane(u, v);
      model.reset({ potentialStrength: 0.37 });
      const contaminated = model.sampleTaylorGreenPlane(u, v);
      expect(contaminated.velocity).not.toEqual(clean.velocity);
      expect(contaminated.vorticity).toBeCloseTo(clean.vorticity, 12);
      expect(contaminated.projectedVelocity).toEqual(clean.projectedVelocity);
      expect(contaminated.divergentVelocity).not.toEqual({ x: 0, y: 0, z: 0 });
      model.reset({ potentialStrength: 0 });
    }
  });

  it("reports the analytic raw divergence while the projected field is exact", () => {
    const fields = evaluateTaylorGreenClebsch(0.63, 1.17, 1, 0.29);
    expect(fields.rawDivergence).toBeCloseTo(-0.58 * Math.sin(1.8), 12);
    expect(fields.projectedCovector[0]).toBeCloseTo(Math.sin(0.63) * Math.cos(1.17), 12);
    expect(fields.projectedCovector[1]).toBeCloseTo(-Math.cos(0.63) * Math.sin(1.17), 12);
  });
});

function magnitude(vector: Vec3): number {
  return Math.hypot(vector.x, vector.y, vector.z);
}
