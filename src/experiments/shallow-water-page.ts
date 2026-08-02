import "./shallow-water.css";
import modelSource from "./shallow-water-model.ts?raw";

import { highlightTypeScript } from "../ui/code-highlight";
import { compileHeightEnergy, DEFAULT_HEIGHT_ENERGY } from "./height-energy";
import {
  DEFAULT_SHALLOW_WATER_PARAMETERS,
  VertexShallowWaterModel,
  type ShallowWaterDiagnostics,
} from "./shallow-water-model";

function byId<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing #${id}.`);
  return value as T;
}

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D is unavailable.");
  return context;
}

const canvas = byId<HTMLCanvasElement>("water-canvas");
const historyCanvas = byId<HTMLCanvasElement>("water-history");
const playButton = byId<HTMLButtonElement>("water-play");
const cflBadge = byId("cfl-badge");
const controls = {
  resolution: byId<HTMLInputElement>("water-resolution"),
  timeStep: byId<HTMLInputElement>("water-dt"),
  gravity: byId<HTMLInputElement>("water-gravity"),
  meanDepth: byId<HTMLInputElement>("water-depth"),
};
const outputs = {
  resolution: byId<HTMLOutputElement>("water-resolution-output"),
  timeStep: byId<HTMLOutputElement>("water-dt-output"),
  gravity: byId<HTMLOutputElement>("water-gravity-output"),
  meanDepth: byId<HTMLOutputElement>("water-depth-output"),
};

let model = new VertexShallowWaterModel();
let playing = false;
let display: "height" | "vorticity" | "speed" | "tracer" = "height";
let history: Array<{ energy: number; massDrift: number }> = [];
let resizeFrame = 0;
const heightEnergyEditor = byId<HTMLTextAreaElement>("height-energy");
const heightEnergyStatus = byId<HTMLParagraphElement>("height-energy-status");
let heightEnergy = compileHeightEnergy(DEFAULT_HEIGHT_ENERGY);

byId("water-source").innerHTML = `${highlightTypeScript(modelSource)}\n`;

function fitCanvas(target: HTMLCanvasElement): { context: CanvasRenderingContext2D; width: number; height: number } {
  const ratio = Math.min(2, devicePixelRatio || 1);
  const width = Math.max(1, Math.round(target.clientWidth * ratio));
  const height = Math.max(1, Math.round(target.clientHeight * ratio));
  if (target.width !== width || target.height !== height) {
    target.width = width;
    target.height = height;
  }
  const context = context2d(target);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { context, width: width / ratio, height: height / ratio };
}

function color(value: number, scale: number): string {
  const normalized = Math.max(-1, Math.min(1, value / Math.max(1e-14, scale)));
  if (normalized >= 0) {
    const amount = Math.sqrt(normalized);
    return `rgb(${Math.round(29 + 226 * amount)},${Math.round(31 + 90 * amount)},${Math.round(70 + 119 * amount)})`;
  }
  const amount = Math.sqrt(-normalized);
  return `rgb(${Math.round(22 + 38 * amount)},${Math.round(34 + 185 * amount)},${Math.round(73 + 179 * amount)})`;
}

function displayedValues(): number[] {
  if (display === "vorticity") return Array.from(model.curl());
  if (display === "speed") return model.state.velocity.map((velocity) => Math.hypot(velocity.x, velocity.y));
  if (display === "tracer") return Array.from(model.state.tracer);
  return Array.from(model.state.height);
}

function drawField(): void {
  const { context, width, height } = fitCanvas(canvas);
  context.clearRect(0, 0, width, height);
  const values = displayedValues();
  const scale = Math.max(1e-12, ...values.map(Math.abs));
  const n = model.parameters.resolution;
  const side = Math.min(width, height) - 24;
  const left = (width - side) / 2;
  const top = (height - side) / 2;
  const cell = side / n;
  for (let row = 0; row < n; row += 1) {
    for (let column = 0; column < n; column += 1) {
      const index = row * n + column;
      context.fillStyle = display === "speed"
        ? color(values[index]!, scale).replace("rgb(", "rgba(").replace(")", ",.92)")
        : color(values[index]!, scale);
      context.fillRect(left + column * cell, top + (n - 1 - row) * cell, cell + 0.6, cell + 0.6);
    }
  }
  const stride = Math.max(1, Math.ceil(n / 14));
  const maxSpeed = Math.max(1e-12, ...model.state.velocity.map((velocity) => Math.hypot(velocity.x, velocity.y)));
  context.strokeStyle = "rgba(255,255,255,.82)";
  context.fillStyle = "rgba(255,216,109,.95)";
  context.lineWidth = 1.25;
  for (let row = 0; row < n; row += stride) {
    for (let column = 0; column < n; column += stride) {
      const velocity = model.state.velocity[row * n + column]!;
      const x = left + (column + 0.5) * cell;
      const y = top + (n - row - 0.5) * cell;
      const arrowScale = 0.42 * cell * stride / maxSpeed;
      const dx = velocity.x * arrowScale;
      const dy = -velocity.y * arrowScale;
      context.beginPath();
      context.moveTo(x, y);
      context.lineTo(x + dx, y + dy);
      context.stroke();
      context.beginPath();
      context.arc(x + dx, y + dy, 1.35, 0, 2 * Math.PI);
      context.fill();
    }
  }
  context.strokeStyle = "rgba(89,227,239,.62)";
  context.lineWidth = 1;
  context.strokeRect(left, top, side, side);
  context.fillStyle = "rgba(255,255,255,.65)";
  context.font = "700 8px ui-monospace, monospace";
  context.fillText(`periodic patch · max |scalar| ${scale.toExponential(2)}`, left + 6, top + 13);
}

function drawHistory(): void {
  const { context, width, height } = fitCanvas(historyCanvas);
  context.clearRect(0, 0, width, height);
  if (history.length < 2) return;
  const energyScale = Math.max(...history.map((entry) => entry.energy), 1e-14);
  const massScale = Math.max(...history.map((entry) => Math.abs(entry.massDrift)), 1e-16);
  const draw = (read: (entry: typeof history[number]) => number, scale: number, stroke: string): void => {
    context.beginPath();
    history.forEach((entry, index) => {
      const x = 2 + index * (width - 4) / Math.max(1, history.length - 1);
      const y = height - 3 - (height - 7) * read(entry) / scale;
      if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
    });
    context.strokeStyle = stroke;
    context.lineWidth = 1.5;
    context.stroke();
  };
  draw((entry) => entry.energy, energyScale, "#59e3ef");
  draw((entry) => Math.abs(entry.massDrift), massScale, "#ff6fbd");
}

function format(value: number, digits = 2): string {
  if (Math.abs(value) < 1e-15) return "0";
  return value.toExponential(digits);
}

function updateControls(): void {
  outputs.resolution.value = `${model.parameters.resolution} × ${model.parameters.resolution}`;
  outputs.timeStep.value = model.parameters.timeStep.toFixed(4);
  outputs.gravity.value = model.parameters.gravity.toFixed(2);
  outputs.meanDepth.value = model.parameters.meanDepth.toFixed(2);
  const cfl = model.parameters.timeStep * Math.sqrt(
    model.parameters.gravity * model.parameters.meanDepth,
  ) * model.parameters.resolution;
  cflBadge.textContent = `CFL ${cfl.toFixed(2)}`;
  cflBadge.dataset.risk = String(cfl > 0.7);
}

function render(
  diagnostics: ShallowWaterDiagnostics = model.diagnostics(
    (height, gravity) => heightEnergy.evaluate(height, gravity).value,
  ),
): void {
  byId("water-time").textContent = model.state.time.toFixed(3);
  byId("water-mass").textContent = format(diagnostics.massDrift);
  byId("water-energy").textContent = format(diagnostics.energy);
  byId("water-curl").textContent = format(diagnostics.curlRms);
  byId("water-adjoint").textContent = format(diagnostics.adjointDefect);
  byId("water-caption").textContent = display === "height"
    ? "height perturbation + vertex velocity"
    : display === "vorticity"
      ? "derived vorticity ζ = curl u · n"
      : display === "speed"
        ? "vertex speed + velocity arrows"
        : "passive diagnostic dye q + velocity arrows";
  drawField();
  drawHistory();
}

function record(): void {
  const diagnostics = model.diagnostics((height, gravity) => heightEnergy.evaluate(height, gravity).value);
  history.push({ energy: diagnostics.energy, massDrift: diagnostics.massDrift });
  if (history.length > 220) history.shift();
  render(diagnostics);
}

function stop(): void {
  playing = false;
  playButton.textContent = "Play";
  playButton.setAttribute("aria-pressed", "false");
}

function reset(): void {
  stop();
  model = new VertexShallowWaterModel({
    resolution: Math.round(Number(controls.resolution.value)),
    timeStep: Number(controls.timeStep.value),
    gravity: Number(controls.gravity.value),
    meanDepth: Number(controls.meanDepth.value),
    pulseHeight: DEFAULT_SHALLOW_WATER_PARAMETERS.pulseHeight,
    pulseWidth: DEFAULT_SHALLOW_WATER_PARAMETERS.pulseWidth,
  });
  history = [];
  updateControls();
  record();
}

function animate(): void {
  if (!playing) return;
  model.step(2, (height, gravity) => heightEnergy.evaluate(height, gravity).derivative);
  record();
  requestAnimationFrame(animate);
}

for (const input of Object.values(controls)) input.addEventListener("input", updateControls);
for (const input of Object.values(controls)) input.addEventListener("change", reset);
byId<HTMLButtonElement>("water-reset").addEventListener("click", reset);
byId<HTMLButtonElement>("water-step").addEventListener("click", () => {
  stop();
  model.step(1, (height, gravity) => heightEnergy.evaluate(height, gravity).derivative);
  record();
});
playButton.addEventListener("click", () => {
  playing = !playing;
  playButton.textContent = playing ? "Pause" : "Play";
  playButton.setAttribute("aria-pressed", String(playing));
  if (playing) requestAnimationFrame(animate);
});
byId<HTMLButtonElement>("water-vortex").addEventListener("click", () => {
  stop();
  model.state.height.fill(0);
  model.state.initialMass = model.mass();
  model.seedVortex();
  display = "tracer";
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-water-view]")) {
    button.classList.toggle("active", button.dataset.waterView === display);
  }
  record();
  playing = true;
  playButton.textContent = "Pause";
  playButton.setAttribute("aria-pressed", "true");
  requestAnimationFrame(animate);
});
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-water-view]")) {
  button.addEventListener("click", () => {
    display = button.dataset.waterView as typeof display;
    for (const candidate of document.querySelectorAll<HTMLButtonElement>("[data-water-view]")) {
      candidate.classList.toggle("active", candidate === button);
    }
    render();
  });
}

function applyHeightEnergy(): void {
  try {
    heightEnergy = compileHeightEnergy(heightEnergyEditor.value);
    const sample = heightEnergy.evaluate(model.parameters.pulseHeight, model.parameters.gravity);
    heightEnergyStatus.textContent = `Applied. At h=${model.parameters.pulseHeight.toFixed(2)}: V′=${sample.derivative.toExponential(2)}, V″=${sample.secondDerivative.toExponential(2)}. Reset the pulse before comparing histories.`;
    heightEnergyStatus.dataset.kind = sample.secondDerivative >= 0 ? "good" : "bad";
    reset();
  } catch (error) {
    heightEnergyStatus.textContent = error instanceof Error ? error.message : String(error);
    heightEnergyStatus.dataset.kind = "bad";
  }
}
byId<HTMLButtonElement>("apply-height-energy").addEventListener("click", applyHeightEnergy);
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-height-preset]")) {
  button.addEventListener("click", () => {
    heightEnergyEditor.value = button.dataset.heightPreset === "quartic"
      ? "0.5 * g * h^2 + 18 * h^4"
      : DEFAULT_HEIGHT_ENERGY;
    applyHeightEnergy();
  });
}

async function copySource(): Promise<void> {
  await navigator.clipboard.writeText(modelSource);
  byId("water-caption").textContent = "Starter source copied";
}
byId<HTMLButtonElement>("copy-water-source").addEventListener("click", () => void copySource());
byId<HTMLButtonElement>("download-water-source").addEventListener("click", () => {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([modelSource], { type: "text/typescript" }));
  link.download = "shallow-water-model.ts";
  link.click();
  URL.revokeObjectURL(link.href);
});

window.addEventListener("resize", () => {
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => render());
});

reset();
