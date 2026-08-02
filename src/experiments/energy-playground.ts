import "./energy-playground.css";

import {
  compileEnergyExpression,
  type CompiledEnergyExpression,
} from "./energy-expression";
import {
  DEFAULT_ELEMENT_PROGRAM,
  expressionTerm,
  formatElementProgram,
  parseElementProgram,
  validateElementProgram,
  type VertexElementProgram,
  type VertexTargetHandle,
  type VertexTargetKind,
} from "./element-program";
import {
  LocalScalar,
  localAdd,
  localLinearCombination,
  localScale,
  localSquare,
  localSubtract,
} from "../core/local-autodiff";
import { SparseObjectiveAssembler, type SparseSymmetricMatrix } from "../core/sparse-assembly";
import {
  generatePythonElementProgram,
  generateTinyAdElementProgramHeader,
} from "./energy-codegen";
import {
  experimentPublicationUrls,
  generateBlogEmbedHtml,
} from "./experiment-publishing";
import {
  PeriodicStripeModel,
  stripeSamplingReport,
  type StripeFieldKind,
} from "./stripe-pattern";

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

interface Vec2 { x: number; y: number }

let currentProgram: VertexElementProgram = structuredClone(DEFAULT_ELEMENT_PROGRAM);
let gridSize = currentProgram.mesh.gridSize;
let positions: Vec2[] = [];
let triangles: [number, number, number][] = [];
let edges: [number, number][] = [];
let targets: Vec2[] = [];
let targetConfidence: number[] = [];
let currentHandles: VertexTargetHandle[] = [];
let triangleGeometry: ReturnType<typeof triangleData>[] = [];

const DEFAULT_HANDLES: VertexTargetHandle[] = [
  { position: [-0.72, -0.72], vector: [1, 0.15] },
  { position: [0.72, -0.72], vector: [0.25, 1] },
  { position: [-0.72, 0.72], vector: [0.2, -1] },
  { position: [0.72, 0.72], vector: [-1, 0.2] },
  { position: [0, 0], vector: [0.75, 0.65] },
];

function normalized(vector: readonly number[]): Vec2 {
  const rawLength = Math.hypot(vector[0]!, vector[1]!);
  if (rawLength < 1e-12) return { x: 1, y: 0 };
  const length = rawLength;
  return { x: vector[0]! / length, y: vector[1]! / length };
}

function harmonicHandleField(handles: readonly VertexTargetHandle[], dataSupport: "field" | "handles"): void {
  const fixed = new Map<number, Vec2>();
  for (const handle of handles) {
    const column = Math.round((handle.position[0] + 1) * 0.5 * (gridSize - 1));
    const row = Math.round((handle.position[1] + 1) * 0.5 * (gridSize - 1));
    fixed.set(row * gridSize + column, normalized(handle.vector));
  }
  targets = positions.map((position) => {
    let sumX = 0;
    let sumY = 0;
    let sumWeight = 0;
    for (const handle of handles) {
      const distance2 = (position.x - handle.position[0]) ** 2 + (position.y - handle.position[1]) ** 2;
      const weight = 1 / Math.max(0.015, distance2);
      const vector = normalized(handle.vector);
      sumX += weight * vector.x;
      sumY += weight * vector.y;
      sumWeight += weight;
    }
    return { x: sumX / sumWeight, y: sumY / sumWeight };
  });
  for (let iteration = 0; iteration < 260; iteration += 1) {
    for (let row = 0; row < gridSize; row += 1) {
      for (let column = 0; column < gridSize; column += 1) {
        const index = row * gridSize + column;
        const prescribed = fixed.get(index);
        if (prescribed) {
          targets[index] = prescribed;
          continue;
        }
        const neighbors: number[] = [];
        if (column > 0) neighbors.push(index - 1);
        if (column + 1 < gridSize) neighbors.push(index + 1);
        if (row > 0) neighbors.push(index - gridSize);
        if (row + 1 < gridSize) neighbors.push(index + gridSize);
        targets[index] = {
          x: neighbors.reduce((sum, neighbor) => sum + targets[neighbor]!.x, 0) / neighbors.length,
          y: neighbors.reduce((sum, neighbor) => sum + targets[neighbor]!.y, 0) / neighbors.length,
        };
      }
    }
  }
  targetConfidence = positions.map((_, index) => dataSupport === "field" || fixed.has(index) ? 1 : 0);
}

function targetVector(position: Vec2, kind: VertexTargetKind): Vec2 {
  if (kind === "constant") return { x: 1, y: 0 };
  if (kind === "gradient-wave") {
    return {
      x: Math.cos(Math.PI * position.x) * Math.sin(Math.PI * position.y),
      y: Math.sin(Math.PI * position.x) * Math.cos(Math.PI * position.y),
    };
  }
  const radius = Math.hypot(position.x, position.y);
  return radius < 1e-8
    ? { x: 1, y: 0 }
    : { x: -position.y / radius, y: position.x / radius };
}

function buildGeometry(
  nextGridSize: number,
  targetKind: VertexTargetKind,
  handles: readonly VertexTargetHandle[] = DEFAULT_HANDLES,
  dataSupport: "field" | "handles" = "field",
): void {
  gridSize = nextGridSize;
  positions = [];
  triangles = [];
  edges = [];
  for (let row = 0; row < gridSize; row += 1) {
    for (let column = 0; column < gridSize; column += 1) {
      positions.push({
        x: -1 + (2 * column) / (gridSize - 1),
        y: -1 + (2 * row) / (gridSize - 1),
      });
    }
  }
  const vertex = (column: number, row: number): number => row * gridSize + column;
  for (let row = 0; row + 1 < gridSize; row += 1) {
    for (let column = 0; column + 1 < gridSize; column += 1) {
      const a = vertex(column, row);
      const b = vertex(column + 1, row);
      const c = vertex(column, row + 1);
      const d = vertex(column + 1, row + 1);
      triangles.push([a, b, d], [a, d, c]);
    }
  }
  const edgeKeys = new Set<string>();
  for (const triangle of triangles) {
    for (let corner = 0; corner < 3; corner += 1) {
      const a = triangle[corner]!;
      const b = triangle[(corner + 1) % 3]!;
      const tail = Math.min(a, b);
      const head = Math.max(a, b);
      const key = `${tail}:${head}`;
      if (edgeKeys.has(key)) continue;
      edgeKeys.add(key);
      edges.push([tail, head]);
    }
  }
  currentHandles = handles.map((handle) => structuredClone(handle));
  if (targetKind === "handles") harmonicHandleField(currentHandles, dataSupport);
  else {
    targets = positions.map((position) => targetVector(position, targetKind));
    targetConfidence = positions.map(() => 1);
  }
  triangleGeometry = triangles.map(triangleData);
}

const expressionEditor = byId<HTMLTextAreaElement>("energy-expression");
const expressionStatus = byId<HTMLParagraphElement>("expression-status");
const stateLabel = byId<HTMLDivElement>("energy-state");
const fieldCanvas = byId<HTMLCanvasElement>("energy-field");
const historyCanvas = byId<HTMLCanvasElement>("energy-history");
const fieldContext = context2d(fieldCanvas);
const historyContext = context2d(historyCanvas);

const controlIds = ["grid-size", "data-weight", "unit-weight", "curl-weight", "smooth-weight", "target-length"] as const;
type ControlId = (typeof controlIds)[number];
const controls = Object.fromEntries(
  controlIds.map((id) => [id, byId<HTMLInputElement>(id)]),
) as Record<ControlId, HTMLInputElement>;
const outputs = {
  "grid-size": byId<HTMLOutputElement>("grid-output"),
  "data-weight": byId<HTMLOutputElement>("data-output"),
  "unit-weight": byId<HTMLOutputElement>("unit-output"),
  "curl-weight": byId<HTMLOutputElement>("curl-output"),
  "smooth-weight": byId<HTMLOutputElement>("smooth-output"),
  "target-length": byId<HTMLOutputElement>("length-output"),
};

const defaults: Record<ControlId, number> = {
  "grid-size": currentProgram.mesh.gridSize,
  "data-weight": currentProgram.parameters.dataWeight,
  "unit-weight": currentProgram.parameters.unitWeight,
  "curl-weight": currentProgram.parameters.integrabilityWeight,
  "smooth-weight": currentProgram.parameters.smoothnessWeight,
  "target-length": currentProgram.parameters.targetLength,
};
for (const id of controlIds) controls[id].value = String(defaults[id]);

const targetKindControl = byId<HTMLSelectElement>("target-kind");
const dataSupportControl = byId<HTMLSelectElement>("data-support");
const handleDesignCard = byId<HTMLDetailsElement>("handle-design-card");
const programEditor = byId<HTMLTextAreaElement>("element-program-editor");
const programStatus = byId<HTMLParagraphElement>("program-status");
const programFileInput = byId<HTMLInputElement>("program-file-input");

let compiled: CompiledEnergyExpression = compileEnergyExpression(expressionTerm(currentProgram).expression);
let field: Vec2[] = [];
let acceptedSteps = 0;
let energyHistory: number[] = [];

function settings(): { data: number; unit: number; curl: number; smooth: number; length: number } {
  return {
    data: Number(controls["data-weight"].value),
    unit: Number(controls["unit-weight"].value),
    curl: Number(controls["curl-weight"].value),
    smooth: Number(controls["smooth-weight"].value),
    length: Number(controls["target-length"].value),
  };
}

function updateControlOutputs(): void {
  for (const id of controlIds) {
    outputs[id].value = id === "grid-size"
      ? String(Math.round(Number(controls[id].value)))
      : Number(controls[id].value).toFixed(2);
  }
}

function resetField(): void {
  field = targets.map((target, index) => ({
    x: 0.28 * target.x + 0.15 * Math.sin(index * 12.9898),
    y: 0.28 * target.y + 0.15 * Math.cos(index * 7.233),
  }));
  acceptedSteps = 0;
  const report = evaluateObjective(field);
  energyHistory = [report.energy];
  render(report);
}

interface ObjectiveReport {
  energy: number;
  gradients: Vec2[];
  hessian: SparseSymmetricMatrix;
  curlRms: number;
  unitRms: number;
}

function triangleData(triangle: [number, number, number]): {
  area: number;
  coefficients: [Vec2, Vec2, Vec2];
} {
  const [i, j, k] = triangle;
  const pi = positions[i]!;
  const pj = positions[j]!;
  const pk = positions[k]!;
  const twiceArea = Math.abs(
    (pj.x - pi.x) * (pk.y - pi.y) - (pj.y - pi.y) * (pk.x - pi.x),
  );
  return {
    area: 0.5 * twiceArea,
    coefficients: [
      { x: 0.5 * (pj.x - pk.x), y: 0.5 * (pj.y - pk.y) },
      { x: 0.5 * (pk.x - pi.x), y: 0.5 * (pk.y - pi.y) },
      { x: 0.5 * (pi.x - pj.x), y: 0.5 * (pi.y - pj.y) },
    ],
  };
}

function evaluateObjective(candidate: readonly Vec2[]): ObjectiveReport {
  const weights = settings();
  const objective = new SparseObjectiveAssembler(2 * candidate.length);
  let unitSquared = 0;

  for (let index = 0; index < candidate.length; index += 1) {
    const value = candidate[index]!;
    const target = targets[index]!;
    const jet = compiled.evaluate({
      ux: value.x,
      uy: value.y,
      tx: target.x,
      ty: target.y,
      data: weights.data * (targetConfidence[index] ?? 1),
      unit: weights.unit,
      length: weights.length,
    });
    objective.addElement(
      [2 * index, 2 * index + 1],
      new LocalScalar(
        jet.value,
        Float64Array.from(jet.gradient),
        Float64Array.from([...jet.hessian[0], ...jet.hessian[1]]),
      ),
    );
    unitSquared += (Math.hypot(value.x, value.y) - weights.length) ** 2;
  }

  for (const [i, j] of edges) {
    const dimension = 4;
    const tailX = LocalScalar.variable(candidate[i]!.x, dimension, 0);
    const tailY = LocalScalar.variable(candidate[i]!.y, dimension, 1);
    const headX = LocalScalar.variable(candidate[j]!.x, dimension, 2);
    const headY = LocalScalar.variable(candidate[j]!.y, dimension, 3);
    const edgeEnergy = localScale(
      localAdd(
        localSquare(localSubtract(headX, tailX)),
        localSquare(localSubtract(headY, tailY)),
      ),
      0.5 * weights.smooth,
    );
    objective.addElement([2 * i, 2 * i + 1, 2 * j, 2 * j + 1], edgeEnergy);
  }

  let curlSquared = 0;
  for (let face = 0; face < triangles.length; face += 1) {
    const triangle = triangles[face]!;
    const geometry = triangleGeometry[face]!;
    let circulation = 0;
    for (let corner = 0; corner < 3; corner += 1) {
      const value = candidate[triangle[corner]!]!;
      const coefficient = geometry.coefficients[corner]!;
      circulation += value.x * coefficient.x + value.y * coefficient.y;
    }
    const curl = circulation / geometry.area;
    curlSquared += curl ** 2;
    const localVariables: LocalScalar[] = [];
    const coefficients: number[] = [];
    const globalDofs: number[] = [];
    for (let corner = 0; corner < 3; corner += 1) {
      const index = triangle[corner]!;
      const coefficient = geometry.coefficients[corner]!;
      localVariables.push(
        LocalScalar.variable(candidate[index]!.x, 6, 2 * corner),
        LocalScalar.variable(candidate[index]!.y, 6, 2 * corner + 1),
      );
      coefficients.push(coefficient.x, coefficient.y);
      globalDofs.push(2 * index, 2 * index + 1);
    }
    const circulationValue = localLinearCombination(localVariables, coefficients);
    objective.addElement(
      globalDofs,
      localScale(localSquare(circulationValue), 0.5 * weights.curl / geometry.area),
    );
  }

  const gradients = candidate.map((_, index) => ({
    x: objective.gradient[2 * index]!,
    y: objective.gradient[2 * index + 1]!,
  }));
  return {
    energy: objective.value,
    gradients,
    hessian: objective.hessian,
    curlRms: Math.sqrt(curlSquared / triangles.length),
    unitRms: Math.sqrt(unitSquared / candidate.length),
  };
}

function dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let result = 0;
  for (let index = 0; index < a.length; index += 1) result += a[index]! * b[index]!;
  return result;
}

function sparseNewtonDirection(report: ObjectiveReport): Vec2[] {
  const dimension = report.hessian.size;
  const rightHandSide = new Float64Array(dimension);
  for (let vertex = 0; vertex < report.gradients.length; vertex += 1) {
    rightHandSide[2 * vertex] = -report.gradients[vertex]!.x;
    rightHandSide[2 * vertex + 1] = -report.gradients[vertex]!.y;
  }
  const shift = Math.max(0.03, 0.03 - report.hessian.gershgorinLowerBound());
  const solution = new Float64Array(dimension);
  const residual = rightHandSide.slice();
  const preconditioned = new Float64Array(dimension);
  const direction = new Float64Array(dimension);
  for (let index = 0; index < dimension; index += 1) {
    const diagonal = Math.max(1e-8, report.hessian.get(index, index) + shift);
    preconditioned[index] = residual[index]! / diagonal;
    direction[index] = preconditioned[index]!;
  }
  let residualProduct = dot(residual, preconditioned);
  const toleranceSquared = Math.max(1e-18, 1e-12 * dot(rightHandSide, rightHandSide));
  for (let iteration = 0; iteration < Math.min(250, dimension); iteration += 1) {
    const image = report.hessian.multiply(direction, shift);
    const denominator = dot(direction, image);
    if (!(denominator > 1e-20)) break;
    const step = residualProduct / denominator;
    for (let index = 0; index < dimension; index += 1) {
      solution[index] = solution[index]! + step * direction[index]!;
      residual[index] = residual[index]! - step * image[index]!;
    }
    if (dot(residual, residual) <= toleranceSquared) break;
    for (let index = 0; index < dimension; index += 1) {
      const diagonal = Math.max(1e-8, report.hessian.get(index, index) + shift);
      preconditioned[index] = residual[index]! / diagonal;
    }
    const nextProduct = dot(residual, preconditioned);
    const beta = nextProduct / Math.max(1e-30, residualProduct);
    for (let index = 0; index < dimension; index += 1) {
      direction[index] = preconditioned[index]! + beta * direction[index]!;
    }
    residualProduct = nextProduct;
  }
  return report.gradients.map((_, vertex) => {
    const value = { x: solution[2 * vertex]!, y: solution[2 * vertex + 1]! };
    const magnitude = Math.hypot(value.x, value.y);
    if (magnitude > 0.45) {
      value.x *= 0.45 / magnitude;
      value.y *= 0.45 / magnitude;
    }
    return value;
  });
}

function takeStep(): boolean {
  const before = evaluateObjective(field);
  const direction = sparseNewtonDirection(before);
  let stepLength = 1;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const candidate = field.map((value, index) => ({
      x: value.x + stepLength * direction[index]!.x,
      y: value.y + stepLength * direction[index]!.y,
    }));
    const after = evaluateObjective(candidate);
    if (after.energy < before.energy - 1e-10) {
      field = candidate;
      acceptedSteps += 1;
      energyHistory.push(after.energy);
      render(after);
      return true;
    }
    stepLength *= 0.5;
  }
  stateLabel.textContent = "line search stalled";
  stateLabel.dataset.kind = "bad";
  return false;
}

function fitCanvas(canvas: HTMLCanvasElement, context: CanvasRenderingContext2D): { width: number; height: number } {
  const rect = canvas.getBoundingClientRect();
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
  }
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { width, height };
}

function drawArrow(context: CanvasRenderingContext2D, origin: Vec2, vector: Vec2, scale: number, color: string, width: number): void {
  const end = { x: origin.x + scale * vector.x, y: origin.y - scale * vector.y };
  const angle = Math.atan2(end.y - origin.y, end.x - origin.x);
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = width;
  context.beginPath();
  context.moveTo(origin.x, origin.y);
  context.lineTo(end.x, end.y);
  context.stroke();
  context.beginPath();
  context.moveTo(end.x, end.y);
  context.lineTo(end.x - 5 * Math.cos(angle - 0.5), end.y - 5 * Math.sin(angle - 0.5));
  context.lineTo(end.x - 5 * Math.cos(angle + 0.5), end.y - 5 * Math.sin(angle + 0.5));
  context.closePath();
  context.fill();
}

function drawField(): void {
  const { width, height } = fitCanvas(fieldCanvas, fieldContext);
  const padding = 28;
  const scaleX = (width - 2 * padding) / 2;
  const scaleY = (height - 2 * padding) / 2;
  const project = (position: Vec2): Vec2 => ({
    x: padding + (position.x + 1) * scaleX,
    y: padding + (1 - position.y) * scaleY,
  });
  const gradient = fieldContext.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#17102f");
  gradient.addColorStop(.55, "#0d2034");
  gradient.addColorStop(1, "#291337");
  fieldContext.fillStyle = gradient;
  fieldContext.fillRect(0, 0, width, height);

  fieldContext.strokeStyle = "rgba(176, 143, 220, .13)";
  fieldContext.lineWidth = 1;
  for (const [i, j] of edges) {
    const a = project(positions[i]!);
    const b = project(positions[j]!);
    fieldContext.beginPath();
    fieldContext.moveTo(a.x, a.y);
    fieldContext.lineTo(b.x, b.y);
    fieldContext.stroke();
  }

  const arrowScale = Math.min(scaleX, scaleY) * 0.105;
  for (let index = 0; index < positions.length; index += 1) {
    const origin = project(positions[index]!);
    drawArrow(fieldContext, origin, targets[index]!, arrowScale, "rgba(255, 95, 200, .48)", 1);
    drawArrow(fieldContext, origin, field[index]!, arrowScale, "#50ecf2", 1.6);
    fieldContext.fillStyle = "#f5ed6b";
    fieldContext.fillRect(origin.x - 1, origin.y - 1, 2, 2);
  }
  if (targetKindControl.value === "handles") {
    for (const handle of currentHandles) {
      const origin = project({ x: handle.position[0], y: handle.position[1] });
      const vector = normalized(handle.vector);
      drawArrow(fieldContext, origin, vector, arrowScale * 1.35, "#f5ed6b", 3);
      fieldContext.fillStyle = "#211949";
      fieldContext.strokeStyle = "#f5ed6b";
      fieldContext.lineWidth = 3;
      fieldContext.beginPath();
      fieldContext.arc(origin.x, origin.y, 7, 0, 2 * Math.PI);
      fieldContext.fill();
      fieldContext.stroke();
    }
  }
}

function drawHistory(): void {
  const { width, height } = fitCanvas(historyCanvas, historyContext);
  historyContext.clearRect(0, 0, width, height);
  if (energyHistory.length === 0) return;
  const logs = energyHistory.map((value) => Math.log10(Math.max(value, 1e-12)));
  const minimum = Math.min(...logs);
  const maximum = Math.max(...logs);
  const range = Math.max(1e-6, maximum - minimum);
  historyContext.strokeStyle = "rgba(117, 99, 151, .35)";
  historyContext.beginPath();
  historyContext.moveTo(0, height - 1);
  historyContext.lineTo(width, height - 1);
  historyContext.stroke();
  historyContext.strokeStyle = "#50ecf2";
  historyContext.lineWidth = 2;
  historyContext.beginPath();
  logs.forEach((value, index) => {
    const x = energyHistory.length === 1 ? 0 : (index / (energyHistory.length - 1)) * (width - 5) + 2;
    const y = 3 + ((maximum - value) / range) * (height - 8);
    if (index === 0) historyContext.moveTo(x, y);
    else historyContext.lineTo(x, y);
  });
  historyContext.stroke();
}

function render(report = evaluateObjective(field)): void {
  byId("live-energy").textContent = report.energy.toExponential(3);
  byId("live-curl").textContent = report.curlRms.toExponential(2);
  byId("live-unit").textContent = report.unitRms.toExponential(2);
  byId("live-nnz").textContent = report.hessian.expandedNonzeros().toLocaleString();
  byId("live-steps").textContent = String(acceptedSteps);
  stateLabel.textContent = "live expression active";
  stateLabel.dataset.kind = "good";
  drawField();
  drawHistory();
}

function programFromUi(): VertexElementProgram {
  const draft = structuredClone(currentProgram);
  draft.mesh.gridSize = Math.round(Number(controls["grid-size"].value));
  draft.target.kind = targetKindControl.value as VertexTargetKind;
  draft.target.dataSupport = dataSupportControl.value === "handles" ? "handles" : "field";
  if (draft.target.kind === "handles") {
    draft.target.handles = currentHandles.length > 0
      ? currentHandles.map((handle) => structuredClone(handle))
      : DEFAULT_HANDLES.map((handle) => structuredClone(handle));
  } else {
    delete draft.target.handles;
    draft.target.dataSupport = "field";
  }
  draft.parameters = {
    dataWeight: Number(controls["data-weight"].value),
    unitWeight: Number(controls["unit-weight"].value),
    integrabilityWeight: Number(controls["curl-weight"].value),
    smoothnessWeight: Number(controls["smooth-weight"].value),
    targetLength: Number(controls["target-length"].value),
  };
  expressionTerm(draft).expression = expressionEditor.value;
  return validateElementProgram(draft);
}

function saveProgram(program: VertexElementProgram): void {
  currentProgram = program;
  const formatted = formatElementProgram(program);
  programEditor.value = formatted;
  localStorage.setItem("geometry-lab:element-program", formatted);
}

function refreshPublicationLinks(program: VertexElementProgram): void {
  const urls = experimentPublicationUrls(location.href, program);
  byId<HTMLAnchorElement>("preview-blog-embed").href = urls.embed;
  byId<HTMLAnchorElement>("embed-open-full").href = urls.full;
}

function applyProgram(program: VertexElementProgram, reset = true): void {
  currentProgram = validateElementProgram(program);
  expressionEditor.value = expressionTerm(currentProgram).expression;
  controls["grid-size"].value = String(currentProgram.mesh.gridSize);
  controls["data-weight"].value = String(currentProgram.parameters.dataWeight);
  controls["unit-weight"].value = String(currentProgram.parameters.unitWeight);
  controls["curl-weight"].value = String(currentProgram.parameters.integrabilityWeight);
  controls["smooth-weight"].value = String(currentProgram.parameters.smoothnessWeight);
  controls["target-length"].value = String(currentProgram.parameters.targetLength);
  targetKindControl.value = currentProgram.target.kind;
  dataSupportControl.value = currentProgram.target.dataSupport;
  handleDesignCard.hidden = currentProgram.target.kind !== "handles";
  compiled = compileEnergyExpression(expressionTerm(currentProgram).expression);
  buildGeometry(
    currentProgram.mesh.gridSize,
    currentProgram.target.kind,
    currentProgram.target.handles ?? DEFAULT_HANDLES,
    currentProgram.target.dataSupport,
  );
  updateControlOutputs();
  saveProgram(currentProgram);
  refreshPublicationLinks(currentProgram);
  expressionStatus.textContent =
    "Accepted: local Hessians are differentiated and scattered into the sparse global Hessian.";
  expressionStatus.dataset.kind = "good";
  programStatus.textContent = "This shared file is valid and running in the browser.";
  programStatus.dataset.kind = "good";
  if (reset) resetField();
  else render();
}

function applyExpression(reset = true): boolean {
  try {
    applyProgram(programFromUi(), reset);
    return true;
  } catch (error) {
    expressionStatus.textContent = error instanceof Error ? error.message : String(error);
    expressionStatus.dataset.kind = "bad";
    stateLabel.textContent = "expression rejected";
    stateLabel.dataset.kind = "bad";
    return false;
  }
}

function encodedExperiment(program = programFromUi()): URLSearchParams {
  const parameters = new URLSearchParams();
  parameters.set("program", formatElementProgram(program).trim());
  return parameters;
}

function initialProgram(): VertexElementProgram {
  const parameters = new URLSearchParams(location.hash.slice(1));
  const shared = parameters.get("program");
  if (shared) return parseElementProgram(shared);
  const stored = localStorage.getItem("geometry-lab:element-program");
  if (stored) {
    try {
      return parseElementProgram(stored);
    } catch {
      localStorage.removeItem("geometry-lab:element-program");
    }
  }
  return structuredClone(DEFAULT_ELEMENT_PROGRAM);
}

function updateShareHash(): void {
  const url = new URL(location.href);
  url.hash = encodedExperiment().toString();
  window.history.replaceState(null, "", url);
}

function downloadText(source: string, filename: string, mimeType: string): void {
  downloadBlob(new Blob([source], { type: mimeType }), filename);
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function copyText(source: string, fallbackPrompt: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(source);
  } catch {
    window.prompt(fallbackPrompt, source);
  }
}

byId("apply-energy").addEventListener("click", () => {
  if (applyExpression()) updateShareHash();
});
byId("reset-energy").addEventListener("click", resetField);
byId("step-energy").addEventListener("click", takeStep);
byId("ten-energy").addEventListener("click", () => {
  for (let step = 0; step < 10; step += 1) if (!takeStep()) break;
});

for (const id of controlIds) {
  controls[id].addEventListener("input", () => {
    updateControlOutputs();
    if (id !== "grid-size") render();
  });
  controls[id].addEventListener("change", () => {
    try {
      applyProgram(programFromUi());
      updateShareHash();
    } catch (error) {
      expressionStatus.textContent = error instanceof Error ? error.message : String(error);
      expressionStatus.dataset.kind = "bad";
    }
  });
}

targetKindControl.addEventListener("change", () => {
  applyProgram(programFromUi());
  updateShareHash();
});
dataSupportControl.addEventListener("change", () => {
  applyProgram(programFromUi());
  updateShareHash();
});

function canvasModelPoint(event: PointerEvent): Vec2 {
  const rectangle = fieldCanvas.getBoundingClientRect();
  const padding = 28;
  const scaleX = (rectangle.width - 2 * padding) / 2;
  const scaleY = (rectangle.height - 2 * padding) / 2;
  return {
    x: Math.max(-1, Math.min(1, (event.clientX - rectangle.left - padding) / scaleX - 1)),
    y: Math.max(-1, Math.min(1, 1 - (event.clientY - rectangle.top - padding) / scaleY)),
  };
}

let draggedHandle = -1;
fieldCanvas.addEventListener("pointerdown", (event) => {
  if (targetKindControl.value !== "handles") return;
  const point = canvasModelPoint(event);
  let bestDistance = 0.18;
  currentHandles.forEach((handle, index) => {
    const distance = Math.hypot(point.x - handle.position[0], point.y - handle.position[1]);
    if (distance < bestDistance) {
      bestDistance = distance;
      draggedHandle = index;
    }
  });
  if (draggedHandle >= 0) {
    event.preventDefault();
    fieldCanvas.setPointerCapture(event.pointerId);
  }
});
fieldCanvas.addEventListener("pointermove", (event) => {
  if (draggedHandle < 0 || !fieldCanvas.hasPointerCapture(event.pointerId)) return;
  const point = canvasModelPoint(event);
  const handle = currentHandles[draggedHandle]!;
  const vector = normalized([point.x - handle.position[0], point.y - handle.position[1]]);
  handle.vector = [vector.x, vector.y];
  harmonicHandleField(currentHandles, dataSupportControl.value === "handles" ? "handles" : "field");
  render();
});
function finishHandleDrag(event: PointerEvent): void {
  if (draggedHandle < 0) return;
  if (fieldCanvas.hasPointerCapture(event.pointerId)) fieldCanvas.releasePointerCapture(event.pointerId);
  draggedHandle = -1;
  const draft = programFromUi();
  saveProgram(draft);
  refreshPublicationLinks(draft);
  updateShareHash();
  byId("handle-status").textContent = "Handle directions saved in the shared element program; the harmonic target and diagnostics are live.";
}
fieldCanvas.addEventListener("pointerup", finishHandleDrag);
fieldCanvas.addEventListener("pointercancel", finishHandleDrag);

function closestExactProjection(): void {
  const potentials = new Float64Array(positions.length);
  const degree = new Float64Array(positions.length);
  const desired = edges.map(([i, j]) => {
    degree[i] = degree[i]! + 1;
    degree[j] = degree[j]! + 1;
    const edge = { x: positions[j]!.x - positions[i]!.x, y: positions[j]!.y - positions[i]!.y };
    return 0.5 * (
      (targets[i]!.x + targets[j]!.x) * edge.x +
      (targets[i]!.y + targets[j]!.y) * edge.y
    );
  });
  const step = 0.22 / Math.max(...degree);
  for (let iteration = 0; iteration < 1800; iteration += 1) {
    const gradient = new Float64Array(potentials.length);
    edges.forEach(([i, j], edgeIndex) => {
      const residual = potentials[j]! - potentials[i]! - desired[edgeIndex]!;
      gradient[i] = gradient[i]! - residual;
      gradient[j] = gradient[j]! + residual;
    });
    let mean = 0;
    for (let index = 0; index < potentials.length; index += 1) {
      potentials[index] = potentials[index]! - step * gradient[index]!;
      mean += potentials[index]!;
    }
    mean /= potentials.length;
    for (let index = 0; index < potentials.length; index += 1) {
      potentials[index] = potentials[index]! - mean;
    }
  }
  const spacing = 2 / (gridSize - 1);
  const value = (column: number, row: number): number => potentials[row * gridSize + column]!;
  field = positions.map((_, index) => {
    const row = Math.floor(index / gridSize);
    const column = index % gridSize;
    const left = Math.max(0, column - 1);
    const right = Math.min(gridSize - 1, column + 1);
    const down = Math.max(0, row - 1);
    const up = Math.min(gridSize - 1, row + 1);
    return {
      x: (value(right, row) - value(left, row)) / ((right - left) * spacing),
      y: (value(column, up) - value(column, down)) / ((up - down) * spacing),
    };
  });
  acceptedSteps = 0;
  const report = evaluateObjective(field);
  energyHistory = [report.energy];
  render(report);
  byId("handle-status").textContent =
    "Projected the target edge 1-form onto exact differences dφ, then reconstructed vertex arrows. This is an edge-Hodge solve plus an explicit representation transfer.";
}

byId<HTMLButtonElement>("project-edge-hodge").addEventListener("click", closestExactProjection);
byId<HTMLButtonElement>("project-aligned-unit").addEventListener("click", () => {
  dataSupportControl.value = "field";
  controls["data-weight"].value = "0.5";
  controls["unit-weight"].value = "6";
  controls["curl-weight"].value = "15";
  controls["smooth-weight"].value = "0.15";
  applyProgram(programFromUi());
  byId("handle-status").textContent = "Ready: fit the harmonic target everywhere while unit length and circulation compete. Take ten Newton steps.";
});
byId<HTMLButtonElement>("project-handle-unit").addEventListener("click", () => {
  dataSupportControl.value = "handles";
  controls["data-weight"].value = "3";
  controls["unit-weight"].value = "6";
  controls["curl-weight"].value = "15";
  controls["smooth-weight"].value = "0.3";
  applyProgram(programFromUi());
  byId("handle-status").textContent = "Ready: only authored handles enter the data term; smoothness, unit length, and circulation determine the field between them.";
});

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-preset]")) {
  button.addEventListener("click", () => {
    const preset = button.dataset.preset;
    const next = structuredClone(DEFAULT_ELEMENT_PROGRAM);
    const values = preset === "curl"
      ? { data: 0.25, unit: 1, curl: 30, smooth: 0.3 }
      : preset === "data"
        ? { data: 2, unit: 0, curl: 0, smooth: 0 }
        : { data: 0.35, unit: 6, curl: 15, smooth: 0.15 };
    next.parameters.dataWeight = values.data;
    next.parameters.unitWeight = values.unit;
    next.parameters.integrabilityWeight = values.curl;
    next.parameters.smoothnessWeight = values.smooth;
    next.target.kind = preset === "data" ? "constant" : "rotating";
    applyProgram(next);
    updateShareHash();
  });
}

byId("share-energy").addEventListener("click", async () => {
  if (!applyExpression(false)) return;
  updateShareHash();
  const urls = experimentPublicationUrls(location.href, programFromUi());
  await copyText(urls.full, "Copy this experiment URL");
  expressionStatus.textContent = "Copied a static URL containing the complete element program.";
});

byId("copy-blog-embed").addEventListener("click", async () => {
  if (!applyExpression(false)) return;
  updateShareHash();
  const source = generateBlogEmbedHtml(location.href, programFromUi());
  await copyText(source, "Copy this blog embed HTML");
  const status = byId<HTMLParagraphElement>("publish-status");
  status.textContent = "Copied the iframe and full-lab fallback link.";
});

byId("apply-program").addEventListener("click", () => {
  try {
    applyProgram(parseElementProgram(programEditor.value));
    updateShareHash();
  } catch (error) {
    programStatus.textContent = error instanceof Error ? error.message : String(error);
    programStatus.dataset.kind = "bad";
  }
});

byId("import-program").addEventListener("click", () => programFileInput.click());
programFileInput.addEventListener("change", async () => {
  const file = programFileInput.files?.[0];
  if (!file) return;
  try {
    applyProgram(parseElementProgram(await file.text()));
    updateShareHash();
  } catch (error) {
    programStatus.textContent = error instanceof Error ? error.message : String(error);
    programStatus.dataset.kind = "bad";
  } finally {
    programFileInput.value = "";
  }
});

byId("download-program").addEventListener("click", () => {
  try {
    const program = programFromUi();
    downloadText(formatElementProgram(program), `${program.id}.element-program.json`, "application/json");
  } catch (error) {
    programStatus.textContent = error instanceof Error ? error.message : String(error);
    programStatus.dataset.kind = "bad";
  }
});

byId("download-tinyad").addEventListener("click", () => {
  try {
    const program = programFromUi();
    downloadText(
      generateTinyAdElementProgramHeader(program),
      "GeneratedElementProgram.hh",
      "text/x-c++hdr",
    );
    expressionStatus.textContent = "Downloaded the generated TinyAD callback.";
    expressionStatus.dataset.kind = "good";
  } catch (error) {
    expressionStatus.textContent = error instanceof Error ? error.message : String(error);
    expressionStatus.dataset.kind = "bad";
  }
});

byId("copy-python").addEventListener("click", async () => {
  try {
    const source = generatePythonElementProgram(programFromUi());
    await navigator.clipboard.writeText(source);
    expressionStatus.textContent = "Copied the generated Python energy function.";
    expressionStatus.dataset.kind = "good";
  } catch (error) {
    expressionStatus.textContent = error instanceof Error ? error.message : String(error);
    expressionStatus.dataset.kind = "bad";
  }
});

byId("download-research-bundle").addEventListener("click", async () => {
  try {
    const program = programFromUi();
    const { buildResearchBundle } = await import("./research-bundle");
    downloadBlob(
      await buildResearchBundle(program, { pageUrl: location.href }),
      `${program.id}-research-source.zip`,
    );
    expressionStatus.textContent = "Downloaded the shared file, blog embed, TinyAD, and Python source.";
    expressionStatus.dataset.kind = "good";
  } catch (error) {
    expressionStatus.textContent = error instanceof Error ? error.message : String(error);
    expressionStatus.dataset.kind = "bad";
  }
});

byId("download-blog-kit").addEventListener("click", async () => {
  const status = byId<HTMLParagraphElement>("publish-status");
  try {
    const program = programFromUi();
    const { buildResearchBundle } = await import("./research-bundle");
    downloadBlob(
      await buildResearchBundle(program, { pageUrl: location.href }),
      `${program.id}-publication-kit.zip`,
    );
    status.textContent = "Downloaded iframe, linked fallback, shared program, and generated source.";
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
  }
});

type Complex = [number, number];
const complexSquare = ([real, imaginary]: Complex): Complex => [real * real - imaginary * imaginary, 2 * real * imaginary];
const complexMultiply = (a: Complex, b: Complex): Complex => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const complexAdd = (a: Complex, b: Complex): Complex => [a[0] + b[0], a[1] + b[1]];
const complexDifference = (a: Complex, b: Complex): Complex => [a[0] - b[0], a[1] - b[1]];
const complexNormSquared = (value: Complex): number => value[0] ** 2 + value[1] ** 2;
const direction = (degrees: number): Complex => {
  const radians = degrees * Math.PI / 180;
  return [Math.cos(radians), Math.sin(radians)];
};

const polycurlCanvas = byId<HTMLCanvasElement>("polycurl-canvas");
const polycurlContext = context2d(polycurlCanvas);
const frameRotation = byId<HTMLInputElement>("frame-rotation");
const frameSkew = byId<HTMLInputElement>("frame-skew");

function frameCoefficients(alpha: Complex, beta: Complex): { c0: Complex; c2: Complex; edge0: number; edge2: number } {
  const alphaSquared = complexSquare(alpha);
  const betaSquared = complexSquare(beta);
  return {
    c0: complexMultiply(alphaSquared, betaSquared),
    c2: complexAdd(alphaSquared, betaSquared).map((value) => -value) as Complex,
    edge0: alpha[1] ** 2 * beta[1] ** 2,
    edge2: -(alpha[1] ** 2 + beta[1] ** 2),
  };
}

function drawFrame(origin: Vec2, angles: [number, number], color: string): void {
  for (const angle of angles) {
    const vector = direction(angle);
    polycurlContext.strokeStyle = color;
    polycurlContext.lineWidth = 3;
    polycurlContext.beginPath();
    polycurlContext.moveTo(origin.x - 38 * vector[0], origin.y + 38 * vector[1]);
    polycurlContext.lineTo(origin.x + 38 * vector[0], origin.y - 38 * vector[1]);
    polycurlContext.stroke();
  }
  polycurlContext.fillStyle = "#f5ed6b";
  polycurlContext.beginPath();
  polycurlContext.arc(origin.x, origin.y, 4, 0, 2 * Math.PI);
  polycurlContext.fill();
}

function drawPolyCurl(): void {
  const { width, height } = fitCanvas(polycurlCanvas, polycurlContext);
  const rotation = Number(frameRotation.value);
  const skew = Number(frameSkew.value);
  byId<HTMLOutputElement>("frame-rotation-output").value = `${rotation}°`;
  byId<HTMLOutputElement>("frame-skew-output").value = `${skew}°`;
  polycurlContext.clearRect(0, 0, width, height);
  const midpoint = width / 2;
  const top = 22;
  const bottom = height - 22;
  polycurlContext.fillStyle = "#eee3ff";
  polycurlContext.beginPath();
  polycurlContext.moveTo(midpoint, top);
  polycurlContext.lineTo(midpoint, bottom);
  polycurlContext.lineTo(24, height / 2);
  polycurlContext.closePath();
  polycurlContext.fill();
  polycurlContext.fillStyle = "#e2fbfb";
  polycurlContext.beginPath();
  polycurlContext.moveTo(midpoint, top);
  polycurlContext.lineTo(width - 24, height / 2);
  polycurlContext.lineTo(midpoint, bottom);
  polycurlContext.closePath();
  polycurlContext.fill();
  polycurlContext.strokeStyle = "#5c4779";
  polycurlContext.lineWidth = 2;
  polycurlContext.beginPath();
  polycurlContext.moveTo(midpoint, top);
  polycurlContext.lineTo(midpoint, bottom);
  polycurlContext.stroke();

  const leftAngles: [number, number] = [25, 110];
  const rightAngles: [number, number] = [25 + rotation, 110 + rotation + skew];
  drawFrame({ x: midpoint * 0.52, y: height / 2 }, leftAngles, "#9a55d0");
  drawFrame({ x: midpoint + midpoint * 0.48, y: height / 2 }, rightAngles, "#0599a9");

  const left = frameCoefficients(direction(leftAngles[0]), direction(leftAngles[1]));
  const right = frameCoefficients(direction(rightAngles[0]), direction(rightAngles[1]));
  const smoothResidual = Math.sqrt(
    complexNormSquared(complexDifference(left.c0, right.c0)) +
    complexNormSquared(complexDifference(left.c2, right.c2)),
  );
  const edgeResidual = Math.hypot(left.edge0 - right.edge0, left.edge2 - right.edge2);
  byId("polycurl-smooth").textContent = smoothResidual.toExponential(2);
  byId("polycurl-edge").textContent = edgeResidual.toExponential(2);
}

frameRotation.addEventListener("input", drawPolyCurl);
frameSkew.addEventListener("input", drawPolyCurl);

const stripeCanvas = byId<HTMLCanvasElement>("stripe-canvas");
const stripeContext = context2d(stripeCanvas);
const stripeField = byId<HTMLSelectElement>("stripe-field");
const stripeFrequency = byId<HTMLInputElement>("stripe-frequency");
const stripeResolution = byId<HTMLSelectElement>("stripe-resolution");
let stripeModel = new PeriodicStripeModel(
  Number(stripeResolution.value),
  stripeField.value as StripeFieldKind,
  Number(stripeFrequency.value),
);

function sampledHandleDirections(resolution: number): Vec2[] {
  const directions: Vec2[] = [];
  for (let row = 0; row < resolution; row += 1) {
    for (let column = 0; column < resolution; column += 1) {
      const sourceColumn = Math.round(column * (gridSize - 1) / (resolution - 1));
      const sourceRow = Math.round(row * (gridSize - 1) / (resolution - 1));
      directions.push(normalized([
        targets[sourceRow * gridSize + sourceColumn]!.x,
        targets[sourceRow * gridSize + sourceColumn]!.y,
      ]));
    }
  }
  return directions;
}

function updateStripeSampling(): void {
  const resolution = Number(stripeResolution.value);
  const frequency = Number(stripeFrequency.value);
  const report = stripeSamplingReport(resolution, frequency);
  const badge = byId("stripe-sampling");
  badge.dataset.quality = report.quality;
  badge.innerHTML = `<strong>${report.cellsPerStripe.toFixed(1)} cells / stripe</strong><span>${report.quality}${report.quality === "well-resolved" ? " · ready for the final solve" : " · choose a finer grid or lower frequency"}</span>`;
  byId<HTMLOutputElement>("stripe-resolution-output").value = `${resolution} × ${resolution}`;
}

function drawStripePattern(): void {
  const { width, height } = fitCanvas(stripeCanvas, stripeContext);
  stripeContext.clearRect(0, 0, width, height);
  const n = stripeModel.resolution;
  const side = Math.min(width, height) - 28;
  const left = (width - side) / 2;
  const top = (height - side) / 2;
  const cell = side / n;
  const report = stripeModel.report();
  for (let row = 0; row < n; row += 1) {
    for (let column = 0; column < n; column += 1) {
      const index = row * n + column;
      const phase = stripeModel.phase[index]!;
      const angle = Math.atan2(phase.im, phase.re);
      const wave = 0.5 + 0.5 * Math.cos(angle);
      const amplitude = Math.hypot(phase.re, phase.im) / Math.max(1e-12, report.maxAmplitude);
      const bright = [246, 223, 111];
      const dark = [38, 21, 77];
      const mix = (0.16 + 0.84 * wave) * (0.22 + 0.78 * amplitude);
      const red = Math.round(dark[0]! + mix * (bright[0]! - dark[0]!));
      const green = Math.round(dark[1]! + mix * (bright[1]! - dark[1]!));
      const blue = Math.round(dark[2]! + mix * (bright[2]! - dark[2]!));
      stripeContext.fillStyle = `rgb(${red},${green},${blue})`;
      stripeContext.fillRect(left + column * cell, top + (n - row - 1) * cell, cell + 0.7, cell + 0.7);
    }
  }
  const stride = 3;
  stripeContext.lineWidth = 1.3;
  stripeContext.strokeStyle = "rgba(61,225,238,.84)";
  for (let row = 0; row < n; row += stride) {
    for (let column = 0; column < n; column += stride) {
      const index = row * n + column;
      const vector = stripeModel.directions[index]!;
      const x = left + (column + 0.5) * cell;
      const y = top + (n - row - 0.5) * cell;
      const length = cell * 1.05;
      stripeContext.beginPath();
      stripeContext.moveTo(x - vector.x * length, y + vector.y * length);
      stripeContext.lineTo(x + vector.x * length, y - vector.y * length);
      stripeContext.stroke();
    }
  }
  stripeContext.strokeStyle = "rgba(255,255,255,.36)";
  stripeContext.strokeRect(left, top, side, side);
  byId("stripe-energy").textContent = report.energy.toExponential(2);
  byId("stripe-residual").textContent = report.residualRms.toExponential(2);
  byId("stripe-amplitude").textContent = report.minAmplitude.toExponential(2);
  byId("stripe-iterations").textContent = report.iterations.toLocaleString();
  byId("stripe-state").textContent = `${stripeModel.fieldKind} · ${stripeModel.resolution}² grid · ${stripeModel.frequency.toFixed(1)} turns`;
}

function resetStripePattern(): void {
  const resolution = Number(stripeResolution.value);
  stripeModel = new PeriodicStripeModel(
    resolution,
    stripeField.value as StripeFieldKind,
    Number(stripeFrequency.value),
    stripeField.value === "custom" ? sampledHandleDirections(resolution) : undefined,
  );
  byId<HTMLOutputElement>("stripe-frequency-output").value = Number(stripeFrequency.value).toFixed(1);
  updateStripeSampling();
  drawStripePattern();
}

stripeField.addEventListener("change", () => {
  resetStripePattern();
});
stripeFrequency.addEventListener("input", () => {
  byId<HTMLOutputElement>("stripe-frequency-output").value = Number(stripeFrequency.value).toFixed(1);
  updateStripeSampling();
});
stripeFrequency.addEventListener("change", resetStripePattern);
stripeResolution.addEventListener("change", resetStripePattern);
byId<HTMLButtonElement>("stripe-reset").addEventListener("click", resetStripePattern);
byId<HTMLButtonElement>("stripe-step").addEventListener("click", () => {
  stripeModel.step(100);
  drawStripePattern();
});
byId<HTMLButtonElement>("stripe-solve").addEventListener("click", () => {
  stripeModel.step(800);
  drawStripePattern();
});
byId<HTMLButtonElement>("send-handles-to-stripes").addEventListener("click", () => {
  const customOption = stripeField.querySelector<HTMLOptionElement>('option[value="custom"]')!;
  customOption.disabled = false;
  stripeField.value = "custom";
  resetStripePattern();
  stripeModel.step(800);
  drawStripePattern();
  document.getElementById("stripe-projection")?.scrollIntoView({ behavior: "smooth", block: "start" });
});

new ResizeObserver(() => {
  drawField();
  drawHistory();
  drawPolyCurl();
  drawStripePattern();
}).observe(document.body);

applyProgram(initialProgram());
drawPolyCurl();
drawStripePattern();
