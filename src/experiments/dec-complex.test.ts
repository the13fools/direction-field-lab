import { describe, expect, it } from "vitest";

import {
  applyDecOperator,
  buildHexDecComplex,
  buildTriangularPatchDecComplex,
  decOperator,
  multiplyMatrices,
  seedDecForm,
} from "./dec-complex";

describe("small DEC complex", () => {
  const complex = buildHexDecComplex();

  it("builds compatible primal incidence matrices", () => {
    expect(complex.vertices).toHaveLength(7);
    expect(complex.edges).toHaveLength(12);
    expect(complex.faces).toHaveLength(6);
    const boundaryOfBoundary = multiplyMatrices(complex.d1, complex.d0);
    expect(Math.max(...boundaryOfBoundary.flat().map(Math.abs))).toBeLessThan(1e-12);
  });

  it("makes d squared zero on primal and dual cochains", () => {
    const primal0 = seedDecForm(complex, "primal", 0, "linear");
    const primal2 = applyDecOperator(complex, applyDecOperator(complex, primal0, "d"), "d");
    expect(Math.max(...primal2.values.map(Math.abs))).toBeLessThan(1e-12);

    const dual0 = seedDecForm(complex, "dual", 0, "alternating");
    const dual2 = applyDecOperator(complex, applyDecOperator(complex, dual0, "d"), "d");
    expect(Math.max(...dual2.values.map(Math.abs))).toBeLessThan(1e-12);
  });

  it("round-trips every degree through the diagonal Hodge star", () => {
    for (const degree of [0, 1, 2] as const) {
      const initial = seedDecForm(complex, "primal", degree, "alternating");
      const roundTrip = applyDecOperator(complex, applyDecOperator(complex, initial, "star"), "star");
      expect(roundTrip.side).toBe("primal");
      expect(roundTrip.degree).toBe(degree);
      expect(Math.max(...roundTrip.values.map((value, index) =>
        Math.abs(value - initial.values[index]!)))).toBeLessThan(1e-12);
    }
  });

  it("advertises the correct sparse operator shapes", () => {
    expect(decOperator(complex, { side: "primal", degree: 0 }, "d")?.matrix).toHaveLength(12);
    expect(decOperator(complex, { side: "primal", degree: 1 }, "d")?.matrix).toHaveLength(6);
    expect(decOperator(complex, { side: "primal", degree: 2 }, "d")).toBeNull();
    expect(decOperator(complex, { side: "dual", degree: 0 }, "d")?.matrix).toHaveLength(12);
  });

  it("builds the same exact sequence on a larger triangular patch", () => {
    const patch = buildTriangularPatchDecComplex(5);
    expect(patch.vertices).toHaveLength(25);
    expect(patch.edges).toHaveLength(56);
    expect(patch.faces).toHaveLength(32);
    expect(Math.max(...multiplyMatrices(patch.d1, patch.d0).flat().map(Math.abs))).toBeLessThan(1e-12);
    expect(Math.min(...patch.stars.flat())).toBeGreaterThan(0);
  });
});
