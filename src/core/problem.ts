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

export type Problem = MassSpringProblem;

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
  if (candidate.kernel !== "mass-spring") throw new Error(`Unknown kernel ${String(candidate.kernel)}.`);
  if (typeof candidate.name !== "string" || candidate.name.trim() === "") {
    throw new Error("name must be a non-empty string.");
  }
  if (!candidate.parameters || typeof candidate.parameters !== "object") {
    throw new Error("parameters must be an object.");
  }
  if (!candidate.solver || typeof candidate.solver !== "object") {
    throw new Error("solver must be an object.");
  }
  const parameters = candidate.parameters as Record<string, unknown>;
  const solver = candidate.solver as Record<string, unknown>;
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
      iterationsPerStep: Math.round(
        finiteNumber(solver.iterationsPerStep, "iterationsPerStep", 1, 20),
      ),
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
] as const;
