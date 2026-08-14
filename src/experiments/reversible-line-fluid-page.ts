import "./reversible-line-fluid.css";
import "katex/dist/katex.min.css";

import katex from "katex";
import {
  PROJECTIVE_DOMAINS,
  projectiveBranchShift,
  projectiveDomainContains,
  projectiveLoopPoint,
  projectivePowerPhase,
  projectiveRosyDirections,
  projectiveTransportedBranchAngle,
  type ProjectivePoint,
} from "./projective-clebsch-model";
import {
  DEFAULT_REVERSIBLE_LINE_FLUID_PARAMETERS,
  forwardEulerSample,
  integrateReversibleParticleTrace,
  reversibleBranchSample,
  reversibleLineFluidDiagnostics,
  type ReversibleBranchKind,
  type ReversibleLineFluidParameters,
  type ReversibleParticlePoint,
} from "./reversible-line-fluid-model";
import {
  blendedPolyvectorBranch,
  mobiusRosyAngle,
  rosyBranchCount,
  tentativePolyvectorBranch,
  topologicalPolyvectorDiagnostics,
  type RosySymmetry,
} from "./topological-polyvector-model";

type LabMode = "projection" | "monodromy" | "mobius" | "time-reversal";

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
  kicker: string;
  title: string;
  cardKicker: string;
  cardTitle: string;
  latex: string;
  copy: string;
  verdict: string;
  verdictCopy: string;
  warning: boolean;
}

const TAU = 2 * Math.PI;

const MODE_COPY: Record<LabMode, ModeCopy> = {
  projection: {
    kicker: "QUESTION 1 · PROJECTION",
    title: "exact quarter-turn symmetry competes with branchwise incompressibility",
    cardKicker: "THE NEW 4-ROSY PHENOMENON",
    cardTitle: "Projection commutes with sign, not quarter-turn.",
    latex: "P(-v)=-P(v),\\qquad P(Jv)\\ne J P(v)\\ \\text{in general}",
    copy: "For a line, the second root is only a sign change, so symmetry survives. For a cross, the orthogonal roots carry curl as divergence; projecting them independently changes the cross.",
    verdict: "4‑RoSy projection has a tradeoff",
    verdictCopy: "Independent Hodge projection makes every root divergence-free, but generally destroys exact quarter-turn relations.",
    warning: true,
  },
  monodromy: {
    kicker: "QUESTION 2 · A HOLE",
    title: "the unordered field closes while a continuously transported root changes sheets",
    cardKicker: "SPATIAL MONODROMY",
    cardTitle: "The root name can change around a loop.",
    latex: "k\\longmapsto k+m\\pmod N",
    copy: "The annulus is orientable. Its hole can still permute the roots of an N‑RoSy field. The polynomial or unordered set is global even when one chosen arrow is not.",
    verdict: "the set closes; the selected root may not",
    verdictCopy: "At one full circuit the tracer lands on the sheet recorded in the ledger, while the complete root set returns unchanged.",
    warning: false,
  },
  mobius: {
    kicker: "QUESTION 3 · A REFLECTED SEAM",
    title: "one circuit exchanges cover sheets and reflects the local transverse direction",
    cardKicker: "ORIENTATION HOLONOMY",
    cardTitle: "A Möbius seam is more than a cyclic root shift.",
    latex: "(s+2\\pi,r)\\sim(s,-r),\\qquad Q_\\gamma\\in O(2),\\ \\det Q_\\gamma=-1",
    copy: "A hole permutes roots inside an oriented tangent plane. A Möbius circuit also reflects that plane. The double cover turns the reflection into an explicit sheet exchange.",
    verdict: "one lap reflects; two laps restore the frame",
    verdictCopy: "The full 4‑RoSy set remains meaningful, but a signed transverse arrow and scalar vorticity require cover parity.",
    warning: false,
  },
  "time-reversal": {
    kicker: "QUESTION 4 · DYNAMICS",
    title: "compare the wrong same-time sign flip with the genuine backward Euler movie",
    cardKicker: "TIME IS PART OF THE SYMMETRY",
    cardTitle: "Reverse the movie, not only the arrows.",
    latex: "-u(x,t)\\quad\\text{versus}\\quad u^R(x,t)=-u(x,-t)",
    copy: "Both candidates are divergence-free. The left one generally fails Euler momentum balance; the right one is the exact time-reversed solution.",
    verdict: "only −u(x,−t) is the generic Euler symmetry",
    verdictCopy: "The opposite root of a line or cross is not automatically a simultaneous second fluid velocity.",
    warning: true,
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
const symmetryButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-rlf-symmetry]")];
const projectionInput = byId<HTMLInputElement>("rlf-projection");
const chargeInput = byId<HTMLInputElement>("rlf-charge");
const journeyInput = byId<HTMLInputElement>("rlf-journey");
const timeInput = byId<HTMLInputElement>("rlf-time");
const driftInput = byId<HTMLInputElement>("rlf-drift");
const contaminationInput = byId<HTMLInputElement>("rlf-contamination");
const playButton = byId<HTMLButtonElement>("rlf-play");

let mode: LabMode = "projection";
let symmetry: RosySymmetry = 4;
let projectionStrength = 1;
let charge = 1;
let journey = 0;
let time = 0;
let parameters: ReversibleLineFluidParameters = { ...DEFAULT_REVERSIBLE_LINE_FLUID_PARAMETERS };
let playing = false;
let animationFrame = 0;
let previousTimestamp = 0;

const particleSeeds: ReversibleParticlePoint[] = Array.from({ length: 20 }, (_, index) => ({
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
}

function torusToScreen(point: ReversibleParticlePoint, panel: Rect): Point {
  return {
    x: panel.left + panel.width * point.x / TAU,
    y: panel.top + panel.height * (1 - point.y / TAU),
  };
}

function heatColor(value: number, extent: number, alpha = 0.66): string {
  const t = 0.5 + 0.5 * Math.max(-1, Math.min(1, value / Math.max(extent, 1e-8)));
  const red = Math.round(26 + 229 * t);
  const green = Math.round(204 - 91 * t);
  const blue = Math.round(215 - 137 * t);
  return `rgba(${red},${green},${blue},${alpha})`;
}

function drawScalarField(panel: Rect, selector: (x: number, y: number) => number, extent: number): void {
  const columns = 38;
  const rows = 32;
  const cellWidth = panel.width / columns;
  const cellHeight = panel.height / rows;
  for (let row = 0; row < rows; row += 1) {
    const y = TAU * (row + 0.5) / rows;
    for (let column = 0; column < columns; column += 1) {
      const x = TAU * (column + 0.5) / columns;
      context.fillStyle = heatColor(selector(x, y), extent);
      context.fillRect(panel.left + column * cellWidth, panel.top + (rows - 1 - row) * cellHeight, cellWidth + 0.5, cellHeight + 0.5);
    }
  }
  context.fillStyle = "rgba(7,22,35,.27)";
  context.fillRect(panel.left, panel.top, panel.width, panel.height);
}

function drawRay(origin: Point, velocity: readonly [number, number], color: string, selected: boolean, arrow = false): void {
  const magnitude = Math.hypot(velocity[0], velocity[1]);
  if (magnitude < 1e-7) {
    context.beginPath();
    context.arc(origin.x, origin.y, 2.2, 0, TAU);
    context.fillStyle = "rgba(255,117,64,.72)";
    context.fill();
    return;
  }
  const length = Math.min(18, 8 + 7 * magnitude);
  const dx = length * velocity[0] / magnitude;
  const dy = -length * velocity[1] / magnitude;
  const end = { x: origin.x + dx, y: origin.y + dy };
  context.beginPath();
  context.moveTo(origin.x, origin.y);
  context.lineTo(end.x, end.y);
  context.strokeStyle = color;
  context.lineWidth = selected ? 2.1 : 1.15;
  context.lineCap = "round";
  context.stroke();
  if (arrow) {
    const angle = Math.atan2(dy, dx);
    const head = selected ? 5.5 : 4.2;
    context.beginPath();
    context.moveTo(end.x, end.y);
    context.lineTo(end.x - head * Math.cos(angle - Math.PI / 6), end.y - head * Math.sin(angle - Math.PI / 6));
    context.lineTo(end.x - head * Math.cos(angle + Math.PI / 6), end.y - head * Math.sin(angle + Math.PI / 6));
    context.closePath();
    context.fillStyle = color;
    context.fill();
  }
}

function drawRootSet(origin: Point, roots: readonly (readonly [number, number])[], arrow = false, selectedBranch = 0): void {
  roots.forEach((root, branch) => {
    const selected = branch === selectedBranch;
    drawRay(origin, root, selected ? "#58e0e8" : branch % 2 === 0 ? "rgba(255,210,106,.8)" : "rgba(255,117,64,.78)", selected, arrow);
  });
  context.beginPath();
  context.arc(origin.x, origin.y, 1.7, 0, TAU);
  context.fillStyle = "rgba(225,247,243,.9)";
  context.fill();
}

function drawPolyvectorGrid(panel: Rect, blended: boolean): void {
  const columns = Math.max(7, Math.round(panel.width / 55));
  const rows = Math.max(6, Math.round(panel.height / 55));
  for (let row = 0; row < rows; row += 1) {
    const y = TAU * (row + 0.5) / rows;
    for (let column = 0; column < columns; column += 1) {
      const x = TAU * (column + 0.5) / columns;
      const roots = Array.from({ length: rosyBranchCount(symmetry) }, (_, branch) => (
        blended
          ? blendedPolyvectorBranch(symmetry, branch, x, y, time, projectionStrength, parameters).velocity
          : tentativePolyvectorBranch(symmetry, branch, x, y, time, parameters).velocity
      ));
      drawRootSet(torusToScreen({ x, y }, panel), roots);
    }
  }
}

function pointDivergenceRms(blended: boolean, x: number, y: number): number {
  let sum = 0;
  for (let branch = 0; branch < rosyBranchCount(symmetry); branch += 1) {
    const sample = blended
      ? blendedPolyvectorBranch(symmetry, branch, x, y, time, projectionStrength, parameters)
      : tentativePolyvectorBranch(symmetry, branch, x, y, time, parameters);
    sum += sample.divergence ** 2;
  }
  return Math.sqrt(sum / rosyBranchCount(symmetry));
}

function drawProjection(first: Rect, second: Rect): void {
  const extent = Math.max(0.2, 4.2 * Math.max(parameters.amplitude, parameters.contamination));
  drawPanelFrame(first, `EXACT ${symmetry}-ROSY INPUT`, "root angles are exact · color = branch div RMS");
  drawScalarField(first, (x, y) => pointDivergenceRms(false, x, y), extent);
  drawPolyvectorGrid(first, false);
  drawPanelFrame(second, "BRANCHWISE HODGE PROJECTION", `λ = ${projectionStrength.toFixed(2)} · roots projected independently`);
  drawScalarField(second, (x, y) => pointDivergenceRms(true, x, y), extent);
  drawPolyvectorGrid(second, true);
}

function annulusToScreen(point: ProjectivePoint, panel: Rect): Point {
  const domain = PROJECTIVE_DOMAINS.annulus;
  const scale = 0.44 * Math.min(panel.width, panel.height) / domain.outerRadius;
  return {
    x: panel.left + 0.5 * panel.width + scale * point.x,
    y: panel.top + 0.5 * panel.height - scale * point.y,
  };
}

function drawAnnulus(panel: Rect): void {
  const domain = PROJECTIVE_DOMAINS.annulus;
  const center = annulusToScreen({ x: 0, y: 0 }, panel);
  const edge = annulusToScreen({ x: domain.outerRadius, y: 0 }, panel);
  const holeEdge = annulusToScreen({ x: domain.holes[0]!.radius, y: 0 }, panel);
  const path = new Path2D();
  path.arc(center.x, center.y, edge.x - center.x, 0, TAU);
  path.moveTo(holeEdge.x, center.y);
  path.arc(center.x, center.y, holeEdge.x - center.x, 0, TAU);
  context.fillStyle = "#17384c";
  context.fill(path, "evenodd");
  context.strokeStyle = "#7edbe0";
  context.lineWidth = 1.4;
  context.stroke(path);
  const spacing = domain.outerRadius / 6.2;
  for (let y = -domain.outerRadius; y <= domain.outerRadius; y += spacing) {
    for (let x = -domain.outerRadius; x <= domain.outerRadius; x += spacing) {
      if (!projectiveDomainContains(domain, { x, y })) continue;
      const directions = projectiveRosyDirections(symmetry, projectivePowerPhase(domain, { x, y }, [charge]), 1);
      drawRootSet(annulusToScreen({ x, y }, panel), directions.map((direction) => [direction.x, direction.y] as const));
    }
  }
  const loop = new Path2D();
  for (let index = 0; index <= 100; index += 1) {
    const point = annulusToScreen(projectiveLoopPoint(domain, "hole-1", index / 100), panel);
    if (index === 0) loop.moveTo(point.x, point.y);
    else loop.lineTo(point.x, point.y);
  }
  loop.closePath();
  context.save();
  context.setLineDash([6, 5]);
  context.strokeStyle = "rgba(255,210,106,.72)";
  context.lineWidth = 2;
  context.stroke(loop);
  context.restore();
  const tracerWorld = projectiveLoopPoint(domain, "hole-1", Math.min(1, journey));
  const tracer = annulusToScreen(tracerWorld, panel);
  const angle = projectiveTransportedBranchAngle(domain, symmetry, [charge], "hole-1", Math.min(1, journey));
  drawRay(tracer, [Math.cos(angle), Math.sin(angle)], "#ffd26a", true, true);
  context.beginPath();
  context.arc(tracer.x, tracer.y, 5, 0, TAU);
  context.fillStyle = "#ffd26a";
  context.fill();
}

function drawSheetLedger(panel: Rect): void {
  context.fillStyle = "rgba(13,33,49,.9)";
  context.fillRect(panel.left, panel.top, panel.width, panel.height);
  const start = 0;
  const shift = projectiveBranchShift(PROJECTIVE_DOMAINS.annulus, symmetry, [charge], "hole-1");
  const continuousSheet = journey * shift;
  context.fillStyle = "#c9d5de";
  context.font = "700 8px SFMono-Regular, Consolas, monospace";
  context.fillText("A root label lives on a cover sheet", panel.left + 16, panel.top + 21);
  for (let branch = 0; branch < symmetry; branch += 1) {
    const y = panel.top + 58 + branch * (panel.height - 92) / Math.max(1, symmetry - 1);
    context.beginPath();
    context.moveTo(panel.left + 58, y);
    context.lineTo(panel.left + panel.width - 42, y);
    context.strokeStyle = "rgba(115,139,158,.45)";
    context.lineWidth = 1;
    context.stroke();
    context.fillStyle = branch === start ? "#58e0e8" : "#c8d4dd";
    context.fillText(`sheet ${branch}`, panel.left + 15, y + 3);
    drawRootSet({ x: panel.left + panel.width - 26, y }, [[Math.cos(TAU * branch / symmetry), Math.sin(TAU * branch / symmetry)]]);
  }
  const startY = panel.top + 58 + start * (panel.height - 92) / Math.max(1, symmetry - 1);
  const endY = panel.top + 58 + continuousSheet * (panel.height - 92) / Math.max(1, symmetry - 1);
  context.beginPath();
  context.moveTo(panel.left + 88, startY);
  context.bezierCurveTo(panel.left + 0.48 * panel.width, startY, panel.left + 0.48 * panel.width, endY, panel.left + panel.width - 68, endY);
  context.strokeStyle = "#ffd26a";
  context.lineWidth = 3;
  context.stroke();
  context.beginPath();
  context.arc(panel.left + panel.width - 68, endY, 6, 0, TAU);
  context.fillStyle = "#ffd26a";
  context.fill();
  context.fillStyle = "#ffd26a";
  context.textAlign = "right";
  context.fillText(journey >= 0.999 ? `lands on sheet ${shift}` : `transport ${(100 * journey).toFixed(0)}%`, panel.left + panel.width - 14, panel.top + panel.height - 14);
  context.textAlign = "left";
}

function drawMonodromy(first: Rect, second: Rect): void {
  drawPanelFrame(first, `ANNULUS · ${symmetry}-ROSY ROOT SET`, `charge m = ${charge} · the complete set is single-valued`);
  drawAnnulus(first);
  drawPanelFrame(second, "ORIENTED ROOT COVER", "carry one cyan root continuously; do not reselect it");
  drawSheetLedger(second);
}

function stripToScreen(s: number, r: number, panel: Rect, inset = 18): Point {
  return {
    x: panel.left + inset + (panel.width - 2 * inset) * s / TAU,
    y: panel.top + 0.5 * panel.height - 0.38 * panel.height * r,
  };
}

function drawMobiusStripGrid(panel: Rect): void {
  context.fillStyle = "rgba(19,55,71,.95)";
  context.fillRect(panel.left + 12, panel.top + 22, panel.width - 24, panel.height - 44);
  for (let row = -3; row <= 3; row += 1) {
    const r = row / 3;
    context.beginPath();
    for (let column = 0; column <= 80; column += 1) {
      const s = TAU * column / 80;
      const point = stripToScreen(s, r, panel);
      if (column === 0) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    }
    context.strokeStyle = row === 0 ? "rgba(255,210,106,.58)" : "rgba(88,224,232,.25)";
    context.lineWidth = row === 0 ? 1.5 : 0.8;
    context.stroke();
  }
  for (let column = 0; column <= 8; column += 1) {
    const s = TAU * column / 8;
    const top = stripToScreen(s, 1, panel);
    const bottom = stripToScreen(s, -1, panel);
    context.beginPath();
    context.moveTo(top.x, top.y);
    context.lineTo(bottom.x, bottom.y);
    context.strokeStyle = "rgba(255,117,64,.22)";
    context.stroke();
    for (const r of [-0.66, 0, 0.66]) {
      const angle = mobiusRosyAngle(s, 0);
      const roots = Array.from({ length: symmetry }, (_, branch) => {
        const theta = angle + TAU * branch / symmetry;
        return [Math.cos(theta), Math.sin(theta)] as const;
      });
      drawRootSet(stripToScreen(s, r, panel), roots);
    }
  }
  context.fillStyle = "#ff7540";
  context.font = "800 7px SFMono-Regular, Consolas, monospace";
  context.fillText("r = +1", panel.left + 15, panel.top + 17);
  context.fillText("r = −1", panel.left + panel.width - 48, panel.top + panel.height - 10);
  context.fillStyle = "#cbd8e0";
  context.fillText("glue with reflection ↕", panel.left + panel.width - 112, panel.top + 17);
}

function drawCoverSheets(panel: Rect): void {
  const gap = 18;
  const sheetHeight = (panel.height - gap - 44) / 2;
  for (const sheet of [0, 1] as const) {
    const top = panel.top + 20 + sheet * (sheetHeight + gap);
    context.fillStyle = sheet === 0 ? "rgba(18,62,77,.95)" : "rgba(62,35,67,.95)";
    context.fillRect(panel.left + 16, top, panel.width - 32, sheetHeight);
    context.fillStyle = sheet === 0 ? "#58e0e8" : "#ff7540";
    context.font = "800 7px SFMono-Regular, Consolas, monospace";
    context.fillText(sheet === 0 ? "SHEET A · chosen orientation" : "SHEET B · reflected orientation", panel.left + 23, top + 15);
    for (let column = 0; column <= 6; column += 1) {
      const s = TAU * column / 6;
      const x = panel.left + 34 + (panel.width - 68) * column / 6;
      const y = top + 0.62 * sheetHeight;
      const angle = mobiusRosyAngle(s, sheet);
      const roots = Array.from({ length: symmetry }, (_, branch) => {
        const theta = angle + TAU * branch / symmetry;
        return [Math.cos(theta), Math.sin(theta)] as const;
      });
      drawRootSet({ x, y }, roots);
    }
  }
  const lap = journey >= 1.995 ? 0 : Math.min(1.999, journey);
  const sheet = Math.floor(lap) as 0 | 1;
  const fraction = lap - sheet;
  const top = panel.top + 20 + sheet * (sheetHeight + gap);
  const tracer = { x: panel.left + 34 + (panel.width - 68) * fraction, y: top + 0.82 * sheetHeight };
  context.beginPath();
  context.arc(tracer.x, tracer.y, 6, 0, TAU);
  context.fillStyle = "#ffd26a";
  context.fill();
  if (journey >= 0.995 && journey < 1.02) {
    context.beginPath();
    context.moveTo(panel.left + panel.width - 34, panel.top + 20 + 0.82 * sheetHeight);
    context.lineTo(panel.left + 34, panel.top + 20 + sheetHeight + gap + 0.82 * sheetHeight);
    context.strokeStyle = "#ffd26a";
    context.setLineDash([5, 4]);
    context.stroke();
    context.setLineDash([]);
  }
  if (journey >= 1.98) {
    context.beginPath();
    context.moveTo(panel.left + panel.width - 34, panel.top + 20 + sheetHeight + gap + 0.82 * sheetHeight);
    context.lineTo(panel.left + 34, panel.top + 20 + 0.82 * sheetHeight);
    context.strokeStyle = "#ffd26a";
    context.setLineDash([5, 4]);
    context.stroke();
    context.setLineDash([]);
  }
}

function drawMobius(first: Rect, second: Rect): void {
  drawPanelFrame(first, "ONE FUNDAMENTAL RECTANGLE", "the right edge glues to the left edge with r reflected");
  drawMobiusStripGrid(first);
  drawPanelFrame(second, "ORIENTED DOUBLE COVER", "one lap: A → B · two laps: A → B → A");
  drawCoverSheets(second);
}

function drawArrowGrid(panel: Rect, kind: ReversibleBranchKind, color: string): void {
  const columns = Math.max(7, Math.round(panel.width / 55));
  const rows = Math.max(6, Math.round(panel.height / 55));
  for (let row = 0; row < rows; row += 1) {
    const y = TAU * (row + 0.5) / rows;
    for (let column = 0; column < columns; column += 1) {
      const x = TAU * (column + 0.5) / columns;
      const velocity = reversibleBranchSample(kind, x, y, time, parameters).velocity;
      drawRay(torusToScreen({ x, y }, panel), velocity, color, true, true);
    }
  }
}

function drawTrace(panel: Rect, trace: ReversibleParticlePoint[], color: string, width: number): void {
  context.beginPath();
  let previous: Point | undefined;
  for (const world of trace) {
    const point = torusToScreen(world, panel);
    if (!previous || Math.abs(point.x - previous.x) > 0.45 * panel.width || Math.abs(point.y - previous.y) > 0.45 * panel.height) context.moveTo(point.x, point.y);
    else context.lineTo(point.x, point.y);
    previous = point;
  }
  context.strokeStyle = color;
  context.lineWidth = width;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.stroke();
}

function drawParticles(panel: Rect, kind: ReversibleBranchKind, color: string): void {
  particleSeeds.forEach((seed, index) => {
    const trace = integrateReversibleParticleTrace(seed, time, kind, parameters, 50);
    if (index < 8) drawTrace(panel, trace, index === 0 ? "#ffd26a" : color, index === 0 ? 2.2 : 0.7);
    const final = torusToScreen(trace.at(-1)!, panel);
    context.beginPath();
    context.arc(final.x, final.y, index === 0 ? 5 : 2, 0, TAU);
    context.fillStyle = index === 0 ? "#ffd26a" : color;
    context.fill();
  });
}

function drawTimeReversal(first: Rect, second: Rect): void {
  const extent = Math.max(0.1, 2 * parameters.amplitude);
  drawPanelFrame(first, "WRONG · −u(x,t)", "divergence-free, but generally not the backward Euler movie");
  drawScalarField(first, (x, y) => reversibleBranchSample("same-time-negative", x, y, time, parameters).vorticity, extent);
  drawArrowGrid(first, "same-time-negative", "rgba(255,117,64,.92)");
  drawParticles(first, "same-time-negative", "rgba(255,117,64,.66)");
  drawPanelFrame(second, "CORRECT · −u(x,−t)", "exact Euler time reversal · same seeds move backward");
  drawScalarField(second, (x, y) => reversibleBranchSample("time-reversed", x, y, time, parameters).vorticity, extent);
  drawArrowGrid(second, "time-reversed", "rgba(88,224,232,.92)");
  drawParticles(second, "time-reversed", "rgba(88,224,232,.66)");
}

function formatScientific(value: number): string {
  if (Math.abs(value) < 5e-13) return "< 5e−13";
  return value.toExponential(2).replace("e-", "e−");
}

function setMetric(index: number, label: string, value: string): void {
  byId<HTMLElement>(`rlf-metric-${["one", "two", "three", "four"][index]}-label`).textContent = label;
  byId<HTMLElement>(`rlf-metric-${["one", "two", "three", "four"][index]}`).textContent = value;
}

function updateMetrics(): void {
  if (mode === "projection") {
    const diagnostics = topologicalPolyvectorDiagnostics(symmetry, time, projectionStrength, parameters, 34, 30);
    setMetric(0, "div RMS · before", diagnostics.tentativeDivergenceRms.toFixed(3));
    setMetric(1, "div RMS · after", diagnostics.blendedDivergenceRms.toFixed(3));
    setMetric(2, `${symmetry}-RoSy defect · before`, formatScientific(diagnostics.tentativeRosyDefect));
    setMetric(3, `${symmetry}-RoSy defect · after`, formatScientific(diagnostics.blendedRosyDefect));
  } else if (mode === "monodromy") {
    const shift = projectiveBranchShift(PROJECTIVE_DOMAINS.annulus, symmetry, [charge], "hole-1");
    setMetric(0, "root set after loop", "unchanged");
    setMetric(1, "selected root shift", `+${shift} mod ${symmetry}`);
    setMetric(2, "selected root closes?", shift === 0 ? "yes" : "no");
    setMetric(3, "defect index", `${charge}/${symmetry}`);
  } else if (mode === "mobius") {
    const currentSheet = journey >= 1.995 || journey < 1 ? "A" : "B";
    setMetric(0, "holonomy group", "O(2)");
    setMetric(1, "det after one lap", "−1");
    setMetric(2, "current cover sheet", currentSheet);
    setMetric(3, "frame restored", journey >= 1.995 ? "yes · two laps" : "not yet");
  } else {
    const diagnostics = reversibleLineFluidDiagnostics(time, parameters, 34, 30);
    setMetric(0, "div RMS · −u(t)", "0");
    setMetric(1, "div RMS · −u(−t)", "0");
    setMetric(2, "Euler residual · wrong", diagnostics.sameTimeEulerResidualRms.toFixed(3));
    setMetric(3, "Euler residual · reversed", formatScientific(diagnostics.reversedEulerResidualRms));
  }
}

function updateCopy(): void {
  const copy = MODE_COPY[mode];
  byId<HTMLElement>("rlf-stage-kicker").textContent = copy.kicker;
  byId<HTMLElement>("rlf-stage-title").textContent = copy.title;
  byId<HTMLElement>("rlf-card-kicker").textContent = copy.cardKicker;
  byId<HTMLElement>("rlf-card-title").textContent = copy.cardTitle;
  const equation = byId<HTMLElement>("rlf-card-equation");
  renderMath(equation, copy.latex);
  byId<HTMLElement>("rlf-card-copy").textContent = copy.copy;
  byId<HTMLElement>("rlf-verdict-title").textContent = copy.verdict;
  byId<HTMLElement>("rlf-verdict-copy").textContent = copy.verdictCopy;
  byId<HTMLElement>("rlf-verdict").classList.toggle("warning", copy.warning);
  byId<HTMLElement>("rlf-symmetry-fieldset").hidden = mode === "time-reversal";
  byId<HTMLElement>("rlf-projection-label").hidden = mode !== "projection";
  byId<HTMLElement>("rlf-charge-label").hidden = mode !== "monodromy";
  byId<HTMLElement>("rlf-journey-label").hidden = mode !== "monodromy" && mode !== "mobius";
  byId<HTMLElement>("rlf-time-label").hidden = mode !== "time-reversal";
  byId<HTMLElement>("rlf-drift-label").hidden = mode !== "projection" && mode !== "time-reversal";
  byId<HTMLElement>("rlf-contamination-label").hidden = mode !== "projection";
  journeyInput.max = mode === "mobius" ? "2" : "1";
  if (journey > Number(journeyInput.max)) journey = Number(journeyInput.max);
}

function render(): void {
  const { width, height } = resizeCanvas();
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#06121f";
  context.fillRect(0, 0, width, height);
  const panels = panelLayout(width, height);
  if (mode === "projection") drawProjection(panels.first, panels.second);
  else if (mode === "monodromy") drawMonodromy(panels.first, panels.second);
  else if (mode === "mobius") drawMobius(panels.first, panels.second);
  else drawTimeReversal(panels.first, panels.second);
  updateMetrics();
  projectionInput.value = projectionStrength.toFixed(2);
  chargeInput.value = String(charge);
  journeyInput.value = journey.toFixed(3);
  timeInput.value = time.toFixed(2);
  byId<HTMLOutputElement>("rlf-projection-output").textContent = projectionStrength.toFixed(2);
  byId<HTMLOutputElement>("rlf-charge-output").textContent = String(charge);
  byId<HTMLOutputElement>("rlf-journey-output").textContent = `${journey.toFixed(2)} laps`;
  byId<HTMLOutputElement>("rlf-time-output").textContent = time.toFixed(2);
}

function activeValue(): number {
  if (mode === "projection") return projectionStrength;
  if (mode === "time-reversal") return time;
  return journey;
}

function activeMaximum(): number {
  if (mode === "projection") return 1;
  if (mode === "time-reversal") return Number(timeInput.max);
  return Number(journeyInput.max);
}

function setActiveValue(value: number): void {
  if (mode === "projection") projectionStrength = value;
  else if (mode === "time-reversal") time = value;
  else journey = value;
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
  const speed = mode === "projection" ? 0.24 : mode === "time-reversal" ? 0.55 : 0.28;
  const next = activeValue() + speed * elapsed;
  if (next >= activeMaximum()) {
    setActiveValue(activeMaximum());
    stopPlaying();
  } else {
    setActiveValue(next);
  }
  render();
  if (playing) animationFrame = requestAnimationFrame(animate);
}

modeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    stopPlaying();
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

symmetryButtons.forEach((button) => {
  button.addEventListener("click", () => {
    symmetry = Number(button.dataset.rlfSymmetry) as RosySymmetry;
    chargeInput.max = String(symmetry - 1);
    charge = Math.min(charge, symmetry - 1);
    symmetryButtons.forEach((candidate) => {
      const active = candidate === button;
      candidate.classList.toggle("active", active);
      candidate.setAttribute("aria-pressed", String(active));
    });
    render();
  });
});

projectionInput.addEventListener("input", () => {
  projectionStrength = Number(projectionInput.value);
  render();
});

chargeInput.addEventListener("input", () => {
  charge = Number(chargeInput.value);
  render();
});

journeyInput.addEventListener("input", () => {
  journey = Number(journeyInput.value);
  render();
});

timeInput.addEventListener("input", () => {
  time = Number(timeInput.value);
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
  setActiveValue(0);
  render();
});

byId<HTMLButtonElement>("rlf-step").addEventListener("click", () => {
  stopPlaying();
  previousTimestamp = 0;
  const increment = mode === "projection" ? 0.08 : mode === "time-reversal" ? 0.16 : 0.06;
  setActiveValue(Math.min(activeMaximum(), activeValue() + increment));
  render();
});

playButton.addEventListener("click", () => {
  if (playing) {
    stopPlaying();
    return;
  }
  if (activeValue() >= activeMaximum()) setActiveValue(0);
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
