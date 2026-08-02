const TAU = 2 * Math.PI;
const EPSILON = 1e-12;

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
export type VertexFieldPreset = "gradient" | "harmonic" | "vortex" | "mixed";
export type EdgeFamily = "u" | "v" | "diagonal";

export interface TorusVertex {
  index: number;
  x: number;
  y: number;
  u: number;
  v: number;
  position: Vec3;
  frameU: Vec3;
  frameV: Vec3;
  normal: Vec3;
}

export interface TorusFace {
  index: number;
  vertices: [number, number, number];
  uv: [Vec2, Vec2, Vec2];
  area: number;
}

export interface TorusEdge {
  tail: number;
  head: number;
  du: number;
  dv: number;
  family: EdgeFamily;
  x: number;
  y: number;
}

export interface TorusMesh {
  resolution: number;
  majorRadius: number;
  minorRadius: number;
  step: number;
  index: (x: number, y: number) => number;
  vertices: TorusVertex[];
  faces: TorusFace[];
  edges: TorusEdge[];
}

export interface SampledVertexField {
  preset: VertexFieldPreset;
  local: Vec2[];
  ambient: Vec3[];
}

export interface CurlMeasurement {
  location: "face" | "dual-cell";
  values: number[];
  truth: number[];
  weights: number[];
  rms: number;
  truthRms: number;
  errorRms: number;
  maxAbs: number;
}

export interface ConnectionRow {
  edge: TorusEdge;
  analytic: number;
  extrinsic: number;
  intrinsic: number;
  extrinsicError: number;
  intrinsicError: number;
}

export interface ConnectionComparison {
  family: EdgeFamily;
  rows: ConnectionRow[];
  latitude: Array<{
    y: number;
    v: number;
    extrinsicRms: number;
    intrinsicRms: number;
  }>;
  extrinsicRms: number;
  intrinsicRms: number;
  extrinsicMax: number;
  intrinsicMax: number;
}

export interface VertexCurlExperimentOptions {
  resolution?: number;
  majorRadius?: number;
  minorRadius?: number;
  fieldPreset?: VertexFieldPreset;
  edgeFamily?: EdgeFamily;
}

export interface VertexCurlExperiment {
  mesh: TorusMesh;
  field: SampledVertexField;
  primal: CurlMeasurement;
  dual: CurlMeasurement;
  periods: { u: number; v: number };
  connections: ConnectionComparison;
}

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scale(vector: Vec3, amount: number): Vec3 {
  return [amount * vector[0], amount * vector[1], amount * vector[2]];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function length(vector: Vec3): number {
  return Math.hypot(...vector);
}

function normalize(vector: Vec3): Vec3 {
  const magnitude = length(vector);
  return magnitude < EPSILON ? [0, 0, 0] : scale(vector, 1 / magnitude);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export function wrapAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function torusFrame(u: number, v: number, majorRadius: number, minorRadius: number) {
  const radius = majorRadius + minorRadius * Math.cos(v);
  const frameU: Vec3 = [-Math.sin(u), Math.cos(u), 0];
  const frameV: Vec3 = [
    -Math.sin(v) * Math.cos(u),
    -Math.sin(v) * Math.sin(u),
    Math.cos(v),
  ];
  return {
    position: [
      radius * Math.cos(u),
      radius * Math.sin(u),
      minorRadius * Math.sin(v),
    ] as Vec3,
    frameU,
    frameV,
    normal: normalize(cross(frameU, frameV)),
  };
}

function faceArea(vertices: TorusVertex[], indices: [number, number, number]): number {
  const first = subtract(vertices[indices[1]]!.position, vertices[indices[0]]!.position);
  const second = subtract(vertices[indices[2]]!.position, vertices[indices[0]]!.position);
  return 0.5 * length(cross(first, second));
}

/** Build the periodic, consistently oriented reference torus used by the experiment. */
export function buildTorusMesh(
  resolution = 16,
  { majorRadius = 2.35, minorRadius = 0.82 } = {},
): TorusMesh {
  if (!Number.isInteger(resolution) || resolution < 5 || resolution > 64) {
    throw new Error("resolution must be an integer from 5 through 64");
  }
  if (!(majorRadius > minorRadius && minorRadius > 0)) {
    throw new Error("torus radii must satisfy majorRadius > minorRadius > 0");
  }

  const step = TAU / resolution;
  const index = (x: number, y: number): number =>
    (((x % resolution) + resolution) % resolution) * resolution
    + ((y % resolution) + resolution) % resolution;
  const vertices: TorusVertex[] = [];
  const faces: TorusFace[] = [];
  const edges: TorusEdge[] = [];

  for (let x = 0; x < resolution; x += 1) {
    for (let y = 0; y < resolution; y += 1) {
      const u = x * step;
      const v = y * step;
      vertices.push({ index: index(x, y), x, y, u, v, ...torusFrame(u, v, majorRadius, minorRadius) });
    }
  }

  const addFace = (indices: [number, number, number], uv: [Vec2, Vec2, Vec2]): void => {
    faces.push({ index: faces.length, vertices: indices, uv, area: faceArea(vertices, indices) });
  };
  for (let x = 0; x < resolution; x += 1) {
    for (let y = 0; y < resolution; y += 1) {
      const u = x * step;
      const v = y * step;
      const v00 = index(x, y);
      const v10 = index(x + 1, y);
      const v11 = index(x + 1, y + 1);
      const v01 = index(x, y + 1);
      addFace([v00, v10, v11], [[u, v], [u + step, v], [u + step, v + step]]);
      addFace([v00, v11, v01], [[u, v], [u + step, v + step], [u, v + step]]);
      edges.push(
        { tail: v00, head: v10, du: step, dv: 0, family: "u", x, y },
        { tail: v00, head: v01, du: 0, dv: step, family: "v", x, y },
        { tail: v00, head: v11, du: step, dv: step, family: "diagonal", x, y },
      );
    }
  }
  return { resolution, majorRadius, minorRadius, step, index, vertices, faces, edges };
}

function potentialDerivatives(u: number, v: number): Vec2 {
  return [0.55 * Math.cos(u) + 0.15 * Math.cos(u + v), -0.4 * Math.sin(2 * v) + 0.15 * Math.cos(u + v)];
}

export function fieldAt(
  preset: VertexFieldPreset,
  u: number,
  v: number,
  majorRadius: number,
  minorRadius: number,
): Vec2 {
  const radius = majorRadius + minorRadius * Math.cos(v);
  const derivative = potentialDerivatives(u, v);
  const exact: Vec2 = [derivative[0] / radius, derivative[1] / minorRadius];
  const harmonic: Vec2 = [1 / radius, 0.28 / minorRadius];
  const vortex: Vec2 = [0, Math.sin(u)];
  if (preset === "gradient") return exact;
  if (preset === "harmonic") return harmonic;
  if (preset === "vortex") return vortex;
  return [exact[0] + 0.42 * harmonic[0], exact[1] + 0.42 * harmonic[1] + 0.72 * vortex[1]];
}

export function analyticCurlAt(
  preset: VertexFieldPreset,
  u: number,
  v: number,
  majorRadius: number,
  minorRadius: number,
): number {
  if (preset === "gradient" || preset === "harmonic") return 0;
  const radius = majorRadius + minorRadius * Math.cos(v);
  return (preset === "vortex" ? 1 : 0.72) * Math.cos(u) / radius;
}

export function sampleVertexField(mesh: TorusMesh, preset: VertexFieldPreset): SampledVertexField {
  const local: Vec2[] = [];
  const ambient: Vec3[] = [];
  for (const vertex of mesh.vertices) {
    const value = fieldAt(preset, vertex.u, vertex.v, mesh.majorRadius, mesh.minorRadius);
    local.push(value);
    ambient.push(add(scale(vertex.frameU, value[0]), scale(vertex.frameV, value[1])));
  }
  return { preset, local, ambient };
}

function edgeIntegral(field: SampledVertexField, vertices: TorusVertex[], tail: number, head: number): number {
  const chord = subtract(vertices[head]!.position, vertices[tail]!.position);
  return 0.5 * dot(add(field.ambient[tail]!, field.ambient[head]!), chord);
}

function weightedSummary(values: number[], truth: number[], weights: number[]) {
  let weightSum = 0;
  let valueSquareSum = 0;
  let truthSquareSum = 0;
  let errorSquareSum = 0;
  let maxAbs = 0;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]!;
    const exact = truth[index]!;
    const weight = weights[index]!;
    const error = value - exact;
    weightSum += weight;
    valueSquareSum += weight * value * value;
    truthSquareSum += weight * exact * exact;
    errorSquareSum += weight * error * error;
    maxAbs = Math.max(maxAbs, Math.abs(value));
  }
  return {
    rms: Math.sqrt(valueSquareSum / Math.max(EPSILON, weightSum)),
    truthRms: Math.sqrt(truthSquareSum / Math.max(EPSILON, weightSum)),
    errorRms: Math.sqrt(errorSquareSum / Math.max(EPSILON, weightSum)),
    maxAbs,
  };
}

export function computePrimalCurl(mesh: TorusMesh, field: SampledVertexField): CurlMeasurement {
  const values: number[] = [];
  const truth: number[] = [];
  const weights: number[] = [];
  for (const face of mesh.faces) {
    let circulation = 0;
    for (let corner = 0; corner < 3; corner += 1) {
      circulation += edgeIntegral(
        field,
        mesh.vertices,
        face.vertices[corner]!,
        face.vertices[(corner + 1) % 3]!,
      );
    }
    const centroidU = face.uv.reduce((sum, point) => sum + point[0], 0) / 3;
    const centroidV = face.uv.reduce((sum, point) => sum + point[1], 0) / 3;
    values.push(circulation / face.area);
    truth.push(analyticCurlAt(field.preset, centroidU, centroidV, mesh.majorRadius, mesh.minorRadius));
    weights.push(face.area);
  }
  return { location: "face", values, truth, weights, ...weightedSummary(values, truth, weights) };
}

function barycentricValue(values: Vec3[], face: TorusFace, barycentric: number[]): Vec3 {
  const result: Vec3 = [0, 0, 0];
  for (let corner = 0; corner < 3; corner += 1) {
    const source = values[face.vertices[corner]!]!;
    const weight = barycentric[corner]!;
    result[0] += weight * source[0];
    result[1] += weight * source[1];
    result[2] += weight * source[2];
  }
  return result;
}

function segmentIntegral(
  mesh: TorusMesh,
  field: SampledVertexField,
  face: TorusFace,
  startWeights: number[],
  endWeights: number[],
): number {
  const positions = mesh.vertices.map((vertex) => vertex.position);
  const startPosition = barycentricValue(positions, face, startWeights);
  const endPosition = barycentricValue(positions, face, endWeights);
  const startField = barycentricValue(field.ambient, face, startWeights);
  const endField = barycentricValue(field.ambient, face, endWeights);
  return 0.5 * dot(add(startField, endField), subtract(endPosition, startPosition));
}

/** Integrate the interpolated field around each positive barycentric dual cell. */
export function computeDualCurl(mesh: TorusMesh, field: SampledVertexField): CurlMeasurement {
  const circulation = Array<number>(mesh.vertices.length).fill(0);
  const weights = Array<number>(mesh.vertices.length).fill(0);
  const center = [1 / 3, 1 / 3, 1 / 3];
  for (const face of mesh.faces) {
    for (let corner = 0; corner < 3; corner += 1) {
      const next = (corner + 1) % 3;
      const previous = (corner + 2) % 3;
      const start = [0, 0, 0];
      const end = [0, 0, 0];
      start[corner] = 0.5;
      start[next] = 0.5;
      end[corner] = 0.5;
      end[previous] = 0.5;
      const vertex = face.vertices[corner]!;
      circulation[vertex]! += segmentIntegral(mesh, field, face, start, center);
      circulation[vertex]! += segmentIntegral(mesh, field, face, center, end);
      weights[vertex]! += face.area / 3;
    }
  }
  const values = circulation.map((value, vertex) => value / weights[vertex]!);
  const truth = mesh.vertices.map((vertex) =>
    analyticCurlAt(field.preset, vertex.u, vertex.v, mesh.majorRadius, mesh.minorRadius));
  return { location: "dual-cell", values, truth, weights, ...weightedSummary(values, truth, weights) };
}

export function computePeriods(mesh: TorusMesh, field: SampledVertexField): { u: number; v: number } {
  let u = 0;
  let v = 0;
  for (let coordinate = 0; coordinate < mesh.resolution; coordinate += 1) {
    u += edgeIntegral(field, mesh.vertices, mesh.index(coordinate, 0), mesh.index(coordinate + 1, 0));
    v += edgeIntegral(field, mesh.vertices, mesh.index(0, coordinate), mesh.index(0, coordinate + 1));
  }
  return { u, v };
}

function minimallyRotate(vector: Vec3, fromNormal: Vec3, toNormal: Vec3): Vec3 {
  const rotationAxis = cross(fromNormal, toNormal);
  const sine = length(rotationAxis);
  const cosine = clamp(dot(fromNormal, toNormal), -1, 1);
  if (sine < EPSILON) return cosine > 0 ? [...vector] : scale(vector, -1);
  const axis = scale(rotationAxis, 1 / sine);
  return add(add(scale(vector, cosine), scale(cross(axis, vector), sine)), scale(axis, dot(axis, vector) * (1 - cosine)));
}

function extrinsicConnectionAngle(mesh: TorusMesh, edge: TorusEdge): number {
  const tail = mesh.vertices[edge.tail]!;
  const head = mesh.vertices[edge.head]!;
  const transportedU = minimallyRotate(tail.frameU, tail.normal, head.normal);
  return Math.atan2(dot(head.frameV, transportedU), dot(head.frameU, transportedU));
}

function cornerAngle(mesh: TorusMesh, vertex: number, first: number, second: number): number {
  const firstEdge = normalize(subtract(mesh.vertices[first]!.position, mesh.vertices[vertex]!.position));
  const secondEdge = normalize(subtract(mesh.vertices[second]!.position, mesh.vertices[vertex]!.position));
  return Math.acos(clamp(dot(firstEdge, secondEdge), -1, 1));
}

interface IntrinsicChart {
  angles: Map<number, number>;
  theta0: number;
}

/**
 * Build a deliberately explicit intrinsic baseline. One-ring corner angles are
 * normalized to 2π and accumulated into a polar chart. This is a comparison
 * method, not a claim that every vertex connection should use this gauge.
 */
function buildIntrinsicCharts(mesh: TorusMesh): IntrinsicChart[] {
  const wedges = Array.from({ length: mesh.vertices.length }, () => new Map<number, { next: number; angle: number }>());
  for (const face of mesh.faces) {
    for (let corner = 0; corner < 3; corner += 1) {
      const vertex = face.vertices[corner]!;
      const next = face.vertices[(corner + 1) % 3]!;
      const previous = face.vertices[(corner + 2) % 3]!;
      wedges[vertex]!.set(next, { next: previous, angle: cornerAngle(mesh, vertex, next, previous) });
    }
  }
  return wedges.map((oneRing, vertexIndex) => {
    const neighbors = [...oneRing.keys()];
    const start = Math.min(...neighbors);
    const totalAngle = [...oneRing.values()].reduce((sum, wedge) => sum + wedge.angle, 0);
    const angleScale = TAU / totalAngle;
    const angles = new Map<number, number>([[start, 0]]);
    let current = start;
    let accumulated = 0;
    for (let step = 0; step < oneRing.size; step += 1) {
      const wedge = oneRing.get(current);
      if (!wedge) throw new Error("vertex link is not one oriented cycle");
      accumulated += wedge.angle * angleScale;
      if (wedge.next !== start) angles.set(wedge.next, accumulated);
      current = wedge.next;
    }
    if (current !== start || angles.size !== oneRing.size) {
      throw new Error("vertex link traversal did not close");
    }
    const vertex = mesh.vertices[vertexIndex]!;
    const startDirection = subtract(mesh.vertices[start]!.position, vertex.position);
    const theta0 = Math.atan2(dot(startDirection, vertex.frameV), dot(startDirection, vertex.frameU));
    return { angles, theta0 };
  });
}

function intrinsicConnectionAngle(charts: IntrinsicChart[], edge: TorusEdge): number {
  const tailChart = charts[edge.tail]!;
  const headChart = charts[edge.head]!;
  const tailEdgeAngle = tailChart.angles.get(edge.head);
  const headEdgeAngle = headChart.angles.get(edge.tail);
  if (tailEdgeAngle === undefined || headEdgeAngle === undefined) {
    throw new Error("intrinsic chart is missing an edge direction");
  }
  return wrapAngle(headChart.theta0 + headEdgeAngle + Math.PI - tailEdgeAngle - tailChart.theta0);
}

function analyticConnectionAngle(mesh: TorusMesh, edge: TorusEdge): number {
  const v = mesh.vertices[edge.tail]!.v;
  if (Math.abs(edge.du) < EPSILON) return 0;
  if (Math.abs(edge.dv) < EPSILON) return wrapAngle(-Math.sin(v) * edge.du);
  const meanSine = (Math.cos(v) - Math.cos(v + edge.dv)) / edge.dv;
  return wrapAngle(-edge.du * meanSine);
}

function rms(values: number[]): number {
  return Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / Math.max(1, values.length));
}

export function compareConnections(mesh: TorusMesh, family: EdgeFamily): ConnectionComparison {
  const charts = buildIntrinsicCharts(mesh);
  const rows: ConnectionRow[] = [];
  const byLatitude = Array.from({ length: mesh.resolution }, (_, y) => ({
    y,
    v: y * mesh.step,
    extrinsic: [] as number[],
    intrinsic: [] as number[],
  }));
  for (const edge of mesh.edges) {
    if (edge.family !== family) continue;
    const analytic = analyticConnectionAngle(mesh, edge);
    const extrinsic = extrinsicConnectionAngle(mesh, edge);
    const intrinsic = intrinsicConnectionAngle(charts, edge);
    const extrinsicError = wrapAngle(extrinsic - analytic);
    const intrinsicError = wrapAngle(intrinsic - analytic);
    rows.push({ edge, analytic, extrinsic, intrinsic, extrinsicError, intrinsicError });
    byLatitude[edge.y]!.extrinsic.push(extrinsicError);
    byLatitude[edge.y]!.intrinsic.push(intrinsicError);
  }
  const latitude = byLatitude.map((row) => ({
    y: row.y,
    v: row.v,
    extrinsicRms: rms(row.extrinsic),
    intrinsicRms: rms(row.intrinsic),
  }));
  return {
    family,
    rows,
    latitude,
    extrinsicRms: rms(rows.map((row) => row.extrinsicError)),
    intrinsicRms: rms(rows.map((row) => row.intrinsicError)),
    extrinsicMax: Math.max(...rows.map((row) => Math.abs(row.extrinsicError))),
    intrinsicMax: Math.max(...rows.map((row) => Math.abs(row.intrinsicError))),
  };
}

export function runVertexCurlExperiment({
  resolution = 16,
  majorRadius = 2.35,
  minorRadius = 0.82,
  fieldPreset = "gradient",
  edgeFamily = "u",
}: VertexCurlExperimentOptions = {}): VertexCurlExperiment {
  const mesh = buildTorusMesh(resolution, { majorRadius, minorRadius });
  const field = sampleVertexField(mesh, fieldPreset);
  return {
    mesh,
    field,
    primal: computePrimalCurl(mesh, field),
    dual: computeDualCurl(mesh, field),
    periods: computePeriods(mesh, field),
    connections: compareConnections(mesh, edgeFamily),
  };
}
