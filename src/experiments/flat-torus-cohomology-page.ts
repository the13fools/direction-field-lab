import "./flat-torus-cohomology.css";
import "katex/dist/katex.min.css";

import katex from "katex";

import {
  FlatTorusCohomologyModel,
  type FlatTorusParticlePair,
  type TorusVec2,
} from "./flat-torus-cohomology-model";

type ArrowView = "raw" | "reduced" | "coexact" | "none";
type MaterialView = "both" | "raw" | "reduced" | "none";
type TrailPoint = { x: number; y: number };

function byId<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing #${id}.`);
  return value as T;
}

function renderLatex(element: HTMLElement, source: string, displayMode = false): void {
  katex.render(source, element, { displayMode, output: "htmlAndMathml", throwOnError: false });
}

function renderStaticLatex(): void {
  for (const element of document.querySelectorAll<HTMLElement>("[data-latex]")) {
    renderLatex(element, element.dataset.latex!, element.classList.contains("ft-math-display"));
  }
}

function format(value: number, digits = 2): string {
  if (Math.abs(value) < 0.5 * 10 ** -digits) return (0).toFixed(digits);
  return value.toFixed(digits).replaceAll("-", "−");
}

function latexNumber(value: number, digits = 2): string {
  if (Math.abs(value) < 0.5 * 10 ** -digits) return (0).toFixed(digits);
  return value.toFixed(digits);
}

function pair(vector: TorusVec2): string {
  return `(${format(vector.x)}, ${format(vector.y)})`;
}

const canvas = byId<HTMLCanvasElement>("ft-canvas");
const canvasContext = canvas.getContext("2d");
if (!canvasContext) throw new Error("Canvas 2D is unavailable.");
const context: CanvasRenderingContext2D = canvasContext;

const controls = {
  periodX: byId<HTMLInputElement>("ft-period-x"),
  periodY: byId<HTMLInputElement>("ft-period-y"),
  vortex: byId<HTMLInputElement>("ft-vortex"),
  quantum: byId<HTMLInputElement>("ft-quantum"),
};
const outputs = {
  periodX: byId<HTMLOutputElement>("ft-period-x-output"),
  periodY: byId<HTMLOutputElement>("ft-period-y-output"),
  vortex: byId<HTMLOutputElement>("ft-vortex-output"),
  quantum: byId<HTMLOutputElement>("ft-quantum-output"),
};

let model = new FlatTorusCohomologyModel();
let arrowView: ArrowView = "reduced";
let materialView: MaterialView = "both";
let playing = false;
let previousFrame = 0;
let rawTrails: TrailPoint[][] = [];
let reducedTrails: TrailPoint[][] = [];

function resetTrails(): void {
  rawTrails = model.particles.map((pair) => [{ x: pair.raw.x, y: pair.raw.y }]);
  reducedTrails = model.particles.map((pair) => [{ x: pair.reduced.x, y: pair.reduced.y }]);
}

function appendTrails(): void {
  const keptParticles = Math.min(90, model.particles.length);
  for (let index = 0; index < keptParticles; index += 1) {
    const particle = model.particles[index]!;
    rawTrails[index]!.push({ x: particle.raw.x, y: particle.raw.y });
    reducedTrails[index]!.push({ x: particle.reduced.x, y: particle.reduced.y });
    if (rawTrails[index]!.length > 34) rawTrails[index]!.shift();
    if (reducedTrails[index]!.length > 34) reducedTrails[index]!.shift();
  }
}

function updateOutputs(): void {
  outputs.periodX.value = format(Number(controls.periodX.value));
  outputs.periodY.value = format(Number(controls.periodY.value));
  outputs.vortex.value = format(Number(controls.vortex.value));
  outputs.quantum.value = format(Number(controls.quantum.value));
}

function updateModelFromControls(): void {
  model.reset({
    periodX: Number(controls.periodX.value),
    periodY: Number(controls.periodY.value),
    vortexStrength: Number(controls.vortex.value),
    quantum: Number(controls.quantum.value),
  });
  resetTrails();
  updateOutputs();
  updateInterface();
}

function updateInterface(): void {
  const diagnostics = model.diagnostics();
  byId("ft-raw-period").textContent = pair(diagnostics.rawPeriod);
  byId("ft-removed-period").textContent = pair(diagnostics.removedPeriod);
  byId("ft-residual-period").textContent = pair(diagnostics.residualPeriod);
  byId("ft-energy").textContent = format(diagnostics.residualHarmonicEnergy, 3);
  byId("ft-raw-winding").textContent = pair(diagnostics.rawMeanWinding);
  byId("ft-reduced-winding").textContent = pair(diagnostics.reducedMeanWinding);
  byId("ft-lattice-selection").textContent = `(m,n) = (${model.parameters.subtractX},${model.parameters.subtractY})`.replaceAll("-", "−");
  renderLatex(
    byId("ft-live-equation"),
    String.raw`(c_x,c_y)-q(m,n)=(${latexNumber(diagnostics.residualPeriod.x)},${latexNumber(diagnostics.residualPeriod.y)})`,
    true,
  );
  const residualMagnitude = Math.hypot(diagnostics.residualPeriod.x, diagnostics.residualPeriod.y);
  const rawMagnitude = Math.hypot(diagnostics.rawPeriod.x, diagnostics.rawPeriod.y);
  const removedMagnitude = Math.hypot(diagnostics.removedPeriod.x, diagnostics.removedPeriod.y);
  const nearest = model.nearestQuantizedField();
  const isNearest = nearest.x === model.parameters.subtractX && nearest.y === model.parameters.subtractY;
  byId("ft-live-copy").textContent = rawMagnitude < 1e-10 && removedMagnitude < 1e-10
    ? "This is the same zero-harmonic Taylor–Green sector as the evolving-label demo: both grids coincide and deform locally, with no uniform torus drift."
    : removedMagnitude < 1e-10
      ? `(m,n) = (0,0) removes nothing; it does not set c to zero. Both coincident grids still carry the physical harmonic drift ${pair(diagnostics.rawPeriod)}.`
      : residualMagnitude < 1e-10
        ? "The selected lattice field exactly cancels the physical harmonic periods. The cyan grid now deforms only inside the local vortex cells."
        : `${isNearest ? "This is the nearest lattice representative." : "This is not the nearest lattice representative."} The remaining harmonic speed is ${format(residualMagnitude, 3)}. Both grids have the same local bending; their relative slide is harmonic transport.`;
  const matchesClebschDemo = rawMagnitude < 1e-10
    && removedMagnitude < 1e-10
    && Math.abs(model.parameters.vortexStrength - 0.8) < 1e-10;
  const matchButton = byId<HTMLButtonElement>("ft-match-clebsch");
  matchButton.classList.toggle("active", matchesClebschDemo);
  matchButton.setAttribute("aria-pressed", String(matchesClebschDemo));
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-ft-lattice]")) {
    const [x, y] = button.dataset.ftLattice!.split(",").map(Number);
    const active = x === model.parameters.subtractX && y === model.parameters.subtractY;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
}

function fitCanvas(): { width: number; height: number; left: number; top: number; side: number } {
  const ratio = Math.min(2, devicePixelRatio || 1);
  const width = Math.max(1, canvas.clientWidth);
  const height = Math.max(1, canvas.clientHeight);
  const pixelWidth = Math.round(width * ratio);
  const pixelHeight = Math.round(height * ratio);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  const side = Math.max(1, Math.min(width - 88, height - 62));
  return { width, height, left: 49 + 0.5 * (width - 88 - side), top: 22 + 0.5 * (height - 62 - side), side };
}

function vorticityColor(value: number, maximum: number): string {
  const amount = Math.min(1, Math.sqrt(Math.abs(value) / Math.max(1e-12, maximum)));
  if (value >= 0) {
    return `rgb(${Math.round(31 + 222 * amount)},${Math.round(31 + 88 * amount)},${Math.round(49 + 23 * amount)})`;
  }
  return `rgb(${Math.round(20 + 28 * amount)},${Math.round(33 + 155 * amount)},${Math.round(55 + 147 * amount)})`;
}

function canvasPoint(point: TrailPoint, left: number, top: number, side: number): TrailPoint {
  return { x: left + side * point.x, y: top + side * (1 - point.y) };
}

function drawBackground(left: number, top: number, side: number): void {
  const cells = 54;
  const cell = side / cells;
  const maximum = 4 * Math.PI * model.parameters.vortexStrength;
  for (let row = 0; row < cells; row += 1) {
    for (let column = 0; column < cells; column += 1) {
      const sample = model.sample((column + 0.5) / cells, (row + 0.5) / cells);
      context.fillStyle = vorticityColor(sample.vorticity, maximum);
      context.fillRect(left + column * cell, top + (cells - 1 - row) * cell, cell + 0.5, cell + 0.5);
    }
  }
  context.strokeStyle = "rgba(255,255,255,.12)";
  context.lineWidth = 1;
  for (let index = 0; index <= 8; index += 1) {
    const coordinate = index * side / 8;
    context.beginPath();
    context.moveTo(left + coordinate, top);
    context.lineTo(left + coordinate, top + side);
    context.moveTo(left, top + coordinate);
    context.lineTo(left + side, top + coordinate);
    context.stroke();
  }
}

function selectedVelocity(x: number, y: number): TorusVec2 {
  const sample = model.sample(x, y);
  if (arrowView === "raw") return sample.rawVelocity;
  if (arrowView === "reduced") return sample.reducedVelocity;
  return sample.coexactVelocity;
}

function drawArrow(x: number, y: number, vector: TorusVec2, maximum: number, side: number): void {
  const magnitude = Math.hypot(vector.x, vector.y);
  if (magnitude < 1e-10) return;
  const length = side * (0.018 + 0.035 * Math.sqrt(magnitude / maximum));
  const dx = length * vector.x / magnitude;
  const dy = -length * vector.y / magnitude;
  const angle = Math.atan2(dy, dx);
  context.beginPath();
  context.moveTo(x - 0.35 * dx, y - 0.35 * dy);
  context.lineTo(x + 0.65 * dx, y + 0.65 * dy);
  context.lineTo(x + 0.65 * dx - 5 * Math.cos(angle - 0.55), y + 0.65 * dy - 5 * Math.sin(angle - 0.55));
  context.moveTo(x + 0.65 * dx, y + 0.65 * dy);
  context.lineTo(x + 0.65 * dx - 5 * Math.cos(angle + 0.55), y + 0.65 * dy - 5 * Math.sin(angle + 0.55));
  context.stroke();
}

function drawArrows(left: number, top: number, side: number): void {
  if (arrowView === "none") return;
  const count = 13;
  let maximum = 1e-12;
  for (let row = 0; row < count; row += 1) {
    for (let column = 0; column < count; column += 1) {
      const vector = selectedVelocity((column + 0.5) / count, (row + 0.5) / count);
      maximum = Math.max(maximum, Math.hypot(vector.x, vector.y));
    }
  }
  context.strokeStyle = arrowView === "raw" ? "rgba(255,190,107,.88)" : arrowView === "reduced" ? "rgba(202,255,255,.9)" : "rgba(221,255,166,.88)";
  context.lineWidth = 1.15;
  for (let row = 0; row < count; row += 1) {
    for (let column = 0; column < count; column += 1) {
      const x = (column + 0.5) / count;
      const y = (row + 0.5) / count;
      const point = canvasPoint({ x, y }, left, top, side);
      drawArrow(point.x, point.y, selectedVelocity(x, y), maximum, side);
    }
  }
}

function drawTrails(trails: TrailPoint[][], color: string, left: number, top: number, side: number): void {
  context.strokeStyle = color;
  context.lineWidth = 1;
  for (const trail of trails.slice(0, 90)) {
    context.beginPath();
    for (let index = 0; index < trail.length; index += 1) {
      const point = canvasPoint(trail[index]!, left, top, side);
      const previous = index > 0 ? trail[index - 1]! : undefined;
      if (!previous || Math.abs(previous.x - trail[index]!.x) > 0.5 || Math.abs(previous.y - trail[index]!.y) > 0.5) {
        context.moveTo(point.x, point.y);
      } else {
        context.lineTo(point.x, point.y);
      }
    }
    context.stroke();
  }
}

function drawMaterialLine(
  line: readonly FlatTorusParticlePair[],
  key: "raw" | "reduced",
  color: string,
  left: number,
  top: number,
  side: number,
): void {
  context.beginPath();
  for (let index = 0; index <= line.length; index += 1) {
    const current = line[index % line.length]![key];
    const previous = index > 0 ? line[(index - 1) % line.length]![key] : undefined;
    const point = canvasPoint(current, left, top, side);
    const crossedPeriodicSeam = previous
      ? Math.abs(current.x - previous.x) > 0.5 || Math.abs(current.y - previous.y) > 0.5
      : true;
    const unresolvedStretch = previous
      ? Math.hypot(current.x - previous.x, current.y - previous.y) > 0.085
      : false;
    if (crossedPeriodicSeam || unresolvedStretch) context.moveTo(point.x, point.y);
    else context.lineTo(point.x, point.y);
  }
  context.strokeStyle = color;
  context.lineWidth = 1.35;
  context.lineJoin = "round";
  context.lineCap = "round";
  context.stroke();
}

function drawMaterialGrid(left: number, top: number, side: number): void {
  if (materialView === "none") return;
  context.save();
  context.beginPath();
  context.rect(left, top, side, side);
  context.clip();
  for (const line of model.materialLines) {
    if (materialView === "both" || materialView === "raw") {
      drawMaterialLine(line, "raw", "rgba(255,190,107,.7)", left, top, side);
    }
    if (materialView === "both" || materialView === "reduced") {
      drawMaterialLine(line, "reduced", "rgba(105,239,242,.74)", left, top, side);
    }
  }
  context.restore();
}

function drawParticles(particles: FlatTorusParticlePair[], left: number, top: number, side: number): void {
  context.fillStyle = "#ff9a58";
  for (const pair of particles) {
    const point = canvasPoint(pair.raw, left, top, side);
    context.beginPath();
    context.arc(point.x, point.y, 1.8, 0, 2 * Math.PI);
    context.fill();
  }
  context.fillStyle = "#69eff2";
  for (const pair of particles) {
    const point = canvasPoint(pair.reduced, left, top, side);
    context.fillRect(point.x - 1.6, point.y - 1.6, 3.2, 3.2);
  }
}

function drawFrame(left: number, top: number, side: number): void {
  context.strokeStyle = "#ffd56c";
  context.lineWidth = 2;
  context.strokeRect(left, top, side, side);
  context.fillStyle = "#b9c9d6";
  context.font = '700 9px "SFMono-Regular", Consolas, monospace';
  context.textAlign = "center";
  context.fillText("x = 0", left, top + side + 22);
  context.fillText("x = 1  ~  x = 0", left + side, top + side + 22);
  context.save();
  context.translate(left - 25, top + side);
  context.rotate(-Math.PI / 2);
  context.fillText("y = 0", 0, 0);
  context.restore();
  context.save();
  context.translate(left - 25, top);
  context.rotate(-Math.PI / 2);
  context.fillText("y = 1  ~  y = 0", 0, 0);
  context.restore();
}

function draw(): void {
  const { width, height, left, top, side } = fitCanvas();
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#081321";
  context.fillRect(0, 0, width, height);
  drawBackground(left, top, side);
  drawArrows(left, top, side);
  drawMaterialGrid(left, top, side);
  drawTrails(rawTrails, "rgba(255,154,88,.26)", left, top, side);
  drawTrails(reducedTrails, "rgba(105,239,242,.32)", left, top, side);
  drawParticles(model.particles, left, top, side);
  drawFrame(left, top, side);
}

function stepModel(timeStep: number): void {
  const substeps = Math.max(1, Math.ceil(timeStep / 0.012));
  for (let step = 0; step < substeps; step += 1) model.step(timeStep / substeps);
  appendTrails();
  updateInterface();
}

function animate(now: number): void {
  const elapsed = previousFrame > 0 ? Math.min(0.05, (now - previousFrame) / 1000) : 0;
  previousFrame = now;
  if (playing && elapsed > 0) stepModel(0.42 * elapsed);
  draw();
  requestAnimationFrame(animate);
}

function setLatticePoint(x: number, y: number): void {
  model.reset({ subtractX: x, subtractY: y });
  resetTrails();
  updateInterface();
}

const lattice = byId("ft-lattice");
for (let y = 3; y >= -3; y -= 1) {
  for (let x = -3; x <= 3; x += 1) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.ftLattice = `${x},${y}`;
    button.textContent = `${x},${y}`.replaceAll("-", "−");
    button.setAttribute("aria-label", `Subtract harmonic lattice field (${x}, ${y})`);
    button.addEventListener("click", () => setLatticePoint(x, y));
    lattice.append(button);
  }
}

for (const input of Object.values(controls)) input.addEventListener("input", updateModelFromControls);

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-ft-arrows]")) {
  button.addEventListener("click", () => {
    arrowView = button.dataset.ftArrows as ArrowView;
    for (const peer of document.querySelectorAll<HTMLButtonElement>("[data-ft-arrows]")) {
      peer.classList.toggle("active", peer === button);
    }
  });
}

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-ft-material]")) {
  button.addEventListener("click", () => {
    materialView = button.dataset.ftMaterial as MaterialView;
    for (const peer of document.querySelectorAll<HTMLButtonElement>("[data-ft-material]")) {
      const active = peer === button;
      peer.classList.toggle("active", active);
      peer.setAttribute("aria-pressed", String(active));
    }
  });
}

byId<HTMLButtonElement>("ft-nearest").addEventListener("click", () => {
  const nearest = model.nearestQuantizedField();
  setLatticePoint(nearest.x, nearest.y);
});
byId<HTMLButtonElement>("ft-zero").addEventListener("click", () => setLatticePoint(0, 0));
byId<HTMLButtonElement>("ft-match-clebsch").addEventListener("click", () => {
  controls.periodX.value = "0";
  controls.periodY.value = "0";
  controls.vortex.value = "0.8";
  model.reset({
    periodX: 0,
    periodY: 0,
    vortexStrength: 0.8,
    subtractX: 0,
    subtractY: 0,
  });
  resetTrails();
  updateOutputs();
  updateInterface();
});
byId<HTMLButtonElement>("ft-reset").addEventListener("click", () => {
  model.resetParticles();
  resetTrails();
  updateInterface();
});
byId<HTMLButtonElement>("ft-step").addEventListener("click", () => stepModel(0.025));
byId<HTMLButtonElement>("ft-play").addEventListener("click", () => {
  playing = !playing;
  const button = byId<HTMLButtonElement>("ft-play");
  button.textContent = playing ? "Pause" : "Play";
  button.classList.toggle("active", playing);
});

renderStaticLatex();
resetTrails();
updateOutputs();
updateInterface();
new ResizeObserver(draw).observe(canvas);
requestAnimationFrame(animate);
