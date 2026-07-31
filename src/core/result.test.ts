import { describe, expect, it } from "vitest";

import {
  RESULT_SCHEMA,
  resultTransferables,
  validateResultArtifact,
  type ResultArtifact,
} from "./result";

const result: ResultArtifact = {
  schema: RESULT_SCHEMA,
  experimentId: "curl-test",
  status: "complete",
  meshes: [
    {
      id: "surface",
      positions: new Float64Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      faces: new Uint32Array([0, 1, 2]),
      edges: new Uint32Array([0, 1, 1, 2, 2, 0]),
    },
  ],
  fields: [
    {
      id: "curl",
      meshId: "surface",
      association: "face",
      valueType: "scalar",
      frame: "ambient",
      components: 1,
      values: new Float64Array([0]),
    },
  ],
  metrics: [{ id: "curl.l2", value: 0 }],
  series: [{ id: "convergence", x: [8, 16], y: [0.1, 0.025] }],
  messages: [],
  provenance: {
    applicationVersion: "test",
    backendBundles: { core: "test" },
    experiment: { schema: "geometry-lab/experiment@2" },
  },
};

describe("generic result artifacts", () => {
  it("validates mesh-associated fields", () => {
    expect(validateResultArtifact(result)).toBe(result);
  });

  it("collects typed-array buffers for zero-copy postMessage transfer", () => {
    expect(resultTransferables(result)).toHaveLength(4);
  });

  it("rejects a field with the wrong association size", () => {
    const invalid: ResultArtifact = {
      ...result,
      fields: [{ ...result.fields[0]!, values: new Float64Array([0, 1]) }],
    };
    expect(() => validateResultArtifact(invalid)).toThrow(/association/);
  });

  it("requires an explicit ambient basis for local tangent components", () => {
    const invalid: ResultArtifact = {
      ...result,
      fields: [
        {
          id: "tangent",
          meshId: "surface",
          association: "vertex",
          valueType: "vector",
          frame: "local-tangent",
          components: 2,
          values: new Float64Array([1, 0, 1, 0, 1, 0]),
        },
      ],
    };
    expect(() => validateResultArtifact(invalid)).toThrow(/basis/);
  });
});
