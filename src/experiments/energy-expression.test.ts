import { describe, expect, it } from "vitest";

import { compileEnergyExpression, DEFAULT_UNIT_ENERGY } from "./energy-expression";

describe("live energy expressions", () => {
  const environment = {
    ux: 1.2,
    uy: -0.4,
    tx: 0.7,
    ty: 0.1,
    data: 2,
    unit: 3,
    length: 1,
  };

  it("differentiates the unit-norm energy through second order", () => {
    const compiled = compileEnergyExpression(DEFAULT_UNIT_ENERGY);
    const jet = compiled.evaluate(environment);
    const radiusResidual = environment.ux ** 2 + environment.uy ** 2 - environment.length ** 2;
    expect(jet.value).toBeCloseTo(
      0.5 * environment.data *
        ((environment.ux - environment.tx) ** 2 + (environment.uy - environment.ty) ** 2) +
        0.5 * environment.unit * radiusResidual ** 2,
    );
    expect(jet.gradient[0]).toBeCloseTo(
      environment.data * (environment.ux - environment.tx) +
        2 * environment.unit * radiusResidual * environment.ux,
    );
    expect(jet.gradient[1]).toBeCloseTo(
      environment.data * (environment.uy - environment.ty) +
        2 * environment.unit * radiusResidual * environment.uy,
    );
    expect(jet.hessian[0][1]).toBeCloseTo(4 * environment.unit * environment.ux * environment.uy);
    expect(jet.hessian[1][0]).toBeCloseTo(jet.hessian[0][1]);
  });

  it("changes the derivatives when students change the formula", () => {
    const dataOnly = compileEnergyExpression("0.5 * data * ((ux-tx)^2 + (uy-ty)^2)");
    const unitOnly = compileEnergyExpression("0.5 * unit * (ux^2 + uy^2 - length^2)^2");
    expect(dataOnly.evaluate(environment).gradient).not.toEqual(unitOnly.evaluate(environment).gradient);
  });

  it("rejects unknown code and unsupported powers", () => {
    expect(() => compileEnergyExpression("window.alert(1)")).toThrow(/Unexpected|Unknown symbol/);
    expect(() => compileEnergyExpression("ux^20")).toThrow(/supported range/);
  });
});
