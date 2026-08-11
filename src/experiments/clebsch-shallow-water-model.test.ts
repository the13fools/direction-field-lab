import { describe, expect, it } from "vitest";

import { ClebschShallowWaterModel } from "./clebsch-shallow-water-model";

describe("Clebsch shallow-water model", () => {
  it("reconstructs velocity from the exact and label one-forms", () => {
    const model = new ClebschShallowWaterModel({ resolution: 24 });
    const sample = model.samplePoint(0.37, 0.61);
    expect(sample.velocity.x).toBeCloseTo(sample.dPhi.x + sample.alphaDBeta.x, 12);
    expect(sample.velocity.y).toBeCloseTo(sample.dPhi.y + sample.alphaDBeta.y, 12);
  });

  it("keeps a constant lake at rest", () => {
    const model = new ClebschShallowWaterModel({ resolution: 20 });
    model.state.height.fill(model.parameters.meanDepth);
    model.state.phi.fill(0);
    model.state.alpha.fill(0);
    model.step(20);
    expect(model.diagnostics().maxSpeed).toBe(0);
    expect(Math.max(...model.state.height.map((value) => Math.abs(value - model.parameters.meanDepth)))).toBeLessThan(1e-12);
  });

  it("keeps depth positive and conserves periodic mass", () => {
    const model = new ClebschShallowWaterModel({ resolution: 24 });
    const initialMass = model.mass();
    model.step(80);
    expect(Math.min(...model.state.height)).toBeGreaterThan(0);
    expect(model.mass()).toBeCloseTo(initialMass, 12);
    expect(Object.values(model.diagnostics()).every(Number.isFinite)).toBe(true);
  });

  it("makes the Clebsch vorticity identity numerically visible", () => {
    const model = new ClebschShallowWaterModel({ resolution: 48, preset: "vortical-patch" });
    const diagnostics = model.diagnostics();
    expect(diagnostics.vorticityRms).toBeGreaterThan(0.1);
    expect(diagnostics.clebschIdentityRms).toBeLessThan(0.08 * diagnostics.vorticityRms);
  });

  it("advects both material labels", () => {
    const model = new ClebschShallowWaterModel({ resolution: 24 });
    const alpha = Float64Array.from(model.state.alpha);
    const beta = Float64Array.from(model.state.beta);
    model.step(40);
    const alphaChange = Math.hypot(...model.state.alpha.map((value, index) => value - alpha[index]!));
    const betaChange = Math.hypot(...model.state.beta.map((value, index) => value - beta[index]!));
    expect(alphaChange).toBeGreaterThan(1e-5);
    expect(betaChange).toBeGreaterThan(1e-5);
  });

  it("stays finite across the exposed control envelope", () => {
    for (const preset of ["crossing-labels", "potential-pulse", "vortical-patch"] as const) {
      const model = new ClebschShallowWaterModel({
        resolution: 64,
        timeStep: 0.004,
        clebschStrength: 0.32,
        preset,
      });
      model.step(60);
      expect(Math.min(...model.state.height)).toBeGreaterThan(0);
      expect(Object.values(model.diagnostics()).every(Number.isFinite)).toBe(true);
    }
  });

  it("de-aliases transported labels before grid-scale folds dominate the display", () => {
    const model = new ClebschShallowWaterModel({ resolution: 40 });
    model.step(1000);
    const diagnostics = model.diagnostics();
    expect(diagnostics.clebschIdentityRms / diagnostics.vorticityRms).toBeLessThan(0.3);
    expect(Math.min(...model.state.height)).toBeGreaterThan(0);
  });
});
