import { describe, expect, it } from "vitest";

import {
  blendedPolyvectorBranch,
  mobiusReflectedAngle,
  mobiusRosyAngle,
  projectedPolyvectorBranch,
  tentativePolyvectorBranch,
  topologicalPolyvectorDiagnostics,
} from "./topological-polyvector-model";

describe("topological polyvector projection", () => {
  it("preserves line symmetry under branchwise Hodge projection", () => {
    const first = projectedPolyvectorBranch(2, 0, 1.2, 2.3, 0.7);
    const second = projectedPolyvectorBranch(2, 1, 1.2, 2.3, 0.7);
    expect(second.velocity[0]).toBeCloseTo(-first.velocity[0], 12);
    expect(second.velocity[1]).toBeCloseTo(-first.velocity[1], 12);
    expect(first.divergence).toBe(0);
    expect(second.divergence).toBe(0);
    expect(topologicalPolyvectorDiagnostics(2, 0.7, 1).blendedRosyDefect).toBeLessThan(1e-12);
  });

  it("starts from an exact 4-RoSy field with nonzero branch divergence", () => {
    const diagnostics = topologicalPolyvectorDiagnostics(4, 0.8, 0);
    expect(diagnostics.tentativeRosyDefect).toBeLessThan(1e-12);
    expect(diagnostics.tentativeDivergenceRms).toBeGreaterThan(0.2);
    expect(diagnostics.blendedRosyDefect).toBeLessThan(1e-12);
  });

  it("makes every branch divergence-free while breaking exact quarter turns", () => {
    const diagnostics = topologicalPolyvectorDiagnostics(4, 0.8, 1);
    expect(diagnostics.blendedDivergenceRms).toBeLessThan(1e-12);
    expect(diagnostics.blendedRosyDefect).toBeGreaterThan(0.1);
  });

  it("interpolates continuously between symmetry and incompressibility", () => {
    const tentative = tentativePolyvectorBranch(4, 1, 0.9, 1.8, 0.4);
    const projected = projectedPolyvectorBranch(4, 1, 0.9, 1.8, 0.4);
    const midpoint = blendedPolyvectorBranch(4, 1, 0.9, 1.8, 0.4, 0.5);
    expect(midpoint.velocity[0]).toBeCloseTo(0.5 * (tentative.velocity[0] + projected.velocity[0]), 12);
    expect(midpoint.velocity[1]).toBeCloseTo(0.5 * (tentative.velocity[1] + projected.velocity[1]), 12);
    expect(midpoint.divergence).toBeCloseTo(0.5 * tentative.divergence, 12);
  });

  it("uses reflection, rather than a rotation, at the Mobius sheet exchange", () => {
    for (const s of [0.2, 1.9, 5.6]) {
      expect(mobiusRosyAngle(s, 1)).toBeCloseTo(mobiusReflectedAngle(mobiusRosyAngle(s, 0)), 12);
    }
  });
});
