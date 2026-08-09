import { compileEnergyExpression, type CompiledEnergyExpression } from "./energy-expression";

export const DEFAULT_VECTOR_FIELD_PROGRAM = `x = vx
y = vy
z = vz`;

export interface VectorFieldProgramEnvironment {
  vx: number;
  vy: number;
  vz: number;
  x: number;
  y: number;
  z: number;
  t: number;
}

export interface CompiledVectorFieldProgram {
  source: string;
  evaluate(environment: VectorFieldProgramEnvironment): { x: number; y: number; z: number };
}

const SYMBOLS = new Set(["vx", "vy", "vz", "x", "y", "z", "t"]);
const COMPONENTS = new Set(["x", "y", "z"]);

function compileComponent(source: string): CompiledEnergyExpression {
  const identifiers = source.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
  for (const identifier of identifiers) {
    if (!SYMBOLS.has(identifier)) {
      throw new Error(`Unknown symbol “${identifier}”. Use vx, vy, vz, x, y, z, or t.`);
    }
  }
  const translated = source
    .replace(/\bvx\b/g, "ux")
    .replace(/\bvy\b/g, "uy")
    .replace(/\bvz\b/g, "tx")
    .replace(/\bx\b/g, "ty")
    .replace(/\by\b/g, "data")
    .replace(/\bz\b/g, "unit")
    .replace(/\bt\b/g, "length");
  return compileEnergyExpression(translated);
}

export function compileVectorFieldProgram(source: string): CompiledVectorFieldProgram {
  const assignments = new Map<string, CompiledEnergyExpression>();
  const lines = source.split("\n").map((line) => line.trim()).filter((line) => line !== "" && !line.startsWith("//"));
  for (const line of lines) {
    const match = /^([xyz])\s*=\s*(.+?);?$/.exec(line);
    if (!match) throw new Error(`Expected “x = …”, “y = …”, or “z = …”; received “${line}”.`);
    const component = match[1]!;
    if (!COMPONENTS.has(component) || assignments.has(component)) {
      throw new Error(`Component ${component} must be assigned exactly once.`);
    }
    assignments.set(component, compileComponent(match[2]!));
  }
  for (const component of COMPONENTS) {
    if (!assignments.has(component)) throw new Error(`Missing assignment for component ${component}.`);
  }
  return {
    source,
    evaluate(environment) {
      const values = Object.values(environment);
      if (values.some((value) => !Number.isFinite(value))) throw new Error("Vector program inputs must be finite.");
      const energyEnvironment = {
        ux: environment.vx,
        uy: environment.vy,
        tx: environment.vz,
        ty: environment.x,
        data: environment.y,
        unit: environment.z,
        length: environment.t,
      };
      return {
        x: assignments.get("x")!.evaluate(energyEnvironment).value,
        y: assignments.get("y")!.evaluate(energyEnvironment).value,
        z: assignments.get("z")!.evaluate(energyEnvironment).value,
      };
    },
  };
}
