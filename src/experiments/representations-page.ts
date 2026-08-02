import "./representations.css";

import {
  buildRepresentationTransfer,
  type RepresentationFieldKind,
  type RepresentationTransferReport,
  type TransferVec2,
} from "./representation-transfer";

type DisplayRepresentation = "vertex" | "edge" | "face";

function byId<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing #${id}.`);
  return value as T;
}

const canvas = byId<HTMLCanvasElement>("representation-canvas");
const fieldControl = byId<HTMLSelectElement>("representation-field");
const resolutionControl = byId<HTMLInputElement>("representation-resolution");
const resolutionOutput = byId<HTMLOutputElement>("representation-resolution-output");
const roundTripToggle = byId<HTMLInputElement>("representation-roundtrip-toggle");
let display: DisplayRepresentation = "vertex";
let report = buildRepresentationTransfer(9, "gradient");

const addressCopy: Record<DisplayRepresentation, {
  kicker: string;
  title: string;
  equation: string;
  copy: string;
  value: string;
  curl: string;
  warning: string;
}> = {
  vertex: {
    kicker: "NATIVE UNKNOWN",
    title: "Vertex tangent vectors",
    equation: "uᵢ ∈ TᵢM ≅ ℝ²",
    copy: "This is the representation used by the main integrability lesson. On this flat patch every tangent frame agrees; a curved mesh would also require an explicit connection.",
    value: "two coordinates in the local tangent frame",
    curl: "not natively—the lesson first integrates u along edges",
    warning: "that vertex arrows automatically inherit a de Rham complex",
  },
  edge: {
    kicker: "DERIVED COCHAIN",
    title: "Oriented edge 1-form",
    equation: "αᵢⱼ = ½(uᵢ + uⱼ) · (pⱼ − pᵢ)",
    copy: "Each scalar is a signed line integral. Reversing the edge orientation reverses its sign. Summing three values around a face produces circulation without reconstructing arrows.",
    value: "one oriented integral, with units of vector × length",
    curl: "on triangle boundaries through d₁α",
    warning: "that α can be compared to a vector component without a metric",
  },
  face: {
    kicker: "DERIVED RECONSTRUCTION",
    title: "Piecewise-constant face vectors",
    equation: "w_f = argmin_w Σ₍ᵢⱼ₎⊂∂f (w · eᵢⱼ − αᵢⱼ)²",
    copy: "Three edge integrals ask a constant face vector to satisfy three equations with two unknowns. Their incompatible component is triangle circulation, so the fit residual becomes a useful certificate.",
    value: "two coordinates in one triangle tangent plane",
    curl: "already measured on the source edge boundary",
    warning: "that averaging these vectors back to vertices inverts the transfer",
  },
};

function fitCanvas(): { context: CanvasRenderingContext2D; width: number; height: number } {
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const bounds = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(bounds.width * ratio));
  const height = Math.max(1, Math.round(bounds.height * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D is unavailable.");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { context, width: bounds.width, height: bounds.height };
}

function coordinate(point: TransferVec2, width: number, height: number): TransferVec2 {
  const padding = 38;
  const side = Math.min(width, height) - 2 * padding;
  return {
    x: 0.5 * width + 0.5 * side * point.x,
    y: 0.5 * height - 0.5 * side * point.y,
  };
}

function arrow(
  context: CanvasRenderingContext2D,
  origin: TransferVec2,
  vector: TransferVec2,
  scale: number,
  color: string,
  width = 1.5,
): void {
  const length = Math.hypot(vector.x, vector.y);
  if (length < 1e-12) return;
  const dx = scale * vector.x;
  const dy = -scale * vector.y;
  const end = { x: origin.x + dx, y: origin.y + dy };
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = width;
  context.beginPath();
  context.moveTo(origin.x, origin.y);
  context.lineTo(end.x, end.y);
  context.stroke();
  const unitX = dx / Math.hypot(dx, dy);
  const unitY = dy / Math.hypot(dx, dy);
  context.beginPath();
  context.moveTo(end.x, end.y);
  context.lineTo(end.x - 5 * unitX + 2.8 * unitY, end.y - 5 * unitY - 2.8 * unitX);
  context.lineTo(end.x - 5 * unitX - 2.8 * unitY, end.y - 5 * unitY + 2.8 * unitX);
  context.closePath();
  context.fill();
}

function drawMesh(context: CanvasRenderingContext2D, width: number, height: number): void {
  context.strokeStyle = "rgba(194,176,225,.14)";
  context.lineWidth = 1;
  for (const face of report.faces) {
    const points = face.vertices.map((index) => coordinate(report.positions[index]!, width, height));
    context.beginPath();
    context.moveTo(points[0]!.x, points[0]!.y);
    context.lineTo(points[1]!.x, points[1]!.y);
    context.lineTo(points[2]!.x, points[2]!.y);
    context.closePath();
    context.stroke();
  }
}

function drawVertexView(context: CanvasRenderingContext2D, width: number, height: number): void {
  drawMesh(context, width, height);
  const cell = (Math.min(width, height) - 76) / (report.resolution - 1);
  const scale = 0.34 * cell;
  report.positions.forEach((position, index) => {
    const origin = coordinate(position, width, height);
    if (roundTripToggle.checked) {
      arrow(context, origin, report.reconstructedVertexField[index]!, scale, "rgba(255,220,112,.72)", 2.8);
    }
    arrow(context, origin, report.vertexField[index]!, scale, "#73f4ef", 1.25);
    context.fillStyle = "#f7f2ff";
    context.beginPath();
    context.arc(origin.x, origin.y, 1.6, 0, 2 * Math.PI);
    context.fill();
  });
}

function drawEdgeView(context: CanvasRenderingContext2D, width: number, height: number): void {
  const maximum = Math.max(1e-12, ...report.edges.map((edge) => Math.abs(edge.alpha)));
  for (const edge of report.edges) {
    const tail = coordinate(report.positions[edge.tail]!, width, height);
    const head = coordinate(report.positions[edge.head]!, width, height);
    const magnitude = Math.abs(edge.alpha) / maximum;
    context.strokeStyle = edge.alpha >= 0 ? `rgba(115,244,239,${0.22 + 0.78 * magnitude})` : `rgba(255,115,189,${0.22 + 0.78 * magnitude})`;
    context.lineWidth = 0.8 + 4 * magnitude;
    context.beginPath();
    context.moveTo(tail.x, tail.y);
    context.lineTo(head.x, head.y);
    context.stroke();
    const direction = edge.alpha >= 0 ? 1 : -1;
    const midpoint = { x: 0.5 * (tail.x + head.x), y: 0.5 * (tail.y + head.y) };
    const dx = head.x - tail.x;
    const dy = head.y - tail.y;
    const length = Math.max(1e-12, Math.hypot(dx, dy));
    context.fillStyle = edge.alpha >= 0 ? "#73f4ef" : "#ff73bd";
    context.beginPath();
    context.moveTo(midpoint.x + direction * 4 * dx / length, midpoint.y + direction * 4 * dy / length);
    context.lineTo(midpoint.x - direction * 3 * dx / length + 2.5 * dy / length, midpoint.y - direction * 3 * dy / length - 2.5 * dx / length);
    context.lineTo(midpoint.x - direction * 3 * dx / length - 2.5 * dy / length, midpoint.y - direction * 3 * dy / length + 2.5 * dx / length);
    context.closePath();
    context.fill();
  }
}

function drawFaceView(context: CanvasRenderingContext2D, width: number, height: number): void {
  const curlScale = Math.max(1e-12, ...report.faces.map((face) => Math.abs(face.curl)));
  const cell = (Math.min(width, height) - 76) / (report.resolution - 1);
  for (const face of report.faces) {
    const points = face.vertices.map((index) => coordinate(report.positions[index]!, width, height));
    const intensity = Math.abs(face.curl) / curlScale;
    context.fillStyle = face.curl >= 0
      ? `rgba(255,115,189,${0.04 + 0.32 * intensity})`
      : `rgba(115,244,239,${0.04 + 0.32 * intensity})`;
    context.strokeStyle = "rgba(194,176,225,.18)";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(points[0]!.x, points[0]!.y);
    context.lineTo(points[1]!.x, points[1]!.y);
    context.lineTo(points[2]!.x, points[2]!.y);
    context.closePath();
    context.fill();
    context.stroke();
    arrow(context, coordinate(face.center, width, height), face.vector, 0.3 * cell, "#ffdc70", 1.2);
  }
}

function format(value: number): string {
  return Math.abs(value) < 1e-14 ? "0" : value.toExponential(2);
}

function render(): void {
  const { context, width, height } = fitCanvas();
  context.clearRect(0, 0, width, height);
  if (display === "vertex") drawVertexView(context, width, height);
  else if (display === "edge") drawEdgeView(context, width, height);
  else drawFaceView(context, width, height);

  const copy = addressCopy[display];
  byId("address-kicker").textContent = copy.kicker;
  byId("address-title").textContent = copy.title;
  byId("address-equation").textContent = copy.equation;
  byId("address-copy").textContent = copy.copy;
  byId("address-value").textContent = copy.value;
  byId("address-curl").textContent = copy.curl;
  byId("address-warning").textContent = copy.warning;
  const dofs = display === "vertex" ? 2 * report.positions.length : display === "edge" ? report.edges.length : 2 * report.faces.length;
  const sampleCount = display === "vertex" ? report.positions.length : display === "edge" ? report.edges.length : report.faces.length;
  byId("representation-status").textContent = copy.kicker;
  byId("representation-caption").textContent = display === "vertex" ? "two tangent components at each mesh vertex" : display === "edge" ? "one signed integral on every oriented edge" : "one reconstructed constant vector per triangle";
  byId("representation-count").textContent = `${sampleCount} samples`;
  byId("representation-dofs").textContent = dofs.toLocaleString();
  byId("representation-curl").textContent = format(report.curlRms);
  byId("representation-residual").textContent = format(report.faceResidualRms);
  byId("representation-roundtrip").textContent = format(report.roundTripRms);
  byId("representation-legend-note").textContent = display === "vertex" ? "arrows live at vertices" : display === "edge" ? "color encodes signed α" : "fill encodes curl; arrows are fitted";
  roundTripToggle.disabled = display !== "vertex";
  resolutionOutput.value = `${report.resolution} × ${report.resolution}`;
}

function rebuild(): void {
  report = buildRepresentationTransfer(
    Math.round(Number(resolutionControl.value)),
    fieldControl.value as RepresentationFieldKind,
  );
  render();
}

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-representation]")) {
  button.addEventListener("click", () => {
    display = button.dataset.representation as DisplayRepresentation;
    for (const candidate of document.querySelectorAll<HTMLButtonElement>("[data-representation]")) {
      candidate.setAttribute("aria-pressed", String(candidate === button));
    }
    render();
  });
}
fieldControl.addEventListener("change", rebuild);
resolutionControl.addEventListener("input", rebuild);
roundTripToggle.addEventListener("change", render);
new ResizeObserver(render).observe(canvas);
render();
