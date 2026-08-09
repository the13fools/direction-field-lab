import { describe, expect, it } from "vitest";

import { compileVectorFieldProgram, DEFAULT_VECTOR_FIELD_PROGRAM } from "./vector-field-program";

const environment = { vx: 1, vy: 2, vz: 3, x: 0.5, y: -0.25, z: 0.75, t: 4 };

describe("editable vector display programs", () => {
  it("preserves the analytic vector in the default program", () => {
    expect(compileVectorFieldProgram(DEFAULT_VECTOR_FIELD_PROGRAM).evaluate(environment)).toEqual({ x: 1, y: 2, z: 3 });
  });

  it("evaluates arithmetic over velocity, position, and time", () => {
    const compiled = compileVectorFieldProgram(`x = vx - 0.5 * y
y = vy + 0.5 * x
z = vz + 0.25 * t`);
    expect(compiled.evaluate(environment)).toEqual({ x: 1.125, y: 2.25, z: 4 });
  });

  it("rejects incomplete and unknown programs", () => {
    expect(() => compileVectorFieldProgram("x = vx\ny = mystery\nz = vz")).toThrow(/Unknown symbol/);
    expect(() => compileVectorFieldProgram("x = vx\ny = vy")).toThrow(/Missing assignment/);
  });
});
