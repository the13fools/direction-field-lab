import { describe, expect, it } from "vitest";

import {
  nearestHarmonicLoopIndex,
  reduceHarmonicLoop,
  sampleClebschLoop,
} from "./clebsch-torus-loop-model";

describe("Clebsch loop anatomy", () => {
  it("assembles a uniform dθ from two nonuniform pieces", () => {
    for (let index = 0; index < 80; index += 1) {
      const sample = sampleClebschLoop(2 * Math.PI * index / 80, 1.3);
      expect(sample.velocityCoefficient).toBeCloseTo(1.3, 12);
      expect(sample.alphaDBetaCoefficient + sample.dPhiCoefficient).toBeCloseTo(1.3, 12);
    }
  });

  it("makes the label pair trace a closed ellipse rather than a surface chart", () => {
    const start = sampleClebschLoop(0);
    const finish = sampleClebschLoop(2 * Math.PI);
    expect(finish.alpha).toBeCloseTo(start.alpha, 12);
    expect(finish.beta).toBeCloseTo(start.beta, 12);
    for (let index = 0; index < 40; index += 1) {
      const sample = sampleClebschLoop(2 * Math.PI * index / 40);
      expect((sample.alpha / 2) ** 2 + sample.beta ** 2).toBeCloseTo(1, 12);
    }
  });

  it("subtracts a quantized harmonic coefficient and its period", () => {
    const reduction = reduceHarmonicLoop(0.85, 0.5, 2);
    expect(reduction.removedCoefficient).toBe(1);
    expect(reduction.residualCoefficient).toBeCloseTo(-0.15, 12);
    expect(reduction.originalPeriod).toBeCloseTo(2 * Math.PI * 0.85, 12);
    expect(reduction.residualPeriod).toBeCloseTo(2 * Math.PI * -0.15, 12);
  });

  it("chooses the nearest imposed lattice representative", () => {
    expect(nearestHarmonicLoopIndex(0.85, 0.5)).toBe(2);
    expect(nearestHarmonicLoopIndex(-0.55, 0.5)).toBe(-1);
  });
});
