import "./projective-clebsch.css";
import "katex/dist/katex.min.css";

import katex from "katex";
import {
  PROJECTIVE_DOMAINS,
  projectiveBranchShift,
  projectiveDomainContains,
  projectiveLoopCharge,
  projectiveLoopPoint,
  projectivePowerPhase,
  projectiveRosyDirections,
  projectiveTransportedBranchAngle,
  type ProjectiveDomain,
  type ProjectiveDomainKind,
  type ProjectiveLoopKind,
  type ProjectivePoint,
} from "./projective-clebsch-model";

type DisplayMode = "unordered" | "branch" | "power";

interface PanelLayout {
  left: number;
  top: number;
  width: number;
  height: number;
}

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as T;
}

for (const element of document.querySelectorAll<HTMLElement>("[data-latex]")) {
  katex.render(element.dataset.latex!, element, {
    displayMode: element.classList.contains("pc-math-display"),
    output: "htmlAndMathml",
    throwOnError: false,
  });
}

const canvas = byId<HTMLCanvasElement>("pc-canvas");
const canvasContext = canvas.getContext("2d");
if (!canvasContext) throw new Error("Canvas 2D is unavailable");
const context: CanvasRenderingContext2D = canvasContext;
const chargeOneInput = byId<HTMLInputElement>("pc-charge-one");
const chargeTwoInput = byId<HTMLInputElement>("pc-charge-two");
const transportInput = byId<HTMLInputElement>("pc-transport");
const playButton = byId<HTMLButtonElement>("pc-play");
const domainButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-pc-domain]")];
const symmetryButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-pc-symmetry]")];
const displayButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-pc-display]")];
const loopButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-pc-loop]")];

let domainKind: ProjectiveDomainKind = "annulus";
let symmetry = 2;
let charges = [1, 1];
let selectedLoop: ProjectiveLoopKind = "hole-1";
let displayMode: DisplayMode = "unordered";
let playing = false;
let animationFrame = 0;
let previousTimestamp = 0;

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

function layouts(width: number, height: number): { domain: PanelLayout; ledger: PanelLayout } {
  if (width >= 760) {
    const domainSize = Math.min(height - 68, width * 0.62);
    const domain = { left: 26, top: (height - domainSize) / 2, width: domainSize, height: domainSize };
    return {
      domain,
      ledger: {
        left: domain.left + domain.width + 28,
        top: domain.top,
        width: width - domain.left - domain.width - 52,
        height: domain.height,
      },
    };
  }
  const domainSize = Math.min(width - 42, height * 0.62);
  return {
    domain: { left: (width - domainSize) / 2, top: 22, width: domainSize, height: domainSize },
    ledger: { left: 21, top: domainSize + 42, width: width - 42, height: height - domainSize - 61 },
  };
}

function worldToScreen(point: ProjectivePoint, panel: PanelLayout, domain: ProjectiveDomain): ProjectivePoint {
  const scale = 0.46 * Math.min(panel.width, panel.height) / domain.outerRadius;
  return {
    x: panel.left + 0.5 * panel.width + scale * point.x,
    y: panel.top + 0.5 * panel.height - scale * point.y,
  };
}

function domainScale(panel: PanelLayout, domain: ProjectiveDomain): number {
  return 0.46 * Math.min(panel.width, panel.height) / domain.outerRadius;
}

function drawArrow(start: ProjectivePoint, angle: number, length: number, color: string, width = 2): void {
  const end = { x: start.x + length * Math.cos(angle), y: start.y - length * Math.sin(angle) };
  const screenAngle = Math.atan2(end.y - start.y, end.x - start.x);
  const head = 5 + width;
  context.beginPath();
  context.moveTo(start.x, start.y);
  context.lineTo(end.x, end.y);
  context.strokeStyle = color;
  context.lineWidth = width;
  context.lineCap = "round";
  context.stroke();
  context.beginPath();
  context.moveTo(end.x, end.y);
  context.lineTo(end.x - head * Math.cos(screenAngle - Math.PI / 6), end.y - head * Math.sin(screenAngle - Math.PI / 6));
  context.lineTo(end.x - head * Math.cos(screenAngle + Math.PI / 6), end.y - head * Math.sin(screenAngle + Math.PI / 6));
  context.closePath();
  context.fillStyle = color;
  context.fill();
}

function drawGlyph(point: ProjectivePoint, powerPhase: number): void {
  if (displayMode === "power") {
    drawArrow(point, powerPhase, 11, "rgba(88,224,232,.82)", 1.2);
    return;
  }
  if (displayMode === "branch") {
    drawArrow(point, powerPhase / symmetry, 11, "rgba(255,117,64,.78)", 1.15);
    return;
  }
  const directions = projectiveRosyDirections(symmetry, powerPhase, 10.5);
  if (symmetry === 1) {
    drawArrow(point, Math.atan2(directions[0]!.y, directions[0]!.x), 11, "rgba(214,246,239,.78)", 1.15);
    return;
  }
  context.beginPath();
  for (const direction of directions) {
    context.moveTo(point.x, point.y);
    context.lineTo(point.x + direction.x, point.y - direction.y);
  }
  context.strokeStyle = "rgba(214,246,239,.72)";
  context.lineWidth = 1.1;
  context.lineCap = "round";
  context.stroke();
}

function cutLength(hole: ProjectivePoint, angle: number, outerRadius: number): number {
  const direction = { x: Math.cos(angle), y: Math.sin(angle) };
  const projection = hole.x * direction.x + hole.y * direction.y;
  return -projection + Math.sqrt(Math.max(0, projection ** 2 + outerRadius ** 2 - hole.x ** 2 - hole.y ** 2));
}

function drawDomain(panel: PanelLayout): void {
  const domain = PROJECTIVE_DOMAINS[domainKind];
  const scale = domainScale(panel, domain);
  const center = worldToScreen({ x: 0, y: 0 }, panel, domain);
  const path = new Path2D();
  path.arc(center.x, center.y, scale * domain.outerRadius, 0, 2 * Math.PI);
  for (const hole of domain.holes) {
    const holeCenter = worldToScreen(hole, panel, domain);
    path.moveTo(holeCenter.x + scale * hole.radius, holeCenter.y);
    path.arc(holeCenter.x, holeCenter.y, scale * hole.radius, 0, 2 * Math.PI);
  }
  context.fillStyle = "#17384c";
  context.fill(path, "evenodd");
  context.strokeStyle = "#7edbe0";
  context.lineWidth = 1.4;
  context.stroke(path);

  const spacing = domain.outerRadius / 7.3;
  for (let y = -domain.outerRadius; y <= domain.outerRadius; y += spacing) {
    for (let x = -domain.outerRadius; x <= domain.outerRadius; x += spacing) {
      const point = { x, y };
      if (!projectiveDomainContains(domain, point)) continue;
      drawGlyph(worldToScreen(point, panel, domain), projectivePowerPhase(domain, point, charges));
    }
  }

  context.save();
  context.setLineDash([5, 5]);
  context.strokeStyle = "rgba(255,117,64,.88)";
  context.lineWidth = 1.5;
  for (const hole of domain.holes) {
    const startWorld = {
      x: hole.x + hole.radius * Math.cos(hole.cutAngle),
      y: hole.y + hole.radius * Math.sin(hole.cutAngle),
    };
    const length = cutLength(hole, hole.cutAngle, domain.outerRadius);
    const endWorld = {
      x: hole.x + length * Math.cos(hole.cutAngle),
      y: hole.y + length * Math.sin(hole.cutAngle),
    };
    const start = worldToScreen(startWorld, panel, domain);
    const end = worldToScreen(endWorld, panel, domain);
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
    context.stroke();
  }
  context.restore();

  context.fillStyle = "#ffd26a";
  context.font = "800 8px SFMono-Regular, Consolas, monospace";
  context.textAlign = "center";
  for (let index = 0; index < domain.holes.length; index += 1) {
    const hole = domain.holes[index]!;
    const label = worldToScreen({ x: hole.x, y: hole.y }, panel, domain);
    context.fillText(`HOLE ${index + 1} · m${index + 1}=${charges[index] ?? 0}`, label.x, label.y + 3);
  }

  const turn = Number(transportInput.value);
  context.save();
  context.setLineDash([7, 5]);
  context.strokeStyle = "rgba(255,210,106,.72)";
  context.lineWidth = 2;
  context.beginPath();
  for (let index = 0; index <= 120; index += 1) {
    const point = worldToScreen(projectiveLoopPoint(domain, selectedLoop, index / 120), panel, domain);
    if (index === 0) context.moveTo(point.x, point.y);
    else context.lineTo(point.x, point.y);
  }
  context.closePath();
  context.stroke();
  context.restore();

  const tracerWorld = projectiveLoopPoint(domain, selectedLoop, turn);
  const tracer = worldToScreen(tracerWorld, panel, domain);
  const transportedAngle = projectiveTransportedBranchAngle(domain, symmetry, charges, selectedLoop, turn);
  context.beginPath();
  context.arc(tracer.x, tracer.y, 6, 0, 2 * Math.PI);
  context.fillStyle = "#ffd26a";
  context.fill();
  context.shadowColor = "#ffd26a";
  context.shadowBlur = 8;
  drawArrow(tracer, transportedAngle, 27, "#ffd26a", 3);
  context.shadowBlur = 0;
  context.fillStyle = "#c5d4dd";
  context.font = "700 8px SFMono-Regular, Consolas, monospace";
  context.textAlign = "left";
  context.fillText("continuously transported root", tracer.x + 10, tracer.y - 12);
}

function loopLabel(loop: ProjectiveLoopKind): string {
  if (loop === "hole-1") return "hole 1";
  if (loop === "hole-2") return "hole 2";
  return domainKind === "annulus" ? "the hole / outer loop" : "both holes";
}

function drawLedger(panel: PanelLayout): void {
  const domain = PROJECTIVE_DOMAINS[domainKind];
  const shift = projectiveBranchShift(domain, symmetry, charges, selectedLoop);
  context.fillStyle = "rgba(6,17,28,.82)";
  context.strokeStyle = "#4c6074";
  context.lineWidth = 1;
  context.beginPath();
  context.roundRect(panel.left, panel.top, panel.width, panel.height, 5);
  context.fill();
  context.stroke();

  context.fillStyle = "#58e0e8";
  context.font = "800 8px SFMono-Regular, Consolas, monospace";
  context.textAlign = "left";
  context.fillText("BRANCH COVER · FOLLOW ONE ROOT", panel.left + 16, panel.top + 22);
  context.fillStyle = "#f0f5f2";
  context.font = "800 11px Inter, system-ui, sans-serif";
  context.fillText(`${loopLabel(selectedLoop)} sends sheet 0 to sheet ${shift}`, panel.left + 16, panel.top + 43);

  const top = panel.top + 73;
  const bottom = panel.top + Math.min(panel.height - 92, 73 + 42 * Math.max(1, symmetry - 1));
  const rowY = (sheet: number): number => symmetry === 1
    ? 0.5 * (top + bottom)
    : top + sheet * (bottom - top) / (symmetry - 1);
  const left = panel.left + 58;
  const right = panel.left + panel.width - 24;
  for (let sheet = 0; sheet < symmetry; sheet += 1) {
    const y = rowY(sheet);
    context.strokeStyle = "rgba(132,158,177,.38)";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(left, y);
    context.lineTo(right, y);
    context.stroke();
    context.fillStyle = sheet === 0 ? "#ffd26a" : "#91a8b9";
    context.font = "700 8px SFMono-Regular, Consolas, monospace";
    context.textAlign = "right";
    context.fillText(`sheet ${sheet}`, left - 8, y + 3);
  }

  const start = { x: left, y: rowY(0) };
  const end = { x: right, y: rowY(shift) };
  context.strokeStyle = "#ffd26a";
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(start.x, start.y);
  context.bezierCurveTo(
    left + 0.36 * (right - left), start.y,
    left + 0.64 * (right - left), end.y,
    end.x, end.y,
  );
  context.stroke();
  const amount = Number(transportInput.value);
  const smooth = amount * amount * (3 - 2 * amount);
  const marker = {
    x: left + amount * (right - left),
    y: start.y + smooth * (end.y - start.y),
  };
  context.beginPath();
  context.arc(marker.x, marker.y, 5, 0, 2 * Math.PI);
  context.fillStyle = "#ff7540";
  context.fill();

  const tableTop = bottom + 35;
  if (tableTop < panel.top + panel.height - 40) {
    context.fillStyle = "#8499aa";
    context.font = "700 7px SFMono-Regular, Consolas, monospace";
    context.textAlign = "left";
    context.fillText("LOOP", panel.left + 16, tableTop);
    context.fillText("BRANCH SHIFT", panel.left + panel.width * 0.55, tableTop);
    const rows: Array<[ProjectiveLoopKind, string]> = [
      ["hole-1", "around hole 1"],
      ...(domain.holes.length > 1 ? [["hole-2", "around hole 2"]] as Array<[ProjectiveLoopKind, string]> : []),
      ["outer", domain.holes.length > 1 ? "around both" : "outer loop"],
    ];
    rows.forEach(([loop, label], index) => {
      const y = tableTop + 22 + 24 * index;
      context.strokeStyle = "rgba(132,158,177,.24)";
      context.beginPath();
      context.moveTo(panel.left + 16, y - 12);
      context.lineTo(panel.left + panel.width - 16, y - 12);
      context.stroke();
      context.fillStyle = loop === selectedLoop ? "#ffd26a" : "#d1dce3";
      context.font = "700 8px SFMono-Regular, Consolas, monospace";
      context.fillText(label, panel.left + 16, y);
      context.fillText(
        `0 → ${projectiveBranchShift(domain, symmetry, charges, loop)}  (mod ${symmetry})`,
        panel.left + panel.width * 0.55,
        y,
      );
    });
  }
}

function draw(): void {
  const { width, height } = resizeCanvas();
  const panels = layouts(width, height);
  context.clearRect(0, 0, width, height);
  const background = context.createRadialGradient(width * 0.42, height * 0.42, 0, width * 0.42, height * 0.42, Math.max(width, height) * 0.8);
  background.addColorStop(0, "#173550");
  background.addColorStop(0.62, "#0a1b2b");
  background.addColorStop(1, "#060f1a");
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);
  drawDomain(panels.domain);
  drawLedger(panels.ledger);
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b !== 0) [a, b] = [b, a % b];
  return Math.max(1, a);
}

function fractionLabel(numerator: number, denominator: number): string {
  if (numerator === 0) return "0";
  const divisor = greatestCommonDivisor(numerator, denominator);
  return `${numerator / divisor}/${denominator / divisor}`;
}

function setPressed(buttons: readonly HTMLButtonElement[], active: HTMLButtonElement): void {
  for (const button of buttons) {
    const selected = button === active;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", String(selected));
  }
}

function updateReadout(): void {
  const domain = PROJECTIVE_DOMAINS[domainKind];
  const shift = projectiveBranchShift(domain, symmetry, charges, selectedLoop);
  const selectedCharge = projectiveLoopCharge(domain, charges, selectedLoop);
  byId("pc-loop-readout").textContent = loopLabel(selectedLoop);
  byId("pc-shift").textContent = `sheet 0 → ${shift}`;
  byId("pc-hole-one").textContent = `+${projectiveBranchShift(domain, symmetry, charges, "hole-1")} mod ${symmetry}`;
  byId("pc-hole-two").textContent = domain.holes.length > 1
    ? `+${projectiveBranchShift(domain, symmetry, charges, "hole-2")} mod ${symmetry}`
    : "not present";
  byId("pc-outer").textContent = `+${projectiveBranchShift(domain, symmetry, charges, "outer")} mod ${symmetry}`;
  byId("pc-index").textContent = fractionLabel(selectedCharge, symmetry);
  byId<HTMLOutputElement>("pc-charge-one-output").value = String(charges[0]);
  byId<HTMLOutputElement>("pc-charge-two-output").value = String(charges[1]);
  byId<HTMLOutputElement>("pc-transport-output").value = `${Number(transportInput.value).toFixed(2)} turns`;
  byId("pc-stage-kicker").textContent = domainKind === "annulus"
    ? "ANNULUS · ONE GENERATOR"
    : "PAIR OF PANTS · TWO GENERATORS";
  byId("pc-stage-title").textContent = domainKind === "annulus"
    ? "the unordered field closes even when its selected branch does not"
    : "two inner monodromies combine on the loop around both holes";
  canvas.setAttribute(
    "aria-label",
    `${symmetry}-symmetric projective field on the ${domainKind === "annulus" ? "annulus" : "two-hole disk"}; ${loopLabel(selectedLoop)} shifts branch zero to ${shift}.`,
  );
}

function resetJourney(): void {
  transportInput.value = "0";
  updateReadout();
  draw();
}

function setPlaying(next: boolean): void {
  playing = next;
  playButton.textContent = next ? "Pause journey" : "Carry branch";
  playButton.classList.toggle("active", next);
  playButton.setAttribute("aria-pressed", String(next));
  if (next) {
    if (Number(transportInput.value) >= 0.999) transportInput.value = "0";
    previousTimestamp = 0;
    animationFrame = requestAnimationFrame(tick);
  } else {
    cancelAnimationFrame(animationFrame);
  }
}

function tick(timestamp: number): void {
  if (!playing) return;
  if (previousTimestamp === 0) previousTimestamp = timestamp;
  const elapsed = Math.min(40, timestamp - previousTimestamp);
  previousTimestamp = timestamp;
  const next = Math.min(1, Number(transportInput.value) + elapsed / 5200);
  transportInput.value = next.toFixed(3);
  updateReadout();
  draw();
  if (next >= 1) setPlaying(false);
  else animationFrame = requestAnimationFrame(tick);
}

for (const button of domainButtons) {
  button.addEventListener("click", () => {
    setPlaying(false);
    domainKind = button.dataset.pcDomain as ProjectiveDomainKind;
    setPressed(domainButtons, button);
    const hasSecondHole = domainKind === "two-hole";
    byId("pc-charge-two-label").hidden = !hasSecondHole;
    const holeTwoButton = loopButtons.find((candidate) => candidate.dataset.pcLoop === "hole-2")!;
    holeTwoButton.hidden = !hasSecondHole;
    if (!hasSecondHole && selectedLoop === "hole-2") {
      selectedLoop = "hole-1";
      setPressed(loopButtons, loopButtons.find((candidate) => candidate.dataset.pcLoop === "hole-1")!);
    }
    resetJourney();
  });
}

for (const button of symmetryButtons) {
  button.addEventListener("click", () => {
    setPlaying(false);
    symmetry = Number(button.dataset.pcSymmetry);
    setPressed(symmetryButtons, button);
    for (const input of [chargeOneInput, chargeTwoInput]) input.max = String(symmetry - 1);
    charges = charges.map((charge) => Math.min(charge, symmetry - 1));
    chargeOneInput.value = String(charges[0]);
    chargeTwoInput.value = String(charges[1]);
    resetJourney();
  });
}

for (const button of displayButtons) {
  button.addEventListener("click", () => {
    displayMode = button.dataset.pcDisplay as DisplayMode;
    setPressed(displayButtons, button);
    draw();
  });
}

for (const button of loopButtons) {
  button.addEventListener("click", () => {
    setPlaying(false);
    selectedLoop = button.dataset.pcLoop as ProjectiveLoopKind;
    setPressed(loopButtons, button);
    resetJourney();
  });
}

chargeOneInput.addEventListener("input", () => {
  setPlaying(false);
  charges[0] = Number(chargeOneInput.value);
  resetJourney();
});
chargeTwoInput.addEventListener("input", () => {
  setPlaying(false);
  charges[1] = Number(chargeTwoInput.value);
  resetJourney();
});
transportInput.addEventListener("input", () => {
  setPlaying(false);
  updateReadout();
  draw();
});
byId("pc-reset").addEventListener("click", () => {
  setPlaying(false);
  resetJourney();
});
playButton.addEventListener("click", () => setPlaying(!playing));

playButton.setAttribute("aria-pressed", "false");
new ResizeObserver(draw).observe(canvas);
updateReadout();
draw();
