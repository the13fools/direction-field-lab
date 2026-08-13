import { describe, expect, it } from "vitest";

import {
  MOBIUS_PERIOD,
  MobiusShallowWaterModel,
  mobiusCenterlineParallelFrame,
  mobiusGeometry,
  mobiusPosition,
  mobiusTangentR,
} from "./mobius-shallow-water-model";

describe("Möbius shallow-water model", () => {
  it("glues the embedded strip with a reflected transverse coordinate", () => {
    for (const r of [-0.5, -0.17, 0, 0.31, 0.5]) {
      const end = mobiusPosition(MOBIUS_PERIOD, r);
      const start = mobiusPosition(0, -r);
      expect(end[0]).toBeCloseTo(start[0], 12);
      expect(end[1]).toBeCloseTo(start[1], 12);
      expect(end[2]).toBeCloseTo(start[2], 12);
      const transverseEnd = mobiusTangentR(MOBIUS_PERIOD);
      const transverseStart = mobiusTangentR(0);
      expect(transverseEnd[0]).toBeCloseTo(-transverseStart[0], 12);
      expect(transverseEnd[1]).toBeCloseTo(-transverseStart[1], 12);
      expect(transverseEnd[2]).toBeCloseTo(-transverseStart[2], 12);
    }
  });

  it("makes the metric compatible with the Möbius seam", () => {
    for (const r of [-0.5, -0.2, 0.1, 0.5]) {
      expect(mobiusGeometry(MOBIUS_PERIOD, r).metricSS).toBeCloseTo(
        mobiusGeometry(0, -r).metricSS,
        12,
      );
    }
  });

  it("gives the Levi–Civita frame reflected holonomy after one lap", () => {
    const start = mobiusCenterlineParallelFrame(0);
    const oneLap = mobiusCenterlineParallelFrame(MOBIUS_PERIOD);
    const twoLaps = mobiusCenterlineParallelFrame(2 * MOBIUS_PERIOD);
    for (let component = 0; component < 3; component += 1) {
      expect(oneLap.longitudinal[component]).toBeCloseTo(start.longitudinal[component]!, 12);
      expect(oneLap.transverse[component]).toBeCloseTo(-start.transverse[component]!, 12);
      expect(twoLaps.longitudinal[component]).toBeCloseTo(start.longitudinal[component]!, 12);
      expect(twoLaps.transverse[component]).toBeCloseTo(start.transverse[component]!, 12);
    }
  });

  it("keeps the curved lake-at-rest state fixed", () => {
    const model = new MobiusShallowWaterModel({ columns: 36, rows: 16, preset: "lake-rest" });
    model.step(20);
    const diagnostics = model.diagnostics();
    expect(diagnostics.maximumSpeed).toBeLessThan(2e-12);
    expect(diagnostics.minimumDepth).toBeCloseTo(model.parameters.meanDepth, 12);
    expect(Math.abs(diagnostics.massDrift)).toBeLessThan(1e-13);
  });

  it("conserves finite-volume mass through the twisted seam", () => {
    const model = new MobiusShallowWaterModel({ columns: 40, rows: 18, preset: "seam-pulse" });
    model.step(80);
    const diagnostics = model.diagnostics();
    expect(Math.abs(diagnostics.massDrift)).toBeLessThan(2e-12);
    expect(diagnostics.minimumDepth).toBeGreaterThan(0);
    expect(Object.values(diagnostics).every(Number.isFinite)).toBe(true);
  });

  it("creates a globally valid velocity from a twisted streamfunction", () => {
    const model = new MobiusShallowWaterModel({ columns: 48, rows: 20, preset: "twisted-vortex" });
    const diagnostics = model.diagnostics();
    expect(diagnostics.vorticityRms).toBeGreaterThan(0.01);
    expect(Math.abs(diagnostics.boundaryCirculation)).toBeLessThan(0.02);
    model.step(30);
    expect(model.diagnostics().minimumDepth).toBeGreaterThan(0);
  });

  it("stores the single global current in boundary circulation", () => {
    const model = new MobiusShallowWaterModel({ columns: 52, rows: 22, preset: "global-current" });
    expect(Math.abs(model.diagnostics().boundaryCirculation)).toBeGreaterThan(0.1);
  });
});
