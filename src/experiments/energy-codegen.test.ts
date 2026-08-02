import { describe, expect, it } from "vitest";

import { DEFAULT_UNIT_ENERGY } from "./energy-expression";
import { DEFAULT_ELEMENT_PROGRAM } from "./element-program";
import {
  generatePythonElementProgram,
  generatePythonVertexModule,
  generateTinyAdElementProgramHeader,
  generateTinyAdVertexHeader,
} from "./energy-codegen";

describe("live energy code generation", () => {
  it("emits a TinyAD callback without JavaScript power syntax", () => {
    const header = generateTinyAdVertexHeader(DEFAULT_UNIT_ENERGY);
    expect(header).toContain("TINYAD_SCALAR_TYPE(element)");
    expect(header).toContain("const Scalar ux = field[0]");
    expect(header).not.toContain("^");
  });

  it("emits a portable Python function", () => {
    const module = generatePythonVertexModule(DEFAULT_UNIT_ENERGY);
    expect(module).toContain("def live_vertex_energy");
    expect(module).toContain("** 2");
  });

  it("generates matching vertex, edge, and face TinyAD callbacks", () => {
    const header = generateTinyAdElementProgramHeader(DEFAULT_ELEMENT_PROGRAM);
    expect(header).toContain("generated_vertex_energy");
    expect(header).toContain("generated_connection_energy");
    expect(header).toContain("generated_circulation_energy");
    expect(header).toContain("circulation_coefficients");
    expect(generatePythonElementProgram(DEFAULT_ELEMENT_PROGRAM)).toContain("circulation_energy");
  });
});
