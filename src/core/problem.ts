export const PROBLEM_SCHEMA = "geometry-lab/problem@1" as const;

export interface MassSpringProblem {
  schema: typeof PROBLEM_SCHEMA;
  name: string;
  kernel: "mass-spring";
  parameters: {
    gridSize: number;
    restLength: number;
    springWeight: number;
    pinWeight: number;
    jitter: number;
    seed: number;
  };
  solver: {
    iterationsPerStep: number;
  };
}

export interface HodgeDecompositionProblem {
  schema: typeof PROBLEM_SCHEMA;
  name: string;
  kernel: "hodge-1form";
  parameters: {
    gridSize: number;
    exactStrength: number;
    coexactStrength: number;
    harmonicX: number;
    harmonicY: number;
    noise: number;
    seed: number;
    representation: "edge" | "vertex";
  };
  solver: {
    iterationsPerStep: number;
  };
}

export interface FaceHodgeDecompositionProblem {
  schema: typeof PROBLEM_SCHEMA;
  name: string;
  kernel: "hodge-face";
  parameters: {
    gridSize: number;
    exactStrength: number;
    coexactStrength: number;
    harmonicX: number;
    harmonicY: number;
    noise: number;
    seed: number;
  };
  solver: {
    iterationsPerStep: number;
  };
}

export interface VertexFieldProblem {
  schema: typeof PROBLEM_SCHEMA;
  name: string;
  kernel: "vertex-field";
  parameters: {
    gridSize: number;
    initializationNoise: number;
    seed: number;
    objective: {
      dataWeight: number;
      connectionSmoothnessWeight: number;
      lengthWeight: number;
      targetLength: number;
    };
  };
  solver: {
    iterationsPerStep: number;
  };
}

export type Problem =
  | MassSpringProblem
  | HodgeDecompositionProblem
  | FaceHodgeDecompositionProblem
  | VertexFieldProblem;

export interface Tutorial {
  id: string;
  title: string;
  question: string;
  problem: Problem;
}

function finiteNumber(value: unknown, label: string, min: number, max: number): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new Error(`${label} must be between ${min} and ${max}.`);
  }
  return number;
}

export function validateProblem(value: unknown): Problem {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("A problem must be a JSON object.");
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.schema !== PROBLEM_SCHEMA) throw new Error(`schema must be ${PROBLEM_SCHEMA}.`);
  if (typeof candidate.name !== "string" || candidate.name.trim() === "") {
    throw new Error("name must be a non-empty string.");
  }
  if (
    candidate.kernel !== "mass-spring" &&
    candidate.kernel !== "hodge-1form" &&
    candidate.kernel !== "hodge-face" &&
    candidate.kernel !== "vertex-field"
  ) {
    throw new Error(`Unknown kernel ${String(candidate.kernel)}.`);
  }
  if (!candidate.parameters || typeof candidate.parameters !== "object") {
    throw new Error("parameters must be an object.");
  }
  if (!candidate.solver || typeof candidate.solver !== "object") {
    throw new Error("solver must be an object.");
  }
  const parameters = candidate.parameters as Record<string, unknown>;
  const solver = candidate.solver as Record<string, unknown>;
  const iterationsPerStep = Math.round(
    finiteNumber(solver.iterationsPerStep, "iterationsPerStep", 1, 20),
  );
  if (candidate.kernel === "vertex-field") {
    if (!parameters.objective || typeof parameters.objective !== "object") {
      throw new Error("parameters.objective must be an object.");
    }
    const objective = parameters.objective as Record<string, unknown>;
    const dataWeight = finiteNumber(objective.dataWeight, "objective.dataWeight", 0, 1e8);
    const connectionSmoothnessWeight = finiteNumber(
      objective.connectionSmoothnessWeight,
      "objective.connectionSmoothnessWeight",
      0,
      1e8,
    );
    const lengthWeight = finiteNumber(objective.lengthWeight, "objective.lengthWeight", 0, 1e8);
    if (dataWeight === 0 && connectionSmoothnessWeight === 0 && lengthWeight === 0) {
      throw new Error("At least one objective term must have positive weight.");
    }
    return {
      schema: PROBLEM_SCHEMA,
      name: candidate.name.trim(),
      kernel: "vertex-field",
      parameters: {
        gridSize: Math.round(finiteNumber(parameters.gridSize, "gridSize", 4, 48)),
        initializationNoise: finiteNumber(
          parameters.initializationNoise,
          "initializationNoise",
          0,
          100,
        ),
        seed: Math.round(finiteNumber(parameters.seed, "seed", 1, 2_147_483_647)),
        objective: {
          dataWeight,
          connectionSmoothnessWeight,
          lengthWeight,
          targetLength: finiteNumber(objective.targetLength, "objective.targetLength", 0, 100),
        },
      },
      solver: { iterationsPerStep },
    };
  }
  if (candidate.kernel === "hodge-1form" || candidate.kernel === "hodge-face") {
    const sharedParameters = {
      gridSize: Math.round(finiteNumber(parameters.gridSize, "gridSize", 4, 48)),
      exactStrength: finiteNumber(parameters.exactStrength, "exactStrength", -100, 100),
      coexactStrength: finiteNumber(parameters.coexactStrength, "coexactStrength", -100, 100),
      harmonicX: finiteNumber(parameters.harmonicX, "harmonicX", -100, 100),
      harmonicY: finiteNumber(parameters.harmonicY, "harmonicY", -100, 100),
      noise: finiteNumber(parameters.noise, "noise", 0, 100),
      seed: Math.round(finiteNumber(parameters.seed, "seed", 1, 2_147_483_647)),
    };
    if (candidate.kernel === "hodge-face") {
      return {
        schema: PROBLEM_SCHEMA,
        name: candidate.name.trim(),
        kernel: "hodge-face",
        parameters: sharedParameters,
        solver: { iterationsPerStep },
      };
    }
    return {
      schema: PROBLEM_SCHEMA,
      name: candidate.name.trim(),
      kernel: "hodge-1form",
      parameters: {
        ...sharedParameters,
        representation: parameters.representation === "vertex" ? "vertex" : "edge",
      },
      solver: { iterationsPerStep },
    };
  }
  return {
    schema: PROBLEM_SCHEMA,
    name: candidate.name.trim(),
    kernel: "mass-spring",
    parameters: {
      gridSize: Math.round(finiteNumber(parameters.gridSize, "gridSize", 2, 128)),
      restLength: finiteNumber(parameters.restLength, "restLength", 1e-6, 100),
      springWeight: finiteNumber(parameters.springWeight, "springWeight", 1e-8, 1e8),
      pinWeight: finiteNumber(parameters.pinWeight, "pinWeight", 1e-8, 1e10),
      jitter: finiteNumber(parameters.jitter, "jitter", 0, 100),
      seed: Math.round(finiteNumber(parameters.seed, "seed", 1, 2_147_483_647)),
    },
    solver: {
      iterationsPerStep,
    },
  };
}

export function parseProblem(source: string): Problem {
  try {
    return validateProblem(JSON.parse(source));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`Invalid JSON: ${error.message}`);
    throw error;
  }
}

export function formatProblem(problem: Problem): string {
  return `${JSON.stringify(validateProblem(problem), null, 2)}\n`;
}

export const TUTORIALS: readonly Tutorial[] = [
  {
    id: "first-newton-step",
    title: "01 · First Newton step",
    question: "How sparse is the Hessian of a local spring energy?",
    problem: validateProblem({
      schema: PROBLEM_SCHEMA,
      name: "First Newton step",
      kernel: "mass-spring",
      parameters: {
        gridSize: 12,
        restLength: 1,
        springWeight: 1,
        pinWeight: 1000,
        jitter: 0.65,
        seed: 17,
      },
      solver: { iterationsPerStep: 1 },
    }),
  },
  {
    id: "soft-constraints",
    title: "02 · Soft constraints",
    question: "What changes when the boundary penalty competes with the springs?",
    problem: validateProblem({
      schema: PROBLEM_SCHEMA,
      name: "Soft corner constraints",
      kernel: "mass-spring",
      parameters: {
        gridSize: 18,
        restLength: 1,
        springWeight: 1,
        pinWeight: 12,
        jitter: 1.2,
        seed: 29,
      },
      solver: { iterationsPerStep: 1 },
    }),
  },
  {
    id: "sparsity-scaling",
    title: "03 · Sparsity scaling",
    question: "How do degrees of freedom and Hessian nonzeros grow with resolution?",
    problem: validateProblem({
      schema: PROBLEM_SCHEMA,
      name: "Sparse scaling study",
      kernel: "mass-spring",
      parameters: {
        gridSize: 30,
        restLength: 1,
        springWeight: 2,
        pinWeight: 1500,
        jitter: 0.9,
        seed: 41,
      },
      solver: { iterationsPerStep: 1 },
    }),
  },
  {
    id: "hodge-face",
    title: "04 · Face fields",
    question: "Why must a face-field split mix vertex and edge scalar potentials?",
    problem: validateProblem({
      schema: PROBLEM_SCHEMA,
      name: "Mixed-FEM Hodge decomposition of a face field",
      kernel: "hodge-face",
      parameters: {
        gridSize: 14,
        exactStrength: 1.2,
        coexactStrength: 0.8,
        harmonicX: 1.4,
        harmonicY: -0.7,
        noise: 0,
        seed: 17,
      },
      solver: { iterationsPerStep: 1 },
    }),
  },
  {
    id: "hodge-one-form",
    title: "05 · Edge 1-forms",
    question: "How does DEC make closed, co-closed, and harmonic pieces exact?",
    problem: validateProblem({
      schema: PROBLEM_SCHEMA,
      name: "Hodge decomposition on a flat torus",
      kernel: "hodge-1form",
      parameters: {
        gridSize: 14,
        exactStrength: 1.2,
        coexactStrength: 0.8,
        harmonicX: 1.4,
        harmonicY: -0.7,
        noise: 0,
        seed: 17,
        representation: "edge",
      },
      solver: { iterationsPerStep: 1 },
    }),
  },
  {
    id: "hodge-vertex",
    title: "06 · Vertex fields",
    question: "What survives when an edge 1-form is reconstructed at vertices—and what does not?",
    problem: validateProblem({
      schema: PROBLEM_SCHEMA,
      name: "Vertex reconstruction and the missing Hodge complex",
      kernel: "hodge-1form",
      parameters: {
        gridSize: 14,
        exactStrength: 1.2,
        coexactStrength: 0.8,
        harmonicX: 1.4,
        harmonicY: -0.7,
        noise: 0,
        seed: 17,
        representation: "vertex",
      },
      solver: { iterationsPerStep: 1 },
    }),
  },
  {
    id: "vertex-field-objective",
    title: "07 · Vertex objective",
    question: "Can the browser assemble a new per-vertex TinyAD energy without rebuilding Wasm?",
    problem: validateProblem({
      schema: PROBLEM_SCHEMA,
      name: "Editable vertex tangent-field objective",
      kernel: "vertex-field",
      parameters: {
        gridSize: 16,
        initializationNoise: 0.18,
        seed: 17,
        objective: {
          dataWeight: 1,
          connectionSmoothnessWeight: 0.35,
          lengthWeight: 0.08,
          targetLength: 0.85,
        },
      },
      solver: { iterationsPerStep: 4 },
    }),
  },
] as const;
