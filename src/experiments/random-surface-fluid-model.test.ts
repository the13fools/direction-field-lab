import { describe, expect, it } from "vitest";

import {
  RandomSurfaceFluidModel,
  torusPosition,
} from "./random-surface-fluid-model";

function length(x: number, y: number, z: number): number {
  return Math.hypot(x, y, z);
}

describe("random fluids on surfaces", () => {
  it("replays a seeded realization exactly", () => {
    const first = new RandomSurfaceFluidModel({ seed: 41, particleCount: 20 });
    const second = new RandomSurfaceFluidModel({ seed: 41, particleCount: 20 });
    expect(first.spectrum()).toEqual(second.spectrum());
    expect(first.fieldSamples().slice(0, 8)).toEqual(second.fieldSamples().slice(0, 8));
    expect(first.particles).toEqual(second.particles);
  });

  it("builds a tangent, numerically divergence-free sphere field", () => {
    const model = new RandomSurfaceFluidModel({
      surface: "sphere",
      seed: 7,
      particleCount: 32,
      modeCount: 18,
    });
    const diagnostics = model.diagnostics();
    expect(diagnostics.tangencyResidual).toBeLessThan(1e-12);
    expect(diagnostics.divergenceResidual).toBeLessThan(2e-5);
    expect(diagnostics.rmsSpeed).toBeGreaterThan(0.2);
  });

  it("keeps advected sphere particles on the sphere", () => {
    const model = new RandomSurfaceFluidModel({ surface: "sphere", particleCount: 48 });
    model.step(80);
    for (const particle of model.particles) {
      const position = particle.position!;
      expect(Math.abs(length(position.x, position.y, position.z) - 1)).toBeLessThan(1e-12);
    }
  });

  it("builds a tangent, numerically divergence-free torus field", () => {
    const model = new RandomSurfaceFluidModel({
      surface: "torus",
      seed: 23,
      particleCount: 32,
      modeCount: 22,
    });
    const diagnostics = model.diagnostics();
    expect(diagnostics.tangencyResidual).toBeLessThan(1e-12);
    expect(diagnostics.divergenceResidual).toBeLessThan(3e-5);
  });

  it("keeps torus particle coordinates wrapped on their embedded surface", () => {
    const model = new RandomSurfaceFluidModel({ surface: "torus", particleCount: 48 });
    model.step(80);
    for (const particle of model.particles) {
      expect(particle.u).toBeGreaterThanOrEqual(0);
      expect(particle.u).toBeLessThan(2 * Math.PI);
      expect(particle.v).toBeGreaterThanOrEqual(0);
      expect(particle.v).toBeLessThan(2 * Math.PI);
      expect(model.particlePosition(particle)).toEqual(torusPosition(particle.u!, particle.v!));
    }
  });

  it("decorrelates a time-varying field while a frozen field stays fixed", () => {
    const changing = new RandomSurfaceFluidModel({ turnover: 1.1, particleCount: 16 });
    changing.step(120);
    expect(changing.diagnostics().fieldCorrelation).toBeLessThan(0.98);

    const frozen = new RandomSurfaceFluidModel({ turnover: 0, particleCount: 16 });
    frozen.step(120);
    expect(frozen.diagnostics().fieldCorrelation).toBeCloseTo(1, 12);
  });
});
