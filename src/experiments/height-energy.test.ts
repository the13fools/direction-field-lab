import { describe, expect, it } from "vitest";

import { compileHeightEnergy } from "./height-energy";

describe("live height energy", () => {
  it("differentiates the linear gravity potential through second order", () => {
    const energy = compileHeightEnergy("0.5 * g * h^2");
    expect(energy.evaluate(0.3, 9.81).value).toBeCloseTo(0.5 * 9.81 * 0.3 ** 2);
    expect(energy.evaluate(0.3, 9.81).derivative).toBeCloseTo(9.81 * 0.3);
    expect(energy.evaluate(0.3, 9.81).secondDerivative).toBeCloseTo(9.81);
  });

  it("accepts nonlinear pressure energies and rejects unknown symbols", () => {
    expect(compileHeightEnergy("0.5 * g * h^2 + 2 * h^4").evaluate(0.2, 4).secondDerivative)
      .toBeCloseTo(4 + 24 * 0.2 ** 2);
    expect(() => compileHeightEnergy("h + eval")).toThrow(/Unknown symbol/);
  });
});
