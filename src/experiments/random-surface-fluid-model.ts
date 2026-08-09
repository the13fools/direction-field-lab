export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type RandomFluidSurface = "square" | "sphere" | "torus";
export type FlowProjection = "curl-free" | "divergence-free" | "clebsch" | "clebsch-projected";

export interface RandomSurfaceFluidParameters {
  surface: RandomFluidSurface;
  projection: FlowProjection;
  seed: number;
  modeCount: number;
  maxBand: number;
  spectralSlope: number;
  turnover: number;
  speed: number;
  timeStep: number;
  particleCount: number;
}

export interface FluidParticle {
  surface: RandomFluidSurface;
  position?: Vec3;
  u?: number;
  v?: number;
  group: 0 | 1;
}

export interface FieldSample {
  position: Vec3;
  normal: Vec3;
  velocity: Vec3;
  divergence: number;
  vorticity: number;
  u?: number;
  v?: number;
}

export interface RandomFluidDiagnostics {
  rmsSpeed: number;
  maxSpeed: number;
  tangencyResidual: number;
  divergenceResidual: number;
  vorticityRms: number;
  fieldCorrelation: number;
}

export interface SpectrumBand {
  band: number;
  energy: number;
  share: number;
  modes: number;
}

interface FluidMode {
  band: number;
  frequency: number;
  amplitude: number;
  phase: number;
  timeOffset: number;
  timeRate: number;
  noiseSeed: number;
  axis: Vec3;
  k: number;
  l: number;
}

interface SphereScalarSample {
  value: number;
  gradient: Vec3;
}

interface ParameterScalarSample {
  value: number;
  derivativeU: number;
  derivativeV: number;
}

interface ParameterGeometry {
  position: Vec3;
  normal: Vec3;
  partialU: Vec3;
  partialV: Vec3;
  metricU: number;
  metricV: number;
  area: number;
}

interface ProjectionCell extends ParameterGeometry {
  covectorU: number;
  covectorV: number;
  coefficientU: number;
  coefficientV: number;
}

interface ProjectionGrid {
  surface: RandomFluidSurface;
  time: number;
  columns: number;
  rows: number;
  stepU: number;
  stepV: number;
  streamFunction: Float64Array;
}

const TAU = 2 * Math.PI;
const SQUARE_WIDTH = 2.8;
const SQUARE_PARAMETER_SCALE = SQUARE_WIDTH / TAU;
const TORUS_MAJOR_RADIUS = 1.25;
const TORUS_MINOR_RADIUS = 0.46;

export const DEFAULT_RANDOM_SURFACE_FLUID_PARAMETERS: RandomSurfaceFluidParameters = {
  surface: "sphere",
  projection: "clebsch-projected",
  seed: 13,
  modeCount: 28,
  maxBand: 7,
  spectralSlope: 5 / 3,
  turnover: 0.42,
  speed: 0.62,
  timeStep: 0.018,
  particleCount: 1000,
};

function isClebschProjection(projection: FlowProjection): boolean {
  return projection === "clebsch" || projection === "clebsch-projected";
}

function assertParameters(parameters: RandomSurfaceFluidParameters): void {
  if (!["square", "sphere", "torus"].includes(parameters.surface)) {
    throw new Error("surface must be square, sphere, or torus");
  }
  if (!["curl-free", "divergence-free", "clebsch", "clebsch-projected"].includes(parameters.projection)) {
    throw new Error("projection must be curl-free, divergence-free, clebsch, or clebsch-projected");
  }
  if (!Number.isInteger(parameters.seed)) throw new Error("seed must be an integer");
  if (!Number.isInteger(parameters.modeCount) || parameters.modeCount < 1 || parameters.modeCount > 160) {
    throw new Error("modeCount must be an integer from 1 through 160");
  }
  if (!Number.isInteger(parameters.maxBand) || parameters.maxBand < 1 || parameters.maxBand > 18) {
    throw new Error("maxBand must be an integer from 1 through 18");
  }
  if (!Number.isInteger(parameters.particleCount) || parameters.particleCount < 8 || parameters.particleCount > 3000) {
    throw new Error("particleCount must be an integer from 8 through 3000");
  }
  for (const [name, value] of Object.entries(parameters)) {
    if (name !== "surface" && name !== "projection" && !Number.isFinite(value)) {
      throw new Error(`${name} must be finite`);
    }
  }
  if (parameters.spectralSlope < 0 || parameters.spectralSlope > 6) {
    throw new Error("spectralSlope must be between 0 and 6");
  }
  if (parameters.turnover < 0 || parameters.speed < 0 || parameters.timeStep <= 0) {
    throw new Error("turnover and speed must be nonnegative and timeStep must be positive");
  }
}

function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function scale(a: Vec3, amount: number): Vec3 {
  return { x: amount * a.x, y: amount * a.y, z: amount * a.z };
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

function norm(a: Vec3): number {
  return Math.hypot(a.x, a.y, a.z);
}

function normalize(a: Vec3): Vec3 {
  const length = norm(a);
  if (length < 1e-14) return { x: 1, y: 0, z: 0 };
  return scale(a, 1 / length);
}

function wrapAngle(value: number): number {
  return ((value % TAU) + TAU) % TAU;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = value + Math.imul(value ^ (value >>> 7), 61 | value) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function hash01(index: number, seed: number): number {
  let value = Math.imul(index ^ seed, 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value ^= value >>> 16;
  return (value >>> 0) / 4294967295;
}

function fade(value: number): number {
  return value ** 3 * (value * (value * 6 - 15) + 10);
}

export function temporalPerlinNoise(position: number, seed: number): number {
  const left = Math.floor(position);
  const fraction = position - left;
  const gradientLeft = 2 * hash01(left, seed) - 1;
  const gradientRight = 2 * hash01(left + 1, seed) - 1;
  const contributionLeft = gradientLeft * fraction;
  const contributionRight = gradientRight * (fraction - 1);
  return 2.4 * (
    contributionLeft
    + fade(fraction) * (contributionRight - contributionLeft)
  );
}

function randomUnitVector(random: () => number): Vec3 {
  const z = 2 * random() - 1;
  const azimuth = TAU * random();
  const radius = Math.sqrt(Math.max(0, 1 - z * z));
  return { x: radius * Math.cos(azimuth), y: radius * Math.sin(azimuth), z };
}

function gaussian(random: () => number): number {
  const radius = Math.sqrt(-2 * Math.log(Math.max(1e-12, random())));
  return radius * Math.cos(TAU * random());
}

function fibonacciSphere(count: number): Vec3[] {
  const result: Vec3[] = [];
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  for (let index = 0; index < count; index += 1) {
    const z = 1 - 2 * (index + 0.5) / count;
    const radius = Math.sqrt(Math.max(0, 1 - z * z));
    const angle = goldenAngle * index;
    result.push({ x: radius * Math.cos(angle), y: radius * Math.sin(angle), z });
  }
  return result;
}

export function squarePosition(u: number, v: number): Vec3 {
  return {
    x: SQUARE_PARAMETER_SCALE * (wrapAngle(u) - Math.PI),
    y: SQUARE_PARAMETER_SCALE * (wrapAngle(v) - Math.PI),
    z: 0,
  };
}

export function torusPosition(u: number, v: number): Vec3 {
  const radial = TORUS_MAJOR_RADIUS + TORUS_MINOR_RADIUS * Math.cos(v);
  return {
    x: radial * Math.cos(u),
    y: radial * Math.sin(u),
    z: TORUS_MINOR_RADIUS * Math.sin(v),
  };
}

export function torusNormal(u: number, v: number): Vec3 {
  return {
    x: Math.cos(u) * Math.cos(v),
    y: Math.sin(u) * Math.cos(v),
    z: Math.sin(v),
  };
}

function parameterGeometry(surface: "square" | "torus", u: number, v: number): ParameterGeometry {
  if (surface === "square") {
    const metric = SQUARE_PARAMETER_SCALE ** 2;
    return {
      position: squarePosition(u, v),
      normal: { x: 0, y: 0, z: 1 },
      partialU: { x: SQUARE_PARAMETER_SCALE, y: 0, z: 0 },
      partialV: { x: 0, y: SQUARE_PARAMETER_SCALE, z: 0 },
      metricU: metric,
      metricV: metric,
      area: metric,
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
    position: torusPosition(u, v),
    normal: torusNormal(u, v),
    partialU,
    partialV,
    metricU: radial ** 2,
    metricV: TORUS_MINOR_RADIUS ** 2,
    area: TORUS_MINOR_RADIUS * radial,
  };
}

function projectionGeometry(surface: RandomFluidSurface, u: number, v: number): ParameterGeometry {
  if (surface !== "sphere") return parameterGeometry(surface, u, v);
  const sine = Math.sin(v);
  const cosine = Math.cos(v);
  const cosineU = Math.cos(u);
  const sineU = Math.sin(u);
  return {
    position: { x: sine * cosineU, y: sine * sineU, z: cosine },
    normal: { x: sine * cosineU, y: sine * sineU, z: cosine },
    partialU: { x: -sine * sineU, y: sine * cosineU, z: 0 },
    partialV: { x: cosine * cosineU, y: cosine * sineU, z: -sine },
    metricU: sine ** 2,
    metricV: 1,
    area: sine,
  };
}

function sphereExponential(point: Vec3, direction: Vec3, distance: number): Vec3 {
  const tangent = normalize(add(direction, scale(point, -dot(point, direction))));
  return add(scale(point, Math.cos(distance)), scale(tangent, Math.sin(distance)));
}

export class RandomSurfaceFluidModel {
  parameters: RandomSurfaceFluidParameters;
  particles: FluidParticle[] = [];
  time = 0;
  steps = 0;
  private primaryModes: FluidMode[] = [];
  private alphaModes: FluidMode[] = [];
  private betaModes: FluidMode[] = [];
  private velocityScale = 1;
  private clebschPhiScale = 1;
  private clebschAlphaScale = 1;
  private clebschBetaScale = 1;
  private projectionCache = new Map<number, ProjectionGrid>();

  constructor(parameters: Partial<RandomSurfaceFluidParameters> = {}) {
    this.parameters = { ...DEFAULT_RANDOM_SURFACE_FLUID_PARAMETERS, ...parameters };
    assertParameters(this.parameters);
    this.rebuild();
  }

  reset(parameters: Partial<RandomSurfaceFluidParameters> = {}): void {
    this.parameters = { ...this.parameters, ...parameters };
    assertParameters(this.parameters);
    this.rebuild();
  }

  private rebuild(): void {
    this.time = 0;
    this.steps = 0;
    this.makeModes();
    this.projectionCache.clear();
    this.calibrateClebschComponents();
    this.calibrateVelocity();
    this.resetParticles();
  }

  private makeModeSet(random: () => number, seedOffset: number): FluidMode[] {
    const modes: FluidMode[] = [];
    for (let index = 0; index < this.parameters.modeCount; index += 1) {
      const band = 1 + (index % this.parameters.maxBand);
      const axis = randomUnitVector(random);
      let k = 0;
      let l = 0;
      if (random() < 0.5) {
        k = (random() < 0.5 ? -1 : 1) * band;
        l = Math.round((2 * random() - 1) * band);
      } else {
        l = (random() < 0.5 ? -1 : 1) * band;
        k = Math.round((2 * random() - 1) * band);
      }
      const frequency = this.parameters.surface === "sphere"
        ? Math.PI * band
        : Math.max(1, Math.hypot(k, l));
      const amplitude = (random() < 0.5 ? -1 : 1)
        * frequency ** (-(this.parameters.spectralSlope + 2) / 2);
      modes.push({
        band,
        frequency,
        amplitude,
        phase: TAU * random(),
        timeOffset: 40 * random() + 0.371 * seedOffset,
        timeRate: this.parameters.turnover * (0.42 + 0.3 * random()) * Math.sqrt(band),
        noiseSeed: (this.parameters.seed + seedOffset + 104729 * index) | 0,
        axis,
        k,
        l,
      });
    }
    return modes;
  }

  private makeModes(): void {
    const random = mulberry32(this.parameters.seed);
    this.primaryModes = this.makeModeSet(random, 101);
    this.alphaModes = this.makeModeSet(random, 1009);
    this.betaModes = this.makeModeSet(random, 10007);
  }

  private temporalState(mode: FluidMode, time: number): { amplitude: number; phase: number } {
    const coordinate = mode.timeOffset + time * mode.timeRate;
    const envelope = 0.78 + 0.32 * temporalPerlinNoise(coordinate + 13.7, mode.noiseSeed + 17);
    const phase = 1.85 * temporalPerlinNoise(coordinate, mode.noiseSeed);
    return { amplitude: envelope, phase };
  }

  private sphereScalar(modes: readonly FluidMode[], point: Vec3, time: number): SphereScalarSample {
    let value = 0;
    let gradient: Vec3 = { x: 0, y: 0, z: 0 };
    for (const mode of modes) {
      const temporal = this.temporalState(mode, time);
      const argument = mode.frequency * dot(mode.axis, point) + mode.phase + temporal.phase;
      const amplitude = mode.amplitude * temporal.amplitude;
      value += amplitude * Math.sin(argument);
      gradient = add(gradient, scale(mode.axis, amplitude * mode.frequency * Math.cos(argument)));
    }
    gradient = add(gradient, scale(point, -dot(point, gradient)));
    return { value, gradient };
  }

  private parameterScalar(
    modes: readonly FluidMode[],
    u: number,
    v: number,
    time: number,
  ): ParameterScalarSample {
    let value = 0;
    let derivativeU = 0;
    let derivativeV = 0;
    for (const mode of modes) {
      const temporal = this.temporalState(mode, time);
      const argument = mode.k * u + mode.l * v + mode.phase + temporal.phase;
      const amplitude = mode.amplitude * temporal.amplitude;
      value += amplitude * Math.sin(argument);
      const cosine = amplitude * Math.cos(argument);
      derivativeU += mode.k * cosine;
      derivativeV += mode.l * cosine;
    }
    return { value, derivativeU, derivativeV };
  }

  private parameterGradient(sample: ParameterScalarSample, geometry: ParameterGeometry): Vec3 {
    return add(
      scale(geometry.partialU, sample.derivativeU / geometry.metricU),
      scale(geometry.partialV, sample.derivativeV / geometry.metricV),
    );
  }

  private sphereClebschVelocity(point: Vec3, time: number): Vec3 {
    const primary = this.sphereScalar(this.primaryModes, point, time);
    const alpha = this.sphereScalar(this.alphaModes, point, time);
    const beta = this.sphereScalar(this.betaModes, point, time);
    return add(
      scale(primary.gradient, this.clebschPhiScale),
      scale(beta.gradient, this.clebschAlphaScale * alpha.value * this.clebschBetaScale),
    );
  }

  private sphereRawVelocity(point: Vec3, time: number): Vec3 {
    const primary = this.sphereScalar(this.primaryModes, point, time);
    if (this.parameters.projection === "curl-free") return primary.gradient;
    if (this.parameters.projection === "divergence-free") return cross(point, primary.gradient);
    if (this.parameters.projection === "clebsch-projected") {
      return this.projectedClebschVelocity(point, undefined, undefined, time);
    }
    return this.sphereClebschVelocity(point, time);
  }

  private parameterClebschVelocity(
    surface: "square" | "torus",
    u: number,
    v: number,
    time: number,
  ): Vec3 {
    const geometry = parameterGeometry(surface, u, v);
    const primary = this.parameterScalar(this.primaryModes, u, v, time);
    const alpha = this.parameterScalar(this.alphaModes, u, v, time);
    const beta = this.parameterScalar(this.betaModes, u, v, time);
    const primaryGradient = this.parameterGradient(primary, geometry);
    const betaGradient = this.parameterGradient(beta, geometry);
    return add(
      scale(primaryGradient, this.clebschPhiScale),
      scale(betaGradient, this.clebschAlphaScale * alpha.value * this.clebschBetaScale),
    );
  }

  private parameterRawVelocity(
    surface: "square" | "torus",
    u: number,
    v: number,
    time: number,
  ): Vec3 {
    const geometry = parameterGeometry(surface, u, v);
    const primary = this.parameterScalar(this.primaryModes, u, v, time);
    const primaryGradient = this.parameterGradient(primary, geometry);
    if (this.parameters.projection === "curl-free") return primaryGradient;
    if (this.parameters.projection === "divergence-free") {
      return cross(geometry.normal, primaryGradient);
    }
    if (this.parameters.projection === "clebsch-projected") {
      return this.projectedClebschVelocity(undefined, u, v, time);
    }
    return this.parameterClebschVelocity(surface, u, v, time);
  }

  private buildProjectionGrid(time: number): ProjectionGrid {
    const surface = this.parameters.surface;
    const columns = surface === "square" ? 36 : 32;
    const rows = surface === "sphere" ? 18 : surface === "square" ? 36 : 24;
    const periodV = surface === "sphere" ? Math.PI : TAU;
    const stepU = TAU / columns;
    const stepV = periodV / rows;
    const cells: ProjectionCell[] = [];
    const index = (row: number, column: number): number => row * columns + ((column % columns) + columns) % columns;

    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const u = (column + 0.5) * stepU;
        const v = (row + 0.5) * stepV;
        const geometry = projectionGeometry(surface, u, v);
        const rawVelocity = surface === "sphere"
          ? this.sphereClebschVelocity(geometry.position, time)
          : this.parameterClebschVelocity(surface, u, v, time);
        const covectorU = dot(rawVelocity, geometry.partialU);
        const covectorV = dot(rawVelocity, geometry.partialV);
        cells.push({
          ...geometry,
          covectorU,
          covectorV,
          coefficientU: geometry.area / geometry.metricU,
          coefficientV: geometry.area / geometry.metricV,
        });
      }
    }

    const vorticity = new Float64Array(cells.length);
    let weightedVorticity = 0;
    let totalArea = 0;
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const cellIndex = index(row, column);
        const cell = cells[cellIndex]!;
        const east = cells[index(row, column + 1)]!;
        const west = cells[index(row, column - 1)]!;
        const north = row > 0 ? cells[index(row - 1, column)]! : undefined;
        const south = row + 1 < rows ? cells[index(row + 1, column)]! : undefined;
        const covectorVEast = 0.5 * (cell.covectorV + east.covectorV);
        const covectorVWest = 0.5 * (cell.covectorV + west.covectorV);
        const covectorUNorth = surface === "sphere" && !north
          ? 0
          : 0.5 * (cell.covectorU + (north ?? cells[index(rows - 1, column)]!).covectorU);
        const covectorUSouth = surface === "sphere" && !south
          ? 0
          : 0.5 * (cell.covectorU + (south ?? cells[index(0, column)]!).covectorU);
        const value = (
          (covectorVEast - covectorVWest) / stepU
          - (covectorUSouth - covectorUNorth) / stepV
        ) / cell.area;
        vorticity[cellIndex] = value;
        weightedVorticity += value * cell.area;
        totalArea += cell.area;
      }
    }
    const vorticityMean = weightedVorticity / Math.max(1e-14, totalArea);
    for (let cellIndex = 0; cellIndex < vorticity.length; cellIndex += 1) {
      vorticity[cellIndex] = vorticity[cellIndex]! - vorticityMean;
    }

    const potential = new Float64Array(cells.length);
    const relaxation = 1.55;
    for (let iteration = 0; iteration < 240; iteration += 1) {
      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          const cellIndex = index(row, column);
          const cell = cells[cellIndex]!;
          const eastIndex = index(row, column + 1);
          const westIndex = index(row, column - 1);
          const northIndex = row > 0 ? index(row - 1, column) : -1;
          const southIndex = row + 1 < rows ? index(row + 1, column) : -1;
          const wrappedNorthIndex = northIndex >= 0 ? northIndex : index(rows - 1, column);
          const wrappedSouthIndex = southIndex >= 0 ? southIndex : index(0, column);
          const eastCoefficient = 0.5 * (cell.coefficientU + cells[eastIndex]!.coefficientU) / stepU ** 2;
          const westCoefficient = 0.5 * (cell.coefficientU + cells[westIndex]!.coefficientU) / stepU ** 2;
          const northCoefficient = surface === "sphere" && northIndex < 0
            ? 0
            : 0.5 * (cell.coefficientV + cells[wrappedNorthIndex]!.coefficientV) / stepV ** 2;
          const southCoefficient = surface === "sphere" && southIndex < 0
            ? 0
            : 0.5 * (cell.coefficientV + cells[wrappedSouthIndex]!.coefficientV) / stepV ** 2;
          const diagonal = eastCoefficient + westCoefficient + northCoefficient + southCoefficient;
          const estimate = (
            eastCoefficient * potential[eastIndex]!
            + westCoefficient * potential[westIndex]!
            + northCoefficient * potential[wrappedNorthIndex]!
            + southCoefficient * potential[wrappedSouthIndex]!
            - cell.area * vorticity[cellIndex]!
          ) / Math.max(1e-14, diagonal);
          potential[cellIndex] = (1 - relaxation) * potential[cellIndex]! + relaxation * estimate;
        }
      }
      if (iteration % 12 === 11) {
        let mean = 0;
        for (let cellIndex = 0; cellIndex < cells.length; cellIndex += 1) {
          mean += potential[cellIndex]! * cells[cellIndex]!.area;
        }
        mean /= Math.max(1e-14, totalArea);
        for (let cellIndex = 0; cellIndex < potential.length; cellIndex += 1) {
          potential[cellIndex] = potential[cellIndex]! - mean;
        }
      }
    }

    return { surface, time, columns, rows, stepU, stepV, streamFunction: potential };
  }

  private projectionGrid(time: number): ProjectionGrid {
    const cached = this.projectionCache.get(time);
    if (cached) return cached;
    const grid = this.buildProjectionGrid(time);
    this.projectionCache.set(time, grid);
    while (this.projectionCache.size > 6) {
      const oldest = this.projectionCache.keys().next().value as number | undefined;
      if (oldest === undefined) break;
      this.projectionCache.delete(oldest);
    }
    return grid;
  }

  private projectedClebschVelocity(point: Vec3 | undefined, u: number | undefined, v: number | undefined, time: number): Vec3 {
    const grid = this.projectionGrid(time);
    let coordinateU = u;
    let coordinateV = v;
    let normal: Vec3;
    if (grid.surface === "sphere") {
      const unit = normalize(point!);
      coordinateU = wrapAngle(Math.atan2(unit.y, unit.x));
      coordinateV = Math.acos(Math.max(-1, Math.min(1, unit.z)));
      normal = unit;
    } else {
      const geometry = parameterGeometry(grid.surface, coordinateU!, coordinateV!);
      normal = geometry.normal;
    }
    const periodV = grid.surface === "sphere" ? Math.PI : TAU;
    const x = wrapAngle(coordinateU!) / TAU * grid.columns - 0.5;
    const rawY = coordinateV! / periodV * grid.rows - 0.5;
    const y = grid.surface === "sphere"
      ? Math.max(0, Math.min(grid.rows - 1, rawY))
      : ((rawY % grid.rows) + grid.rows) % grid.rows;
    const column1 = Math.floor(x);
    const row1 = Math.floor(y);
    const blendU = x - column1;
    const blendV = y - row1;
    const wrapColumn = (column: number): number => ((column % grid.columns) + grid.columns) % grid.columns;
    const wrapRow = (row: number): number => grid.surface === "sphere"
      ? Math.max(0, Math.min(grid.rows - 1, row))
      : ((row % grid.rows) + grid.rows) % grid.rows;
    const at = (row: number, column: number): number => grid.streamFunction[wrapRow(row) * grid.columns + wrapColumn(column)]!;
    const cubicValue = (p0: number, p1: number, p2: number, p3: number, amount: number): number => {
      const amount2 = amount * amount;
      const amount3 = amount2 * amount;
      return 0.5 * (
        2 * p1
        + (-p0 + p2) * amount
        + (2 * p0 - 5 * p1 + 4 * p2 - p3) * amount2
        + (-p0 + 3 * p1 - 3 * p2 + p3) * amount3
      );
    };
    const cubicDerivative = (p0: number, p1: number, p2: number, p3: number, amount: number): number => {
      const amount2 = amount * amount;
      return 0.5 * (
        -p0 + p2
        + 2 * (2 * p0 - 5 * p1 + 4 * p2 - p3) * amount
        + 3 * (-p0 + 3 * p1 - 3 * p2 + p3) * amount2
      );
    };
    const rowValues: number[] = [];
    const rowDerivativesU: number[] = [];
    for (let offsetV = -1; offsetV <= 2; offsetV += 1) {
      const row = row1 + offsetV;
      const p0 = at(row, column1 - 1);
      const p1 = at(row, column1);
      const p2 = at(row, column1 + 1);
      const p3 = at(row, column1 + 2);
      rowValues.push(cubicValue(p0, p1, p2, p3, blendU));
      rowDerivativesU.push(cubicDerivative(p0, p1, p2, p3, blendU));
    }
    const derivativeU = cubicValue(
      rowDerivativesU[0]!, rowDerivativesU[1]!, rowDerivativesU[2]!, rowDerivativesU[3]!, blendV,
    ) / grid.stepU;
    const derivativeV = cubicDerivative(
      rowValues[0]!, rowValues[1]!, rowValues[2]!, rowValues[3]!, blendV,
    ) / grid.stepV;
    const sampleV = grid.surface === "sphere"
      ? Math.max(0.5 * grid.stepV, Math.min(Math.PI - 0.5 * grid.stepV, coordinateV!))
      : coordinateV!;
    const geometry = projectionGeometry(grid.surface, coordinateU!, sampleV);
    const gradient = add(
      scale(geometry.partialU, derivativeU / geometry.metricU),
      scale(geometry.partialV, derivativeV / geometry.metricV),
    );
    const projected = cross(normal, gradient);
    return add(projected, scale(normal, -dot(projected, normal)));
  }

  private calibrationSamples(): Array<{ point?: Vec3; u?: number; v?: number }> {
    if (this.parameters.surface === "sphere") {
      return fibonacciSphere(120).map((point) => ({ point }));
    }
    const samples: Array<{ u: number; v: number }> = [];
    for (let row = 0; row < 10; row += 1) {
      for (let column = 0; column < 20; column += 1) {
        samples.push({ u: TAU * column / 20, v: TAU * (row + 0.5) / 10 });
      }
    }
    return samples;
  }

  private calibrateClebschComponents(): void {
    this.clebschPhiScale = 1;
    this.clebschAlphaScale = 1;
    this.clebschBetaScale = 1;
    if (!isClebschProjection(this.parameters.projection)) return;
    let phiGradient2 = 0;
    let alpha2 = 0;
    let betaGradient2 = 0;
    const samples = this.calibrationSamples();
    for (const sample of samples) {
      if (this.parameters.surface === "sphere") {
        const point = sample.point!;
        const phi = this.sphereScalar(this.primaryModes, point, 0);
        const alpha = this.sphereScalar(this.alphaModes, point, 0);
        const beta = this.sphereScalar(this.betaModes, point, 0);
        phiGradient2 += dot(phi.gradient, phi.gradient);
        alpha2 += alpha.value ** 2;
        betaGradient2 += dot(beta.gradient, beta.gradient);
      } else {
        const surface = this.parameters.surface;
        const geometry = parameterGeometry(surface, sample.u!, sample.v!);
        const phi = this.parameterScalar(this.primaryModes, sample.u!, sample.v!, 0);
        const alpha = this.parameterScalar(this.alphaModes, sample.u!, sample.v!, 0);
        const beta = this.parameterScalar(this.betaModes, sample.u!, sample.v!, 0);
        const phiGradient = this.parameterGradient(phi, geometry);
        const betaGradient = this.parameterGradient(beta, geometry);
        phiGradient2 += dot(phiGradient, phiGradient);
        alpha2 += alpha.value ** 2;
        betaGradient2 += dot(betaGradient, betaGradient);
      }
    }
    const count = Math.max(1, samples.length);
    this.clebschPhiScale = 0.3 / Math.max(1e-12, Math.sqrt(phiGradient2 / count));
    this.clebschAlphaScale = 1 / Math.max(1e-12, Math.sqrt(alpha2 / count));
    this.clebschBetaScale = 1 / Math.max(1e-12, Math.sqrt(betaGradient2 / count));
  }

  private calibrateVelocity(): void {
    let speed2 = 0;
    const samples = this.calibrationSamples();
    for (const sample of samples) {
      const velocity = this.parameters.surface === "sphere"
        ? this.sphereRawVelocity(sample.point!, 0)
        : this.parameterRawVelocity(this.parameters.surface, sample.u!, sample.v!, 0);
      speed2 += dot(velocity, velocity);
    }
    const rms = Math.sqrt(speed2 / Math.max(1, samples.length));
    this.velocityScale = rms > 1e-14 ? this.parameters.speed / rms : 0;
  }

  velocityAtSphere(point: Vec3, time = this.time): Vec3 {
    return scale(this.sphereRawVelocity(normalize(point), time), this.velocityScale);
  }

  velocityAtSquare(u: number, v: number, time = this.time): Vec3 {
    return scale(this.parameterRawVelocity("square", u, v, time), this.velocityScale);
  }

  velocityAtTorus(u: number, v: number, time = this.time): Vec3 {
    return scale(this.parameterRawVelocity("torus", u, v, time), this.velocityScale);
  }

  private parameterRates(
    surface: "square" | "torus",
    u: number,
    v: number,
    time: number,
  ): { u: number; v: number } {
    const geometry = parameterGeometry(surface, u, v);
    const velocity = surface === "square"
      ? this.velocityAtSquare(u, v, time)
      : this.velocityAtTorus(u, v, time);
    return {
      u: dot(velocity, geometry.partialU) / geometry.metricU,
      v: dot(velocity, geometry.partialV) / geometry.metricV,
    };
  }

  resetParticles(): void {
    const random = mulberry32(this.parameters.seed ^ 0x9e3779b9);
    this.particles = [];
    if (this.parameters.surface === "sphere") {
      const centers = [normalize({ x: 0.72, y: -0.18, z: 0.67 }), normalize({ x: 0.28, y: 0.88, z: 0.38 })];
      for (let index = 0; index < this.parameters.particleCount; index += 1) {
        const group = (index % 2) as 0 | 1;
        const center = centers[group]!;
        const reference = Math.abs(center.z) < 0.9 ? { x: 0, y: 0, z: 1 } : { x: 0, y: 1, z: 0 };
        const tangentA = normalize(cross(reference, center));
        const tangentB = cross(center, tangentA);
        const offsetA = 0.18 * gaussian(random);
        const offsetB = 0.18 * gaussian(random);
        const tangent = add(scale(tangentA, offsetA), scale(tangentB, offsetB));
        const radius = norm(tangent);
        const position = radius < 1e-12
          ? center
          : sphereExponential(center, tangent, Math.min(0.48, radius));
        this.particles.push({ surface: "sphere", position, group });
      }
      return;
    }
    const centers = this.parameters.surface === "square"
      ? [{ u: 1.2, v: 1.35 }, { u: 4.15, v: 4.35 }]
      : [{ u: 0.2, v: 0.35 }, { u: 1.1, v: 3.35 }];
    for (let index = 0; index < this.parameters.particleCount; index += 1) {
      const group = (index % 2) as 0 | 1;
      const center = centers[group]!;
      this.particles.push({
        surface: this.parameters.surface,
        u: wrapAngle(center.u + 0.22 * gaussian(random)),
        v: wrapAngle(center.v + 0.25 * gaussian(random)),
        group,
      });
    }
  }

  particlePosition(particle: FluidParticle): Vec3 {
    if (particle.surface === "sphere") return particle.position!;
    if (particle.surface === "square") return squarePosition(particle.u!, particle.v!);
    return torusPosition(particle.u!, particle.v!);
  }

  step(count = 1): void {
    if (!Number.isInteger(count) || count < 1 || count > 200) {
      throw new Error("step count must be an integer from 1 through 200");
    }
    const dt = this.parameters.timeStep;
    for (let iteration = 0; iteration < count; iteration += 1) {
      const halfTime = this.time + 0.5 * dt;
      const firstTime = this.parameters.projection === "clebsch-projected" ? halfTime : this.time;
      for (const particle of this.particles) {
        if (particle.surface === "sphere") {
          const start = particle.position!;
          const first = this.velocityAtSphere(start, firstTime);
          const middle = normalize(add(start, scale(first, 0.5 * dt)));
          const second = this.velocityAtSphere(middle, halfTime);
          particle.position = normalize(add(start, scale(second, dt)));
        } else {
          const u = particle.u!;
          const v = particle.v!;
          const first = this.parameterRates(particle.surface, u, v, firstTime);
          const middleU = wrapAngle(u + 0.5 * dt * first.u);
          const middleV = wrapAngle(v + 0.5 * dt * first.v);
          const second = this.parameterRates(particle.surface, middleU, middleV, halfTime);
          particle.u = wrapAngle(u + dt * second.u);
          particle.v = wrapAngle(v + dt * second.v);
        }
      }
      this.time += dt;
      this.steps += 1;
    }
  }

  private sphereDifferentials(point: Vec3): { divergence: number; vorticity: number } {
    const reference = Math.abs(point.z) < 0.88 ? { x: 0, y: 0, z: 1 } : { x: 0, y: 1, z: 0 };
    const tangentA = normalize(cross(reference, point));
    const tangentB = cross(point, tangentA);
    const h = 2e-4;
    const plusA = sphereExponential(point, tangentA, h);
    const minusA = sphereExponential(point, tangentA, -h);
    const plusB = sphereExponential(point, tangentB, h);
    const minusB = sphereExponential(point, tangentB, -h);
    const velocityPlusA = this.velocityAtSphere(plusA);
    const velocityMinusA = this.velocityAtSphere(minusA);
    const velocityPlusB = this.velocityAtSphere(plusB);
    const velocityMinusB = this.velocityAtSphere(minusB);
    const transportedAPlus = add(scale(point, -Math.sin(h)), scale(tangentA, Math.cos(h)));
    const transportedAMinus = add(scale(point, Math.sin(h)), scale(tangentA, Math.cos(h)));
    const transportedBPlus = add(scale(point, -Math.sin(h)), scale(tangentB, Math.cos(h)));
    const transportedBMinus = add(scale(point, Math.sin(h)), scale(tangentB, Math.cos(h)));
    const derivativeAA = (dot(velocityPlusA, transportedAPlus) - dot(velocityMinusA, transportedAMinus)) / (2 * h);
    const derivativeBB = (dot(velocityPlusB, transportedBPlus) - dot(velocityMinusB, transportedBMinus)) / (2 * h);
    const derivativeAB = (dot(velocityPlusA, tangentB) - dot(velocityMinusA, tangentB)) / (2 * h);
    const derivativeBA = (dot(velocityPlusB, tangentA) - dot(velocityMinusB, tangentA)) / (2 * h);
    return { divergence: derivativeAA + derivativeBB, vorticity: derivativeAB - derivativeBA };
  }

  private parameterKinematics(
    surface: "square" | "torus",
    u: number,
    v: number,
  ): { fluxU: number; fluxV: number; covectorU: number; covectorV: number } {
    const geometry = parameterGeometry(surface, u, v);
    const velocity = surface === "square"
      ? this.velocityAtSquare(u, v)
      : this.velocityAtTorus(u, v);
    const covectorU = dot(velocity, geometry.partialU);
    const covectorV = dot(velocity, geometry.partialV);
    return {
      fluxU: geometry.area * covectorU / geometry.metricU,
      fluxV: geometry.area * covectorV / geometry.metricV,
      covectorU,
      covectorV,
    };
  }

  private parameterDifferentials(
    surface: "square" | "torus",
    u: number,
    v: number,
  ): { divergence: number; vorticity: number } {
    const h = 2e-4;
    const plusU = this.parameterKinematics(surface, u + h, v);
    const minusU = this.parameterKinematics(surface, u - h, v);
    const plusV = this.parameterKinematics(surface, u, v + h);
    const minusV = this.parameterKinematics(surface, u, v - h);
    const area = parameterGeometry(surface, u, v).area;
    return {
      divergence: (
        (plusU.fluxU - minusU.fluxU) / (2 * h)
        + (plusV.fluxV - minusV.fluxV) / (2 * h)
      ) / area,
      vorticity: (
        (plusU.covectorV - minusU.covectorV) / (2 * h)
        - (plusV.covectorU - minusV.covectorU) / (2 * h)
      ) / area,
    };
  }

  fieldSampleAtVertex(position: Vec3, u?: number, v?: number): FieldSample {
    if (this.parameters.surface === "sphere") {
      const unit = normalize(position);
      return {
        position: unit,
        normal: unit,
        velocity: this.velocityAtSphere(unit),
        ...this.sphereDifferentials(unit),
      };
    }
    if (u === undefined || v === undefined) {
      throw new Error(`${this.parameters.surface} vertex samples require periodic coordinates`);
    }
    const wrappedU = wrapAngle(u);
    const wrappedV = wrapAngle(v);
    const geometry = parameterGeometry(this.parameters.surface, wrappedU, wrappedV);
    const velocity = this.parameters.surface === "square"
      ? this.velocityAtSquare(wrappedU, wrappedV)
      : this.velocityAtTorus(wrappedU, wrappedV);
    return {
      position,
      normal: geometry.normal,
      velocity,
      ...this.parameterDifferentials(this.parameters.surface, wrappedU, wrappedV),
      u: wrappedU,
      v: wrappedV,
    };
  }

  fieldSamples(): FieldSample[] {
    if (this.parameters.surface === "sphere") {
      return fibonacciSphere(150).map((unit) => this.fieldSampleAtVertex(unit));
    }
    const result: FieldSample[] = [];
    const rows = this.parameters.surface === "square" ? 16 : 10;
    const columns = this.parameters.surface === "square" ? 16 : 20;
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const u = TAU * (column + 0.5) / columns;
        const v = TAU * (row + 0.5) / rows;
        const geometry = parameterGeometry(this.parameters.surface, u, v);
        result.push(this.fieldSampleAtVertex(geometry.position, u, v));
      }
    }
    return result;
  }

  spectrum(): SpectrumBand[] {
    const energy = Array.from({ length: this.parameters.maxBand }, () => 0);
    const counts = Array.from({ length: this.parameters.maxBand }, () => 0);
    const modeSets = isClebschProjection(this.parameters.projection)
      ? [this.primaryModes, this.alphaModes, this.betaModes]
      : [this.primaryModes];
    for (const modes of modeSets) {
      for (const mode of modes) {
        energy[mode.band - 1] = energy[mode.band - 1]!
          + (mode.amplitude * mode.frequency) ** 2;
        counts[mode.band - 1] = counts[mode.band - 1]! + 1;
      }
    }
    const total = energy.reduce((sum, value) => sum + value, 0);
    return energy.map((value, index) => ({
      band: index + 1,
      energy: value,
      share: total > 0 ? value / total : 0,
      modes: counts[index]!,
    }));
  }

  diagnostics(samples = this.fieldSamples()): RandomFluidDiagnostics {
    let speed2 = 0;
    let initialSpeed2 = 0;
    let crossCorrelation = 0;
    let maxSpeed = 0;
    let tangencyResidual = 0;
    let divergence2 = 0;
    let vorticity2 = 0;
    const squareColumns = 16;
    const torusColumns = 20;
    for (let index = 0; index < samples.length; index += 1) {
      const sample = samples[index]!;
      const speed = norm(sample.velocity);
      speed2 += speed * speed;
      maxSpeed = Math.max(maxSpeed, speed);
      tangencyResidual = Math.max(
        tangencyResidual,
        Math.abs(dot(sample.velocity, sample.normal)) / Math.max(1e-14, speed),
      );
      let initialVelocity: Vec3;
      if (this.parameters.surface === "sphere") {
        initialVelocity = scale(this.sphereRawVelocity(normalize(sample.position), 0), this.velocityScale);
      } else {
        const columns = this.parameters.surface === "square" ? squareColumns : torusColumns;
        const rows = this.parameters.surface === "square" ? 16 : 10;
        const row = Math.floor(index / columns);
        const column = index % columns;
        const u = sample.u ?? TAU * (column + 0.5) / columns;
        const v = sample.v ?? TAU * (row + 0.5) / rows;
        initialVelocity = scale(
          this.parameterRawVelocity(this.parameters.surface, u, v, 0),
          this.velocityScale,
        );
      }
      initialSpeed2 += dot(initialVelocity, initialVelocity);
      crossCorrelation += dot(sample.velocity, initialVelocity);
      divergence2 += sample.divergence ** 2;
      vorticity2 += sample.vorticity ** 2;
    }
    return {
      rmsSpeed: Math.sqrt(speed2 / Math.max(1, samples.length)),
      maxSpeed,
      tangencyResidual,
      divergenceResidual: Math.sqrt(divergence2 / Math.max(1, samples.length)),
      vorticityRms: Math.sqrt(vorticity2 / Math.max(1, samples.length)),
      fieldCorrelation: crossCorrelation / Math.max(1e-14, Math.sqrt(speed2 * initialSpeed2)),
    };
  }
}
