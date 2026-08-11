import katex from "katex";
import { describe, expect, it } from "vitest";
import actionPageSource from "../../clebsch-surfaces-action.html?raw";
import introPageSource from "../../clebsch-surfaces.html?raw";

describe("Clebsch surface lesson math", () => {
  it("renders every static LaTeX expression on both tutorial pages", () => {
    const formulas = [introPageSource, actionPageSource]
      .flatMap((source) => [...source.matchAll(/data-latex="([^"]*)"/g)])
      .map((match) => match[1]!);

    expect(formulas.length).toBeGreaterThan(70);
    for (const formula of formulas) {
      expect(() => katex.renderToString(formula, {
        displayMode: true,
        throwOnError: true,
      }), formula).not.toThrow();
    }
  });

  it("presents the torus obstruction, atlas repair, and global alternatives", () => {
    for (const mode of ["single", "atlas", "pair", "harmonic"]) {
      expect(actionPageSource).toContain(`data-cs-torus-mode="${mode}"`);
    }
    expect(actionPageSource).toContain("Exact forms have zero period");
    expect(actionPageSource).toContain("HOW THE EXTRA CHART FIXES IT");
    expect(actionPageSource).toContain("A CLEBSCH WORKAROUND");
    expect(actionPageSource).toContain("\\dim\\mathcal H^1(T^2)=2");
    expect(actionPageSource).toContain("They become local coordinates only where");
    expect(actionPageSource).toContain('id="cs-torus-pair-anatomy"');
    expect(actionPageSource).toContain('data-cs-harmonic-k="2"');
    expect(actionPageSource).toContain('href="./flat-torus-cohomology.html"');
    expect(actionPageSource).toContain("d(d\\phi)=0");
  });

  it("links the gentle introduction to the action tutorial and back", () => {
    expect(introPageSource).toContain('href="./clebsch-surfaces-action.html"');
    expect(actionPageSource).toContain('href="./clebsch-surfaces.html"');
  });
});
