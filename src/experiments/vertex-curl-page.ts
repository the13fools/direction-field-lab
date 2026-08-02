import "./vertex-curl.css";
import defaultManifest from "../../examples/vertex-curl-baseline.experiment.json";
import algorithmSource from "./vertex-curl.ts?raw";
import adapterSource from "./vertex-curl-adapter.ts?raw";

import { validateExperimentSpec, type ExperimentSpec } from "../core/experiment";
import { highlightTypeScript } from "../ui/code-highlight";
import { runVertexCurlSpec, type VertexCurlAdapterRun } from "./vertex-curl-adapter";
import type { TorusFace, TorusMesh, VertexCurlExperiment } from "./vertex-curl";

const TAU = 2 * Math.PI;

function element<T extends HTMLElement>(selector: string): T {
  const value = document.querySelector<T>(selector);
  if (!value) throw new Error(`Missing UI element ${selector}.`);
  return value;
}

const editor = element<HTMLTextAreaElement>("#experiment-editor");
const presetRail = element<HTMLElement>("#preset-rail");
const runState = element<HTMLElement>("#run-state");
const verdict = element<HTMLOutputElement>("#verdict");
const fileInput = element<HTMLInputElement>("#experiment-file");
const primalCanvas = element<HTMLCanvasElement>("#primal-canvas");
const dualCanvas = element<HTMLCanvasElement>("#dual-canvas");
const connectionCanvas = element<HTMLCanvasElement>("#connection-canvas");
const refinementCanvas = element<HTMLCanvasElement>("#refinement-canvas");
const observatoryGrid = element<HTMLElement>(".obs-grid");
const notebookResizer = element<HTMLElement>("#notebook-resizer");
const operatorSourceView = element<HTMLPreElement>("#operator-source");
const sourceFilename = element<HTMLElement>("#source-filename");

let activePreset = "";
let lastRun: VertexCurlAdapterRun | undefined;
let sourceKind: "adapter" | "operators" = "adapter";

editor.value = `${JSON.stringify(defaultManifest, null, 2)}\n`;

function selectedSource(): { filename: string; source: string } {
  return sourceKind === "adapter"
    ? { filename: "vertex-curl-adapter.ts", source: adapterSource }
    : { filename: "vertex-curl.ts", source: algorithmSource };
}

function renderOperatorSource(): void {
  const selected = selectedSource();
  operatorSourceView.innerHTML = `${highlightTypeScript(selected.source)}\n`;
  sourceFilename.textContent = `${selected.filename} · read-only runtime source`;
  element("#show-adapter-source").classList.toggle("active", sourceKind === "adapter");
  element("#show-operator-source").classList.toggle("active", sourceKind === "operators");
}

renderOperatorSource();

function setText(id: string, value: string): void {
  element(`#${id}`).textContent = value;
}

function format(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return "—";
  if (Math.abs(value) < 1e-14) return "0";
  return value.toExponential(digits);
}

function degrees(value: number): string {
  return `${(value * 180 / Math.PI).toExponential(2)}°`;
}

function readSpec(): ExperimentSpec {
  return validateExperimentSpec(JSON.parse(editor.value) as unknown);
}

function activePresetFor(spec: ExperimentSpec): string | undefined {
  if (spec.presets?.some((preset) => preset.id === activePreset)) return activePreset;
  activePreset = spec.defaultPreset ?? spec.presets?.[0]?.id ?? "";
  return activePreset || undefined;
}

function renderPresets(spec: ExperimentSpec): void {
  presetRail.replaceChildren(...(spec.presets ?? []).map((preset, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "preset-button";
    button.dataset.preset = preset.id;
    button.setAttribute("aria-pressed", String(preset.id === activePreset));
    button.innerHTML = `<b>${String(index + 1).padStart(2, "0")} · ${preset.label}</b><small>${preset.id}</small>`;
    button.addEventListener("click", () => {
      activePreset = preset.id;
      runCurrent();
    });
    return button;
  }));
}

interface FittedCanvas {
  context: CanvasRenderingContext2D;
  width: number;
  height: number;
}

function fitCanvas(canvas: HTMLCanvasElement): FittedCanvas {
  const ratio = Math.min(2, devicePixelRatio || 1);
  const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
  const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D is unavailable.");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { context, width: width / ratio, height: height / ratio };
}

function curlColor(value: number, scale: number): string {
  const amount = Math.sqrt(Math.min(1, Math.abs(value) / Math.max(1e-12, scale)));
  if (value >= 0) {
    return `rgba(${Math.round(48 + 207 * amount)},${Math.round(106 + 94 * amount)},${Math.round(145 + 70 * amount)},${0.17 + 0.76 * amount})`;
  }
  return `rgba(${Math.round(57 + 92 * amount)},${Math.round(108 + 52 * amount)},${Math.round(148 + 100 * amount)},${0.17 + 0.76 * amount})`;
}

function plotTransform(width: number, height: number) {
  const padding = Math.max(28, Math.min(width, height) * 0.07);
  const side = Math.min(width - 2 * padding, height - 2 * padding - 18);
  const left = (width - side) / 2;
  const top = (height - side) / 2 - 6;
  return {
    left,
    top,
    side,
    point: ([u, v]: [number, number]): [number, number] => [
      left + (u / TAU) * side,
      top + (1 - v / TAU) * side,
    ],
  };
}

function prepareCurlCanvas(canvas: HTMLCanvasElement) {
  const fitted = fitCanvas(canvas);
  fitted.context.clearRect(0, 0, fitted.width, fitted.height);
  const gradient = fitted.context.createRadialGradient(
    fitted.width / 2, fitted.height / 2, 0,
    fitted.width / 2, fitted.height / 2, Math.min(fitted.width, fitted.height) * 0.62,
  );
  gradient.addColorStop(0, "rgba(111,255,233,.055)");
  gradient.addColorStop(1, "rgba(4,16,14,0)");
  fitted.context.fillStyle = gradient;
  fitted.context.fillRect(0, 0, fitted.width, fitted.height);
  return { ...fitted, transform: plotTransform(fitted.width, fitted.height) };
}

function drawPlotFrame(
  context: CanvasRenderingContext2D,
  transform: ReturnType<typeof plotTransform>,
  scale: number,
): void {
  context.strokeStyle = "rgba(111,255,233,.22)";
  context.strokeRect(transform.left, transform.top, transform.side, transform.side);
  context.fillStyle = "rgba(226,242,237,.55)";
  context.font = "600 9px ui-monospace, monospace";
  context.fillText("u →", transform.left, transform.top + transform.side + 16);
  context.fillText(`± ${format(scale, 1)}`, transform.left + transform.side - 62, transform.top + transform.side + 16);
}

function polygon(
  context: CanvasRenderingContext2D,
  points: Array<[number, number]>,
  fill: string,
): void {
  context.beginPath();
  points.forEach((point, index) => index === 0
    ? context.moveTo(point[0], point[1])
    : context.lineTo(point[0], point[1]));
  context.closePath();
  context.fillStyle = fill;
  context.fill();
  context.strokeStyle = "rgba(190,255,237,.075)";
  context.lineWidth = 0.55;
  context.stroke();
}

function drawPrimal(experiment: VertexCurlExperiment, commonScale: number): void {
  const { context, transform } = prepareCurlCanvas(primalCanvas);
  experiment.mesh.faces.forEach((face: TorusFace, index) => {
    polygon(context, face.uv.map((point) => transform.point(point)), curlColor(experiment.primal.values[index]!, commonScale));
  });
  drawPlotFrame(context, transform, commonScale);
}

function drawDual(experiment: VertexCurlExperiment, commonScale: number): void {
  const { context, transform } = prepareCurlCanvas(dualCanvas);
  const cell = transform.side / experiment.mesh.resolution;
  for (const vertex of experiment.mesh.vertices) {
    const [x, y] = transform.point([vertex.u, vertex.v]);
    context.fillStyle = curlColor(experiment.dual.values[vertex.index]!, commonScale);
    context.fillRect(x - cell * 0.47, y - cell * 0.47, cell * 0.94, cell * 0.94);
  }
  drawPlotFrame(context, transform, commonScale);
}

function drawConnection(experiment: VertexCurlExperiment): void {
  const { context, width, height } = fitCanvas(connectionCanvas);
  context.clearRect(0, 0, width, height);
  const padding = { left: 46, right: 20, top: 22, bottom: 32 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const rows = experiment.connections.latitude;
  const maximum = Math.max(
    1e-8,
    ...rows.flatMap((row) => [row.extrinsicRms, row.intrinsicRms]),
  );
  context.strokeStyle = "rgba(111,255,233,.1)";
  context.fillStyle = "rgba(226,242,237,.48)";
  context.font = "600 9px ui-monospace, monospace";
  for (let line = 0; line <= 4; line += 1) {
    const y = padding.top + line * chartHeight / 4;
    context.beginPath();
    context.moveTo(padding.left, y);
    context.lineTo(width - padding.right, y);
    context.stroke();
    context.fillText(format(maximum * (1 - line / 4), 1), 5, y + 3);
  }
  const draw = (key: "extrinsicRms" | "intrinsicRms", color: string): void => {
    context.beginPath();
    rows.forEach((row, index) => {
      const x = padding.left + index * chartWidth / Math.max(1, rows.length - 1);
      const y = padding.top + chartHeight * (1 - row[key] / maximum);
      if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
    });
    context.strokeStyle = color;
    context.lineWidth = 2;
    context.stroke();
  };
  draw("extrinsicRms", "#70dcff");
  draw("intrinsicRms", "#d5a6ff");
  context.fillStyle = "#70dcff";
  context.fillText("extrinsic", padding.left, height - 9);
  context.fillStyle = "#d5a6ff";
  context.fillText("intrinsic", padding.left + 78, height - 9);
  context.fillStyle = "rgba(226,242,237,.48)";
  context.fillText("torus latitude v →", Math.max(padding.left + 170, width - 142), height - 9);
}

interface RefinementSeries {
  label: string;
  color: string;
  dash: number[];
  values: number[];
}

function drawRefinementPanel(
  context: CanvasRenderingContext2D,
  frame: { left: number; top: number; width: number; height: number },
  title: string,
  resolutions: number[],
  series: RefinementSeries[],
): void {
  const values = series.flatMap((entry) => entry.values).map((value) => Math.max(1e-16, value));
  const logMin = Math.floor(Math.log10(Math.min(...values)));
  const logMax = Math.max(logMin + 1, Math.ceil(Math.log10(Math.max(...values))));
  const minResolution = Math.min(...resolutions);
  const maxResolution = Math.max(...resolutions);
  const x = (resolution: number): number => {
    if (maxResolution === minResolution) return frame.left + frame.width / 2;
    return frame.left + frame.width * (
      (Math.log(resolution) - Math.log(minResolution)) /
      (Math.log(maxResolution) - Math.log(minResolution))
    );
  };
  const y = (value: number): number => frame.top + frame.height * (
    (logMax - Math.log10(Math.max(1e-16, value))) / (logMax - logMin)
  );

  context.fillStyle = "rgba(238,240,255,.86)";
  context.font = "700 10px ui-monospace, monospace";
  context.fillText(title, frame.left, frame.top - 15);
  context.font = "600 8px ui-monospace, monospace";
  for (let exponent = logMin; exponent <= logMax; exponent += 1) {
    const lineY = y(10 ** exponent);
    context.strokeStyle = "rgba(169,145,214,.14)";
    context.setLineDash([]);
    context.beginPath();
    context.moveTo(frame.left, lineY);
    context.lineTo(frame.left + frame.width, lineY);
    context.stroke();
    context.fillStyle = "rgba(214,204,235,.52)";
    context.fillText(`1e${exponent}`, Math.max(2, frame.left - 32), lineY + 3);
  }
  context.strokeStyle = "rgba(220,205,255,.26)";
  context.strokeRect(frame.left, frame.top, frame.width, frame.height);
  context.fillStyle = "rgba(214,204,235,.52)";
  context.fillText(`${minResolution}`, frame.left, frame.top + frame.height + 16);
  context.fillText(`${maxResolution} grid`, frame.left + frame.width - 42, frame.top + frame.height + 16);

  series.forEach((entry, seriesIndex) => {
    context.strokeStyle = entry.color;
    context.fillStyle = entry.color;
    context.lineWidth = 2;
    context.setLineDash(entry.dash);
    context.beginPath();
    entry.values.forEach((value, index) => {
      const pointX = x(resolutions[index]!);
      const pointY = y(value);
      if (index === 0) context.moveTo(pointX, pointY);
      else context.lineTo(pointX, pointY);
    });
    context.stroke();
    context.setLineDash([]);
    entry.values.forEach((value, index) => {
      const pointX = x(resolutions[index]!);
      const pointY = y(value);
      context.beginPath();
      if (seriesIndex === 0) context.arc(pointX, pointY, 2.6, 0, TAU);
      else context.rect(pointX - 2.5, pointY - 2.5, 5, 5);
      context.fill();
    });
    const legendX = frame.left + seriesIndex * Math.min(120, frame.width * 0.48);
    context.font = "600 8px ui-monospace, monospace";
    context.fillText(entry.label, legendX, frame.top + frame.height + 31);
  });
}

function drawRefinement(run: VertexCurlAdapterRun): void {
  const { context, width, height } = fitCanvas(refinementCanvas);
  context.clearRect(0, 0, width, height);
  const gradient = context.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "rgba(112,220,255,.045)");
  gradient.addColorStop(0.5, "rgba(255,128,200,.035)");
  gradient.addColorStop(1, "rgba(213,166,255,.055)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);

  const resolutions = run.refinement.map((entry) => entry.resolution);
  const stacked = width < 640;
  const outer = { left: 45, right: 18, top: 39, bottom: 47 };
  const gap = stacked ? 70 : 66;
  const panelWidth = stacked
    ? width - outer.left - outer.right
    : (width - outer.left - outer.right - gap) / 2;
  const panelHeight = stacked
    ? (height - outer.top - outer.bottom - gap) / 2
    : height - outer.top - outer.bottom;
  const first = { left: outer.left, top: outer.top, width: panelWidth, height: panelHeight };
  const second = stacked
    ? { left: outer.left, top: outer.top + panelHeight + gap, width: panelWidth, height: panelHeight }
    : { left: outer.left + panelWidth + gap, top: outer.top, width: panelWidth, height: panelHeight };

  drawRefinementPanel(context, first, "CURL TRUTH ERROR", resolutions, [
    { label: "● primal", color: "#70dcff", dash: [], values: run.refinement.map((entry) => entry.experiment.primal.errorRms) },
    { label: "■ dual", color: "#ff80c8", dash: [5, 4], values: run.refinement.map((entry) => entry.experiment.dual.errorRms) },
  ]);
  drawRefinementPanel(context, second, "CONNECTION ANGLE RMS", resolutions, [
    { label: "● extrinsic", color: "#ffd36f", dash: [], values: run.refinement.map((entry) => entry.experiment.connections.extrinsicRms) },
    { label: "■ intrinsic", color: "#d5a6ff", dash: [5, 4], values: run.refinement.map((entry) => entry.experiment.connections.intrinsicRms) },
  ]);
}

function updateMetrics(run: VertexCurlAdapterRun): void {
  const { experiment } = run;
  setText("primal-error", format(experiment.primal.errorRms));
  setText("primal-rms", format(experiment.primal.rms));
  setText("primal-count", experiment.primal.values.length.toLocaleString());
  setText("dual-error", format(experiment.dual.errorRms));
  setText("dual-rms", format(experiment.dual.rms));
  setText("dual-count", experiment.dual.values.length.toLocaleString());
  setText("period-u", format(experiment.periods.u));
  setText("period-v", format(experiment.periods.v));
  setText("truth-rms", format(experiment.primal.truthRms));
  setText("extrinsic-rms", degrees(experiment.connections.extrinsicRms));
  setText("intrinsic-rms", degrees(experiment.connections.intrinsicRms));
  setText("edge-family", experiment.connections.family);
}

function renderVerdict(experiment: VertexCurlExperiment): void {
  const comparison = experiment.dual.errorRms < experiment.primal.errorRms
    ? `The dual-cell truth error is smaller (${format(experiment.dual.errorRms)} vs ${format(experiment.primal.errorRms)}).`
    : `The triangle truth error is smaller (${format(experiment.primal.errorRms)} vs ${format(experiment.dual.errorRms)}).`;
  if (experiment.field.preset === "harmonic") {
    verdict.textContent = `Both local curls approach zero, while periods ${format(experiment.periods.u)} and ${format(experiment.periods.v)} survive. Closed is not globally exact on a torus.`;
  } else if (experiment.field.preset === "gradient") {
    verdict.textContent = `The analytic answer is zero, so every reported curl is discretization leakage. ${comparison}`;
  } else {
    verdict.textContent = `This positive control has nonzero analytic curl. ${comparison}`;
  }
}

function renderRefinement(run: VertexCurlAdapterRun): void {
  const body = element<HTMLTableSectionElement>("#refinement-body");
  body.replaceChildren(...run.refinement.map(({ resolution, experiment }) => {
    const row = document.createElement("tr");
    row.dataset.current = String(resolution === run.options.resolution);
    row.innerHTML = `<td>${resolution} × ${resolution}</td><td>${format(experiment.primal.errorRms)}</td><td>${format(experiment.dual.errorRms)}</td><td>${degrees(experiment.connections.extrinsicRms)}</td><td>${degrees(experiment.connections.intrinsicRms)}</td>`;
    return row;
  }));
}

function renderRun(run: VertexCurlAdapterRun): void {
  lastRun = run;
  renderPresets(run.spec);
  const commonScale = Math.max(
    run.experiment.primal.maxAbs,
    run.experiment.dual.maxAbs,
    run.experiment.primal.truthRms * 1.8,
    1e-7,
  );
  drawPrimal(run.experiment, commonScale);
  drawDual(run.experiment, commonScale);
  drawConnection(run.experiment);
  updateMetrics(run);
  renderVerdict(run.experiment);
  drawRefinement(run);
  renderRefinement(run);
  runState.textContent = `${run.experiment.field.preset} · ${run.options.resolution} × ${run.options.resolution}`;
  runState.dataset.kind = "good";
}

function runCurrent(): void {
  try {
    const spec = readSpec();
    const presetId = activePresetFor(spec);
    renderRun(runVertexCurlSpec(spec, presetId));
  } catch (error) {
    runState.textContent = "manifest rejected";
    runState.dataset.kind = "bad";
    verdict.textContent = error instanceof Error ? error.message : String(error);
  }
}

function download(name: string, text: string, type: string): void {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([text], { type }));
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
}

element<HTMLButtonElement>("#run-experiment").addEventListener("click", runCurrent);
element<HTMLButtonElement>("#import-experiment").addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  try {
    const spec = validateExperimentSpec(JSON.parse(await file.text()) as unknown);
    editor.value = `${JSON.stringify(spec, null, 2)}\n`;
    activePreset = spec.defaultPreset ?? spec.presets?.[0]?.id ?? "";
    runCurrent();
  } catch (error) {
    verdict.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    fileInput.value = "";
  }
});

element<HTMLButtonElement>("#download-result").addEventListener("click", () => {
  if (!lastRun) return;
  const body = JSON.stringify(lastRun.result, (_key, value: unknown) =>
    ArrayBuffer.isView(value) ? Array.from(value as unknown as ArrayLike<number>) : value, 2);
  download(`${lastRun.spec.id}.${lastRun.presetId ?? "default"}.result.json`, `${body}\n`, "application/json");
});

element<HTMLButtonElement>("#show-adapter-source").addEventListener("click", () => {
  sourceKind = "adapter";
  renderOperatorSource();
});
element<HTMLButtonElement>("#show-operator-source").addEventListener("click", () => {
  sourceKind = "operators";
  renderOperatorSource();
});
element<HTMLButtonElement>("#copy-operator-source").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(selectedSource().source);
    verdict.textContent = `Copied ${selectedSource().filename}.`;
  } catch {
    verdict.textContent = "Clipboard access is unavailable; use Download .ts instead.";
  }
});
element<HTMLButtonElement>("#download-operator-source").addEventListener("click", () => {
  const selected = selectedSource();
  download(selected.filename, selected.source, "text/typescript");
});

const NOTEBOOK_WIDTH_KEY = "geometry-lab:curl-notebook-width";

function notebookWidthBounds(): { min: number; max: number } {
  const width = observatoryGrid.getBoundingClientRect().width;
  return { min: 330, max: Math.max(330, width - 560) };
}

function setNotebookWidth(width: number, persist = true): void {
  const bounds = notebookWidthBounds();
  const clamped = Math.round(Math.min(bounds.max, Math.max(bounds.min, width)));
  observatoryGrid.style.setProperty("--notebook-width", `${clamped}px`);
  notebookResizer.setAttribute("aria-valuemin", String(bounds.min));
  notebookResizer.setAttribute("aria-valuemax", String(bounds.max));
  notebookResizer.setAttribute("aria-valuenow", String(clamped));
  if (persist) localStorage.setItem(NOTEBOOK_WIDTH_KEY, String(clamped));
}

function finishNotebookResize(event: PointerEvent): void {
  if (notebookResizer.hasPointerCapture(event.pointerId)) {
    notebookResizer.releasePointerCapture(event.pointerId);
  }
  document.body.classList.remove("resizing-notebook");
  if (lastRun) renderRun(lastRun);
}

const storedNotebookWidth = Number(localStorage.getItem(NOTEBOOK_WIDTH_KEY));
setNotebookWidth(Number.isFinite(storedNotebookWidth) && storedNotebookWidth > 0 ? storedNotebookWidth : 440, false);
notebookResizer.addEventListener("pointerdown", (event) => {
  if (window.matchMedia("(max-width: 900px)").matches) return;
  event.preventDefault();
  notebookResizer.setPointerCapture(event.pointerId);
  document.body.classList.add("resizing-notebook");
});
notebookResizer.addEventListener("pointermove", (event) => {
  if (!notebookResizer.hasPointerCapture(event.pointerId)) return;
  setNotebookWidth(observatoryGrid.getBoundingClientRect().right - event.clientX);
});
notebookResizer.addEventListener("pointerup", finishNotebookResize);
notebookResizer.addEventListener("pointercancel", finishNotebookResize);
notebookResizer.addEventListener("keydown", (event) => {
  const current = Number(notebookResizer.getAttribute("aria-valuenow")) || 440;
  const bounds = notebookWidthBounds();
  let next: number | undefined;
  if (event.key === "ArrowLeft") next = current + 24;
  if (event.key === "ArrowRight") next = current - 24;
  if (event.key === "Home") next = bounds.min;
  if (event.key === "End") next = bounds.max;
  if (next === undefined) return;
  event.preventDefault();
  setNotebookWidth(next);
  if (lastRun) renderRun(lastRun);
});

let resizeFrame = 0;
window.addEventListener("resize", () => {
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => {
    const currentWidth = Number(notebookResizer.getAttribute("aria-valuenow"));
    if (Number.isFinite(currentWidth)) setNotebookWidth(currentWidth, false);
    if (lastRun) renderRun(lastRun);
  });
});

const initialSpec = readSpec();
activePreset = initialSpec.defaultPreset ?? initialSpec.presets?.[0]?.id ?? "";
runCurrent();
