import type { CapabilityManifest } from "./capabilities";
import type { ExperimentSpec } from "./experiment";
import type { Problem } from "./problem";
import type { ResultArtifact } from "./result";
import type { SolverDiagnostics } from "./snapshot";

export const EMBED_LOAD_PROBLEM = "geometry-lab/load-problem@1" as const;
export const EMBED_READY = "geometry-lab/ready@1" as const;
export const EMBED_DIAGNOSTICS = "geometry-lab/diagnostics@1" as const;
export const EMBED_HELLO_V2 = "geometry-lab/hello@2" as const;
export const EMBED_CAPABILITIES_V2 = "geometry-lab/capabilities@2" as const;
export const EMBED_LOAD_EXPERIMENT_V2 = "geometry-lab/load-experiment@2" as const;
export const EMBED_RESULT_V2 = "geometry-lab/result@2" as const;

export interface EmbedLoadProblemMessage {
  type: typeof EMBED_LOAD_PROBLEM;
  problem: unknown;
}

export interface EmbedHelloV2Message {
  type: typeof EMBED_HELLO_V2;
  requestId: string;
}

export interface EmbedLoadExperimentV2Message {
  type: typeof EMBED_LOAD_EXPERIMENT_V2;
  requestId: string;
  experiment: ExperimentSpec;
}

export type EmbedIncomingMessage =
  | EmbedLoadProblemMessage
  | EmbedHelloV2Message
  | EmbedLoadExperimentV2Message;

export type EmbedOutgoingMessage =
  | { type: typeof EMBED_READY; applicationVersion: "0.1.0" }
  | {
      type: typeof EMBED_DIAGNOSTICS;
      problem: Problem;
      diagnostics: SolverDiagnostics;
    }
  | {
      type: typeof EMBED_CAPABILITIES_V2;
      requestId: string;
      capabilities: CapabilityManifest;
    }
  | {
      type: typeof EMBED_RESULT_V2;
      requestId: string;
      result: ResultArtifact;
    };

export function isEmbedLoadProblemMessage(value: unknown): value is EmbedLoadProblemMessage {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return (value as Record<string, unknown>).type === EMBED_LOAD_PROBLEM;
}

export function isEmbedHelloV2Message(value: unknown): value is EmbedHelloV2Message {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.type === EMBED_HELLO_V2 &&
    typeof candidate.requestId === "string" &&
    candidate.requestId !== "";
}

export function isEmbedLoadExperimentV2Message(
  value: unknown,
): value is EmbedLoadExperimentV2Message {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.type === EMBED_LOAD_EXPERIMENT_V2 &&
    typeof candidate.requestId === "string" &&
    candidate.requestId !== "" &&
    !!candidate.experiment &&
    typeof candidate.experiment === "object";
}
