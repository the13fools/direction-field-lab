import { describe, expect, it } from "vitest";

import { buildRepresentationTransfer } from "./representation-transfer";

describe("face/edge/vertex representation transfers", () => {
  it("preserves a constant vertex field through the full round trip", () => {
    const report = buildRepresentationTransfer(8, "constant");
    expect(report.curlRms).toBeLessThan(1e-12);
    expect(report.faceResidualRms).toBeLessThan(1e-12);
    expect(report.roundTripRms).toBeLessThan(1e-12);
  });

  it("turns an exact sampled gradient into a closed edge 1-form", () => {
    const report = buildRepresentationTransfer(11, "gradient");
    expect(report.curlRms).toBeLessThan(1e-12);
    expect(report.faceResidualRms).toBeLessThan(1e-12);
  });

  it("recovers the analytic curl of the rotating linear field", () => {
    const report = buildRepresentationTransfer(9, "rotation");
    expect(report.analyticCurl).toBe(2);
    expect(report.curlTruthError).toBeLessThan(1e-12);
    expect(report.faceResidualRms).toBeGreaterThan(0);
  });

  it("reports the degrees of freedom of each discrete address", () => {
    const report = buildRepresentationTransfer(5, "gradient");
    expect(report.positions).toHaveLength(25);
    expect(report.faces).toHaveLength(32);
    expect(report.edges).toHaveLength(56);
  });
});
