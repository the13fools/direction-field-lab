/// <reference lib="webworker" />

import type { SolverRequest, SolverResponse } from "./messages";

interface MassSpringBinding {
  init(gridSize: number, restLength: number, springWeight: number, pinWeight: number, jitter: number, seed: number): void;
  step(iterations: number): void;
  getPositions(): ArrayLike<number>;
  getEdges(): ArrayLike<number>;
  getDiagnostics(): Omit<import("../core/snapshot").SolverDiagnostics, "acceptedIterations"> & { iterations: number };
  delete(): void;
}

interface KernelModule {
  MassSpringSystem: new () => MassSpringBinding;
}

type ModuleFactory = (options: { locateFile(path: string): string }) => Promise<KernelModule>;

const scope = self as DedicatedWorkerGlobalScope;
let system: MassSpringBinding | undefined;
let acceptedIterations = 0;

function send(message: SolverResponse, transfers: Transferable[] = []): void {
  scope.postMessage(message, transfers);
}

function diagnostics(binding: MassSpringBinding) {
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
          system = new module.MassSpringSystem();
          acceptedIterations = 0;
          const p = request.problem.parameters;
          system.init(p.gridSize, p.restLength, p.springWeight, p.pinWeight, p.jitter, p.seed);
          const positions = new Float64Array(system.getPositions());
          const edges = Int32Array.from(system.getEdges());
          send(
            {
              type: "initialized",
              runId: request.runId,
              positions,
              edges,
              diagnostics: diagnostics(system),
            },
            [positions.buffer, edges.buffer],
          );
          return;
        }
        if (!system) throw new Error("Initialize a problem before stepping it.");
        system.step(request.iterations);
        const positions = new Float64Array(system.getPositions());
        send(
          {
            type: "stepped",
            runId: request.runId,
            positions,
            diagnostics: diagnostics(system),
          },
          [positions.buffer],
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
