import { describe, expect, it } from "vitest";

import { FlatShallowWaterPreviewModel } from "./flat-shallow-water-preview-model";

describe("flat exact shallow-water story preview", () => {
  it("keeps its Fourier-wave amplitude and mass without numerical damping", () => {
    const model = new FlatShallowWaterPreviewModel(32);
    const initialAmplitude = Math.max(...model.state.height) - Math.min(...model.state.height);
    let largestLaterAmplitude = 0;
    for (let step = 0; step < 400; step += 1) {
      model.step(0.007);
      const amplitude = Math.max(...model.state.height) - Math.min(...model.state.height);
      largestLaterAmplitude = Math.max(largestLaterAmplitude, amplitude);
    }
    expect(largestLaterAmplitude).toBeGreaterThan(0.9 * initialAmplitude);
    expect(Math.abs(model.massDrift())).toBeLessThan(1e-12);
  });

  it("returns exactly to its initial standing-wave state on reset", () => {
    const model = new FlatShallowWaterPreviewModel(24);
    const initial = Float64Array.from(model.state.height);
    model.step(0.09);
    model.reset();
    expect(model.state.time).toBe(0);
    expect([...model.state.height]).toEqual([...initial]);
  });
});
