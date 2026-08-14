import { describe, expect, it } from "vitest";

import { BernoulliClebschModel } from "./bernoulli-clebsch-model";

describe("periodic Bernoulli and Clebsch nozzle", () => {
  it("builds a smooth periodic constriction", () => {
    const model = new BernoulliClebschModel({ columns: 28, rows: 13, constriction: 0.42 });
    expect(model.height(0)).toBeCloseTo(model.height(model.length), 12);
    expect(model.height(0.5 * model.length)).toBeCloseTo(0.58, 12);
    expect(model.heightDerivative(0)).toBeCloseTo(0, 12);
    expect(model.heightDerivative(0.5 * model.length)).toBeCloseTo(0, 12);
  });

  it("accelerates and lowers Bernoulli pressure at the throat", () => {
    const model = new BernoulliClebschModel({
      columns: 32,
      rows: 15,
      constriction: 0.5,
      meanSpeed: 0.7,
      vortexStrength: 0,
    });
    const diagnostics = model.diagnostics();
    expect(diagnostics.throatSpeed).toBeGreaterThan(diagnostics.wideSpeed);
    expect(diagnostics.pressureDrop).toBeGreaterThan(0);
    expect(model.areaLawSpeed(0.5 * model.length)).toBeCloseTo(1.4, 8);
  });

  it("Hodge-projects both the harmonic current and Clebsch candidate", () => {
    const model = new BernoulliClebschModel({ columns: 30, rows: 14, vortexStrength: 0.5 });
    const diagnostics = model.diagnostics();
    expect(diagnostics.divergenceRms).toBeLessThan(1e-6);
    expect(diagnostics.vorticityRms).toBeGreaterThan(0.01);
    expect(diagnostics.fluxSpread).toBeLessThan(2e-4);
  });

  it("keeps harmonic circulation fixed while material labels move", () => {
    const model = new BernoulliClebschModel({ columns: 28, rows: 13, vortexStrength: 0.3, timeStep: 0.01 });
    const initial = model.diagnostics();
    model.step(12);
    const evolved = model.diagnostics();
    expect(evolved.time).toBeCloseTo(0.12, 12);
    expect(evolved.harmonicCirculation).toBeCloseTo(initial.harmonicCirculation, 12);
    expect(evolved.divergenceRms).toBeLessThan(1e-5);
    expect(Object.values(evolved).every(Number.isFinite)).toBe(true);
  });
});
