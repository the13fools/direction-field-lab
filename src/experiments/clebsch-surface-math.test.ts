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

  it("explains how a target field determines the roles of alpha, beta, and phi", () => {
    expect(actionPageSource).toContain("Do not choose three mysterious fields at once");
    expect(actionPageSource).toContain("d(u^\\flat-\\alpha d\\beta)=0");
    expect(actionPageSource).toContain('data-cs-choice-preset="parallel"');
    expect(actionPageSource).toContain('data-cs-choice-preset="vortical"');
    expect(actionPageSource).toContain('data-cs-choice-preset="exact"');
    expect(actionPageSource).toContain('id="cs-current-choice-kicker"');
  });

  it("includes a material-label evolution lab with an explicit controlled-flow caveat", () => {
    expect(actionPageSource).toContain('id="cs-material-canvas"');
    expect(actionPageSource).toContain('data-cs-material-view="both"');
    expect(actionPageSource).toContain("D_t\\alpha=0");
    expect(actionPageSource).toContain("D_t\\phi=\\tfrac12|u|^2-p");
    expect(actionPageSource).toContain("pressure changes it along the trajectory");
    expect(actionPageSource).toContain("not yet a free-running nonlinear solver");
  });
});
