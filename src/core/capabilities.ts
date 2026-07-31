export const CAPABILITIES_SCHEMA = "geometry-lab/capabilities@1" as const;

export type OperatorKind =
  | "mesh-generator"
  | "field-generator"
  | "projection"
  | "optimization"
  | "measurement";

export type ArtifactKind = "curve-network" | "mesh" | "field" | "metrics" | "series";

export interface OperatorCapability {
  id: string;
  label: string;
  kind: OperatorKind;
  backendBundle: string;
  accepts: string[];
  produces: ArtifactKind[];
}

export interface CapabilityManifest {
  schema: typeof CAPABILITIES_SCHEMA;
  applicationVersion: string;
  protocolVersions: string[];
  operators: OperatorCapability[];
}

const OPERATOR_KINDS = new Set<OperatorKind>([
  "mesh-generator",
  "field-generator",
  "projection",
  "optimization",
  "measurement",
]);

const ARTIFACT_KINDS = new Set<ArtifactKind>([
  "curve-network",
  "mesh",
  "field",
  "metrics",
  "series",
]);

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry === "")) {
    throw new Error(`${label} must be an array of non-empty strings.`);
  }
  return value;
}

export function validateCapabilityManifest(value: unknown): CapabilityManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("A capability manifest must be an object.");
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.schema !== CAPABILITIES_SCHEMA) {
    throw new Error(`schema must be ${CAPABILITIES_SCHEMA}.`);
  }
  const operators = candidate.operators;
  if (!Array.isArray(operators)) throw new Error("operators must be an array.");
  const ids = new Set<string>();
  const validatedOperators = operators.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`operators[${index}] must be an object.`);
    }
    const operator = entry as Record<string, unknown>;
    const id = nonEmptyString(operator.id, `operators[${index}].id`);
    if (ids.has(id)) throw new Error(`Duplicate operator id ${id}.`);
    ids.add(id);
    if (!OPERATOR_KINDS.has(operator.kind as OperatorKind)) {
      throw new Error(`Unknown operator kind ${String(operator.kind)}.`);
    }
    if (
      !Array.isArray(operator.produces) ||
      operator.produces.some((kind) => !ARTIFACT_KINDS.has(kind as ArtifactKind))
    ) {
      throw new Error(`operators[${index}].produces contains an unknown artifact kind.`);
    }
    return {
      id,
      label: nonEmptyString(operator.label, `operators[${index}].label`),
      kind: operator.kind as OperatorKind,
      backendBundle: nonEmptyString(
        operator.backendBundle,
        `operators[${index}].backendBundle`,
      ),
      accepts: stringArray(operator.accepts, `operators[${index}].accepts`),
      produces: operator.produces as ArtifactKind[],
    };
  });
  return {
    schema: CAPABILITIES_SCHEMA,
    applicationVersion: nonEmptyString(candidate.applicationVersion, "applicationVersion"),
    protocolVersions: stringArray(candidate.protocolVersions, "protocolVersions"),
    operators: validatedOperators,
  };
}

export const BUILTIN_CAPABILITIES: CapabilityManifest = {
  schema: CAPABILITIES_SCHEMA,
  applicationVersion: "0.1.0",
  protocolVersions: ["geometry-lab/embed@1", "geometry-lab/embed@2"],
  operators: [
    {
      id: "optimization.mass-spring",
      label: "TinyAD mass–spring Newton solve",
      kind: "optimization",
      backendBundle: "gp_lab_kernels",
      accepts: ["geometry-lab/problem@1:mass-spring"],
      produces: ["curve-network", "metrics"],
    },
    {
      id: "projection.hodge-edge-dec",
      label: "DEC edge 1-form Hodge projection",
      kind: "projection",
      backendBundle: "gp_lab_kernels",
      accepts: ["geometry-lab/problem@1:hodge-1form"],
      produces: ["mesh", "field", "metrics"],
    },
    {
      id: "projection.hodge-face-mixed-fem",
      label: "Mixed-FEM face-field Hodge projection",
      kind: "projection",
      backendBundle: "gp_lab_kernels",
      accepts: ["geometry-lab/problem@1:hodge-face"],
      produces: ["mesh", "field", "metrics"],
    },
    {
      id: "optimization.vertex-tangent-tinyad",
      label: "TinyAD vertex tangent-field objective",
      kind: "optimization",
      backendBundle: "gp_lab_kernels",
      accepts: ["geometry-lab/problem@1:vertex-field"],
      produces: ["mesh", "field", "metrics"],
    },
  ],
};

