import { describe, expect, it } from "vitest";
import { TUTORIALS } from "./problem";
import { VIEW_SCHEMA, validateSnapshot, type CurveNetworkSnapshot } from "./snapshot";

const diagnostics = {
  energy: 0,
  gradientNorm: 0,
  newtonDecrement: 0,
  dofs: 4,
  hessianNonzeros: 8,
  acceptedIterations: 0,
};

describe("view snapshot", () => {
  it("accepts a valid curve network", () => {
    const snapshot: CurveNetworkSnapshot = {
      schema: VIEW_SCHEMA,
      name: "edge",
      primitive: "curve-network",
      positions: [0, 0, 0, 1, 0, 0],
      edges: [0, 1],
      problem: TUTORIALS[0]!.problem,
      diagnostics,
    };
    expect(validateSnapshot(snapshot)).toBe(snapshot);
  });

  it("rejects out-of-range indices", () => {
    const snapshot = {
      schema: VIEW_SCHEMA,
      name: "bad edge",
      primitive: "curve-network" as const,
      positions: [0, 0, 0],
      edges: [0, 2],
      problem: TUTORIALS[0]!.problem,
      diagnostics,
    };
    expect(() => validateSnapshot(snapshot)).toThrow(/outside/);
  });
});
