export interface Vec2 {
  x: number;
  y: number;
}

export type ClebschWaterPreset = "crossing-labels" | "potential-pulse" | "vortical-patch";

export interface ClebschShallowWaterParameters {
  resolution: number;
  timeStep: number;
  gravity: number;
  meanDepth: number;
  clebschStrength: number;
  preset: ClebschWaterPreset;
}

export interface ClebschShallowWaterState {
  height: Float64Array;
  phi: Float64Array;
  alpha: Float64Array;
  beta: Float64Array;
  tracer: Float64Array;
  time: number;
  steps: number;
  initialMass: number;
}

export interface ClebschShallowWaterDiagnostics {
  massDrift: number;
  energy: number;
  maxSpeed: number;
  divergenceRms: number;
  vorticityRms: number;
  clebschIdentityRms: number;
}

export interface ClebschPointSample {
  height: number;
  phi: number;
  alpha: number;
  beta: number;
  dPhi: Vec2;
  dBeta: Vec2;
  alphaDBeta: Vec2;
  velocity: Vec2;
  flux: Vec2;
  vorticity: number;
  potentialVorticity: number;
}

export const DEFAULT_CLEBSCH_SHALLOW_WATER_PARAMETERS: ClebschShallowWaterParameters = {
  resolution: 40,
  timeStep: 0.0015,
  gravity: 9.81,
  meanDepth: 1,
  clebschStrength: 0.16,
  preset: "crossing-labels",
};

function assertParameters(parameters: ClebschShallowWaterParameters): void {
  if (!Number.isInteger(parameters.resolution) || parameters.resolution < 16 || parameters.resolution > 80) {
    throw new Error("resolution must be an integer from 16 through 80");
  }
  if (!(["crossing-labels", "potential-pulse", "vortical-patch"] as const).includes(parameters.preset)) {
    throw new Error("unknown Clebsch shallow-water preset");
  }
  for (const [name, value] of Object.entries(parameters)) {
    if (name !== "preset" && !Number.isFinite(value)) throw new Error(`${name} must be finite`);
  }
  if (parameters.timeStep <= 0 || parameters.gravity <= 0 || parameters.meanDepth <= 0) {
    throw new Error("timeStep, gravity, and meanDepth must be positive");
  }
  if (parameters.clebschStrength < 0) throw new Error("clebschStrength must be nonnegative");
}

function rms(values: ArrayLike<number>): number {
  let total = 0;
  for (let index = 0; index < values.length; index += 1) total += values[index]! ** 2;
  return Math.sqrt(total / Math.max(1, values.length));
}

export class ClebschShallowWaterModel {
  parameters: ClebschShallowWaterParameters;
  state: ClebschShallowWaterState;

  constructor(parameters: Partial<ClebschShallowWaterParameters> = {}) {
    this.parameters = { ...DEFAULT_CLEBSCH_SHALLOW_WATER_PARAMETERS, ...parameters };
    assertParameters(this.parameters);
    this.state = this.makeInitialState();
  }

  reset(parameters: Partial<ClebschShallowWaterParameters> = {}): void {
    this.parameters = { ...this.parameters, ...parameters };
    assertParameters(this.parameters);
    this.state = this.makeInitialState();
  }

  private index(column: number, row: number): number {
    const n = this.parameters.resolution;
    return ((row % n + n) % n) * n + ((column % n + n) % n);
  }

  private makeInitialState(): ClebschShallowWaterState {
    const n = this.parameters.resolution;
    const count = n * n;
    const height = new Float64Array(count);
    const phi = new Float64Array(count);
    const alpha = new Float64Array(count);
    const beta = new Float64Array(count);
    const tracer = new Float64Array(count);
    const { meanDepth: depth, clebschStrength: strength, preset } = this.parameters;
    let heightMean = 0;
    for (let row = 0; row < n; row += 1) {
      for (let column = 0; column < n; column += 1) {
        const index = this.index(column, row);
        const x = (column + 0.5) / n - 0.5;
        const y = (row + 0.5) / n - 0.5;
        const radius2 = x * x + y * y;
        const pulse = 0.1 * Math.exp(-radius2 / (2 * 0.085 ** 2));
        height[index] = depth + pulse;
        heightMean += height[index]!;
        tracer[index] = Math.exp(-((x + 0.19) ** 2 + (y - 0.13) ** 2) / (2 * 0.055 ** 2));

        if (preset === "potential-pulse") {
          phi[index] = 0.028 * Math.exp(-radius2 / (2 * 0.14 ** 2));
          alpha[index] = 0;
          beta[index] = Math.sin(2 * Math.PI * x);
        } else if (preset === "vortical-patch") {
          phi[index] = 0;
          alpha[index] = strength * Math.sin(2 * Math.PI * y);
          beta[index] = Math.cos(2 * Math.PI * x) + 0.32 * Math.cos(4 * Math.PI * y);
        } else {
          phi[index] = 0.012 * Math.cos(2 * Math.PI * x) * Math.cos(2 * Math.PI * y);
          alpha[index] = strength * Math.sin(2 * Math.PI * y);
          beta[index] = Math.sin(2 * Math.PI * x + 0.38 * Math.sin(2 * Math.PI * y));
        }
      }
    }
    heightMean /= count;
    const correction = depth - heightMean;
    for (let index = 0; index < count; index += 1) height[index] = height[index]! + correction;
    const state: ClebschShallowWaterState = {
      height,
      phi,
      alpha,
      beta,
      tracer,
      time: 0,
      steps: 0,
      initialMass: depth,
    };
    this.state = state;
    state.initialMass = this.mass();
    return state;
  }

  gradient(values: ArrayLike<number>): Vec2[] {
    const n = this.parameters.resolution;
    const inverseTwoDx = n / 2;
    const result = Array.from({ length: n * n }, () => ({ x: 0, y: 0 }));
    for (let row = 0; row < n; row += 1) {
      for (let column = 0; column < n; column += 1) {
        result[this.index(column, row)] = {
          x: (values[this.index(column + 1, row)]! - values[this.index(column - 1, row)]!) * inverseTwoDx,
          y: (values[this.index(column, row + 1)]! - values[this.index(column, row - 1)]!) * inverseTwoDx,
        };
      }
    }
    return result;
  }

  velocity(): Vec2[] {
    const dPhi = this.gradient(this.state.phi);
    const dBeta = this.gradient(this.state.beta);
    return dPhi.map((exact, index) => ({
      x: exact.x + this.state.alpha[index]! * dBeta[index]!.x,
      y: exact.y + this.state.alpha[index]! * dBeta[index]!.y,
    }));
  }

  divergence(vectors: readonly Vec2[]): Float64Array {
    const n = this.parameters.resolution;
    const inverseTwoDx = n / 2;
    const result = new Float64Array(n * n);
    for (let row = 0; row < n; row += 1) {
      for (let column = 0; column < n; column += 1) {
        result[this.index(column, row)] = (
          vectors[this.index(column + 1, row)]!.x - vectors[this.index(column - 1, row)]!.x
          + vectors[this.index(column, row + 1)]!.y - vectors[this.index(column, row - 1)]!.y
        ) * inverseTwoDx;
      }
    }
    return result;
  }

  curl(vectors: readonly Vec2[] = this.velocity()): Float64Array {
    const n = this.parameters.resolution;
    const inverseTwoDx = n / 2;
    const result = new Float64Array(n * n);
    for (let row = 0; row < n; row += 1) {
      for (let column = 0; column < n; column += 1) {
        result[this.index(column, row)] = (
          vectors[this.index(column + 1, row)]!.y - vectors[this.index(column - 1, row)]!.y
          - vectors[this.index(column, row + 1)]!.x + vectors[this.index(column, row - 1)]!.x
        ) * inverseTwoDx;
      }
    }
    return result;
  }

  clebschVorticity(): Float64Array {
    const dAlpha = this.gradient(this.state.alpha);
    const dBeta = this.gradient(this.state.beta);
    return Float64Array.from(dAlpha, (gradient, index) => (
      gradient.x * dBeta[index]!.y - gradient.y * dBeta[index]!.x
    ));
  }

  potentialVorticity(): Float64Array {
    const vorticity = this.curl();
    return Float64Array.from(vorticity, (value, index) => value / Math.max(1e-8, this.state.height[index]!));
  }

  private sample(values: ArrayLike<number>, gridX: number, gridY: number): number {
    const left = Math.floor(gridX);
    const bottom = Math.floor(gridY);
    const tx = gridX - left;
    const ty = gridY - bottom;
    const v00 = values[this.index(left, bottom)]!;
    const v10 = values[this.index(left + 1, bottom)]!;
    const v01 = values[this.index(left, bottom + 1)]!;
    const v11 = values[this.index(left + 1, bottom + 1)]!;
    return (1 - ty) * ((1 - tx) * v00 + tx * v10) + ty * ((1 - tx) * v01 + tx * v11);
  }

  private removeMean(values: Float64Array): void {
    let mean = 0;
    for (const value of values) mean += value;
    mean /= values.length;
    for (let index = 0; index < values.length; index += 1) values[index] = values[index]! - mean;
  }

  private advanceHeight(velocity: readonly Vec2[], timeStep: number): Float64Array {
    const n = this.parameters.resolution;
    const gravity = this.parameters.gravity;
    const result = new Float64Array(n * n);
    const faceFluxX = (left: number, right: number): number => {
      const heightLeft = this.state.height[left]!;
      const heightRight = this.state.height[right]!;
      const waveSpeed = Math.max(
        Math.abs(velocity[left]!.x) + Math.sqrt(gravity * heightLeft),
        Math.abs(velocity[right]!.x) + Math.sqrt(gravity * heightRight),
      );
      return 0.5 * (
        heightLeft * velocity[left]!.x + heightRight * velocity[right]!.x
        - waveSpeed * (heightRight - heightLeft)
      );
    };
    const faceFluxY = (bottom: number, top: number): number => {
      const heightBottom = this.state.height[bottom]!;
      const heightTop = this.state.height[top]!;
      const waveSpeed = Math.max(
        Math.abs(velocity[bottom]!.y) + Math.sqrt(gravity * heightBottom),
        Math.abs(velocity[top]!.y) + Math.sqrt(gravity * heightTop),
      );
      return 0.5 * (
        heightBottom * velocity[bottom]!.y + heightTop * velocity[top]!.y
        - waveSpeed * (heightTop - heightBottom)
      );
    };
    for (let row = 0; row < n; row += 1) {
      for (let column = 0; column < n; column += 1) {
        const center = this.index(column, row);
        const right = this.index(column + 1, row);
        const left = this.index(column - 1, row);
        const top = this.index(column, row + 1);
        const bottom = this.index(column, row - 1);
        const divergence = n * (
          faceFluxX(center, right) - faceFluxX(left, center)
          + faceFluxY(center, top) - faceFluxY(bottom, center)
        );
        result[center] = this.state.height[center]! - timeStep * divergence;
      }
    }
    return result;
  }

  private advanceOne(timeStep: number): void {
    const n = this.parameters.resolution;
    const gravity = this.parameters.gravity;
    const depth = this.parameters.meanDepth;
    const velocity = this.velocity();
    const speed2 = Float64Array.from(velocity, (value) => value.x ** 2 + value.y ** 2);
    const nextHeight = this.advanceHeight(velocity, timeStep);
    const nextPhi = new Float64Array(n * n);
    const nextAlpha = new Float64Array(n * n);
    const nextBeta = new Float64Array(n * n);
    const nextTracer = new Float64Array(n * n);
    for (let row = 0; row < n; row += 1) {
      for (let column = 0; column < n; column += 1) {
        const index = this.index(column, row);
        const localVelocity = velocity[index]!;
        const backX = column - timeStep * n * localVelocity.x;
        const backY = row - timeStep * n * localVelocity.y;
        const sampledHeight = this.sample(this.state.height, backX, backY);
        nextAlpha[index] = this.sample(this.state.alpha, backX, backY);
        nextBeta[index] = this.sample(this.state.beta, backX, backY);
        nextTracer[index] = this.sample(this.state.tracer, backX, backY);
        nextPhi[index] = this.sample(this.state.phi, backX, backY) + timeStep * (
          0.5 * this.sample(speed2, backX, backY) - gravity * (sampledHeight - depth)
        );
      }
    }
    this.removeMean(nextPhi);
    this.state.height = nextHeight;
    this.state.phi = nextPhi;
    this.state.alpha = nextAlpha;
    this.state.beta = nextBeta;
    this.state.tracer = nextTracer;
    this.state.time += timeStep;
  }

  step(count = 1): void {
    if (!Number.isInteger(count) || count < 1 || count > 1000) {
      throw new Error("step count must be an integer from 1 through 1000");
    }
    const n = this.parameters.resolution;
    const dt = this.parameters.timeStep;
    const gravity = this.parameters.gravity;
    for (let iteration = 0; iteration < count; iteration += 1) {
      const velocity = this.velocity();
      let maximumRate = 0;
      for (let index = 0; index < velocity.length; index += 1) {
        const waveSpeed = Math.sqrt(gravity * Math.max(1e-12, this.state.height[index]!));
        maximumRate = Math.max(
          maximumRate,
          Math.abs(velocity[index]!.x) + Math.abs(velocity[index]!.y) + 2 * waveSpeed,
        );
      }
      const substeps = Math.max(1, Math.ceil(dt * n * maximumRate / 0.72));
      for (let substep = 0; substep < substeps; substep += 1) this.advanceOne(dt / substeps);
      this.state.steps += 1;
    }
  }

  mass(): number {
    let total = 0;
    for (const value of this.state.height) total += value;
    return total / this.state.height.length;
  }

  diagnostics(): ClebschShallowWaterDiagnostics {
    const velocity = this.velocity();
    const divergence = this.divergence(velocity);
    const vorticity = this.curl(velocity);
    const clebsch = this.clebschVorticity();
    const identityError = Float64Array.from(vorticity, (value, index) => value - clebsch[index]!);
    let energy = 0;
    let maxSpeed = 0;
    for (let index = 0; index < velocity.length; index += 1) {
      const speed2 = velocity[index]!.x ** 2 + velocity[index]!.y ** 2;
      maxSpeed = Math.max(maxSpeed, Math.sqrt(speed2));
      const displacement = this.state.height[index]! - this.parameters.meanDepth;
      energy += 0.5 * this.state.height[index]! * speed2 + 0.5 * this.parameters.gravity * displacement ** 2;
    }
    return {
      massDrift: this.mass() - this.state.initialMass,
      energy: energy / velocity.length,
      maxSpeed,
      divergenceRms: rms(divergence),
      vorticityRms: rms(vorticity),
      clebschIdentityRms: rms(identityError),
    };
  }

  samplePoint(x: number, y: number): ClebschPointSample {
    const n = this.parameters.resolution;
    const gridX = ((x % 1 + 1) % 1) * n - 0.5;
    const gridY = ((y % 1 + 1) % 1) * n - 0.5;
    const dPhi = this.gradient(this.state.phi);
    const dBeta = this.gradient(this.state.beta);
    const velocity = this.velocity();
    const vorticity = this.curl(velocity);
    const height = this.sample(this.state.height, gridX, gridY);
    const alpha = this.sample(this.state.alpha, gridX, gridY);
    const exact = {
      x: this.sample(dPhi.map((value) => value.x), gridX, gridY),
      y: this.sample(dPhi.map((value) => value.y), gridX, gridY),
    };
    const betaGradient = {
      x: this.sample(dBeta.map((value) => value.x), gridX, gridY),
      y: this.sample(dBeta.map((value) => value.y), gridX, gridY),
    };
    const label = { x: alpha * betaGradient.x, y: alpha * betaGradient.y };
    const vector = { x: exact.x + label.x, y: exact.y + label.y };
    const curl = this.sample(vorticity, gridX, gridY);
    return {
      height,
      phi: this.sample(this.state.phi, gridX, gridY),
      alpha,
      beta: this.sample(this.state.beta, gridX, gridY),
      dPhi: exact,
      dBeta: betaGradient,
      alphaDBeta: label,
      velocity: vector,
      flux: { x: height * vector.x, y: height * vector.y },
      vorticity: curl,
      potentialVorticity: curl / Math.max(1e-8, height),
    };
  }
}
