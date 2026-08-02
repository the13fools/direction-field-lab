import { describe, expect, it } from "vitest";

import { LocalScalar, localAdd, localScale, localSquare, localSubtract } from "./local-autodiff";
import { SparseObjectiveAssembler } from "./sparse-assembly";

describe("TinyAD-style browser assembly", () => {
  it("differentiates an edge energy and scatters its off-diagonal Hessian blocks", () => {
    const dimension = 4;
    const xi = LocalScalar.variable(1, dimension, 0);
    const yi = LocalScalar.variable(2, dimension, 1);
    const xj = LocalScalar.variable(4, dimension, 2);
    const yj = LocalScalar.variable(6, dimension, 3);
    const energy = localScale(
      localAdd(localSquare(localSubtract(xj, xi)), localSquare(localSubtract(yj, yi))),
      0.5,
    );
    const objective = new SparseObjectiveAssembler(8);
    objective.addElement([0, 1, 6, 7], energy);

    expect(objective.value).toBeCloseTo(12.5);
    expect([...objective.gradient]).toEqual([-3, -4, 0, 0, 0, 0, 3, 4]);
    expect(objective.hessian.get(0, 6)).toBeCloseTo(-1);
    expect(objective.hessian.get(1, 7)).toBeCloseTo(-1);
    expect(objective.hessian.expandedNonzeros()).toBe(8);
    expect([...objective.hessian.multiply([1, 2, 0, 0, 0, 0, 4, 6])]).toEqual([
      -3, -4, 0, 0, 0, 0, 3, 4,
    ]);
    expect(objective.hessian.gershgorinLowerBound()).toBeCloseTo(0);
  });

  it("accumulates shared element entries", () => {
    const objective = new SparseObjectiveAssembler(2);
    const x = LocalScalar.variable(2, 1, 0);
    objective.addElement([0], localSquare(x));
    objective.addElement([0], localScale(localSquare(x), 0.5));
    expect(objective.hessian.get(0, 0)).toBeCloseTo(3);
  });
});
