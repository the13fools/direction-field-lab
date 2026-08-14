import "./bernoulli-clebsch.css";
import "katex/dist/katex.min.css";

import katex from "katex";
import { BernoulliClebschModel, type NozzlePoint, type NozzleTriangleSample } from "./bernoulli-clebsch-model";

type TutorialStage = "area" | "euler" | "covector" | "labels" | "transport";

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface StageCopy {
  kicker: string;
  title: string;
  cardTitle: string;
  latex: string;
  copy: string;
}

const STAGE_COPY: Record<TutorialStage, StageCopy> = {
  area: {
    kicker: "CHAPTER 1 · CONSERVE VOLUME",
    title: "the same flux passes through every cross-section",
    cardTitle: "First conserve volume.",
    latex: "Q=A(x)\\,\\bar u(x),\\qquad \\partial_x Q=0",
    copy: "A smaller cross-section cannot pass the same volume per second at the old speed. The one-dimensional prediction is ū = Q/A.",
  },
  euler: {
    kicker: "CHAPTER 2 · SOLVE THE EULER BASE FLOW",
    title: "a harmonic field accelerates and pressure falls",
    cardTitle: "Then recover pressure.",
    latex: "p+\\tfrac12\\rho|u_H|^2=B",
    copy: "The displayed velocity is a two-dimensional, wall-tangent harmonic field. Bernoulli is global here because the base flow is steady and irrotational.",
  },
  covector: {
    kicker: "CHAPTER 3 · LOWER THE INDEX",
    title: "arrows advect; one-forms measure displacements",
    cardTitle: "Same metric components, different type.",
    latex: "u^\\flat(\\delta x)=g(u,\\delta x)",
    copy: "Cyan arrows are tangent vectors. Each orange bar is the kernel of the velocity one-form: a test displacement along the bar contributes zero circulation.",
  },
  labels: {
    kicker: "CHAPTER 4 · ADD VORTICITY",
    title: "crossing label contours encode a vorticity two-form",
    cardTitle: "The exact term has no curl.",
    latex: "u^\\flat=u_H^\\flat+d\\phi+\\alpha\\,d\\beta,\\qquad d u^\\flat=d\\alpha\\wedge d\\beta",
    copy: "Cyan α contours and orange β contours are scalar level sets. Their oriented crossings—not either family alone—determine the signed vorticity density.",
  },
  transport: {
    kicker: "CHAPTER 5 · CLEBSCH TRANSPORT",
    title: "carry α and β, then re-solve φ",
    cardTitle: "Material memory plus an elliptic constraint.",
    latex: "D_t\\alpha=D_t\\beta=0,\\qquad \\Delta\\phi=-\\delta(\\alpha\\,d\\beta)",
    copy: "Play the flow. The label contours deform with the particles; after each transport step a Neumann Hodge solve reconstructs the divergence-free velocity.",
  },
};

const STAGE_LEGEND: Record<TutorialStage, string> = {
  area: "<i></i> area <i></i> area-law speed <i></i> section",
  euler: "<i></i> velocity <i></i> pressure <i></i> particles",
  covector: "<i></i> vector <i></i> covector kernel <i></i> pressure",
  labels: "<i></i> α contours <i></i> β contours <i></i> vorticity",
  transport: "<i></i> α contours <i></i> β contours <i></i> particles",
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
  renderMath(element, element.dataset.latex!, element.classList.contains("bc-math-display"));
}

const canvas = byId<HTMLCanvasElement>("bc-canvas");
const rawContext = canvas.getContext("2d");
if (!rawContext) throw new Error("Canvas 2D is unavailable");
const context: CanvasRenderingContext2D = rawContext;
const stageButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-bc-stage]")];
const playButton = byId<HTMLButtonElement>("bc-play");
const constrictionInput = byId<HTMLInputElement>("bc-constriction");
const meanSpeedInput = byId<HTMLInputElement>("bc-mean-speed");
const densityInput = byId<HTMLInputElement>("bc-density");
const vortexInput = byId<HTMLInputElement>("bc-vortex");

const model = new BernoulliClebschModel();
let tutorialStage: TutorialStage = "area";
let playing = false;
let animationFrame = 0;
let lastStepTime = 0;

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

function panels(width: number, height: number): { channel: Rect; graph: Rect } {
  return {
    channel: { left: 48, top: 44, width: width - 82, height: height * 0.61 },
    graph: { left: 48, top: height * 0.72, width: width - 82, height: height * 0.21 },
  };
}

function screenPoint(point: NozzlePoint, panel: Rect): NozzlePoint {
  return {
    x: panel.left + panel.width * point.x / model.length,
    y: panel.top + 0.5 * panel.height - point.y * panel.height * 0.78,
  };
}

function channelPath(panel: Rect): Path2D {
  const path = new Path2D();
  const samples = 160;
  for (let index = 0; index <= samples; index += 1) {
    const x = model.length * index / samples;
    const point = screenPoint({ x, y: 0.5 * model.height(x) }, panel);
    if (index === 0) path.moveTo(point.x, point.y);
    else path.lineTo(point.x, point.y);
  }
  for (let index = samples; index >= 0; index -= 1) {
    const x = model.length * index / samples;
    const point = screenPoint({ x, y: -0.5 * model.height(x) }, panel);
    path.lineTo(point.x, point.y);
  }
  path.closePath();
  return path;
}

function colorRamp(value: number, minimum: number, maximum: number, alpha = 1): string {
  const t = maximum - minimum < 1e-12 ? 0.5 : Math.max(0, Math.min(1, (value - minimum) / (maximum - minimum)));
  const red = Math.round(28 + 227 * t);
  const green = Math.round(193 - 92 * t);
  const blue = Math.round(199 - 126 * t);
  return `rgba(${red},${green},${blue},${alpha})`;
}

function trianglePoint(sample: NozzleTriangleSample, vertexIndex: number, panel: Rect): NozzlePoint {
  const source = model.getVertices()[vertexIndex]!;
  const x = sample.column === model.columns - 1 && source.x < model.length / 2 ? source.x + model.length : source.x;
  return screenPoint({ x, y: source.y }, panel);
}

function fillField(panel: Rect, samples: readonly NozzleTriangleSample[]): void {
  let values: number[];
  if (tutorialStage === "euler" || tutorialStage === "covector") values = samples.map((sample) => sample.pressure);
  else if (tutorialStage === "labels" || tutorialStage === "transport") values = samples.map((sample) => sample.vorticity);
  else values = samples.map((sample) => Math.hypot(sample.harmonicVelocity.x, sample.harmonicVelocity.y));
  const extent = Math.max(...values.map(Math.abs), 1e-6);
  const minimum = tutorialStage === "labels" || tutorialStage === "transport" ? -extent : Math.min(...values);
  const maximum = tutorialStage === "labels" || tutorialStage === "transport" ? extent : Math.max(...values);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index]!;
    const [a, b, c] = sample.vertices.map((vertex) => trianglePoint(sample, vertex, panel)) as unknown as [NozzlePoint, NozzlePoint, NozzlePoint];
    context.beginPath();
    context.moveTo(a.x, a.y);
    context.lineTo(b.x, b.y);
    context.lineTo(c.x, c.y);
    context.closePath();
    context.fillStyle = colorRamp(values[index]!, minimum, maximum, tutorialStage === "area" ? 0.7 : 0.78);
    context.fill();
  }
}

function drawCrossSections(panel: Rect): void {
  context.save();
  context.strokeStyle = "rgba(255,255,255,.28)";
  context.lineWidth = 1;
  context.setLineDash([4, 5]);
  for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
    const x = fraction * model.length;
    const upper = screenPoint({ x, y: 0.5 * model.height(x) }, panel);
    const lower = screenPoint({ x, y: -0.5 * model.height(x) }, panel);
    context.beginPath();
    context.moveTo(upper.x, upper.y);
    context.lineTo(lower.x, lower.y);
    context.stroke();
  }
  context.restore();
}

function drawArrow(point: NozzlePoint, vector: NozzlePoint, lengthScale: number, color: string, lineWidth = 1.5): void {
  const magnitude = Math.hypot(vector.x, vector.y);
  if (magnitude < 1e-9) return;
  const length = Math.min(26, 8 + lengthScale * magnitude);
  const direction = { x: vector.x / magnitude, y: -vector.y / magnitude };
  const end = { x: point.x + length * direction.x, y: point.y + length * direction.y };
  const head = 5;
  context.beginPath();
  context.moveTo(point.x, point.y);
  context.lineTo(end.x, end.y);
  context.strokeStyle = color;
  context.lineWidth = lineWidth;
  context.lineCap = "round";
  context.stroke();
  const angle = Math.atan2(end.y - point.y, end.x - point.x);
  context.beginPath();
  context.moveTo(end.x, end.y);
  context.lineTo(end.x - head * Math.cos(angle - Math.PI / 6), end.y - head * Math.sin(angle - Math.PI / 6));
  context.lineTo(end.x - head * Math.cos(angle + Math.PI / 6), end.y - head * Math.sin(angle + Math.PI / 6));
  context.closePath();
  context.fillStyle = color;
  context.fill();
}

function drawVectorField(panel: Rect, samples: readonly NozzleTriangleSample[]): void {
  const stride = Math.max(1, Math.floor(samples.length / 78));
  for (let index = 0; index < samples.length; index += stride) {
    const sample = samples[index]!;
    const point = screenPoint(sample.centroid, panel);
    const vector = tutorialStage === "euler" || tutorialStage === "covector" ? sample.harmonicVelocity : sample.velocity;
    drawArrow(point, vector, 12, "rgba(218,255,247,.84)");
    if (tutorialStage === "covector") {
      const magnitude = Math.hypot(vector.x, vector.y);
      if (magnitude > 1e-9) {
        const tangent = { x: vector.y / magnitude, y: vector.x / magnitude };
        context.beginPath();
        context.moveTo(point.x - 7 * tangent.x, point.y - 7 * tangent.y);
        context.lineTo(point.x + 7 * tangent.x, point.y + 7 * tangent.y);
        context.strokeStyle = "rgba(255,117,64,.94)";
        context.lineWidth = 2.2;
        context.stroke();
      }
    }
  }
}

function edgeCrossing(level: number, firstValue: number, secondValue: number, first: NozzlePoint, second: NozzlePoint): NozzlePoint | null {
  if ((firstValue < level && secondValue < level) || (firstValue > level && secondValue > level) || firstValue === secondValue) return null;
  const t = (level - firstValue) / (secondValue - firstValue);
  if (t < 0 || t > 1) return null;
  return { x: first.x + t * (second.x - first.x), y: first.y + t * (second.y - first.y) };
}

function drawContours(panel: Rect, values: Float64Array, levels: readonly number[], color: string): void {
  const dx = model.length / model.columns;
  context.save();
  context.strokeStyle = color;
  context.lineWidth = 1.45;
  context.lineCap = "round";
  for (let ix = 0; ix < model.columns; ix += 1) {
    const next = (ix + 1) % model.columns;
    const x0 = ix * dx;
    const x1 = x0 + dx;
    for (let iy = 0; iy < model.rows - 1; iy += 1) {
      const eta0 = -0.5 + iy / (model.rows - 1);
      const eta1 = -0.5 + (iy + 1) / (model.rows - 1);
      const indices = [iy * model.columns + ix, iy * model.columns + next, (iy + 1) * model.columns + next, (iy + 1) * model.columns + ix] as const;
      const points = [
        screenPoint({ x: x0, y: eta0 * model.height(x0) }, panel),
        screenPoint({ x: x1, y: eta0 * model.height(x1) }, panel),
        screenPoint({ x: x1, y: eta1 * model.height(x1) }, panel),
        screenPoint({ x: x0, y: eta1 * model.height(x0) }, panel),
      ] as const;
      for (const level of levels) {
        const crossings: NozzlePoint[] = [];
        for (const [first, second] of [[0, 1], [1, 2], [2, 3], [3, 0]] as const) {
          const crossing = edgeCrossing(level, values[indices[first]]!, values[indices[second]]!, points[first], points[second]);
          if (crossing) crossings.push(crossing);
        }
        for (let crossing = 0; crossing + 1 < crossings.length; crossing += 2) {
          context.beginPath();
          context.moveTo(crossings[crossing]!.x, crossings[crossing]!.y);
          context.lineTo(crossings[crossing + 1]!.x, crossings[crossing + 1]!.y);
          context.stroke();
        }
      }
    }
  }
  context.restore();
}

function drawParticles(panel: Rect): void {
  for (const particle of model.getParticles()) {
    const position = screenPoint(model.position(particle.x, particle.eta), panel);
    context.beginPath();
    context.arc(position.x, position.y, particle === model.getParticles()[0] ? 4.5 : 1.45, 0, 2 * Math.PI);
    context.fillStyle = particle === model.getParticles()[0] ? "#ffd26a" : particle.family === 0 ? "rgba(225,255,244,.82)" : "rgba(88,224,232,.82)";
    context.fill();
  }
}

function drawGraph(panel: Rect, samples: readonly NozzleTriangleSample[]): void {
  context.fillStyle = "rgba(4,15,25,.78)";
  context.fillRect(panel.left, panel.top, panel.width, panel.height);
  context.strokeStyle = "rgba(123,151,174,.5)";
  context.lineWidth = 1;
  context.strokeRect(panel.left, panel.top, panel.width, panel.height);
  const area: number[] = [];
  const speed: number[] = [];
  const pressure: number[] = [];
  for (let column = 0; column < model.columns; column += 1) {
    const columnSamples = samples.filter((sample) => sample.column === column);
    const weight = columnSamples.reduce((sum, sample) => sum + sample.area, 0);
    area.push(model.height(column * model.length / model.columns));
    const finiteElementSpeed = columnSamples.reduce((sum, sample) => sum + sample.area * Math.hypot(sample.harmonicVelocity.x, sample.harmonicVelocity.y), 0) / weight;
    speed.push(tutorialStage === "area" ? model.areaLawSpeed(column * model.length / model.columns) : finiteElementSpeed);
    pressure.push(columnSamples.reduce((sum, sample) => sum + sample.area * sample.pressure, 0) / weight);
  }
  const curves: Array<{ values: number[]; color: string; label: string }> = [
    { values: area, color: "#58e0e8", label: "A" },
    { values: speed, color: "#ff7540", label: "|u|" },
    { values: pressure, color: "#ffd26a", label: "p" },
  ];
  for (let curveIndex = 0; curveIndex < curves.length; curveIndex += 1) {
    if (tutorialStage === "area" && curveIndex === 2) continue;
    const curve = curves[curveIndex]!;
    const minimum = Math.min(...curve.values);
    const maximum = Math.max(...curve.values);
    context.beginPath();
    for (let index = 0; index < curve.values.length; index += 1) {
      const x = panel.left + panel.width * index / (curve.values.length - 1);
      const normalized = maximum - minimum < 1e-9 ? 0.5 : (curve.values[index]! - minimum) / (maximum - minimum);
      const baseline = panel.top + 13 + curveIndex * (panel.height - 25) / 3;
      const y = baseline + 15 * (0.5 - normalized);
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.strokeStyle = curve.color;
    context.lineWidth = 2;
    context.stroke();
    context.fillStyle = curve.color;
    context.font = "800 8px SFMono-Regular, Consolas, monospace";
    context.fillText(curve.label, panel.left + 7, panel.top + 10 + curveIndex * (panel.height - 25) / 3);
  }
  context.fillStyle = "rgba(202,216,227,.64)";
  context.font = "700 7px SFMono-Regular, Consolas, monospace";
  context.textAlign = "right";
  context.fillText("wide", panel.left + 30, panel.top + panel.height - 7);
  context.fillText("throat", panel.left + 0.5 * panel.width + 18, panel.top + panel.height - 7);
  context.fillText("wide / periodic seam", panel.left + panel.width - 5, panel.top + panel.height - 7);
  context.textAlign = "left";
}

function draw(): void {
  const { width, height } = resizeCanvas();
  context.clearRect(0, 0, width, height);
  const { channel, graph } = panels(width, height);
  const path = channelPath(channel);
  context.fillStyle = "#0a2630";
  context.fill(path);
  context.save();
  context.clip(path);
  const samples = model.triangleSamples();
  fillField(channel, samples);
  if (tutorialStage === "area") drawCrossSections(channel);
  if (tutorialStage === "labels" || tutorialStage === "transport") {
    const alphaExtent = Math.max(...model.getAlpha().map(Math.abs), 0.01);
    drawContours(channel, model.getAlpha(), [-0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75].map((value) => value * alphaExtent), "rgba(88,224,232,.92)");
    drawContours(channel, model.getBeta(), [-0.4, -0.27, -0.13, 0, 0.13, 0.27, 0.4], "rgba(255,117,64,.92)");
  }
  if (tutorialStage !== "area") drawVectorField(channel, samples);
  if (tutorialStage === "euler" || tutorialStage === "transport") drawParticles(channel);
  context.restore();
  context.strokeStyle = "rgba(221,255,246,.9)";
  context.lineWidth = 2.2;
  context.stroke(path);
  context.fillStyle = "rgba(88,224,232,.82)";
  context.font = "800 8px SFMono-Regular, Consolas, monospace";
  context.fillText("PERIODIC SEAM", channel.left - 1, channel.top - 15);
  context.textAlign = "right";
  context.fillText("SAME CROSS-SECTION", channel.left + channel.width, channel.top - 15);
  context.textAlign = "left";
  drawGraph(graph, samples);
}

function scientific(value: number, digits = 2): string {
  if (Math.abs(value) > 0 && (Math.abs(value) < 1e-3 || Math.abs(value) >= 1e3)) return value.toExponential(digits);
  return value.toFixed(digits);
}

function updateReadouts(): void {
  const diagnostics = model.diagnostics();
  byId("bc-flux").textContent = scientific(diagnostics.fluxMean, 3);
  byId("bc-flux-spread").textContent = scientific(diagnostics.fluxSpread, 2);
  byId("bc-speed").textContent = `${diagnostics.wideSpeed.toFixed(2)} → ${diagnostics.throatSpeed.toFixed(2)}`;
  byId("bc-pressure").textContent = diagnostics.pressureDrop.toFixed(3);
  byId("bc-divergence").textContent = scientific(diagnostics.divergenceRms, 2);
  byId("bc-vorticity").textContent = diagnostics.vorticityRms.toFixed(3);
  byId("bc-period").textContent = diagnostics.harmonicCirculation.toFixed(3);
  byId("bc-label-drift").textContent = scientific(diagnostics.labelDrift, 2);
}

function updateStage(): void {
  const copy = STAGE_COPY[tutorialStage];
  byId("bc-stage-kicker").textContent = copy.kicker;
  byId("bc-stage-title").textContent = copy.title;
  byId("bc-card-kicker").textContent = copy.kicker;
  byId("bc-card-title").textContent = copy.cardTitle;
  byId("bc-card-copy").textContent = copy.copy;
  byId("bc-legend").innerHTML = STAGE_LEGEND[tutorialStage];
  renderMath(byId("bc-card-equation"), copy.latex, true);
  for (const button of stageButtons) {
    const active = button.dataset.bcStage === tutorialStage;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  draw();
}

function setStage(stage: TutorialStage): void {
  tutorialStage = stage;
  updateStage();
}

function stopPlaying(): void {
  playing = false;
  playButton.classList.remove("active");
  playButton.setAttribute("aria-pressed", "false");
  playButton.textContent = "Play transport";
  if (animationFrame) cancelAnimationFrame(animationFrame);
  animationFrame = 0;
}

function animate(timestamp: number): void {
  if (!playing) return;
  if (timestamp - lastStepTime > 24) {
    model.step();
    lastStepTime = timestamp;
    updateReadouts();
    draw();
  }
  animationFrame = requestAnimationFrame(animate);
}

for (const button of stageButtons) {
  button.addEventListener("click", () => setStage(button.dataset.bcStage as TutorialStage));
}

byId<HTMLButtonElement>("bc-reset").addEventListener("click", () => {
  stopPlaying();
  model.reset();
  updateReadouts();
  draw();
});

byId<HTMLButtonElement>("bc-step").addEventListener("click", () => {
  stopPlaying();
  setStage("transport");
  model.step();
  updateReadouts();
  draw();
});

playButton.addEventListener("click", () => {
  playing = !playing;
  playButton.classList.toggle("active", playing);
  playButton.setAttribute("aria-pressed", String(playing));
  playButton.textContent = playing ? "Pause transport" : "Play transport";
  if (playing) {
    setStage("transport");
    lastStepTime = performance.now();
    animationFrame = requestAnimationFrame(animate);
  } else if (animationFrame) {
    cancelAnimationFrame(animationFrame);
    animationFrame = 0;
  }
});

constrictionInput.addEventListener("input", () => {
  byId<HTMLOutputElement>("bc-constriction-output").value = `${Math.round(100 * Number(constrictionInput.value))}%`;
});
constrictionInput.addEventListener("change", () => {
  stopPlaying();
  model.setConstriction(Number(constrictionInput.value));
  updateReadouts();
  draw();
});

meanSpeedInput.addEventListener("input", () => {
  const value = Number(meanSpeedInput.value);
  byId<HTMLOutputElement>("bc-speed-output").value = value.toFixed(2);
  model.setMeanSpeed(value);
  updateReadouts();
  draw();
});

densityInput.addEventListener("input", () => {
  const value = Number(densityInput.value);
  byId<HTMLOutputElement>("bc-density-output").value = value.toFixed(2);
  model.setDensity(value);
  updateReadouts();
  draw();
});

vortexInput.addEventListener("input", () => {
  byId<HTMLOutputElement>("bc-vortex-output").value = Number(vortexInput.value).toFixed(2);
});
vortexInput.addEventListener("change", () => {
  stopPlaying();
  model.setVortexStrength(Number(vortexInput.value));
  setStage("labels");
  updateReadouts();
  draw();
});

new ResizeObserver(draw).observe(canvas);
updateReadouts();
updateStage();
