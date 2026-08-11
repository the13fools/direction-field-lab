import { describe, expect, it } from "vitest";

import { FlatTorusCohomologyModel } from "./flat-torus-cohomology-model";

describe("flat-torus harmonic lattice", () => {
  it("changes periods without changing local vorticity or divergence", () => {
    const model = new FlatTorusCohomologyModel({
      periodX: 0.83,
      periodY: -0.41,
      quantum: 0.25,
      subtractX: 2,
      subtractY: -1,
    });
    const before = model.sample(0.31, 0.67);
    model.update({ subtractX: -1, subtractY: 2 });
    const after = model.sample(0.31, 0.67);
    expect(after.vorticity).toBeCloseTo(before.vorticity, 12);
    expect(after.divergence).toBe(0);
    expect(after.coexactVelocity).toEqual(before.coexactVelocity);
    expect(after.reducedVelocity).not.toEqual(before.reducedVelocity);
  });

  it("subtracts the selected integral cohomology-lattice element exactly", () => {
    const model = new FlatTorusCohomologyModel({
      periodX: 0.85,
      periodY: -0.55,
      quantum: 0.5,
      subtractX: 2,
      subtractY: -1,
    });
    const diagnostics = model.diagnostics();
    expect(diagnostics.removedPeriod).toEqual({ x: 1, y: -0.5 });
    expect(diagnostics.residualPeriod.x).toBeCloseTo(-0.15, 12);
    expect(diagnostics.residualPeriod.y).toBeCloseTo(-0.05, 12);
  });

  it("finds the nearest lattice representative and minimizes residual harmonic energy", () => {
    const model = new FlatTorusCohomologyModel({ periodX: 0.85, periodY: -0.55, quantum: 0.5 });
    const nearest = model.nearestQuantizedField();
    expect(nearest).toEqual({ x: 2, y: -1 });
    model.update({ subtractX: nearest.x, subtractY: nearest.y });
    const nearestEnergy = model.diagnostics().residualHarmonicEnergy;
    for (let x = -3; x <= 3; x += 1) {
      for (let y = -3; y <= 3; y += 1) {
        model.update({ subtractX: x, subtractY: y });
        expect(model.diagnostics().residualHarmonicEnergy + 1e-12).toBeGreaterThanOrEqual(nearestEnergy);
      }
    }
  });

  it("advects identical particle clouds and records periodic windings", () => {
    const model = new FlatTorusCohomologyModel({
      vortexStrength: 0,
      periodX: 0.8,
      periodY: 0,
      quantum: 0.4,
      subtractX: 2,
      subtractY: 0,
      particleCount: 16,
    });
    for (let step = 0; step < 20; step += 1) model.step(0.1);
    const diagnostics = model.diagnostics();
    expect(diagnostics.rawMeanWinding.x).toBeGreaterThan(1);
    expect(diagnostics.reducedMeanWinding).toEqual({ x: 0, y: 0 });
  });
});
