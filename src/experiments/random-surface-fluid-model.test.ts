import { describe, expect, it } from "vitest";

import {
  DEFAULT_RANDOM_SURFACE_FLUID_PARAMETERS,
  RandomSurfaceFluidModel,
  squarePosition,
  temporalPerlinNoise,
  torusPosition,
} from "./random-surface-fluid-model";

function length(x: number, y: number, z: number): number {
  return Math.hypot(x, y, z);
}

describe("random fluids on surfaces", () => {
  it("starts with one thousand particles", () => {
    expect(DEFAULT_RANDOM_SURFACE_FLUID_PARAMETERS.particleCount).toBe(1000);
    expect(new RandomSurfaceFluidModel().particles).toHaveLength(1000);
  });

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

  it("builds a periodic divergence-free square flow and wraps its particles", () => {
    const model = new RandomSurfaceFluidModel({
      surface: "square",
      projection: "divergence-free",
      particleCount: 40,
      seed: 29,
    });
    expect(model.diagnostics().divergenceResidual).toBeLessThan(3e-5);
    model.step(100);
    for (const particle of model.particles) {
      expect(particle.u).toBeGreaterThanOrEqual(0);
      expect(particle.u).toBeLessThan(2 * Math.PI);
      expect(particle.v).toBeGreaterThanOrEqual(0);
      expect(particle.v).toBeLessThan(2 * Math.PI);
      expect(model.particlePosition(particle)).toEqual(squarePosition(particle.u!, particle.v!));
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

  it("uses a smooth deterministic Perlin process in time", () => {
    expect(temporalPerlinNoise(3.271, 17)).toBe(temporalPerlinNoise(3.271, 17));
    expect(temporalPerlinNoise(3.271, 17)).not.toBe(temporalPerlinNoise(3.271, 18));
    const h = 1e-4;
    const center = temporalPerlinNoise(4, 91);
    const derivativeLeft = (center - temporalPerlinNoise(4 - h, 91)) / h;
    const derivativeRight = (temporalPerlinNoise(4 + h, 91) - center) / h;
    expect(Math.abs(derivativeLeft - derivativeRight)).toBeLessThan(2e-5);
  });

  it("separates curl-free and divergence-free Hodge projections", () => {
    for (const surface of ["square", "sphere", "torus"] as const) {
      const curlFree = new RandomSurfaceFluidModel({
        surface,
        projection: "curl-free",
        particleCount: 16,
        modeCount: 16,
      }).diagnostics();
      const divergenceFree = new RandomSurfaceFluidModel({
        surface,
        projection: "divergence-free",
        particleCount: 16,
        modeCount: 16,
      }).diagnostics();
      expect(curlFree.vorticityRms).toBeLessThan(4e-5);
      expect(curlFree.divergenceResidual).toBeGreaterThan(0.05);
      expect(divergenceFree.divergenceResidual).toBeLessThan(4e-5);
      expect(divergenceFree.vorticityRms).toBeGreaterThan(0.05);
    }
  });

  it("constructs tangent Clebsch fields with visible vorticity", () => {
    for (const surface of ["square", "sphere", "torus"] as const) {
      const diagnostics = new RandomSurfaceFluidModel({
        surface,
        projection: "clebsch",
        particleCount: 16,
        modeCount: 16,
      }).diagnostics();
      expect(diagnostics.tangencyResidual).toBeLessThan(1e-12);
      expect(diagnostics.vorticityRms).toBeGreaterThan(0.05);
    }
  });

  it("Hodge-projects Clebsch fields without erasing their resolved vorticity", () => {
    for (const surface of ["square", "sphere", "torus"] as const) {
      const raw = new RandomSurfaceFluidModel({
        surface,
        projection: "clebsch",
        particleCount: 16,
        modeCount: 16,
      }).diagnostics();
      const projected = new RandomSurfaceFluidModel({
        surface,
        projection: "clebsch-projected",
        particleCount: 16,
        modeCount: 16,
      }).diagnostics();
      expect(projected.tangencyResidual).toBeLessThan(1e-12);
      expect(projected.divergenceResidual).toBeLessThan(raw.divergenceResidual * 0.25);
      expect(projected.vorticityRms).toBeGreaterThan(0.02);
    }
  });
});
