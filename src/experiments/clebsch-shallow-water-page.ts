import "./clebsch-shallow-water.css";
import "katex/dist/katex.min.css";

import katex from "katex";

import {
  ClebschShallowWaterModel,
  type ClebschWaterPreset,
  type Vec2,
} from "./clebsch-shallow-water-model";

type ScalarLayer = "height" | "phi" | "alpha" | "beta" | "vorticity" | "pv" | "tracer";
type GlyphLayer = "velocity" | "u-flat" | "d-phi" | "alpha-d-beta" | "flux" | "none";

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

function renderLatex(): void {
  for (const element of document.querySelectorAll<HTMLElement>("[data-latex]")) {
    katex.render(element.dataset.latex!, element, {
      displayMode: element.classList.contains("cw-math-display"),
      output: "htmlAndMathml",
      throwOnError: false,
    });
  }
}

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

const canvas = byId<HTMLCanvasElement>("cw-canvas");
const scalarRaster = document.createElement("canvas");
const scalarRasterContext = context2d(scalarRaster);
const playButton = byId<HTMLButtonElement>("cw-play");
const controls = {
  resolution: byId<HTMLInputElement>("cw-resolution"),
  timeStep: byId<HTMLInputElement>("cw-dt"),
  gravity: byId<HTMLInputElement>("cw-gravity"),
  meanDepth: byId<HTMLInputElement>("cw-depth"),
  clebschStrength: byId<HTMLInputElement>("cw-strength"),
  angle: byId<HTMLInputElement>("cw-angle"),
};
const outputs = {
  resolution: byId<HTMLOutputElement>("cw-resolution-output"),
  timeStep: byId<HTMLOutputElement>("cw-dt-output"),
  gravity: byId<HTMLOutputElement>("cw-gravity-output"),
  meanDepth: byId<HTMLOutputElement>("cw-depth-output"),
  clebschStrength: byId<HTMLOutputElement>("cw-strength-output"),
  angle: byId<HTMLOutputElement>("cw-angle-output"),
};

let preset: ClebschWaterPreset = "crossing-labels";
let model = new ClebschShallowWaterModel();
let scalarLayer: ScalarLayer = "height";
let glyphLayer: GlyphLayer = "velocity";
let playing = false;
let probe = { x: 0.62, y: 0.54 };
let plotBounds = { left: 0, top: 0, side: 1 };
let lastFrame = 0;

const scalarCaptions: Record<ScalarLayer, string> = {
  height: "height h − H",
  phi: "Bernoulli potential φ",
  alpha: "material label weight α",
  beta: "material label β",
  vorticity: "vorticity ζ = curl u",
  pv: "potential vorticity q = ζ/h",
  tracer: "passive material dye",
};

const glyphCaptions: Record<GlyphLayer, string> = {
  velocity: "velocity vectors",
  "u-flat": "velocity one-form u♭",
  "d-phi": "exact covectors dφ",
  "alpha-d-beta": "label covectors αdβ",
  flux: "mass-flux vectors hu",
  none: "no glyphs",
};

const glyphNotes: Record<GlyphLayer, string> = {
  velocity: "Arrows are vectors: they point where a particle moves.",
  "u-flat": "Parallel bars are covectors: motion along a bar is in the kernel; crossing bars produces a nonzero reading.",
  "d-phi": "These bars represent the exact one-form dφ. Its exterior derivative—and therefore its vorticity—is zero.",
  "alpha-d-beta": "These bars represent αdβ. Their curl is dα ∧ dβ, the rotational Clebsch contribution.",
  flux: "Flux arrows are h u: velocity weighted by the local water column.",
  none: "Only the selected scalar field is shown; colors are numbers, not directions.",
};

function readModel(): ClebschShallowWaterModel {
  return new ClebschShallowWaterModel({
    resolution: Math.round(Number(controls.resolution.value)),
    timeStep: Number(controls.timeStep.value),
    gravity: Number(controls.gravity.value),
    meanDepth: Number(controls.meanDepth.value),
    clebschStrength: Number(controls.clebschStrength.value),
    preset,
  });
}

function updateOutputs(): void {
  outputs.resolution.value = `${Math.round(Number(controls.resolution.value))} × ${Math.round(Number(controls.resolution.value))}`;
  outputs.timeStep.value = Number(controls.timeStep.value).toFixed(4);
  outputs.gravity.value = Number(controls.gravity.value).toFixed(2);
  outputs.meanDepth.value = Number(controls.meanDepth.value).toFixed(2);
  outputs.clebschStrength.value = Number(controls.clebschStrength.value).toFixed(2);
  outputs.angle.value = `${Math.round(Number(controls.angle.value))}°`;
}

function fieldValues(layer: ScalarLayer): Float64Array {
  if (layer === "height") {
    return Float64Array.from(model.state.height, (value) => value - model.parameters.meanDepth);
  }
  if (layer === "phi") return model.state.phi;
  if (layer === "alpha") return model.state.alpha;
  if (layer === "beta") return model.state.beta;
  if (layer === "vorticity") return model.curl();
  if (layer === "pv") return model.potentialVorticity();
  return model.state.tracer;
}

function maximumMagnitude(values: ArrayLike<number>): number {
  let maximum = 0;
  for (let index = 0; index < values.length; index += 1) maximum = Math.max(maximum, Math.abs(values[index]!));
  return Math.max(1e-12, maximum);
}

function scalarColor(value: number, scale: number, layer: ScalarLayer): [number, number, number] {
  if (layer === "tracer") {
    const amount = Math.max(0, Math.min(1, value / scale));
    return [Math.round(14 + 237 * amount), Math.round(42 + 151 * amount), Math.round(40 + 40 * amount)];
  }
  const normalized = Math.max(-1, Math.min(1, value / scale));
  if (normalized >= 0) {
    const amount = Math.sqrt(normalized);
    return [Math.round(18 + 236 * amount), Math.round(48 + 93 * amount), Math.round(48 + 20 * amount)];
  }
  const amount = Math.sqrt(-normalized);
  return [Math.round(12 + 29 * amount), Math.round(52 + 171 * amount), Math.round(49 + 177 * amount)];
}

function samplePeriodicScalar(values: ArrayLike<number>, gridX: number, gridY: number, n: number): number {
  const left = Math.floor(gridX);
  const bottom = Math.floor(gridY);
  const tx = gridX - left;
  const ty = gridY - bottom;
  const index = (column: number, row: number): number => (
    ((row % n + n) % n) * n + ((column % n + n) % n)
  );
  const v00 = values[index(left, bottom)]!;
  const v10 = values[index(left + 1, bottom)]!;
  const v01 = values[index(left, bottom + 1)]!;
  const v11 = values[index(left + 1, bottom + 1)]!;
  return (1 - ty) * ((1 - tx) * v00 + tx * v10) + ty * ((1 - tx) * v01 + tx * v11);
}

function drawScalarCells(
  context: CanvasRenderingContext2D,
  values: ArrayLike<number>,
  layer: ScalarLayer,
  left: number,
  top: number,
  side: number,
  showGrid: boolean,
): void {
  const n = model.parameters.resolution;
  const scale = maximumMagnitude(values);
  const rasterSize = Math.min(224, Math.max(112, 4 * n));
  if (scalarRaster.width !== rasterSize || scalarRaster.height !== rasterSize) {
    scalarRaster.width = rasterSize;
    scalarRaster.height = rasterSize;
  }
  const image = scalarRasterContext.createImageData(rasterSize, rasterSize);
  for (let row = 0; row < rasterSize; row += 1) {
    for (let column = 0; column < rasterSize; column += 1) {
      const gridX = n * (column + 0.5) / rasterSize - 0.5;
      const gridY = n * (1 - (row + 0.5) / rasterSize) - 0.5;
      const [red, green, blue] = scalarColor(samplePeriodicScalar(values, gridX, gridY, n), scale, layer);
      const offset = 4 * (row * rasterSize + column);
      image.data[offset] = red;
      image.data[offset + 1] = green;
      image.data[offset + 2] = blue;
      image.data[offset + 3] = 255;
    }
  }
  scalarRasterContext.putImageData(image, 0, 0);
  context.save();
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(scalarRaster, left, top, side, side);
  context.restore();
  if (!showGrid) return;
  const cell = side / n;
  const coarse = Math.max(1, Math.round(n / 8));
  context.strokeStyle = "rgba(255,255,255,.14)";
  context.lineWidth = 1;
  for (let index = 0; index <= n; index += coarse) {
    const coordinate = index * cell;
    context.beginPath();
    context.moveTo(left + coordinate, top);
    context.lineTo(left + coordinate, top + side);
    context.stroke();
    context.beginPath();
    context.moveTo(left, top + coordinate);
    context.lineTo(left + side, top + coordinate);
    context.stroke();
  }
}

function glyphVectors(): { vectors: Vec2[]; covectors: boolean; color: string } | undefined {
  if (glyphLayer === "none") return undefined;
  const velocity = model.velocity();
  if (glyphLayer === "velocity") return { vectors: velocity, covectors: false, color: "rgba(255,247,214,.94)" };
  if (glyphLayer === "flux") {
    return {
      vectors: velocity.map((value, index) => ({
        x: model.state.height[index]! * value.x,
        y: model.state.height[index]! * value.y,
      })),
      covectors: false,
      color: "rgba(185,223,97,.95)",
    };
  }
  if (glyphLayer === "u-flat") return { vectors: velocity, covectors: true, color: "rgba(185,223,97,.9)" };
  if (glyphLayer === "d-phi") return { vectors: model.gradient(model.state.phi), covectors: true, color: "rgba(255,168,91,.9)" };
  const dBeta = model.gradient(model.state.beta);
  return {
    vectors: dBeta.map((value, index) => ({
      x: model.state.alpha[index]! * value.x,
      y: model.state.alpha[index]! * value.y,
    })),
    covectors: true,
    color: "rgba(85,220,225,.9)",
  };
}

function drawArrow(context: CanvasRenderingContext2D, x: number, y: number, dx: number, dy: number): void {
  context.beginPath();
  context.moveTo(x, y);
  context.lineTo(x + dx, y + dy);
  context.stroke();
  const angle = Math.atan2(dy, dx);
  const head = Math.min(5, 0.35 * Math.hypot(dx, dy) + 1.5);
  context.beginPath();
  context.moveTo(x + dx, y + dy);
  context.lineTo(x + dx - head * Math.cos(angle - 0.55), y + dy - head * Math.sin(angle - 0.55));
  context.moveTo(x + dx, y + dy);
  context.lineTo(x + dx - head * Math.cos(angle + 0.55), y + dy - head * Math.sin(angle + 0.55));
  context.stroke();
}

function drawCovector(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  covector: Vec2,
  length: number,
  maximum: number,
): void {
  const magnitude = Math.hypot(covector.x, covector.y);
  if (magnitude < 1e-12) return;
  const normalX = covector.x / magnitude;
  const normalY = -covector.y / magnitude;
  const kernelX = -normalY;
  const kernelY = normalX;
  const opacity = 0.32 + 0.68 * Math.sqrt(magnitude / Math.max(1e-12, maximum));
  context.globalAlpha = opacity;
  for (const offset of [-2.6, 0, 2.6]) {
    const centerX = x + offset * normalX;
    const centerY = y + offset * normalY;
    context.beginPath();
    context.moveTo(centerX - 0.5 * length * kernelX, centerY - 0.5 * length * kernelY);
    context.lineTo(centerX + 0.5 * length * kernelX, centerY + 0.5 * length * kernelY);
    context.stroke();
  }
  context.globalAlpha = 1;
}

function drawGlyphs(context: CanvasRenderingContext2D, left: number, top: number, side: number): void {
  const field = glyphVectors();
  if (!field) return;
  const n = model.parameters.resolution;
  const cell = side / n;
  const stride = Math.max(1, Math.ceil(n / 12));
  const maximum = Math.max(1e-12, ...field.vectors.map((value) => Math.hypot(value.x, value.y)));
  context.strokeStyle = field.color;
  context.lineWidth = field.covectors ? 1.15 : 1.35;
  for (let row = 0; row < n; row += stride) {
    for (let column = 0; column < n; column += stride) {
      const vector = field.vectors[row * n + column]!;
      const x = left + (column + 0.5) * cell;
      const y = top + (n - row - 0.5) * cell;
      if (field.covectors) {
        drawCovector(context, x, y, vector, 0.55 * cell * stride, maximum);
      } else {
        const factor = 0.4 * cell * stride / maximum;
        drawArrow(context, x, y, factor * vector.x, -factor * vector.y);
      }
    }
  }
}

function drawField(): void {
  const { context, width, height } = fitCanvas(canvas);
  context.clearRect(0, 0, width, height);
  const side = Math.max(1, Math.min(width, height) - 28);
  const left = 0.5 * (width - side);
  const top = 0.5 * (height - side);
  plotBounds = { left, top, side };
  drawScalarCells(context, fieldValues(scalarLayer), scalarLayer, left, top, side, true);
  drawGlyphs(context, left, top, side);
  const markerX = left + probe.x * side;
  const markerY = top + (1 - probe.y) * side;
  context.strokeStyle = "rgba(255,255,255,.95)";
  context.lineWidth = 1.5;
  context.beginPath();
  context.arc(markerX, markerY, 6, 0, 2 * Math.PI);
  context.stroke();
  context.beginPath();
  context.moveTo(markerX - 9, markerY);
  context.lineTo(markerX + 9, markerY);
  context.moveTo(markerX, markerY - 9);
  context.lineTo(markerX, markerY + 9);
  context.stroke();
  context.strokeStyle = "rgba(185,223,97,.78)";
  context.strokeRect(left, top, side, side);
  context.fillStyle = "rgba(255,255,255,.72)";
  context.font = "700 8px ui-monospace, monospace";
  context.fillText("bilinear view · faint lines show the periodic computational grid", left + 7, top + 13);
}

function drawAtlas(): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-cw-atlas]")) {
    const layer = button.dataset.cwAtlas as "height" | "phi" | "alpha" | "beta";
    const tile = button.querySelector("canvas")!;
    const { context, width, height } = fitCanvas(tile);
    context.clearRect(0, 0, width, height);
    drawScalarCells(context, fieldValues(layer), layer, 0, 0, Math.min(width, height), false);
    button.classList.toggle("active", scalarLayer === layer);
  }
}

function format(value: number): string {
  if (Math.abs(value) < 5e-14) return "0";
  return value.toExponential(2).replace("e-", "e−");
}

function updateProbe(): void {
  const sample = model.samplePoint(probe.x, probe.y);
  const angle = Number(controls.angle.value) * Math.PI / 180;
  const displacement = { x: Math.cos(angle), y: Math.sin(angle) };
  const exactPairing = sample.dPhi.x * displacement.x + sample.dPhi.y * displacement.y;
  const labelPairing = sample.alphaDBeta.x * displacement.x + sample.alphaDBeta.y * displacement.y;
  const pairing = exactPairing + labelPairing;
  byId("cw-probe-location").textContent = `x = ${probe.x.toFixed(2)} · y = ${probe.y.toFixed(2)}`;
  byId("cw-probe-h").textContent = sample.height.toFixed(3);
  byId("cw-probe-alpha").textContent = sample.alpha.toFixed(3);
  byId("cw-probe-beta").textContent = sample.beta.toFixed(3);
  byId("cw-probe-pv").textContent = format(sample.potentialVorticity);
  byId("cw-probe-pairing").textContent = `u♭(δx) = ${pairing.toFixed(4)}`;
  byId("cw-probe-breakdown").textContent = `dφ contributes ${exactPairing.toFixed(4)}; αdβ contributes ${labelPairing.toFixed(4)}. Their sum is the covector reading. On this Euclidean grid the raised velocity has components u = (${sample.velocity.x.toFixed(3)}, ${sample.velocity.y.toFixed(3)}).`;
}

function updateChoiceButtons(): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-cw-layer]")) {
    button.classList.toggle("active", button.dataset.cwLayer === scalarLayer);
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-cw-glyph]")) {
    button.classList.toggle("active", button.dataset.cwGlyph === glyphLayer);
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-cw-preset]")) {
    button.classList.toggle("active", button.dataset.cwPreset === preset);
  }
  byId("cw-caption").textContent = `${scalarCaptions[scalarLayer]} with ${glyphCaptions[glyphLayer]}`;
  byId("cw-glyph-note").textContent = glyphNotes[glyphLayer];
}

function render(): void {
  const diagnostics = model.diagnostics();
  byId("cw-time").textContent = model.state.time.toFixed(3);
  byId("cw-mass").textContent = format(diagnostics.massDrift);
  byId("cw-energy").textContent = format(diagnostics.energy);
  byId("cw-divergence").textContent = format(diagnostics.divergenceRms);
  byId("cw-vorticity").textContent = format(diagnostics.vorticityRms);
  byId("cw-identity").textContent = format(diagnostics.clebschIdentityRms);
  drawField();
  drawAtlas();
  updateProbe();
  updateChoiceButtons();
}

function reset(reason: string): void {
  model = readModel();
  byId("cw-status").textContent = reason;
  render();
}

function setPlaying(value: boolean): void {
  playing = value;
  playButton.textContent = playing ? "Pause" : "Play";
  playButton.setAttribute("aria-pressed", String(playing));
  byId("cw-status").textContent = playing ? "material labels advecting" : "paused";
}

for (const input of [controls.resolution, controls.timeStep, controls.gravity, controls.meanDepth, controls.clebschStrength]) {
  input.addEventListener("input", updateOutputs);
  input.addEventListener("change", () => reset("parameters rebuilt"));
}

controls.angle.addEventListener("input", () => {
  updateOutputs();
  updateProbe();
});

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-cw-layer]")) {
  button.addEventListener("click", () => {
    scalarLayer = button.dataset.cwLayer as ScalarLayer;
    render();
  });
}

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-cw-atlas]")) {
  button.addEventListener("click", () => {
    scalarLayer = button.dataset.cwAtlas as ScalarLayer;
    render();
  });
}

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-cw-glyph]")) {
  button.addEventListener("click", () => {
    glyphLayer = button.dataset.cwGlyph as GlyphLayer;
    render();
  });
}

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-cw-preset]")) {
  button.addEventListener("click", () => {
    preset = button.dataset.cwPreset as ClebschWaterPreset;
    reset(`${button.textContent?.trim().toLowerCase()} loaded`);
  });
}

canvas.addEventListener("pointerdown", (event) => {
  const bounds = canvas.getBoundingClientRect();
  const x = event.clientX - bounds.left;
  const y = event.clientY - bounds.top;
  probe = {
    x: Math.max(0, Math.min(1, (x - plotBounds.left) / plotBounds.side)),
    y: Math.max(0, Math.min(1, 1 - (y - plotBounds.top) / plotBounds.side)),
  };
  render();
});

byId<HTMLButtonElement>("cw-reset").addEventListener("click", () => reset("initial fields restored"));
byId<HTMLButtonElement>("cw-step").addEventListener("click", () => {
  setPlaying(false);
  model.step();
  byId("cw-status").textContent = "one material step";
  render();
});
playButton.addEventListener("click", () => setPlaying(!playing));

function animate(time: number): void {
  requestAnimationFrame(animate);
  if (!playing || time - lastFrame < 32) return;
  model.step(3);
  render();
  lastFrame = time;
}

const resizeObserver = new ResizeObserver(render);
resizeObserver.observe(canvas);

renderLatex();
updateOutputs();
render();
requestAnimationFrame(animate);
