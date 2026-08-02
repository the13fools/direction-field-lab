import { compileEnergyExpression, DEFAULT_UNIT_ENERGY } from "./energy-expression";

export const ELEMENT_PROGRAM_SCHEMA = "geometry-lab/element-program@1" as const;

export type VertexTargetKind = "rotating" | "constant" | "gradient-wave" | "handles";

export interface VertexTargetHandle {
  position: [number, number];
  vector: [number, number];
}

export interface VertexExpressionTerm {
  id: string;
  domain: "vertex";
  kind: "expression";
  expression: string;
}

export interface ConnectionDifferenceTerm {
  id: string;
  domain: "edge";
  kind: "connection-difference";
  weight: "smoothnessWeight";
}

export interface TriangleCirculationTerm {
  id: string;
  domain: "face";
  kind: "triangle-circulation";
  weight: "integrabilityWeight";
}

export type VertexElementTerm =
  | VertexExpressionTerm
  | ConnectionDifferenceTerm
  | TriangleCirculationTerm;

export interface VertexElementProgram {
  schema: typeof ELEMENT_PROGRAM_SCHEMA;
  id: string;
  name: string;
  description: string;
  mesh: {
    kind: "triangular-grid";
    gridSize: number;
  };
  unknown: {
    id: "u";
    association: "vertex";
    dimension: 2;
    frame: "tangent";
  };
  target: {
    kind: VertexTargetKind;
    dataSupport: "field" | "handles";
    handles?: VertexTargetHandle[];
  };
  parameters: {
    dataWeight: number;
    unitWeight: number;
    targetLength: number;
    smoothnessWeight: number;
    integrabilityWeight: number;
  };
  terms: VertexElementTerm[];
  solver: {
    kind: "damped-sparse-newton";
    iterationsPerStep: number;
  };
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function finite(value: unknown, label: string, minimum: number, maximum: number): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}.`);
  }
  return number;
}

function validateTerm(value: unknown, index: number): VertexElementTerm {
  const candidate = record(value, `terms[${index}]`);
  const id = text(candidate.id, `terms[${index}].id`);
  if (candidate.kind === "expression" && candidate.domain === "vertex") {
    const expression = text(candidate.expression, `${id}.expression`);
    compileEnergyExpression(expression);
    return { id, kind: "expression", domain: "vertex", expression };
  }
  if (candidate.kind === "connection-difference" && candidate.domain === "edge") {
    if (candidate.weight !== "smoothnessWeight") {
      throw new Error(`${id}.weight must be smoothnessWeight.`);
    }
    return { id, kind: "connection-difference", domain: "edge", weight: "smoothnessWeight" };
  }
  if (candidate.kind === "triangle-circulation" && candidate.domain === "face") {
    if (candidate.weight !== "integrabilityWeight") {
      throw new Error(`${id}.weight must be integrabilityWeight.`);
    }
    return { id, kind: "triangle-circulation", domain: "face", weight: "integrabilityWeight" };
  }
  throw new Error(
    `${id} must be a vertex expression, edge connection-difference, or face triangle-circulation term.`,
  );
}

export function validateElementProgram(value: unknown): VertexElementProgram {
  const candidate = record(value, "Element program");
  if (candidate.schema !== ELEMENT_PROGRAM_SCHEMA) {
    throw new Error(`schema must be ${ELEMENT_PROGRAM_SCHEMA}.`);
  }
  const id = text(candidate.id, "id");
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(id)) {
    throw new Error("id must contain lowercase letters, numbers, and hyphens.");
  }
  const mesh = record(candidate.mesh, "mesh");
  if (mesh.kind !== "triangular-grid") throw new Error("mesh.kind must be triangular-grid.");
  const unknown = record(candidate.unknown, "unknown");
  if (
    unknown.id !== "u" || unknown.association !== "vertex" ||
    unknown.dimension !== 2 || unknown.frame !== "tangent"
  ) {
    throw new Error("unknown must be the two-dimensional vertex tangent field u.");
  }
  const target = record(candidate.target, "target");
  if (
    target.kind !== "rotating" && target.kind !== "constant" &&
    target.kind !== "gradient-wave" && target.kind !== "handles"
  ) {
    throw new Error("target.kind must be rotating, constant, gradient-wave, or handles.");
  }
  const dataSupport = target.dataSupport === "handles" ? "handles" : "field";
  let handles: VertexTargetHandle[] | undefined;
  if (target.kind === "handles") {
    if (!Array.isArray(target.handles) || target.handles.length < 2 || target.handles.length > 24) {
      throw new Error("target.handles must contain 2 through 24 arrow handles.");
    }
    handles = target.handles.map((value, index) => {
      const handle = record(value, `target.handles[${index}]`);
      if (!Array.isArray(handle.position) || handle.position.length !== 2) {
        throw new Error(`target.handles[${index}].position must contain x and y.`);
      }
      if (!Array.isArray(handle.vector) || handle.vector.length !== 2) {
        throw new Error(`target.handles[${index}].vector must contain x and y.`);
      }
      const position: [number, number] = [
        finite(handle.position[0], `target.handles[${index}].position[0]`, -1, 1),
        finite(handle.position[1], `target.handles[${index}].position[1]`, -1, 1),
      ];
      const vector: [number, number] = [
        finite(handle.vector[0], `target.handles[${index}].vector[0]`, -100, 100),
        finite(handle.vector[1], `target.handles[${index}].vector[1]`, -100, 100),
      ];
      if (Math.hypot(...vector) < 1e-8) throw new Error(`target.handles[${index}].vector cannot be zero.`);
      return { position, vector };
    });
  }
  const parameters = record(candidate.parameters, "parameters");
  if (!Array.isArray(candidate.terms)) throw new Error("terms must be an array.");
  const terms = candidate.terms.map(validateTerm);
  const ids = new Set(terms.map((term) => term.id));
  if (ids.size !== terms.length) throw new Error("Every term id must be unique.");
  for (const kind of ["expression", "connection-difference", "triangle-circulation"] as const) {
    if (terms.filter((term) => term.kind === kind).length !== 1) {
      throw new Error(`terms must contain exactly one ${kind} term.`);
    }
  }
  const solver = record(candidate.solver, "solver");
  if (solver.kind !== "damped-sparse-newton") {
    throw new Error("solver.kind must be damped-sparse-newton.");
  }
  return {
    schema: ELEMENT_PROGRAM_SCHEMA,
    id,
    name: text(candidate.name, "name"),
    description: text(candidate.description, "description"),
    mesh: {
      kind: "triangular-grid",
      gridSize: Math.round(finite(mesh.gridSize, "mesh.gridSize", 5, 25)),
    },
    unknown: { id: "u", association: "vertex", dimension: 2, frame: "tangent" },
    target: { kind: target.kind, dataSupport, ...(handles ? { handles } : {}) },
    parameters: {
      dataWeight: finite(parameters.dataWeight, "parameters.dataWeight", 0, 1e6),
      unitWeight: finite(parameters.unitWeight, "parameters.unitWeight", 0, 1e6),
      targetLength: finite(parameters.targetLength, "parameters.targetLength", 0.01, 100),
      smoothnessWeight: finite(parameters.smoothnessWeight, "parameters.smoothnessWeight", 0, 1e6),
      integrabilityWeight: finite(
        parameters.integrabilityWeight,
        "parameters.integrabilityWeight",
        0,
        1e6,
      ),
    },
    terms,
    solver: {
      kind: "damped-sparse-newton",
      iterationsPerStep: Math.round(
        finite(solver.iterationsPerStep, "solver.iterationsPerStep", 1, 50),
      ),
    },
  };
}

export function expressionTerm(program: VertexElementProgram): VertexExpressionTerm {
  return program.terms.find((term): term is VertexExpressionTerm => term.kind === "expression")!;
}

export function parseElementProgram(source: string): VertexElementProgram {
  try {
    return validateElementProgram(JSON.parse(source));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`Invalid element-program JSON: ${error.message}`);
    throw error;
  }
}

export function formatElementProgram(program: VertexElementProgram): string {
  return `${JSON.stringify(validateElementProgram(program), null, 2)}\n`;
}

export const DEFAULT_ELEMENT_PROGRAM: VertexElementProgram = validateElementProgram({
  schema: ELEMENT_PROGRAM_SCHEMA,
  id: "integrable-unit-vertex-field",
  name: "Integrable, as unit as possible",
  description: "A rotating vertex tangent field balanced against unit norm and triangle circulation.",
  mesh: { kind: "triangular-grid", gridSize: 11 },
  unknown: { id: "u", association: "vertex", dimension: 2, frame: "tangent" },
  target: { kind: "rotating", dataSupport: "field" },
  parameters: {
    dataWeight: 0.35,
    unitWeight: 6,
    targetLength: 1,
    smoothnessWeight: 0.15,
    integrabilityWeight: 15,
  },
  terms: [
    { id: "fit-and-unit", domain: "vertex", kind: "expression", expression: DEFAULT_UNIT_ENERGY },
    { id: "connection-smoothing", domain: "edge", kind: "connection-difference", weight: "smoothnessWeight" },
    { id: "local-integrability", domain: "face", kind: "triangle-circulation", weight: "integrabilityWeight" },
  ],
  solver: { kind: "damped-sparse-newton", iterationsPerStep: 1 },
});
