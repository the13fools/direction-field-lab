import { describe, expect, it } from "vitest";
import { TUTORIALS, TUTORIAL_SECTIONS, formatProblem, parseProblem } from "./problem";

describe("problem format", () => {
  it("round-trips every tutorial", () => {
    for (const tutorial of TUTORIALS) {
      expect(parseProblem(formatProblem(tutorial.problem))).toEqual(tutorial.problem);
    }
  });

  it("organizes every tutorial into exactly one tour section", () => {
    const ids = TUTORIAL_SECTIONS.flatMap((section) => section.tutorialIds);
    expect(ids).toHaveLength(TUTORIALS.length);
    expect(new Set(ids).size).toBe(TUTORIALS.length);
    expect(new Set(ids)).toEqual(new Set(TUTORIALS.map((tutorial) => tutorial.id)));
  });

  it("rejects unknown kernels", () => {
    const invalid = JSON.stringify({ schema: "geometry-lab/problem@1", name: "x", kernel: "mystery" });
    expect(() => parseProblem(invalid)).toThrow(/Unknown kernel/);
  });

  it("adds a zero integrability weight to older vertex-field problems", () => {
    const vertex = TUTORIALS.find((tutorial) => tutorial.problem.kernel === "vertex-field")!;
    const source = JSON.parse(formatProblem(vertex.problem));
    delete source.parameters.objective.integrabilityWeight;
    const parsed = parseProblem(JSON.stringify(source));
    expect(parsed.kernel).toBe("vertex-field");
    if (parsed.kernel === "vertex-field") {
      expect(parsed.parameters.objective.integrabilityWeight).toBe(0);
    }
  });

  it("allows integrability to be the only enabled vertex term", () => {
    const vertex = TUTORIALS.find((tutorial) => tutorial.problem.kernel === "vertex-field")!;
    const source = JSON.parse(formatProblem(vertex.problem));
    source.parameters.objective = {
      dataWeight: 0,
      connectionSmoothnessWeight: 0,
      integrabilityWeight: 1,
      lengthWeight: 0,
      targetLength: 0.85,
    };
    expect(parseProblem(JSON.stringify(source))).toMatchObject({
      parameters: { objective: { integrabilityWeight: 1 } },
    });
  });
});
