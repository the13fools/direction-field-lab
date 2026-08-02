export interface Vec2 {
  x: number;
  y: number;
}

export interface ShallowWaterParameters {
  resolution: number;
  timeStep: number;
  gravity: number;
  meanDepth: number;
  pulseHeight: number;
  pulseWidth: number;
}

export interface ShallowWaterState {
  height: Float64Array;
  velocity: Vec2[];
  // A passive diagnostic dye. It is not part of the wave energy or pressure
  // state; it only makes transport by a divergence-free velocity visible.
  tracer: Float64Array;
  time: number;
  steps: number;
  initialMass: number;
}

export interface ShallowWaterDiagnostics {
  mass: number;
  massDrift: number;
  energy: number;
  curlRms: number;
  maxSpeed: number;
  adjointDefect: number;
}

export interface EdgeFlux {
  tail: number;
  head: number;
  alpha: number;
}

export type HeightPotential = (height: number, gravity: number) => number;
export type HeightPotentialDerivative = (height: number, gravity: number) => number;

function assertParameters(parameters: ShallowWaterParameters): void {
  if (!Number.isInteger(parameters.resolution) || parameters.resolution < 8 || parameters.resolution > 96) {
    throw new Error("resolution must be an integer from 8 through 96");
  }
  for (const [name, value] of Object.entries(parameters)) {
    if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
  }
  if (parameters.timeStep <= 0 || parameters.gravity <= 0 || parameters.meanDepth <= 0) {
    throw new Error("timeStep, gravity, and meanDepth must be positive");
  }
  if (parameters.pulseWidth <= 0) throw new Error("pulseWidth must be positive");
}

export const DEFAULT_SHALLOW_WATER_PARAMETERS: ShallowWaterParameters = {
  resolution: 32,
  timeStep: 0.0035,
  gravity: 9.81,
  meanDepth: 1,
  pulseHeight: 0.12,
  pulseWidth: 0.085,
};

export class VertexShallowWaterModel {
  parameters: ShallowWaterParameters;
  state: ShallowWaterState;

  constructor(parameters: Partial<ShallowWaterParameters> = {}) {
    this.parameters = { ...DEFAULT_SHALLOW_WATER_PARAMETERS, ...parameters };
    assertParameters(this.parameters);
    this.state = this.makeInitialState();
  }

  reset(parameters: Partial<ShallowWaterParameters> = {}): void {
    this.parameters = { ...this.parameters, ...parameters };
    assertParameters(this.parameters);
    this.state = this.makeInitialState();
  }

  private index(column: number, row: number): number {
    const n = this.parameters.resolution;
    return ((row % n + n) % n) * n + ((column % n + n) % n);
  }

  private makeInitialState(): ShallowWaterState {
    const n = this.parameters.resolution;
    const height = new Float64Array(n * n);
    let mean = 0;
    for (let row = 0; row < n; row += 1) {
      for (let column = 0; column < n; column += 1) {
        const x = (column + 0.5) / n - 0.5;
        const y = (row + 0.5) / n - 0.5;
        const radius2 = x * x + y * y;
        const value = this.parameters.pulseHeight * Math.exp(
          -radius2 / (2 * this.parameters.pulseWidth ** 2),
        );
        height[this.index(column, row)] = value;
        mean += value;
      }
    }
    mean /= height.length;
    for (let index = 0; index < height.length; index += 1) {
      height[index] = height[index]! - mean;
    }
    const velocity = Array.from({ length: n * n }, () => ({ x: 0, y: 0 }));
    const tracer = new Float64Array(n * n);
    for (let row = 0; row < n; row += 1) {
      for (let column = 0; column < n; column += 1) {
        const x = (column + 0.5) / n - 0.5;
        const y = (row + 0.5) / n - 0.5;
        tracer[this.index(column, row)] = Math.exp(
          -((x - 0.22) ** 2 + (y - 0.02) ** 2) / (2 * 0.055 ** 2),
        );
      }
    }
    const state: ShallowWaterState = {
      height,
      velocity,
      tracer,
      time: 0,
      steps: 0,
      initialMass: 0,
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

  divergence(values: readonly Vec2[]): Float64Array {
    const n = this.parameters.resolution;
    const inverseTwoDx = n / 2;
    const result = new Float64Array(n * n);
    for (let row = 0; row < n; row += 1) {
      for (let column = 0; column < n; column += 1) {
        result[this.index(column, row)] =
          (values[this.index(column + 1, row)]!.x - values[this.index(column - 1, row)]!.x) * inverseTwoDx +
          (values[this.index(column, row + 1)]!.y - values[this.index(column, row - 1)]!.y) * inverseTwoDx;
      }
    }
    return result;
  }

  curl(values: readonly Vec2[] = this.state.velocity): Float64Array {
    const n = this.parameters.resolution;
    const inverseTwoDx = n / 2;
    const result = new Float64Array(n * n);
    for (let row = 0; row < n; row += 1) {
      for (let column = 0; column < n; column += 1) {
        result[this.index(column, row)] =
          (values[this.index(column + 1, row)]!.y - values[this.index(column - 1, row)]!.y) * inverseTwoDx -
          (values[this.index(column, row + 1)]!.x - values[this.index(column, row - 1)]!.x) * inverseTwoDx;
      }
    }
    return result;
  }

  private advectTracer(timeStep: number): void {
    const n = this.parameters.resolution;
    const previous = this.state.tracer;
    const next = new Float64Array(previous.length);
    const sample = (gridX: number, gridY: number): number => {
      const left = Math.floor(gridX);
      const bottom = Math.floor(gridY);
      const tx = gridX - left;
      const ty = gridY - bottom;
      const v00 = previous[this.index(left, bottom)]!;
      const v10 = previous[this.index(left + 1, bottom)]!;
      const v01 = previous[this.index(left, bottom + 1)]!;
      const v11 = previous[this.index(left + 1, bottom + 1)]!;
      return (1 - ty) * ((1 - tx) * v00 + tx * v10) + ty * ((1 - tx) * v01 + tx * v11);
    };
    for (let row = 0; row < n; row += 1) {
      for (let column = 0; column < n; column += 1) {
        const index = this.index(column, row);
        const velocity = this.state.velocity[index]!;
        const x = (column + 0.5) / n - 0.5 - timeStep * velocity.x;
        const y = (row + 0.5) / n - 0.5 - timeStep * velocity.y;
        next[index] = sample((x + 0.5) * n - 0.5, (y + 0.5) * n - 0.5);
      }
    }
    this.state.tracer = next;
  }

  // Symplectic Euler for the linearized equations:
  //   u_t = -g G h,       h_t = -H D u.
  // G and D are the centered periodic gradient/divergence pair above.
  step(count = 1, pressureDerivative?: HeightPotentialDerivative): void {
    if (!Number.isInteger(count) || count < 1 || count > 1000) {
      throw new Error("step count must be an integer from 1 through 1000");
    }
    const { timeStep: dt, gravity: g, meanDepth: depth } = this.parameters;
    for (let iteration = 0; iteration < count; iteration += 1) {
      const pressure = pressureDerivative
        ? Float64Array.from(this.state.height, (height) => pressureDerivative(height, g))
        : Float64Array.from(this.state.height, (height) => g * height);
      const pressureGradient = this.gradient(pressure);
      for (let index = 0; index < this.state.velocity.length; index += 1) {
        this.state.velocity[index]!.x -= dt * pressureGradient[index]!.x;
        this.state.velocity[index]!.y -= dt * pressureGradient[index]!.y;
      }
      const fluxDivergence = this.divergence(this.state.velocity);
      for (let index = 0; index < this.state.height.length; index += 1) {
        this.state.height[index] = this.state.height[index]! - dt * depth * fluxDivergence[index]!;
      }
      this.advectTracer(dt);
      this.state.time += dt;
      this.state.steps += 1;
    }
  }

  seedVortex(amplitude = 0.35, width = 0.14): void {
    if (!Number.isFinite(amplitude) || !Number.isFinite(width) || width <= 0) {
      throw new Error("vortex amplitude must be finite and width must be positive");
    }
    const n = this.parameters.resolution;
    const streamFunction = new Float64Array(n * n);
    for (let row = 0; row < n; row += 1) {
      for (let column = 0; column < n; column += 1) {
        const x = (column + 0.5) / n - 0.5;
        const y = (row + 0.5) / n - 0.5;
        streamFunction[this.index(column, row)] = amplitude * width * Math.exp(
          -(x * x + y * y) / (2 * width * width),
        );
      }
    }
    // u = J grad(psi) uses the exact same centered derivative in both
    // directions as divergence(), so D_x(-D_y psi) + D_y(D_x psi) = 0 down
    // to roundoff. The example is discretely—not only analytically—vortical.
    const gradient = this.gradient(streamFunction);
    this.state.velocity = gradient.map((value) => ({ x: -value.y, y: value.x }));
  }

  edgeFluxes(): EdgeFlux[] {
    const n = this.parameters.resolution;
    const dx = 1 / n;
    const result: EdgeFlux[] = [];
    for (let row = 0; row < n; row += 1) {
      for (let column = 0; column < n; column += 1) {
        const tail = this.index(column, row);
        const right = this.index(column + 1, row);
        const up = this.index(column, row + 1);
        result.push({
          tail,
          head: right,
          alpha: 0.5 * dx * (this.state.velocity[tail]!.x + this.state.velocity[right]!.x),
        });
        result.push({
          tail,
          head: up,
          alpha: 0.5 * dx * (this.state.velocity[tail]!.y + this.state.velocity[up]!.y),
        });
      }
    }
    return result;
  }

  mass(): number {
    let sum = 0;
    for (const eta of this.state.height) sum += this.parameters.meanDepth + eta;
    return sum / this.state.height.length;
  }

  energy(potential?: HeightPotential): number {
    let sum = 0;
    for (let index = 0; index < this.state.height.length; index += 1) {
      const velocity = this.state.velocity[index]!;
      const heightEnergy = potential
        ? potential(this.state.height[index]!, this.parameters.gravity)
        : 0.5 * this.parameters.gravity * this.state.height[index]! ** 2;
      sum += heightEnergy + 0.5 * this.parameters.meanDepth * (velocity.x ** 2 + velocity.y ** 2);
    }
    return sum / this.state.height.length;
  }

  adjointDefect(): number {
    const scalar = new Float64Array(this.state.height.length);
    const vector: Vec2[] = [];
    for (let index = 0; index < scalar.length; index += 1) {
      scalar[index] = Math.sin(0.73 * index) + 0.2 * Math.cos(1.31 * index);
      vector.push({ x: Math.cos(0.37 * index), y: Math.sin(0.51 * index) });
    }
    const gradient = this.gradient(scalar);
    const divergence = this.divergence(vector);
    let lhs = 0;
    let rhs = 0;
    for (let index = 0; index < scalar.length; index += 1) {
      lhs += gradient[index]!.x * vector[index]!.x + gradient[index]!.y * vector[index]!.y;
      rhs += scalar[index]! * divergence[index]!;
    }
    return Math.abs(lhs + rhs) / Math.max(1, Math.abs(lhs), Math.abs(rhs));
  }

  diagnostics(potential?: HeightPotential): ShallowWaterDiagnostics {
    const vorticity = this.curl();
    let curl2 = 0;
    let maxSpeed = 0;
    for (let index = 0; index < vorticity.length; index += 1) {
      curl2 += vorticity[index]! ** 2;
      const velocity = this.state.velocity[index]!;
      maxSpeed = Math.max(maxSpeed, Math.hypot(velocity.x, velocity.y));
    }
    const mass = this.mass();
    return {
      mass,
      massDrift: mass - this.state.initialMass,
      energy: this.energy(potential),
      curlRms: Math.sqrt(curl2 / vorticity.length),
      maxSpeed,
      adjointDefect: this.adjointDefect(),
    };
  }
}
