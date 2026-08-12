import { describe, expect, it } from "vitest";
import {
  advectDiskPoint,
  loopCirculation,
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
});
