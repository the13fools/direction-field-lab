import "./reversible-line-fluid.css";
import "katex/dist/katex.min.css";

import katex from "katex";
import {
  DEFAULT_REVERSIBLE_LINE_FLUID_PARAMETERS,
  forwardEulerSample,
  integrateReversibleParticleTrace,
  reversibleBranchSample,
  reversibleLineFluidDiagnostics,
  streamFunction,
  tentativeLineBranch,
  projectedLineBranch,
  type ReversibleBranchKind,
  type ReversibleLineFluidParameters,
  type ReversibleParticlePoint,
} from "./reversible-line-fluid-model";

type LabMode = "projection" | "same-time" | "time-reversal";

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface Point {
  x: number;
  y: number;
}

interface ModeCopy {
  stageKicker: string;
  stageTitle: string;
  cardKicker: string;
  cardTitle: string;
  latex: string;
  cardCopy: string;
  verdictTitle: string;
  verdictCopy: string;
}

const TAU = 2 * Math.PI;

const MODE_COPY: Record<LabMode, ModeCopy> = {
  projection: {
    stageKicker: "STEP 1 · SYMMETRIC HODGE PROJECTION",
    stageTitle: "remove the divergent gradient without selecting a preferred root",
    cardKicker: "CO-INTEGRABLE LINE FIELD",
    cardTitle: "Rotate, integrate, rotate back.",
    latex: "\\operatorname{div}u=0\\iff d(*u^\\flat)=0",
    cardCopy: "On an oriented surface, rotate every polyvector root by 90°. An integrable-polyvector solve on those rotated roots becomes a branchwise divergence-free solve after rotating back.",
    verdictTitle: "✓ a symmetric divergence-free projection exists",
    verdictCopy: "The right panel has zero divergence on both roots, and the line itself never chooses an orientation.",
  },
  "same-time": {
    stageKicker: "STEP 2 · THE SAME-TIME TRAP",
    stageTitle: "both roots are divergence-free; only the cyan branch follows Euler",
    cardKicker: "INCOMPRESSIBILITY IS NOT MOMENTUM BALANCE",
    cardTitle: "The nonlinear term keeps its sign.",
    latex: "\\nabla_{-u}(-u)=\\nabla_u u,\\qquad \\partial_t(-u)=-\\partial_tu",
    cardCopy: "The two signs cancel in advection but not in the time derivative. With one shared pressure, simultaneous ± branches can both solve Euler only in the steady exception.",
    verdictTitle: "✕ divergence-free does not mean Euler",
    verdictCopy: "The orange branch is a valid incompressible vector field, but its nonzero momentum residual exposes the failed dynamics.",
  },
  "time-reversal": {
    stageKicker: "STEP 3 · GENUINE TIME REVERSAL",
    stageTitle: "the orange sheet reverses velocity and evaluates the flow at −t",
    cardKicker: "A SPACETIME PAIR, NOT A SAME-TIME LINE",
    cardTitle: "Reverse the movie, not only the arrows.",
    latex: "u^R(x,t)=-u(x,-t),\\qquad p^R(x,t)=p(x,-t)",
    cardCopy: "Identical seed particles on the orange sheet follow the original flow map backward from time zero. Both panels now satisfy the full Euler equation.",
    verdictTitle: "✓ both sheets solve Euler",
    verdictCopy: "The second solution is paired with the first across time: its particle map is the forward map evaluated at −t.",
  },
};

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as T;
}

function renderMath(element: HTMLElement, latex: string): void {
  katex.render(latex, element, {
    displayMode: element.classList.contains("rlf-math-display"),
    output: "htmlAndMathml",
    throwOnError: false,
  });
}

for (const element of document.querySelectorAll<HTMLElement>("[data-latex]")) {
  renderMath(element, element.dataset.latex!);
}

const canvas = byId<HTMLCanvasElement>("rlf-canvas");
const rawContext = canvas.getContext("2d");
if (!rawContext) throw new Error("Canvas 2D is unavailable");
const context: CanvasRenderingContext2D = rawContext;
const modeButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-rlf-mode]")];
const timeInput = byId<HTMLInputElement>("rlf-time");
const amplitudeInput = byId<HTMLInputElement>("rlf-amplitude");
const driftInput = byId<HTMLInputElement>("rlf-drift");
const contaminationInput = byId<HTMLInputElement>("rlf-contamination");
const contaminationLabel = byId<HTMLElement>("rlf-contamination-label");
const playButton = byId<HTMLButtonElement>("rlf-play");

let mode: LabMode = "projection";
let parameters: ReversibleLineFluidParameters = { ...DEFAULT_REVERSIBLE_LINE_FLUID_PARAMETERS };
let time = 0;
let playing = false;
let animationFrame = 0;
let previousTimestamp = 0;

const particleSeeds: ReversibleParticlePoint[] = Array.from({ length: 24 }, (_, index) => ({
  x: TAU * ((0.113 + 0.381966 * index) % 1),
  y: TAU * ((0.247 + 0.618034 * index) % 1),
}));

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

function panelLayout(width: number, height: number): { first: Rect; second: Rect } {
  if (width >= 720) {
    const side = 28;
    const gap = 30;
    const panelWidth = (width - 2 * side - gap) / 2;
    return {
      first: { left: side, top: 58, width: panelWidth, height: height - 91 },
      second: { left: side + panelWidth + gap, top: 58, width: panelWidth, height: height - 91 },
    };
  }
  const side = 24;
  const gap = 64;
  const panelHeight = (height - 105 - gap) / 2;
  return {
    first: { left: side, top: 49, width: width - 2 * side, height: panelHeight },
    second: { left: side, top: 49 + panelHeight + gap, width: width - 2 * side, height: panelHeight },
  };
}

function toScreen(point: ReversibleParticlePoint, panel: Rect): Point {
  return {
    x: panel.left + panel.width * point.x / TAU,
    y: panel.top + panel.height * (1 - point.y / TAU),
  };
}

function drawPanelFrame(panel: Rect, label: string, subtitle: string): void {
  context.fillStyle = "#071623";
  context.fillRect(panel.left, panel.top, panel.width, panel.height);
  context.strokeStyle = "rgba(212,246,239,.78)";
  context.lineWidth = 1.3;
  context.strokeRect(panel.left, panel.top, panel.width, panel.height);
  context.fillStyle = "#58e0e8";
  context.font = "800 8px SFMono-Regular, Consolas, monospace";
  context.fillText(label, panel.left, panel.top - 26);
  context.fillStyle = "rgba(192,208,220,.72)";
  context.font = "700 7px SFMono-Regular, Consolas, monospace";
  context.fillText(subtitle, panel.left, panel.top - 13);
  context.fillStyle = "rgba(192,208,220,.55)";
  context.textAlign = "right";
  context.fillText("periodic x,y", panel.left + panel.width - 5, panel.top + panel.height - 6);
  context.textAlign = "left";
}

function heatColor(value: number, extent: number, alpha = 0.64): string {
  const t = 0.5 + 0.5 * Math.max(-1, Math.min(1, value / Math.max(extent, 1e-8)));
  const red = Math.round(26 + 229 * t);
  const green = Math.round(204 - 91 * t);
  const blue = Math.round(215 - 137 * t);
  return `rgba(${red},${green},${blue},${alpha})`;
}

function drawScalarField(panel: Rect, selector: (x: number, y: number) => number, extent: number, alpha = 0.64): void {
  const columns = 42;
  const rows = 34;
  const cellWidth = panel.width / columns;
  const cellHeight = panel.height / rows;
  for (let row = 0; row < rows; row += 1) {
    const y = TAU * (row + 0.5) / rows;
    for (let column = 0; column < columns; column += 1) {
      const x = TAU * (column + 0.5) / columns;
      context.fillStyle = heatColor(selector(x, y), extent, alpha);
      context.fillRect(panel.left + column * cellWidth, panel.top + (rows - 1 - row) * cellHeight, cellWidth + 0.5, cellHeight + 0.5);
    }
  }
  context.fillStyle = "rgba(7,22,35,.28)";
  context.fillRect(panel.left, panel.top, panel.width, panel.height);
}

function lineCrossing(level: number, aValue: number, bValue: number, a: Point, b: Point): Point | null {
  if ((aValue < level && bValue < level) || (aValue > level && bValue > level) || aValue === bValue) return null;
  const fraction = (level - aValue) / (bValue - aValue);
  if (fraction < 0 || fraction > 1) return null;
  return { x: a.x + fraction * (b.x - a.x), y: a.y + fraction * (b.y - a.y) };
}

function drawStreamContours(panel: Rect, drawTime: number): void {
  const columns = 52;
  const rows = 38;
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (let row = 0; row <= rows; row += 1) {
    const y = TAU * row / rows;
    for (let column = 0; column <= columns; column += 1) {
      const value = streamFunction(TAU * column / columns, y, drawTime, parameters);
      minimum = Math.min(minimum, value);
      maximum = Math.max(maximum, value);
    }
  }
  const levels = Array.from({ length: 10 }, (_, index) => minimum + (index + 1) * (maximum - minimum) / 11);
  context.save();
  context.strokeStyle = "rgba(255,210,106,.56)";
  context.lineWidth = 1.15;
  context.lineCap = "round";
  for (let row = 0; row < rows; row += 1) {
    const y0 = TAU * row / rows;
    const y1 = TAU * (row + 1) / rows;
    for (let column = 0; column < columns; column += 1) {
      const x0 = TAU * column / columns;
      const x1 = TAU * (column + 1) / columns;
      const world = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }] as const;
      const points = world.map((point) => toScreen(point, panel));
      const values = world.map((point) => streamFunction(point.x, point.y, drawTime, parameters));
      for (const level of levels) {
        const hits: Point[] = [];
        for (const [first, second] of [[0, 1], [1, 2], [2, 3], [3, 0]] as const) {
          const hit = lineCrossing(level, values[first]!, values[second]!, points[first]!, points[second]!);
          if (hit) hits.push(hit);
        }
        if (hits.length === 2 || hits.length === 4) {
          for (let index = 0; index < hits.length; index += 2) {
            context.beginPath();
            context.moveTo(hits[index]!.x, hits[index]!.y);
            context.lineTo(hits[index + 1]!.x, hits[index + 1]!.y);
            context.stroke();
          }
        }
      }
    }
  }
  context.restore();
}

function drawLineGlyph(point: Point, velocity: readonly [number, number], panel: Rect, color: string): void {
  const magnitude = Math.hypot(velocity[0], velocity[1]);
  if (magnitude < 1e-7) return;
  const length = Math.min(15, 7 + 6 * magnitude);
  const dx = length * velocity[0] / magnitude;
  const dy = -length * velocity[1] / magnitude;
  context.beginPath();
  context.moveTo(point.x - dx, point.y - dy);
  context.lineTo(point.x + dx, point.y + dy);
  context.strokeStyle = color;
  context.lineWidth = Math.max(1.2, Math.min(2.2, panel.width / 260));
  context.lineCap = "round";
  context.stroke();
  context.beginPath();
  context.arc(point.x, point.y, 1.5, 0, TAU);
  context.fillStyle = color;
  context.fill();
}

function drawArrow(point: Point, velocity: readonly [number, number], color: string): void {
  const magnitude = Math.hypot(velocity[0], velocity[1]);
  if (magnitude < 1e-7) return;
  const length = Math.min(24, 11 + 8 * magnitude);
  const dx = length * velocity[0] / magnitude;
  const dy = -length * velocity[1] / magnitude;
  const end = { x: point.x + dx, y: point.y + dy };
  const angle = Math.atan2(dy, dx);
  context.beginPath();
  context.moveTo(point.x - 0.35 * dx, point.y - 0.35 * dy);
  context.lineTo(end.x, end.y);
  context.strokeStyle = color;
  context.lineWidth = 1.55;
  context.lineCap = "round";
  context.stroke();
  context.beginPath();
  context.moveTo(end.x, end.y);
  context.lineTo(end.x - 5.5 * Math.cos(angle - Math.PI / 6), end.y - 5.5 * Math.sin(angle - Math.PI / 6));
  context.lineTo(end.x - 5.5 * Math.cos(angle + Math.PI / 6), end.y - 5.5 * Math.sin(angle + Math.PI / 6));
  context.closePath();
  context.fillStyle = color;
  context.fill();
}

function drawGlyphGrid(
  panel: Rect,
  sample: (x: number, y: number) => readonly [number, number],
  kind: "line" | "arrow",
  color: string,
): void {
  const columns = Math.max(8, Math.round(panel.width / 47));
  const rows = Math.max(7, Math.round(panel.height / 47));
  for (let row = 0; row < rows; row += 1) {
    const y = TAU * (row + 0.5) / rows;
    for (let column = 0; column < columns; column += 1) {
      const x = TAU * (column + 0.5) / columns;
      const point = toScreen({ x, y }, panel);
      const velocity = sample(x, y);
      if (kind === "line") drawLineGlyph(point, velocity, panel, color);
      else drawArrow(point, velocity, color);
    }
  }
}

function drawTrace(panel: Rect, trace: ReversibleParticlePoint[], color: string, width: number): void {
  context.beginPath();
  let previous: Point | undefined;
  for (const world of trace) {
    const point = toScreen(world, panel);
    if (!previous || Math.abs(point.x - previous.x) > 0.45 * panel.width || Math.abs(point.y - previous.y) > 0.45 * panel.height) {
      context.moveTo(point.x, point.y);
    } else {
      context.lineTo(point.x, point.y);
    }
    previous = point;
  }
  context.strokeStyle = color;
  context.lineWidth = width;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.stroke();
}

function drawParticles(panel: Rect, kind: ReversibleBranchKind, color: string): void {
  for (let index = 0; index < particleSeeds.length; index += 1) {
    const trace = integrateReversibleParticleTrace(particleSeeds[index]!, time, kind, parameters, 54);
    if (index < 10) drawTrace(panel, trace, index === 0 ? "#ffd26a" : color, index === 0 ? 2.3 : 0.7);
    const final = toScreen(trace.at(-1)!, panel);
    context.beginPath();
    context.arc(final.x, final.y, index === 0 ? 5 : 2.1, 0, TAU);
    context.fillStyle = index === 0 ? "#ffd26a" : color;
    context.fill();
  }
}

function drawProjection(first: Rect, second: Rect): void {
  const divergenceExtent = Math.max(0.1, 7.25 * parameters.contamination);
  drawPanelFrame(first, "TENTATIVE UNORIENTED FIELD", "roots ±u* · color = divergence");
  drawScalarField(first, (x, y) => tentativeLineBranch(1, x, y, time, parameters).divergence, divergenceExtent);
  drawGlyphGrid(first, (x, y) => tentativeLineBranch(1, x, y, time, parameters).velocity, "line", "rgba(222,249,245,.86)");

  drawPanelFrame(second, "AFTER SYMMETRIC PROJECTION", "roots ±Pu* · gold = stream-function contours");
  drawScalarField(second, (x, y) => forwardEulerSample(x, y, time, parameters).vorticity, Math.max(0.1, 2 * parameters.amplitude), 0.48);
  drawStreamContours(second, time);
  drawGlyphGrid(second, (x, y) => projectedLineBranch(1, x, y, time, parameters).velocity, "line", "rgba(222,249,245,.9)");
}

function drawEulerPair(first: Rect, second: Rect, reversed: boolean): void {
  const secondKind: ReversibleBranchKind = reversed ? "time-reversed" : "same-time-negative";
  drawPanelFrame(first, "CYAN SHEET · u(x,t)", "exact traveling Euler solution");
  drawScalarField(first, (x, y) => forwardEulerSample(x, y, time, parameters).vorticity, Math.max(0.1, 2 * parameters.amplitude), 0.48);
  drawGlyphGrid(first, (x, y) => forwardEulerSample(x, y, time, parameters).velocity, "arrow", "rgba(88,224,232,.92)");
  drawParticles(first, "forward", "rgba(88,224,232,.72)");

  drawPanelFrame(
    second,
    reversed ? "ORANGE SHEET · −u(x,−t)" : "ORANGE ROOT · −u(x,t)",
    reversed ? "exact Euler solution · backward movie" : "divergence-free · generally not Euler",
  );
  drawScalarField(second, (x, y) => reversibleBranchSample(secondKind, x, y, time, parameters).vorticity, Math.max(0.1, 2 * parameters.amplitude), 0.48);
  drawGlyphGrid(second, (x, y) => reversibleBranchSample(secondKind, x, y, time, parameters).velocity, "arrow", "rgba(255,117,64,.92)");
  drawParticles(second, secondKind, "rgba(255,117,64,.72)");
}

function formatScientific(value: number): string {
  if (Math.abs(value) < 5e-13) return "< 5e−13";
  return value.toExponential(2).replace("e-", "e−");
}

function updateMetrics(): void {
  const diagnostics = reversibleLineFluidDiagnostics(time, parameters, 36, 36);
  const labels = [
    byId<HTMLElement>("rlf-metric-one-label"),
    byId<HTMLElement>("rlf-metric-two-label"),
    byId<HTMLElement>("rlf-metric-three-label"),
    byId<HTMLElement>("rlf-metric-four-label"),
  ];
  const values = [
    byId<HTMLElement>("rlf-metric-one"),
    byId<HTMLElement>("rlf-metric-two"),
    byId<HTMLElement>("rlf-metric-three"),
    byId<HTMLElement>("rlf-metric-four"),
  ];
  if (mode === "projection") {
    labels[0]!.textContent = "div RMS · tentative";
    labels[1]!.textContent = "div RMS · projected";
    labels[2]!.textContent = "root symmetry defect";
    labels[3]!.textContent = "rotated integrability defect";
    values[0]!.textContent = diagnostics.tentativeDivergenceRms.toFixed(3);
    values[1]!.textContent = formatScientific(diagnostics.projectedDivergenceRms);
    values[2]!.textContent = formatScientific(diagnostics.signSymmetryDefect);
    values[3]!.textContent = formatScientific(diagnostics.coIntegrabilityDefect);
  } else if (mode === "same-time") {
    labels[0]!.textContent = "div RMS · u";
    labels[1]!.textContent = "div RMS · −u";
    labels[2]!.textContent = "Euler residual · u";
    labels[3]!.textContent = "Euler residual · −u";
    values[0]!.textContent = "0";
    values[1]!.textContent = "0";
    values[2]!.textContent = formatScientific(0);
    values[3]!.textContent = diagnostics.sameTimeEulerResidualRms.toFixed(3);
  } else {
    labels[0]!.textContent = "div RMS · forward";
    labels[1]!.textContent = "div RMS · reversed";
    labels[2]!.textContent = "Euler residual · forward";
    labels[3]!.textContent = "Euler residual · reversed";
    values[0]!.textContent = "0";
    values[1]!.textContent = "0";
    values[2]!.textContent = formatScientific(0);
    values[3]!.textContent = formatScientific(diagnostics.reversedEulerResidualRms);
  }
}

function updateCopy(): void {
  const copy = MODE_COPY[mode];
  byId<HTMLElement>("rlf-stage-kicker").textContent = copy.stageKicker;
  byId<HTMLElement>("rlf-stage-title").textContent = copy.stageTitle;
  byId<HTMLElement>("rlf-card-kicker").textContent = copy.cardKicker;
  byId<HTMLElement>("rlf-card-title").textContent = copy.cardTitle;
  const equation = byId<HTMLElement>("rlf-card-equation");
  equation.dataset.latex = copy.latex;
  renderMath(equation, copy.latex);
  byId<HTMLElement>("rlf-card-copy").textContent = copy.cardCopy;
  byId<HTMLElement>("rlf-verdict-title").textContent = copy.verdictTitle;
  byId<HTMLElement>("rlf-verdict-copy").textContent = copy.verdictCopy;
  byId<HTMLElement>("rlf-verdict").classList.toggle("warning", mode === "same-time");
  contaminationLabel.hidden = mode !== "projection";
}

function render(): void {
  const { width, height } = resizeCanvas();
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#06121f";
  context.fillRect(0, 0, width, height);
  const panels = panelLayout(width, height);
  if (mode === "projection") drawProjection(panels.first, panels.second);
  else drawEulerPair(panels.first, panels.second, mode === "time-reversal");
  updateMetrics();
  timeInput.value = time.toFixed(2);
  byId<HTMLOutputElement>("rlf-time-output").textContent = time.toFixed(2);
}

function stopPlaying(): void {
  playing = false;
  playButton.textContent = "Play";
  playButton.classList.remove("active");
  cancelAnimationFrame(animationFrame);
}

function animate(timestamp: number): void {
  if (!playing) return;
  if (previousTimestamp === 0) previousTimestamp = timestamp;
  const elapsed = Math.min(0.05, (timestamp - previousTimestamp) / 1000);
  previousTimestamp = timestamp;
  time += 0.55 * elapsed;
  if (time >= Number(timeInput.max)) {
    time = Number(timeInput.max);
    stopPlaying();
  }
  render();
  if (playing) animationFrame = requestAnimationFrame(animate);
}

modeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    mode = button.dataset.rlfMode as LabMode;
    modeButtons.forEach((candidate) => {
      const active = candidate === button;
      candidate.classList.toggle("active", active);
      candidate.setAttribute("aria-pressed", String(active));
    });
    updateCopy();
    render();
  });
});

timeInput.addEventListener("input", () => {
  time = Number(timeInput.value);
  render();
});

amplitudeInput.addEventListener("input", () => {
  parameters = { ...parameters, amplitude: Number(amplitudeInput.value) };
  byId<HTMLOutputElement>("rlf-amplitude-output").textContent = parameters.amplitude.toFixed(2);
  render();
});

driftInput.addEventListener("input", () => {
  parameters = { ...parameters, drift: Number(driftInput.value) };
  byId<HTMLOutputElement>("rlf-drift-output").textContent = parameters.drift.toFixed(2);
  render();
});

contaminationInput.addEventListener("input", () => {
  parameters = { ...parameters, contamination: Number(contaminationInput.value) };
  byId<HTMLOutputElement>("rlf-contamination-output").textContent = parameters.contamination.toFixed(2);
  render();
});

byId<HTMLButtonElement>("rlf-reset").addEventListener("click", () => {
  stopPlaying();
  previousTimestamp = 0;
  time = 0;
  render();
});

byId<HTMLButtonElement>("rlf-step").addEventListener("click", () => {
  stopPlaying();
  previousTimestamp = 0;
  time = Math.min(Number(timeInput.max), time + 0.16);
  render();
});

playButton.addEventListener("click", () => {
  if (playing) {
    stopPlaying();
    return;
  }
  if (time >= Number(timeInput.max)) time = 0;
  playing = true;
  previousTimestamp = 0;
  playButton.textContent = "Pause";
  playButton.classList.add("active");
  animationFrame = requestAnimationFrame(animate);
});

const resizeObserver = new ResizeObserver(() => render());
resizeObserver.observe(canvas);
updateCopy();
render();
