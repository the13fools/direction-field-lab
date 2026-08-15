import { describe, expect, it } from "vitest";

import { FlatShallowWaterPreviewModel } from "./flat-shallow-water-preview-model";

describe("flat exact shallow-water story preview", () => {
  it("turns a localized height bump at rest into a moving shallow-water pulse", () => {
    const model = new FlatShallowWaterPreviewModel(32);
    const initialPeak = Math.max(...model.state.height) - model.parameters.meanDepth;
    expect(initialPeak).toBeGreaterThan(0.075);
    expect(Math.max(...model.velocity().map((value) => Math.hypot(value.x, value.y)))).toBeLessThan(1e-12);
    model.step(0.035);
    expect(Math.max(...model.velocity().map((value) => Math.hypot(value.x, value.y)))).toBeGreaterThan(0.02);
    expect(Math.abs(model.massDrift())).toBeLessThan(1e-12);
    expect(model.continuityResidualRms()).toBeLessThan(1e-12);
  });

  it("conserves linear shallow-water energy without damping", () => {
    const model = new FlatShallowWaterPreviewModel(32);
    const initialEnergy = model.energy();
    for (let step = 0; step < 240; step += 1) model.step(0.007);
    expect(model.energy()).toBeCloseTo(initialEnergy, 11);
  });

  it("returns exactly to its initial pressure pulse on reset", () => {
    const model = new FlatShallowWaterPreviewModel(24);
    const initial = Float64Array.from(model.state.height);
    model.step(0.09);
    model.reset();
    expect(model.state.time).toBe(0);
    expect([...model.state.height]).toEqual([...initial]);
  });
});
