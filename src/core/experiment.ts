export const EXPERIMENT_SCHEMA = "geometry-lab/experiment@2" as const;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

export interface OperatorInvocation {
  operator: string;
  parameters: JsonObject;
}

export interface ExperimentMethod {
  id: string;
  label: string;
  operator: string;
  parameters?: JsonObject;
}

export interface ExperimentPreset {
  id: string;
  label: string;
  overrides: JsonObject;
}

export interface ExperimentSweep {
  path: string;
  values: Array<string | number | boolean>;
}

export interface ExperimentSpec {
  schema: typeof EXPERIMENT_SCHEMA;
  id: string;
  title: string;
  question: string;
  inputs: {
    mesh: OperatorInvocation;
    field?: OperatorInvocation;
  };
  methods: ExperimentMethod[];
  sweep?: ExperimentSweep;
  metrics: string[];
  defaultPreset?: string;
  presets?: ExperimentPreset[];
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function jsonObject(value: unknown, label: string): JsonObject {
  const object = record(value, label);
  try {
    JSON.stringify(object);
  } catch {
    throw new Error(`${label} must be JSON serializable.`);
  }
  return object as JsonObject;
}

function invocation(value: unknown, label: string): OperatorInvocation {
  const object = record(value, label);
  return {
    operator: nonEmptyString(object.operator, `${label}.operator`),
    parameters: jsonObject(object.parameters ?? {}, `${label}.parameters`),
  };
}

export function validateExperimentSpec(value: unknown): ExperimentSpec {
  const candidate = record(value, "An experiment");
  if (candidate.schema !== EXPERIMENT_SCHEMA) {
    throw new Error(`schema must be ${EXPERIMENT_SCHEMA}.`);
  }
  const inputs = record(candidate.inputs, "inputs");
  if (!Array.isArray(candidate.methods) || candidate.methods.length === 0) {
    throw new Error("methods must be a non-empty array.");
  }
  const methodIds = new Set<string>();
  const methods = candidate.methods.map((entry, index) => {
    const method = record(entry, `methods[${index}]`);
    const id = nonEmptyString(method.id, `methods[${index}].id`);
    if (methodIds.has(id)) throw new Error(`Duplicate method id ${id}.`);
    methodIds.add(id);
    return {
      id,
      label: nonEmptyString(method.label, `methods[${index}].label`),
      operator: nonEmptyString(method.operator, `methods[${index}].operator`),
      ...(method.parameters === undefined
        ? {}
        : { parameters: jsonObject(method.parameters, `methods[${index}].parameters`) }),
    };
  });
  if (
    !Array.isArray(candidate.metrics) ||
    candidate.metrics.some((metric) => typeof metric !== "string" || metric === "")
  ) {
    throw new Error("metrics must be an array of non-empty strings.");
  }

  let sweep: ExperimentSweep | undefined;
  if (candidate.sweep !== undefined) {
    const source = record(candidate.sweep, "sweep");
    if (
      !Array.isArray(source.values) ||
      source.values.length === 0 ||
      source.values.some(
        (entry) =>
          typeof entry !== "string" &&
          typeof entry !== "number" &&
          typeof entry !== "boolean",
      )
    ) {
      throw new Error("sweep.values must be a non-empty scalar array.");
    }
    sweep = {
      path: nonEmptyString(source.path, "sweep.path"),
      values: source.values as Array<string | number | boolean>,
    };
  }

  let presets: ExperimentPreset[] | undefined;
  if (candidate.presets !== undefined) {
    if (!Array.isArray(candidate.presets)) throw new Error("presets must be an array.");
    const presetIds = new Set<string>();
    presets = candidate.presets.map((entry, index) => {
      const preset = record(entry, `presets[${index}]`);
      const id = nonEmptyString(preset.id, `presets[${index}].id`);
      if (presetIds.has(id)) throw new Error(`Duplicate preset id ${id}.`);
      presetIds.add(id);
      return {
        id,
        label: nonEmptyString(preset.label, `presets[${index}].label`),
        overrides: jsonObject(preset.overrides, `presets[${index}].overrides`),
      };
    });
  }

  const defaultPreset =
    candidate.defaultPreset === undefined
      ? undefined
      : nonEmptyString(candidate.defaultPreset, "defaultPreset");
  if (defaultPreset && !presets?.some((preset) => preset.id === defaultPreset)) {
    throw new Error(`defaultPreset ${defaultPreset} is not present in presets.`);
  }

  return {
    schema: EXPERIMENT_SCHEMA,
    id: nonEmptyString(candidate.id, "id"),
    title: nonEmptyString(candidate.title, "title"),
    question: nonEmptyString(candidate.question, "question"),
    inputs: {
      mesh: invocation(inputs.mesh, "inputs.mesh"),
      ...(inputs.field === undefined ? {} : { field: invocation(inputs.field, "inputs.field") }),
    },
    methods,
    ...(sweep ? { sweep } : {}),
    metrics: candidate.metrics as string[],
    ...(defaultPreset ? { defaultPreset } : {}),
    ...(presets ? { presets } : {}),
  };
}

