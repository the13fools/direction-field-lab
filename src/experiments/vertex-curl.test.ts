import { describe, expect, it } from "vitest";

import { runVertexCurlExperiment } from "./vertex-curl";

describe("vertex curl manufactured solutions", () => {
  it("converges for both curl locations and both connection baselines", () => {
    const coarse = runVertexCurlExperiment({
      resolution: 8,
      fieldPreset: "gradient",
      edgeFamily: "u",
    });
    const fine = runVertexCurlExperiment({
      resolution: 24,
      fieldPreset: "gradient",
      edgeFamily: "u",
    });
    expect(fine.mesh.vertices).toHaveLength(24 ** 2);
    expect(fine.mesh.faces).toHaveLength(2 * 24 ** 2);
    expect(fine.primal.errorRms).toBeLessThan(coarse.primal.errorRms);
    expect(fine.dual.errorRms).toBeLessThan(coarse.dual.errorRms);
    expect(fine.dual.errorRms).toBeLessThan(fine.primal.errorRms);
    expect(fine.connections.extrinsicRms).toBeLessThan(coarse.connections.extrinsicRms);
    expect(fine.connections.intrinsicRms).toBeLessThan(coarse.connections.intrinsicRms);
  });

  it("separates local closedness from global periods", () => {
    const harmonic = runVertexCurlExperiment({
      resolution: 24,
      fieldPreset: "harmonic",
      edgeFamily: "diagonal",
    });
    expect(harmonic.primal.rms).toBeLessThan(0.05);
    expect(harmonic.dual.rms).toBeLessThan(0.005);
    expect(Math.abs(harmonic.periods.u)).toBeGreaterThan(6);
    expect(Math.abs(harmonic.periods.v)).toBeGreaterThan(1.5);
  });

  it("detects a nonzero-curl positive control", () => {
    const coarse = runVertexCurlExperiment({ resolution: 8, fieldPreset: "vortex" });
    const fine = runVertexCurlExperiment({ resolution: 24, fieldPreset: "vortex" });
    expect(fine.primal.truthRms).toBeGreaterThan(0.1);
    expect(fine.primal.errorRms).toBeLessThan(coarse.primal.errorRms);
    expect(fine.dual.errorRms).toBeLessThan(coarse.dual.errorRms);
  });
});

