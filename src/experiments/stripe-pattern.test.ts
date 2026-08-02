import { describe, expect, it } from "vitest";

import { PeriodicStripeModel, stripeSamplingReport } from "./stripe-pattern";

describe("periodic stripe projection", () => {
  it("keeps the global phase mass normalized", () => {
    const model = new PeriodicStripeModel(11, "swirl", 3);
    model.step(120);
    expect(model.massNorm()).toBeCloseTo(1, 12);
  });

  it("decreases the connection mismatch", () => {
    const model = new PeriodicStripeModel(13, "bend", 4);
    const before = model.report().energy;
    model.step(300);
    expect(model.report().energy).toBeLessThan(before);
  });

  it("recovers a nearly compatible constant stripe field", () => {
    const model = new PeriodicStripeModel(15, "constant", 3);
    model.step(1200);
    expect(model.report().residualRms).toBeLessThan(0.04);
  });

  it("identifies a high-resolution stripe grid", () => {
    expect(stripeSamplingReport(19, 4.5)).toEqual({
      cellsPerStripe: 4,
      quality: "usable",
    });
    const highResolution = stripeSamplingReport(43, 4.5);
    expect(highResolution.cellsPerStripe).toBeCloseTo(9.333333, 5);
    expect(highResolution.quality).toBe("well-resolved");
  });
});
