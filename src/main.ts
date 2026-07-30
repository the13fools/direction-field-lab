import "./styles.css";
import compiledFaceHodgeCallback from "../cpp/include/HodgeFaceCallbacks.hh?raw";
import compiledEdgeHodgeCallback from "../cpp/include/HodgeProjectionCallbacks.hh?raw";
import compiledVertexFieldCallback from "../cpp/include/VertexFieldCallbacks.hh?raw";

import {
  EMBED_DIAGNOSTICS,
  EMBED_READY,
  isEmbedLoadProblemMessage,
  type EmbedOutgoingMessage,
} from "./core/embed";
import {
  TUTORIALS,
  formatProblem,
  parseProblem,
  validateProblem,
  type Problem,
} from "./core/problem";
import { getWorkspace, listWorkspaces, putWorkspace } from "./core/storage";
import {
  VIEW_SCHEMA,
  formatSnapshot,
  type CurveNetworkSnapshot,
  type SolverDiagnostics,
} from "./core/snapshot";
import { SolverClient } from "./solver/client";
import type { SolverResponse } from "./solver/messages";
import type { HodgeFields } from "./solver/messages";
import type { HodgeFieldLayout } from "./solver/messages";
import type { HodgeMetrics } from "./solver/messages";
import { WebViewer } from "./viewer/web-viewer";

function element<T extends HTMLElement>(selector: string): T {
  const value = document.querySelector<T>(selector);
  if (!value) throw new Error(`Missing UI element ${selector}.`);
  return value;
}

const editor = element<HTMLTextAreaElement>("#problem-editor");
const viewer = new WebViewer(element("#viewer"));
const solver = new SolverClient();
const status = element("#status");
const runButton = element<HTMLButtonElement>("#run");
const stepButton = element<HTMLButtonElement>("#step");
const playButton = element<HTMLButtonElement>("#play");
const polyscopeButton = element<HTMLButtonElement>("#open-polyscope");
const workspaceSelect = element<HTMLSelectElement>("#workspace-select");
const fileInput = element<HTMLInputElement>("#file-input");
const hodgeComponents = element<HTMLDivElement>("#hodge-components");
const vertexComponents = element<HTMLDivElement>("#vertex-components");
const sourcePanel = element<HTMLDetailsElement>("#source-panel");
const callbackEditor = element<HTMLTextAreaElement>("#callback-editor");
const sourceState = element("#source-state");
const hodgeReport = element<HTMLDivElement>("#hodge-report");
const representationNote = element<HTMLDivElement>("#representation-note");
const representationKind = element("#representation-kind");
const representationTitle = element("#representation-title");
const representationDescription = element("#representation-description");
const representationSteps = element<HTMLOListElement>("#representation-steps");

let currentProblem: Problem = TUTORIALS[0]!.problem;
let diagnostics: SolverDiagnostics | undefined;
let playing = false;
let stepPending = false;
let hodgeFields: HodgeFields | undefined;
let hodgeFieldLayout: HodgeFieldLayout | undefined;
let selectedField: keyof HodgeFields = "input";
let vertexField: Float64Array | undefined;
let targetField: Float64Array | undefined;
let selectedVertexField: "target" | "solution" = "solution";

type SourceKind = "edge-hodge" | "face-hodge" | "vertex-field";
const compiledSources: Record<SourceKind, { filename: string; source: string }> = {
  "edge-hodge": { filename: "HodgeProjectionCallbacks.hh", source: compiledEdgeHodgeCallback },
  "face-hodge": { filename: "HodgeFaceCallbacks.hh", source: compiledFaceHodgeCallback },
  "vertex-field": { filename: "VertexFieldCallbacks.hh", source: compiledVertexFieldCallback },
};
let sourceKind: SourceKind = "edge-hodge";

editor.value = localStorage.getItem("geometry-lab:draft") ?? formatProblem(currentProblem);
callbackEditor.value =
  localStorage.getItem(sourceStorageKey(sourceKind)) ?? compiledSources[sourceKind].source;

function notifyParent(message: EmbedOutgoingMessage): void {
  if (window.parent !== window) window.parent.postMessage(message, "*");
}

function setStatus(message: string, kind: "working" | "good" | "bad" = "working"): void {
  status.textContent = message;
  status.dataset.kind = kind;
}

function metric(id: string, value: string): void {
  element(`#${id}`).textContent = value;
}

function showDiagnostics(value: SolverDiagnostics): void {
  diagnostics = value;
  metric("metric-energy", value.energy.toExponential(3));
  metric("metric-gradient", value.gradientNorm.toExponential(3));
  metric("metric-dofs", value.dofs.toLocaleString());
  metric("metric-nnz", value.hessianNonzeros.toLocaleString());
  metric("metric-iterations", value.acceptedIterations.toLocaleString());
}

function isHodgeProblem(problem: Problem): boolean {
  return problem.kernel === "hodge-1form" || problem.kernel === "hodge-face";
}

function sourceKindForProblem(problem: Problem): SourceKind {
  if (problem.kernel === "hodge-face") return "face-hodge";
  if (problem.kernel === "vertex-field") return "vertex-field";
  return "edge-hodge";
}

function sourceStorageKey(kind: SourceKind): string {
  return `geometry-lab:callback-draft:${kind}`;
}

function switchCallbackSource(problem: Problem): void {
  const nextKind = sourceKindForProblem(problem);
  if (nextKind === sourceKind && callbackEditor.value) return;
  sourceKind = nextKind;
  callbackEditor.value =
    localStorage.getItem(sourceStorageKey(sourceKind)) ?? compiledSources[sourceKind].source;
  updateSourceState();
}

function showRepresentationNote(): void {
  representationNote.hidden = currentProblem.kernel === "mass-spring";
  representationNote.dataset.tone = "normal";
  let steps: string[] = [];
  if (currentProblem.kernel === "hodge-face") {
    representationKind.textContent = "Native face field · mixed FEM";
    representationTitle.textContent = "2 numbers per triangle · discontinuous across edges";
    representationDescription.textContent =
      "The exact potential is conforming P1 at vertices; the rotated potential is non-conforming P1 at edge midpoints. Mixing those spaces gives the correct 2g-dimensional harmonic remainder.";
    steps = [
      "Predict why two copies of the vertex basis would leave too many harmonic modes.",
      "Decompose, then compare the exact, coexact, and harmonic face arrows.",
      "Set noise to 0.15 and decide which certificate detects the perturbation.",
    ];
  } else if (currentProblem.kernel === "hodge-1form" && currentProblem.parameters.representation === "edge") {
    representationKind.textContent = "Native edge field · DEC";
    representationTitle.textContent = "1 signed line integral per oriented edge";
    representationDescription.textContent =
      "TinyAD projects the 1-form onto d of a vertex potential and δ of a face potential. The incidence complex makes curl(grad)=0 exact before any arrows are reconstructed.";
    steps = [
      "Read the input as signed edge integrals rather than vectors at points.",
      "Decompose and verify that both harmonic certificates approach zero.",
      "Increase gridSize and compare DOFs with Hessian nonzeros.",
    ];
  } else if (currentProblem.kernel === "hodge-1form") {
    representationKind.textContent = "Vertex reconstruction · audit";
    representationTitle.textContent = "2 tangent components per vertex · derived from an edge 1-form";
    representationDescription.textContent =
      "This view area-averages Whitney face vectors into vertex tangent planes. It is useful for display, but it is not a native vertex Hodge decomposition; the reconstruction does not create a new exact sequence.";
    representationNote.dataset.tone = "caution";
    steps = [
      "Compare these arrows with exercise 05: the solver state is unchanged, only reconstruction changed.",
      "Explain why the displayed vertex field does not inherit curl(grad)=0 automatically.",
      "Use exercise 07 to replace reconstruction with native vertex unknowns.",
    ];
  } else if (currentProblem.kernel === "vertex-field") {
    representationKind.textContent = "Native vertex field · editable TinyAD objective";
    representationTitle.textContent = "2 tangent components per vertex · connection-aware smoothing";
    representationDescription.textContent =
      "Edit objective.dataWeight, connectionSmoothnessWeight, or lengthWeight in the JSON, then Reset + build. The browser passes the term weights into the compiled generic TinyAD callbacks—no Wasm rebuild is needed.";
    steps = [
      "Optimize, then switch between Target and Current solution.",
      "Set connectionSmoothnessWeight to 0; predict the data-only solution.",
      "Set dataWeight to 0 and raise lengthWeight; diagnose the resulting non-convex problem.",
    ];
  }
  representationSteps.replaceChildren(...steps.map((text) => {
    const item = document.createElement("li");
    item.textContent = text;
    return item;
  }));
}

function updateKernelUI(): void {
  const hodge = isHodgeProblem(currentProblem);
  const vertexDesign = currentProblem.kernel === "vertex-field";
  hodgeComponents.hidden = !hodge;
  vertexComponents.hidden = !vertexDesign;
  sourcePanel.hidden = !(hodge || vertexDesign);
  hodgeReport.hidden = !hodge;
  stepButton.textContent = hodge
    ? "Decompose"
    : vertexDesign
      ? `Optimize ${currentProblem.solver.iterationsPerStep} steps`
      : "One step";
  playButton.hidden = hodge;
  switchCallbackSource(currentProblem);
  showRepresentationNote();
}

function showHodgeMetrics(value: HodgeMetrics | undefined): void {
  if (!value) return;
  metric("hodge-curl", value.harmonicCurlMax.toExponential(2));
  metric("hodge-divergence", value.harmonicDivergenceMax.toExponential(2));
  metric("hodge-orthogonality", value.orthogonalityDefect.toExponential(2));
  metric("hodge-reconstruction", value.reconstructionNorm.toExponential(2));
}

const fieldColors: Record<keyof HodgeFields, number> = {
  input: 0xffffff,
  exact: 0x70dcff,
  coexact: 0xff8b5b,
  harmonic: 0xdffc5b,
  error: 0xff3f7f,
};

const fieldLabels: Record<keyof HodgeFields, string> = {
  input: "Input ω",
  exact: "Exact dφ",
  coexact: "Coexact δψ",
  harmonic: "Harmonic h",
  error: "Reconstruction error",
};

function renderSelectedField(): void {
  if (!hodgeFields || !hodgeFieldLayout) return;
  viewer.showHodgeField(
    hodgeFields[selectedField],
    fieldColors[selectedField],
    fieldLabels[selectedField],
    hodgeFieldLayout,
  );
  for (const button of hodgeComponents.querySelectorAll<HTMLButtonElement>("[data-field]")) {
    button.classList.toggle("active", button.dataset.field === selectedField);
  }
}

function renderSelectedVertexField(): void {
  const values = selectedVertexField === "target" ? targetField : vertexField;
  if (!values) return;
  viewer.showVertexVectorField(
    values,
    selectedVertexField === "target" ? 0xffffff : 0xdffc5b,
    selectedVertexField === "target" ? "Target field" : "Current solution",
  );
  for (const button of vertexComponents.querySelectorAll<HTMLButtonElement>("[data-vertex-field]")) {
    button.classList.toggle("active", button.dataset.vertexField === selectedVertexField);
  }
}

function readEditor(): Problem {
  const problem = parseProblem(editor.value);
  editor.value = formatProblem(problem);
  localStorage.setItem("geometry-lab:draft", editor.value);
  return problem;
}

function initialize(): void {
  try {
    currentProblem = readEditor();
    updateKernelUI();
    hodgeFields = undefined;
    hodgeFieldLayout = undefined;
    vertexField = undefined;
    targetField = undefined;
    playing = false;
    playButton.textContent = "Play";
    runButton.disabled = true;
    stepButton.disabled = true;
    playButton.disabled = true;
    polyscopeButton.disabled = true;
    setStatus("Building sparse system…");
    solver.initialize(currentProblem);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), "bad");
  }
}

function requestStep(): void {
  if (stepPending) return;
  stepPending = true;
  stepButton.disabled = true;
  solver.step(currentProblem.solver.iterationsPerStep);
}

solver.addEventListener("message", ((event: CustomEvent<SolverResponse>) => {
  const response = event.detail;
  if (response.type === "ready") {
    element("#backend").textContent = response.backend;
    notifyParent({ type: EMBED_READY, applicationVersion: "0.1.0" });
    initialize();
    return;
  }
  if (response.type === "error") {
    stepPending = false;
    runButton.disabled = false;
    stepButton.disabled = false;
    playButton.disabled = true;
    playing = false;
    playButton.textContent = "Play";
    setStatus(response.message, "bad");
    return;
  }
  if (response.type === "initialized") {
    viewer.initialize(
      response.positions,
      response.edges,
      currentProblem.parameters.gridSize,
      currentProblem.kernel === "mass-spring" ? currentProblem.parameters.restLength : 1,
      currentProblem.kernel !== "mass-spring",
    );
    hodgeFields = response.fields;
    hodgeFieldLayout = response.fieldLayout;
    vertexField = response.vectorField;
    targetField = response.targetField;
    showHodgeMetrics(response.hodgeMetrics);
    renderSelectedField();
    renderSelectedVertexField();
    showDiagnostics(response.diagnostics);
    notifyParent({
      type: EMBED_DIAGNOSTICS,
      problem: currentProblem,
      diagnostics: response.diagnostics,
    });
    runButton.disabled = false;
    stepButton.disabled = false;
    playButton.disabled = false;
    polyscopeButton.disabled = false;
    setStatus(
      currentProblem.kernel === "hodge-face"
        ? "Piecewise-constant face field ready. Decompose it with the mixed finite-element spaces."
        : currentProblem.kernel === "hodge-1form"
          ? currentProblem.parameters.representation === "edge"
            ? "Edge 1-form ready. Decompose it, then inspect each orthogonal component."
            : "Vertex reconstruction ready. Decompose the source 1-form, then audit what survives reconstruction."
          : currentProblem.kernel === "vertex-field"
            ? "Vertex objective assembled in TinyAD. Edit its JSON weights or take optimization steps."
            : "Ready. Inspect one Newton step at a time.",
      "good",
    );
    return;
  }
  if (response.type === "stepped") {
    const previousAcceptedIterations = diagnostics?.acceptedIterations ?? -1;
    viewer.update(response.positions);
    hodgeFields = response.fields;
    hodgeFieldLayout = response.fieldLayout;
    vertexField = response.vectorField;
    targetField = response.targetField ?? targetField;
    showHodgeMetrics(response.hodgeMetrics);
    renderSelectedField();
    renderSelectedVertexField();
    showDiagnostics(response.diagnostics);
    notifyParent({
      type: EMBED_DIAGNOSTICS,
      problem: currentProblem,
      diagnostics: response.diagnostics,
    });
    stepPending = false;
    stepButton.disabled = false;
    setStatus(`Accepted ${response.diagnostics.acceptedIterations} Newton steps.`, "good");
    if (isHodgeProblem(currentProblem)) {
      setStatus("Decomposition complete: ω = dφ + δψ + h. Compare the component views.", "good");
      return;
    }
    if (
      playing &&
      response.diagnostics.gradientNorm > 1e-7 &&
      response.diagnostics.acceptedIterations > previousAcceptedIterations
    ) {
      requestAnimationFrame(requestStep);
    } else if (playing) {
      playing = false;
      playButton.textContent = "Play";
      setStatus(
        response.diagnostics.gradientNorm <= 1e-7
          ? "Converged."
          : "The continuous solve stalled; inspect the formulation or restart.",
        response.diagnostics.gradientNorm <= 1e-7 ? "good" : "working",
      );
    }
  }
}) as EventListener);

runButton.addEventListener("click", initialize);
stepButton.addEventListener("click", requestStep);
playButton.addEventListener("click", () => {
  playing = !playing;
  playButton.textContent = playing ? "Pause" : "Play";
  if (playing) requestStep();
});

for (const button of hodgeComponents.querySelectorAll<HTMLButtonElement>("[data-field]")) {
  button.addEventListener("click", () => {
    selectedField = button.dataset.field as keyof HodgeFields;
    renderSelectedField();
  });
}

for (const button of vertexComponents.querySelectorAll<HTMLButtonElement>("[data-vertex-field]")) {
  button.addEventListener("click", () => {
    selectedVertexField = button.dataset.vertexField as "target" | "solution";
    renderSelectedVertexField();
  });
}

function updateSourceState(): void {
  const modified = callbackEditor.value !== compiledSources[sourceKind].source;
  sourceState.textContent = modified
    ? "modified source · export + rebuild"
    : currentProblem.kernel === "vertex-field"
      ? "compiled generic terms · JSON is live"
      : "compiled source";
  sourceState.dataset.kind = modified ? "modified" : "compiled";
}

callbackEditor.addEventListener("input", () => {
  localStorage.setItem(sourceStorageKey(sourceKind), callbackEditor.value);
  updateSourceState();
});

element<HTMLButtonElement>("#reset-callback").addEventListener("click", () => {
  callbackEditor.value = compiledSources[sourceKind].source;
  localStorage.removeItem(sourceStorageKey(sourceKind));
  updateSourceState();
});

element<HTMLButtonElement>("#download-callback").addEventListener("click", () => {
  const blob = new Blob([callbackEditor.value], { type: "text/x-c++hdr" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = compiledSources[sourceKind].filename;
  link.click();
  URL.revokeObjectURL(link.href);
});

editor.addEventListener("input", () => localStorage.setItem("geometry-lab:draft", editor.value));

window.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (event.source !== window.parent || !isEmbedLoadProblemMessage(event.data)) return;
  try {
    const problem = validateProblem(event.data.problem);
    editor.value = formatProblem(problem);
    initialize();
  } catch (error) {
    setStatus(
      `Embedded problem rejected: ${error instanceof Error ? error.message : String(error)}`,
      "bad",
    );
  }
});
element<HTMLButtonElement>("#format").addEventListener("click", () => {
  try {
    editor.value = formatProblem(readEditor());
    setStatus("Problem JSON is valid.", "good");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), "bad");
  }
});

for (const tutorial of TUTORIALS) {
  const button = document.createElement("button");
  button.className = "tutorial-card";
  button.innerHTML = `<strong>${tutorial.title}</strong><span>${tutorial.question}</span>`;
  button.addEventListener("click", () => {
    editor.value = formatProblem(tutorial.problem);
    initialize();
  });
  element("#tutorials").append(button);
}

async function refreshWorkspaces(selected?: string): Promise<void> {
  const records = await listWorkspaces();
  workspaceSelect.replaceChildren(new Option("Local workspaces", ""));
  for (const record of records) workspaceSelect.add(new Option(record.name, record.id));
  if (selected) workspaceSelect.value = selected;
}

element<HTMLButtonElement>("#save-local").addEventListener("click", async () => {
  try {
    const problem = readEditor();
    const record = await putWorkspace({
      id: workspaceSelect.value || undefined,
      name: problem.name,
      source: editor.value,
    });
    await refreshWorkspaces(record.id);
    setStatus(`Saved “${problem.name}” in this browser.`, "good");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), "bad");
  }
});

workspaceSelect.addEventListener("change", async () => {
  if (!workspaceSelect.value) return;
  const record = await getWorkspace(workspaceSelect.value);
  if (record) editor.value = record.source;
});

element<HTMLButtonElement>("#export-repo").addEventListener("click", async () => {
  try {
    const { downloadRepositoryArchive } = await import("./core/repository-export");
    const problem = readEditor();
    await downloadRepositoryArchive(
      problem,
      problem.kernel !== "mass-spring"
        ? { [`cpp/include/${compiledSources[sourceKind].filename}`]: callbackEditor.value }
        : {},
    );
    setStatus("Downloaded a Git-ready experiment repository.", "good");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), "bad");
  }
});

element<HTMLButtonElement>("#import-file").addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  try {
    editor.value = formatProblem(parseProblem(await file.text()));
    initialize();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), "bad");
  } finally {
    fileInput.value = "";
  }
});

function snapshot(): CurveNetworkSnapshot {
  return {
    schema: VIEW_SCHEMA,
    name: currentProblem.name,
    primitive: "curve-network",
    positions: viewer.currentPositions(),
    edges: viewer.currentEdges(),
    problem: currentProblem,
    diagnostics: diagnostics ?? {
      energy: 0,
      gradientNorm: 0,
      newtonDecrement: 0,
      dofs: 0,
      hessianNonzeros: 0,
      acceptedIterations: 0,
    },
  };
}

polyscopeButton.addEventListener("click", async () => {
  const body = formatSnapshot(snapshot());
  try {
    const response = await fetch("/api/polyscope", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    if (!response.ok) throw new Error(await response.text());
    setStatus("Sent the current result to the local Polyscope viewer.", "good");
  } catch {
    const blob = new Blob([body], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${currentProblem.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.geometry-view.json`;
    link.click();
    URL.revokeObjectURL(link.href);
    setStatus("Bridge not running; downloaded a Polyscope snapshot instead.", "working");
  }
});

void refreshWorkspaces();
updateSourceState();
updateKernelUI();
