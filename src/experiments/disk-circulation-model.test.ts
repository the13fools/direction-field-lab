import { describe, expect, it } from "vitest";
import {
  advectAnnulusPoint,
  advectDiskPoint,
  annulusCirculation,
  annulusCoefficients,
  loopCirculation,
  sampleAnnulus,
  samplePuncturedDisk,
  sampleSmoothDisk,
} from "./disk-circulation-model";

describe("disk circulation model", () => {
  it("reconstructs smooth solid rotation from a global Clebsch triple", () => {
    const x = 0.31;
    const y = -0.42;
    const speed = 0.8;
    const sample = sampleSmoothDisk(x, y, speed);
    const dPhi = { x: -speed * y, y: -speed * x };
    const alphaDBeta = { x: 0, y: sample.alpha! };

    expect(dPhi.x + alphaDBeta.x).toBeCloseTo(sample.oneForm.x, 12);
    expect(dPhi.y + alphaDBeta.y).toBeCloseTo(sample.oneForm.y, 12);
    expect(sample.vorticity).toBeCloseTo(2 * speed, 12);
  });

  it("matches every smooth loop circulation with integrated vorticity", () => {
    const speed = 0.7;
    for (const radius of [0.1, 0.35, 0.72, 1]) {
      const fromLoop = loopCirculation(radius, speed, "smooth");
      const fromArea = sampleSmoothDisk(0, 0, speed).vorticity * Math.PI * radius * radius;
      expect(fromLoop).toBeCloseTo(fromArea, 12);
    }
  });

  it("makes the punctured comparison curl-free away from its removed center", () => {
    const speed = 0.65;
    const inner = loopCirculation(0.25, speed, "punctured");
    const outer = loopCirculation(1, speed, "punctured");
    expect(samplePuncturedDisk(0.4, -0.2, speed).vorticity).toBe(0);
    expect(inner).toBeCloseTo(outer, 12);
    expect(() => samplePuncturedDisk(0, 0, speed)).toThrow(/undefined/);
  });

  it("advects both tests on circles without changing radius", () => {
    const point = { x: 0.4, y: 0.3 };
    for (const mode of ["smooth", "punctured"] as const) {
      const moved = advectDiskPoint(point, 0.8, 0.7, mode);
      expect(Math.hypot(moved.x, moved.y)).toBeCloseTo(0.5, 12);
    }
  });

  it("matches independent annulus boundary circulations", () => {
    const innerRadius = 0.24;
    const inner = 1.7;
    const outer = 4.2;
    expect(annulusCirculation(innerRadius, innerRadius, inner, outer)).toBeCloseTo(inner, 12);
    expect(annulusCirculation(1, innerRadius, inner, outer)).toBeCloseTo(outer, 12);
    const coefficients = annulusCoefficients(innerRadius, inner, outer);
    const integratedVorticity = coefficients.vorticity * Math.PI * (1 - innerRadius ** 2);
    expect(integratedVorticity).toBeCloseTo(outer - inner, 12);
  });

  it("separates a common circulation shift from vorticity", () => {
    const innerRadius = 0.3;
    const original = annulusCoefficients(innerRadius, 1.1, 3.4);
    const shifted = annulusCoefficients(innerRadius, 2.6, 4.9);
    expect(shifted.vorticity).toBeCloseTo(original.vorticity, 12);
    expect(shifted.harmonic - original.harmonic).toBeCloseTo(1.5 / (2 * Math.PI), 12);

    const harmonicOnly = annulusCoefficients(innerRadius, 2.2, 2.2);
    expect(harmonicOnly.vorticity).toBeCloseTo(0, 12);
  });

  it("samples and advects the annulus field without radial drift", () => {
    const point = { x: 0.52, y: 0.21 };
    const sample = sampleAnnulus(point.x, point.y, 0.24, 1.5, 4.1);
    expect(sample.velocity.x * point.x + sample.velocity.y * point.y).toBeCloseTo(0, 12);
    const moved = advectAnnulusPoint(point, 0.7, 0.24, 1.5, 4.1);
    expect(Math.hypot(moved.x, moved.y)).toBeCloseTo(Math.hypot(point.x, point.y), 12);
  });
});
