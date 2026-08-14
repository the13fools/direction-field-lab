import "./symmetric-clebsch.css";
import "katex/dist/katex.min.css";

import katex from "katex";
import {
  DEFAULT_SYMMETRIC_CLEBSCH_PARAMETERS,
  symmetricClebschDiagnostics,
  symmetricClebschSample,
  type SymmetricClebschParameters,
  type SymmetricClebschPreset,
} from "./symmetric-clebsch-model";

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

interface PresetCopy {
  kicker: string;
  title: string;
  cardKicker: string;
  cardTitle: string;
  latex: string;
  copy: string;
}

const PRESET_COPY: Record<SymmetricClebschPreset, PresetCopy> = {
  "even-even": {
    kicker: "CASE 1 · OBVIOUS SYMMETRY",
    title: "both label pictures and the decoded velocity respect the mirror",
    cardKicker: "WHAT HAPPENED?",
    cardTitle: "The encoding and the flow both look symmetric.",
    latex: "R^*\\alpha=\\alpha,\\quad R^*\\beta=\\beta\\quad\\Longrightarrow\\quad R^*(\\alpha\\,d\\beta)=\\alpha\\,d\\beta",
    copy: "Because φ and the harmonic through-flow are also symmetric, every term in the assembled one-form passes the mirror test.",
  },
  "odd-odd": {
    kicker: "CASE 2 · FLIP BOTH LABEL SIGNS",
    title: "the contour pictures change, but the decoded velocity is still symmetric",
    cardKicker: "WHAT HAPPENED?",
    cardTitle: "Two label signs cancel in the product.",
    latex: "R^*\\alpha=-\\alpha,\\quad R^*d\\beta=-d\\beta\\quad\\Longrightarrow\\quad R^*(\\alpha\\,d\\beta)=\\alpha\\,d\\beta",
    copy: "Neither scalar label is mirror-even, but α and dβ both acquire a minus sign. Their product—and therefore the physical one-form—does not.",
  },
  mixed: {
    kicker: "CASE 3 · BREAK ONE PARITY RULE",
    title: "the gold mirror-arrows now separate from the actual cyan arrows",
    cardKicker: "WHAT HAPPENED?",
    cardTitle: "This time the physical flow really changed.",
    latex: "\\beta=y+0.35\\sin x\\cos(\\tfrac\\pi2y)\\quad\\Longrightarrow\\quad R^*u^\\flat\\ne u^\\flat",
    copy: "β mixes odd and even pieces while α stays even. Nothing in φ cancels the mismatch, so the decoded arrows fail the mirror test.",
  },
  gauge: {
    kicker: "CASE 4 · SCRAMBLE LABELS, NOT THE FLOW",
    title: "β loses definite parity while φ cancels the change exactly",
    cardKicker: "WHAT HAPPENED?",
    cardTitle: "The encoding looks mixed; the flow is identical.",
    latex: "\\widetilde\\beta=\\beta+s\\alpha^2,\\quad\\widetilde\\phi=\\phi-\\tfrac{2s}{3}\\alpha^3\\quad\\Longrightarrow\\quad d\\widetilde\\phi+\\alpha d\\widetilde\\beta=d\\phi+\\alpha d\\beta",
    copy: "The change added to β is removed by the change in φ. Mixed-looking labels can therefore decode to the same symmetric one-form.",
  },
};

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as T;
}

function renderMath(element: HTMLElement, latex: string, displayMode: boolean): void {
  katex.render(latex, element, { displayMode, output: "htmlAndMathml", throwOnError: false });
}

for (const element of document.querySelectorAll<HTMLElement>("[data-latex]")) {
  renderMath(element, element.dataset.latex!, element.classList.contains("sc-math-display"));
}

const canvas = byId<HTMLCanvasElement>("sc-canvas");
const rawContext = canvas.getContext("2d");
if (!rawContext) throw new Error("Canvas 2D is unavailable");
const context: CanvasRenderingContext2D = rawContext;
const presetButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-sc-preset]")];
const amplitudeInput = byId<HTMLInputElement>("sc-amplitude");
const gaugeInput = byId<HTMLInputElement>("sc-gauge");
const phaseInput = byId<HTMLInputElement>("sc-phase");
const flowInput = byId<HTMLInputElement>("sc-flow");
const mirrorButton = byId<HTMLButtonElement>("sc-toggle-mirror");

let parameters: SymmetricClebschParameters = { ...DEFAULT_SYMMETRIC_CLEBSCH_PARAMETERS };
let probe = { x: 1.18 * Math.PI, y: 0.42 };
let showMirror = true;

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

function panelLayout(width: number, height: number): { labels: Rect; field: Rect } {
  if (width >= 720) {
    const side = 35;
    const gap = 34;
    const panelWidth = (width - 2 * side - gap) / 2;
    return {
      labels: { left: side, top: 54, width: panelWidth, height: height - 88 },
      field: { left: side + panelWidth + gap, top: 54, width: panelWidth, height: height - 88 },
    };
  }
  const gap = 59;
  const panelHeight = (height - 112 - gap) / 2;
  return {
    labels: { left: 27, top: 48, width: width - 54, height: panelHeight },
    field: { left: 27, top: 48 + panelHeight + gap, width: width - 54, height: panelHeight },
  };
}

function toScreen(x: number, y: number, panel: Rect): Point {
  return {
    x: panel.left + panel.width * x / (2 * Math.PI),
    y: panel.top + 0.5 * panel.height * (1 - y),
  };
}

function fromScreen(point: Point, panel: Rect): Point {
  return {
    x: Math.max(0, Math.min(2 * Math.PI, 2 * Math.PI * (point.x - panel.left) / panel.width)),
    y: Math.max(-1, Math.min(1, 1 - 2 * (point.y - panel.top) / panel.height)),
  };
}

function inside(point: Point, panel: Rect): boolean {
  return point.x >= panel.left && point.x <= panel.left + panel.width && point.y >= panel.top && point.y <= panel.top + panel.height;
}

function colorRamp(value: number, extent: number): string {
  const t = 0.5 + 0.5 * Math.max(-1, Math.min(1, value / Math.max(extent, 1e-9)));
  const red = Math.round(31 + 222 * t);
  const green = Math.round(194 - 92 * t);
  const blue = Math.round(202 - 127 * t);
  return `rgb(${red},${green},${blue})`;
}

function drawPanelFrame(panel: Rect, label: string, subtitle: string): void {
  context.fillStyle = "#091c2b";
  context.fillRect(panel.left, panel.top, panel.width, panel.height);
  context.strokeStyle = "rgba(214,251,244,.78)";
  context.lineWidth = 1.4;
  context.strokeRect(panel.left, panel.top, panel.width, panel.height);
  context.fillStyle = "#58e0e8";
  context.font = "800 8px SFMono-Regular, Consolas, monospace";
  context.fillText(label, panel.left, panel.top - 25);
  context.fillStyle = "rgba(190,206,218,.68)";
  context.font = "700 7px SFMono-Regular, Consolas, monospace";
  context.fillText(subtitle, panel.left, panel.top - 12);
  const centerLeft = toScreen(0, 0, panel);
  const centerRight = toScreen(2 * Math.PI, 0, panel);
  context.save();
  context.setLineDash([6, 5]);
  context.strokeStyle = "rgba(255,210,106,.55)";
  context.beginPath();
  context.moveTo(centerLeft.x, centerLeft.y);
  context.lineTo(centerRight.x, centerRight.y);
  context.stroke();
  context.restore();
  context.fillStyle = "rgba(255,210,106,.75)";
  context.fillText("MIRROR y = 0", panel.left + 7, centerLeft.y - 7);
  context.textAlign = "right";
  context.fillText("x = 0 ≡ 2π", panel.left + panel.width - 5, panel.top + panel.height - 7);
  context.textAlign = "left";
}

function sampledExtent(selector: (x: number, y: number) => number): { minimum: number; maximum: number; extent: number } {
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (let row = 0; row <= 30; row += 1) {
    const y = -1 + 2 * row / 30;
    for (let column = 0; column <= 64; column += 1) {
      const value = selector(2 * Math.PI * column / 64, y);
      minimum = Math.min(minimum, value);
      maximum = Math.max(maximum, value);
    }
  }
  return { minimum, maximum, extent: Math.max(Math.abs(minimum), Math.abs(maximum), 1e-6) };
}

function crossing(level: number, aValue: number, bValue: number, a: Point, b: Point): Point | null {
  if ((aValue < level && bValue < level) || (aValue > level && bValue > level) || aValue === bValue) return null;
  const t = (level - aValue) / (bValue - aValue);
  if (t < 0 || t > 1) return null;
  return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
}

function drawContours(panel: Rect, selector: (x: number, y: number) => number, color: string): void {
  const columns = 72;
  const rows = 30;
  const extent = sampledExtent(selector);
  const levels = Array.from({ length: 7 }, (_, index) => extent.minimum + (index + 1) * (extent.maximum - extent.minimum) / 8);
  context.save();
  context.strokeStyle = color;
  context.lineWidth = 1.55;
  context.lineCap = "round";
  for (let row = 0; row < rows; row += 1) {
    const y0 = -1 + 2 * row / rows;
    const y1 = -1 + 2 * (row + 1) / rows;
    for (let column = 0; column < columns; column += 1) {
      const x0 = 2 * Math.PI * column / columns;
      const x1 = 2 * Math.PI * (column + 1) / columns;
      const points = [toScreen(x0, y0, panel), toScreen(x1, y0, panel), toScreen(x1, y1, panel), toScreen(x0, y1, panel)] as const;
      const values = [selector(x0, y0), selector(x1, y0), selector(x1, y1), selector(x0, y1)] as const;
      for (const level of levels) {
        const hits: Point[] = [];
        for (const [first, second] of [[0, 1], [1, 2], [2, 3], [3, 0]] as const) {
          const hit = crossing(level, values[first], values[second], points[first], points[second]);
          if (hit) hits.push(hit);
        }
        for (let hit = 0; hit + 1 < hits.length; hit += 2) {
          context.beginPath();
          context.moveTo(hits[hit]!.x, hits[hit]!.y);
          context.lineTo(hits[hit + 1]!.x, hits[hit + 1]!.y);
          context.stroke();
        }
      }
    }
  }
  context.restore();
}

function drawLabelPanel(panel: Rect): void {
  drawPanelFrame(panel, "CLEBSCH ENCODING", "contours: α cyan, β orange · faint wash: φ");
  context.save();
  context.beginPath();
  context.rect(panel.left, panel.top, panel.width, panel.height);
  context.clip();
  const columns = 64;
  const rows = 22;
  const phiExtent = sampledExtent((x, y) => symmetricClebschSample(x, y, parameters).phi).extent;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = 2 * Math.PI * (column + 0.5) / columns;
      const y = -1 + 2 * (row + 0.5) / rows;
      const point0 = toScreen(2 * Math.PI * column / columns, -1 + 2 * row / rows, panel);
      const point1 = toScreen(2 * Math.PI * (column + 1) / columns, -1 + 2 * (row + 1) / rows, panel);
      const phi = symmetricClebschSample(x, y, parameters).phi;
      context.fillStyle = colorRamp(phi, 2.4 * phiExtent);
      context.globalAlpha = 0.25;
      context.fillRect(point0.x, point1.y, point1.x - point0.x + 1, point0.y - point1.y + 1);
    }
  }
  context.globalAlpha = 1;
  drawContours(panel, (x, y) => symmetricClebschSample(x, y, parameters).alpha, "rgba(88,224,232,.95)");
  drawContours(panel, (x, y) => symmetricClebschSample(x, y, parameters).beta, "rgba(255,117,64,.96)");
  context.restore();
}

function drawArrow(point: Point, vector: readonly [number, number], color: string, width: number): void {
  const magnitude = Math.hypot(vector[0], vector[1]);
  if (magnitude < 1e-8) return;
  const length = Math.min(24, 8 + 13 * magnitude);
  const dx = length * vector[0] / magnitude;
  const dy = -length * vector[1] / magnitude;
  const end = { x: point.x + dx, y: point.y + dy };
  context.beginPath();
  context.moveTo(point.x, point.y);
  context.lineTo(end.x, end.y);
  context.strokeStyle = color;
  context.lineWidth = width;
  context.lineCap = "round";
  context.stroke();
  const angle = Math.atan2(dy, dx);
  const head = 4.5;
  context.beginPath();
  context.moveTo(end.x, end.y);
  context.lineTo(end.x - head * Math.cos(angle - Math.PI / 6), end.y - head * Math.sin(angle - Math.PI / 6));
  context.lineTo(end.x - head * Math.cos(angle + Math.PI / 6), end.y - head * Math.sin(angle + Math.PI / 6));
  context.closePath();
  context.fillStyle = color;
  context.fill();
}

function drawFieldPanel(panel: Rect): void {
  drawPanelFrame(panel, "DECODED PHYSICS", "thin white = actual u · thick gold = mirror comparison");
  context.save();
  context.beginPath();
  context.rect(panel.left, panel.top, panel.width, panel.height);
  context.clip();
  const columns = 76;
  const rows = 28;
  const vorticityExtent = sampledExtent((x, y) => symmetricClebschSample(x, y, parameters).vorticity).extent;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = 2 * Math.PI * (column + 0.5) / columns;
      const y = -1 + 2 * (row + 0.5) / rows;
      const point0 = toScreen(2 * Math.PI * column / columns, -1 + 2 * row / rows, panel);
      const point1 = toScreen(2 * Math.PI * (column + 1) / columns, -1 + 2 * (row + 1) / rows, panel);
      context.fillStyle = colorRamp(symmetricClebschSample(x, y, parameters).vorticity, vorticityExtent);
      context.globalAlpha = 0.72;
      context.fillRect(point0.x, point1.y, point1.x - point0.x + 1, point0.y - point1.y + 1);
    }
  }
  context.globalAlpha = 1;
  for (let row = 0; row < 7; row += 1) {
    const y = -0.82 + 1.64 * row / 6;
    for (let column = 0; column < 19; column += 1) {
      const x = 2 * Math.PI * (column + 0.5) / 19;
      const point = toScreen(x, y, panel);
      const sample = symmetricClebschSample(x, y, parameters);
      if (showMirror) {
        const mirror = symmetricClebschSample(x, -y, parameters);
        drawArrow(point, [mirror.velocity[0], -mirror.velocity[1]], "rgba(255,210,106,.92)", 3.8);
      }
      drawArrow(point, sample.velocity, "rgba(220,255,248,.95)", 1.45);
    }
  }
  context.restore();
}

function drawProbe(panel: Rect, vectors = false): void {
  const original = toScreen(probe.x, probe.y, panel);
  const reflected = toScreen(probe.x, -probe.y, panel);
  context.save();
  context.setLineDash([4, 4]);
  context.strokeStyle = "rgba(255,210,106,.9)";
  context.beginPath();
  context.moveTo(original.x, original.y);
  context.lineTo(reflected.x, reflected.y);
  context.stroke();
  context.restore();
  for (const [point, color] of [[original, "#ffd26a"], [reflected, "#ff7540"]] as const) {
    context.beginPath();
    context.arc(point.x, point.y, 4.5, 0, 2 * Math.PI);
    context.fillStyle = color;
    context.fill();
  }
  if (vectors) {
    const sample = symmetricClebschSample(probe.x, probe.y, parameters);
    const mirror = symmetricClebschSample(probe.x, -probe.y, parameters);
    drawArrow(original, [mirror.velocity[0], -mirror.velocity[1]], "rgba(255,210,106,.98)", 6);
    drawArrow(original, sample.velocity, "rgba(220,255,248,1)", 2.2);
    drawArrow(reflected, mirror.velocity, "rgba(255,117,64,.98)", 2.2);
  }
}

function draw(): void {
  const { width, height } = resizeCanvas();
  context.clearRect(0, 0, width, height);
  const panels = panelLayout(width, height);
  drawLabelPanel(panels.labels);
  drawFieldPanel(panels.field);
  drawProbe(panels.labels);
  drawProbe(panels.field, true);
}

function scientific(value: number): string {
  if (value === 0) return "0";
  if (Math.abs(value) < 1e-3 || Math.abs(value) > 1e3) return value.toExponential(2);
  return value.toFixed(4);
}

function updateReadouts(): void {
  const diagnostics = symmetricClebschDiagnostics(parameters);
  byId("sc-velocity-defect").textContent = scientific(diagnostics.velocitySymmetryDefect);
  byId("sc-vorticity-defect").textContent = scientific(diagnostics.vorticityFormSymmetryDefect);
  byId("sc-alpha-parity").textContent = diagnostics.alphaParity;
  byId("sc-beta-parity").textContent = diagnostics.betaParity;
  byId("sc-gauge-defect").textContent = parameters.preset === "gauge" ? scientific(diagnostics.gaugeReconstructionDefect) : "not applied";
  byId("sc-vorticity-rms").textContent = diagnostics.vorticityRms.toFixed(4);
  const sample = symmetricClebschSample(probe.x, probe.y, parameters);
  const mirror = symmetricClebschSample(probe.x, -probe.y, parameters);
  const reflectedVelocity: readonly [number, number] = [mirror.velocity[0], -mirror.velocity[1]];
  const localDefect = Math.hypot(sample.velocity[0] - reflectedVelocity[0], sample.velocity[1] - reflectedVelocity[1]);
  const symmetric = diagnostics.velocitySymmetryDefect < 1e-6;
  const verdict = byId("sc-verdict");
  verdict.classList.toggle("symmetric", symmetric);
  verdict.classList.toggle("broken", !symmetric);
  byId("sc-physical-verdict").textContent = symmetric ? "✓ symmetric flow" : "× symmetry is broken";
  byId("sc-verdict-copy").textContent = symmetric
    ? "The actual arrows coincide with the reflected arrows."
    : "The actual arrows separate from their reflected partners.";
  byId("sc-probe-point").textContent = `(${(probe.x / Math.PI).toFixed(2)}π, ${probe.y.toFixed(2)})`;
  byId("sc-probe-mirror-point").textContent = `(${(probe.x / Math.PI).toFixed(2)}π, ${(-probe.y).toFixed(2)})`;
  byId("sc-probe-labels").textContent = `p: α ${sample.alpha.toFixed(3)}, β ${sample.beta.toFixed(3)} · R(p): α ${mirror.alpha.toFixed(3)}, β ${mirror.beta.toFixed(3)}`;
  byId("sc-probe-velocity").textContent = `(${sample.velocity[0].toFixed(3)}, ${sample.velocity[1].toFixed(3)})`;
  byId("sc-probe-mirror-velocity").textContent = `(${reflectedVelocity[0].toFixed(3)}, ${reflectedVelocity[1].toFixed(3)})`;
  byId("sc-probe-match").textContent = localDefect < 1e-6 ? `match · error ${scientific(localDefect)}` : `mismatch · error ${scientific(localDefect)}`;
}

function updatePresetCopy(): void {
  const copy = PRESET_COPY[parameters.preset];
  byId("sc-stage-kicker").textContent = copy.kicker;
  byId("sc-stage-title").textContent = copy.title;
  byId("sc-card-kicker").textContent = copy.cardKicker;
  byId("sc-card-title").textContent = copy.cardTitle;
  byId("sc-card-copy").textContent = copy.copy;
  renderMath(byId("sc-card-equation"), copy.latex, true);
  for (const button of presetButtons) {
    const active = button.dataset.scPreset === parameters.preset;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  gaugeInput.disabled = parameters.preset !== "gauge";
  updateReadouts();
  draw();
}

for (const button of presetButtons) {
  button.addEventListener("click", () => {
    parameters = { ...parameters, preset: button.dataset.scPreset as SymmetricClebschPreset };
    updatePresetCopy();
  });
}

amplitudeInput.addEventListener("input", () => {
  parameters = { ...parameters, amplitude: Number(amplitudeInput.value) };
  byId<HTMLOutputElement>("sc-amplitude-output").value = parameters.amplitude.toFixed(2);
  updateReadouts();
  draw();
});

gaugeInput.addEventListener("input", () => {
  parameters = { ...parameters, gauge: Number(gaugeInput.value) };
  byId<HTMLOutputElement>("sc-gauge-output").value = parameters.gauge.toFixed(2);
  updateReadouts();
  draw();
});

phaseInput.addEventListener("input", () => {
  parameters = { ...parameters, phase: Number(phaseInput.value) };
  byId<HTMLOutputElement>("sc-phase-output").value = `${Math.round(180 * parameters.phase / Math.PI)}°`;
  updateReadouts();
  draw();
});

flowInput.addEventListener("input", () => {
  parameters = { ...parameters, harmonicSpeed: Number(flowInput.value) };
  byId<HTMLOutputElement>("sc-flow-output").value = parameters.harmonicSpeed.toFixed(2);
  updateReadouts();
  draw();
});

mirrorButton.addEventListener("click", () => {
  showMirror = !showMirror;
  mirrorButton.classList.toggle("active", showMirror);
  mirrorButton.setAttribute("aria-pressed", String(showMirror));
  mirrorButton.textContent = showMirror ? "Gold mirror-arrows on" : "Gold mirror-arrows off";
  draw();
});

byId<HTMLButtonElement>("sc-reset-probe").addEventListener("click", () => {
  probe = { x: 1.18 * Math.PI, y: 0.42 };
  updateReadouts();
  draw();
});

canvas.addEventListener("pointerdown", (event) => {
  const bounds = canvas.getBoundingClientRect();
  const point = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  const panels = panelLayout(bounds.width, bounds.height);
  if (inside(point, panels.labels)) probe = fromScreen(point, panels.labels);
  else if (inside(point, panels.field)) probe = fromScreen(point, panels.field);
  else return;
  updateReadouts();
  draw();
});

new ResizeObserver(draw).observe(canvas);
updatePresetCopy();
