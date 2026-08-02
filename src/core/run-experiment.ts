import { validateExperimentSpec, type ExperimentSpec } from "./experiment";
import type { ResultArtifact } from "./result";
import { runVertexCurlSpec, VERTEX_CURL_OPERATORS } from "../experiments/vertex-curl-adapter";

const VERTEX_CURL_OPERATOR_SET = new Set<string>(VERTEX_CURL_OPERATORS);

export function requestedExperimentOperators(spec: ExperimentSpec): string[] {
  return [
    spec.inputs.mesh.operator,
    ...(spec.inputs.field ? [spec.inputs.field.operator] : []),
    ...spec.methods.map((method) => method.operator),
  ];
}

export function canRunVertexCurlExperiment(spec: ExperimentSpec): boolean {
  const requested = requestedExperimentOperators(spec);
  return requested.includes("mesh.torus-grid")
    && requested.includes("field.analytic-torus")
    && requested.every((operator) => VERTEX_CURL_OPERATOR_SET.has(operator));
}

export function runExperiment(value: unknown, presetId?: string): ResultArtifact {
  const spec = validateExperimentSpec(value);
  if (canRunVertexCurlExperiment(spec)) return runVertexCurlSpec(spec, presetId).result;
  throw new Error(`No runtime adapter accepts experiment ${spec.id}.`);
}
