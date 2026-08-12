import { describe, expect, it } from "vitest";
import { completeEllipticK, slitDiskMap } from "./slit-conformal-flow";

describe("two-slit conformal map", () => {
  it("maps the real rectangle endpoints to the two slit tips", () => {
    for (const slitTip of [0.3, 0.6, 0.85]) {
      const ellipticK = completeEllipticK(slitTip ** 4);
      const right = slitDiskMap({ re: ellipticK, im: 0 }, slitTip);
      const left = slitDiskMap({ re: -ellipticK, im: 0 }, slitTip);
      expect(right.re).toBeCloseTo(slitTip, 11);
      expect(right.im).toBeCloseTo(0, 11);
      expect(left.re).toBeCloseTo(-slitTip, 11);
      expect(left.im).toBeCloseTo(0, 11);
    }
  });

  it("maps the horizontal rectangle edges to the unit circle", () => {
    const slitTip = 0.62;
    const ellipticK = completeEllipticK(slitTip ** 4);
    const complementaryK = completeEllipticK(1 - slitTip ** 4);
    for (const horizontalFraction of [-0.8, -0.35, 0, 0.4, 0.9]) {
      for (const sign of [-1, 1]) {
        const point = slitDiskMap({
          re: horizontalFraction * ellipticK,
          im: sign * complementaryK / 2,
        }, slitTip);
        expect(Math.hypot(point.re, point.im)).toBeCloseTo(1, 10);
      }
    }
  });
});
