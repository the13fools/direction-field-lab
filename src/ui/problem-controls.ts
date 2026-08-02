import { validateProblem, type Problem } from "../core/problem";

export interface ProblemControlOption {
  label: string;
  value: string;
}

export interface ProblemControl {
  path: readonly string[];
  label: string;
  description: string;
  kind: "number" | "select";
  min?: number;
  max?: number;
  step?: number;
  options?: readonly ProblemControlOption[];
}

export interface ProblemControlGroup {
  title: string;
  controls: readonly ProblemControl[];
}

const numberControl = (
  path: readonly string[],
  label: string,
  description: string,
  min: number,
  max: number,
  step: number,
): ProblemControl => ({ path, label, description, kind: "number", min, max, step });

export function controlsForProblem(problem: Problem): readonly ProblemControlGroup[] {
  const solver: ProblemControlGroup = {
    title: "Solver step",
    controls: [
      numberControl(
        ["solver", "iterationsPerStep"],
        "Iterations per click",
        "How much work the Step or Optimize button performs.",
        1,
        20,
        1,
      ),
    ],
  };

  if (problem.kernel === "mass-spring") {
    return [
      {
        title: "Grid",
        controls: [
          numberControl(["parameters", "gridSize"], "Grid size", "Vertices along one side.", 4, 48, 1),
          numberControl(["parameters", "restLength"], "Rest length", "Preferred spring length.", 0.05, 4, 0.05),
          numberControl(["parameters", "jitter"], "Initial jitter", "Random displacement in the starting state.", 0, 2, 0.01),
          numberControl(["parameters", "seed"], "Random seed", "Reproduces the same perturbation.", 1, 2147483647, 1),
        ],
      },
      {
        title: "Energy weights",
        controls: [
          numberControl(["parameters", "springWeight"], "Spring", "Strength of every edge-length residual.", 0, 10000, 0.05),
          numberControl(["parameters", "pinWeight"], "Pins", "Strength of positional anchors.", 0, 100000, 1),
        ],
      },
      solver,
    ];
  }

  if (problem.kernel === "hodge-face" || problem.kernel === "hodge-1form") {
    const representation: ProblemControl[] = problem.kernel === "hodge-1form"
      ? [{
          path: ["parameters", "representation"],
          label: "Displayed representation",
          description: "Keep the solve on edges; choose how the result is drawn.",
          kind: "select",
          options: [
            { label: "Edge integrals", value: "edge" },
            { label: "Vertex reconstruction", value: "vertex" },
          ],
        }]
      : [];
    return [
      {
        title: "Manufactured field",
        controls: [
          numberControl(["parameters", "exactStrength"], "Exact strength", "Amplitude of the known gradient component.", -10, 10, 0.05),
          numberControl(["parameters", "coexactStrength"], "Coexact strength", "Amplitude of the known rotated-gradient component.", -10, 10, 0.05),
          numberControl(["parameters", "harmonicX"], "Harmonic x", "First global torus period.", -10, 10, 0.05),
          numberControl(["parameters", "harmonicY"], "Harmonic y", "Second global torus period.", -10, 10, 0.05),
          numberControl(["parameters", "noise"], "Noise", "Adds a reproducible non-Hodge perturbation.", 0, 5, 0.01),
        ],
      },
      {
        title: "Discretization",
        controls: [
          numberControl(["parameters", "gridSize"], "Grid size", "Periodic samples along each torus direction.", 4, 48, 1),
          numberControl(["parameters", "seed"], "Random seed", "Controls only the noise realization.", 1, 2147483647, 1),
          ...representation,
        ],
      },
      solver,
    ];
  }

  return [
    {
      title: "Field",
      controls: [
        numberControl(["parameters", "gridSize"], "Grid size", "Vertex samples along each torus direction.", 4, 48, 1),
        numberControl(["parameters", "initializationNoise"], "Initial noise", "Perturbs the starting tangent vectors.", 0, 5, 0.01),
        numberControl(["parameters", "seed"], "Random seed", "Reproduces the same starting field.", 1, 2147483647, 1),
      ],
    },
    {
      title: "Objective weights",
      controls: [
        numberControl(["parameters", "objective", "dataWeight"], "Data fitting", "Stays near the manufactured target.", 0, 10000, 0.05),
        numberControl(["parameters", "objective", "connectionSmoothnessWeight"], "Connection smoothness", "Compares transported neighboring vectors.", 0, 10000, 0.05),
        numberControl(["parameters", "objective", "integrabilityWeight"], "Triangle circulation", "Penalizes local curl around primal faces.", 0, 10000, 0.05),
        numberControl(["parameters", "objective", "lengthWeight"], "Unit-length penalty", "Penalizes the squared norm residual.", 0, 10000, 0.05),
        numberControl(["parameters", "objective", "targetLength"], "Target length", "Preferred vector magnitude for the quartic term.", 0, 10, 0.01),
      ],
    },
    solver,
  ];
}

export function problemControlValue(
  problem: Problem,
  path: readonly string[],
): number | string {
  let value: unknown = problem;
  for (const key of path) value = (value as Record<string, unknown>)[key];
  if (typeof value !== "number" && typeof value !== "string") {
    throw new Error(`Control ${path.join(".")} does not resolve to a scalar.`);
  }
  return value;
}

export function updateProblemControl(
  problem: Problem,
  path: readonly string[],
  value: number | string,
): Problem {
  const draft = JSON.parse(JSON.stringify(problem)) as Record<string, unknown>;
  let parent = draft;
  for (const key of path.slice(0, -1)) {
    parent = parent[key] as Record<string, unknown>;
  }
  parent[path[path.length - 1]!] = value;
  return validateProblem(draft);
}
