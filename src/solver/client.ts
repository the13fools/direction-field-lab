import type { Problem } from "../core/problem";
import type { SolverRequest, SolverResponse } from "./messages";

export class SolverClient extends EventTarget {
  private readonly worker = new Worker(new URL("./solver.worker.ts", import.meta.url), { type: "module" });
  private runId = 0;
  ready = false;

  constructor() {
    super();
    this.worker.onmessage = (event: MessageEvent<SolverResponse>) => {
      if (event.data.type === "ready") this.ready = true;
      if ("runId" in event.data && event.data.runId !== undefined && event.data.runId !== this.runId) return;
      this.dispatchEvent(new CustomEvent<SolverResponse>("message", { detail: event.data }));
    };
    this.post({ type: "configure", wasmBaseUrl: new URL("wasm/", document.baseURI).href });
  }

  initialize(problem: Problem): number {
    this.runId += 1;
    this.post({ type: "initialize", runId: this.runId, problem });
    return this.runId;
  }

  step(iterations: number): void {
    this.post({ type: "step", runId: this.runId, iterations });
  }

  private post(request: SolverRequest): void {
    this.worker.postMessage(request);
  }
}
