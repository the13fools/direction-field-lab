/// <reference lib="webworker" />

import type {
  HodgeFieldLayout,
  HodgeFields,
  HodgeMetrics,
  SolverRequest,
  SolverResponse,
} from "./messages";

interface CommonBinding {
  step(iterations: number): void;
  getPositions(): ArrayLike<number>;
  getEdges(): ArrayLike<number>;
  getDiagnostics(): Omit<import("../core/snapshot").SolverDiagnostics, "acceptedIterations"> & { iterations: number };
  delete(): void;
}

interface MassSpringBinding extends CommonBinding {
  init(gridSize: number, restLength: number, springWeight: number, pinWeight: number, jitter: number, seed: number): void;
}

interface HodgeBinding extends CommonBinding {
  init(gridSize: number, exactStrength: number, coexactStrength: number, harmonicX: number, harmonicY: number, noise: number, seed: number): void;
  getInputField(): ArrayLike<number>;
  getExactField(): ArrayLike<number>;
  getCoexactField(): ArrayLike<number>;
  getHarmonicField(): ArrayLike<number>;
  getReconstructionError(): ArrayLike<number>;
  getHodgeMetrics(): HodgeMetrics;
}

interface VertexFieldBinding extends CommonBinding {
  init(
    gridSize: number,
    dataWeight: number,
    smoothnessWeight: number,
    lengthWeight: number,
    targetLength: number,
    initializationNoise: number,
    seed: number,
  ): void;
  getField(): ArrayLike<number>;
  getTargetField(): ArrayLike<number>;
}

interface KernelModule {
  MassSpringSystem: new () => MassSpringBinding;
  HodgeDecompositionSystem: new () => HodgeBinding;
  FaceHodgeSystem: new () => HodgeBinding;
  VertexFieldSystem: new () => VertexFieldBinding;
}

type ModuleFactory = (options: { locateFile(path: string): string }) => Promise<KernelModule>;

const scope = self as DedicatedWorkerGlobalScope;
let system: CommonBinding | undefined;
let hodgeSystem: HodgeBinding | undefined;
let hodgeFieldLayout: HodgeFieldLayout | undefined;
let vertexFieldSystem: VertexFieldBinding | undefined;
let acceptedIterations = 0;

function send(message: SolverResponse, transfers: Transferable[] = []): void {
  scope.postMessage(message, transfers);
}

function diagnostics(binding: CommonBinding) {
  const value = binding.getDiagnostics();
  acceptedIterations += value.iterations;
  return {
    energy: value.energy,
    gradientNorm: value.gradientNorm,
    newtonDecrement: value.newtonDecrement,
    dofs: value.dofs,
    hessianNonzeros: value.hessianNonzeros,
    acceptedIterations,
  };
}

function hodgeFields(binding: HodgeBinding): HodgeFields {
  return {
    input: new Float64Array(binding.getInputField()),
    exact: new Float64Array(binding.getExactField()),
    coexact: new Float64Array(binding.getCoexactField()),
    harmonic: new Float64Array(binding.getHarmonicField()),
    error: new Float64Array(binding.getReconstructionError()),
  };
}

function fieldTransfers(fields: HodgeFields | undefined): Transferable[] {
  return fields
    ? [fields.input.buffer, fields.exact.buffer, fields.coexact.buffer, fields.harmonic.buffer, fields.error.buffer]
    : [];
}

async function start(wasmBaseUrl: string): Promise<void> {
  try {
    const moduleUrl = new URL("gp_lab_kernels.js", wasmBaseUrl).href;
    const imported = (await import(/* @vite-ignore */ moduleUrl)) as { default: ModuleFactory };
    const module = await imported.default({
      locateFile: (path) => new URL(path, wasmBaseUrl).href,
    });
    send({ type: "ready", backend: "TinyAD + Eigen Sparse · WebAssembly" });

    scope.onmessage = (event: MessageEvent<SolverRequest>) => {
      const request = event.data;
      try {
        if (request.type === "configure") return;
        if (request.type === "initialize") {
          system?.delete();
          hodgeSystem = undefined;
          hodgeFieldLayout = undefined;
          vertexFieldSystem = undefined;
          acceptedIterations = 0;
          if (request.problem.kernel === "mass-spring") {
            const p = request.problem.parameters;
            const binding = new module.MassSpringSystem();
            system = binding;
            binding.init(p.gridSize, p.restLength, p.springWeight, p.pinWeight, p.jitter, p.seed);
          } else if (request.problem.kernel === "vertex-field") {
            const p = request.problem.parameters;
            const objective = p.objective;
            const binding = new module.VertexFieldSystem();
            system = binding;
            vertexFieldSystem = binding;
            hodgeFieldLayout = "vertex-vector";
            binding.init(
              p.gridSize,
              objective.dataWeight,
              objective.connectionSmoothnessWeight,
              objective.lengthWeight,
              objective.targetLength,
              p.initializationNoise,
              p.seed,
            );
          } else {
            const p = request.problem.parameters;
            const binding = request.problem.kernel === "hodge-face"
              ? new module.FaceHodgeSystem()
              : new module.HodgeDecompositionSystem();
            system = binding;
            hodgeSystem = binding;
            hodgeFieldLayout = request.problem.kernel === "hodge-face"
              ? "face-vector"
              : request.problem.parameters.representation === "vertex"
                ? "vertex-from-edge"
                : "edge-form";
            binding.init(
              p.gridSize,
              p.exactStrength,
              p.coexactStrength,
              p.harmonicX,
              p.harmonicY,
              p.noise,
              p.seed,
            );
          }
          const positions = new Float64Array(system.getPositions());
          const edges = Int32Array.from(system.getEdges());
          const fields = hodgeSystem ? hodgeFields(hodgeSystem) : undefined;
          const hodgeMetrics = hodgeSystem?.getHodgeMetrics();
          const vectorField = vertexFieldSystem
            ? new Float64Array(vertexFieldSystem.getField())
            : undefined;
          const targetField = vertexFieldSystem
            ? new Float64Array(vertexFieldSystem.getTargetField())
            : undefined;
          send(
            {
              type: "initialized",
              runId: request.runId,
              positions,
              edges,
              fields,
              fieldLayout: hodgeFieldLayout,
              vectorField,
              targetField,
              hodgeMetrics,
              diagnostics: diagnostics(system),
            },
            [
              positions.buffer,
              edges.buffer,
              ...fieldTransfers(fields),
              ...(vectorField ? [vectorField.buffer] : []),
              ...(targetField ? [targetField.buffer] : []),
            ],
          );
          return;
        }
        if (!system) throw new Error("Initialize a problem before stepping it.");
        system.step(request.iterations);
        const positions = new Float64Array(system.getPositions());
        const fields = hodgeSystem ? hodgeFields(hodgeSystem) : undefined;
        const hodgeMetrics = hodgeSystem?.getHodgeMetrics();
        const vectorField = vertexFieldSystem
          ? new Float64Array(vertexFieldSystem.getField())
          : undefined;
        const targetField = vertexFieldSystem
          ? new Float64Array(vertexFieldSystem.getTargetField())
          : undefined;
        send(
          {
            type: "stepped",
            runId: request.runId,
            positions,
            fields,
            fieldLayout: hodgeFieldLayout,
            vectorField,
            targetField,
            hodgeMetrics,
            diagnostics: diagnostics(system),
          },
          [
            positions.buffer,
            ...fieldTransfers(fields),
            ...(vectorField ? [vectorField.buffer] : []),
            ...(targetField ? [targetField.buffer] : []),
          ],
        );
      } catch (error) {
        send({
          type: "error",
          runId: "runId" in request ? request.runId : undefined,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    };
  } catch (error) {
    send({ type: "error", message: `Could not load the WASM kernels: ${error instanceof Error ? error.message : String(error)}` });
  }
}

scope.onmessage = (event: MessageEvent<SolverRequest>) => {
  if (event.data.type !== "configure") {
    send({ type: "error", message: "Solver worker must be configured before use." });
    return;
  }
  scope.onmessage = null;
  void start(event.data.wasmBaseUrl);
};
