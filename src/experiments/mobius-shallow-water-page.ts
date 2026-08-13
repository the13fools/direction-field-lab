import "./mobius-shallow-water.css";
import "katex/dist/katex.min.css";

import katex from "katex";
import {
  MOBIUS_PERIOD,
  MobiusShallowWaterModel,
  mobiusCenterlineParallelFrame,
  mobiusPosition,
  mobiusTangentR,
  mobiusTangentS,
  type MobiusWaterPreset,
} from "./mobius-shallow-water-model";

type DisplayField = "depth" | "vorticity" | "pv" | "speed";
type DisplayView = "embedded" | "cover";
type Vec3 = [number, number, number];

interface ProjectedPoint {
  x: number;
  y: number;
  depth: number;
}

interface SurfaceCell {
  points: ProjectedPoint[];
  depth: number;
  color: string;
}

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as T;
}

function renderLatex(element: HTMLElement, source: string, displayMode = false): void {
  katex.render(source, element, {
    displayMode,
    output: "htmlAndMathml",
    throwOnError: false,
  });
}

for (const element of document.querySelectorAll<HTMLElement>("[data-latex]")) {
  renderLatex(element, element.dataset.latex!, element.classList.contains("ms-math-display"));
}

const canvas = byId<HTMLCanvasElement>("ms-canvas");
const canvasContext = canvas.getContext("2d");
if (!canvasContext) throw new Error("Canvas 2D is unavailable");
const context: CanvasRenderingContext2D = canvasContext;

const gravityInput = byId<HTMLInputElement>("ms-gravity");
const depthInput = byId<HTMLInputElement>("ms-depth");
const amplitudeInput = byId<HTMLInputElement>("ms-amplitude");
const stepsInput = byId<HTMLInputElement>("ms-steps");
const frameInput = byId<HTMLInputElement>("ms-frame");
const playButton = byId<HTMLButtonElement>("ms-play");
const viewButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-ms-view]")];
const fieldButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-ms-field]")];
const presetButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-ms-preset]")];

let preset: MobiusWaterPreset = "seam-pulse";
let displayField: DisplayField = "depth";
let displayView: DisplayView = "embedded";
let model = new MobiusShallowWaterModel();
let playing = false;
let animationFrame = 0;
let previousFrame = 0;
let cameraYaw = -0.42;
let cameraPitch = 0.91;
let cameraZoom = 1;
let dragging = false;
let dragX = 0;
let dragY = 0;
let manualFrame = false;

function format(value: number, digits = 3): string {
  if (!Number.isFinite(value)) return "—";
  if (Math.abs(value) < 0.5 * 10 ** -digits) return (0).toFixed(digits);
  return value.toFixed(digits).replaceAll("-", "−");
}

function formatDrift(value: number): string {
  if (Math.abs(value) < 1e-12) return "< 1e−12";
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toExponential(2).replace("e-", "e−")}`;
}

function resizeCanvas(): { width: number; height: number } {
  const bounds = canvas.getBoundingClientRect();
  const width = Math.max(1, bounds.width);
  const height = Math.max(1, bounds.height);
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const pixelWidth = Math.round(width * ratio);
  const pixelHeight = Math.round(height * ratio);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { width, height };
}

function mix(left: readonly number[], right: readonly number[], amount: number): string {
  const t = Math.max(0, Math.min(1, amount));
  const values = left.map((value, index) => Math.round(value + t * (right[index]! - value)));
  return `rgb(${values[0]},${values[1]},${values[2]})`;
}

const NEGATIVE = [255, 117, 64] as const;
const NEUTRAL = [21, 48, 70] as const;
const POSITIVE = [88, 224, 232] as const;
const GOLD = [255, 210, 106] as const;

function percentileAbsolute(values: Float64Array, fraction: number): number {
  const sorted = Array.from(values, (value) => Math.abs(value)).sort((a, b) => a - b);
  return Math.max(1e-8, sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))]!);
}

function fieldData(): { values: Float64Array; scale: number; signed: boolean; twisted: boolean } {
  if (displayField === "vorticity") {
    const values = model.vorticityField();
    return { values, scale: percentileAbsolute(values, 0.97), signed: true, twisted: true };
  }
  if (displayField === "pv") {
    const values = model.potentialVorticityField();
    return { values, scale: percentileAbsolute(values, 0.97), signed: true, twisted: true };
  }
  if (displayField === "speed") {
    const values = model.speedField();
    const sorted = Array.from(values).sort((a, b) => a - b);
    return {
      values,
      scale: Math.max(1e-8, sorted[Math.min(sorted.length - 1, Math.floor(0.97 * sorted.length))]!),
      signed: false,
      twisted: false,
    };
  }
  const values = model.depthField();
  const deviations = Float64Array.from(values, (value) => value - model.parameters.meanDepth);
  return {
    values,
    scale: Math.max(0.035, percentileAbsolute(deviations, 0.98)),
    signed: true,
    twisted: false,
  };
}

function fieldColor(value: number, scale: number, signed: boolean): string {
  if (!signed) return mix(NEUTRAL, GOLD, Math.min(1, value / scale));
  const centered = displayField === "depth" ? value - model.parameters.meanDepth : value;
  const normalized = Math.max(-1, Math.min(1, centered / scale));
  return normalized < 0
    ? mix(NEUTRAL, NEGATIVE, -normalized)
    : mix(NEUTRAL, POSITIVE, normalized);
}

function rotate(point: Vec3): Vec3 {
  const yawCosine = Math.cos(cameraYaw);
  const yawSine = Math.sin(cameraYaw);
  const pitchCosine = Math.cos(cameraPitch);
  const pitchSine = Math.sin(cameraPitch);
  const x = yawCosine * point[0] - yawSine * point[1];
  const y = yawSine * point[0] + yawCosine * point[1];
  return [x, pitchCosine * y - pitchSine * point[2], pitchSine * y + pitchCosine * point[2]];
}

function project(point: Vec3, width: number, height: number): ProjectedPoint {
  const rotated = rotate(point);
  const scale = cameraZoom * Math.min(width / 4.8, height / 3.4);
  return {
    x: width / 2 + scale * rotated[0],
    y: height / 2 - scale * rotated[1],
    depth: rotated[2],
  };
}

function normalize(vector: Vec3): Vec3 {
  const length = Math.hypot(...vector);
  return length > 1e-12
    ? [vector[0] / length, vector[1] / length, vector[2] / length]
    : [0, 0, 0];
}

function addScaled(point: Vec3, vector: Vec3, scale: number): Vec3 {
  return [
    point[0] + scale * vector[0],
    point[1] + scale * vector[1],
    point[2] + scale * vector[2],
  ];
}

function drawScreenArrow(start: ProjectedPoint, end: ProjectedPoint, color: string, lineWidth = 2): void {
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const head = 6 + lineWidth;
  context.beginPath();
  context.moveTo(start.x, start.y);
  context.lineTo(end.x, end.y);
  context.strokeStyle = color;
  context.lineWidth = lineWidth;
  context.lineCap = "round";
  context.stroke();
  context.beginPath();
  context.moveTo(end.x, end.y);
  context.lineTo(end.x - head * Math.cos(angle - Math.PI / 6), end.y - head * Math.sin(angle - Math.PI / 6));
  context.lineTo(end.x - head * Math.cos(angle + Math.PI / 6), end.y - head * Math.sin(angle + Math.PI / 6));
  context.closePath();
  context.fillStyle = color;
  context.fill();
}

function drawEmbedded(width: number, height: number): void {
  const { values, scale, signed } = fieldData();
  const { columns, rows, halfWidth, majorRadius } = model.parameters;
  const cells: SurfaceCell[] = [];
  for (let row = 0; row < rows; row += 1) {
    const r0 = -halfWidth + row * model.dr;
    const r1 = r0 + model.dr;
    for (let column = 0; column < columns; column += 1) {
      const s0 = column * model.ds;
      const s1 = s0 + model.ds;
      const points = [
        project(mobiusPosition(s0, r0, majorRadius), width, height),
        project(mobiusPosition(s1, r0, majorRadius), width, height),
        project(mobiusPosition(s1, r1, majorRadius), width, height),
        project(mobiusPosition(s0, r1, majorRadius), width, height),
      ];
      const index = row * columns + column;
      cells.push({
        points,
        depth: points.reduce((sum, point) => sum + point.depth, 0) / points.length,
        color: fieldColor(values[index]!, scale, signed),
      });
    }
  }
  cells.sort((left, right) => left.depth - right.depth);
  for (const cell of cells) {
    context.beginPath();
    context.moveTo(cell.points[0]!.x, cell.points[0]!.y);
    for (let index = 1; index < cell.points.length; index += 1) {
      context.lineTo(cell.points[index]!.x, cell.points[index]!.y);
    }
    context.closePath();
    context.fillStyle = cell.color;
    context.fill();
    context.strokeStyle = cell.color;
    context.lineWidth = 0.7;
    context.stroke();
  }

  context.globalAlpha = 0.34;
  context.strokeStyle = "#d8f1ee";
  context.lineWidth = 0.8;
  for (let row = 0; row <= rows; row += 4) {
    const r = -halfWidth + row * model.dr;
    context.beginPath();
    for (let column = 0; column <= columns; column += 1) {
      const point = project(mobiusPosition(column * model.ds, r, majorRadius), width, height);
      if (column === 0) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    }
    context.stroke();
  }
  for (let column = 0; column < columns; column += 7) {
    context.beginPath();
    for (let row = 0; row <= rows; row += 1) {
      const r = -halfWidth + row * model.dr;
      const point = project(mobiusPosition(column * model.ds, r, majorRadius), width, height);
      if (row === 0) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    }
    context.stroke();
  }
  context.globalAlpha = 1;

  for (let row = 2; row < rows; row += 5) {
    for (let column = 2; column < columns; column += 8) {
      const sample = model.sample(column, row);
      if (sample.speed < 0.006) continue;
      const { s, r } = model.coordinate(column, row);
      const point = mobiusPosition(s, r, majorRadius);
      const tangentS = mobiusTangentS(s, r, majorRadius);
      const tangentR = mobiusTangentR(s);
      const velocity: Vec3 = [
        sample.velocityS * tangentS[0] + sample.velocityR * tangentR[0],
        sample.velocityS * tangentS[1] + sample.velocityR * tangentR[1],
        sample.velocityS * tangentS[2] + sample.velocityR * tangentR[2],
      ];
      const direction = normalize(velocity);
      drawScreenArrow(
        project(point, width, height),
        project(addScaled(point, direction, 0.12 + 0.08 * Math.min(1, sample.speed)), width, height),
        "rgba(255,248,214,.82)",
        1.2,
      );
    }
  }

  const turns = Number(frameInput.value);
  const frameS = turns * MOBIUS_PERIOD;
  const framePoint = mobiusPosition(frameS, 0, majorRadius);
  const transportedFrame = mobiusCenterlineParallelFrame(frameS, majorRadius);
  const longitudinal = transportedFrame.longitudinal;
  const transverse = transportedFrame.transverse;
  const frameStart = project(framePoint, width, height);
  drawScreenArrow(frameStart, project(addScaled(framePoint, longitudinal, 0.35), width, height), "#58e0e8", 3);
  drawScreenArrow(frameStart, project(addScaled(framePoint, transverse, 0.35), width, height), "#ff7540", 3);
  context.beginPath();
  context.arc(frameStart.x, frameStart.y, 5, 0, 2 * Math.PI);
  context.fillStyle = "#ffd26a";
  context.fill();
  context.fillStyle = "#f4f7f1";
  context.font = "800 9px SFMono-Regular, Consolas, monospace";
  context.textAlign = "left";
  context.fillText(turns >= 1 && turns < 2 ? "e₂ reflected" : turns >= 2 ? "e₂ restored" : "transported frame", frameStart.x + 11, frameStart.y - 10);
  context.fillStyle = "#9eb0bf";
  context.font = "700 8px SFMono-Regular, Consolas, monospace";
  context.fillText("drag to orbit · wheel to zoom", 14, height - 15);
}

function drawCoverPanel(
  panelLeft: number,
  panelTop: number,
  panelWidth: number,
  panelHeight: number,
  sheet: 0 | 1,
  values: Float64Array,
  scale: number,
  signed: boolean,
  twisted: boolean,
): void {
  const { columns, rows } = model.parameters;
  const cellWidth = panelWidth / columns;
  const cellHeight = panelHeight / rows;
  for (let row = 0; row < rows; row += 1) {
    const sourceRow = sheet === 0 ? row : rows - 1 - row;
    for (let column = 0; column < columns; column += 1) {
      const index = sourceRow * columns + column;
      const sign = sheet === 1 && twisted ? -1 : 1;
      context.fillStyle = fieldColor(sign * values[index]!, scale, signed);
      context.fillRect(
        panelLeft + column * cellWidth,
        panelTop + (rows - 1 - row) * cellHeight,
        cellWidth + 0.5,
        cellHeight + 0.5,
      );
    }
  }

  context.strokeStyle = "rgba(225,241,239,.35)";
  context.lineWidth = 0.8;
  for (let column = 0; column <= columns; column += 7) {
    const x = panelLeft + column * cellWidth;
    context.beginPath();
    context.moveTo(x, panelTop);
    context.lineTo(x, panelTop + panelHeight);
    context.stroke();
  }
  for (let row = 0; row <= rows; row += 4) {
    const y = panelTop + row * cellHeight;
    context.beginPath();
    context.moveTo(panelLeft, y);
    context.lineTo(panelLeft + panelWidth, y);
    context.stroke();
  }

  context.strokeStyle = "#e3f0ef";
  context.lineWidth = 1.5;
  context.strokeRect(panelLeft, panelTop, panelWidth, panelHeight);
  context.fillStyle = sheet === 0 ? "#58e0e8" : "#ff7540";
  context.font = "800 9px SFMono-Regular, Consolas, monospace";
  context.textAlign = "left";
  context.fillText(sheet === 0 ? "SHEET A · chosen orientation" : "SHEET B · reflected orientation", panelLeft, panelTop - 12);

  for (let row = 2; row < rows; row += 5) {
    const sourceRow = sheet === 0 ? row : rows - 1 - row;
    for (let column = 3; column < columns; column += 9) {
      const sample = model.sample(column, sourceRow);
      const velocityS = sample.velocityS;
      const velocityR = sheet === 0 ? sample.velocityR : -sample.velocityR;
      const length = Math.hypot(velocityS, velocityR);
      if (length < 0.006) continue;
      const start = {
        x: panelLeft + (column + 0.5) * cellWidth,
        y: panelTop + (rows - row - 0.5) * cellHeight,
        depth: 0,
      };
      const visualScale = 10 + 8 * Math.min(1, length);
      const end = {
        x: start.x + visualScale * velocityS / length,
        y: start.y - visualScale * velocityR / length,
        depth: 0,
      };
      drawScreenArrow(start, end, "rgba(255,248,214,.78)", 1.1);
    }
  }
}

function drawCover(width: number, height: number): void {
  const { values, scale, signed, twisted } = fieldData();
  const sideBySide = width >= 720;
  const gap = sideBySide ? 46 : 54;
  const panelWidth = sideBySide ? (width - 68 - gap) / 2 : width - 74;
  const panelHeight = sideBySide ? Math.min(height * 0.66, panelWidth * 0.55) : Math.min((height - 150 - gap) / 2, panelWidth * 0.48);
  const firstLeft = sideBySide ? 34 : 37;
  const firstTop = sideBySide ? (height - panelHeight) / 2 : 62;
  const secondLeft = sideBySide ? firstLeft + panelWidth + gap : firstLeft;
  const secondTop = sideBySide ? firstTop : firstTop + panelHeight + gap;

  drawCoverPanel(firstLeft, firstTop, panelWidth, panelHeight, 0, values, scale, signed, twisted);
  drawCoverPanel(secondLeft, secondTop, panelWidth, panelHeight, 1, values, scale, signed, twisted);

  context.fillStyle = "#ffd26a";
  context.font = "800 9px SFMono-Regular, Consolas, monospace";
  context.textAlign = "center";
  if (sideBySide) {
    context.fillText("τ : r ↦ −r", firstLeft + panelWidth + gap / 2, firstTop + panelHeight / 2);
  } else {
    context.fillText("deck map τ : (s,r) ↦ (s+2π,−r)", width / 2, firstTop + panelHeight + 28);
  }

  const turns = Number(frameInput.value);
  const wrappedTurns = turns >= 2 ? 0 : turns;
  const sheet: 0 | 1 = wrappedTurns >= 1 ? 1 : 0;
  const localTurn = sheet === 0 ? wrappedTurns : wrappedTurns - 1;
  const left = sheet === 0 ? firstLeft : secondLeft;
  const top = sheet === 0 ? firstTop : secondTop;
  const start = { x: left + localTurn * panelWidth, y: top + panelHeight / 2, depth: 0 };
  const connectionAngle = 2 * Math.sin(Math.PI * turns);
  const transverseScreenSign = sheet === 0 ? -1 : 1;
  drawScreenArrow(start, {
    x: start.x + 34 * Math.cos(connectionAngle),
    y: start.y + 34 * transverseScreenSign * Math.sin(connectionAngle),
    depth: 0,
  }, "#58e0e8", 3);
  drawScreenArrow(start, {
    x: start.x - 34 * Math.sin(connectionAngle),
    y: start.y + 34 * transverseScreenSign * Math.cos(connectionAngle),
    depth: 0,
  }, "#ff7540", 3);
  context.beginPath();
  context.arc(start.x, start.y, 5, 0, 2 * Math.PI);
  context.fillStyle = "#ffd26a";
  context.fill();
  context.fillStyle = "#9db0c0";
  context.font = "700 8px SFMono-Regular, Consolas, monospace";
  context.textAlign = "left";
  context.fillText("the two rectangles are one oriented cylinder", 14, height - 14);
}

function draw(): void {
  const { width, height } = resizeCanvas();
  context.clearRect(0, 0, width, height);
  const background = context.createRadialGradient(width * 0.48, height * 0.45, 0, width * 0.48, height * 0.45, Math.max(width, height) * 0.75);
  background.addColorStop(0, "#173550");
  background.addColorStop(0.62, "#0a1b2b");
  background.addColorStop(1, "#060f1a");
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);
  if (displayView === "embedded") drawEmbedded(width, height);
  else drawCover(width, height);
}

function frameLabel(turns: number): string {
  if (turns >= 1.995) return `${turns.toFixed(2)} laps · restored`;
  if (turns >= 0.995) return `${turns.toFixed(2)} laps · reflected`;
  return `${turns.toFixed(2)} laps`;
}

function updateReadout(): void {
  const diagnostics = model.diagnostics();
  byId("ms-time").textContent = format(model.time, 3);
  byId("ms-mass").textContent = formatDrift(diagnostics.massDrift);
  byId("ms-energy").textContent = formatDrift(diagnostics.energyDrift);
  byId("ms-min-depth").textContent = format(diagnostics.minimumDepth, 4);
  byId("ms-circulation").textContent = format(diagnostics.boundaryCirculation, 4);
  byId("ms-circulation-drift").textContent = formatDrift(diagnostics.circulationDrift);
  byId("ms-vorticity").textContent = format(diagnostics.vorticityRms, 4);
  byId("ms-seam").textContent = diagnostics.seamConstraint === 0 ? "exact by construction" : format(diagnostics.seamConstraint, 4);
  byId<HTMLOutputElement>("ms-gravity-output").value = format(Number(gravityInput.value), 2);
  byId<HTMLOutputElement>("ms-depth-output").value = format(Number(depthInput.value), 2);
  byId<HTMLOutputElement>("ms-amplitude-output").value = format(Number(amplitudeInput.value), 2);
  byId<HTMLOutputElement>("ms-steps-output").value = stepsInput.value;
  byId<HTMLOutputElement>("ms-frame-output").value = frameLabel(Number(frameInput.value));
  canvas.setAttribute("aria-label", `${displayField} for shallow water on a Möbius strip at time ${model.time.toFixed(3)}, shown in the ${displayView} view.`);
}

function resetModel(): void {
  model.reset({
    gravity: Number(gravityInput.value),
    meanDepth: Number(depthInput.value),
    amplitude: Number(amplitudeInput.value),
    preset,
  });
  manualFrame = false;
  frameInput.value = "0";
  updateReadout();
  draw();
}

function setPlaying(next: boolean): void {
  playing = next;
  playButton.textContent = next ? "Pause" : "Play";
  playButton.classList.toggle("active", next);
  playButton.setAttribute("aria-pressed", String(next));
  if (next) {
    previousFrame = 0;
    animationFrame = requestAnimationFrame(tick);
  } else {
    cancelAnimationFrame(animationFrame);
  }
}

function tick(timestamp: number): void {
  if (!playing) return;
  if (previousFrame === 0 || timestamp - previousFrame >= 24) {
    model.step(Number(stepsInput.value));
    if (!manualFrame) frameInput.value = ((0.18 * model.time) % 2).toFixed(2);
    updateReadout();
    draw();
    previousFrame = timestamp;
  }
  if (playing) animationFrame = requestAnimationFrame(tick);
}

for (const button of viewButtons) {
  button.addEventListener("click", () => {
    displayView = button.dataset.msView as DisplayView;
    for (const candidate of viewButtons) {
      const active = candidate === button;
      candidate.classList.toggle("active", active);
      candidate.setAttribute("aria-pressed", String(active));
    }
    byId("ms-stage-kicker").textContent = displayView === "embedded" ? "EMBEDDED STRIP" : "ORIENTED DOUBLE COVER";
    byId("ms-stage-title").textContent = displayView === "embedded"
      ? "depth is color · water is not displaced along a nonexistent global normal"
      : "sheet B is sheet A reflected in r · twisted fields also reverse sign";
    draw();
  });
}

for (const button of fieldButtons) {
  button.addEventListener("click", () => {
    displayField = button.dataset.msField as DisplayField;
    for (const candidate of fieldButtons) {
      const active = candidate === button;
      candidate.classList.toggle("active", active);
      candidate.setAttribute("aria-pressed", String(active));
    }
    draw();
  });
}

for (const button of presetButtons) {
  button.addEventListener("click", () => {
    setPlaying(false);
    preset = button.dataset.msPreset as MobiusWaterPreset;
    for (const candidate of presetButtons) {
      const active = candidate === button;
      candidate.classList.toggle("active", active);
      candidate.setAttribute("aria-pressed", String(active));
    }
    resetModel();
  });
}

for (const input of [gravityInput, depthInput, amplitudeInput]) {
  input.addEventListener("input", () => {
    setPlaying(false);
    resetModel();
  });
}

stepsInput.addEventListener("input", updateReadout);
frameInput.addEventListener("input", () => {
  manualFrame = true;
  updateReadout();
  draw();
});
byId("ms-reset").addEventListener("click", () => {
  setPlaying(false);
  resetModel();
});
byId("ms-step").addEventListener("click", () => {
  setPlaying(false);
  model.step(1);
  if (!manualFrame) frameInput.value = ((0.18 * model.time) % 2).toFixed(2);
  updateReadout();
  draw();
});
playButton.addEventListener("click", () => setPlaying(!playing));

canvas.addEventListener("pointerdown", (event) => {
  if (displayView !== "embedded") return;
  dragging = true;
  dragX = event.clientX;
  dragY = event.clientY;
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener("pointermove", (event) => {
  if (!dragging || displayView !== "embedded") return;
  cameraYaw += 0.008 * (event.clientX - dragX);
  cameraPitch = Math.max(-1.35, Math.min(1.35, cameraPitch + 0.008 * (event.clientY - dragY)));
  dragX = event.clientX;
  dragY = event.clientY;
  draw();
});
canvas.addEventListener("pointerup", (event) => {
  dragging = false;
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
});
canvas.addEventListener("pointercancel", () => { dragging = false; });
canvas.addEventListener("wheel", (event) => {
  if (displayView !== "embedded") return;
  event.preventDefault();
  cameraZoom = Math.max(0.68, Math.min(1.55, cameraZoom * Math.exp(-event.deltaY * 0.001)));
  draw();
}, { passive: false });

playButton.setAttribute("aria-pressed", "false");
new ResizeObserver(draw).observe(canvas);
updateReadout();
draw();
