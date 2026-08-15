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
    this.modes = this.makePulseModes();
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

  private makePulseModes(): FourierWaveMode[] {
    const centerX = 0.43;
    const centerY = 0.52;
    const width = 0.13;
    const targetPeak = 0.09;
    const records: Array<{ waveNumberX: number; waveNumberY: number; weight: number }> = [];

    // Keep one representative from each ±k pair. The Gaussian Fourier
    // envelope makes all retained phases agree at one point, producing a
    // localized height bump rather than a pair of global standing stripes.
    for (let waveNumberX = 0; waveNumberX <= 3; waveNumberX += 1) {
      for (let waveNumberY = -3; waveNumberY <= 3; waveNumberY += 1) {
        if (waveNumberX === 0 && waveNumberY <= 0) continue;
        const waveNumber2 = waveNumberX ** 2 + waveNumberY ** 2;
        records.push({
          waveNumberX,
          waveNumberY,
          weight: Math.exp(-2 * Math.PI ** 2 * width ** 2 * waveNumber2),
        });
      }
    }
    const weightSum = records.reduce((sum, record) => sum + record.weight, 0);
    return records.map((record) => this.makeMode(
      record.waveNumberX,
      record.waveNumberY,
      targetPeak * record.weight / Math.max(weightSum, 1e-14),
      -TAU * (record.waveNumberX * centerX + record.waveNumberY * centerY),
    ));
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

  energy(): number {
    let total = 0;
    for (let index = 0; index < this.state.height.length; index += 1) {
      const displacement = this.state.height[index]! - this.parameters.meanDepth;
      const velocity = this.velocityValues[index]!;
      total += (
        0.5 * this.parameters.meanDepth * (velocity.x ** 2 + velocity.y ** 2)
        + 0.5 * this.parameters.gravity * displacement ** 2
      );
    }
    return total / this.state.height.length;
  }

  continuityResidualRms(): number {
    const { resolution: n, gravity, meanDepth } = this.parameters;
    let residual2 = 0;
    let reference2 = 0;
    for (let row = 0; row < n; row += 1) {
      for (let column = 0; column < n; column += 1) {
        const x = (column + 0.5) / n;
        const y = (row + 0.5) / n;
        let heightRate = 0;
        let divergence = 0;
        for (const mode of this.modes) {
          const angle = TAU * (mode.waveNumberX * x + mode.waveNumberY * y) + mode.phase;
          const temporalSine = Math.sin(mode.omega * this.state.time);
          const waveNumber2 = TAU ** 2 * (mode.waveNumberX ** 2 + mode.waveNumberY ** 2);
          heightRate -= mode.amplitude * mode.omega * temporalSine * Math.cos(angle);
          divergence += gravity * mode.amplitude / mode.omega * temporalSine * waveNumber2 * Math.cos(angle);
        }
        const fluxDivergence = meanDepth * divergence;
        residual2 += (heightRate + fluxDivergence) ** 2;
        reference2 += 0.5 * (heightRate ** 2 + fluxDivergence ** 2);
      }
    }
    return reference2 < 1e-24 ? 0 : Math.sqrt(residual2 / reference2);
  }
}
