import { describe, expect, it } from "vitest";

import { ClebschMaterialLabelModel } from "./clebsch-material-label-model";

describe("Clebsch material labels", () => {
  it("uses the Taylor-Green Clebsch factorization at initialization", () => {
    const model = new ClebschMaterialLabelModel(0.8);
    const point = model.tracer;
    expect(point.alpha).toBeCloseTo(1.6 * Math.cos(point.x), 12);
    expect(point.beta).toBeCloseTo(Math.cos(point.y), 12);
    expect(point.phi).toBeCloseTo(-0.8 * Math.cos(point.x) * Math.cos(point.y), 12);
    const reconstructed = {
      x: 0.8 * Math.sin(point.x) * Math.cos(point.y),
      y: 0.8 * Math.cos(point.x) * Math.sin(point.y) + point.alpha * -Math.sin(point.y),
    };
    expect(reconstructed.x).toBeCloseTo(model.velocity(point.x, point.y).x, 12);
    expect(reconstructed.y).toBeCloseTo(model.velocity(point.x, point.y).y, 12);
  });

  it("advects alpha and beta as invariant material labels while phi evolves", () => {
    const model = new ClebschMaterialLabelModel();
    const initial = { alpha: model.tracer.alpha, beta: model.tracer.beta, phi: model.tracer.phi };
    for (let step = 0; step < 120; step += 1) model.step(0.004);
    expect(model.tracer.alpha).toBe(initial.alpha);
    expect(model.tracer.beta).toBe(initial.beta);
    expect(Math.abs(model.tracer.phi - initial.phi)).toBeGreaterThan(1e-4);
  });

  it("preserves vorticity on a material trajectory in the steady Euler flow", () => {
    const model = new ClebschMaterialLabelModel();
    for (let step = 0; step < 250; step += 1) model.step(0.003);
    expect(model.diagnostics().tracerVorticityError).toBeCloseTo(0, 5);
  });

  it("keeps a material patch area nearly constant", () => {
    const model = new ClebschMaterialLabelModel();
    for (let step = 0; step < 250; step += 1) model.step(0.003);
    expect(model.diagnostics().patchAreaRatio).toBeCloseTo(1, 3);
  });
});
