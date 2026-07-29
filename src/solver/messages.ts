import type { MassSpringProblem } from "../core/problem";
import type { SolverDiagnostics } from "../core/snapshot";

export type SolverRequest =
  | { type: "configure"; wasmBaseUrl: string }
  | { type: "initialize"; runId: number; problem: MassSpringProblem }
  | { type: "step"; runId: number; iterations: number };

export type SolverResponse =
  | { type: "ready"; backend: string }
  | {
      type: "initialized";
      runId: number;
      positions: Float64Array;
      edges: Int32Array;
      diagnostics: SolverDiagnostics;
    }
  | {
      type: "stepped";
      runId: number;
      positions: Float64Array;
      diagnostics: SolverDiagnostics;
    }
  | { type: "error"; runId?: number; message: string };
