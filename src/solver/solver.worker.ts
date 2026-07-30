/// <reference lib="webworker" />

import type { HodgeFields, HodgeMetrics, SolverRequest, SolverResponse } from "./messages";

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

interface KernelModule {
  MassSpringSystem: new () => MassSpringBinding;
  HodgeDecompositionSystem: new () => HodgeBinding;
}

type ModuleFactory = (options: { locateFile(path: string): string }) => Promise<KernelModule>;

const scope = self as DedicatedWorkerGlobalScope;
let system: CommonBinding | undefined;
let hodgeSystem: HodgeBinding | undefined;
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
          acceptedIterations = 0;
          if (request.problem.kernel === "mass-spring") {
            const p = request.problem.parameters;
            const binding = new module.MassSpringSystem();
            system = binding;
            binding.init(p.gridSize, p.restLength, p.springWeight, p.pinWeight, p.jitter, p.seed);
          } else {
            const p = request.problem.parameters;
            const binding = new module.HodgeDecompositionSystem();
            system = binding;
            hodgeSystem = binding;
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
          send(
            {
              type: "initialized",
              runId: request.runId,
              positions,
              edges,
              fields,
              hodgeMetrics,
              diagnostics: diagnostics(system),
            },
            [positions.buffer, edges.buffer, ...fieldTransfers(fields)],
          );
          return;
        }
        if (!system) throw new Error("Initialize a problem before stepping it.");
        system.step(request.iterations);
        const positions = new Float64Array(system.getPositions());
        const fields = hodgeSystem ? hodgeFields(hodgeSystem) : undefined;
        const hodgeMetrics = hodgeSystem?.getHodgeMetrics();
        send(
          {
            type: "stepped",
            runId: request.runId,
            positions,
            fields,
            hodgeMetrics,
            diagnostics: diagnostics(system),
          },
          [positions.buffer, ...fieldTransfers(fields)],
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
