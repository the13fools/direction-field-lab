import { describe, expect, it } from "vitest";

import { TUTORIALS } from "../core/problem";
import {
  controlsForProblem,
  problemControlValue,
  updateProblemControl,
} from "./problem-controls";

describe("guided problem controls", () => {
  it("exposes every vertex objective coefficient", () => {
    const problem = TUTORIALS.find((item) => item.problem.kernel === "vertex-field")!.problem;
    const paths = controlsForProblem(problem)
      .flatMap((group) => group.controls)
      .map((control) => control.path.join("."));
    expect(paths).toContain("parameters.objective.dataWeight");
    expect(paths).toContain("parameters.objective.integrabilityWeight");
    expect(paths).toContain("parameters.objective.lengthWeight");
  });

  it("updates a typed problem without mutating the original", () => {
    const problem = TUTORIALS.find((item) => item.problem.kernel === "vertex-field")!.problem;
    const updated = updateProblemControl(
      problem,
      ["parameters", "objective", "lengthWeight"],
      3.5,
    );
    expect(problemControlValue(updated, ["parameters", "objective", "lengthWeight"])).toBe(3.5);
    expect(problemControlValue(problem, ["parameters", "objective", "lengthWeight"])).not.toBe(3.5);
  });
});
