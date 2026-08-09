export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type RandomFluidSurface = "sphere" | "torus";

export interface RandomSurfaceFluidParameters {
  surface: RandomFluidSurface;
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
}

export interface RandomFluidDiagnostics {
  rmsSpeed: number;
  maxSpeed: number;
  tangencyResidual: number;
  divergenceResidual: number;
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
  drift: number;
  axis: Vec3;
  k: number;
  l: number;
}

const TAU = 2 * Math.PI;
const TORUS_MAJOR_RADIUS = 1.25;
const TORUS_MINOR_RADIUS = 0.46;

export const DEFAULT_RANDOM_SURFACE_FLUID_PARAMETERS: RandomSurfaceFluidParameters = {
  surface: "sphere",
  seed: 13,
  modeCount: 28,
  maxBand: 7,
  spectralSlope: 5 / 3,
  turnover: 0.42,
  speed: 0.62,
  timeStep: 0.018,
  particleCount: 420,
};

function assertParameters(parameters: RandomSurfaceFluidParameters): void {
  if (parameters.surface !== "sphere" && parameters.surface !== "torus") {
    throw new Error("surface must be sphere or torus");
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
    if (name !== "surface" && !Number.isFinite(value)) throw new Error(`${name} must be finite`);
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

function torusPartials(u: number, v: number): { u: Vec3; v: Vec3; area: number } {
  const radial = TORUS_MAJOR_RADIUS + TORUS_MINOR_RADIUS * Math.cos(v);
  return {
    u: { x: -radial * Math.sin(u), y: radial * Math.cos(u), z: 0 },
    v: {
      x: -TORUS_MINOR_RADIUS * Math.sin(v) * Math.cos(u),
      y: -TORUS_MINOR_RADIUS * Math.sin(v) * Math.sin(u),
      z: TORUS_MINOR_RADIUS * Math.cos(v),
    },
    area: TORUS_MINOR_RADIUS * radial,
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
  private modes: FluidMode[] = [];
  private velocityScale = 1;

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
    this.calibrateVelocity();
    this.resetParticles();
  }

  private makeModes(): void {
    const random = mulberry32(this.parameters.seed);
    this.modes = [];
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
      // Differentiation contributes one power of frequency. This amplitude
      // therefore makes velocity energy fall approximately like band^-beta.
      const amplitude = (random() < 0.5 ? -1 : 1)
        * frequency ** (-(this.parameters.spectralSlope + 2) / 2);
      this.modes.push({
        band,
        frequency,
        amplitude,
        phase: TAU * random(),
        drift: (random() < 0.5 ? -1 : 1)
          * this.parameters.turnover
          * (0.55 + 0.45 * random())
          * Math.sqrt(band),
        axis,
        k,
        l,
      });
    }
  }

  private sphereRawVelocity(point: Vec3, time: number): Vec3 {
    let gradient: Vec3 = { x: 0, y: 0, z: 0 };
    for (const mode of this.modes) {
      const argument = mode.frequency * dot(mode.axis, point) + mode.phase + mode.drift * time;
      gradient = add(
        gradient,
        scale(mode.axis, mode.amplitude * mode.frequency * Math.cos(argument)),
      );
    }
    return cross(point, gradient);
  }

  private torusStreamDerivatives(u: number, v: number, time: number): { u: number; v: number } {
    let derivativeU = 0;
    let derivativeV = 0;
    for (const mode of this.modes) {
      const argument = mode.k * u + mode.l * v + mode.phase + mode.drift * time;
      const cosine = mode.amplitude * Math.cos(argument);
      derivativeU += mode.k * cosine;
      derivativeV += mode.l * cosine;
    }
    return { u: derivativeU, v: derivativeV };
  }

  private torusRawRates(u: number, v: number, time: number): { u: number; v: number } {
    const derivative = this.torusStreamDerivatives(u, v, time);
    const area = torusPartials(u, v).area;
    // X = J grad(psi): sqrt(g) u_dot = -psi_v and
    // sqrt(g) v_dot = psi_u, so the area divergence vanishes identically.
    return { u: -derivative.v / area, v: derivative.u / area };
  }

  private torusRawVelocity(u: number, v: number, time: number): Vec3 {
    const rates = this.torusRawRates(u, v, time);
    const partials = torusPartials(u, v);
    return add(scale(partials.u, rates.u), scale(partials.v, rates.v));
  }

  private calibrateVelocity(): void {
    let speed2 = 0;
    let count = 0;
    if (this.parameters.surface === "sphere") {
      for (const point of fibonacciSphere(144)) {
        const velocity = this.sphereRawVelocity(point, 0);
        speed2 += dot(velocity, velocity);
        count += 1;
      }
    } else {
      for (let row = 0; row < 12; row += 1) {
        for (let column = 0; column < 24; column += 1) {
          const velocity = this.torusRawVelocity(TAU * column / 24, TAU * row / 12, 0);
          speed2 += dot(velocity, velocity);
          count += 1;
        }
      }
    }
    const rms = Math.sqrt(speed2 / Math.max(1, count));
    this.velocityScale = rms > 1e-14 ? this.parameters.speed / rms : 0;
  }

  velocityAtSphere(point: Vec3, time = this.time): Vec3 {
    return scale(this.sphereRawVelocity(normalize(point), time), this.velocityScale);
  }

  velocityAtTorus(u: number, v: number, time = this.time): Vec3 {
    return scale(this.torusRawVelocity(wrapAngle(u), wrapAngle(v), time), this.velocityScale);
  }

  private torusRates(u: number, v: number, time: number): { u: number; v: number } {
    const rates = this.torusRawRates(wrapAngle(u), wrapAngle(v), time);
    return { u: this.velocityScale * rates.u, v: this.velocityScale * rates.v };
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
    } else {
      const centers = [{ u: 0.2, v: 0.35 }, { u: 1.1, v: 3.35 }];
      for (let index = 0; index < this.parameters.particleCount; index += 1) {
        const group = (index % 2) as 0 | 1;
        const center = centers[group]!;
        this.particles.push({
          surface: "torus",
          u: wrapAngle(center.u + 0.22 * gaussian(random)),
          v: wrapAngle(center.v + 0.28 * gaussian(random)),
          group,
        });
      }
    }
  }

  particlePosition(particle: FluidParticle): Vec3 {
    if (particle.surface === "sphere") return particle.position!;
    return torusPosition(particle.u!, particle.v!);
  }

  step(count = 1): void {
    if (!Number.isInteger(count) || count < 1 || count > 200) {
      throw new Error("step count must be an integer from 1 through 200");
    }
    const dt = this.parameters.timeStep;
    for (let iteration = 0; iteration < count; iteration += 1) {
      const halfTime = this.time + 0.5 * dt;
      for (const particle of this.particles) {
        if (particle.surface === "sphere") {
          const start = particle.position!;
          const first = this.velocityAtSphere(start, this.time);
          const middle = normalize(add(start, scale(first, 0.5 * dt)));
          const second = this.velocityAtSphere(middle, halfTime);
          particle.position = normalize(add(start, scale(second, dt)));
        } else {
          const u = particle.u!;
          const v = particle.v!;
          const first = this.torusRates(u, v, this.time);
          const middleU = wrapAngle(u + 0.5 * dt * first.u);
          const middleV = wrapAngle(v + 0.5 * dt * first.v);
          const second = this.torusRates(middleU, middleV, halfTime);
          particle.u = wrapAngle(u + dt * second.u);
          particle.v = wrapAngle(v + dt * second.v);
        }
      }
      this.time += dt;
      this.steps += 1;
    }
  }

  fieldSamples(): FieldSample[] {
    if (this.parameters.surface === "sphere") {
      return fibonacciSphere(150).map((unit) => ({
        position: scale(unit, 1.012),
        normal: unit,
        velocity: this.velocityAtSphere(unit),
      }));
    }
    const result: FieldSample[] = [];
    for (let row = 0; row < 10; row += 1) {
      for (let column = 0; column < 20; column += 1) {
        const u = TAU * column / 20;
        const v = TAU * (row + 0.5) / 10;
        const normal = torusNormal(u, v);
        result.push({
          position: add(torusPosition(u, v), scale(normal, 0.018)),
          normal,
          velocity: this.velocityAtTorus(u, v),
        });
      }
    }
    return result;
  }

  spectrum(): SpectrumBand[] {
    const energy = Array.from({ length: this.parameters.maxBand }, () => 0);
    const counts = Array.from({ length: this.parameters.maxBand }, () => 0);
    for (const mode of this.modes) {
      energy[mode.band - 1] = energy[mode.band - 1]! + (this.velocityScale * mode.amplitude * mode.frequency) ** 2;
      counts[mode.band - 1] = counts[mode.band - 1]! + 1;
    }
    const total = energy.reduce((sum, value) => sum + value, 0);
    return energy.map((value, index) => ({
      band: index + 1,
      energy: value,
      share: total > 0 ? value / total : 0,
      modes: counts[index]!,
    }));
  }

  private sphereDivergence(point: Vec3): number {
    const reference = Math.abs(point.z) < 0.88 ? { x: 0, y: 0, z: 1 } : { x: 0, y: 1, z: 0 };
    const tangentA = normalize(cross(reference, point));
    const tangentB = cross(point, tangentA);
    const h = 2e-4;
    const plusA = sphereExponential(point, tangentA, h);
    const minusA = sphereExponential(point, tangentA, -h);
    const transportedAPlus = add(scale(point, -Math.sin(h)), scale(tangentA, Math.cos(h)));
    const transportedAMinus = add(scale(point, Math.sin(h)), scale(tangentA, Math.cos(h)));
    const derivativeA = (
      dot(this.velocityAtSphere(plusA), transportedAPlus)
      - dot(this.velocityAtSphere(minusA), transportedAMinus)
    ) / (2 * h);
    const plusB = sphereExponential(point, tangentB, h);
    const minusB = sphereExponential(point, tangentB, -h);
    const transportedBPlus = add(scale(point, -Math.sin(h)), scale(tangentB, Math.cos(h)));
    const transportedBMinus = add(scale(point, Math.sin(h)), scale(tangentB, Math.cos(h)));
    const derivativeB = (
      dot(this.velocityAtSphere(plusB), transportedBPlus)
      - dot(this.velocityAtSphere(minusB), transportedBMinus)
    ) / (2 * h);
    return derivativeA + derivativeB;
  }

  private torusDivergence(u: number, v: number): number {
    const h = 2e-4;
    const fluxU = (sampleU: number, sampleV: number): number => {
      return -this.velocityScale * this.torusStreamDerivatives(sampleU, sampleV, this.time).v;
    };
    const fluxV = (sampleU: number, sampleV: number): number => {
      return this.velocityScale * this.torusStreamDerivatives(sampleU, sampleV, this.time).u;
    };
    const derivativeU = (fluxU(u + h, v) - fluxU(u - h, v)) / (2 * h);
    const derivativeV = (fluxV(u, v + h) - fluxV(u, v - h)) / (2 * h);
    return (derivativeU + derivativeV) / torusPartials(u, v).area;
  }

  diagnostics(): RandomFluidDiagnostics {
    const samples = this.fieldSamples();
    let speed2 = 0;
    let initialSpeed2 = 0;
    let crossCorrelation = 0;
    let maxSpeed = 0;
    let tangencyResidual = 0;
    let divergence2 = 0;
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
      let divergence: number;
      if (this.parameters.surface === "sphere") {
        const point = normalize(sample.position);
        initialVelocity = this.velocityAtSphere(point, 0);
        divergence = this.sphereDivergence(point);
      } else {
        const row = Math.floor(index / 20);
        const column = index % 20;
        const u = TAU * column / 20;
        const v = TAU * (row + 0.5) / 10;
        initialVelocity = this.velocityAtTorus(u, v, 0);
        divergence = this.torusDivergence(u, v);
      }
      initialSpeed2 += dot(initialVelocity, initialVelocity);
      crossCorrelation += dot(sample.velocity, initialVelocity);
      divergence2 += divergence * divergence;
    }
    return {
      rmsSpeed: Math.sqrt(speed2 / Math.max(1, samples.length)),
      maxSpeed,
      tangencyResidual,
      divergenceResidual: Math.sqrt(divergence2 / Math.max(1, samples.length)),
      fieldCorrelation: crossCorrelation / Math.max(1e-14, Math.sqrt(speed2 * initialSpeed2)),
    };
  }
}
