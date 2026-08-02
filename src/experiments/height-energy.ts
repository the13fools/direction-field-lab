import { compileEnergyExpression } from "./energy-expression";

export const DEFAULT_HEIGHT_ENERGY = "0.5 * g * h^2";

export interface HeightEnergyJet {
  value: number;
  derivative: number;
  secondDerivative: number;
}

export interface CompiledHeightEnergy {
  source: string;
  cppExpression: string;
  evaluate(height: number, gravity: number): HeightEnergyJet;
}

export function compileHeightEnergy(source: string): CompiledHeightEnergy {
  const identifiers = source.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
  for (const identifier of identifiers) {
    if (identifier !== "h" && identifier !== "g") {
      throw new Error(`Unknown symbol “${identifier}”. Use only h and g.`);
    }
  }
  const translated = source.replace(/\bh\b/g, "ux").replace(/\bg\b/g, "data");
  const compiled = compileEnergyExpression(translated);
  return {
    source,
    cppExpression: compiled.cppExpression.replace(/\bux\b/g, "h").replace(/\bdata\b/g, "g"),
    evaluate(height, gravity) {
      const jet = compiled.evaluate({
        ux: height,
        uy: 0,
        tx: 0,
        ty: 0,
        data: gravity,
        unit: 0,
        length: 1,
      });
      return {
        value: jet.value,
        derivative: jet.gradient[0],
        secondDerivative: jet.hessian[0][0],
      };
    },
  };
}

export function generateTinyAdHeightEnergy(source: string): string {
  const compiled = compileHeightEnergy(source);
  return `template <typename Scalar>\nScalar water_height_energy(const Scalar& h, const double g) {\n  return ${compiled.cppExpression};\n}\n`;
}
