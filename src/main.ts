import "./styles.css";
import compiledFaceHodgeCallback from "../cpp/include/HodgeFaceCallbacks.hh?raw";
import compiledEdgeHodgeCallback from "../cpp/include/HodgeProjectionCallbacks.hh?raw";
import compiledMassSpringCallback from "../cpp/include/MassSpringCallbacks.hh?raw";
import compiledVertexFieldCallback from "../cpp/include/VertexFieldCallbacks.hh?raw";

import { BUILTIN_CAPABILITIES } from "./core/capabilities";
import {
  EMBED_CAPABILITIES_V2,
  EMBED_DIAGNOSTICS,
  EMBED_READY,
  EMBED_RESULT_V2,
  isEmbedHelloV2Message,
  isEmbedLoadExperimentV2Message,
  isEmbedLoadProblemMessage,
  type EmbedOutgoingMessage,
} from "./core/embed";
import { validateExperimentSpec, type JsonObject } from "./core/experiment";
import { runExperiment, requestedExperimentOperators } from "./core/run-experiment";
import {
  TUTORIALS,
  TUTORIAL_SECTIONS,
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
import type { VertexIntegrabilityMetrics } from "./solver/messages";
import { highlightCpp } from "./ui/code-highlight";
import { DEFAULT_HODGE_FIELD, formatHodgeMetrics } from "./ui/hodge-state";
import {
  controlsForProblem,
  problemControlValue,
  updateProblemControl,
} from "./ui/problem-controls";
import { WebViewer } from "./viewer/web-viewer";

function element<T extends HTMLElement>(selector: string): T {
  const value = document.querySelector<T>(selector);
  if (!value) throw new Error(`Missing UI element ${selector}.`);
  return value;
}

const editor = element<HTMLTextAreaElement>("#problem-editor");
const editorPanel = element<HTMLElement>(".editor-panel");
const workspace = element<HTMLElement>(".workspace");
const editorResizer = element<HTMLElement>("#editor-resizer");
const problemControls = element<HTMLDivElement>("#problem-controls");
const guidedModeButton = element<HTMLButtonElement>("#guided-mode");
const jsonModeButton = element<HTMLButtonElement>("#json-mode");
const editorNote = element<HTMLParagraphElement>("#editor-note");
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
const callbackHighlight = element<HTMLPreElement>("#callback-highlight");
const sourceState = element("#source-state");
const hodgeReport = element<HTMLDivElement>("#hodge-report");
const vertexIntegrabilityReport = element<HTMLDivElement>("#vertex-integrability-report");
const sourceTitle = element("#source-title");
const representationNote = element<HTMLDetailsElement>("#representation-note");
const representationKind = element("#representation-kind");
const representationTitle = element("#representation-title");
const representationDescription = element("#representation-description");
const representationSteps = element<HTMLOListElement>("#representation-steps");
const projectionMap = element<HTMLDetailsElement>("#projection-map");
const persistenceState = element("#persistence-state");
const downloadRebuildButton = element<HTMLButtonElement>("#download-rebuild-project");
const buildNativeButton = element<HTMLButtonElement>("#build-native");
const localMode = element("#local-mode");
const connectedNote = element("#connected-note");
const sourceExplainer = element("#source-explainer");
const codeFocusButton = element<HTMLButtonElement>("#code-focus");
const sparsityGuide = element<HTMLElement>("#sparsity-guide");

const requestedTutorialId = new URLSearchParams(location.search).get("lesson");
const requestedTutorial = TUTORIALS.find((tutorial) => tutorial.id === requestedTutorialId);
let activeTutorialId = requestedTutorial?.id ?? TUTORIALS[0]!.id;
let currentProblem: Problem = requestedTutorial?.problem ?? TUTORIALS[0]!.problem;
let diagnostics: SolverDiagnostics | undefined;
let playing = false;
let stepPending = false;
let hodgeFields: HodgeFields | undefined;
let hodgeFieldLayout: HodgeFieldLayout | undefined;
let selectedField: keyof HodgeFields = DEFAULT_HODGE_FIELD;
let vertexField: Float64Array | undefined;
let targetField: Float64Array | undefined;
let selectedVertexField: "target" | "solution" = "solution";
type ConfigMode = "guided" | "json";
let configMode: ConfigMode =
  localStorage.getItem("geometry-lab:config-mode") === "json" ? "json" : "guided";

type SourceKind = "mass-spring" | "edge-hodge" | "face-hodge" | "vertex-field";
const compiledSources: Record<SourceKind, { filename: string; source: string }> = {
  "mass-spring": { filename: "MassSpringCallbacks.hh", source: compiledMassSpringCallback },
  "edge-hodge": { filename: "HodgeProjectionCallbacks.hh", source: compiledEdgeHodgeCallback },
  "face-hodge": { filename: "HodgeFaceCallbacks.hh", source: compiledFaceHodgeCallback },
  "vertex-field": { filename: "VertexFieldCallbacks.hh", source: compiledVertexFieldCallback },
};
let sourceKind: SourceKind = "edge-hodge";
const AUTOSAVE_WORKSPACE_ID = "autosave";
let autosaveTimer: number | undefined;

interface LocalBridgeCapabilities {
  mode: "connected";
  actions: {
    openPolyscope: boolean;
    buildNativeVertexField: boolean;
  };
  workspace: string;
}

let localBridge: LocalBridgeCapabilities | undefined;

editor.value = requestedTutorial
  ? formatProblem(currentProblem)
  : localStorage.getItem("geometry-lab:draft") ?? formatProblem(currentProblem);
callbackEditor.value =
  localStorage.getItem(sourceStorageKey(sourceKind)) ?? compiledSources[sourceKind].source;

const storedBriefState = localStorage.getItem("geometry-lab:experiment-brief-open");
if (storedBriefState !== null) representationNote.open = storedBriefState === "true";

let parentOrigin = "*";

function notifyParent(message: EmbedOutgoingMessage, targetOrigin = parentOrigin): void {
  if (window.parent !== window) window.parent.postMessage(message, targetOrigin);
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
  if (activeTutorialId === "sparsity-scaling") {
    metric("scaling-sparse", `${value.hessianNonzeros.toLocaleString()} nnz`);
  }
}

function isHodgeProblem(problem: Problem): boolean {
  return problem.kernel === "hodge-1form" || problem.kernel === "hodge-face";
}

function sourceKindForProblem(problem: Problem): SourceKind {
  if (problem.kernel === "mass-spring") return "mass-spring";
  if (problem.kernel === "hodge-face") return "face-hodge";
  if (problem.kernel === "vertex-field") return "vertex-field";
  return "edge-hodge";
}

function sourceStorageKey(kind: SourceKind): string {
  return `geometry-lab:callback-draft:${kind}`;
}

function renderCallbackHighlight(): void {
  // The final newline keeps the overlay height aligned when the source ends on
  // an otherwise empty line.
  callbackHighlight.innerHTML = `${highlightCpp(callbackEditor.value)}\n`;
  callbackHighlight.scrollTop = callbackEditor.scrollTop;
  callbackHighlight.scrollLeft = callbackEditor.scrollLeft;
}

function currentSourceFiles(): Record<string, string> {
  return Object.fromEntries(
    (Object.keys(compiledSources) as SourceKind[]).map((kind) => {
      const entry = compiledSources[kind];
      const source =
        kind === sourceKind
          ? callbackEditor.value
          : localStorage.getItem(sourceStorageKey(kind)) ?? entry.source;
      return [`cpp/include/${entry.filename}`, source];
    }),
  );
}

function restoreSourceFiles(sourceFiles: Record<string, string> | undefined): void {
  if (!sourceFiles) return;
  for (const kind of Object.keys(compiledSources) as SourceKind[]) {
    const entry = compiledSources[kind];
    const source = sourceFiles[`cpp/include/${entry.filename}`];
    if (typeof source === "string") {
      localStorage.setItem(sourceStorageKey(kind), source);
    }
  }
}

function scheduleAutosave(): void {
  persistenceState.textContent = "saving local draft…";
  if (autosaveTimer !== undefined) window.clearTimeout(autosaveTimer);
  autosaveTimer = window.setTimeout(async () => {
    try {
      await putWorkspace({
        id: AUTOSAVE_WORKSPACE_ID,
        name: "Autosaved browser project",
        source: editor.value,
        sourceFiles: currentSourceFiles(),
      });
      persistenceState.textContent = "saved in this browser";
    } catch {
      persistenceState.textContent = "local save unavailable";
    }
  }, 350);
}

function switchCallbackSource(problem: Problem): void {
  const nextKind = sourceKindForProblem(problem);
  if (nextKind === sourceKind && callbackEditor.value) return;
  sourceKind = nextKind;
  callbackEditor.value =
    localStorage.getItem(sourceStorageKey(sourceKind)) ?? compiledSources[sourceKind].source;
  renderCallbackHighlight();
  updateSourceState();
}

function showRepresentationNote(): void {
  representationNote.hidden = false;
  representationNote.dataset.tone = "normal";
  let steps: string[] = [];
  if (currentProblem.kernel === "mass-spring") {
    representationKind.textContent = "Variational foundation · editable local callbacks";
    if (activeTutorialId === "soft-constraints") {
      representationTitle.textContent = "Soft means finite weight: the optimum may violate every request a little";
      representationDescription.textContent =
        "Corner pins and edge springs are summed into one objective. A pin weight of 12 does not freeze a vertex; it prices displacement. The optimizer balances that price against every incident spring, so changing either weight changes the compromise.";
      steps = [
        "Set Pins near the Spring weight and predict which corners visibly move.",
        "Increase Pins by powers of ten; watch the violation shrink without becoming a hard constraint.",
        "Open the C++ callback and identify the residual whose coefficient you changed.",
      ];
    } else if (activeTutorialId === "sparsity-scaling") {
      representationTitle.textContent = "Resolution grows globally; each element still touches only a few variables";
      representationDescription.textContent =
        "For an n × n grid there are 2n² scalar unknowns. One edge callback touches two 2D positions, so it scatters a 4 × 4 local Hessian. The global matrix grows, but its row stencil remains bounded.";
      steps = [
        "Use the resolution buttons below and Reset + build each system.",
        "Compare Hessian nnz with the dense entry count (2n²)².",
        "Explain why a dense matrix would discard the locality already visible in the callback.",
      ];
    } else {
      representationTitle.textContent = "Two local energies assemble one sparse Newton system";
      representationDescription.textContent =
        "Each vertex owns a 2D position. Pin callbacks touch one vertex; spring callbacks touch the two endpoints of one edge. TinyAD differentiates those small functions and scatter-adds their blocks into the global gradient and Hessian.";
      steps = [
        "Read the two callbacks before taking a step and predict their variable stencils.",
        "Take one Newton step and compare energy, gradient norm, DOFs, and Hessian nnz.",
        "Change one expression in the code column, then download it for a native rebuild.",
      ];
    }
  } else if (currentProblem.kernel === "hodge-face") {
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
    representationKind.textContent = "Native edge cochain · identity-weighted baseline";
    representationTitle.textContent = "1 signed line integral per oriented edge";
    representationDescription.textContent =
      "TinyAD projects the 1-form onto d of a vertex potential and the transpose-incidence image of a face potential using a unit cochain norm. The complex makes curl(grad)=0 exact; a geometry-dependent DEC Hodge star is a separate next step.";
    steps = [
      "Read the input as signed edge integrals rather than vectors at points.",
      "Decompose and verify that both harmonic certificates approach zero.",
      "Increase gridSize and compare DOFs with Hessian nonzeros.",
    ];
  } else if (currentProblem.kernel === "hodge-1form") {
    representationKind.textContent = "Vertex reconstruction · audit";
    representationTitle.textContent = "2 tangent components per vertex · derived from an edge 1-form";
    representationDescription.textContent =
      "This view reconstructs and area-averages Whitney vectors in the flat periodic complex, then maps their two coordinates into display tangent frames. It is not a native vertex Hodge decomposition and does not create a new exact sequence.";
    representationNote.dataset.tone = "caution";
    steps = [
      "Compare these arrows with exercise 05: the solver state is unchanged, only reconstruction changed.",
      "Explain why the displayed vertex field does not inherit curl(grad)=0 automatically.",
      "Use exercise 07 to replace reconstruction with native vertex unknowns.",
    ];
  } else if (currentProblem.kernel === "vertex-field") {
    const integrabilityEnabled = currentProblem.parameters.objective.integrabilityWeight > 0;
    const unitEnabled = currentProblem.parameters.objective.lengthWeight > 0;
    if (integrabilityEnabled && unitEnabled) {
      representationKind.textContent = "Native vertex field · unit-aware integrable projection";
      representationTitle.textContent = "2 tangent components per vertex · curl and unit length compete";
      representationDescription.textContent =
        "Two compiled TinyAD residual families act on the same vertex unknowns: triangle circulation suppresses local curl, while the quartic term (‖u‖² − targetLength²)² asks for a preferred norm. Both are finite penalties, so the result is deliberately ‘as integrable and unit as possible.’";
      steps = [
        "Optimize, then compare curl RMS with the visible unit-length defects.",
        "Raise one weight at a time and locate where the rotating target loses the compromise.",
        "Open the live-energy workshop to rewrite the entire per-vertex term without compiling.",
      ];
    } else if (integrabilityEnabled) {
      representationKind.textContent = "Native vertex field · local integrability operator";
      representationTitle.textContent = "2 tangent components per vertex · circulation measured per face";
      representationDescription.textContent =
        "The compiled C++ converts endpoint vectors to ambient coordinates, integrates them around each triangle, and penalizes squared circulation. Edit objective.integrabilityWeight in the JSON, then Reset + build.";
      steps = [
        "Compare Target and Current solution before and after optimization.",
        "Raise integrabilityWeight and predict the face-curl readings.",
        "Notice that small local curl does not force the two torus periods to vanish.",
      ];
    } else {
      representationKind.textContent = "Native vertex field · editable TinyAD objective";
      representationTitle.textContent = "2 tangent components per vertex · connection-aware smoothing";
      representationDescription.textContent =
        "Exercise 07 keeps integrabilityWeight at zero. First isolate the data, connection-smoothing, and length terms; exercise 08 then adds the face-circulation operator using the same unknowns.";
      steps = [
        "Optimize, then switch between Target and Current solution.",
        "Set connectionSmoothnessWeight to zero and predict the data-only solution.",
        "Continue to exercise 08 to enable the visible integrability callback.",
      ];
    }
  }
  representationSteps.replaceChildren(...steps.map((text) => {
    const item = document.createElement("li");
    item.textContent = text;
    return item;
  }));
}

function showProjectionMap(): void {
  const relevant = isHodgeProblem(currentProblem) || currentProblem.kernel === "vertex-field";
  projectionMap.hidden = !relevant;
  if (!relevant) return;
  const activeFamily = isHodgeProblem(currentProblem)
    ? "closest"
    : currentProblem.kernel === "vertex-field" &&
        currentProblem.parameters.objective.integrabilityWeight > 0 &&
        currentProblem.parameters.objective.lengthWeight > 0
      ? "unit"
      : "penalty";
  for (const card of projectionMap.querySelectorAll<HTMLElement>("[data-projection-family]")) {
    card.dataset.active = String(card.dataset.projectionFamily === activeFamily);
  }
}

function setConfigMode(mode: ConfigMode): void {
  configMode = mode;
  editorPanel.dataset.configMode = mode;
  guidedModeButton.classList.toggle("active", mode === "guided");
  jsonModeButton.classList.toggle("active", mode === "json");
  guidedModeButton.setAttribute("aria-pressed", String(mode === "guided"));
  jsonModeButton.setAttribute("aria-pressed", String(mode === "json"));
  editorNote.innerHTML = mode === "guided"
    ? "Adjust the labeled controls, then choose <code>Reset + build</code>. JSON remains available as the portable source of truth."
    : "Edit the complete portable problem, choose <code>Validate</code>, then <code>Reset + build</code>.";
  localStorage.setItem("geometry-lab:config-mode", mode);
}

function renderProblemControls(): void {
  problemControls.replaceChildren();
  for (const group of controlsForProblem(currentProblem)) {
    const fieldset = document.createElement("fieldset");
    const legend = document.createElement("legend");
    legend.textContent = group.title;
    fieldset.append(legend);

    for (const control of group.controls) {
      const row = document.createElement("label");
      row.className = "problem-control";
      const copy = document.createElement("span");
      const title = document.createElement("strong");
      title.textContent = control.label;
      const description = document.createElement("small");
      description.textContent = control.description;
      copy.append(title, description);

      const input = control.kind === "select"
        ? document.createElement("select")
        : document.createElement("input");
      input.setAttribute("aria-label", control.label);
      if (input instanceof HTMLInputElement) {
        input.type = "number";
        if (control.min !== undefined) input.min = String(control.min);
        if (control.max !== undefined) input.max = String(control.max);
        if (control.step !== undefined) input.step = String(control.step);
      } else {
        for (const option of control.options ?? []) {
          input.add(new Option(option.label, option.value));
        }
      }
      input.value = String(problemControlValue(currentProblem, control.path));
      input.addEventListener("change", () => {
        try {
          const value = input instanceof HTMLInputElement ? Number(input.value) : input.value;
          currentProblem = updateProblemControl(currentProblem, control.path, value);
          editor.value = formatProblem(currentProblem);
          localStorage.setItem("geometry-lab:draft", editor.value);
          updateKernelUI();
          scheduleAutosave();
          setStatus("Controls updated. Choose Reset + build to assemble the new objective.", "good");
        } catch (error) {
          input.value = String(problemControlValue(currentProblem, control.path));
          setStatus(error instanceof Error ? error.message : String(error), "bad");
        }
      });
      row.append(copy, input);
      fieldset.append(row);
    }
    problemControls.append(fieldset);
  }
}

function updateKernelUI(): void {
  const hodge = isHodgeProblem(currentProblem);
  const vertexDesign = currentProblem.kernel === "vertex-field";
  hodgeComponents.hidden = !hodge;
  vertexComponents.hidden = !vertexDesign;
  sourcePanel.hidden = false;
  hodgeReport.hidden = !hodge;
  vertexIntegrabilityReport.hidden = !vertexDesign;
  sourcePanel.open = vertexDesign || currentProblem.kernel === "mass-spring";
  editorPanel.classList.add("source-visible");
  sparsityGuide.hidden = activeTutorialId !== "sparsity-scaling";
  if (!sparsityGuide.hidden && currentProblem.kernel === "mass-spring") {
    const n = currentProblem.parameters.gridSize;
    const dofs = 2 * n * n;
    metric("scaling-grid", `${n} × ${n} · ${dofs.toLocaleString()} DOFs`);
    metric("scaling-dense", `${(dofs * dofs).toLocaleString()} entries`);
    metric("scaling-sparse", "run once");
  }
  downloadRebuildButton.hidden = false;
  buildNativeButton.hidden = !(
    vertexDesign && localBridge?.actions.buildNativeVertexField
  );
  buildNativeButton.disabled = buildNativeButton.hidden;
  sourceTitle.textContent = vertexDesign
    ? "Actual vertex integrability + TinyAD callbacks"
    : currentProblem.kernel === "mass-spring"
      ? "Editable TinyAD pin + spring callbacks"
      : "Actual TinyAD callbacks";
  sourceExplainer.innerHTML = currentProblem.kernel === "mass-spring"
    ? "This is the complete differentiable model for the first three lessons: one callback per corner pin and one per spring edge. TinyAD supplies local derivatives and sparse scatter. Edit a formula here, then download it for a native rebuild."
    : "This is the literal C++ callback behind the experiment. Comments marked <code>LAB NOTE</code> explain what TinyAD differentiates; <code>TRY</code> suggests a safe first change. Parameter changes stay live in the browser; source edits can be downloaded or rebuilt in connected mode.";
  stepButton.textContent = hodge
    ? "Decompose"
    : vertexDesign
    ? `Optimize ${currentProblem.solver.iterationsPerStep} ${currentProblem.solver.iterationsPerStep === 1 ? "step" : "steps"}`
      : "One step";
  playButton.hidden = hodge;
  switchCallbackSource(currentProblem);
  showRepresentationNote();
  showProjectionMap();
  renderProblemControls();
}

function showVertexIntegrabilityMetrics(
  value: VertexIntegrabilityMetrics | undefined,
): void {
  if (!value) return;
  metric("vertex-curl-rms", value.curlRms.toExponential(2));
  metric("vertex-curl-max", value.maxAbsCurl.toExponential(2));
  metric("vertex-period-u", value.periodU.toExponential(2));
  metric("vertex-period-v", value.periodV.toExponential(2));
}

function showHodgeMetrics(value: HodgeMetrics | undefined): void {
  const display = formatHodgeMetrics(value, (diagnostics?.acceptedIterations ?? 0) > 0);
  metric("hodge-curl", display.curl);
  metric("hodge-divergence", display.divergence);
  metric("hodge-orthogonality", display.orthogonality);
  metric("hodge-reconstruction", display.reconstruction);
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
    hodgeFields.input,
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
    selectedField = DEFAULT_HODGE_FIELD;
    diagnostics = undefined;
    updateKernelUI();
    hodgeFields = undefined;
    hodgeFieldLayout = undefined;
    vertexField = undefined;
    targetField = undefined;
    showHodgeMetrics(undefined);
    playing = false;
    playButton.textContent = "Play";
    playButton.setAttribute("aria-pressed", "false");
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
    diagnostics = response.diagnostics;
    showHodgeMetrics(response.hodgeMetrics);
    showVertexIntegrabilityMetrics(response.vertexIntegrabilityMetrics);
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
            ? "Vertex circulation operator assembled in TinyAD. Edit its JSON weight or inspect the compiled callback."
            : "Ready. Inspect one Newton step at a time.",
      "good",
    );
    if (isHodgeProblem(currentProblem)) {
      setStatus("Field assembled. Running the Hodge decomposition automatically…");
      requestStep();
    }
    return;
  }
  if (response.type === "stepped") {
    const previousAcceptedIterations = diagnostics?.acceptedIterations ?? -1;
    viewer.update(response.positions);
    hodgeFields = response.fields;
    hodgeFieldLayout = response.fieldLayout;
    vertexField = response.vectorField;
    targetField = response.targetField ?? targetField;
    diagnostics = response.diagnostics;
    showHodgeMetrics(response.hodgeMetrics);
    showVertexIntegrabilityMetrics(response.vertexIntegrabilityMetrics);
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
      playButton.setAttribute("aria-pressed", "false");
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
  playButton.setAttribute("aria-pressed", String(playing));
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
    ? localBridge?.actions.buildNativeVertexField && currentProblem.kernel === "vertex-field"
      ? "modified source · native rebuild ready"
      : "modified source · download + rebuild"
    : currentProblem.kernel === "vertex-field"
      ? "compiled generic terms · JSON is live"
      : "compiled source";
  sourceState.dataset.kind = modified ? "modified" : "compiled";
}

callbackEditor.addEventListener("input", () => {
  localStorage.setItem(sourceStorageKey(sourceKind), callbackEditor.value);
  renderCallbackHighlight();
  updateSourceState();
  scheduleAutosave();
});

callbackEditor.addEventListener("scroll", renderCallbackHighlight);

callbackEditor.addEventListener("keydown", (event) => {
  if (event.key !== "Tab") return;
  event.preventDefault();
  const start = callbackEditor.selectionStart;
  const end = callbackEditor.selectionEnd;
  callbackEditor.setRangeText("  ", start, end, "end");
  callbackEditor.dispatchEvent(new Event("input"));
});

representationNote.addEventListener("toggle", () => {
  localStorage.setItem(
    "geometry-lab:experiment-brief-open",
    String(representationNote.open),
  );
});

element<HTMLButtonElement>("#reset-callback").addEventListener("click", () => {
  callbackEditor.value = compiledSources[sourceKind].source;
  localStorage.removeItem(sourceStorageKey(sourceKind));
  renderCallbackHighlight();
  updateSourceState();
  scheduleAutosave();
});

element<HTMLButtonElement>("#download-callback").addEventListener("click", () => {
  const blob = new Blob([callbackEditor.value], { type: "text/x-c++hdr" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = compiledSources[sourceKind].filename;
  link.click();
  URL.revokeObjectURL(link.href);
});

editor.addEventListener("input", () => {
  localStorage.setItem("geometry-lab:draft", editor.value);
  scheduleAutosave();
});

window.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (event.source !== window.parent) return;
  if (isEmbedHelloV2Message(event.data)) {
    parentOrigin = event.origin === "null" ? "*" : event.origin;
    notifyParent(
      {
        type: EMBED_CAPABILITIES_V2,
        requestId: event.data.requestId,
        capabilities: BUILTIN_CAPABILITIES,
      },
      parentOrigin,
    );
    return;
  }
  if (parentOrigin !== "*" && event.origin !== parentOrigin) return;
  if (isEmbedLoadExperimentV2Message(event.data)) {
    try {
      const experiment = validateExperimentSpec(event.data.experiment);
      const available = new Set(BUILTIN_CAPABILITIES.operators.map((operator) => operator.id));
      const requested = requestedExperimentOperators(experiment);
      const missing = [...new Set(requested.filter((operator) => !available.has(operator)))];
      let result;
      let adapterError: string | undefined;
      if (missing.length === 0) {
        try {
          result = runExperiment(experiment);
        } catch (error) {
          adapterError = error instanceof Error ? error.message : String(error);
        }
      }
      notifyParent({
        type: EMBED_RESULT_V2,
        requestId: event.data.requestId,
        result: result ?? {
          schema: "geometry-lab/result@2",
          experimentId: experiment.id,
          status: "failed",
          meshes: [],
          fields: [],
          metrics: [],
          series: [],
          messages: [
            {
              level: "error",
              code: missing.length ? "capability-unavailable" : "experiment-adapter-failed",
              text: missing.length
                ? `This build does not provide: ${missing.join(", ")}.`
                : adapterError ?? "The experiment adapter failed without a diagnostic.",
            },
          ],
          provenance: {
            applicationVersion: BUILTIN_CAPABILITIES.applicationVersion,
            backendBundles: { gp_lab_kernels: "bundled" },
            experiment: JSON.parse(JSON.stringify(experiment)) as JsonObject,
          },
        },
      });
    } catch (error) {
      setStatus(
        `Embedded experiment rejected: ${error instanceof Error ? error.message : String(error)}`,
        "bad",
      );
    }
    return;
  }
  if (!isEmbedLoadProblemMessage(event.data)) return;
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
    currentProblem = readEditor();
    updateKernelUI();
    setStatus("Problem JSON is valid.", "good");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), "bad");
  }
});

guidedModeButton.addEventListener("click", () => setConfigMode("guided"));
jsonModeButton.addEventListener("click", () => setConfigMode("json"));

const CODE_FOCUS_KEY = "geometry-lab:code-focus";
function setCodeFocus(enabled: boolean): void {
  workspace.dataset.codeFocus = String(enabled);
  codeFocusButton.classList.toggle("active", enabled);
  codeFocusButton.setAttribute("aria-pressed", String(enabled));
  codeFocusButton.textContent = enabled ? "Exit code column" : "Code column";
  if (enabled) sourcePanel.open = true;
  localStorage.setItem(CODE_FOCUS_KEY, String(enabled));
}
codeFocusButton.addEventListener("click", () => {
  setCodeFocus(workspace.dataset.codeFocus !== "true");
});
setCodeFocus(localStorage.getItem(CODE_FOCUS_KEY) === "true");

for (const button of sparsityGuide.querySelectorAll<HTMLButtonElement>("[data-scaling-grid]")) {
  button.addEventListener("click", () => {
    if (currentProblem.kernel !== "mass-spring") return;
    currentProblem = updateProblemControl(
      currentProblem,
      ["parameters", "gridSize"],
      Number(button.dataset.scalingGrid),
    );
    editor.value = formatProblem(currentProblem);
    initialize();
  });
}

const EDITOR_WIDTH_KEY = "geometry-lab:editor-width";

function editorWidthBounds(): { min: number; max: number } {
  const sidebar = workspace.querySelector<HTMLElement>(".sidebar");
  const sidebarWidth = sidebar?.getBoundingClientRect().width ?? 220;
  return {
    min: 320,
    max: Math.max(320, workspace.getBoundingClientRect().width - sidebarWidth - 430),
  };
}

function setEditorWidth(width: number, persist = true): void {
  const bounds = editorWidthBounds();
  const clamped = Math.round(Math.min(bounds.max, Math.max(bounds.min, width)));
  workspace.style.setProperty("--editor-width", `${clamped}px`);
  editorResizer.setAttribute("aria-valuemin", String(bounds.min));
  editorResizer.setAttribute("aria-valuemax", String(bounds.max));
  editorResizer.setAttribute("aria-valuenow", String(clamped));
  if (persist) localStorage.setItem(EDITOR_WIDTH_KEY, String(clamped));
}

const savedEditorWidth = Number(localStorage.getItem(EDITOR_WIDTH_KEY));
if (Number.isFinite(savedEditorWidth) && savedEditorWidth > 0) {
  setEditorWidth(savedEditorWidth, false);
} else {
  setEditorWidth(420, false);
}

editorResizer.addEventListener("pointerdown", (event) => {
  if (window.matchMedia("(max-width: 1180px)").matches) return;
  event.preventDefault();
  editorResizer.setPointerCapture(event.pointerId);
  document.body.classList.add("resizing-editor");
});

editorResizer.addEventListener("pointermove", (event) => {
  if (!editorResizer.hasPointerCapture(event.pointerId)) return;
  setEditorWidth(workspace.getBoundingClientRect().right - event.clientX);
});

function finishEditorResize(event: PointerEvent): void {
  if (editorResizer.hasPointerCapture(event.pointerId)) {
    editorResizer.releasePointerCapture(event.pointerId);
  }
  document.body.classList.remove("resizing-editor");
}

editorResizer.addEventListener("pointerup", finishEditorResize);
editorResizer.addEventListener("pointercancel", finishEditorResize);
editorResizer.addEventListener("keydown", (event) => {
  const current = Number(editorResizer.getAttribute("aria-valuenow")) || 400;
  const bounds = editorWidthBounds();
  let next: number | undefined;
  if (event.key === "ArrowLeft") next = current + 24;
  if (event.key === "ArrowRight") next = current - 24;
  if (event.key === "Home") next = bounds.min;
  if (event.key === "End") next = bounds.max;
  if (next === undefined) return;
  event.preventDefault();
  setEditorWidth(next);
});

const tutorialRoot = element("#tutorials");
const tutorialById = new Map(TUTORIALS.map((tutorial) => [tutorial.id, tutorial]));

for (const section of TUTORIAL_SECTIONS) {
  const details = document.createElement("details");
  details.className = "tour-section";
  details.name = "tour-sections";
  details.open = requestedTutorial
    ? section.tutorialIds.includes(requestedTutorial.id)
    : section.initiallyOpen ?? false;

  const summary = document.createElement("summary");
  summary.className = "tour-summary";
  const marker = document.createElement("span");
  marker.className = "tour-marker";
  marker.textContent = section.marker;
  const copy = document.createElement("span");
  const heading = document.createElement("strong");
  heading.textContent = section.title;
  const description = document.createElement("small");
  description.textContent = section.description;
  copy.append(heading, description);
  summary.append(marker, copy);

  const lessons = document.createElement("div");
  lessons.className = "lesson-list";
  const explainer = document.createElement("div");
  explainer.className = "section-explainer";
  explainer.innerHTML = `
    <span>CHAPTER QUESTION</span>
    <strong>${section.explainer.question}</strong>
    <p>${section.explainer.idea}</p>
    <small><b>TRY</b> ${section.explainer.experiment}</small>
  `;
  lessons.append(explainer);
  for (const tutorialId of section.tutorialIds) {
    const tutorial = tutorialById.get(tutorialId);
    if (!tutorial) continue;
    const button = document.createElement("button");
    button.className = "tutorial-card";
    const title = document.createElement("strong");
    title.textContent = tutorial.title;
    const question = document.createElement("span");
    question.textContent = tutorial.question;
    button.append(title, question);
    button.addEventListener("click", () => {
      const url = new URL(location.href);
      url.searchParams.set("lesson", tutorial.id);
      window.history.replaceState(null, "", url);
      activeTutorialId = tutorial.id;
      editor.value = formatProblem(tutorial.problem);
      initialize();
    });
    lessons.append(button);
  }
  if (section.id === "hodge-representations") {
    const decPlayground = document.createElement("a");
    decPlayground.className = "tutorial-card observatory-link";
    decPlayground.href = "./dec-playground.html";
    const decTitle = document.createElement("strong");
    decTitle.textContent = "DEC · Forms and operators ↗";
    const decQuestion = document.createElement("span");
    decQuestion.textContent =
      "Move a cochain through d and ⋆, then inspect the picture, sparse matrix, and induced energy.";
    decPlayground.append(decTitle, decQuestion);
    explainer.after(decPlayground);

    const representationPlayground = document.createElement("a");
    representationPlayground.className = "tutorial-card observatory-link representation-workshop-link";
    representationPlayground.href = "./representations.html";
    const representationTitle = document.createElement("strong");
    representationTitle.textContent = "Representation transfer observatory ↗";
    const representationQuestion = document.createElement("span");
    representationQuestion.textContent =
      "Start from one native vertex field, then expose every transfer to edge 1-forms and face vectors.";
    representationPlayground.append(representationTitle, representationQuestion);
    decPlayground.after(representationPlayground);
  }
  if (section.id === "integrable-projection") {
    const observatory = document.createElement("a");
    observatory.className = "tutorial-card observatory-link";
    observatory.href = "./vertex-curl.html";
    const title = document.createElement("strong");
    title.textContent = "10 · Curl observatory ↗";
    const question = document.createElement("span");
    question.textContent =
      "Compare primal/dual curl and intrinsic/extrinsic connection errors over refinement.";
    observatory.append(title, question);
    lessons.append(observatory);

    const energyWorkshop = document.createElement("a");
    energyWorkshop.className = "tutorial-card observatory-link energy-workshop-link";
    energyWorkshop.href = "./energy-playground.html";
    const energyTitle = document.createElement("strong");
    energyTitle.textContent = "11 · Live unit-energy workshop ↗";
    const energyQuestion = document.createElement("span");
    energyQuestion.textContent =
      "Rewrite the per-vertex energy, compare it with triangle circulation, and share the result as a URL.";
    energyWorkshop.append(energyTitle, energyQuestion);
    lessons.append(energyWorkshop);

    const stripeWorkshop = document.createElement("a");
    stripeWorkshop.className = "tutorial-card observatory-link stripe-workshop-link";
    stripeWorkshop.href = "./energy-playground.html#stripe-projection";
    stripeWorkshop.innerHTML = "<strong>12 · Rescaled projection / stripes ↗</strong><span>Solve for a phase and a scalar rescaling so its level sets become a stripe pattern.</span>";
    lessons.append(stripeWorkshop);
  }
  details.append(summary, lessons);
  tutorialRoot.append(details);
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
      sourceFiles: currentSourceFiles(),
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
  if (record) {
    editor.value = record.source;
    localStorage.setItem("geometry-lab:draft", record.source);
    restoreSourceFiles(record.sourceFiles);
    try {
      currentProblem = parseProblem(record.source);
      sourceKind = sourceKindForProblem(currentProblem);
      callbackEditor.value =
        localStorage.getItem(sourceStorageKey(sourceKind)) ??
        compiledSources[sourceKind].source;
      renderCallbackHighlight();
      updateKernelUI();
      updateSourceState();
      setStatus(`Loaded “${record.name}”. Choose Reset + build to run it.`, "good");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), "bad");
    }
  }
});

element<HTMLButtonElement>("#export-repo").addEventListener("click", async () => {
  try {
    const { downloadRepositoryArchive } = await import("./core/repository-export");
    const problem = readEditor();
    await downloadRepositoryArchive(
      problem,
      currentSourceFiles(),
    );
    setStatus("Downloaded experiment files and local rebuild instructions.", "good");
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

function isLocalBridgeCapabilities(value: unknown): value is LocalBridgeCapabilities {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<LocalBridgeCapabilities>;
  return (
    candidate.mode === "connected" &&
    typeof candidate.workspace === "string" &&
    typeof candidate.actions?.openPolyscope === "boolean" &&
    typeof candidate.actions?.buildNativeVertexField === "boolean"
  );
}

async function checkLocalBridge(): Promise<void> {
  try {
    const response = await fetch("/api/local-capabilities", {
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) {
      return;
    }
    const capabilities: unknown = await response.json();
    if (!isLocalBridgeCapabilities(capabilities)) return;
    localBridge = capabilities;
    localMode.textContent = "local bridge";
    localMode.dataset.kind = "connected";
    connectedNote.innerHTML = capabilities.actions.openPolyscope
      ? "Connected mode: JSON weights remain live; edited vertex callbacks can be compiled into the native TinyAD target and opened in Polyscope. Builds use the fixed <code>.lab-workspace/current</code> scratch project."
      : "Connected mode: edited vertex callbacks can be compiled into the native TinyAD target. Add <code>--viewer</code> when starting the bridge to open saved snapshots in Polyscope.";
    updateKernelUI();
    updateSourceState();
  } catch {
    // A static host intentionally has no orchestration endpoint.
  }
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

buildNativeButton.addEventListener("click", async () => {
  try {
    const problem = readEditor();
    if (problem.kernel !== "vertex-field") {
      throw new Error("The connected native target currently supports vertex fields only.");
    }
    const approved = window.confirm(
      "Compile the edited callback and launch the native Polyscope experiment? This executes the fixed local CMake target.",
    );
    if (!approved) return;
    buildNativeButton.disabled = true;
    setStatus("Configuring and compiling the native TinyAD experiment…");
    const response = await fetch("/api/native-project", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ problem, sourceFiles: currentSourceFiles() }),
    });
    if (!response.ok) {
      const explanation = (await response.text()).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      throw new Error(explanation || `Native build failed (${response.status}).`);
    }
    setStatus(
      "Native TinyAD build complete; the Polyscope experiment was launched from the scratch workspace.",
      "good",
    );
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), "bad");
  } finally {
    buildNativeButton.disabled = Boolean(buildNativeButton.hidden);
  }
});

downloadRebuildButton.addEventListener("click", async () => {
  try {
    const problem = readEditor();
    downloadRebuildButton.disabled = true;
    const { downloadRepositoryArchive } = await import("./core/repository-export");
    await downloadRepositoryArchive(problem, currentSourceFiles());
    setStatus("Downloaded the problem and edited callbacks for a local rebuild.", "good");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), "bad");
  } finally {
    downloadRebuildButton.disabled = false;
  }
});

void refreshWorkspaces();
void checkLocalBridge();
setConfigMode(configMode);
renderCallbackHighlight();
updateSourceState();
updateKernelUI();
scheduleAutosave();
