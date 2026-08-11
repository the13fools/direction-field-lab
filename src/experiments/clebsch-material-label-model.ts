export interface MaterialVec2 {
  x: number;
  y: number;
}

export interface ClebschMaterialPoint {
  x: number;
  y: number;
  unwrappedX: number;
  unwrappedY: number;
  alpha: number;
  beta: number;
  phi: number;
}

export interface ClebschMaterialDiagnostics {
  time: number;
  tracerAlpha: number;
  tracerBeta: number;
  tracerPhi: number;
  tracerPhiChange: number;
  tracerVorticity: number;
  tracerVorticityError: number;
  patchAreaRatio: number;
}

const TAU = 2 * Math.PI;

function wrap(value: number): number {
  return ((value % TAU) + TAU) % TAU;
}

function signedPolygonArea(points: readonly ClebschMaterialPoint[]): number {
  let twiceArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index]!;
    const next = points[(index + 1) % points.length]!;
    twiceArea += point.unwrappedX * next.unwrappedY - next.unwrappedX * point.unwrappedY;
  }
  return 0.5 * twiceArea;
}

export class ClebschMaterialLabelModel {
  readonly amplitude: number;
  readonly alphaLines: ClebschMaterialPoint[][] = [];
  readonly betaLines: ClebschMaterialPoint[][] = [];
  readonly patch: ClebschMaterialPoint[];
  readonly tracer: ClebschMaterialPoint;
  readonly initialTracerPhi: number;
  readonly initialTracerVorticity: number;
  readonly initialPatchArea: number;
  time = 0;

  constructor(amplitude = 0.8, lineCount = 9, samplesPerLine = 240) {
    if (!(Number.isFinite(amplitude) && amplitude > 0)) throw new Error("amplitude must be positive and finite");
    if (!Number.isInteger(lineCount) || lineCount < 3) throw new Error("lineCount must be an integer of at least three");
    if (!Number.isInteger(samplesPerLine) || samplesPerLine < 16) throw new Error("samplesPerLine must be an integer of at least sixteen");
    this.amplitude = amplitude;
    for (let line = 0; line < lineCount; line += 1) {
      const coordinate = TAU * (line + 0.5) / lineCount;
      this.alphaLines.push(Array.from({ length: samplesPerLine }, (_, sample) => (
        this.makePoint(coordinate, TAU * sample / samplesPerLine)
      )));
      this.betaLines.push(Array.from({ length: samplesPerLine }, (_, sample) => (
        this.makePoint(TAU * sample / samplesPerLine, coordinate)
      )));
    }
    const center = { x: 0.31 * TAU, y: 0.26 * TAU };
    const halfSize = 0.035 * TAU;
    const patchSegments = 18;
    const edgePoint = (edge: number, fraction: number): ClebschMaterialPoint => {
      const left = center.x - halfSize;
      const right = center.x + halfSize;
      const bottom = center.y - halfSize;
      const top = center.y + halfSize;
      if (edge === 0) return this.makePoint(left + 2 * halfSize * fraction, bottom);
      if (edge === 1) return this.makePoint(right, bottom + 2 * halfSize * fraction);
      if (edge === 2) return this.makePoint(right - 2 * halfSize * fraction, top);
      return this.makePoint(left, top - 2 * halfSize * fraction);
    };
    this.patch = Array.from({ length: 4 * patchSegments }, (_, index) => (
      edgePoint(Math.floor(index / patchSegments), (index % patchSegments) / patchSegments)
    ));
    this.tracer = this.makePoint(center.x, center.y);
    this.initialTracerPhi = this.tracer.phi;
    this.initialTracerVorticity = this.vorticity(this.tracer.x, this.tracer.y);
    this.initialPatchArea = Math.abs(signedPolygonArea(this.patch));
  }

  velocity(x: number, y: number): MaterialVec2 {
    return {
      x: this.amplitude * Math.sin(x) * Math.cos(y),
      y: -this.amplitude * Math.cos(x) * Math.sin(y),
    };
  }

  pressure(x: number, y: number): number {
    return 0.25 * this.amplitude ** 2 * (Math.cos(2 * x) + Math.cos(2 * y));
  }

  bernoulliPhiRate(x: number, y: number): number {
    const velocity = this.velocity(x, y);
    return 0.5 * (velocity.x ** 2 + velocity.y ** 2) - this.pressure(x, y);
  }

  vorticity(x: number, y: number): number {
    return 2 * this.amplitude * Math.sin(x) * Math.sin(y);
  }

  private makePoint(x: number, y: number): ClebschMaterialPoint {
    const wrappedX = wrap(x);
    const wrappedY = wrap(y);
    return {
      x: wrappedX,
      y: wrappedY,
      unwrappedX: x,
      unwrappedY: y,
      alpha: 2 * this.amplitude * Math.cos(wrappedX),
      beta: Math.cos(wrappedY),
      phi: -this.amplitude * Math.cos(wrappedX) * Math.cos(wrappedY),
    };
  }

  private advancePoint(point: ClebschMaterialPoint, timeStep: number): void {
    const x = point.unwrappedX;
    const y = point.unwrappedY;
    const k1 = this.velocity(x, y);
    const k2 = this.velocity(x + 0.5 * timeStep * k1.x, y + 0.5 * timeStep * k1.y);
    const k3 = this.velocity(x + 0.5 * timeStep * k2.x, y + 0.5 * timeStep * k2.y);
    const k4 = this.velocity(x + timeStep * k3.x, y + timeStep * k3.y);
    point.unwrappedX += timeStep * (k1.x + 2 * k2.x + 2 * k3.x + k4.x) / 6;
    point.unwrappedY += timeStep * (k1.y + 2 * k2.y + 2 * k3.y + k4.y) / 6;
    point.x = wrap(point.unwrappedX);
    point.y = wrap(point.unwrappedY);
    const r1 = this.bernoulliPhiRate(x, y);
    const r2 = this.bernoulliPhiRate(x + 0.5 * timeStep * k1.x, y + 0.5 * timeStep * k1.y);
    const r3 = this.bernoulliPhiRate(x + 0.5 * timeStep * k2.x, y + 0.5 * timeStep * k2.y);
    const r4 = this.bernoulliPhiRate(x + timeStep * k3.x, y + timeStep * k3.y);
    point.phi += timeStep * (r1 + 2 * r2 + 2 * r3 + r4) / 6;
  }

  step(timeStep: number): void {
    if (!(Number.isFinite(timeStep) && timeStep > 0)) throw new Error("timeStep must be positive and finite");
    for (const line of this.alphaLines) for (const point of line) this.advancePoint(point, timeStep);
    for (const line of this.betaLines) for (const point of line) this.advancePoint(point, timeStep);
    for (const point of this.patch) this.advancePoint(point, timeStep);
    this.advancePoint(this.tracer, timeStep);
    this.time += timeStep;
  }

  diagnostics(): ClebschMaterialDiagnostics {
    const currentVorticity = this.vorticity(this.tracer.x, this.tracer.y);
    return {
      time: this.time,
      tracerAlpha: this.tracer.alpha,
      tracerBeta: this.tracer.beta,
      tracerPhi: this.tracer.phi,
      tracerPhiChange: this.tracer.phi - this.initialTracerPhi,
      tracerVorticity: currentVorticity,
      tracerVorticityError: currentVorticity - this.initialTracerVorticity,
      patchAreaRatio: Math.abs(signedPolygonArea(this.patch)) / this.initialPatchArea,
    };
  }
}
