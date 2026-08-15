import { describe, expect, it } from "vitest";

import { ClebschShallowWaterModel } from "./clebsch-shallow-water-model";

describe("Clebsch shallow-water model", () => {
  it("reconstructs velocity from the exact and label one-forms", () => {
    const model = new ClebschShallowWaterModel({ resolution: 24 });
    const sample = model.samplePoint(0.37, 0.61);
    expect(sample.velocity.x).toBeCloseTo(sample.dPhi.x + sample.labelOneForm.x, 12);
    expect(sample.velocity.y).toBeCloseTo(sample.dPhi.y + sample.labelOneForm.y, 12);
  });

  it("keeps a constant lake at rest", () => {
    const model = new ClebschShallowWaterModel({ resolution: 20 });
    model.state.height.fill(model.parameters.meanDepth);
    model.state.phi.fill(0);
    for (const weights of model.state.weights) weights.fill(0);
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

  it("advects all ambient-label and weight channels", () => {
    const model = new ClebschShallowWaterModel({ resolution: 24 });
    const weights = model.state.weights.map((values) => Float64Array.from(values));
    const labels = model.state.labels.map((values) => Float64Array.from(values));
    model.step(40);
    for (let component = 0; component < 3; component += 1) {
      let weightChange2 = 0;
      let labelChange2 = 0;
      for (let index = 0; index < model.state.weights[component]!.length; index += 1) {
        weightChange2 += (model.state.weights[component]![index]! - weights[component]![index]!) ** 2;
        labelChange2 += (model.state.labels[component]![index]! - labels[component]![index]!) ** 2;
      }
      const weightChange = Math.sqrt(weightChange2);
      const labelChange = Math.sqrt(labelChange2);
      expect(weightChange).toBeGreaterThan(1e-5);
      expect(labelChange).toBeGreaterThan(1e-5);
    }
  });

  it("recharts to ambient XYZ without changing the reconstructed velocity", () => {
    const model = new ClebschShallowWaterModel({
      resolution: 32,
      representation: "single-pair",
      rechartInterval: 0,
    });
    model.step(30);
    const before = model.velocity();
    const defect = model.rechartToAmbientCoordinates();
    const after = model.velocity();
    let error2 = 0;
    let reference2 = 0;
    for (let index = 0; index < before.length; index += 1) {
      error2 += (after[index]!.x - before[index]!.x) ** 2 + (after[index]!.y - before[index]!.y) ** 2;
      reference2 += before[index]!.x ** 2 + before[index]!.y ** 2;
    }
    expect(defect).toBeLessThan(1e-11);
    expect(Math.sqrt(error2 / reference2)).toBeCloseTo(defect, 12);
    expect(model.labelFrameQuality()).toBeGreaterThan(0.08);
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
    expect(diagnostics.rechartCount).toBeGreaterThan(1);
    expect(diagnostics.rechartVelocityDefect).toBeLessThan(1e-10);
    expect(Math.min(...model.state.height)).toBeGreaterThan(0);
  });
});
