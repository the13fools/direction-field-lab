import katex from "katex";
import { describe, expect, it } from "vitest";
import pageSource from "../../clebsch-surfaces.html?raw";

describe("Clebsch surface lesson math", () => {
  it("renders every static LaTeX expression without a KaTeX error", () => {
    const formulas = [...pageSource.matchAll(/data-latex="([^"]*)"/g)]
      .map((match) => match[1]!);

    expect(formulas.length).toBeGreaterThan(60);
    for (const formula of formulas) {
      expect(() => katex.renderToString(formula, {
        displayMode: true,
        throwOnError: true,
      }), formula).not.toThrow();
    }
  });
});
