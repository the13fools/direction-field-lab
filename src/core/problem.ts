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
      integrabilityWeight: number;
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

export interface TutorialSection {
  id: string;
  marker: string;
  title: string;
  description: string;
  explainer: {
    question: string;
    idea: string;
    experiment: string;
  };
  tutorialIds: string[];
  initiallyOpen?: boolean;
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
    const integrabilityWeight = finiteNumber(
      objective.integrabilityWeight ?? 0,
      "objective.integrabilityWeight",
      0,
      1e8,
    );
    const lengthWeight = finiteNumber(objective.lengthWeight, "objective.lengthWeight", 0, 1e8);
    if (
      dataWeight === 0 &&
      connectionSmoothnessWeight === 0 &&
      integrabilityWeight === 0 &&
      lengthWeight === 0
    ) {
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
          integrabilityWeight,
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
    title: "02 · Competing soft constraints",
    question: "A soft pin is another energy, not a command. Where does the optimum compromise?",
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
    question: "Double the grid width: why does sparse storage grow like n² while a dense Hessian grows like n⁴?",
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
    question: "What does the incidence complex guarantee before a metric Hodge star is chosen?",
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
    question: "How much of one compiled local energy can be recomposed from live term weights?",
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
          integrabilityWeight: 0,
          lengthWeight: 0.08,
          targetLength: 0.85,
        },
      },
      solver: { iterationsPerStep: 4 },
    }),
  },
  {
    id: "vertex-field-integrability",
    title: "08 · Vertex integrability",
    question: "Can triangle circulation vanish while a torus period remains?",
    problem: validateProblem({
      schema: PROBLEM_SCHEMA,
      name: "Vertex integrability from face circulation",
      kernel: "vertex-field",
      parameters: {
        gridSize: 16,
        initializationNoise: 0.18,
        seed: 17,
        objective: {
          dataWeight: 1,
          connectionSmoothnessWeight: 0.35,
          integrabilityWeight: 4,
          lengthWeight: 0,
          targetLength: 0.85,
        },
      },
      solver: { iterationsPerStep: 1 },
    }),
  },
  {
    id: "vertex-field-unit-integrable",
    title: "09 · Integrable + unit",
    question: "Where must a rotating target give up curl-freedom, unit length, or data fidelity?",
    problem: validateProblem({
      schema: PROBLEM_SCHEMA,
      name: "Vertex field: integrable and as unit as possible",
      kernel: "vertex-field",
      parameters: {
        gridSize: 16,
        initializationNoise: 0.18,
        seed: 17,
        objective: {
          dataWeight: 0.35,
          connectionSmoothnessWeight: 0.15,
          integrabilityWeight: 15,
          lengthWeight: 6,
          targetLength: 1,
        },
      },
      solver: { iterationsPerStep: 4 },
    }),
  },
] as const;

export const TUTORIAL_SECTIONS: readonly TutorialSection[] = [
  {
    id: "variational-foundations",
    marker: "A",
    title: "Variational foundations",
    description: "Local energies, soft constraints, and sparse assembly before geometry-specific operators.",
    explainer: {
      question: "How does a sum of tiny element energies become one global Newton system?",
      idea: "Each element sees only its local variables. Autodiff supplies a local gradient and Hessian; indexed scatter-add produces the sparse global system.",
      experiment: "Open the callback, predict its stencil, then compare DOFs and Hessian nonzeros as grid size changes.",
    },
    tutorialIds: ["first-newton-step", "soft-constraints", "sparsity-scaling"],
  },
  {
    id: "hodge-representations",
    marker: "B",
    title: "Hodge representations",
    description: "Put face vectors, edge 1-forms, and reconstructed vertex fields under the same audit.",
    explainer: {
      question: "Which facts come from oriented incidence, and which require a metric?",
      idea: "The coboundary d is topological and satisfies d² = 0. Inner products and the Hodge star introduce lengths, areas, adjoints, and the meaning of closest.",
      experiment: "Let the decomposition run, switch among its components, then change only the displayed representation and identify what no longer follows automatically.",
    },
    tutorialIds: ["hodge-face", "hodge-one-form", "hodge-vertex"],
    initiallyOpen: true,
  },
  {
    id: "integrable-projection",
    marker: "C",
    title: "Integrable projection",
    description: "Build a native vertex objective, add local circulation, then negotiate integrability with unit length.",
    explainer: {
      question: "What should integrable mean for vectors stored in different tangent planes?",
      idea: "First choose a connection or a vertex-to-edge transfer. Triangle circulation then measures local closedness; global periods and unit norm are separate conditions.",
      experiment: "Start with data fitting, turn on circulation, and only then add the unit penalty. Track which certificate improves and which objective term must yield.",
    },
    tutorialIds: ["vertex-field-objective", "vertex-field-integrability", "vertex-field-unit-integrable"],
  },
] as const;
