import { describe, expect, it } from "vitest";

import { EXPERIMENT_SCHEMA, validateExperimentSpec } from "./experiment";

const experiment = {
  schema: EXPERIMENT_SCHEMA,
  id: "vertex-curl-baseline",
  title: "Vertex curl baseline",
  question: "Which discrete curl converges?",
  inputs: {
    mesh: { operator: "mesh.torus-grid", parameters: { resolution: 16 } },
    field: { operator: "field.analytic-torus", parameters: { preset: "gradient" } },
  },
  methods: [
    { id: "primal", label: "Triangle circulation", operator: "curl.vertex-trapezoid" },
  ],
  sweep: { path: "inputs.mesh.parameters.resolution", values: [8, 16, 32] },
  metrics: ["l2", "linf"],
  defaultPreset: "leakage",
  presets: [
    {
      id: "leakage",
      label: "Gradient leakage",
      overrides: { resolution: 16, fieldPreset: "gradient" },
    },
  ],
};

describe("experiment specification", () => {
  it("accepts a manifest-driven convergence experiment", () => {
    expect(validateExperimentSpec(experiment)).toEqual(experiment);
  });

  it("requires the default preset to exist", () => {
    expect(() =>
      validateExperimentSpec({ ...experiment, defaultPreset: "missing" }),
    ).toThrow(/not present/);
  });
});

