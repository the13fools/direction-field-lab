import "./disk-circulation.css";
import "katex/dist/katex.min.css";

import katex from "katex";
import {
  advectAnnulusPoint,
  advectDiskPoint,
  annulusCirculation,
  annulusCoefficients,
  loopCirculation,
  sampleAnnulus,
  sampleSmoothDisk,
  type DiskPoint,
} from "./disk-circulation-model";

type GridView = "both" | "alpha" | "beta" | "none";
type PageMode = "smooth" | "annulus";

const TAU = 2 * Math.PI;
const PUNCTURE_RADIUS = 0.24;

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
  renderLatex(element, element.dataset.latex!, element.classList.contains("dd-math-display"));
}

const canvas = byId<HTMLCanvasElement>("dd-canvas");
const canvasContext = canvas.getContext("2d");
if (!canvasContext) throw new Error("Canvas 2D is unavailable");
const context: CanvasRenderingContext2D = canvasContext;

const speedInput = byId<HTMLInputElement>("dd-speed");
const innerInput = byId<HTMLInputElement>("dd-inner");
const outerInput = byId<HTMLInputElement>("dd-outer");
const radiusInput = byId<HTMLInputElement>("dd-radius");
const speedOutput = byId<HTMLOutputElement>("dd-speed-output");
const innerOutput = byId<HTMLOutputElement>("dd-inner-output");
const outerOutput = byId<HTMLOutputElement>("dd-outer-output");
const radiusOutput = byId<HTMLOutputElement>("dd-radius-output");
const playButton = byId<HTMLButtonElement>("dd-play");
const modeButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-dd-mode]")];
const gridButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-dd-grid]")];

let mode: PageMode = "smooth";
let gridView: GridView = "both";
let time = 0;
let playing = false;
let previousFrame = 0;
let animationFrame = 0;

function format(value: number, digits = 3): string {
  if (Math.abs(value) < 0.5 * 10 ** -digits) return (0).toFixed(digits);
  return value.toFixed(digits).replaceAll("-", "−");
}

function latexNumber(value: number, digits = 2): string {
  if (Math.abs(value) < 0.5 * 10 ** -digits) return (0).toFixed(digits);
  return value.toFixed(digits);
}

function resizeCanvas(): { width: number; height: number; ratio: number } {
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
  return { width, height, ratio };
}

function mapPoint(point: DiskPoint, centerX: number, centerY: number, scale: number): DiskPoint {
  return { x: centerX + scale * point.x, y: centerY - scale * point.y };
}

function drawArrow(start: DiskPoint, direction: DiskPoint, color: string, width: number): void {
  const magnitude = Math.hypot(direction.x, direction.y);
  if (magnitude < 1e-8) return;
  const end = { x: start.x + direction.x, y: start.y + direction.y };
  const angle = Math.atan2(direction.y, direction.x);
  const head = 6 + width;
  context.beginPath();
  context.moveTo(start.x, start.y);
  context.lineTo(end.x, end.y);
  context.strokeStyle = color;
  context.lineWidth = width;
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

function drawBoundaryIndicator(
  radius: number,
  circulation: number,
  label: string,
  color: string,
  centerX: number,
  centerY: number,
  scale: number,
  angle: number,
): void {
  const physical = { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
  const start = mapPoint(physical, centerX, centerY, scale);
  const sign = circulation < 0 ? -1 : 1;
  const length = 23 + 4 * Math.min(2, Math.abs(circulation));
  if (Math.abs(circulation) > 0.01) {
    drawArrow(start, {
      x: -sign * length * Math.sin(angle),
      y: -sign * length * Math.cos(angle),
    }, color, 2.2);
  }
  context.fillStyle = color;
  context.font = "700 9px SFMono-Regular, Consolas, monospace";
  context.textAlign = Math.cos(angle) >= 0 ? "left" : "right";
  context.fillText(
    `${label} = ${format(circulation, 2)}`,
    start.x + (Math.cos(angle) >= 0 ? 9 : -9),
    start.y - 9,
  );
}

function drawMaterialFamily(
  family: "alpha" | "beta",
  centerX: number,
  centerY: number,
  scale: number,
  boundarySpeed: number,
  innerCirculation: number,
  outerCirculation: number,
): void {
  const color = family === "alpha" ? "#69eff2" : "#ff7d45";
  const fixedValues = [-0.84, -0.63, -0.42, -0.21, 0, 0.21, 0.42, 0.63, 0.84];
  context.strokeStyle = color;
  context.lineWidth = 1.75;
  context.globalAlpha = 0.9;

  for (const fixed of fixedValues) {
    const extent = Math.sqrt(Math.max(0, 1 - fixed * fixed));
    let drawing = false;
    let previous: DiskPoint | null = null;
    context.beginPath();
    for (let index = 0; index <= 220; index += 1) {
      const free = -extent + 2 * extent * index / 220;
      const initial = family === "alpha" ? { x: fixed, y: free } : { x: free, y: fixed };
      const radius = Math.hypot(initial.x, initial.y);
      if (mode === "annulus" && radius < PUNCTURE_RADIUS + 0.006) {
        drawing = false;
        previous = null;
        continue;
      }
      const advected = mode === "smooth"
        ? advectDiskPoint(initial, time, boundarySpeed, "smooth")
        : advectAnnulusPoint(
            initial,
            time,
            PUNCTURE_RADIUS,
            innerCirculation,
            outerCirculation,
          );
      const point = mapPoint(advected, centerX, centerY, scale);
      const jump = previous ? Math.hypot(point.x - previous.x, point.y - previous.y) : 0;
      if (!drawing || jump > 17) {
        context.moveTo(point.x, point.y);
        drawing = true;
      } else {
        context.lineTo(point.x, point.y);
      }
      previous = point;
    }
    context.stroke();
  }
  context.globalAlpha = 1;
}

function drawVelocityArrows(
  centerX: number,
  centerY: number,
  scale: number,
  boundarySpeed: number,
  innerCirculation: number,
  outerCirculation: number,
): void {
  const radii = mode === "smooth" ? [0.28, 0.52, 0.76] : [0.34, 0.55, 0.78];
  for (const radius of radii) {
    for (let index = 0; index < 12; index += 1) {
      const angle = TAU * (index + 0.25) / 12;
      const x = radius * Math.cos(angle);
      const y = radius * Math.sin(angle);
      const sample = mode === "smooth"
        ? sampleSmoothDisk(x, y, boundarySpeed)
        : sampleAnnulus(x, y, PUNCTURE_RADIUS, innerCirculation, outerCirculation);
      const magnitude = Math.hypot(sample.velocity.x, sample.velocity.y);
      const length = 11 + 15 * Math.min(1.5, magnitude);
      const start = mapPoint({ x, y }, centerX, centerY, scale);
      drawArrow(start, {
        x: length * sample.velocity.x / Math.max(magnitude, 1e-9),
        y: -length * sample.velocity.y / Math.max(magnitude, 1e-9),
      }, "rgba(255,245,206,.88)", 1.4);
    }
  }
}

function draw(): void {
  const { width, height } = resizeCanvas();
  const boundarySpeed = Number(speedInput.value);
  const innerCirculation = Number(innerInput.value);
  const outerCirculation = Number(outerInput.value);
  const probeRadius = Number(radiusInput.value);
  const centerX = width / 2;
  const centerY = height / 2;
  const scale = 0.43 * Math.min(width, height);

  context.clearRect(0, 0, width, height);
  const background = context.createRadialGradient(centerX, centerY, 0, centerX, centerY, Math.max(width, height) * 0.72);
  background.addColorStop(0, "#17344b");
  background.addColorStop(1, "#071421");
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);

  context.save();
  context.beginPath();
  context.arc(centerX, centerY, scale, 0, TAU);
  context.clip();
  const annulusVorticity = annulusCoefficients(
    PUNCTURE_RADIUS,
    innerCirculation,
    outerCirculation,
  ).vorticity;
  const colorSign = mode === "smooth" ? boundarySpeed : annulusVorticity;
  const signColor = colorSign >= 0 ? "42,196,188" : "255,125,69";
  const diskFill = context.createRadialGradient(centerX, centerY, 0, centerX, centerY, scale);
  diskFill.addColorStop(0, `rgba(${signColor},${mode === "smooth" ? 0.42 : 0.13})`);
  diskFill.addColorStop(1, `rgba(${signColor},${mode === "smooth" ? 0.22 : 0.08})`);
  context.fillStyle = diskFill;
  context.fillRect(centerX - scale, centerY - scale, 2 * scale, 2 * scale);

  if (gridView === "both" || gridView === "alpha") {
    drawMaterialFamily("alpha", centerX, centerY, scale, boundarySpeed, innerCirculation, outerCirculation);
  }
  if (gridView === "both" || gridView === "beta") {
    drawMaterialFamily("beta", centerX, centerY, scale, boundarySpeed, innerCirculation, outerCirculation);
  }
  drawVelocityArrows(centerX, centerY, scale, boundarySpeed, innerCirculation, outerCirculation);
  context.restore();

  context.beginPath();
  context.arc(centerX, centerY, scale, 0, TAU);
  context.strokeStyle = "#ffd56c";
  context.lineWidth = 3;
  context.stroke();

  const probeScale = probeRadius * scale;
  context.beginPath();
  context.arc(centerX, centerY, probeScale, 0, TAU);
  context.strokeStyle = "rgba(255,213,108,.96)";
  context.lineWidth = 2.4;
  context.setLineDash([8, 5]);
  context.stroke();
  context.setLineDash([]);

  if (mode === "annulus") {
    context.beginPath();
    context.arc(centerX, centerY, PUNCTURE_RADIUS * scale, 0, TAU);
    context.fillStyle = "#071421";
    context.fill();
    context.strokeStyle = "#ff7d45";
    context.lineWidth = 3;
    context.stroke();
    context.fillStyle = "#ffb087";
    context.font = "700 10px SFMono-Regular, Consolas, monospace";
    context.textAlign = "center";
    context.fillText("CENTER REMOVED", centerX, centerY + 4);
    drawBoundaryIndicator(
      PUNCTURE_RADIUS,
      innerCirculation,
      "Γin",
      "#ff9a68",
      centerX,
      centerY,
      scale,
      0.72 * Math.PI,
    );
    drawBoundaryIndicator(
      1,
      outerCirculation,
      "Γout",
      "#ffd56c",
      centerX,
      centerY,
      scale,
      -0.22 * Math.PI,
    );
  } else {
    context.beginPath();
    context.arc(centerX, centerY, 4, 0, TAU);
    context.fillStyle = "#ffd56c";
    context.fill();
    drawBoundaryIndicator(
      1,
      TAU * boundarySpeed,
      "Γ∂D",
      "#ffd56c",
      centerX,
      centerY,
      scale,
      -0.22 * Math.PI,
    );
  }

  context.fillStyle = "#b9c8d4";
  context.font = "700 9px SFMono-Regular, Consolas, monospace";
  context.textAlign = "left";
  context.fillText(`ρ = ${probeRadius.toFixed(2)}`, centerX + probeScale / Math.SQRT2 + 7, centerY - probeScale / Math.SQRT2 - 5);
  context.fillText("r = 1 boundary", centerX - scale + 8, centerY - scale - 11);
  context.textAlign = "right";
  context.fillText(`t = ${time.toFixed(2)}`, width - 14, 20);
}

function updateReadout(): void {
  const boundarySpeed = Number(speedInput.value);
  const innerCirculation = Number(innerInput.value);
  const outerCirculation = Number(outerInput.value);
  if (mode === "annulus" && Number(radiusInput.value) < PUNCTURE_RADIUS + 0.01) {
    radiusInput.value = (PUNCTURE_RADIUS + 0.01).toFixed(2);
  }
  const probeRadius = Number(radiusInput.value);
  const coefficients = annulusCoefficients(PUNCTURE_RADIUS, innerCirculation, outerCirculation);
  const circulation = mode === "smooth"
    ? loopCirculation(probeRadius, boundarySpeed, mode)
    : annulusCirculation(
        probeRadius,
        PUNCTURE_RADIUS,
        innerCirculation,
        outerCirculation,
      );
  const enclosedVorticity = mode === "smooth"
    ? 2 * boundarySpeed * Math.PI * probeRadius ** 2
    : coefficients.vorticity * Math.PI * (probeRadius ** 2 - PUNCTURE_RADIUS ** 2);

  speedOutput.value = format(boundarySpeed, 2);
  innerOutput.value = format(innerCirculation, 2);
  outerOutput.value = format(outerCirculation, 2);
  radiusOutput.value = format(probeRadius, 2);
  byId("dd-radius-metric").textContent = format(probeRadius, 2);
  byId("dd-loop-circulation").textContent = format(circulation);
  byId("dd-area-vorticity").textContent = format(enclosedVorticity);
  byId("dd-stokes-defect").textContent = mode === "smooth"
    ? format(circulation - enclosedVorticity, 5)
    : format(circulation - innerCirculation - enclosedVorticity, 5);

  if (mode === "smooth") {
    byId("dd-stage-kicker").textContent = "SMOOTH FULL DISK";
    byId("dd-stage-title").textContent = "solid rotation · globally smooth Clebsch labels";
    byId("dd-equation-kicker").textContent = "SMOOTH CLEBSCH RECONSTRUCTION";
    renderLatex(
      byId("dd-live-equation"),
      String.raw`u^\flat(0)=d\!\left(-(${latexNumber(boundarySpeed)})ab\right)+\left(2(${latexNumber(boundarySpeed)})a\right)d b,\qquad(a,b)=(x,y)`,
      true,
    );
    byId("dd-live-copy").textContent = "At t = 0, rescale a to α = 2U_b a and take β = b. The labels then stay material as the grid moves, while φ must evolve to preserve the steady Euler velocity.";
    byId("dd-probe-kicker").textContent = "WHY Γ SHRINKS WITH THE LOOP";
    byId("dd-probe-title").textContent = "The smaller loop encloses less vorticity.";
    renderLatex(
      byId("dd-probe-equation"),
      String.raw`\Gamma(${latexNumber(probeRadius)})=2\pi(${latexNumber(boundarySpeed)})(${latexNumber(probeRadius)})^2=${latexNumber(circulation, 3)}`,
      true,
    );
    byId("dd-probe-copy").textContent = "Every probe circle bounds a smaller disk. Its circulation equals the constant vorticity 2U_b integrated over that disk.";
    renderLatex(byId("dd-boundary-equation"), String.raw`u\cdot n=0,\qquad u\cdot t=${latexNumber(boundarySpeed)}\quad(r=1)`, true);
    byId("dd-boundary-copy").textContent = "The normal component vanishes pointwise. The tangential value on the unit boundary fixes its single outer circulation.";
  } else {
    byId("dd-stage-kicker").textContent = "ANNULUS · TWO BOUNDARY COMPONENTS";
    byId("dd-stage-title").textContent = "independent inner and outer circulations";
    byId("dd-equation-kicker").textContent = "VORTICAL + HARMONIC DECOMPOSITION";
    renderLatex(
      byId("dd-live-equation"),
      String.raw`u^\flat=\left((${latexNumber(coefficients.solidRotation, 3)})r^2+(${latexNumber(coefficients.harmonic, 3)})\right)d\theta,\qquad \zeta=${latexNumber(coefficients.vorticity, 3)}`,
      true,
    );
    byId("dd-live-copy").textContent = "The Ar²dθ term carries constant vorticity. The Bdθ term is curl-free and harmonic. The a,b grid only visualizes the flow map in this mode.";
    byId("dd-probe-kicker").textContent = "STOKES WITH AN INNER BOUNDARY";
    byId("dd-probe-title").textContent = "Subtract the circulation already around the hole.";
    renderLatex(
      byId("dd-probe-equation"),
      String.raw`\Gamma(${latexNumber(probeRadius)})-\Gamma_{\rm in}=${latexNumber(circulation, 3)}-(${latexNumber(innerCirculation, 3)})=${latexNumber(enclosedVorticity, 3)}`,
      true,
    );
    byId("dd-probe-copy").textContent = "The annular patch between the inner ring and the gold loop has two oriented boundaries. Its vorticity integral equals Γ(ρ) − Γ_in.";
    renderLatex(
      byId("dd-boundary-equation"),
      String.raw`\Gamma_{\rm out}-\Gamma_{\rm in}=${latexNumber(outerCirculation - innerCirculation, 3)}=\int_A\omega`,
      true,
    );
    byId("dd-boundary-copy").textContent = "Both slider values use counterclockwise circle orientation. Stokes orients the inner boundary clockwise, which is why the two displayed circulations subtract.";
    renderLatex(
      byId("dd-decomposition-equation"),
      String.raw`\eta=(${latexNumber(coefficients.solidRotation, 3)})r^2d\theta+(${latexNumber(coefficients.harmonic, 3)})d\theta`,
      true,
    );
    byId("dd-vortical-coefficient").textContent = format(coefficients.vorticity, 4);
    byId("dd-harmonic-coefficient").textContent = format(coefficients.harmonic, 4);
  }

  byId("dd-smooth-controls").hidden = mode !== "smooth";
  byId("dd-annulus-controls").hidden = mode !== "annulus";
  document.querySelector<HTMLElement>(".dd-decomposition-card")!.hidden = mode !== "annulus";

  for (const button of modeButtons) {
    const active = button.dataset.ddMode === mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  canvas.setAttribute(
    "aria-label",
    mode === "smooth"
      ? `Smooth disk in solid rotation with boundary speed ${boundarySpeed.toFixed(2)} and probe radius ${probeRadius.toFixed(2)}.`
      : `Annulus with inner circulation ${innerCirculation.toFixed(2)}, outer circulation ${outerCirculation.toFixed(2)}, and probe radius ${probeRadius.toFixed(2)}.`,
  );
  draw();
}

function setPlaying(next: boolean): void {
  playing = next;
  playButton.textContent = playing ? "Pause" : "Play";
  playButton.classList.toggle("active", playing);
  playButton.setAttribute("aria-pressed", String(playing));
  if (playing) {
    previousFrame = 0;
    animationFrame = requestAnimationFrame(tick);
  } else {
    cancelAnimationFrame(animationFrame);
  }
}

function advance(delta: number): void {
  time += delta;
  const limit = mode === "smooth" ? 12 : 1.35;
  if (time >= limit) {
    time = limit;
    setPlaying(false);
  }
  draw();
}

function tick(timestamp: number): void {
  if (!playing) return;
  if (previousFrame > 0) advance(Math.min(0.04, (timestamp - previousFrame) / 1000) * 0.38);
  previousFrame = timestamp;
  if (playing) animationFrame = requestAnimationFrame(tick);
}

for (const button of modeButtons) {
  button.addEventListener("click", () => {
    setPlaying(false);
    mode = button.dataset.ddMode as PageMode;
    time = 0;
    radiusInput.min = mode === "smooth" ? "0.2" : (PUNCTURE_RADIUS + 0.01).toFixed(2);
    if (mode === "annulus" && Number(radiusInput.value) < PUNCTURE_RADIUS + 0.05) radiusInput.value = "0.4";
    updateReadout();
  });
}

for (const button of gridButtons) {
  button.addEventListener("click", () => {
    gridView = button.dataset.ddGrid as GridView;
    for (const candidate of gridButtons) {
      const active = candidate === button;
      candidate.classList.toggle("active", active);
      candidate.setAttribute("aria-pressed", String(active));
    }
    draw();
  });
}

for (const input of [speedInput, innerInput, outerInput, radiusInput]) input.addEventListener("input", updateReadout);
byId("dd-equal-circulation").addEventListener("click", () => {
  innerInput.value = "3";
  outerInput.value = "3";
  time = 0;
  updateReadout();
});
byId("dd-different-circulation").addEventListener("click", () => {
  innerInput.value = "2.2";
  outerInput.value = "4.4";
  time = 0;
  updateReadout();
});
byId("dd-reset").addEventListener("click", () => {
  setPlaying(false);
  time = 0;
  draw();
});
byId("dd-step").addEventListener("click", () => {
  setPlaying(false);
  advance(mode === "smooth" ? 0.08 : 0.025);
});
playButton.addEventListener("click", () => setPlaying(!playing));
playButton.setAttribute("aria-pressed", "false");
new ResizeObserver(draw).observe(canvas);
updateReadout();
