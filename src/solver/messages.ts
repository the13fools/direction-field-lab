import type { Problem } from "../core/problem";
import type { SolverDiagnostics } from "../core/snapshot";

export interface HodgeFields {
  input: Float64Array;
  exact: Float64Array;
  coexact: Float64Array;
  harmonic: Float64Array;
  error: Float64Array;
}

export type HodgeFieldLayout =
  | "face-vector"
  | "edge-form"
  | "vertex-from-edge"
  | "vertex-vector";

export interface HodgeMetrics {
  inputNorm: number;
  exactNorm: number;
  coexactNorm: number;
  harmonicNorm: number;
  reconstructionNorm: number;
  harmonicDivergenceMax: number;
  harmonicCurlMax: number;
  orthogonalityDefect: number;
  pythagoreanDefect: number;
}

export interface VertexIntegrabilityMetrics {
  curlRms: number;
  maxAbsCurl: number;
  periodU: number;
  periodV: number;
}

export type SolverRequest =
  | { type: "configure"; wasmBaseUrl: string }
  | { type: "initialize"; runId: number; problem: Problem }
  | { type: "step"; runId: number; iterations: number };

export type SolverResponse =
  | { type: "ready"; backend: string }
  | {
      type: "initialized";
      runId: number;
      positions: Float64Array;
      edges: Int32Array;
      fields?: HodgeFields;
      fieldLayout?: HodgeFieldLayout;
      vectorField?: Float64Array;
      targetField?: Float64Array;
      hodgeMetrics?: HodgeMetrics;
      vertexIntegrabilityMetrics?: VertexIntegrabilityMetrics;
      diagnostics: SolverDiagnostics;
    }
  | {
      type: "stepped";
      runId: number;
      positions: Float64Array;
      fields?: HodgeFields;
      fieldLayout?: HodgeFieldLayout;
      vectorField?: Float64Array;
      targetField?: Float64Array;
      hodgeMetrics?: HodgeMetrics;
      vertexIntegrabilityMetrics?: VertexIntegrabilityMetrics;
      diagnostics: SolverDiagnostics;
    }
  | { type: "error"; runId?: number; message: string };
