import { describe, expect, it } from "vitest";

import {
  DEFAULT_REVERSIBLE_LINE_FLUID_PARAMETERS,
  forwardEulerSample,
  integrateReversibleParticleTrace,
  linePowerCoefficient,
  projectedLineBranch,
  reversibleBranchSample,
  reversibleLineFluidDiagnostics,
  sameTimeNegativeEulerResidual,
  streamFunctionGradient,
  tentativeLineBranch,
} from "./reversible-line-fluid-model";

function torusDistance(a: number, b: number): number {
  const difference = Math.abs(a - b) % (2 * Math.PI);
  return Math.min(difference, 2 * Math.PI - difference);
}

describe("reversible line-fluid lab", () => {
  it("projects both roots with opposite pressure potentials", () => {
    const point = [1.24, 2.03] as const;
    const time = 0.73;
    const plusBefore = tentativeLineBranch(1, point[0], point[1], time);
    const minusBefore = tentativeLineBranch(-1, point[0], point[1], time);
    const plusAfter = projectedLineBranch(1, point[0], point[1], time);
    const minusAfter = projectedLineBranch(-1, point[0], point[1], time);
    expect(plusBefore.velocity[0]).toBeCloseTo(-minusBefore.velocity[0], 12);
    expect(plusBefore.velocity[1]).toBeCloseTo(-minusBefore.velocity[1], 12);
    expect(plusBefore.divergence).toBeCloseTo(-minusBefore.divergence, 12);
    expect(plusAfter.velocity[0]).toBeCloseTo(-minusAfter.velocity[0], 12);
    expect(plusAfter.velocity[1]).toBeCloseTo(-minusAfter.velocity[1], 12);
    expect(plusAfter.divergence).toBe(0);
    expect(minusAfter.divergence).toBe(0);
  });

  it("turns the projected divergence-free branch into an integrable rotated field", () => {
    const x = 4.14;
    const y = 0.91;
    const time = 1.3;
    const sample = projectedLineBranch(1, x, y, time);
    const gradient = streamFunctionGradient(x, y, time);
    expect(-sample.velocity[1]).toBeCloseTo(gradient[0], 12);
    expect(sample.velocity[0]).toBeCloseTo(gradient[1], 12);
  });

  it("stores the same line coefficient for either signed root", () => {
    const velocity = forwardEulerSample(0.8, 2.1, 0.4).velocity;
    expect(linePowerCoefficient(velocity)).toEqual(linePowerCoefficient([-velocity[0], -velocity[1]]));
  });

  it("separates a divergence audit from an Euler audit", () => {
    const diagnostics = reversibleLineFluidDiagnostics(0.82);
    expect(diagnostics.tentativeDivergenceRms).toBeGreaterThan(0.5);
    expect(diagnostics.projectedDivergenceRms).toBe(0);
    expect(diagnostics.signSymmetryDefect).toBe(0);
    expect(diagnostics.coIntegrabilityDefect).toBeLessThan(1e-12);
    expect(diagnostics.sameTimeEulerResidualRms).toBeGreaterThan(0.1);
    expect(diagnostics.reversedEulerResidualRms).toBe(0);
  });

  it("makes the same-time negative branch valid only in the steady exception", () => {
    const moving = sameTimeNegativeEulerResidual(1.1, 0.7, 0.9);
    expect(Math.hypot(...moving)).toBeGreaterThan(0.1);
    const steady = { ...DEFAULT_REVERSIBLE_LINE_FLUID_PARAMETERS, drift: 0 };
    expect(sameTimeNegativeEulerResidual(1.1, 0.7, 0.9, steady)).toEqual([0, 0]);
  });

  it("makes the time-reversed sheet trace the forward solution backward", () => {
    const initial = { x: 1.04, y: 2.31 };
    const time = 1.2;
    const reverseTrace = integrateReversibleParticleTrace(initial, time, "time-reversed");
    const backwardTrace = integrateReversibleParticleTrace(initial, -time, "forward");
    const reverseEnd = reverseTrace.at(-1)!;
    const backwardEnd = backwardTrace.at(-1)!;
    expect(torusDistance(reverseEnd.x, backwardEnd.x)).toBeLessThan(2e-7);
    expect(torusDistance(reverseEnd.y, backwardEnd.y)).toBeLessThan(2e-7);
    const reverseVelocity = reversibleBranchSample("time-reversed", 2.2, 1.3, time).velocity;
    const backwardVelocity = forwardEulerSample(2.2, 1.3, -time).velocity;
    expect(reverseVelocity[0]).toBeCloseTo(-backwardVelocity[0], 12);
    expect(reverseVelocity[1]).toBeCloseTo(-backwardVelocity[1], 12);
  });
});
