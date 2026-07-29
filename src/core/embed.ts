import type { Problem } from "./problem";
import type { SolverDiagnostics } from "./snapshot";

export const EMBED_LOAD_PROBLEM = "geometry-lab/load-problem@1" as const;
export const EMBED_READY = "geometry-lab/ready@1" as const;
export const EMBED_DIAGNOSTICS = "geometry-lab/diagnostics@1" as const;

export interface EmbedLoadProblemMessage {
  type: typeof EMBED_LOAD_PROBLEM;
  problem: unknown;
}

export type EmbedOutgoingMessage =
  | { type: typeof EMBED_READY; applicationVersion: "0.1.0" }
  | {
      type: typeof EMBED_DIAGNOSTICS;
      problem: Problem;
      diagnostics: SolverDiagnostics;
    };

export function isEmbedLoadProblemMessage(value: unknown): value is EmbedLoadProblemMessage {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return (value as Record<string, unknown>).type === EMBED_LOAD_PROBLEM;
}
