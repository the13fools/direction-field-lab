import { describe, expect, it } from "vitest";

import {
  DEFAULT_ELEMENT_PROGRAM,
  formatElementProgram,
  parseElementProgram,
  validateElementProgram,
} from "./element-program";

describe("shared element programs", () => {
  it("round-trips the browser and code-generation source of truth", () => {
    expect(parseElementProgram(formatElementProgram(DEFAULT_ELEMENT_PROGRAM))).toEqual(
      DEFAULT_ELEMENT_PROGRAM,
    );
  });

  it("validates the live expression and required sparse domains", () => {
    const draft = JSON.parse(formatElementProgram(DEFAULT_ELEMENT_PROGRAM));
    draft.terms[0].expression = "unknown_symbol + ux";
    expect(() => validateElementProgram(draft)).toThrow(/Unknown symbol/);
    draft.terms = draft.terms.filter((term: { domain: string }) => term.domain !== "face");
    expect(() => validateElementProgram(draft)).toThrow();
  });

  it("makes field association and dimension explicit", () => {
    const draft = JSON.parse(formatElementProgram(DEFAULT_ELEMENT_PROGRAM));
    draft.unknown.association = "face";
    expect(() => validateElementProgram(draft)).toThrow(/vertex tangent field/);
  });
});
