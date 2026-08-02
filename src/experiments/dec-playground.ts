import "./dec-playground.css";

import {
  applyDecOperator,
  buildHexDecComplex,
  buildTriangularPatchDecComplex,
  decOperator,
  formId,
  formName,
  formSupportDegree,
  naturalEnergy,
  seedDecForm,
  type DecFormState,
  type DecOperator,
  type DecOperatorKind,
  type FormDegree,
  type FormSide,
  type Point2,
} from "./dec-complex";

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}.`);
  return element as T;
}

function cloneForm(form: DecFormState): DecFormState {
  return { side: form.side, degree: form.degree, values: [...form.values] };
}

let complex = buildHexDecComplex();
let meshScale: "teaching" | "patch" = "teaching";
const canvas = byId<HTMLCanvasElement>("dec-canvas");
function context2d(value: HTMLCanvasElement): CanvasRenderingContext2D {
  const result = value.getContext("2d");
  if (!result) throw new Error("Canvas 2D is unavailable.");
  return result;
}
const context = context2d(canvas);

type SeedPreset = "hill" | "linear" | "alternating";
type Lens = "picture" | "cochain" | "matrix" | "energy";

interface OperationRecord {
  operator: DecOperator;
  input: DecFormState;
  output: DecFormState;
}

interface Snapshot {
  form: DecFormState;
  path: Array<{ name: string; via?: string }>;
  lastOperation?: OperationRecord;
  selectedSupport: number;
  preset: SeedPreset;
}

const FORM_DETAILS: Record<string, {
  subtitle: string;
  heading: string;
  copy: string;
  support: string;
  coefficient: string;
  orientation: string;
}> = {
  "primal-0": {
    subtitle: "one number at every vertex",
    heading: "Sample a function at vertices",
    copy: "A primal 0-form is the discrete analogue of a scalar function. Painting a vertex changes one sample; no area or length has been folded into that number yet.",
    support: "primal vertices",
    coefficient: "a point sample φᵢ",
    orientation: "vertices do not need an orientation",
  },
  "primal-1": {
    subtitle: "one oriented integral on every edge",
    heading: "Measure along oriented edges",
    copy: "A primal 1-form stores an integral, not a two-component arrow. Reversing an edge reverses the sign of its coefficient.",
    support: "oriented primal edges",
    coefficient: "an approximation of ∫ₑ α",
    orientation: "arrow from the stored tail to head",
  },
  "primal-2": {
    subtitle: "one oriented integral on every triangle",
    heading: "Accumulate over primal faces",
    copy: "A primal 2-form assigns a signed amount to each oriented triangle. Applying d to an edge 1-form produces its boundary circulation here.",
    support: "counterclockwise primal triangles",
    coefficient: "an approximation of ∫𝑓 β",
    orientation: "the triangle boundary is counterclockwise",
  },
  "dual-0": {
    subtitle: "one sample at every dual vertex",
    heading: "Move samples to face centers",
    copy: "Each dual vertex corresponds to one primal triangle. The Hodge star converts a primal face integral into a dual point value using the triangle area.",
    support: "dual vertices at triangle circumcenters",
    coefficient: "a dual point sample",
    orientation: "dual vertices do not need an orientation",
  },
  "dual-1": {
    subtitle: "one integral across every primal edge",
    heading: "Measure across primal edges",
    copy: "A dual edge crosses its paired primal edge. The 1-form Hodge star scales by dual-edge length divided by primal-edge length.",
    support: "oriented circumcentric dual edges",
    coefficient: "an approximation of an integral across e",
    orientation: "chosen consistently with the transposed incidence",
  },
  "dual-2": {
    subtitle: "one integral around every primal vertex",
    heading: "Accumulate over dual cells",
    copy: "A dual 2-cell surrounds a primal vertex. The 0-form Hodge star multiplies a vertex sample by its dual area.",
    support: "dual cells around primal vertices",
    coefficient: "a scalar sample times dual area",
    orientation: "dual cell boundaries follow the surface orientation",
  },
};

let form = seedDecForm(complex, "primal", 0, "hill");
let preset: SeedPreset = "hill";
let lens: Lens = "picture";
let selectedSupport = 0;
let path: Array<{ name: string; via?: string }> = [{ name: formName(form) }];
let lastOperation: OperationRecord | undefined;
const undoStack: Snapshot[] = [];

function snapshot(): Snapshot {
  return {
    form: cloneForm(form),
    path: path.map((step) => ({ ...step })),
    lastOperation: lastOperation && {
      operator: lastOperation.operator,
      input: cloneForm(lastOperation.input),
      output: cloneForm(lastOperation.output),
    },
    selectedSupport,
    preset,
  };
}

function restore(value: Snapshot): void {
  form = cloneForm(value.form);
  path = value.path.map((step) => ({ ...step }));
  lastOperation = value.lastOperation;
  selectedSupport = value.selectedSupport;
  preset = value.preset;
  render();
}

function setForm(side: FormSide, degree: FormDegree): void {
  undoStack.push(snapshot());
  form = seedDecForm(complex, side, degree, preset);
  selectedSupport = 0;
  lastOperation = undefined;
  path = [{ name: formName(form) }];
  render();
}

function applyOperator(kind: DecOperatorKind): void {
  const operator = decOperator(complex, form, kind);
  if (!operator) return;
  undoStack.push(snapshot());
  const input = cloneForm(form);
  form = applyDecOperator(complex, form, kind);
  const output = cloneForm(form);
  lastOperation = { operator, input, output };
  selectedSupport = Math.min(selectedSupport, form.values.length - 1);
  path.push({ name: formName(form), via: kind === "d" ? "d" : "⋆" });
  render();
}

function setPreset(next: SeedPreset): void {
  undoStack.push(snapshot());
  preset = next;
  form = seedDecForm(complex, form.side, form.degree, preset);
  path = [{ name: formName(form) }];
  selectedSupport = 0;
  lastOperation = undefined;
  render();
}

function coefficientLabel(index: number): string {
  const support = formSupportDegree(form);
  return `${support === 0 ? "v" : support === 1 ? "e" : "f"}${index}`;
}

function fitCanvas(): { width: number; height: number; scale: number; center: Point2 } {
  const rect = canvas.getBoundingClientRect();
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
  }
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { width, height, scale: Math.min(width, height) * 0.34, center: [width / 2, height / 2] };
}

function project(point: Point2, layout: ReturnType<typeof fitCanvas>): Point2 {
  return [layout.center[0] + layout.scale * point[0], layout.center[1] - layout.scale * point[1]];
}

function unproject(point: Point2, layout: ReturnType<typeof fitCanvas>): Point2 {
  return [(point[0] - layout.center[0]) / layout.scale, -(point[1] - layout.center[1]) / layout.scale];
}

function signedColor(value: number, maximum: number, alpha = 1): string {
  const amount = Math.min(1, Math.abs(value) / Math.max(maximum, 1e-8));
  if (amount < 1e-3) return `rgba(139, 127, 158, ${0.3 * alpha})`;
  return value > 0
    ? `rgba(255, 95, 200, ${(0.3 + 0.7 * amount) * alpha})`
    : `rgba(54, 220, 232, ${(0.3 + 0.7 * amount) * alpha})`;
}

function pathPolygon(points: readonly Point2[], layout: ReturnType<typeof fitCanvas>): void {
  context.beginPath();
  points.forEach((point, index) => {
    const [x, y] = project(point, layout);
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.closePath();
}

function drawArrow(a: Point2, b: Point2, color: string, width: number): void {
  const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = width;
  context.beginPath();
  context.moveTo(a[0], a[1]);
  context.lineTo(b[0], b[1]);
  context.stroke();
  context.beginPath();
  context.moveTo(b[0], b[1]);
  context.lineTo(b[0] - 7 * Math.cos(angle - 0.45), b[1] - 7 * Math.sin(angle - 0.45));
  context.lineTo(b[0] - 7 * Math.cos(angle + 0.45), b[1] - 7 * Math.sin(angle + 0.45));
  context.closePath();
  context.fill();
}

function orientedDualSegment(edgeIndex: number): [Point2, Point2] {
  const edge = complex.edges[edgeIndex]!;
  if (edge.faces.length === 2) {
    const negative = edge.faces.find((faceIndex) => complex.d1[faceIndex]![edgeIndex]! < 0);
    const positive = edge.faces.find((faceIndex) => complex.d1[faceIndex]![edgeIndex]! > 0);
    if (negative !== undefined && positive !== undefined) {
      return [complex.faces[negative]!.circumcenter, complex.faces[positive]!.circumcenter];
    }
  }
  const face = edge.faces[0]!;
  return complex.d1[face]![edgeIndex]! > 0
    ? [edge.midpoint, complex.faces[face]!.circumcenter]
    : [complex.faces[face]!.circumcenter, edge.midpoint];
}

function drawLabel(point: Point2, text: string, color = "#f8f2ff"): void {
  context.fillStyle = color;
  context.font = '8px "SFMono-Regular", Consolas, monospace';
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, point[0], point[1]);
}

function drawMesh(): void {
  const layout = fitCanvas();
  const gradient = context.createLinearGradient(0, 0, layout.width, layout.height);
  gradient.addColorStop(0, "#15102d");
  gradient.addColorStop(0.55, "#10263a");
  gradient.addColorStop(1, "#2c1438");
  context.fillStyle = gradient;
  context.fillRect(0, 0, layout.width, layout.height);
  const maximum = Math.max(1e-8, ...form.values.map(Math.abs));
  const support = formSupportDegree(form);
  const showEveryLabel = complex.vertices.length <= 12;

  if (support === 2) {
    const cells = form.side === "primal" ? complex.faces.map((face) => face.vertices.map((index) => complex.vertices[index]!)) : complex.faces.map((face) => [face.circumcenter]);
    if (form.side === "primal") {
      cells.forEach((points, index) => {
        pathPolygon(points, layout);
        context.fillStyle = signedColor(form.values[index]!, maximum, 0.62);
        context.fill();
      });
    }
  }
  if (form.side === "dual" && form.degree === 2) {
    complex.dualCells.forEach((cell, index) => {
      pathPolygon(cell, layout);
      context.fillStyle = signedColor(form.values[index]!, maximum, 0.55);
      context.fill();
    });
  }

  context.save();
  context.setLineDash([5, 5]);
  context.lineWidth = form.side === "dual" ? 1.8 : 1;
  context.strokeStyle = form.side === "dual" ? "rgba(245,237,107,.78)" : "rgba(245,237,107,.25)";
  for (let edge = 0; edge < complex.edges.length; edge += 1) {
    const segment = orientedDualSegment(edge);
    const a = project(segment[0], layout);
    const b = project(segment[1], layout);
    context.beginPath();
    context.moveTo(a[0], a[1]);
    context.lineTo(b[0], b[1]);
    context.stroke();
  }
  context.restore();

  context.lineWidth = form.side === "primal" ? 1.8 : 1;
  context.strokeStyle = form.side === "primal" ? "rgba(238,229,255,.85)" : "rgba(238,229,255,.28)";
  for (const edge of complex.edges) {
    const a = project(complex.vertices[edge.tail]!, layout);
    const b = project(complex.vertices[edge.head]!, layout);
    context.beginPath();
    context.moveTo(a[0], a[1]);
    context.lineTo(b[0], b[1]);
    context.stroke();
  }

  if (form.side === "primal" && form.degree === 1) {
    complex.edges.forEach((edge, index) => {
      const a = project(complex.vertices[edge.tail]!, layout);
      const b = project(complex.vertices[edge.head]!, layout);
      const margin = 0.15;
      const start: Point2 = [a[0] + margin * (b[0] - a[0]), a[1] + margin * (b[1] - a[1])];
      const end: Point2 = [b[0] - margin * (b[0] - a[0]), b[1] - margin * (b[1] - a[1])];
      drawArrow(start, end, signedColor(form.values[index]!, maximum), index === selectedSupport ? 5 : 2.5);
      if (showEveryLabel || index === selectedSupport) {
        drawLabel([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - 10], form.values[index]!.toFixed(2));
      }
    });
  } else if (form.side === "dual" && form.degree === 1) {
    complex.edges.forEach((_, index) => {
      const segment = orientedDualSegment(index).map((point) => project(point, layout)) as [Point2, Point2];
      drawArrow(segment[0], segment[1], signedColor(form.values[index]!, maximum), index === selectedSupport ? 5 : 2.5);
      if (showEveryLabel || index === selectedSupport) {
        drawLabel([(segment[0][0] + segment[1][0]) / 2, (segment[0][1] + segment[1][1]) / 2 - 9], form.values[index]!.toFixed(2), "#fff6bd");
      }
    });
  } else if (form.side === "primal" && form.degree === 0) {
    complex.vertices.forEach((vertex, index) => {
      const p = project(vertex, layout);
      context.beginPath();
      context.arc(p[0], p[1], index === selectedSupport ? 14 : 10, 0, 2 * Math.PI);
      context.fillStyle = signedColor(form.values[index]!, maximum);
      context.fill();
      context.strokeStyle = index === selectedSupport ? "#f5ed6b" : "#f9f1ff";
      context.lineWidth = index === selectedSupport ? 3 : 1;
      context.stroke();
      if (showEveryLabel || index === selectedSupport) drawLabel(p, form.values[index]!.toFixed(2), "#211942");
    });
  } else if (form.side === "dual" && form.degree === 0) {
    complex.faces.forEach((face, index) => {
      const p = project(face.circumcenter, layout);
      context.beginPath();
      context.arc(p[0], p[1], index === selectedSupport ? 14 : 10, 0, 2 * Math.PI);
      context.fillStyle = signedColor(form.values[index]!, maximum);
      context.fill();
      context.strokeStyle = index === selectedSupport ? "#f5ed6b" : "#f9f1ff";
      context.lineWidth = index === selectedSupport ? 3 : 1;
      context.stroke();
      if (showEveryLabel || index === selectedSupport) drawLabel(p, form.values[index]!.toFixed(2), "#211942");
    });
  } else {
    const points = form.side === "primal"
      ? complex.faces.map((face) => face.centroid)
      : complex.vertices;
    points.forEach((point, index) => {
      const p = project(point, layout);
      if (showEveryLabel || index === selectedSupport) {
        drawLabel(p, form.values[index]!.toFixed(2), index === selectedSupport ? "#f5ed6b" : "#fff");
      }
      if (index === selectedSupport) {
        context.beginPath();
        context.arc(p[0], p[1], 18, 0, 2 * Math.PI);
        context.strokeStyle = "#f5ed6b";
        context.lineWidth = 2;
        context.stroke();
      }
    });
  }
}

function distanceToSegment(point: Point2, a: Point2, b: Point2): number {
  const ab: Point2 = [b[0] - a[0], b[1] - a[1]];
  const lengthSquared = ab[0] ** 2 + ab[1] ** 2;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1,
    ((point[0] - a[0]) * ab[0] + (point[1] - a[1]) * ab[1]) / lengthSquared));
  return Math.hypot(point[0] - (a[0] + t * ab[0]), point[1] - (a[1] + t * ab[1]));
}

function nearestSupport(point: Point2): number {
  const support = formSupportDegree(form);
  const distances = support === 0
    ? complex.vertices.map((vertex) => Math.hypot(point[0] - vertex[0], point[1] - vertex[1]))
    : support === 1
      ? form.side === "dual"
        ? complex.edges.map((_, index) => {
          const segment = orientedDualSegment(index);
          return distanceToSegment(point, segment[0], segment[1]);
        })
        : complex.edges.map((edge) => distanceToSegment(point, complex.vertices[edge.tail]!, complex.vertices[edge.head]!))
      : complex.faces.map((face) => Math.hypot(point[0] - face.centroid[0], point[1] - face.centroid[1]));
  return distances.reduce((best, value, index) => value < distances[best]! ? index : best, 0);
}

function paintSupport(index: number): void {
  if (index < 0 || index >= form.values.length) return;
  undoStack.push(snapshot());
  selectedSupport = index;
  form.values[index] = Number(byId<HTMLInputElement>("brush-value").value);
  preset = "alternating";
  lastOperation = undefined;
  path = [{ name: formName(form) }, { name: "painted", via: "edit" }];
  render();
}

function renderPath(): void {
  const root = byId("operator-path");
  root.replaceChildren();
  path.forEach((step, index) => {
    if (index > 0) {
      const arrow = document.createElement("i");
      arrow.textContent = `—${step.via}→`;
      root.append(arrow);
    }
    const node = document.createElement("b");
    node.textContent = step.name;
    root.append(node);
  });
  const lastTwo = path.slice(-2);
  const exactness = byId("exactness-note");
  if (lastTwo.length === 2 && lastTwo.every((step) => step.via === "d")) {
    const maximum = Math.max(0, ...form.values.map(Math.abs));
    exactness.textContent = `d ∘ d = 0: the largest remaining coefficient is ${maximum.toExponential(1)}. A boundary has no boundary.`;
  } else {
    exactness.textContent = "Try applying d twice. The second result must vanish, independent of metric or triangle shape.";
  }
}

function renderPicture(): void {
  const details = FORM_DETAILS[formId(form)]!;
  byId("picture-heading").textContent = details.heading;
  byId("picture-copy").textContent = details.copy;
  byId("meaning-support").textContent = details.support;
  byId("meaning-coefficient").textContent = details.coefficient;
  byId("meaning-orientation").textContent = details.orientation;
}

function renderCochain(): void {
  const root = byId("cochain-values");
  root.replaceChildren();
  form.values.forEach((value, index) => {
    const button = document.createElement("button");
    button.type = "button";
    if (index === selectedSupport) button.classList.add("selected");
    button.textContent = coefficientLabel(index);
    const number = document.createElement("span");
    number.textContent = value.toFixed(3);
    button.append(number);
    button.addEventListener("click", () => {
      selectedSupport = index;
      byId<HTMLInputElement>("support-index").value = String(index);
      renderCochain();
      drawMesh();
    });
    root.append(button);
  });
  byId("selected-coefficient").textContent =
    `${coefficientLabel(selectedSupport)} = ${form.values[selectedSupport]!.toFixed(4)} · array index ${selectedSupport}`;
}

function renderMatrix(): void {
  const operation = lastOperation?.operator ?? decOperator(complex, form, "d") ?? decOperator(complex, form, "star")!;
  const matrix = operation.matrix;
  const rows = matrix.length;
  const columns = matrix[0]?.length ?? 0;
  const nonzeros = matrix.flat().filter((value) => Math.abs(value) > 1e-12).length;
  byId("matrix-heading").textContent = lastOperation
    ? `${lastOperation.operator.label} just moved the cochain`
    : `${operation.label} is available from here`;
  byId("matrix-copy").textContent = operation.kind === "d"
    ? "Every ±1 comes only from orientation and adjacency. No edge length, angle, or area appears in an exterior derivative."
    : "The Hodge star is diagonal in this circumcentric DEC example. Its entries contain the primal/dual length or area ratios—the metric information.";
  byId("matrix-shape").textContent = `${rows} × ${columns}`;
  byId("matrix-nnz").textContent = `${nonzeros} nonzeros`;
  const root = byId("matrix-grid");
  root.replaceChildren();
  root.style.gridTemplateColumns = `repeat(${columns}, minmax(18px, 1fr))`;
  matrix.forEach((row, rowIndex) => row.forEach((value, columnIndex) => {
    const cell = document.createElement("span");
    cell.className = `matrix-cell ${value > 1e-12 ? "positive" : value < -1e-12 ? "negative" : "zero"}`;
    cell.textContent = Math.abs(value) < 1e-12 ? "" : Math.abs(value - Math.round(value)) < 1e-6 ? String(Math.round(value)) : value.toFixed(1);
    cell.setAttribute("role", "cell");
    cell.setAttribute("aria-label", `row ${rowIndex}, column ${columnIndex}: ${value}`);
    root.append(cell);
  }));
  const inputName = lastOperation ? formName(lastOperation.input) : formName(form);
  const outputName = lastOperation ? formName(lastOperation.output) : formName(operation.output);
  byId("matrix-equation").textContent = `${outputName} = ${operation.label} · ${inputName}`;
}

function energyCode(): string {
  if (form.side === "primal" && form.degree === 0) {
    return `// one edge: d₀φ = φ_head - φ_tail
const auto tail = element.variables(edge.tail);
const auto head = element.variables(edge.head);
const Scalar residual = head[0] - tail[0];
return 0.5 * weight * residual * residual;`;
  }
  if (form.side === "primal" && form.degree === 1) {
    return `// one triangle: d₁α is boundary circulation
const Scalar circulation =
    sign0 * alpha0 + sign1 * alpha1 + sign2 * alpha2;
return 0.5 * circulation * circulation / face_area;`;
  }
  if (form.side === "dual" && form.degree < 2) {
    return `// dual d is assembled from the transposed primal incidence
const Scalar residual = dual_d_times(local_coefficients);
return 0.5 * metric_weight * residual * residual;`;
  }
  return `// a top-degree mass term
const Scalar coefficient = element.variables(simplex)[0];
return 0.5 * metric_weight * coefficient * coefficient;`;
}

function renderEnergy(): void {
  const energy = naturalEnergy(complex, form);
  byId("energy-formula").textContent = energy.formula;
  byId("natural-energy").textContent = energy.value.toExponential(3);
  byId("energy-code").textContent = energyCode();
  byId("energy-copy").textContent = form.degree < 2
    ? "First form a local derivative residual. Then choose its metric. Squaring without the Hodge weights quietly changes the continuum quantity and its resolution scaling."
    : "At top degree there is no further exterior derivative in two dimensions, so the natural quadratic shown here is a metric-weighted mass term.";
}

function render(): void {
  const details = FORM_DETAILS[formId(form)]!;
  byId("form-kicker").textContent = `${form.side.toUpperCase()} COCHAIN`;
  byId("form-title").textContent = formName(form);
  byId("form-subtitle").textContent = details.subtitle;
  byId("support-count").textContent = `${form.values.length} coefficients`;
  byId("cochain-norm").textContent = Math.hypot(...form.values).toFixed(3);
  byId("mesh-scale-note").textContent = meshScale === "teaching"
    ? "7 vertices · every coefficient labeled"
    : `${complex.vertices.length} vertices · selected coefficient labeled`;
  const d = decOperator(complex, form, "d");
  byId<HTMLButtonElement>("apply-d").disabled = !d;
  byId<HTMLButtonElement>("undo-operation").disabled = undoStack.length === 0;
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-form]")) {
    button.classList.toggle("active", button.dataset.form === formId(form));
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-seed]")) {
    button.classList.toggle("active", button.dataset.seed === preset);
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-dec-mesh]")) {
    button.setAttribute("aria-pressed", String(button.dataset.decMesh === meshScale));
  }
  const supportInput = byId<HTMLInputElement>("support-index");
  supportInput.max = String(form.values.length - 1);
  supportInput.value = String(selectedSupport);
  renderPath();
  renderPicture();
  renderCochain();
  renderMatrix();
  renderEnergy();
  drawMesh();
}

function setMeshScale(next: "teaching" | "patch"): void {
  meshScale = next;
  complex = next === "teaching" ? buildHexDecComplex() : buildTriangularPatchDecComplex(5);
  undoStack.length = 0;
  preset = "hill";
  form = seedDecForm(complex, "primal", 0, preset);
  selectedSupport = 0;
  lastOperation = undefined;
  path = [{ name: formName(form) }];
  render();
}

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-form]")) {
  button.addEventListener("click", () => {
    const [side, degree] = button.dataset.form!.split("-");
    setForm(side as FormSide, Number(degree) as FormDegree);
  });
}
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-seed]")) {
  button.addEventListener("click", () => setPreset(button.dataset.seed as SeedPreset));
}
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-dec-mesh]")) {
  button.addEventListener("click", () => setMeshScale(button.dataset.decMesh as "teaching" | "patch"));
}
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-recipe]")) {
  button.addEventListener("click", () => {
    const recipe = button.dataset.recipe;
    if (recipe === "exactness") {
      preset = "linear";
      setForm("primal", 0);
      applyOperator("d");
      applyOperator("d");
    } else if (recipe === "codifferential") {
      preset = "alternating";
      setForm("primal", 1);
      applyOperator("star");
      applyOperator("d");
      applyOperator("star");
    } else if (recipe === "laplacian") {
      preset = "hill";
      setForm("primal", 0);
      applyOperator("d");
      applyOperator("star");
      applyOperator("d");
      applyOperator("star");
    }
  });
}
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-lens]")) {
  button.addEventListener("click", () => {
    lens = button.dataset.lens as Lens;
    for (const tab of document.querySelectorAll<HTMLButtonElement>("[data-lens]")) {
      tab.setAttribute("aria-selected", String(tab === button));
    }
    for (const panel of document.querySelectorAll<HTMLElement>("[data-lens-panel]")) {
      panel.hidden = panel.dataset.lensPanel !== lens;
    }
  });
}

byId("apply-d").addEventListener("click", () => applyOperator("d"));
byId("apply-star").addEventListener("click", () => applyOperator("star"));
byId("undo-operation").addEventListener("click", () => {
  const previous = undoStack.pop();
  if (previous) restore(previous);
});
byId("reset-dec").addEventListener("click", () => {
  undoStack.push(snapshot());
  preset = "hill";
  form = seedDecForm(complex, "primal", 0, preset);
  selectedSupport = 0;
  lastOperation = undefined;
  path = [{ name: formName(form) }];
  render();
});

const brush = byId<HTMLInputElement>("brush-value");
brush.addEventListener("input", () => { byId<HTMLOutputElement>("brush-output").value = Number(brush.value).toFixed(2); });
byId("set-support").addEventListener("click", () => paintSupport(Math.round(Number(byId<HTMLInputElement>("support-index").value))));
canvas.addEventListener("pointerdown", (event) => {
  const rect = canvas.getBoundingClientRect();
  const layout = fitCanvas();
  const point = unproject([event.clientX - rect.left, event.clientY - rect.top], layout);
  paintSupport(nearestSupport(point));
});

new ResizeObserver(drawMesh).observe(canvas);
render();
