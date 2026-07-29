import "./styles.css";

import { TUTORIALS, formatProblem, parseProblem, type Problem } from "./core/problem";
import { getWorkspace, listWorkspaces, putWorkspace } from "./core/storage";
import {
  VIEW_SCHEMA,
  formatSnapshot,
  type CurveNetworkSnapshot,
  type SolverDiagnostics,
} from "./core/snapshot";
import { SolverClient } from "./solver/client";
import type { SolverResponse } from "./solver/messages";
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

let currentProblem: Problem = TUTORIALS[0]!.problem;
let diagnostics: SolverDiagnostics | undefined;
let playing = false;
let stepPending = false;

editor.value = localStorage.getItem("geometry-lab:draft") ?? formatProblem(currentProblem);

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

function readEditor(): Problem {
  const problem = parseProblem(editor.value);
  editor.value = formatProblem(problem);
  localStorage.setItem("geometry-lab:draft", editor.value);
  return problem;
}

function initialize(): void {
  try {
    currentProblem = readEditor();
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
      currentProblem.parameters.restLength,
    );
    showDiagnostics(response.diagnostics);
    runButton.disabled = false;
    stepButton.disabled = false;
    playButton.disabled = false;
    polyscopeButton.disabled = false;
    setStatus("Ready. Inspect one Newton step at a time.", "good");
    return;
  }
  if (response.type === "stepped") {
    const previousAcceptedIterations = diagnostics?.acceptedIterations ?? -1;
    viewer.update(response.positions);
    showDiagnostics(response.diagnostics);
    stepPending = false;
    stepButton.disabled = false;
    setStatus(`Accepted ${response.diagnostics.acceptedIterations} Newton steps.`, "good");
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

editor.addEventListener("input", () => localStorage.setItem("geometry-lab:draft", editor.value));
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
    await downloadRepositoryArchive(readEditor());
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
