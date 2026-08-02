import { describe, expect, it } from "vitest";

import type { HodgeMetrics } from "../solver/messages";
import { DEFAULT_HODGE_FIELD, formatHodgeMetrics } from "./hodge-state";

const metrics: HodgeMetrics = {
  inputNorm: 8,
  exactNorm: 4,
  coexactNorm: 3,
  harmonicNorm: 2,
  reconstructionNorm: 6.56,
  harmonicDivergenceMax: 0,
  harmonicCurlMax: 0,
  orthogonalityDefect: 0,
  pythagoreanDefect: 0,
};

describe("Hodge UI state", () => {
  it("opens a newly initialized Hodge problem on its nonzero input", () => {
    expect(DEFAULT_HODGE_FIELD).toBe("input");
  });

  it("does not present zero-valued certificates before decomposition", () => {
    expect(formatHodgeMetrics(metrics, false)).toEqual({
      curl: "not computed",
      divergence: "not computed",
      orthogonality: "not computed",
      reconstruction: "6.56e+0",
    });
  });

  it("formats certificates after decomposition", () => {
    expect(formatHodgeMetrics({ ...metrics, reconstructionNorm: 0 }, true)).toEqual({
      curl: "0.00e+0",
      divergence: "0.00e+0",
      orthogonality: "0.00e+0",
      reconstruction: "0.00e+0",
    });
  });
});
