import type { FrogEigenbasis, FrogTriangleMesh } from "./frog-surface-fluid-model";
import type { Vec3 } from "./random-surface-fluid-model";

export type ClebschSurface = "plane" | "sphere" | "torus" | "frog";

export interface ControlledClebschParameters {
  labelStrength: number;
  potentialStrength: number;
  crossing: number;
}

export interface ControlledClebschSample {
  position: Vec3;
  normal: Vec3;
  alpha: number;
  beta: number;
  phi: number;
  dAlpha: Vec3;
  dBeta: Vec3;
  dPhi: Vec3;
  alphaDBeta: Vec3;
  velocity: Vec3;
  projectedVelocity: Vec3;
  divergentVelocity: Vec3;
  vorticity: number;
}

export interface TaylorGreenClebschFields {
  alpha: number;
  beta: number;
  phi: number;
  dAlpha: readonly [number, number];
  dBeta: readonly [number, number];
  dPhi: readonly [number, number];
  projectedCovector: readonly [number, number];
  vorticityDensity: number;
  rawDivergence: number;
}

const TAU = 2 * Math.PI;
const PLANE_WIDTH = 2.8;
const TORUS_MAJOR_RADIUS = 1.25;
const TORUS_MINOR_RADIUS = 0.46;

export const DEFAULT_CONTROLLED_CLEBSCH_PARAMETERS: ControlledClebschParameters = {
  labelStrength: 0.7,
  potentialStrength: 0.24,
  crossing: 0.78,
};

/**
 * Exact Taylor–Green data on the unit-metric periodic coordinate domain
 * [0, 2π) × [0, 2π). The optional q term is deliberately exact: it
 * changes divergence but leaves dα ∧ dβ, and therefore vorticity, untouched.
 */
export function evaluateTaylorGreenClebsch(
  u: number,
  v: number,
  amplitude = 1,
  exactContamination = 0,
): TaylorGreenClebschFields {
  if (![u, v, amplitude, exactContamination].every(Number.isFinite)) {
    throw new Error("Taylor–Green coordinates and strengths must be finite");
  }
  if (amplitude < 0 || exactContamination < 0) {
    throw new Error("Taylor–Green strengths must be nonnegative");
  }
  const diagonal = exactContamination * Math.cos(u + v);
  return {
    alpha: 2 * amplitude * Math.cos(u),
    beta: Math.cos(v),
    phi: -amplitude * Math.cos(u) * Math.cos(v) + exactContamination * Math.sin(u + v),
    dAlpha: [-2 * amplitude * Math.sin(u), 0],
    dBeta: [0, -Math.sin(v)],
    dPhi: [amplitude * Math.sin(u) * Math.cos(v) + diagonal, amplitude * Math.cos(u) * Math.sin(v) + diagonal],
    projectedCovector: [amplitude * Math.sin(u) * Math.cos(v), -amplitude * Math.cos(u) * Math.sin(v)],
    vorticityDensity: 2 * amplitude * Math.sin(u) * Math.sin(v),
    rawDivergence: -2 * exactContamination * Math.sin(u + v),
  };
}

function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function scale(vector: Vec3, amount: number): Vec3 {
  return { x: amount * vector.x, y: amount * vector.y, z: amount * vector.z };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function norm(vector: Vec3): number {
  return Math.hypot(vector.x, vector.y, vector.z);
}

function normalize(vector: Vec3): Vec3 {
  const length = norm(vector);
  return length > 1e-14 ? scale(vector, 1 / length) : { x: 0, y: 0, z: 1 };
}

function tangent(vector: Vec3, normal: Vec3): Vec3 {
  return add(vector, scale(normal, -dot(vector, normal)));
}

function arrayVector(values: ArrayLike<number>, index: number): Vec3 {
  return { x: values[3 * index]!, y: values[3 * index + 1]!, z: values[3 * index + 2]! };
}

function setArrayVector(values: Float64Array, index: number, vector: Vec3): void {
  values[3 * index] = vector.x;
  values[3 * index + 1] = vector.y;
  values[3 * index + 2] = vector.z;
}

function assertParameters(parameters: ControlledClebschParameters): void {
  for (const [name, value] of Object.entries(parameters)) {
    if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
  }
  if (parameters.labelStrength < 0 || parameters.potentialStrength < 0) {
    throw new Error("Clebsch strengths must be nonnegative");
  }
  if (parameters.crossing < 0 || parameters.crossing > 1) {
    throw new Error("crossing must lie between zero and one");
  }
}

interface ParameterGeometry {
  position: Vec3;
  normal: Vec3;
  partialU: Vec3;
  partialV: Vec3;
  metricU: number;
  metricV: number;
}

function parameterGeometry(surface: "plane" | "torus", u: number, v: number): ParameterGeometry {
  if (surface === "plane") {
    const scaleFactor = PLANE_WIDTH / TAU;
    return {
      position: { x: scaleFactor * (u - Math.PI), y: scaleFactor * (v - Math.PI), z: 0 },
      normal: { x: 0, y: 0, z: 1 },
      partialU: { x: scaleFactor, y: 0, z: 0 },
      partialV: { x: 0, y: scaleFactor, z: 0 },
      metricU: scaleFactor ** 2,
      metricV: scaleFactor ** 2,
    };
  }
  const radial = TORUS_MAJOR_RADIUS + TORUS_MINOR_RADIUS * Math.cos(v);
  const partialU = { x: -radial * Math.sin(u), y: radial * Math.cos(u), z: 0 };
  const partialV = {
    x: -TORUS_MINOR_RADIUS * Math.sin(v) * Math.cos(u),
    y: -TORUS_MINOR_RADIUS * Math.sin(v) * Math.sin(u),
    z: TORUS_MINOR_RADIUS * Math.cos(v),
  };
  return {
    position: { x: radial * Math.cos(u), y: radial * Math.sin(u), z: TORUS_MINOR_RADIUS * Math.sin(v) },
    normal: { x: Math.cos(u) * Math.cos(v), y: Math.sin(u) * Math.cos(v), z: Math.sin(v) },
    partialU,
    partialV,
    metricU: radial ** 2,
    metricV: TORUS_MINOR_RADIUS ** 2,
  };
}

function parameterGradient(geometry: ParameterGeometry, derivativeU: number, derivativeV: number): Vec3 {
  return add(
    scale(geometry.partialU, derivativeU / geometry.metricU),
    scale(geometry.partialV, derivativeV / geometry.metricV),
  );
}

interface FrogBasisFields {
  alpha: Float64Array;
  betaIndependent: Float64Array;
  phi: Float64Array;
  dAlpha: Float64Array;
  dBetaIndependent: Float64Array;
  dPhi: Float64Array;
  projectedUnit: Float64Array;
}

interface TorusProjectionGrid {
  columns: number;
  rows: number;
  dU: number;
  dV: number;
  streamFunction: Float64Array;
}

function normalizedMode(eigenbasis: FrogEigenbasis, mode: number): Float64Array {
  const result = new Float64Array(eigenbasis.vertexCount);
  const offset = mode * eigenbasis.vertexCount;
  let maximum = 0;
  for (let vertex = 0; vertex < result.length; vertex += 1) {
    result[vertex] = eigenbasis.modes[offset + vertex]!;
    maximum = Math.max(maximum, Math.abs(result[vertex]!));
  }
  for (let vertex = 0; vertex < result.length; vertex += 1) result[vertex] = result[vertex]! / Math.max(1e-14, maximum);
  return result;
}

function vertexGradient(mesh: FrogTriangleMesh, values: Float64Array): Float64Array {
  const faceGradients = new Float64Array(mesh.faces.length);
  for (let face = 0; face < mesh.faces.length / 3; face += 1) {
    let gradient = { x: 0, y: 0, z: 0 };
    for (let local = 0; local < 3; local += 1) {
      const vertex = mesh.faces[3 * face + local]!;
      const offset = 9 * face + 3 * local;
      gradient = add(gradient, scale({
        x: mesh.faceGradients[offset]!,
        y: mesh.faceGradients[offset + 1]!,
        z: mesh.faceGradients[offset + 2]!,
      }, values[vertex]!));
    }
    setArrayVector(faceGradients, face, gradient);
  }
  const result = new Float64Array(mesh.positions.length);
  for (let vertex = 0; vertex < mesh.positions.length / 3; vertex += 1) {
    let gradient = { x: 0, y: 0, z: 0 };
    let area = 0;
    for (const face of mesh.vertexFaces[vertex]!) {
      gradient = add(gradient, scale(arrayVector(faceGradients, face), mesh.faceAreas[face]!));
      area += mesh.faceAreas[face]!;
    }
    setArrayVector(result, vertex, tangent(scale(gradient, 1 / Math.max(1e-14, area)), arrayVector(mesh.vertexNormals, vertex)));
  }
  return result;
}

function frogProjectedUnit(
  mesh: FrogTriangleMesh,
  eigenbasis: FrogEigenbasis,
  dAlpha: Float64Array,
  dBeta: Float64Array,
): Float64Array {
  const count = mesh.positions.length / 3;
  const vorticity = new Float64Array(count);
  let mean = 0;
  let totalArea = 0;
  for (let vertex = 0; vertex < count; vertex += 1) {
    const value = dot(
      arrayVector(mesh.vertexNormals, vertex),
      cross(arrayVector(dAlpha, vertex), arrayVector(dBeta, vertex)),
    );
    vorticity[vertex] = value;
    mean += mesh.vertexAreas[vertex]! * value;
    totalArea += mesh.vertexAreas[vertex]!;
  }
  mean /= Math.max(1e-14, totalArea);
  const streamFunction = new Float64Array(count);
  for (let mode = 0; mode < eigenbasis.modeCount; mode += 1) {
    const eigenvalue = eigenbasis.eigenvalues[mode]!;
    if (!(eigenvalue > 1e-8)) continue;
    const offset = mode * count;
    let numerator = 0;
    let denominator = 0;
    for (let vertex = 0; vertex < count; vertex += 1) {
      const basisValue = eigenbasis.modes[offset + vertex]!;
      const area = mesh.vertexAreas[vertex]!;
      numerator += area * (vorticity[vertex]! - mean) * basisValue;
      denominator += area * basisValue * basisValue;
    }
    const coefficient = -numerator / Math.max(1e-14, eigenvalue * denominator);
    for (let vertex = 0; vertex < count; vertex += 1) {
      streamFunction[vertex] = streamFunction[vertex]! + coefficient * eigenbasis.modes[offset + vertex]!;
    }
  }
  const gradient = vertexGradient(mesh, streamFunction);
  const projected = new Float64Array(mesh.positions.length);
  for (let vertex = 0; vertex < count; vertex += 1) {
    setArrayVector(
      projected,
      vertex,
      cross(arrayVector(mesh.vertexNormals, vertex), arrayVector(gradient, vertex)),
    );
  }
  return projected;
}

function torusProjectionGrid(): TorusProjectionGrid {
  const columns = 64;
  const rows = 48;
  const dU = TAU / columns;
  const dV = TAU / rows;
  const count = columns * rows;
  const result = new Float64Array(count);
  const rhs = new Float64Array(count);
  const residual = new Float64Array(count);
  const direction = new Float64Array(count);
  const product = new Float64Array(count);
  const indexAt = (row: number, column: number): number => (
    (row + rows) % rows * columns + (column + columns) % columns
  );
  const radial = (row: number): number => TORUS_MAJOR_RADIUS
    + TORUS_MINOR_RADIUS * Math.cos(TAU * ((row + rows) % rows) / rows);
  const multiply = (input: Float64Array, output: Float64Array): void => {
    for (let row = 0; row < rows; row += 1) {
      const q = radial(row);
      const qPlus = 0.5 * (q + radial(row + 1));
      const qMinus = 0.5 * (q + radial(row - 1));
      for (let column = 0; column < columns; column += 1) {
        const center = indexAt(row, column);
        const uTerm = (
          2 * input[center]! - input[indexAt(row, column - 1)]! - input[indexAt(row, column + 1)]!
        ) / (q * q * dU * dU);
        const vTerm = (
          qPlus * (input[center]! - input[indexAt(row + 1, column)]!)
          + qMinus * (input[center]! - input[indexAt(row - 1, column)]!)
        ) / (TORUS_MINOR_RADIUS ** 2 * q * dV * dV);
        output[center] = uTerm + vTerm + 1e-10 * input[center]!;
      }
    }
  };
  for (let row = 0; row < rows; row += 1) {
    const v = TAU * row / rows;
    const q = radial(row);
    for (let column = 0; column < columns; column += 1) {
      const u = TAU * column / columns;
      rhs[indexAt(row, column)] = -Math.cos(u) * Math.cos(v) / (q * TORUS_MINOR_RADIUS);
    }
  }
  residual.set(rhs);
  direction.set(rhs);
  let squared = dotArray(residual, residual);
  for (let iteration = 0; iteration < 260 && squared > 1e-18; iteration += 1) {
    multiply(direction, product);
    const step = squared / Math.max(1e-20, dotArray(direction, product));
    for (let index = 0; index < count; index += 1) {
      result[index] = result[index]! + step * direction[index]!;
      residual[index] = residual[index]! - step * product[index]!;
    }
    const nextSquared = dotArray(residual, residual);
    const change = nextSquared / Math.max(1e-20, squared);
    for (let index = 0; index < count; index += 1) direction[index] = residual[index]! + change * direction[index]!;
    squared = nextSquared;
  }
  return { columns, rows, dU, dV, streamFunction: result };
}

function dotArray(a: Float64Array, b: Float64Array): number {
  let result = 0;
  for (let index = 0; index < a.length; index += 1) result += a[index]! * b[index]!;
  return result;
}

export class ControlledClebschSurfaceModel {
  parameters: ControlledClebschParameters;
  readonly frogMesh?: FrogTriangleMesh;
  private frogFields?: FrogBasisFields;
  private readonly torusProjection = torusProjectionGrid();

  constructor(
    parameters: Partial<ControlledClebschParameters> = {},
    frogMesh?: FrogTriangleMesh,
    frogEigenbasis?: FrogEigenbasis,
  ) {
    this.parameters = { ...DEFAULT_CONTROLLED_CLEBSCH_PARAMETERS, ...parameters };
    assertParameters(this.parameters);
    this.frogMesh = frogMesh;
    if (frogMesh && frogEigenbasis) {
      if (frogEigenbasis.vertexCount !== frogMesh.positions.length / 3 || frogEigenbasis.modeCount < 6) {
        throw new Error("The frog needs a compatible six-mode Laplace–Beltrami basis.");
      }
      const alpha = normalizedMode(frogEigenbasis, 0);
      const betaIndependent = normalizedMode(frogEigenbasis, 2);
      const phi = normalizedMode(frogEigenbasis, 5);
      this.frogFields = {
        alpha,
        betaIndependent,
        phi,
        dAlpha: vertexGradient(frogMesh, alpha),
        dBetaIndependent: vertexGradient(frogMesh, betaIndependent),
        dPhi: vertexGradient(frogMesh, phi),
        projectedUnit: frogProjectedUnit(
          frogMesh,
          frogEigenbasis,
          vertexGradient(frogMesh, alpha),
          vertexGradient(frogMesh, betaIndependent),
        ),
      };
    }
  }

  reset(parameters: Partial<ControlledClebschParameters>): void {
    this.parameters = { ...this.parameters, ...parameters };
    assertParameters(this.parameters);
  }

  private crossingWeights(): { parallel: number; transverse: number } {
    const angle = 0.5 * Math.PI * this.parameters.crossing;
    return { parallel: Math.cos(angle), transverse: Math.sin(angle) };
  }

  sampleParameter(surface: "plane" | "torus", u: number, v: number): ControlledClebschSample {
    const geometry = parameterGeometry(surface, u, v);
    const { labelStrength: strength, potentialStrength: potential } = this.parameters;
    const weights = this.crossingWeights();
    const alpha = strength * Math.sin(u);
    const beta = weights.parallel * Math.sin(u) + weights.transverse * Math.sin(v);
    const phi = potential * Math.cos(u - v);
    const dAlpha = parameterGradient(geometry, strength * Math.cos(u), 0);
    const dBeta = parameterGradient(
      geometry,
      weights.parallel * Math.cos(u),
      weights.transverse * Math.cos(v),
    );
    const dPhi = parameterGradient(
      geometry,
      -potential * Math.sin(u - v),
      potential * Math.sin(u - v),
    );
    const projectedVelocity = surface === "plane"
      ? (() => {
        const scaleFactor = PLANE_WIDTH / TAU;
        const streamGradient = parameterGradient(
          geometry,
          0.5 * strength * weights.transverse * scaleFactor ** 2 * Math.sin(u) * Math.cos(v),
          0.5 * strength * weights.transverse * scaleFactor ** 2 * Math.cos(u) * Math.sin(v),
        );
        return cross(geometry.normal, streamGradient);
      })()
      : scale(this.sampleTorusProjection(u, v), strength * weights.transverse);
    return this.finishSample(
      geometry.position,
      geometry.normal,
      alpha,
      beta,
      phi,
      dAlpha,
      dBeta,
      dPhi,
      projectedVelocity,
    );
  }

  sampleTaylorGreenPlane(u: number, v: number): ControlledClebschSample {
    const geometry = parameterGeometry("plane", u, v);
    const fields = evaluateTaylorGreenClebsch(
      u,
      v,
      this.parameters.labelStrength,
      this.parameters.potentialStrength,
    );
    return this.finishSample(
      geometry.position,
      geometry.normal,
      fields.alpha,
      fields.beta,
      fields.phi,
      parameterGradient(geometry, fields.dAlpha[0], fields.dAlpha[1]),
      parameterGradient(geometry, fields.dBeta[0], fields.dBeta[1]),
      parameterGradient(geometry, fields.dPhi[0], fields.dPhi[1]),
      parameterGradient(geometry, fields.projectedCovector[0], fields.projectedCovector[1]),
    );
  }

  sampleSphere(position: Vec3): ControlledClebschSample {
    const point = normalize(position);
    const { labelStrength: strength, potentialStrength: potential } = this.parameters;
    const weights = this.crossingWeights();
    const alpha = strength * point.z;
    const beta = weights.parallel * point.z + weights.transverse * point.x;
    const phi = potential * point.y;
    const dAlpha = scale(tangent({ x: 0, y: 0, z: 1 }, point), strength);
    const dBeta = tangent({ x: weights.transverse, y: 0, z: weights.parallel }, point);
    const dPhi = scale(tangent({ x: 0, y: 1, z: 0 }, point), potential);
    const streamGradient = scale(tangent({ x: 0, y: 1, z: 0 }, point), -0.5 * strength * weights.transverse);
    return this.finishSample(
      point,
      point,
      alpha,
      beta,
      phi,
      dAlpha,
      dBeta,
      dPhi,
      cross(point, streamGradient),
    );
  }

  sampleFrogVertex(vertex: number): ControlledClebschSample {
    if (!this.frogMesh || !this.frogFields) throw new Error("No frog basis was supplied.");
    if (!Number.isInteger(vertex) || vertex < 0 || vertex >= this.frogFields.alpha.length) {
      throw new Error("frog vertex is out of range");
    }
    const { labelStrength: strength, potentialStrength: potential } = this.parameters;
    const weights = this.crossingWeights();
    const alphaBase = this.frogFields.alpha[vertex]!;
    const betaBase = this.frogFields.betaIndependent[vertex]!;
    const alpha = strength * alphaBase;
    const beta = weights.parallel * alphaBase + weights.transverse * betaBase;
    const phi = potential * this.frogFields.phi[vertex]!;
    const dAlphaBase = arrayVector(this.frogFields.dAlpha, vertex);
    const dBetaBase = arrayVector(this.frogFields.dBetaIndependent, vertex);
    const dAlpha = scale(dAlphaBase, strength);
    const dBeta = add(scale(dAlphaBase, weights.parallel), scale(dBetaBase, weights.transverse));
    const dPhi = scale(arrayVector(this.frogFields.dPhi, vertex), potential);
    return this.finishSample(
      arrayVector(this.frogMesh.positions, vertex),
      arrayVector(this.frogMesh.vertexNormals, vertex),
      alpha,
      beta,
      phi,
      dAlpha,
      dBeta,
      dPhi,
      scale(arrayVector(this.frogFields.projectedUnit, vertex), strength * weights.transverse),
    );
  }

  private sampleTorusProjection(u: number, v: number): Vec3 {
    const grid = this.torusProjection;
    const wrappedU = ((u % TAU) + TAU) % TAU;
    const wrappedV = ((v % TAU) + TAU) % TAU;
    const column = wrappedU / grid.dU;
    const row = wrappedV / grid.dV;
    const column0 = Math.floor(column) % grid.columns;
    const row0 = Math.floor(row) % grid.rows;
    const column1 = (column0 + 1) % grid.columns;
    const row1 = (row0 + 1) % grid.rows;
    const tx = column - Math.floor(column);
    const ty = row - Math.floor(row);
    const at = (r: number, c: number): number => grid.streamFunction[r * grid.columns + c]!;
    const derivativeU = (r: number, c: number): number => (
      at(r, (c + 1) % grid.columns) - at(r, (c - 1 + grid.columns) % grid.columns)
    ) / (2 * grid.dU);
    const derivativeV = (r: number, c: number): number => (
      at((r + 1) % grid.rows, c) - at((r - 1 + grid.rows) % grid.rows, c)
    ) / (2 * grid.dV);
    const interpolate = (values: [number, number, number, number]): number => (
      (1 - ty) * ((1 - tx) * values[0] + tx * values[1])
      + ty * ((1 - tx) * values[2] + tx * values[3])
    );
    const geometry = parameterGeometry("torus", wrappedU, wrappedV);
    const gradient = parameterGradient(
      geometry,
      interpolate([
        derivativeU(row0, column0), derivativeU(row0, column1),
        derivativeU(row1, column0), derivativeU(row1, column1),
      ]),
      interpolate([
        derivativeV(row0, column0), derivativeV(row0, column1),
        derivativeV(row1, column0), derivativeV(row1, column1),
      ]),
    );
    return cross(geometry.normal, gradient);
  }

  private finishSample(
    position: Vec3,
    normal: Vec3,
    alpha: number,
    beta: number,
    phi: number,
    dAlpha: Vec3,
    dBeta: Vec3,
    dPhi: Vec3,
    projectedVelocity: Vec3,
  ): ControlledClebschSample {
    const alphaDBeta = scale(dBeta, alpha);
    const velocity = add(dPhi, alphaDBeta);
    return {
      position,
      normal,
      alpha,
      beta,
      phi,
      dAlpha,
      dBeta,
      dPhi,
      alphaDBeta,
      velocity,
      projectedVelocity,
      divergentVelocity: subtract(velocity, projectedVelocity),
      vorticity: dot(normal, cross(dAlpha, dBeta)),
    };
  }
}
