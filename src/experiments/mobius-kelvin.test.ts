import { describe, expect, it } from "vitest";

import { MobiusKelvinTracker, mobiusPatchVorticityIntegral } from "./mobius-kelvin";
import { MOBIUS_PERIOD, MobiusShallowWaterModel } from "./mobius-shallow-water-model";

describe("Möbius Kelvin-loop tracker", () => {
  it("samples velocity equivariantly across the deck transformation", () => {
    const model = new MobiusShallowWaterModel({
      columns: 44,
      rows: 18,
      preset: "twisted-vortex",
    });
    const base = model.sampleAt({ s: 0.71, r: -0.16 });
    const deck = model.sampleAt({ s: 0.71 + MOBIUS_PERIOD, r: 0.16 });
    expect(deck.depth).toBeCloseTo(base.depth, 12);
    expect(deck.velocityS).toBeCloseTo(base.velocityS, 12);
    expect(deck.velocityR).toBeCloseTo(-base.velocityR, 12);
  });

  it("keeps both loops fixed in the lake-at-rest solution", () => {
    const model = new MobiusShallowWaterModel({
      columns: 36,
      rows: 16,
      preset: "lake-rest",
    });
    const tracker = new MobiusKelvinTracker(model);
    const initialPoints = tracker.loops.map((loop) => loop.points.map((point) => ({ ...point })));
    tracker.step(model, 20);
    for (let loopIndex = 0; loopIndex < tracker.loops.length; loopIndex += 1) {
      for (let pointIndex = 0; pointIndex < tracker.loops[loopIndex]!.points.length; pointIndex += 1) {
        expect(tracker.loops[loopIndex]!.points[pointIndex]!.s).toBeCloseTo(
          initialPoints[loopIndex]![pointIndex]!.s,
          12,
        );
        expect(tracker.loops[loopIndex]!.points[pointIndex]!.r).toBeCloseTo(
          initialPoints[loopIndex]![pointIndex]!.r,
          12,
        );
      }
      expect(tracker.loops[loopIndex]!.drift).toBeCloseTo(0, 12);
    }
  });

  it("detects circulation around the one-sided topology sector", () => {
    const model = new MobiusShallowWaterModel({
      columns: 48,
      rows: 20,
      preset: "global-current",
    });
    const tracker = new MobiusKelvinTracker(model);
    const oneSided = tracker.loop("one-sided");
    expect(Math.abs(oneSided.initialCirculation)).toBeGreaterThan(0.1);
    expect(model.diagnostics().boundaryCirculation).toBeCloseTo(
      2 * oneSided.initialCirculation,
      2,
    );
  });

  it("compares the contractible loop with its enclosed vorticity two-form", () => {
    const model = new MobiusShallowWaterModel({
      columns: 64,
      rows: 28,
      preset: "twisted-vortex",
    });
    const tracker = new MobiusKelvinTracker(model);
    const patch = tracker.loop("contractible");
    expect(Math.abs(patch.enclosedVorticity)).toBeGreaterThan(1e-3);
    expect(Math.abs(patch.stokesDefect)).toBeLessThan(
      0.35 * Math.abs(patch.circulation),
    );
  });

  it("gives a patch and its deck image the same intrinsic vorticity integral", () => {
    const model = new MobiusShallowWaterModel({
      columns: 58,
      rows: 24,
      preset: "twisted-vortex",
    });
    const patch = Array.from({ length: 48 }, (_, index) => {
      const angle = 2 * Math.PI * index / 48;
      return { s: 1.1 + 0.12 * Math.cos(angle), r: 0.08 + 0.13 * Math.sin(angle) };
    });
    const deckImage = patch.map((point) => ({
      s: point.s + MOBIUS_PERIOD,
      r: -point.r,
    }));
    expect(mobiusPatchVorticityIntegral(model, deckImage)).toBeCloseTo(
      mobiusPatchVorticityIntegral(model, patch),
      10,
    );
  });

  it("advects finite closed lifts while exposing numerical Kelvin drift", () => {
    const model = new MobiusShallowWaterModel({
      columns: 40,
      rows: 18,
      preset: "seam-pulse",
    });
    const tracker = new MobiusKelvinTracker(model);
    tracker.step(model, 70);
    for (const loop of tracker.loops) {
      expect(Number.isFinite(loop.circulation)).toBe(true);
      expect(Number.isFinite(loop.drift)).toBe(true);
      expect(tracker.liftedPath(loop).length).toBe(loop.points.length + 1);
      expect(loop.points.every((point) => (
        Number.isFinite(point.s)
        && Number.isFinite(point.r)
        && Math.abs(point.r) <= model.parameters.halfWidth
      ))).toBe(true);
    }
  });
});
