export type FormSide = "primal" | "dual";
export type FormDegree = 0 | 1 | 2;
export type DecOperatorKind = "d" | "star";
export type Point2 = [number, number];

export interface DecFormState {
  side: FormSide;
  degree: FormDegree;
  values: number[];
}

export interface DecEdge {
  index: number;
  tail: number;
  head: number;
  faces: number[];
  midpoint: Point2;
  length: number;
  dualSegment: [Point2, Point2];
  dualLength: number;
}

export interface DecFace {
  index: number;
  vertices: [number, number, number];
  centroid: Point2;
  circumcenter: Point2;
  area: number;
}

export interface DecComplex {
  vertices: Point2[];
  edges: DecEdge[];
  faces: DecFace[];
  dualAreas: number[];
  dualCells: Point2[][];
  d0: number[][];
  d1: number[][];
  stars: [number[], number[], number[]];
}

export interface DecOperator {
  kind: DecOperatorKind;
  label: string;
  matrix: number[][];
  output: Pick<DecFormState, "side" | "degree">;
}

const EPSILON = 1e-12;

function subtract(a: Point2, b: Point2): Point2 {
  return [a[0] - b[0], a[1] - b[1]];
}

function distance(a: Point2, b: Point2): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function midpoint(a: Point2, b: Point2): Point2 {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

function faceArea(a: Point2, b: Point2, c: Point2): number {
  return 0.5 * Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
}

function circumcenter(a: Point2, b: Point2, c: Point2): Point2 {
  const denominator = 2 * (
    a[0] * (b[1] - c[1]) +
    b[0] * (c[1] - a[1]) +
    c[0] * (a[1] - b[1])
  );
  if (Math.abs(denominator) < EPSILON) {
    return [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3];
  }
  const a2 = a[0] ** 2 + a[1] ** 2;
  const b2 = b[0] ** 2 + b[1] ** 2;
  const c2 = c[0] ** 2 + c[1] ** 2;
  return [
    (a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / denominator,
    (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / denominator,
  ];
}

function transpose(matrix: readonly number[][]): number[][] {
  if (matrix.length === 0) return [];
  return Array.from({ length: matrix[0]!.length }, (_, column) =>
    matrix.map((row) => row[column] ?? 0));
}

function diagonal(values: readonly number[]): number[][] {
  return values.map((value, row) => values.map((_, column) => row === column ? value : 0));
}

export function multiplyMatrixVector(matrix: readonly number[][], vector: readonly number[]): number[] {
  return matrix.map((row) => row.reduce((sum, value, column) => sum + value * (vector[column] ?? 0), 0));
}

export function multiplyMatrices(a: readonly number[][], b: readonly number[][]): number[][] {
  if (a.length === 0 || b.length === 0) return [];
  return a.map((row) => Array.from({ length: b[0]!.length }, (_, column) =>
    row.reduce((sum, value, index) => sum + value * (b[index]?.[column] ?? 0), 0)));
}

function formSize(complex: DecComplex, side: FormSide, degree: FormDegree): number {
  const counts = [complex.vertices.length, complex.edges.length, complex.faces.length];
  return side === "primal" ? counts[degree]! : counts[2 - degree]!;
}

export function formId(form: Pick<DecFormState, "side" | "degree">): string {
  return `${form.side}-${form.degree}`;
}

export function formName(form: Pick<DecFormState, "side" | "degree">): string {
  return `${form.side === "primal" ? "Primal" : "Dual"} ${form.degree}-form`;
}

export function formSupportDegree(form: Pick<DecFormState, "side" | "degree">): FormDegree {
  return form.side === "primal" ? form.degree : (2 - form.degree) as FormDegree;
}

function buildDecComplex(
  vertices: Point2[],
  faceVertices: Array<[number, number, number]>,
): DecComplex {
  const faces: DecFace[] = faceVertices.map((indices, index) => {
    const [a, b, c] = indices.map((vertex) => vertices[vertex]!) as [Point2, Point2, Point2];
    return {
      index,
      vertices: indices,
      centroid: [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3],
      circumcenter: circumcenter(a, b, c),
      area: faceArea(a, b, c),
    };
  });

  const edgeMap = new Map<string, { tail: number; head: number; faces: number[] }>();
  for (const face of faces) {
    for (let corner = 0; corner < 3; corner += 1) {
      const a = face.vertices[corner]!;
      const b = face.vertices[(corner + 1) % 3]!;
      const tail = Math.min(a, b);
      const head = Math.max(a, b);
      const key = `${tail}:${head}`;
      const edge = edgeMap.get(key) ?? { tail, head, faces: [] };
      edge.faces.push(face.index);
      edgeMap.set(key, edge);
    }
  }
  const edgeRecords = [...edgeMap.values()].sort((a, b) => a.tail - b.tail || a.head - b.head);
  const edges: DecEdge[] = edgeRecords.map((record, index) => {
    const a = vertices[record.tail]!;
    const b = vertices[record.head]!;
    const edgeMidpoint = midpoint(a, b);
    const first = faces[record.faces[0]!]!.circumcenter;
    const second = record.faces.length === 2
      ? faces[record.faces[1]!]!.circumcenter
      : edgeMidpoint;
    return {
      index,
      ...record,
      midpoint: edgeMidpoint,
      length: distance(a, b),
      dualSegment: [first, second],
      dualLength: distance(first, second),
    };
  });

  const d0 = edges.map((edge) => vertices.map((_, vertex) =>
    vertex === edge.tail ? -1 : vertex === edge.head ? 1 : 0));
  const edgeIndex = new Map(edges.map((edge) => [`${edge.tail}:${edge.head}`, edge.index]));
  const d1 = faces.map((face) => {
    const row = edges.map(() => 0);
    for (let corner = 0; corner < 3; corner += 1) {
      const a = face.vertices[corner]!;
      const b = face.vertices[(corner + 1) % 3]!;
      const tail = Math.min(a, b);
      const head = Math.max(a, b);
      row[edgeIndex.get(`${tail}:${head}`)!] = a === tail ? 1 : -1;
    }
    return row;
  });

  const dualAreas = vertices.map((_, vertex) =>
    faces.reduce((sum, face) => face.vertices.includes(vertex) ? sum + face.area / 3 : sum, 0));
  const stars: [number[], number[], number[]] = [
    dualAreas,
    edges.map((edge) => edge.dualLength / edge.length),
    faces.map((face) => 1 / face.area),
  ];
  const dualCells = vertices.map((vertex, index) => {
    const points: Point2[] = [];
    for (const edge of edges) if (edge.tail === index || edge.head === index) points.push(edge.midpoint);
    for (const face of faces) if (face.vertices.includes(index)) points.push(face.circumcenter);
    if (index !== 0) points.push(vertex);
    return points.sort((a, b) =>
      Math.atan2(a[1] - vertex[1], a[0] - vertex[0]) -
      Math.atan2(b[1] - vertex[1], b[0] - vertex[0]));
  });

  return { vertices, edges, faces, dualAreas, dualCells, d0, d1, stars };
}

export function buildHexDecComplex(radius = 1): DecComplex {
  const vertices: Point2[] = [[0, 0]];
  for (let corner = 0; corner < 6; corner += 1) {
    const angle = corner * Math.PI / 3;
    vertices.push([radius * Math.cos(angle), radius * Math.sin(angle)]);
  }
  const faces: Array<[number, number, number]> = [];
  for (let face = 0; face < 6; face += 1) {
    faces.push([0, face + 1, ((face + 1) % 6) + 1]);
  }
  return buildDecComplex(vertices, faces);
}

export function buildTriangularPatchDecComplex(resolution = 5, radius = 1): DecComplex {
  if (!Number.isInteger(resolution) || resolution < 3 || resolution > 9) {
    throw new Error("resolution must be an integer from 3 through 9");
  }
  const vertices: Point2[] = [];
  const vertex = (column: number, row: number): number => row * resolution + column;
  for (let row = 0; row < resolution; row += 1) {
    for (let column = 0; column < resolution; column += 1) {
      vertices.push([column + 0.5 * row, 0.5 * Math.sqrt(3) * row]);
    }
  }
  const center: Point2 = [
    vertices.reduce((sum, point) => sum + point[0], 0) / vertices.length,
    vertices.reduce((sum, point) => sum + point[1], 0) / vertices.length,
  ];
  const maximumRadius = Math.max(...vertices.map((point) => distance(point, center)));
  for (const point of vertices) {
    point[0] = radius * (point[0] - center[0]) / maximumRadius;
    point[1] = radius * (point[1] - center[1]) / maximumRadius;
  }
  const faces: Array<[number, number, number]> = [];
  for (let row = 0; row + 1 < resolution; row += 1) {
    for (let column = 0; column + 1 < resolution; column += 1) {
      const a = vertex(column, row);
      const b = vertex(column + 1, row);
      const c = vertex(column, row + 1);
      const d = vertex(column + 1, row + 1);
      faces.push([a, b, c], [b, d, c]);
    }
  }
  return buildDecComplex(vertices, faces);
}

export function decOperator(
  complex: DecComplex,
  form: Pick<DecFormState, "side" | "degree">,
  kind: DecOperatorKind,
): DecOperator | null {
  if (kind === "d") {
    if (form.degree === 2) return null;
    if (form.side === "primal") {
      const matrix = form.degree === 0 ? complex.d0 : complex.d1;
      return { kind, label: `d${form.degree}`, matrix, output: { side: "primal", degree: (form.degree + 1) as FormDegree } };
    }
    const matrix = form.degree === 0 ? transpose(complex.d1) : transpose(complex.d0);
    return { kind, label: `d̃${form.degree}`, matrix, output: { side: "dual", degree: (form.degree + 1) as FormDegree } };
  }

  if (form.side === "primal") {
    const weights = complex.stars[form.degree];
    return {
      kind,
      label: `⋆${form.degree}`,
      matrix: diagonal(weights),
      output: { side: "dual", degree: (2 - form.degree) as FormDegree },
    };
  }
  const primalDegree = (2 - form.degree) as FormDegree;
  const inverseWeights = complex.stars[primalDegree].map((weight) => 1 / weight);
  return {
    kind,
    label: `⋆${primalDegree}⁻¹`,
    matrix: diagonal(inverseWeights),
    output: { side: "primal", degree: primalDegree },
  };
}

export function applyDecOperator(
  complex: DecComplex,
  form: DecFormState,
  kind: DecOperatorKind,
): DecFormState {
  if (form.values.length !== formSize(complex, form.side, form.degree)) {
    throw new Error(`${formName(form)} has the wrong number of coefficients.`);
  }
  const operator = decOperator(complex, form, kind);
  if (!operator) throw new Error(`${formName(form)} has no exterior derivative in dimension two.`);
  return { ...operator.output, values: multiplyMatrixVector(operator.matrix, form.values) };
}

export function seedDecForm(
  complex: DecComplex,
  side: FormSide = "primal",
  degree: FormDegree = 0,
  preset: "hill" | "linear" | "alternating" = "hill",
): DecFormState {
  const support = side === "primal" ? degree : (2 - degree) as FormDegree;
  const points = support === 0
    ? complex.vertices
    : support === 1
      ? complex.edges.map((edge) => edge.midpoint)
      : complex.faces.map((face) => face.centroid);
  const values = points.map((point, index) => {
    if (preset === "linear") return Number((0.8 * point[0] - 0.35 * point[1]).toFixed(6));
    if (preset === "alternating") return index % 2 === 0 ? 0.8 : -0.55;
    return Number(Math.exp(-2.4 * (point[0] ** 2 + point[1] ** 2)).toFixed(6));
  });
  return { side, degree, values };
}

export function naturalEnergy(complex: DecComplex, form: DecFormState): {
  value: number;
  residual: DecFormState;
  weights: number[];
  formula: string;
} {
  const derivative = decOperator(complex, form, "d");
  const residual = derivative ? applyDecOperator(complex, form, "d") : form;
  const primalDegree = residual.side === "primal" ? residual.degree : (2 - residual.degree) as FormDegree;
  const weights = residual.side === "primal"
    ? complex.stars[primalDegree]
    : complex.stars[primalDegree].map((weight) => 1 / weight);
  const value = 0.5 * residual.values.reduce((sum, coefficient, index) =>
    sum + (weights[index] ?? 1) * coefficient ** 2, 0);
  const symbol = form.degree === 0 ? "φ" : form.degree === 1 ? "α" : "β";
  return {
    value,
    residual,
    weights,
    formula: derivative
      ? `E(${symbol}) = ½ (d${symbol})ᵀ M (d${symbol})`
      : `E(${symbol}) = ½ ${symbol}ᵀ M ${symbol}`,
  };
}
