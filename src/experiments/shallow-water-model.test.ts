import { describe, expect, it } from "vitest";

import { VertexShallowWaterModel } from "./shallow-water-model";

describe("vertex shallow-water baseline", () => {
  it("keeps a constant lake at rest", () => {
    const model = new VertexShallowWaterModel({ resolution: 12 });
    model.state.height.fill(0);
    model.step(25);
    expect(Math.max(...model.state.height.map(Math.abs))).toBe(0);
    expect(Math.max(...model.state.velocity.map((value) => Math.hypot(value.x, value.y)))).toBe(0);
  });

  it("conserves total mass on the periodic grid", () => {
    const model = new VertexShallowWaterModel({ resolution: 18 });
    const initial = model.mass();
    model.step(100);
    expect(Math.abs(model.mass() - initial)).toBeLessThan(1e-12);
  });

  it("uses an adjoint centered gradient/divergence pair", () => {
    const model = new VertexShallowWaterModel({ resolution: 16 });
    expect(model.adjointDefect()).toBeLessThan(1e-12);
  });

  it("keeps pressure-generated velocity curl-free up to roundoff", () => {
    const model = new VertexShallowWaterModel({ resolution: 20 });
    model.step(80);
    expect(model.diagnostics().curlRms).toBeLessThan(1e-10);
  });

  it("keeps a pure vortical mode out of the height equation while transporting dye", () => {
    const model = new VertexShallowWaterModel({ resolution: 24, pulseHeight: 0 });
    const initialTracer = Float64Array.from(model.state.tracer);
    model.seedVortex();
    model.step(80);
    expect(Math.max(...model.state.height.map(Math.abs))).toBeLessThan(1e-12);
    const tracerChange = Math.sqrt(model.state.tracer.reduce(
      (sum, value, index) => sum + (value - initialTracer[index]!) ** 2,
      0,
    ) / model.state.tracer.length);
    expect(tracerChange).toBeGreaterThan(1e-3);
    expect(model.diagnostics().curlRms).toBeGreaterThan(0.1);
  });
});
