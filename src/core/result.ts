import type { JsonObject } from "./experiment";

export const RESULT_SCHEMA = "geometry-lab/result@2" as const;

export type NumericArray =
  | number[]
  | Float32Array
  | Float64Array
  | Int32Array
  | Uint32Array;

export type FieldAssociation = "vertex" | "edge" | "face" | "dual-cell";
export type FieldValueType = "scalar" | "vector" | "one-form";
export type FieldFrame = "ambient" | "local-tangent" | "oriented-edge";

export interface MeshArtifact {
  id: string;
  positions: NumericArray;
  faces?: NumericArray;
  edges?: NumericArray;
  normals?: NumericArray;
}

export interface FieldArtifact {
  id: string;
  meshId: string;
  association: FieldAssociation;
  valueType: FieldValueType;
  frame: FieldFrame;
  components: number;
  values: NumericArray;
  basisX?: NumericArray;
  basisY?: NumericArray;
  orientations?: NumericArray;
}

export interface MetricArtifact {
  id: string;
  value: number;
  unit?: string;
}

export interface SeriesArtifact {
  id: string;
  x: NumericArray;
  y: NumericArray;
  xLabel?: string;
  yLabel?: string;
}

export interface ResultMessage {
  level: "info" | "warning" | "error";
  code: string;
  text: string;
}

export interface ResultArtifact {
  schema: typeof RESULT_SCHEMA;
  experimentId: string;
  status: "complete" | "partial" | "failed";
  meshes: MeshArtifact[];
  fields: FieldArtifact[];
  metrics: MetricArtifact[];
  series: SeriesArtifact[];
  messages: ResultMessage[];
  provenance: {
    applicationVersion: string;
    backendBundles: Record<string, string>;
    experiment: JsonObject;
  };
}

function isNumericArray(value: unknown): value is NumericArray {
  if (Array.isArray(value)) return value.every((entry) => Number.isFinite(entry));
  return (
    value instanceof Float32Array ||
    value instanceof Float64Array ||
    value instanceof Int32Array ||
    value instanceof Uint32Array
  );
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function indices(value: NumericArray, stride: number, vertexCount: number, label: string): void {
  if (value.length % stride !== 0) throw new Error(`${label} length must be divisible by ${stride}.`);
  for (const index of value) {
    if (!Number.isInteger(index) || index < 0 || index >= vertexCount) {
      throw new Error(`${label} contains an index outside its mesh.`);
    }
  }
}

export function validateResultArtifact(value: unknown): ResultArtifact {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("A result artifact must be an object.");
  }
  const candidate = value as ResultArtifact;
  if (candidate.schema !== RESULT_SCHEMA) throw new Error(`schema must be ${RESULT_SCHEMA}.`);
  string(candidate.experimentId, "experimentId");
  if (!["complete", "partial", "failed"].includes(candidate.status)) {
    throw new Error("status must be complete, partial, or failed.");
  }
  if (!Array.isArray(candidate.meshes)) throw new Error("meshes must be an array.");
  const meshCounts = new Map<string, { vertex: number; edge: number; face: number }>();
  for (const [meshIndex, mesh] of candidate.meshes.entries()) {
    const id = string(mesh.id, `meshes[${meshIndex}].id`);
    if (meshCounts.has(id)) throw new Error(`Duplicate mesh id ${id}.`);
    if (!isNumericArray(mesh.positions) || mesh.positions.length % 3 !== 0) {
      throw new Error(`meshes[${meshIndex}].positions must be a flat xyz numeric array.`);
    }
    const vertexCount = mesh.positions.length / 3;
    if (mesh.normals !== undefined) {
      if (!isNumericArray(mesh.normals) || mesh.normals.length !== mesh.positions.length) {
        throw new Error(`meshes[${meshIndex}].normals must match positions.`);
      }
    }
    let edgeCount = 0;
    if (mesh.edges !== undefined) {
      if (!isNumericArray(mesh.edges)) throw new Error(`meshes[${meshIndex}].edges must be numeric.`);
      indices(mesh.edges, 2, vertexCount, `meshes[${meshIndex}].edges`);
      edgeCount = mesh.edges.length / 2;
    }
    let faceCount = 0;
    if (mesh.faces !== undefined) {
      if (!isNumericArray(mesh.faces)) throw new Error(`meshes[${meshIndex}].faces must be numeric.`);
      indices(mesh.faces, 3, vertexCount, `meshes[${meshIndex}].faces`);
      faceCount = mesh.faces.length / 3;
    }
    meshCounts.set(id, { vertex: vertexCount, edge: edgeCount, face: faceCount });
  }

  if (!Array.isArray(candidate.fields)) throw new Error("fields must be an array.");
  const fieldIds = new Set<string>();
  for (const [fieldIndex, field] of candidate.fields.entries()) {
    const id = string(field.id, `fields[${fieldIndex}].id`);
    if (fieldIds.has(id)) throw new Error(`Duplicate field id ${id}.`);
    fieldIds.add(id);
    const counts = meshCounts.get(field.meshId);
    if (!counts) throw new Error(`fields[${fieldIndex}] refers to unknown mesh ${field.meshId}.`);
    if (!["vertex", "edge", "face", "dual-cell"].includes(field.association)) {
      throw new Error(`fields[${fieldIndex}] has an unknown association.`);
    }
    if (!["scalar", "vector", "one-form"].includes(field.valueType)) {
      throw new Error(`fields[${fieldIndex}] has an unknown valueType.`);
    }
    if (!["ambient", "local-tangent", "oriented-edge"].includes(field.frame)) {
      throw new Error(`fields[${fieldIndex}] has an unknown frame.`);
    }
    if (!Number.isInteger(field.components) || field.components < 1 || field.components > 4) {
      throw new Error(`fields[${fieldIndex}].components must be an integer from 1 to 4.`);
    }
    if (!isNumericArray(field.values)) {
      throw new Error(`fields[${fieldIndex}].values must be numeric.`);
    }
    const entityCount =
      field.association === "dual-cell" ? counts.vertex : counts[field.association];
    if (field.values.length !== entityCount * field.components) {
      throw new Error(`fields[${fieldIndex}].values does not match its mesh association.`);
    }
    if (field.frame === "local-tangent") {
      if (field.components !== 2) {
        throw new Error(`fields[${fieldIndex}] local-tangent values must have 2 components.`);
      }
      if (
        !isNumericArray(field.basisX) ||
        !isNumericArray(field.basisY) ||
        field.basisX.length !== entityCount * 3 ||
        field.basisY.length !== entityCount * 3
      ) {
        throw new Error(`fields[${fieldIndex}] requires two ambient tangent basis arrays.`);
      }
    }
    if (field.frame === "oriented-edge") {
      if (
        field.association !== "edge" ||
        field.valueType !== "one-form" ||
        field.components !== 1 ||
        !isNumericArray(field.orientations) ||
        field.orientations.length !== entityCount
      ) {
        throw new Error(
          `fields[${fieldIndex}] oriented-edge data requires one value and orientation per edge.`,
        );
      }
      for (const orientation of field.orientations) {
        if (orientation !== 0 && orientation !== 1) {
          throw new Error(`fields[${fieldIndex}].orientations must contain only 0 or 1.`);
        }
      }
    }
  }

  if (!Array.isArray(candidate.metrics)) throw new Error("metrics must be an array.");
  for (const [metricIndex, metric] of candidate.metrics.entries()) {
    string(metric.id, `metrics[${metricIndex}].id`);
    if (!Number.isFinite(metric.value)) throw new Error(`metrics[${metricIndex}].value must be finite.`);
  }
  if (!Array.isArray(candidate.series)) throw new Error("series must be an array.");
  for (const [seriesIndex, series] of candidate.series.entries()) {
    string(series.id, `series[${seriesIndex}].id`);
    if (!isNumericArray(series.x) || !isNumericArray(series.y) || series.x.length !== series.y.length) {
      throw new Error(`series[${seriesIndex}] must have numeric x/y arrays of equal length.`);
    }
  }
  if (!Array.isArray(candidate.messages)) throw new Error("messages must be an array.");
  for (const [messageIndex, message] of candidate.messages.entries()) {
    if (!["info", "warning", "error"].includes(message.level)) {
      throw new Error(`messages[${messageIndex}] has an unknown level.`);
    }
    string(message.code, `messages[${messageIndex}].code`);
    string(message.text, `messages[${messageIndex}].text`);
  }
  if (!candidate.provenance || typeof candidate.provenance !== "object") {
    throw new Error("provenance must be an object.");
  }
  string(candidate.provenance.applicationVersion, "provenance.applicationVersion");
  if (
    !candidate.provenance.backendBundles ||
    typeof candidate.provenance.backendBundles !== "object" ||
    Array.isArray(candidate.provenance.backendBundles)
  ) {
    throw new Error("provenance.backendBundles must be an object.");
  }
  if (
    !candidate.provenance.experiment ||
    typeof candidate.provenance.experiment !== "object" ||
    Array.isArray(candidate.provenance.experiment)
  ) {
    throw new Error("provenance.experiment must be an object.");
  }
  return candidate;
}

export function resultTransferables(result: ResultArtifact): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>();
  const add = (value: NumericArray | undefined) => {
    if (value && !Array.isArray(value)) buffers.add(value.buffer as ArrayBuffer);
  };
  for (const mesh of result.meshes) {
    add(mesh.positions);
    add(mesh.faces);
    add(mesh.edges);
    add(mesh.normals);
  }
  for (const field of result.fields) add(field.values);
  for (const field of result.fields) {
    add(field.basisX);
    add(field.basisY);
    add(field.orientations);
  }
  for (const series of result.series) {
    add(series.x);
    add(series.y);
  }
  return [...buffers];
}
