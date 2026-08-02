import { describe, expect, it } from "vitest";
import manifest from "../../examples/vertex-curl-baseline.experiment.json";

import { validateResultArtifact } from "../core/result";
import { runExperiment } from "../core/run-experiment";
import { runVertexCurlSpec } from "./vertex-curl-adapter";

describe("vertex curl experiment adapter", () => {
  it("turns the portable manifest into a complete result artifact", () => {
    const run = runVertexCurlSpec(manifest);
    expect(validateResultArtifact(run.result)).toBe(run.result);
    expect(run.result.status).toBe("complete");
    expect(run.result.meshes).toHaveLength(1);
    expect(run.result.fields.map((field) => field.association)).toEqual([
      "vertex",
      "face",
      "face",
      "dual-cell",
      "dual-cell",
    ]);
    expect(run.result.series).toHaveLength(manifest.metrics.length);
    expect(run.result.series[0]?.x).toHaveLength(manifest.sweep.values.length);
  });

  it("applies named presets without changing the manifest", () => {
    const harmonic = runVertexCurlSpec(manifest, "harmonic");
    expect(harmonic.options.fieldPreset).toBe("harmonic");
    expect(Math.abs(harmonic.experiment.periods.u)).toBeGreaterThan(6);
    expect(manifest.inputs.field.parameters.preset).toBe("gradient");
  });

  it("is reachable through the generic experiment registry", () => {
    const result = runExperiment(manifest, "vortex");
    expect(result.experimentId).toBe("vertex-curl-baseline");
    expect(result.metrics.find((metric) => metric.id === "curl.primal-rms")?.value)
      .toBeGreaterThan(0.1);
  });
});
