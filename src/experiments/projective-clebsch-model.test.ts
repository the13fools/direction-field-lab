import { describe, expect, it } from "vitest";

import {
  PROJECTIVE_DOMAINS,
  projectiveBranchShift,
  projectiveDomainContains,
  projectiveLineTensor,
  projectiveRosyDirections,
  projectiveTransportedBranchAngle,
} from "./projective-clebsch-model";

describe("projective Clebsch fields", () => {
  it("represents a line without choosing one of its two arrows", () => {
    const first = projectiveRosyDirections(2, 0.73);
    expect(first[1]!.x).toBeCloseTo(-first[0]!.x, 12);
    expect(first[1]!.y).toBeCloseTo(-first[0]!.y, 12);
    const tensor = projectiveLineTensor(0.73);
    const wrapped = projectiveLineTensor(0.73 + 2 * Math.PI);
    expect(wrapped.xx).toBeCloseTo(tensor.xx, 12);
    expect(wrapped.xy).toBeCloseTo(tensor.xy, 12);
    expect(wrapped.yy).toBeCloseTo(tensor.yy, 12);
  });

  it("has one independent cyclic monodromy on an annulus", () => {
    const domain = PROJECTIVE_DOMAINS.annulus;
    expect(projectiveBranchShift(domain, 2, [1], "hole-1")).toBe(1);
    expect(projectiveBranchShift(domain, 4, [3], "outer")).toBe(3);
  });

  it("has two independent generators on the pair of pants", () => {
    const domain = PROJECTIVE_DOMAINS["two-hole"];
    expect(projectiveBranchShift(domain, 4, [1, 2], "hole-1")).toBe(1);
    expect(projectiveBranchShift(domain, 4, [1, 2], "hole-2")).toBe(2);
    expect(projectiveBranchShift(domain, 4, [1, 2], "outer")).toBe(3);
    expect(projectiveBranchShift(domain, 2, [1, 1], "outer")).toBe(0);
  });

  it("accumulates the predicted branch angle under continuous transport", () => {
    const domain = PROJECTIVE_DOMAINS["two-hole"];
    const symmetry = 4;
    const charges = [1, 2];
    for (const loop of ["hole-1", "hole-2", "outer"] as const) {
      const start = projectiveTransportedBranchAngle(domain, symmetry, charges, loop, 0);
      const end = projectiveTransportedBranchAngle(domain, symmetry, charges, loop, 1);
      const expected = 2 * Math.PI * projectiveBranchShift(domain, symmetry, charges, loop) / symmetry;
      const difference = ((end - start) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
      expect(difference).toBeCloseTo(expected, 9);
    }
  });

  it("cuts out the requested holes without changing the outer disk", () => {
    const annulus = PROJECTIVE_DOMAINS.annulus;
    const pair = PROJECTIVE_DOMAINS["two-hole"];
    expect(projectiveDomainContains(annulus, { x: 0, y: 0 })).toBe(false);
    expect(projectiveDomainContains(annulus, { x: 0.8, y: 0 })).toBe(true);
    expect(projectiveDomainContains(pair, { x: -0.47, y: 0 })).toBe(false);
    expect(projectiveDomainContains(pair, { x: 0, y: 0.65 })).toBe(true);
    expect(projectiveDomainContains(pair, { x: 1.6, y: 0 })).toBe(false);
  });
});
