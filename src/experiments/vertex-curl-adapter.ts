import { BUILTIN_CAPABILITIES } from "../core/capabilities";
import {
  validateExperimentSpec,
  type ExperimentSpec,
  type JsonObject,
  type JsonValue,
} from "../core/experiment";
import { RESULT_SCHEMA, validateResultArtifact, type MetricArtifact, type ResultArtifact } from "../core/result";
import {
  runVertexCurlExperiment,
  type EdgeFamily,
  type VertexCurlExperiment,
  type VertexCurlExperimentOptions,
  type VertexFieldPreset,
} from "./vertex-curl";

export const VERTEX_CURL_OPERATORS = [
  "mesh.torus-grid",
  "field.analytic-torus",
  "curl.vertex-trapezoid-primal",
  "curl.vertex-barycentric-dual",
  "connection.endpoint-normal-rotation",
  "connection.one-ring-polar-baseline",
] as const;

const SUPPORTED_OPERATORS = new Set<string>(VERTEX_CURL_OPERATORS);
const FIELD_PRESETS = new Set<VertexFieldPreset>(["gradient", "harmonic", "vortex", "mixed"]);
const EDGE_FAMILIES = new Set<EdgeFamily>(["u", "v", "diagonal"]);

export interface VertexCurlAdapterRun {
  spec: ExperimentSpec;
  presetId?: string;
  options: Required<VertexCurlExperimentOptions>;
  experiment: VertexCurlExperiment;
  refinement: Array<{ resolution: number; experiment: VertexCurlExperiment }>;
  result: ResultArtifact;
}

function finiteParameter(
  value: JsonValue | undefined,
  fallback: number,
  label: string,
): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`);
  }
  return value;
}

function integerParameter(
  value: JsonValue | undefined,
  fallback: number,
  label: string,
): number {
  const result = finiteParameter(value, fallback, label);
  if (!Number.isInteger(result)) throw new Error(`${label} must be an integer.`);
  return result;
}

function stringParameter<T extends string>(
  value: JsonValue | undefined,
  fallback: T,
  choices: Set<T>,
  label: string,
): T {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !choices.has(value as T)) {
    throw new Error(`${label} must be one of ${[...choices].join(", ")}.`);
  }
  return value as T;
}

function selectedOverrides(spec: ExperimentSpec, presetId?: string): JsonObject {
  const selected = presetId ?? spec.defaultPreset;
  if (!selected) return {};
  const preset = spec.presets?.find((entry) => entry.id === selected);
  if (!preset) throw new Error(`Preset ${selected} is not present in the experiment.`);
  return preset.overrides;
}

function optionsFromSpec(spec: ExperimentSpec, presetId?: string): Required<VertexCurlExperimentOptions> {
  if (spec.inputs.mesh.operator !== "mesh.torus-grid") {
    throw new Error("The vertex-curl adapter requires mesh.torus-grid.");
  }
  if (spec.inputs.field?.operator !== "field.analytic-torus") {
    throw new Error("The vertex-curl adapter requires field.analytic-torus.");
  }
  const mesh = spec.inputs.mesh.parameters;
  const field = spec.inputs.field.parameters;
  const overrides = selectedOverrides(spec, presetId);
  return {
    resolution: integerParameter(overrides.resolution ?? mesh.resolution, 16, "resolution"),
    majorRadius: finiteParameter(overrides.majorRadius ?? mesh.majorRadius, 2.35, "majorRadius"),
    minorRadius: finiteParameter(overrides.minorRadius ?? mesh.minorRadius, 0.82, "minorRadius"),
    fieldPreset: stringParameter(
      overrides.fieldPreset ?? field.preset,
      "gradient",
      FIELD_PRESETS,
      "fieldPreset",
    ),
    edgeFamily: stringParameter(overrides.edgeFamily, "u", EDGE_FAMILIES, "edgeFamily"),
  };
}

function flattenVectors(values: number[][]): Float64Array {
  return new Float64Array(values.flat());
}

function flattenFaces(experiment: VertexCurlExperiment): Uint32Array {
  return new Uint32Array(experiment.mesh.faces.flatMap((face) => face.vertices));
}

function flattenEdges(experiment: VertexCurlExperiment): Uint32Array {
  return new Uint32Array(experiment.mesh.edges.flatMap((edge) => [edge.tail, edge.head]));
}

function metricValues(experiment: VertexCurlExperiment): Record<string, number> {
  return {
    "curl.primal-rms": experiment.primal.rms,
    "curl.primal-truth-error": experiment.primal.errorRms,
    "curl.dual-rms": experiment.dual.rms,
    "curl.dual-truth-error": experiment.dual.errorRms,
    "connection.extrinsic-angle-rms": experiment.connections.extrinsicRms,
    "connection.intrinsic-angle-rms": experiment.connections.intrinsicRms,
    "period.u": experiment.periods.u,
    "period.v": experiment.periods.v,
  };
}

function requestedMetrics(spec: ExperimentSpec, experiment: VertexCurlExperiment): MetricArtifact[] {
  const available = metricValues(experiment);
  return spec.metrics.map((id) => {
    const value = available[id];
    if (value === undefined) throw new Error(`The vertex-curl adapter does not produce metric ${id}.`);
    return {
      id,
      value,
      ...(id.includes("angle") ? { unit: "radian" } : {}),
    };
  });
}

function specAsJson(spec: ExperimentSpec): JsonObject {
  return JSON.parse(JSON.stringify(spec)) as JsonObject;
}

function assertMethodsSupported(spec: ExperimentSpec): void {
  const unsupported = spec.methods
    .map((method) => method.operator)
    .filter((operator) => !SUPPORTED_OPERATORS.has(operator));
  if (unsupported.length > 0) {
    throw new Error(`The vertex-curl adapter does not provide: ${[...new Set(unsupported)].join(", ")}.`);
  }
}

function buildResult(
  spec: ExperimentSpec,
  experiment: VertexCurlExperiment,
  refinement: VertexCurlAdapterRun["refinement"],
): ResultArtifact {
  const { mesh, field, primal, dual } = experiment;
  const series = spec.sweep
    ? spec.metrics.map((id) => ({
        id,
        x: new Float64Array(refinement.map((entry) => entry.resolution)),
        y: new Float64Array(refinement.map((entry) => {
          const value = metricValues(entry.experiment)[id];
          if (value === undefined) throw new Error(`The vertex-curl adapter does not produce metric ${id}.`);
          return value;
        })),
        xLabel: spec.sweep!.path,
        yLabel: id,
      }))
    : [];

  return validateResultArtifact({
    schema: RESULT_SCHEMA,
    experimentId: spec.id,
    status: "complete",
    meshes: [{
      id: "analytic-torus",
      positions: flattenVectors(mesh.vertices.map((vertex) => vertex.position)),
      normals: flattenVectors(mesh.vertices.map((vertex) => vertex.normal)),
      faces: flattenFaces(experiment),
      edges: flattenEdges(experiment),
    }],
    fields: [
      {
        id: "field.analytic-torus",
        meshId: "analytic-torus",
        association: "vertex",
        valueType: "vector",
        frame: "local-tangent",
        components: 2,
        values: flattenVectors(field.local),
        basisX: flattenVectors(mesh.vertices.map((vertex) => vertex.frameU)),
        basisY: flattenVectors(mesh.vertices.map((vertex) => vertex.frameV)),
      },
      {
        id: "curl.vertex-trapezoid-primal",
        meshId: "analytic-torus",
        association: "face",
        valueType: "scalar",
        frame: "ambient",
        components: 1,
        values: new Float64Array(primal.values),
      },
      {
        id: "curl.vertex-trapezoid-primal.truth",
        meshId: "analytic-torus",
        association: "face",
        valueType: "scalar",
        frame: "ambient",
        components: 1,
        values: new Float64Array(primal.truth),
      },
      {
        id: "curl.vertex-barycentric-dual",
        meshId: "analytic-torus",
        association: "dual-cell",
        valueType: "scalar",
        frame: "ambient",
        components: 1,
        values: new Float64Array(dual.values),
      },
      {
        id: "curl.vertex-barycentric-dual.truth",
        meshId: "analytic-torus",
        association: "dual-cell",
        valueType: "scalar",
        frame: "ambient",
        components: 1,
        values: new Float64Array(dual.truth),
      },
    ],
    metrics: requestedMetrics(spec, experiment),
    series,
    messages: [
      {
        level: "info",
        code: "representation-contract",
        text: "Primal curl lives on faces; dual curl lives on vertex-centered barycentric dual cells.",
      },
      {
        level: "warning",
        code: "intrinsic-baseline-scope",
        text: "The intrinsic method is a normalized one-ring polar-map baseline, not a canonical connection for every mesh or application.",
      },
    ],
    provenance: {
      applicationVersion: BUILTIN_CAPABILITIES.applicationVersion,
      backendBundles: { geometry_lab_experiments: "typescript-reference" },
      experiment: specAsJson(spec),
    },
  });
}

export function runVertexCurlSpec(value: unknown, presetId?: string): VertexCurlAdapterRun {
  const spec = validateExperimentSpec(value);
  assertMethodsSupported(spec);
  const options = optionsFromSpec(spec, presetId);
  const experiment = runVertexCurlExperiment(options);
  const refinement = spec.sweep
    ? spec.sweep.values.map((entry) => {
        if (typeof entry !== "number" || !Number.isInteger(entry)) {
          throw new Error("The vertex-curl resolution sweep must contain integers.");
        }
        return { resolution: entry, experiment: runVertexCurlExperiment({ ...options, resolution: entry }) };
      })
    : [];
  return { spec, ...(presetId ? { presetId } : {}), options, experiment, refinement, result: buildResult(spec, experiment, refinement) };
}

