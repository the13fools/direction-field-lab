import type { Problem } from "./problem";

export const VIEW_SCHEMA = "geometry-lab/view@1" as const;

export interface SolverDiagnostics {
  energy: number;
  gradientNorm: number;
  newtonDecrement: number;
  dofs: number;
  hessianNonzeros: number;
  acceptedIterations: number;
}

export interface CurveNetworkSnapshot {
  schema: typeof VIEW_SCHEMA;
  name: string;
  primitive: "curve-network";
  positions: number[];
  edges: number[];
  problem: Problem;
  diagnostics: SolverDiagnostics;
}

export function validateSnapshot(snapshot: CurveNetworkSnapshot): CurveNetworkSnapshot {
  if (snapshot.schema !== VIEW_SCHEMA) throw new Error(`schema must be ${VIEW_SCHEMA}.`);
  if (snapshot.primitive !== "curve-network") throw new Error("Only curve-network is supported in version 1.");
  if (snapshot.positions.length === 0 || snapshot.positions.length % 3 !== 0) {
    throw new Error("positions must be a non-empty flat xyz array.");
  }
  if (snapshot.edges.length === 0 || snapshot.edges.length % 2 !== 0) {
    throw new Error("edges must be a non-empty flat index-pair array.");
  }
  const vertexCount = snapshot.positions.length / 3;
  if (snapshot.edges.some((index) => !Number.isInteger(index) || index < 0 || index >= vertexCount)) {
    throw new Error("An edge index is outside the vertex array.");
  }
  return snapshot;
}

export function formatSnapshot(snapshot: CurveNetworkSnapshot): string {
  return `${JSON.stringify(validateSnapshot(snapshot), null, 2)}\n`;
}
