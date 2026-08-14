import { describe, expect, it } from "vitest";

import {
  DEFAULT_SYMMETRIC_CLEBSCH_PARAMETERS,
  symmetricClebschDiagnostics,
  symmetricClebschSample,
  type SymmetricClebschParameters,
} from "./symmetric-clebsch-model";

function parameters(overrides: Partial<SymmetricClebschParameters>): SymmetricClebschParameters {
  return { ...DEFAULT_SYMMETRIC_CLEBSCH_PARAMETERS, ...overrides };
}

describe("symmetric Clebsch fields", () => {
  it("makes even-even labels produce a reflection-invariant one-form", () => {
    const diagnostics = symmetricClebschDiagnostics(parameters({ preset: "even-even" }));
    expect(diagnostics.alphaParity).toBe("even");
    expect(diagnostics.betaParity).toBe("even");
    expect(diagnostics.velocitySymmetryDefect).toBeLessThan(1e-12);
    expect(diagnostics.vorticityFormSymmetryDefect).toBeLessThan(1e-12);
  });

  it("makes odd-odd labels produce the same reflection type", () => {
    const diagnostics = symmetricClebschDiagnostics(parameters({ preset: "odd-odd" }));
    expect(diagnostics.alphaParity).toBe("odd");
    expect(diagnostics.betaParity).toBe("odd");
    expect(diagnostics.velocitySymmetryDefect).toBeLessThan(1e-12);
    expect(diagnostics.vorticityFormSymmetryDefect).toBeLessThan(1e-12);
  });

  it("detects a mixed-parity symmetry break", () => {
    const diagnostics = symmetricClebschDiagnostics(parameters({ preset: "mixed" }));
    expect(diagnostics.betaParity).toBe("mixed");
    expect(diagnostics.velocitySymmetryDefect).toBeGreaterThan(0.05);
    expect(diagnostics.vorticityFormSymmetryDefect).toBeGreaterThan(0.05);
  });

  it("allows asymmetric-looking gauge labels without changing velocity", () => {
    const gaugeParameters = parameters({ preset: "gauge", gauge: 1.1 });
    const diagnostics = symmetricClebschDiagnostics(gaugeParameters);
    expect(diagnostics.alphaParity).toBe("odd");
    expect(diagnostics.betaParity).toBe("mixed");
    expect(diagnostics.velocitySymmetryDefect).toBeLessThan(1e-12);
    expect(diagnostics.vorticityFormSymmetryDefect).toBeLessThan(1e-12);
    expect(diagnostics.gaugeReconstructionDefect).toBeLessThan(1e-12);
  });

  it("treats scalar vorticity as odd under an orientation-reversing mirror", () => {
    const field = parameters({ preset: "even-even" });
    for (const [x, y] of [[0.4, 0.2], [1.7, 0.65], [4.2, -0.37]] as const) {
      expect(symmetricClebschSample(x, y, field).vorticity).toBeCloseTo(
        -symmetricClebschSample(x, -y, field).vorticity,
        12,
      );
    }
  });
});
