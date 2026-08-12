import katex from "katex";
import { describe, expect, it } from "vitest";
import actionPageSource from "../../clebsch-surfaces-action.html?raw";
import introPageSource from "../../clebsch-surfaces.html?raw";
import referencePageSource from "../../clebsch-surfaces-reference.html?raw";
import shallowWaterPageSource from "../../clebsch-shallow-water.html?raw";
import flatTorusPageSource from "../../flat-torus-cohomology.html?raw";
import diskCirculationPageSource from "../../disk-circulation.html?raw";
import randomFluidPageSource from "../../random-fluids.html?raw";

describe("Clebsch surface lesson math", () => {
  it("renders every static LaTeX expression on both tutorial pages", () => {
    const formulas = [introPageSource, actionPageSource, referencePageSource, diskCirculationPageSource]
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

  it("connects disk boundary circulation to interior vorticity before puncturing the domain", () => {
    expect(diskCirculationPageSource).toContain("Circulation has to");
    expect(diskCirculationPageSource).toContain("u\\cdot n=0");
    expect(diskCirculationPageSource).toContain("\\oint_{\\partial D}u^\\flat=\\int_D d(u^\\flat)=2\\pi U_b");
    expect(diskCirculationPageSource).toContain('data-dd-mode="smooth"');
    expect(diskCirculationPageSource).toContain('data-dd-mode="annulus"');
    expect(diskCirculationPageSource).toContain('id="dd-inner"');
    expect(diskCirculationPageSource).toContain('id="dd-outer"');
    expect(diskCirculationPageSource).toContain("The difference Γ<sub>out</sub> − Γ<sub>in</sub>");
    expect(diskCirculationPageSource).toContain('id="dd-canvas"');
    expect(diskCirculationPageSource).toContain("Removing the center creates an annulus");
    expect(diskCirculationPageSource).toContain("A branch cut is bookkeeping");
    expect(diskCirculationPageSource).toContain("z=c\\,\\operatorname{sn}(u\\mid c^4)");
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
    expect(actionPageSource).toContain('data-cs-harmonic-preset="zero"');
    expect(actionPageSource).toContain('data-cs-harmonic-preset="nonzero"');
    expect(actionPageSource).toContain('href="./flat-torus-cohomology.html"');
    expect(actionPageSource).toContain("d(d\\phi)=0");
  });

  it("orders the action tutorial from transport to pairing to construction to topology", () => {
    const material = actionPageSource.indexOf('id="cs-material-title"');
    const pairing = actionPageSource.indexOf('id="cs-pairing-title"');
    const construction = actionPageSource.indexOf('id="cs-field-lab"');
    const topology = actionPageSource.indexOf('id="cs-roadmap-title"');

    expect(material).toBeGreaterThan(-1);
    expect(material).toBeLessThan(pairing);
    expect(pairing).toBeLessThan(construction);
    expect(construction).toBeLessThan(topology);
    expect(actionPageSource).toContain('class="cs-material-torus-link" href="./flat-torus-cohomology.html"');
  });

  it("links the gentle introduction to the action tutorial and back", () => {
    expect(introPageSource).toContain('href="./clebsch-surfaces-action.html"');
    expect(actionPageSource).toContain('href="./clebsch-surfaces.html"');
    expect(actionPageSource).toContain('href="./clebsch-surfaces-reference.html"');
    expect(referencePageSource).toContain('href="./clebsch-surfaces-action.html"');
    expect(actionPageSource).toContain('<template id="cs-reference-content-moved">');
    expect(referencePageSource).toContain('id="cs-reference-dec"');
  });

  it("explains how a target field determines the roles of alpha, beta, and phi", () => {
    expect(actionPageSource).toContain("Do not choose three mysterious fields at once");
    expect(actionPageSource).toContain("u^\\flat=d\\phi+\\alpha d\\beta+h");
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
    expect(actionPageSource.indexOf('id="cs-material-canvas"')).toBeLessThan(
      actionPageSource.indexOf('id="cs-field-lab"'),
    );
  });

  it("distinguishes the intrinsic vorticity two-form from its scalar and normal-vector views", () => {
    expect(actionPageSource).toContain("\\zeta=\\star_g\\omega^{(2)}");
    expect(actionPageSource).toContain("\\boldsymbol\\omega=\\zeta\\,\\mathbf n");
    expect(actionPageSource).toContain('data-cs-glyph="normalVorticity"');
    expect(introPageSource).toContain("the vorticity vector is zeta times the unit normal");
  });

  it("distinguishes loop circulation from patch vorticity before introducing topology", () => {
    expect(introPageSource).toContain("circulation is attached to a loop");
    expect(introPageSource).toContain("vorticity is attached to an area");
    expect(introPageSource).toContain("\\Gamma(C)=\\oint_C u^\\flat");
    expect(introPageSource).toContain("\\oint_{\\partial A}\\eta=\\int_A d\\eta");
    expect(introPageSource).toContain("Vorticity recovers boundary circulation—not every period");
  });

  it("treats both torus harmonic periods as physical velocity state", () => {
    expect(actionPageSource).toContain("There are two harmonic numbers");
    expect(actionPageSource).toContain("\\dim\\mathcal H^1(T^2)=2");
    expect(actionPageSource).toContain("pressure projection subtracts an exact form and therefore cannot remove them");
    expect(flatTorusPageSource).toContain("Two noncontractible periods remain");
    expect(flatTorusPageSource).toContain("\\Gamma_x=\\oint_{\\gamma_x}\\eta=c_x");
    expect(flatTorusPageSource).toContain("These two numbers are independent velocity data");
    expect(flatTorusPageSource).toContain("there is no preferred “nearest lattice point”");
    expect(flatTorusPageSource).toContain("WHAT “NEAREST” MEANS HERE");
    expect(flatTorusPageSource).toContain("There is no canonical nearest point before making those choices");
    expect(flatTorusPageSource).toContain('id="ft-match-clebsch"');
  });

  it("keeps the random lab kinematic and separates it from shallow-water dynamics", () => {
    expect(randomFluidPageSource).toContain("kinematic playground");
    expect(randomFluidPageSource).toContain("zero-harmonic sector");
    expect(shallowWaterPageSource).toContain("Do not project shallow water to zero divergence");
    expect(shallowWaterPageSource).toContain("\\partial_t h+\\operatorname{div}(hu)=0");
    expect(shallowWaterPageSource).toContain("must store or evolve them");
  });
});
