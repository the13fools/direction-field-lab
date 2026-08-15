import type { Vec2 } from "./clebsch-shallow-water-model";

interface FourierWaveMode {
  waveNumberX: number;
  waveNumberY: number;
  amplitude: number;
  phase: number;
  omega: number;
}

export interface FlatWaveState {
  height: Float64Array;
  alpha: Float64Array;
  beta: Float64Array;
  time: number;
}

export interface FlatWaveParameters {
  resolution: number;
  gravity: number;
  meanDepth: number;
}

const TAU = 2 * Math.PI;

/**
 * Exact-in-time linear shallow water on the unit flat torus.
 *
 * Each Fourier mode satisfies
 *   eta_t + H div(u) = 0,    u_t + g grad(eta) = 0
 * analytically. This is intentionally a non-dissipative reference preview,
 * not a substitute for the nonlinear Clebsch solver used by the course lab.
 */
export class FlatShallowWaterPreviewModel {
  readonly parameters: FlatWaveParameters;
  readonly state: FlatWaveState;
  private readonly modes: FourierWaveMode[];
  private readonly velocityValues: Vec2[];

  constructor(resolution = 32, gravity = 9.81, meanDepth = 1) {
    if (!Number.isInteger(resolution) || resolution < 16 || resolution > 96) {
      throw new Error("resolution must be an integer from 16 through 96");
    }
    this.parameters = { resolution, gravity, meanDepth };
    this.modes = [
      this.makeMode(4, 2, 0.052, 0.15),
      this.makeMode(-3, 5, 0.032, 1.1),
    ];
    const count = resolution * resolution;
    this.state = {
      height: new Float64Array(count),
      alpha: new Float64Array(count),
      beta: new Float64Array(count),
      time: 0,
    };
    this.velocityValues = Array.from({ length: count }, () => ({ x: 0, y: 0 }));
    this.initializeLabels();
    this.evaluate();
  }

  private makeMode(
    waveNumberX: number,
    waveNumberY: number,
    amplitude: number,
    phase: number,
  ): FourierWaveMode {
    const magnitude = TAU * Math.hypot(waveNumberX, waveNumberY);
    return {
      waveNumberX,
      waveNumberY,
      amplitude,
      phase,
      omega: Math.sqrt(this.parameters.gravity * this.parameters.meanDepth) * magnitude,
    };
  }

  private initializeLabels(): void {
    const n = this.parameters.resolution;
    for (let row = 0; row < n; row += 1) {
      for (let column = 0; column < n; column += 1) {
        const index = row * n + column;
        const x = (column + 0.5) / n;
        const y = (row + 0.5) / n;
        this.state.alpha[index] = Math.sin(TAU * x);
        this.state.beta[index] = Math.sin(TAU * y);
      }
    }
  }

  private evaluate(): void {
    const { resolution: n, gravity, meanDepth } = this.parameters;
    for (let row = 0; row < n; row += 1) {
      for (let column = 0; column < n; column += 1) {
        const index = row * n + column;
        const x = (column + 0.5) / n;
        const y = (row + 0.5) / n;
        let height = meanDepth;
        let velocityX = 0;
        let velocityY = 0;
        for (const mode of this.modes) {
          const angle = TAU * (mode.waveNumberX * x + mode.waveNumberY * y) + mode.phase;
          const temporalHeight = mode.amplitude * Math.cos(mode.omega * this.state.time);
          const temporalVelocity = gravity * mode.amplitude / mode.omega * Math.sin(mode.omega * this.state.time);
          height += temporalHeight * Math.cos(angle);
          velocityX += temporalVelocity * TAU * mode.waveNumberX * Math.sin(angle);
          velocityY += temporalVelocity * TAU * mode.waveNumberY * Math.sin(angle);
        }
        this.state.height[index] = height;
        this.velocityValues[index]!.x = velocityX;
        this.velocityValues[index]!.y = velocityY;
      }
    }
  }

  velocity(): readonly Vec2[] {
    return this.velocityValues;
  }

  step(duration: number): void {
    if (!Number.isFinite(duration) || duration < 0 || duration > 0.1) {
      throw new Error("duration must be between zero and 0.1");
    }
    this.state.time += duration;
    this.evaluate();
  }

  reset(): void {
    this.state.time = 0;
    this.evaluate();
  }

  massDrift(): number {
    let mean = 0;
    for (const value of this.state.height) mean += value;
    return mean / this.state.height.length - this.parameters.meanDepth;
  }
}
