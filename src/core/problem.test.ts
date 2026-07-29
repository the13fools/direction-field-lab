import { describe, expect, it } from "vitest";
import { TUTORIALS, formatProblem, parseProblem } from "./problem";

describe("problem format", () => {
  it("round-trips every tutorial", () => {
    for (const tutorial of TUTORIALS) {
      expect(parseProblem(formatProblem(tutorial.problem))).toEqual(tutorial.problem);
    }
  });

  it("rejects unknown kernels", () => {
    const invalid = JSON.stringify({ schema: "geometry-lab/problem@1", name: "x", kernel: "mystery" });
    expect(() => parseProblem(invalid)).toThrow(/Unknown kernel/);
  });
});
