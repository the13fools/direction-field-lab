export type StripeFieldKind = "constant" | "bend" | "swirl" | "custom";
export interface StripePoint { x: number; y: number }
export interface ComplexValue { re: number; im: number }
export interface StripeEdge { tail: number; head: number; omega: number; weight: number }

export interface StripePatternReport {
  energy: number;
  residualRms: number;
  minAmplitude: number;
  maxAmplitude: number;
  iterations: number;
}

export interface StripeSamplingReport {
  cellsPerStripe: number;
  quality: "under-resolved" | "usable" | "well-resolved";
}

export function stripeSamplingReport(resolution: number, frequency: number): StripeSamplingReport {
  if (!Number.isInteger(resolution) || resolution < 2) {
    throw new Error("resolution must contain at least two grid vertices");
  }
  if (!Number.isFinite(frequency) || frequency <= 0) {
    throw new Error("frequency must be positive");
  }
  const cellsPerStripe = (resolution - 1) / frequency;
  return {
    cellsPerStripe,
    quality: cellsPerStripe < 4 ? "under-resolved" : cellsPerStripe < 6 ? "usable" : "well-resolved",
  };
}

function rotate(value: ComplexValue, angle: number): ComplexValue {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return {
    re: cosine * value.re - sine * value.im,
    im: sine * value.re + cosine * value.im,
  };
}

function direction(position: StripePoint, kind: StripeFieldKind): StripePoint {
  if (kind === "constant") return { x: 1, y: 0 };
  if (kind === "bend") {
    const angle = 0.85 * Math.sin(Math.PI * position.y) + 0.25 * position.x;
    return { x: Math.cos(angle), y: Math.sin(angle) };
  }
  const radius = Math.hypot(position.x, position.y);
  return radius < 1e-8
    ? { x: 1, y: 0 }
    : { x: -position.y / radius, y: position.x / radius };
}

export class PeriodicStripeModel {
  readonly resolution: number;
  readonly positions: StripePoint[] = [];
  readonly directions: StripePoint[] = [];
  readonly edges: StripeEdge[] = [];
  phase: ComplexValue[] = [];
  iterations = 0;
  fieldKind: StripeFieldKind;
  frequency: number;
  private maximumDegree = 1;
  private readonly customDirections?: readonly StripePoint[];

  constructor(
    resolution = 19,
    fieldKind: StripeFieldKind = "swirl",
    frequency = 4.5,
    customDirections?: readonly StripePoint[],
  ) {
    if (!Number.isInteger(resolution) || resolution < 7 || resolution > 49) {
      throw new Error("resolution must be an integer from 7 through 49");
    }
    if (!Number.isFinite(frequency) || frequency <= 0 || frequency > 20) {
      throw new Error("frequency must be between 0 and 20");
    }
    this.resolution = resolution;
    this.fieldKind = fieldKind;
    this.frequency = frequency;
    this.customDirections = customDirections;
    if (fieldKind === "custom" && customDirections?.length !== resolution * resolution) {
      throw new Error("customDirections must provide one vector per grid vertex");
    }
    this.build();
    this.reset();
  }

  private index(column: number, row: number): number {
    return row * this.resolution + column;
  }

  private build(): void {
    const n = this.resolution;
    for (let row = 0; row < n; row += 1) {
      for (let column = 0; column < n; column += 1) {
        const position = {
          x: -1 + 2 * column / (n - 1),
          y: -1 + 2 * row / (n - 1),
        };
        this.positions.push(position);
        const prescribed = this.customDirections?.[this.positions.length - 1];
        this.directions.push(prescribed ?? direction(position, this.fieldKind));
      }
    }
    const pairs: Array<[number, number]> = [];
    for (let row = 0; row < n; row += 1) {
      for (let column = 0; column < n; column += 1) {
        const vertex = this.index(column, row);
        if (column + 1 < n) pairs.push([vertex, this.index(column + 1, row)]);
        if (row + 1 < n) pairs.push([vertex, this.index(column, row + 1)]);
        if (column + 1 < n && row + 1 < n) pairs.push([vertex, this.index(column + 1, row + 1)]);
      }
    }
    const degrees = new Float64Array(n * n);
    const angularRate = Math.PI * this.frequency;
    for (const [tail, head] of pairs) {
      const a = this.positions[tail]!;
      const b = this.positions[head]!;
      const edge = { x: b.x - a.x, y: b.y - a.y };
      const zi = this.directions[tail]!;
      const zj = this.directions[head]!;
      const omega = 0.5 * angularRate * (
        edge.x * (zi.x + zj.x) + edge.y * (zi.y + zj.y)
      );
      const weight = Math.abs(edge.x) > 0 && Math.abs(edge.y) > 0 ? Math.SQRT1_2 : 1;
      this.edges.push({ tail, head, omega, weight });
      degrees[tail] = degrees[tail]! + weight;
      degrees[head] = degrees[head]! + weight;
    }
    this.maximumDegree = Math.max(...degrees);
  }

  reset(): void {
    this.phase = this.positions.map((position, index) => {
      const angle = 0.37 * Math.sin(index * 1.618) + 0.31 * position.x - 0.17 * position.y;
      return { re: Math.cos(angle), im: Math.sin(angle) };
    });
    this.normalize();
    this.iterations = 0;
  }

  private normalize(): void {
    const norm = Math.sqrt(this.phase.reduce(
      (sum, value) => sum + value.re * value.re + value.im * value.im,
      0,
    ));
    const scale = Math.sqrt(this.phase.length) / Math.max(1e-14, norm);
    for (const value of this.phase) {
      value.re *= scale;
      value.im *= scale;
    }
  }

  step(count = 100): void {
    if (!Number.isInteger(count) || count < 1 || count > 5000) {
      throw new Error("iteration count must be an integer from 1 through 5000");
    }
    // For this Hermitian connection Laplacian, lambda_max <= 2 d_max.
    // A step below 1 / d_max is stable and converges much more quickly than
    // the deliberately conservative value used in the first prototype.
    const stepSize = 0.42 / this.maximumDegree;
    for (let iteration = 0; iteration < count; iteration += 1) {
      const gradient = this.phase.map(() => ({ re: 0, im: 0 }));
      for (const edge of this.edges) {
        const transportedTail = rotate(this.phase[edge.tail]!, edge.omega);
        const residual = {
          re: this.phase[edge.head]!.re - transportedTail.re,
          im: this.phase[edge.head]!.im - transportedTail.im,
        };
        gradient[edge.head]!.re += edge.weight * residual.re;
        gradient[edge.head]!.im += edge.weight * residual.im;
        const back = rotate(residual, -edge.omega);
        gradient[edge.tail]!.re -= edge.weight * back.re;
        gradient[edge.tail]!.im -= edge.weight * back.im;
      }
      for (let index = 0; index < this.phase.length; index += 1) {
        this.phase[index]!.re -= stepSize * gradient[index]!.re;
        this.phase[index]!.im -= stepSize * gradient[index]!.im;
      }
      this.normalize();
      this.iterations += 1;
    }
  }

  report(): StripePatternReport {
    let energy = 0;
    let residual2 = 0;
    let minAmplitude = Number.POSITIVE_INFINITY;
    let maxAmplitude = 0;
    for (const edge of this.edges) {
      const transportedTail = rotate(this.phase[edge.tail]!, edge.omega);
      const dx = this.phase[edge.head]!.re - transportedTail.re;
      const dy = this.phase[edge.head]!.im - transportedTail.im;
      energy += 0.5 * edge.weight * (dx * dx + dy * dy);
      residual2 += dx * dx + dy * dy;
    }
    for (const value of this.phase) {
      const amplitude = Math.hypot(value.re, value.im);
      minAmplitude = Math.min(minAmplitude, amplitude);
      maxAmplitude = Math.max(maxAmplitude, amplitude);
    }
    return {
      energy,
      residualRms: Math.sqrt(residual2 / this.edges.length),
      minAmplitude,
      maxAmplitude,
      iterations: this.iterations,
    };
  }

  massNorm(): number {
    return this.phase.reduce(
      (sum, value) => sum + value.re * value.re + value.im * value.im,
      0,
    ) / this.phase.length;
  }
}
