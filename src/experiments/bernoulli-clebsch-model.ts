export interface NozzlePoint {
  x: number;
  y: number;
}

export interface NozzleParticle {
  x: number;
  eta: number;
  family: number;
}

export interface NozzleTriangleSample {
  column: number;
  vertices: readonly [number, number, number];
  centroid: NozzlePoint;
  velocity: NozzlePoint;
  harmonicVelocity: NozzlePoint;
  clebschVelocity: NozzlePoint;
  vorticity: number;
  pressure: number;
  area: number;
}

export interface NozzleDiagnostics {
  fluxMean: number;
  fluxSpread: number;
  harmonicCirculation: number;
  divergenceRms: number;
  vorticityRms: number;
  wideSpeed: number;
  throatSpeed: number;
  pressureDrop: number;
  labelDrift: number;
  time: number;
}

export interface BernoulliClebschOptions {
  columns?: number;
  rows?: number;
  constriction?: number;
  meanSpeed?: number;
  density?: number;
  vortexStrength?: number;
  timeStep?: number;
  particles?: number;
}

interface Triangle {
  column: number;
  vertices: [number, number, number];
  gradients: [NozzlePoint, NozzlePoint, NozzlePoint];
  centroid: NozzlePoint;
  area: number;
}

const EPSILON = 1e-12;

function positiveModulo(value: number, period: number): number {
  return ((value % period) + period) % period;
}

function dot(left: NozzlePoint, right: NozzlePoint): number {
  return left.x * right.x + left.y * right.y;
}

function add(left: NozzlePoint, right: NozzlePoint): NozzlePoint {
  return { x: left.x + right.x, y: left.y + right.y };
}

function scale(value: NozzlePoint, amount: number): NozzlePoint {
  return { x: amount * value.x, y: amount * value.y };
}

function rms(values: ArrayLike<number>): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (let index = 0; index < values.length; index += 1) sum += values[index]! * values[index]!;
  return Math.sqrt(sum / values.length);
}

/**
 * A periodic Venturi channel. The two vertical ends are identified, so the
 * mean through-flow is a harmonic circulation rather than an inlet condition.
 * The finite-element projection is deliberately small and inspectable: it is
 * the same weak Neumann Hodge solve used for the harmonic field and for
 * d phi + alpha d beta.
 */
export class BernoulliClebschModel {
  readonly length = 6;
  readonly columns: number;
  readonly rows: number;
  density: number;
  meanSpeed: number;
  vortexStrength: number;
  timeStep: number;
  constriction: number;
  time = 0;

  private vertices: NozzlePoint[] = [];
  private triangles: Triangle[] = [];
  private diagonal = new Float64Array(0);
  private mass = new Float64Array(0);
  private alpha = new Float64Array(0);
  private beta = new Float64Array(0);
  private phi = new Float64Array(0);
  private harmonicPhi = new Float64Array(0);
  private harmonicUnit: NozzlePoint[] = [];
  private harmonicScale = 1;
  private triangleVelocity: NozzlePoint[] = [];
  private triangleClebschVelocity: NozzlePoint[] = [];
  private triangleVorticity = new Float64Array(0);
  private particles: NozzleParticle[] = [];
  private trackedInitial: readonly [number, number] = [0, 0];

  constructor(options: BernoulliClebschOptions = {}) {
    this.columns = Math.max(16, Math.round(options.columns ?? 64));
    this.rows = Math.max(8, Math.round(options.rows ?? 25));
    this.constriction = Math.max(0, Math.min(0.68, options.constriction ?? 0.46));
    this.meanSpeed = Math.max(0.05, options.meanSpeed ?? 0.72);
    this.density = Math.max(0.05, options.density ?? 1);
    this.vortexStrength = Math.max(0, options.vortexStrength ?? 0.34);
    this.timeStep = Math.max(0.001, options.timeStep ?? 0.012);
    this.buildGeometry();
    this.reset(options.particles ?? 180);
  }

  height(x: number): number {
    const phase = 2 * Math.PI * (positiveModulo(x, this.length) - 0.5 * this.length) / this.length;
    return 1 - 0.5 * this.constriction * (1 + Math.cos(phase));
  }

  heightDerivative(x: number): number {
    const phase = 2 * Math.PI * (positiveModulo(x, this.length) - 0.5 * this.length) / this.length;
    return this.constriction * Math.PI * Math.sin(phase) / this.length;
  }

  position(x: number, eta: number): NozzlePoint {
    return { x: positiveModulo(x, this.length), y: eta * this.height(x) };
  }

  get vertexCount(): number {
    return this.vertices.length;
  }

  get triangleCount(): number {
    return this.triangles.length;
  }

  getVertices(): readonly NozzlePoint[] {
    return this.vertices;
  }

  getAlpha(): Float64Array {
    return this.alpha;
  }

  getBeta(): Float64Array {
    return this.beta;
  }

  getPhi(): Float64Array {
    return this.phi;
  }

  getParticles(): readonly NozzleParticle[] {
    return this.particles;
  }

  setConstriction(value: number): void {
    this.constriction = Math.max(0, Math.min(0.68, value));
    const particleCount = this.particles.length || 180;
    this.buildGeometry();
    this.reset(particleCount);
  }

  setMeanSpeed(value: number): void {
    this.meanSpeed = Math.max(0.05, value);
    this.scaleHarmonicField();
    this.reconstruct();
  }

  setDensity(value: number): void {
    this.density = Math.max(0.05, value);
  }

  setVortexStrength(value: number): void {
    this.vortexStrength = Math.max(0, value);
    this.reset(this.particles.length || 180);
  }

  reset(particleCount = this.particles.length || 180): void {
    this.time = 0;
    this.initializeLabels();
    this.initializeParticles(particleCount);
    this.reconstruct();
    const tracked = this.particles[0]!;
    this.trackedInitial = [
      this.sampleGrid(this.alpha, tracked.x, tracked.eta),
      this.sampleGrid(this.beta, tracked.x, tracked.eta),
    ];
  }

  step(count = 1): void {
    for (let iteration = 0; iteration < count; iteration += 1) {
      const vertexVelocity = this.vertexVelocities();
      const nextAlpha = new Float64Array(this.alpha.length);
      const nextBeta = new Float64Array(this.beta.length);
      const dx = this.length / this.columns;
      for (let iy = 0; iy < this.rows; iy += 1) {
        const eta = -0.5 + iy / (this.rows - 1);
        for (let ix = 0; ix < this.columns; ix += 1) {
          const index = this.vertexIndex(ix, iy);
          const velocity = vertexVelocity[index]!;
          const x = ix * dx;
          const h = this.height(x);
          const etaVelocity = (velocity.y - eta * this.heightDerivative(x) * velocity.x) / h;
          const backX = positiveModulo(x - this.timeStep * velocity.x, this.length);
          const backEta = Math.max(-0.5, Math.min(0.5, eta - this.timeStep * etaVelocity));
          nextAlpha[index] = this.sampleGrid(this.alpha, backX, backEta);
          nextBeta[index] = this.sampleGrid(this.beta, backX, backEta);
        }
      }
      this.alpha = nextAlpha;
      this.beta = nextBeta;
      this.advectParticles(vertexVelocity);
      this.time += this.timeStep;
      if (iteration + 1 < count) this.reconstruct();
    }
    this.reconstruct();
  }

  sampleVelocity(x: number, eta: number): NozzlePoint {
    const vertexVelocity = this.vertexVelocities();
    return {
      x: this.samplePointGrid(vertexVelocity, x, eta, "x"),
      y: this.samplePointGrid(vertexVelocity, x, eta, "y"),
    };
  }

  triangleSamples(): NozzleTriangleSample[] {
    const referenceSpeed = this.wideSectionSpeed();
    return this.triangles.map((triangle, index) => {
      const harmonicVelocity = scale(this.harmonicUnit[index]!, this.harmonicScale);
      const speedSquared = dot(harmonicVelocity, harmonicVelocity);
      return {
        column: triangle.column,
        vertices: triangle.vertices,
        centroid: triangle.centroid,
        velocity: this.triangleVelocity[index]!,
        harmonicVelocity,
        clebschVelocity: this.triangleClebschVelocity[index]!,
        vorticity: this.triangleVorticity[index]!,
        pressure: 0.5 * this.density * (referenceSpeed * referenceSpeed - speedSquared),
        area: triangle.area,
      };
    });
  }

  areaLawSpeed(x: number): number {
    return this.meanSpeed / this.height(x);
  }

  diagnostics(): NozzleDiagnostics {
    const fluxes = this.columnFluxes();
    const fluxMean = fluxes.reduce((sum, value) => sum + value, 0) / fluxes.length;
    const fluxSpread = Math.max(...fluxes) - Math.min(...fluxes);
    const weakDivergence = this.weakDivergence(this.triangleVelocity);
    const divergenceValues = weakDivergence.map((value, index) => value / Math.max(this.vertexMass(index), EPSILON));
    const wideSpeed = this.wideSectionSpeed();
    const throatSpeed = this.sectionRmsSpeed(Math.floor(this.columns / 2));
    const tracked = this.particles[0]!;
    const trackedAlpha = this.sampleGrid(this.alpha, tracked.x, tracked.eta);
    const trackedBeta = this.sampleGrid(this.beta, tracked.x, tracked.eta);
    return {
      fluxMean,
      fluxSpread,
      harmonicCirculation: this.harmonicScale * this.length,
      divergenceRms: rms(divergenceValues),
      vorticityRms: rms([...this.triangleVorticity]),
      wideSpeed,
      throatSpeed,
      pressureDrop: 0.5 * this.density * (throatSpeed * throatSpeed - wideSpeed * wideSpeed),
      labelDrift: Math.hypot(trackedAlpha - this.trackedInitial[0], trackedBeta - this.trackedInitial[1]),
      time: this.time,
    };
  }

  private vertexIndex(ix: number, iy: number): number {
    return iy * this.columns + positiveModulo(ix, this.columns);
  }

  private buildGeometry(): void {
    this.vertices = [];
    this.triangles = [];
    const dx = this.length / this.columns;
    for (let iy = 0; iy < this.rows; iy += 1) {
      const eta = -0.5 + iy / (this.rows - 1);
      for (let ix = 0; ix < this.columns; ix += 1) {
        this.vertices.push(this.position(ix * dx, eta));
      }
    }
    for (let ix = 0; ix < this.columns; ix += 1) {
      const next = (ix + 1) % this.columns;
      const x0 = ix * dx;
      const x1 = x0 + dx;
      for (let iy = 0; iy < this.rows - 1; iy += 1) {
        const eta0 = -0.5 + iy / (this.rows - 1);
        const eta1 = -0.5 + (iy + 1) / (this.rows - 1);
        const lowerLeft = { x: x0, y: eta0 * this.height(x0) };
        const lowerRight = { x: x1, y: eta0 * this.height(x1) };
        const upperLeft = { x: x0, y: eta1 * this.height(x0) };
        const upperRight = { x: x1, y: eta1 * this.height(x1) };
        this.triangles.push(this.makeTriangle(
          ix,
          [this.vertexIndex(ix, iy), this.vertexIndex(next, iy), this.vertexIndex(next, iy + 1)],
          [lowerLeft, lowerRight, upperRight],
        ));
        this.triangles.push(this.makeTriangle(
          ix,
          [this.vertexIndex(ix, iy), this.vertexIndex(next, iy + 1), this.vertexIndex(ix, iy + 1)],
          [lowerLeft, upperRight, upperLeft],
        ));
      }
    }
    this.assembleDiagonal();
    this.buildHarmonicField();
  }

  private makeTriangle(column: number, vertices: [number, number, number], points: [NozzlePoint, NozzlePoint, NozzlePoint]): Triangle {
    const [first, second, third] = points;
    const twiceArea = (second.x - first.x) * (third.y - first.y) - (second.y - first.y) * (third.x - first.x);
    const gradients: [NozzlePoint, NozzlePoint, NozzlePoint] = [
      { x: (second.y - third.y) / twiceArea, y: (third.x - second.x) / twiceArea },
      { x: (third.y - first.y) / twiceArea, y: (first.x - third.x) / twiceArea },
      { x: (first.y - second.y) / twiceArea, y: (second.x - first.x) / twiceArea },
    ];
    return {
      column,
      vertices,
      gradients,
      centroid: {
        x: positiveModulo((first.x + second.x + third.x) / 3, this.length),
        y: (first.y + second.y + third.y) / 3,
      },
      area: Math.abs(twiceArea) / 2,
    };
  }

  private assembleDiagonal(): void {
    this.diagonal = new Float64Array(this.vertices.length);
    this.mass = new Float64Array(this.vertices.length);
    for (const triangle of this.triangles) {
      for (let local = 0; local < 3; local += 1) {
        const vertex = triangle.vertices[local]!;
        this.diagonal[vertex] = this.diagonal[vertex]! + triangle.area * dot(triangle.gradients[local]!, triangle.gradients[local]!);
        this.mass[vertex] = this.mass[vertex]! + triangle.area / 3;
      }
    }
  }

  private applyStiffness(values: Float64Array): Float64Array {
    const result = new Float64Array(values.length);
    for (const triangle of this.triangles) {
      let triangleGradient = { x: 0, y: 0 };
      for (let local = 0; local < 3; local += 1) {
        triangleGradient = add(triangleGradient, scale(triangle.gradients[local]!, values[triangle.vertices[local]!]!));
      }
      for (let local = 0; local < 3; local += 1) {
        const vertex = triangle.vertices[local]!;
        result[vertex] = result[vertex]! + triangle.area * dot(triangle.gradients[local]!, triangleGradient);
      }
    }
    return result;
  }

  private projectMean(values: Float64Array): void {
    let mean = 0;
    for (const value of values) mean += value;
    mean /= values.length;
    for (let index = 0; index < values.length; index += 1) values[index] = values[index]! - mean;
  }

  private solvePotential(rhs: Float64Array, iterations = 420): Float64Array {
    const solution = new Float64Array(rhs.length);
    const residual = new Float64Array(rhs);
    this.projectMean(residual);
    const direction = new Float64Array(residual);
    let residualSquared = dotArrays(residual, residual);
    const initialNorm = Math.sqrt(Math.max(residualSquared, EPSILON));
    for (let iteration = 0; iteration < iterations; iteration += 1) {
      const applied = this.applyStiffness(direction);
      const denominator = dotArrays(direction, applied);
      if (Math.abs(denominator) < 1e-24) break;
      const amount = residualSquared / denominator;
      for (let index = 0; index < rhs.length; index += 1) {
        solution[index] = solution[index]! + amount * direction[index]!;
        residual[index] = residual[index]! - amount * applied[index]!;
      }
      this.projectMean(residual);
      if (Math.sqrt(dotArrays(residual, residual)) < 1e-11 * initialNorm) break;
      const nextResidualSquared = dotArrays(residual, residual);
      const beta = nextResidualSquared / residualSquared;
      for (let index = 0; index < rhs.length; index += 1) direction[index] = residual[index]! + beta * direction[index]!;
      residualSquared = nextResidualSquared;
    }
    this.projectMean(solution);
    return solution;
  }

  private projectVectorField(candidate: readonly NozzlePoint[]): { potential: Float64Array; velocity: NozzlePoint[] } {
    const rhs = new Float64Array(this.vertices.length);
    for (let triangleIndex = 0; triangleIndex < this.triangles.length; triangleIndex += 1) {
      const triangle = this.triangles[triangleIndex]!;
      const vector = candidate[triangleIndex]!;
      for (let local = 0; local < 3; local += 1) {
        const vertex = triangle.vertices[local]!;
        rhs[vertex] = rhs[vertex]! - triangle.area * dot(triangle.gradients[local]!, vector);
      }
    }
    const potential = this.solvePotential(rhs);
    const velocity = this.triangles.map((triangle, triangleIndex) => {
      let gradient = { x: 0, y: 0 };
      for (let local = 0; local < 3; local += 1) {
        gradient = add(gradient, scale(triangle.gradients[local]!, potential[triangle.vertices[local]!]!));
      }
      return add(candidate[triangleIndex]!, gradient);
    });
    return { potential, velocity };
  }

  private buildHarmonicField(): void {
    const candidate = this.triangles.map(() => ({ x: 1, y: 0 }));
    const projected = this.projectVectorField(candidate);
    this.harmonicPhi = new Float64Array(projected.potential);
    this.harmonicUnit = projected.velocity;
    this.scaleHarmonicField();
  }

  private scaleHarmonicField(): void {
    let flux = 0;
    for (let index = 0; index < this.triangles.length; index += 1) {
      flux += this.triangles[index]!.area * this.harmonicUnit[index]!.x / this.length;
    }
    this.harmonicScale = this.meanSpeed / Math.max(flux, EPSILON);
  }

  private initializeLabels(): void {
    this.alpha = new Float64Array(this.vertices.length);
    this.beta = new Float64Array(this.vertices.length);
    const dx = this.length / this.columns;
    for (let iy = 0; iy < this.rows; iy += 1) {
      const eta = -0.5 + iy / (this.rows - 1);
      for (let ix = 0; ix < this.columns; ix += 1) {
        const x = ix * dx;
        const phase = 2 * Math.PI * x / this.length;
        const index = this.vertexIndex(ix, iy);
        this.alpha[index] = this.vortexStrength * (0.78 * Math.sin(phase) + 0.34 * Math.sin(2 * phase) * Math.cos(Math.PI * eta));
        this.beta[index] = eta + 0.19 * Math.cos(phase) * Math.cos(Math.PI * eta);
      }
    }
    this.phi = new Float64Array(this.vertices.length);
  }

  private initializeParticles(count: number): void {
    const particleCount = Math.max(20, Math.round(count));
    this.particles = Array.from({ length: particleCount }, (_, index) => {
      const strand = index % 9;
      return {
        x: positiveModulo((index * 0.61803398875 + 0.09 * strand) * this.length, this.length),
        eta: -0.43 + 0.86 * ((index * 0.754877666 + 0.11 * strand) % 1),
        family: index % 2,
      };
    });
  }

  private reconstruct(): void {
    const candidate: NozzlePoint[] = [];
    const vorticity = new Float64Array(this.triangles.length);
    for (let triangleIndex = 0; triangleIndex < this.triangles.length; triangleIndex += 1) {
      const triangle = this.triangles[triangleIndex]!;
      let gradientAlpha = { x: 0, y: 0 };
      let gradientBeta = { x: 0, y: 0 };
      let averageAlpha = 0;
      for (let local = 0; local < 3; local += 1) {
        const vertex = triangle.vertices[local]!;
        gradientAlpha = add(gradientAlpha, scale(triangle.gradients[local]!, this.alpha[vertex]!));
        gradientBeta = add(gradientBeta, scale(triangle.gradients[local]!, this.beta[vertex]!));
        averageAlpha += this.alpha[vertex]! / 3;
      }
      candidate.push(scale(gradientBeta, averageAlpha));
      vorticity[triangleIndex] = gradientAlpha.x * gradientBeta.y - gradientAlpha.y * gradientBeta.x;
    }
    const projected = this.projectVectorField(candidate);
    let harmonicInnerProduct = 0;
    let harmonicNormSquared = 0;
    for (let index = 0; index < this.triangles.length; index += 1) {
      harmonicInnerProduct += this.triangles[index]!.area * dot(projected.velocity[index]!, this.harmonicUnit[index]!);
      harmonicNormSquared += this.triangles[index]!.area * dot(this.harmonicUnit[index]!, this.harmonicUnit[index]!);
    }
    const harmonicCoefficient = harmonicInnerProduct / Math.max(harmonicNormSquared, EPSILON);
    const zeroPeriodVelocity = projected.velocity.map((velocity, index) => (
      add(velocity, scale(this.harmonicUnit[index]!, -harmonicCoefficient))
    ));
    this.phi = new Float64Array(projected.potential);
    this.triangleClebschVelocity = zeroPeriodVelocity;
    this.triangleVorticity = vorticity;
    this.triangleVelocity = zeroPeriodVelocity.map((velocity, index) => add(velocity, scale(this.harmonicUnit[index]!, this.harmonicScale)));
  }

  private vertexVelocities(): NozzlePoint[] {
    const sums = this.vertices.map(() => ({ x: 0, y: 0 }));
    const weights = new Float64Array(this.vertices.length);
    for (let triangleIndex = 0; triangleIndex < this.triangles.length; triangleIndex += 1) {
      const triangle = this.triangles[triangleIndex]!;
      for (const vertex of triangle.vertices) {
        sums[vertex] = add(sums[vertex]!, scale(this.triangleVelocity[triangleIndex]!, triangle.area));
        weights[vertex] = weights[vertex]! + triangle.area;
      }
    }
    return sums.map((sum, index) => scale(sum, 1 / Math.max(weights[index]!, EPSILON)));
  }

  private sampleGrid(values: Float64Array, x: number, eta: number): number {
    const wrappedX = positiveModulo(x, this.length);
    const gx = wrappedX * this.columns / this.length;
    const ix0 = Math.floor(gx);
    const tx = gx - ix0;
    const gy = (Math.max(-0.5, Math.min(0.5, eta)) + 0.5) * (this.rows - 1);
    const iy0 = Math.min(this.rows - 2, Math.floor(gy));
    const ty = gy - iy0;
    const ix1 = (ix0 + 1) % this.columns;
    const a = values[this.vertexIndex(ix0, iy0)]! * (1 - tx) + values[this.vertexIndex(ix1, iy0)]! * tx;
    const b = values[this.vertexIndex(ix0, iy0 + 1)]! * (1 - tx) + values[this.vertexIndex(ix1, iy0 + 1)]! * tx;
    return a * (1 - ty) + b * ty;
  }

  private samplePointGrid(values: readonly NozzlePoint[], x: number, eta: number, component: "x" | "y"): number {
    const wrappedX = positiveModulo(x, this.length);
    const gx = wrappedX * this.columns / this.length;
    const ix0 = Math.floor(gx);
    const tx = gx - ix0;
    const gy = (Math.max(-0.5, Math.min(0.5, eta)) + 0.5) * (this.rows - 1);
    const iy0 = Math.min(this.rows - 2, Math.floor(gy));
    const ty = gy - iy0;
    const ix1 = (ix0 + 1) % this.columns;
    const a = values[this.vertexIndex(ix0, iy0)]![component] * (1 - tx) + values[this.vertexIndex(ix1, iy0)]![component] * tx;
    const b = values[this.vertexIndex(ix0, iy0 + 1)]![component] * (1 - tx) + values[this.vertexIndex(ix1, iy0 + 1)]![component] * tx;
    return a * (1 - ty) + b * ty;
  }

  private advectParticles(vertexVelocity: readonly NozzlePoint[]): void {
    for (const particle of this.particles) {
      const velocity = {
        x: this.samplePointGrid(vertexVelocity, particle.x, particle.eta, "x"),
        y: this.samplePointGrid(vertexVelocity, particle.x, particle.eta, "y"),
      };
      const h = this.height(particle.x);
      const etaVelocity = (velocity.y - particle.eta * this.heightDerivative(particle.x) * velocity.x) / h;
      particle.x = positiveModulo(particle.x + this.timeStep * velocity.x, this.length);
      particle.eta = Math.max(-0.495, Math.min(0.495, particle.eta + this.timeStep * etaVelocity));
    }
  }

  private weakDivergence(velocity: readonly NozzlePoint[]): Float64Array {
    const result = new Float64Array(this.vertices.length);
    for (let triangleIndex = 0; triangleIndex < this.triangles.length; triangleIndex += 1) {
      const triangle = this.triangles[triangleIndex]!;
      for (let local = 0; local < 3; local += 1) {
        const vertex = triangle.vertices[local]!;
        result[vertex] = result[vertex]! + triangle.area * dot(triangle.gradients[local]!, velocity[triangleIndex]!);
      }
    }
    return result;
  }

  private vertexMass(index: number): number {
    return this.mass[index]!;
  }

  private columnFluxes(): number[] {
    const dx = this.length / this.columns;
    const flux = new Array(this.columns).fill(0) as number[];
    for (let index = 0; index < this.triangles.length; index += 1) {
      const triangle = this.triangles[index]!;
      flux[triangle.column] = flux[triangle.column]! + triangle.area * this.triangleVelocity[index]!.x / dx;
    }
    return flux;
  }

  private sectionRmsSpeed(column: number): number {
    let weighted = 0;
    let area = 0;
    for (let index = 0; index < this.triangles.length; index += 1) {
      const triangle = this.triangles[index]!;
      if (triangle.column !== positiveModulo(column, this.columns)) continue;
      weighted += triangle.area * dot(this.harmonicUnit[index]!, this.harmonicUnit[index]!);
      area += triangle.area;
    }
    return this.harmonicScale * Math.sqrt(weighted / Math.max(area, EPSILON));
  }

  private wideSectionSpeed(): number {
    return this.sectionRmsSpeed(0);
  }
}

function dotArrays(left: Float64Array, right: Float64Array): number {
  let result = 0;
  for (let index = 0; index < left.length; index += 1) result += left[index]! * right[index]!;
  return result;
}
