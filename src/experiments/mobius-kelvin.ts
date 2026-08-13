import {
  MOBIUS_PERIOD,
  MobiusShallowWaterModel,
  mobiusGeometry,
  type MobiusMaterialPoint,
} from "./mobius-shallow-water-model";

export type MobiusKelvinLoopKind = "contractible" | "one-sided";

export interface MobiusKelvinLoop {
  kind: MobiusKelvinLoopKind;
  label: string;
  color: string;
  points: MobiusMaterialPoint[];
  initialCirculation: number;
  circulation: number;
  drift: number;
  enclosedVorticity: number;
  stokesDefect: number;
}

interface CoordinateVelocity {
  s: number;
  r: number;
}

function materialPoint(s: number, r: number): MobiusMaterialPoint {
  return { s, r };
}

function createContractibleLoop(model: MobiusShallowWaterModel): MobiusMaterialPoint[] {
  const points: MobiusMaterialPoint[] = [];
  const samples = 72;
  const centerS = 0.62 * Math.PI;
  const centerR = 0.08 * model.parameters.halfWidth;
  const radiusR = 0.31 * model.parameters.halfWidth;
  const metricS = Math.sqrt(mobiusGeometry(
    centerS,
    centerR,
    model.parameters.majorRadius,
  ).metricSS);
  const radiusS = radiusR / metricS;
  for (let index = 0; index < samples; index += 1) {
    const angle = 2 * Math.PI * index / samples;
    points.push(materialPoint(
      centerS + radiusS * Math.cos(angle),
      centerR + radiusR * Math.sin(angle),
    ));
  }
  return points;
}

function createOneSidedLoop(): MobiusMaterialPoint[] {
  const points: MobiusMaterialPoint[] = [];
  const samples = 112;
  for (let index = 0; index < samples; index += 1) {
    points.push(materialPoint(MOBIUS_PERIOD * index / samples, 0));
  }
  return points;
}

function closingPoint(loop: MobiusKelvinLoop): MobiusMaterialPoint {
  const first = loop.points[0]!;
  if (loop.kind === "contractible") return first;
  // A one-sided loop closes in the base at the deck image of its first lift.
  return materialPoint(first.s + MOBIUS_PERIOD, -first.r);
}

export function mobiusLoopCirculation(
  model: MobiusShallowWaterModel,
  loop: Pick<MobiusKelvinLoop, "kind" | "points">,
): number {
  let circulation = 0;
  for (let index = 0; index < loop.points.length; index += 1) {
    const start = loop.points[index]!;
    const end = index + 1 < loop.points.length
      ? loop.points[index + 1]!
      : loop.kind === "contractible"
        ? loop.points[0]!
        : materialPoint(loop.points[0]!.s + MOBIUS_PERIOD, -loop.points[0]!.r);
    const deltaS = end.s - start.s;
    const deltaR = end.r - start.r;
    const midpoint = materialPoint(
      start.s + 0.5 * deltaS,
      start.r + 0.5 * deltaR,
    );
    const velocity = model.sampleAt(midpoint);
    const metricSS = mobiusGeometry(
      midpoint.s,
      midpoint.r,
      model.parameters.majorRadius,
    ).metricSS;
    circulation += metricSS * velocity.velocityS * deltaS + velocity.velocityR * deltaR;
  }
  return circulation;
}

function twistedFieldAt(
  model: MobiusShallowWaterModel,
  values: Float64Array,
  point: MobiusMaterialPoint,
): number {
  const wrap = Math.floor(point.s / MOBIUS_PERIOD);
  const localS = point.s - wrap * MOBIUS_PERIOD;
  const reflected = Math.abs(wrap % 2) === 1;
  const localR = reflected ? -point.r : point.r;
  const coordinateS = localS / model.ds - 0.5;
  const coordinateR = (localR + model.parameters.halfWidth) / model.dr - 0.5;
  const column0 = Math.floor(coordinateS);
  const row0 = Math.floor(coordinateR);
  const fractionS = coordinateS - column0;
  const fractionR = coordinateR - row0;
  let result = 0;

  for (let rowOffset = 0; rowOffset <= 1; rowOffset += 1) {
    const requestedRow = row0 + rowOffset;
    const row = Math.max(0, Math.min(model.parameters.rows - 1, requestedRow));
    const weightR = rowOffset === 0 ? 1 - fractionR : fractionR;
    for (let columnOffset = 0; columnOffset <= 1; columnOffset += 1) {
      let column = column0 + columnOffset;
      let mappedRow = row;
      let seamSign = 1;
      if (column < 0) {
        column += model.parameters.columns;
        mappedRow = model.parameters.rows - 1 - mappedRow;
        seamSign = -1;
      } else if (column >= model.parameters.columns) {
        column -= model.parameters.columns;
        mappedRow = model.parameters.rows - 1 - mappedRow;
        seamSign = -1;
      }
      const weightS = columnOffset === 0 ? 1 - fractionS : fractionS;
      result += weightS * weightR * seamSign
        * values[mappedRow * model.parameters.columns + column]!;
    }
  }
  return (reflected ? -1 : 1) * result;
}

/** Midpoint quadrature for ∫_S du♭ over the contractible material patch. */
export function mobiusPatchVorticityIntegral(
  model: MobiusShallowWaterModel,
  points: readonly MobiusMaterialPoint[],
): number {
  if (points.length < 3) return 0;
  const vorticity = model.vorticityField();
  const center = points.reduce(
    (sum, point) => ({ s: sum.s + point.s / points.length, r: sum.r + point.r / points.length }),
    { s: 0, r: 0 },
  );
  let integral = 0;
  for (let index = 0; index < points.length; index += 1) {
    const first = points[index]!;
    const second = points[(index + 1) % points.length]!;
    const signedCoordinateArea = 0.5 * (
      (first.s - center.s) * (second.r - center.r)
      - (first.r - center.r) * (second.s - center.s)
    );
    const samplePoint = materialPoint(
      (center.s + first.s + second.s) / 3,
      (center.r + first.r + second.r) / 3,
    );
    const zeta = twistedFieldAt(model, vorticity, samplePoint);
    const sqrtMetric = mobiusGeometry(
      samplePoint.s,
      samplePoint.r,
      model.parameters.majorRadius,
    ).sqrtMetric;
    integral += signedCoordinateArea * zeta * sqrtMetric;
  }
  return integral;
}

export class MobiusKelvinTracker {
  readonly loops: MobiusKelvinLoop[] = [];

  constructor(model: MobiusShallowWaterModel) {
    this.reset(model);
  }

  reset(model: MobiusShallowWaterModel): void {
    this.loops.length = 0;
    this.loops.push(
      {
        kind: "contractible",
        label: "material patch boundary",
        color: "#ffd26a",
        points: createContractibleLoop(model),
        initialCirculation: 0,
        circulation: 0,
        drift: 0,
        enclosedVorticity: 0,
        stokesDefect: 0,
      },
      {
        kind: "one-sided",
        label: "one-sided material loop",
        color: "#58e0e8",
        points: createOneSidedLoop(),
        initialCirculation: 0,
        circulation: 0,
        drift: 0,
        enclosedVorticity: Number.NaN,
        stokesDefect: Number.NaN,
      },
    );
    for (const loop of this.loops) {
      loop.initialCirculation = mobiusLoopCirculation(model, loop);
      loop.circulation = loop.initialCirculation;
      loop.drift = 0;
      if (loop.kind === "contractible") {
        loop.enclosedVorticity = mobiusPatchVorticityIntegral(model, loop.points);
        loop.stokesDefect = loop.circulation - loop.enclosedVorticity;
      }
    }
  }

  loop(kind: MobiusKelvinLoopKind): MobiusKelvinLoop {
    const result = this.loops.find((loop) => loop.kind === kind);
    if (!result) throw new Error(`Missing ${kind} Kelvin loop`);
    return result;
  }

  private captureVelocities(model: MobiusShallowWaterModel): CoordinateVelocity[][] {
    return this.loops.map((loop) => loop.points.map((point) => {
      const sample = model.sampleAt(point);
      return { s: sample.velocityS, r: sample.velocityR };
    }));
  }

  private correctLoop(
    model: MobiusShallowWaterModel,
    loop: MobiusKelvinLoop,
    initialVelocity: CoordinateVelocity[],
    dt: number,
  ): void {
    const limit = model.parameters.halfWidth * (1 - 1e-8);
    for (let index = 0; index < loop.points.length; index += 1) {
      const point = loop.points[index]!;
      const first = initialVelocity[index]!;
      const predictor = materialPoint(
        point.s + dt * first.s,
        Math.max(-limit, Math.min(limit, point.r + dt * first.r)),
      );
      const secondSample = model.sampleAt(predictor);
      point.s += 0.5 * dt * (first.s + secondSample.velocityS);
      point.r = Math.max(
        -limit,
        Math.min(limit, point.r + 0.5 * dt * (first.r + secondSample.velocityR)),
      );
    }
  }

  /** Advances the fluid and both material loops with a synchronized Heun update. */
  step(model: MobiusShallowWaterModel, iterations = 1): number {
    let elapsed = 0;
    for (let iteration = 0; iteration < iterations; iteration += 1) {
      const initialVelocity = this.captureVelocities(model);
      const dt = model.step(1);
      for (let loopIndex = 0; loopIndex < this.loops.length; loopIndex += 1) {
        this.correctLoop(model, this.loops[loopIndex]!, initialVelocity[loopIndex]!, dt);
      }
      elapsed += dt;
    }
    this.updateCirculations(model);
    return elapsed;
  }

  updateCirculations(model: MobiusShallowWaterModel): void {
    for (const loop of this.loops) {
      loop.circulation = mobiusLoopCirculation(model, loop);
      loop.drift = loop.circulation - loop.initialCirculation;
      if (loop.kind === "contractible") {
        loop.enclosedVorticity = mobiusPatchVorticityIntegral(model, loop.points);
        loop.stokesDefect = loop.circulation - loop.enclosedVorticity;
      }
    }
  }

  liftedPath(loop: MobiusKelvinLoop): MobiusMaterialPoint[] {
    return [...loop.points, closingPoint(loop)];
  }
}
