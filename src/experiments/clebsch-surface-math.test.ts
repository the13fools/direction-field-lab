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

  it("presents the torus obstruction, atlas repair, and global alternatives", () => {
    for (const mode of ["single", "atlas", "pair", "harmonic"]) {
      expect(pageSource).toContain(`data-cs-torus-mode="${mode}"`);
    }
    expect(pageSource).toContain("Exact forms have zero period");
    expect(pageSource).toContain("HOW THE EXTRA CHART FIXES IT");
    expect(pageSource).toContain("A CLEBSCH WORKAROUND");
    expect(pageSource).toContain("\\dim\\mathcal H^1(T^2)=2");
  });
});
