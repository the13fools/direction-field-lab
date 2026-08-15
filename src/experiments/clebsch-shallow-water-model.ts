export interface Vec2 {
  x: number;
  y: number;
}

export type ClebschWaterPreset = "crossing-labels" | "potential-pulse" | "vortical-patch";
export type ClebschRepresentation = "single-pair" | "ambient-recharted";
export type ScalarTriple = [Float64Array, Float64Array, Float64Array];

export interface ClebschShallowWaterParameters {
  resolution: number;
  timeStep: number;
  gravity: number;
  meanDepth: number;
  clebschStrength: number;
  preset: ClebschWaterPreset;
  representation: ClebschRepresentation;
  rechartInterval: number;
}

export interface ClebschShallowWaterState {
  height: Float64Array;
  phi: Float64Array;
  alpha: Float64Array;
  beta: Float64Array;
  weights: ScalarTriple;
  labels: ScalarTriple;
  tracer: Float64Array;
  time: number;
  steps: number;
  initialMass: number;
  recharts: number;
  lastRechartVelocityDefect: number;
}

export interface ClebschShallowWaterDiagnostics {
  massDrift: number;
  energy: number;
  maxSpeed: number;
  divergenceRms: number;
  vorticityRms: number;
  clebschIdentityRms: number;
  rechartCount: number;
  rechartVelocityDefect: number;
  labelFrameQuality: number;
}

export interface ClebschPointSample {
  height: number;
  phi: number;
  alpha: number;
  beta: number;
  weights: [number, number, number];
  labels: [number, number, number];
  dPhi: Vec2;
  dBeta: Vec2;
  alphaDBeta: Vec2;
  labelOneForm: Vec2;
  velocity: Vec2;
  flux: Vec2;
  vorticity: number;
  potentialVorticity: number;
}

export const DEFAULT_CLEBSCH_SHALLOW_WATER_PARAMETERS: ClebschShallowWaterParameters = {
  resolution: 56,
  timeStep: 0.0015,
  gravity: 9.81,
  meanDepth: 1,
  clebschStrength: 0.16,
  preset: "crossing-labels",
  representation: "ambient-recharted",
  rechartInterval: 180,
};

function assertParameters(parameters: ClebschShallowWaterParameters): void {
  if (!Number.isInteger(parameters.resolution) || parameters.resolution < 16 || parameters.resolution > 80) {
    throw new Error("resolution must be an integer from 16 through 80");
  }
  if (!(["crossing-labels", "potential-pulse", "vortical-patch"] as const).includes(parameters.preset)) {
    throw new Error("unknown Clebsch shallow-water preset");
  }
  if (!(["single-pair", "ambient-recharted"] as const).includes(parameters.representation)) {
    throw new Error("unknown Clebsch representation");
  }
  for (const [name, value] of Object.entries(parameters)) {
    if (name !== "preset" && name !== "representation" && !Number.isFinite(value)) throw new Error(`${name} must be finite`);
  }
  if (parameters.timeStep <= 0 || parameters.gravity <= 0 || parameters.meanDepth <= 0) {
    throw new Error("timeStep, gravity, and meanDepth must be positive");
  }
  if (parameters.clebschStrength < 0) throw new Error("clebschStrength must be nonnegative");
  if (!Number.isInteger(parameters.rechartInterval) || parameters.rechartInterval < 0 || parameters.rechartInterval > 2000) {
    throw new Error("rechartInterval must be an integer from 0 through 2000");
  }
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
      weights: [alpha, new Float64Array(count), new Float64Array(count)],
      labels: [beta, new Float64Array(count), new Float64Array(count)],
      tracer,
      time: 0,
      steps: 0,
      initialMass: depth,
      recharts: 0,
      lastRechartVelocityDefect: 0,
    };
    this.state = state;
    if (this.parameters.representation === "ambient-recharted") this.rechartToAmbientCoordinates();
    state.initialMass = this.mass();
    return state;
  }

  private setClebschState(weights: ScalarTriple, labels: ScalarTriple): void {
    this.state.weights = weights;
    this.state.labels = labels;
    // Keep the original pair as a backwards-compatible view of component zero.
    this.state.alpha = weights[0];
    this.state.beta = labels[0];
  }

  /**
   * Three smooth, periodic scalar functions used as a redundant chart on the
   * flat computational torus. On a triangle mesh these arrays are simply the
   * x, y, and z coordinates of its vertices.
   */
  ambientCoordinateLabels(): ScalarTriple {
    const n = this.parameters.resolution;
    const count = n * n;
    const labels: ScalarTriple = [
      new Float64Array(count),
      new Float64Array(count),
      new Float64Array(count),
    ];
    const majorRadius = 1.35;
    const minorRadius = 0.42;
    for (let row = 0; row < n; row += 1) {
      const v = 2 * Math.PI * (row + 0.5) / n;
      for (let column = 0; column < n; column += 1) {
        const u = 2 * Math.PI * (column + 0.5) / n;
        const radial = majorRadius + minorRadius * Math.cos(v);
        const index = this.index(column, row);
        labels[0][index] = radial * Math.cos(u);
        labels[1][index] = radial * Math.sin(u);
        labels[2][index] = minorRadius * Math.sin(v);
      }
    }
    return labels;
  }

  private labelGradients(labels: ScalarTriple = this.state.labels): [Vec2[], Vec2[], Vec2[]] {
    return [this.gradient(labels[0]), this.gradient(labels[1]), this.gradient(labels[2])];
  }

  private labelContribution(
    weights: ScalarTriple = this.state.weights,
    gradients: [Vec2[], Vec2[], Vec2[]] = this.labelGradients(),
  ): Vec2[] {
    const count = this.parameters.resolution ** 2;
    const result = Array.from({ length: count }, () => ({ x: 0, y: 0 }));
    for (let index = 0; index < count; index += 1) {
      for (let component = 0; component < 3; component += 1) {
        result[index]!.x += weights[component]![index]! * gradients[component]![index]!.x;
        result[index]!.y += weights[component]![index]! * gradients[component]![index]!.y;
      }
    }
    return result;
  }

  labelOneForm(): Vec2[] {
    return this.labelContribution();
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
    const labelTerm = this.labelContribution();
    return dPhi.map((exact, index) => ({
      x: exact.x + labelTerm[index]!.x,
      y: exact.y + labelTerm[index]!.y,
    }));
  }

  /**
   * Change Clebsch coordinates without intentionally changing the velocity.
   *
   * B is reset to three ambient coordinate functions. At each grid point we
   * solve the minimum-norm 3-by-2 system
   *
   *   sum_a lambda_a dB^a = u^flat - dphi.
   *
   * The returned number is the relative RMS velocity defect introduced by the
   * discrete change of chart.
   */
  rechartToAmbientCoordinates(): number {
    const before = this.velocity();
    const dPhi = this.gradient(this.state.phi);
    const labels = this.ambientCoordinateLabels();
    const gradients = this.labelGradients(labels);
    const count = before.length;
    const weights: ScalarTriple = [
      new Float64Array(count),
      new Float64Array(count),
      new Float64Array(count),
    ];
    for (let index = 0; index < count; index += 1) {
      let xx = 0;
      let xy = 0;
      let yy = 0;
      for (let component = 0; component < 3; component += 1) {
        const gradient = gradients[component]![index]!;
        xx += gradient.x * gradient.x;
        xy += gradient.x * gradient.y;
        yy += gradient.y * gradient.y;
      }
      const residualX = before[index]!.x - dPhi[index]!.x;
      const residualY = before[index]!.y - dPhi[index]!.y;
      const scale = Math.max(1, xx + yy);
      const determinant = Math.max(xx * yy - xy * xy, 1e-14 * scale * scale);
      const dualX = (yy * residualX - xy * residualY) / determinant;
      const dualY = (xx * residualY - xy * residualX) / determinant;
      for (let component = 0; component < 3; component += 1) {
        const gradient = gradients[component]![index]!;
        weights[component]![index] = gradient.x * dualX + gradient.y * dualY;
      }
    }
    this.setClebschState(weights, labels);
    const after = this.velocity();
    let error2 = 0;
    let reference2 = 0;
    for (let index = 0; index < count; index += 1) {
      error2 += (after[index]!.x - before[index]!.x) ** 2 + (after[index]!.y - before[index]!.y) ** 2;
      reference2 += before[index]!.x ** 2 + before[index]!.y ** 2;
    }
    const defect = Math.sqrt(error2 / Math.max(reference2, 1e-24));
    this.state.recharts += 1;
    this.state.lastRechartVelocityDefect = defect;
    return defect;
  }

  labelFrameQuality(): number {
    const gradients = this.labelGradients();
    let minimumQuality = 1;
    for (let index = 0; index < gradients[0].length; index += 1) {
      let xx = 0;
      let xy = 0;
      let yy = 0;
      for (let component = 0; component < 3; component += 1) {
        const gradient = gradients[component]![index]!;
        xx += gradient.x * gradient.x;
        xy += gradient.x * gradient.y;
        yy += gradient.y * gradient.y;
      }
      const trace = xx + yy;
      const discriminant = Math.sqrt(Math.max(0, (xx - yy) ** 2 + 4 * xy ** 2));
      const smallestEigenvalue = 0.5 * (trace - discriminant);
      minimumQuality = Math.min(minimumQuality, 2 * smallestEigenvalue / Math.max(trace, 1e-24));
    }
    return Math.max(0, minimumQuality);
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
    // Taking curl of the reconstructed discrete one-form avoids pretending
    // that a finite-difference stencil obeys the continuum product rule.
    return this.curl(this.labelContribution());
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

  private deAlias(values: Float64Array, timeStep: number, diffusivity = 5e-4): Float64Array {
    const n = this.parameters.resolution;
    const amount = Math.min(0.08, 4 * diffusivity * timeStep * n * n);
    if (amount <= 0) return values;
    const result = new Float64Array(values.length);
    for (let row = 0; row < n; row += 1) {
      for (let column = 0; column < n; column += 1) {
        const center = this.index(column, row);
        const neighborMean = 0.25 * (
          values[this.index(column - 1, row)]!
          + values[this.index(column + 1, row)]!
          + values[this.index(column, row - 1)]!
          + values[this.index(column, row + 1)]!
        );
        result[center] = (1 - amount) * values[center]! + amount * neighborMean;
      }
    }
    return result;
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
    const nextWeights: ScalarTriple = [
      new Float64Array(n * n),
      new Float64Array(n * n),
      new Float64Array(n * n),
    ];
    const nextLabels: ScalarTriple = [
      new Float64Array(n * n),
      new Float64Array(n * n),
      new Float64Array(n * n),
    ];
    const nextTracer = new Float64Array(n * n);
    for (let row = 0; row < n; row += 1) {
      for (let column = 0; column < n; column += 1) {
        const index = this.index(column, row);
        const localVelocity = velocity[index]!;
        const backX = column - timeStep * n * localVelocity.x;
        const backY = row - timeStep * n * localVelocity.y;
        const sampledHeight = this.sample(this.state.height, backX, backY);
        for (let component = 0; component < 3; component += 1) {
          nextWeights[component]![index] = this.sample(this.state.weights[component]!, backX, backY);
          nextLabels[component]![index] = this.sample(this.state.labels[component]!, backX, backY);
        }
        nextTracer[index] = this.sample(this.state.tracer, backX, backY);
        nextPhi[index] = this.sample(this.state.phi, backX, backY) + timeStep * (
          0.5 * this.sample(speed2, backX, backY) - gravity * (sampledHeight - depth)
        );
      }
    }
    const filteredPhi = this.deAlias(nextPhi, timeStep);
    this.removeMean(filteredPhi);
    this.state.height = nextHeight;
    this.state.phi = filteredPhi;
    for (let component = 0; component < 3; component += 1) {
      nextWeights[component] = this.deAlias(nextWeights[component]!, timeStep);
      nextLabels[component] = this.deAlias(nextLabels[component]!, timeStep);
    }
    this.setClebschState(nextWeights, nextLabels);
    this.state.tracer = this.deAlias(nextTracer, timeStep);
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
      if (
        this.parameters.representation === "ambient-recharted"
        && this.parameters.rechartInterval > 0
        && this.state.steps % this.parameters.rechartInterval === 0
      ) {
        this.rechartToAmbientCoordinates();
      }
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
      rechartCount: this.state.recharts,
      rechartVelocityDefect: this.state.lastRechartVelocityDefect,
      labelFrameQuality: this.labelFrameQuality(),
    };
  }

  samplePoint(x: number, y: number): ClebschPointSample {
    const n = this.parameters.resolution;
    const gridX = ((x % 1 + 1) % 1) * n - 0.5;
    const gridY = ((y % 1 + 1) % 1) * n - 0.5;
    const dPhi = this.gradient(this.state.phi);
    const labelGradients = this.labelGradients();
    const velocity = this.velocity();
    const vorticity = this.curl(velocity);
    const height = this.sample(this.state.height, gridX, gridY);
    const weights = [0, 0, 0] as [number, number, number];
    const labels = [0, 0, 0] as [number, number, number];
    const sampledGradients = Array.from({ length: 3 }, () => ({ x: 0, y: 0 })) as [Vec2, Vec2, Vec2];
    for (let component = 0; component < 3; component += 1) {
      weights[component] = this.sample(this.state.weights[component]!, gridX, gridY);
      labels[component] = this.sample(this.state.labels[component]!, gridX, gridY);
      sampledGradients[component] = {
        x: this.sample(labelGradients[component]!.map((value) => value.x), gridX, gridY),
        y: this.sample(labelGradients[component]!.map((value) => value.y), gridX, gridY),
      };
    }
    const exact = {
      x: this.sample(dPhi.map((value) => value.x), gridX, gridY),
      y: this.sample(dPhi.map((value) => value.y), gridX, gridY),
    };
    const betaGradient = sampledGradients[0];
    const label = { x: 0, y: 0 };
    for (let component = 0; component < 3; component += 1) {
      label.x += weights[component]! * sampledGradients[component]!.x;
      label.y += weights[component]! * sampledGradients[component]!.y;
    }
    const vector = { x: exact.x + label.x, y: exact.y + label.y };
    const curl = this.sample(vorticity, gridX, gridY);
    return {
      height,
      phi: this.sample(this.state.phi, gridX, gridY),
      alpha: weights[0],
      beta: labels[0],
      weights,
      labels,
      dPhi: exact,
      dBeta: betaGradient,
      alphaDBeta: {
        x: weights[0] * betaGradient.x,
        y: weights[0] * betaGradient.y,
      },
      labelOneForm: label,
      velocity: vector,
      flux: { x: height * vector.x, y: height * vector.y },
      vorticity: curl,
      potentialVorticity: curl / Math.max(1e-8, height),
    };
  }
}
