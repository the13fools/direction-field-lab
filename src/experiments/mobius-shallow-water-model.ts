export type MobiusWaterPreset = "seam-pulse" | "twisted-vortex" | "global-current" | "lake-rest";

export interface MobiusWaterParameters {
  columns: number;
  rows: number;
  majorRadius: number;
  halfWidth: number;
  meanDepth: number;
  gravity: number;
  amplitude: number;
  timeStep: number;
  preset: MobiusWaterPreset;
}

export interface MobiusGeometrySample {
  metricSS: number;
  sqrtMetric: number;
  derivativeS: number;
  derivativeR: number;
}

export interface MobiusPrimitiveSample {
  depth: number;
  velocityS: number;
  velocityR: number;
  speed: number;
}

type Vec3 = [number, number, number];

export interface MobiusWaterDiagnostics {
  mass: number;
  massDrift: number;
  energy: number;
  energyDrift: number;
  minimumDepth: number;
  maximumSpeed: number;
  vorticityRms: number;
  potentialVorticityRms: number;
  boundaryCirculation: number;
  circulationDrift: number;
  seamConstraint: number;
}

interface ConservedState {
  mass: Float64Array;
  momentumS: Float64Array;
  momentumR: Float64Array;
}

interface PrimitiveState {
  depth: number;
  velocityS: number;
  velocityR: number;
}

interface Flux {
  mass: number;
  momentumS: number;
  momentumR: number;
}

export const MOBIUS_PERIOD = 2 * Math.PI;

export const DEFAULT_MOBIUS_WATER_PARAMETERS: MobiusWaterParameters = {
  columns: 84,
  rows: 34,
  majorRadius: 1.65,
  halfWidth: 0.52,
  meanDepth: 1,
  gravity: 2.4,
  amplitude: 0.18,
  timeStep: 0.0025,
  preset: "seam-pulse",
};

function validate(parameters: MobiusWaterParameters): void {
  if (!Number.isInteger(parameters.columns) || parameters.columns < 24 || parameters.columns > 160) {
    throw new Error("columns must be an integer from 24 through 160");
  }
  if (!Number.isInteger(parameters.rows) || parameters.rows < 12 || parameters.rows > 80) {
    throw new Error("rows must be an integer from 12 through 80");
  }
  if (!(parameters.majorRadius > parameters.halfWidth && parameters.halfWidth > 0)) {
    throw new Error("majorRadius must exceed the positive halfWidth");
  }
  if (!(parameters.meanDepth > 0 && parameters.gravity > 0 && parameters.timeStep > 0)) {
    throw new Error("meanDepth, gravity, and timeStep must be positive");
  }
  if (!(parameters.amplitude >= 0 && parameters.amplitude <= 0.6)) {
    throw new Error("amplitude must lie in [0,0.6]");
  }
}

export function mobiusGeometry(
  s: number,
  r: number,
  majorRadius = DEFAULT_MOBIUS_WATER_PARAMETERS.majorRadius,
): MobiusGeometrySample {
  const halfAngle = 0.5 * s;
  const radialDistance = majorRadius + r * Math.cos(halfAngle);
  const metricSS = radialDistance ** 2 + 0.25 * r ** 2;
  return {
    metricSS,
    sqrtMetric: Math.sqrt(metricSS),
    derivativeS: -radialDistance * r * Math.sin(halfAngle),
    derivativeR: 2 * radialDistance * Math.cos(halfAngle) + 0.5 * r,
  };
}

export function mobiusPosition(
  s: number,
  r: number,
  majorRadius = DEFAULT_MOBIUS_WATER_PARAMETERS.majorRadius,
): [number, number, number] {
  const radialDistance = majorRadius + r * Math.cos(0.5 * s);
  return [
    radialDistance * Math.cos(s),
    radialDistance * Math.sin(s),
    r * Math.sin(0.5 * s),
  ];
}

export function mobiusTangentS(
  s: number,
  r: number,
  majorRadius = DEFAULT_MOBIUS_WATER_PARAMETERS.majorRadius,
): [number, number, number] {
  const halfAngle = 0.5 * s;
  const radialDistance = majorRadius + r * Math.cos(halfAngle);
  const radialDerivative = -0.5 * r * Math.sin(halfAngle);
  return [
    radialDerivative * Math.cos(s) - radialDistance * Math.sin(s),
    radialDerivative * Math.sin(s) + radialDistance * Math.cos(s),
    0.5 * r * Math.cos(halfAngle),
  ];
}

export function mobiusTangentR(s: number): [number, number, number] {
  return [
    Math.cos(0.5 * s) * Math.cos(s),
    Math.cos(0.5 * s) * Math.sin(s),
    Math.sin(0.5 * s),
  ];
}

/** Levi–Civita parallel frame along the centerline, initialized by its coordinate frame at s=0. */
export function mobiusCenterlineParallelFrame(
  s: number,
  majorRadius = DEFAULT_MOBIUS_WATER_PARAMETERS.majorRadius,
): { longitudinal: Vec3; transverse: Vec3; connectionAngle: number } {
  const tangentS = mobiusTangentS(s, 0, majorRadius);
  const tangentSLength = Math.hypot(...tangentS);
  const e1: Vec3 = [
    tangentS[0] / tangentSLength,
    tangentS[1] / tangentSLength,
    tangentS[2] / tangentSLength,
  ];
  const e2 = mobiusTangentR(s);
  // Along r=0 the connection one-form is cos(s/2) ds, hence theta=2 sin(s/2).
  const connectionAngle = 2 * Math.sin(0.5 * s);
  const cosine = Math.cos(connectionAngle);
  const sine = Math.sin(connectionAngle);
  return {
    longitudinal: [
      cosine * e1[0] + sine * e2[0],
      cosine * e1[1] + sine * e2[1],
      cosine * e1[2] + sine * e2[2],
    ],
    transverse: [
      -sine * e1[0] + cosine * e2[0],
      -sine * e1[1] + cosine * e2[1],
      -sine * e1[2] + cosine * e2[2],
    ],
    connectionAngle,
  };
}

function rms(values: ArrayLike<number>): number {
  let sum = 0;
  for (let index = 0; index < values.length; index += 1) sum += values[index]! ** 2;
  return Math.sqrt(sum / Math.max(1, values.length));
}

export class MobiusShallowWaterModel {
  parameters: MobiusWaterParameters;
  time = 0;
  steps = 0;

  private state: ConservedState;
  private initialMass = 0;
  private initialEnergy = 0;
  private initialCirculation = 0;

  constructor(parameters: Partial<MobiusWaterParameters> = {}) {
    this.parameters = { ...DEFAULT_MOBIUS_WATER_PARAMETERS, ...parameters };
    validate(this.parameters);
    this.state = this.createState();
    this.reset();
  }

  get count(): number {
    return this.parameters.columns * this.parameters.rows;
  }

  get ds(): number {
    return MOBIUS_PERIOD / this.parameters.columns;
  }

  get dr(): number {
    return 2 * this.parameters.halfWidth / this.parameters.rows;
  }

  private createState(): ConservedState {
    const count = this.parameters.columns * this.parameters.rows;
    return {
      mass: new Float64Array(count),
      momentumS: new Float64Array(count),
      momentumR: new Float64Array(count),
    };
  }

  private index(column: number, row: number): number {
    return row * this.parameters.columns + column;
  }

  coordinate(column: number, row: number): { s: number; r: number } {
    return {
      s: (column + 0.5) * this.ds,
      r: -this.parameters.halfWidth + (row + 0.5) * this.dr,
    };
  }

  geometry(column: number, row: number): MobiusGeometrySample {
    const { s, r } = this.coordinate(column, row);
    return mobiusGeometry(s, r, this.parameters.majorRadius);
  }

  private setPrimitive(
    target: ConservedState,
    column: number,
    row: number,
    depth: number,
    velocityS: number,
    velocityR: number,
  ): void {
    const index = this.index(column, row);
    const sqrtMetric = this.geometry(column, row).sqrtMetric;
    target.mass[index] = sqrtMetric * depth;
    target.momentumS[index] = sqrtMetric * depth * velocityS;
    target.momentumR[index] = sqrtMetric * depth * velocityR;
  }

  reset(parameters: Partial<MobiusWaterParameters> = {}): void {
    this.parameters = { ...this.parameters, ...parameters };
    validate(this.parameters);
    this.state = this.createState();
    this.time = 0;
    this.steps = 0;
    const { columns, rows, meanDepth, amplitude, halfWidth, preset } = this.parameters;

    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const { s, r } = this.coordinate(column, row);
        let depth = meanDepth;
        let velocityS = 0;
        let velocityR = 0;

        if (preset === "seam-pulse") {
          const longitudinalScale = 0.42;
          const transverseScale = 0.17;
          const offset = 0.22;
          const first = (s / longitudinalScale) ** 2 + ((r - offset) / transverseScale) ** 2;
          const reflected = ((s - MOBIUS_PERIOD) / longitudinalScale) ** 2
            + ((r + offset) / transverseScale) ** 2;
          depth += amplitude * Math.exp(-0.5 * Math.min(first, reflected));
        } else if (preset === "twisted-vortex") {
          const strength = 1.8 * amplitude;
          const dPsiR = -2 * strength * r * Math.sin(0.5 * s);
          const dPsiS = 0.5 * strength * (halfWidth ** 2 - r ** 2) * Math.cos(0.5 * s);
          const sqrtMetric = this.geometry(column, row).sqrtMetric;
          velocityS = dPsiR / sqrtMetric;
          velocityR = -dPsiS / sqrtMetric;
        } else if (preset === "global-current") {
          const metricSS = this.geometry(column, row).metricSS;
          velocityS = (1.6 * amplitude) / metricSS;
        }

        this.setPrimitive(this.state, column, row, depth, velocityS, velocityR);
      }
    }

    this.initialMass = this.mass();
    this.initialEnergy = this.energy();
    this.initialCirculation = this.boundaryCirculation();
  }

  private primitiveFrom(
    state: ConservedState,
    column: number,
    row: number,
  ): PrimitiveState {
    let mappedColumn = column;
    let mappedRow = row;
    let transverseSign = 1;

    if (mappedColumn < 0) {
      mappedColumn += this.parameters.columns;
      mappedRow = this.parameters.rows - 1 - mappedRow;
      transverseSign *= -1;
    } else if (mappedColumn >= this.parameters.columns) {
      mappedColumn -= this.parameters.columns;
      mappedRow = this.parameters.rows - 1 - mappedRow;
      transverseSign *= -1;
    }

    if (mappedRow < 0) {
      mappedRow = 0;
      transverseSign *= -1;
    } else if (mappedRow >= this.parameters.rows) {
      mappedRow = this.parameters.rows - 1;
      transverseSign *= -1;
    }

    const index = this.index(mappedColumn, mappedRow);
    const mass = Math.max(state.mass[index]!, 1e-12);
    const sqrtMetric = this.geometry(mappedColumn, mappedRow).sqrtMetric;
    return {
      depth: mass / sqrtMetric,
      velocityS: state.momentumS[index]! / mass,
      velocityR: transverseSign * state.momentumR[index]! / mass,
    };
  }

  sample(column: number, row: number): MobiusPrimitiveSample {
    const primitive = this.primitiveFrom(this.state, column, row);
    const metric = this.geometry(column, row).metricSS;
    return {
      ...primitive,
      speed: Math.sqrt(metric * primitive.velocityS ** 2 + primitive.velocityR ** 2),
    };
  }

  private metricAt(s: number, r: number): MobiusGeometrySample {
    return mobiusGeometry(s, r, this.parameters.majorRadius);
  }

  private fluxS(state: ConservedState, leftColumn: number, row: number): Flux {
    const left = this.primitiveFrom(state, leftColumn, row);
    const right = this.primitiveFrom(state, leftColumn + 1, row);
    const s = (leftColumn + 1) * this.ds;
    const r = -this.parameters.halfWidth + (row + 0.5) * this.dr;
    const geometry = this.metricAt(s, r);
    const pressureLeft = 0.5 * this.parameters.gravity * left.depth ** 2;
    const pressureRight = 0.5 * this.parameters.gravity * right.depth ** 2;
    const soundLeft = Math.sqrt(this.parameters.gravity * left.depth / geometry.metricSS);
    const soundRight = Math.sqrt(this.parameters.gravity * right.depth / geometry.metricSS);
    const waveSpeed = Math.max(
      Math.abs(left.velocityS) + soundLeft,
      Math.abs(right.velocityS) + soundRight,
    );
    const leftConserved = [left.depth, left.depth * left.velocityS, left.depth * left.velocityR];
    const rightConserved = [right.depth, right.depth * right.velocityS, right.depth * right.velocityR];
    const leftFlux = [
      geometry.sqrtMetric * left.depth * left.velocityS,
      geometry.sqrtMetric * (left.depth * left.velocityS ** 2 + pressureLeft / geometry.metricSS),
      geometry.sqrtMetric * left.depth * left.velocityS * left.velocityR,
    ];
    const rightFlux = [
      geometry.sqrtMetric * right.depth * right.velocityS,
      geometry.sqrtMetric * (right.depth * right.velocityS ** 2 + pressureRight / geometry.metricSS),
      geometry.sqrtMetric * right.depth * right.velocityS * right.velocityR,
    ];
    const flux = leftFlux.map((value, index) => (
      0.5 * (value + rightFlux[index]!)
      - 0.5 * waveSpeed * geometry.sqrtMetric * (rightConserved[index]! - leftConserved[index]!)
    ));
    return { mass: flux[0]!, momentumS: flux[1]!, momentumR: flux[2]! };
  }

  private fluxR(state: ConservedState, column: number, lowerRow: number): Flux {
    const lower = this.primitiveFrom(state, column, lowerRow);
    const upper = this.primitiveFrom(state, column, lowerRow + 1);
    const s = (column + 0.5) * this.ds;
    const r = -this.parameters.halfWidth + (lowerRow + 1) * this.dr;
    const geometry = this.metricAt(s, r);
    const pressureLower = 0.5 * this.parameters.gravity * lower.depth ** 2;
    const pressureUpper = 0.5 * this.parameters.gravity * upper.depth ** 2;
    const waveSpeed = Math.max(
      Math.abs(lower.velocityR) + Math.sqrt(this.parameters.gravity * lower.depth),
      Math.abs(upper.velocityR) + Math.sqrt(this.parameters.gravity * upper.depth),
    );
    const lowerConserved = [lower.depth, lower.depth * lower.velocityS, lower.depth * lower.velocityR];
    const upperConserved = [upper.depth, upper.depth * upper.velocityS, upper.depth * upper.velocityR];
    const lowerFlux = [
      geometry.sqrtMetric * lower.depth * lower.velocityR,
      geometry.sqrtMetric * lower.depth * lower.velocityS * lower.velocityR,
      geometry.sqrtMetric * (lower.depth * lower.velocityR ** 2 + pressureLower),
    ];
    const upperFlux = [
      geometry.sqrtMetric * upper.depth * upper.velocityR,
      geometry.sqrtMetric * upper.depth * upper.velocityS * upper.velocityR,
      geometry.sqrtMetric * (upper.depth * upper.velocityR ** 2 + pressureUpper),
    ];
    const flux = lowerFlux.map((value, index) => (
      0.5 * (value + upperFlux[index]!)
      - 0.5 * waveSpeed * geometry.sqrtMetric * (upperConserved[index]! - lowerConserved[index]!)
    ));
    return { mass: flux[0]!, momentumS: flux[1]!, momentumR: flux[2]! };
  }

  private rightHandSide(state: ConservedState): ConservedState {
    const result = this.createState();
    const { columns, rows, gravity, halfWidth } = this.parameters;
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const index = this.index(column, row);
        const fluxSPlus = this.fluxS(state, column, row);
        const fluxSMinus = this.fluxS(state, column - 1, row);
        const fluxRPlus = this.fluxR(state, column, row);
        const fluxRMinus = this.fluxR(state, column, row - 1);
        const primitive = this.primitiveFrom(state, column, row);
        const { s, r } = this.coordinate(column, row);
        const geometry = this.metricAt(s, r);
        const pressure = 0.5 * gravity * primitive.depth ** 2;
        const sMetricPlus = this.metricAt((column + 1) * this.ds, r).sqrtMetric;
        const sMetricMinus = this.metricAt(column * this.ds, r).sqrtMetric;
        const rMetricPlus = this.metricAt(s, -halfWidth + (row + 1) * this.dr).sqrtMetric;
        const rMetricMinus = this.metricAt(s, -halfWidth + row * this.dr).sqrtMetric;

        const sourceS = (
          pressure * (1 / sMetricPlus - 1 / sMetricMinus) / this.ds
          - geometry.sqrtMetric * primitive.depth * (
            0.5 * geometry.derivativeS / geometry.metricSS * primitive.velocityS ** 2
            + geometry.derivativeR / geometry.metricSS * primitive.velocityS * primitive.velocityR
          )
        );
        const sourceR = (
          pressure * (rMetricPlus - rMetricMinus) / this.dr
          + 0.5 * geometry.sqrtMetric * geometry.derivativeR
            * primitive.depth * primitive.velocityS ** 2
        );

        result.mass[index] = -(
          (fluxSPlus.mass - fluxSMinus.mass) / this.ds
          + (fluxRPlus.mass - fluxRMinus.mass) / this.dr
        );
        result.momentumS[index] = -(
          (fluxSPlus.momentumS - fluxSMinus.momentumS) / this.ds
          + (fluxRPlus.momentumS - fluxRMinus.momentumS) / this.dr
        ) + sourceS;
        result.momentumR[index] = -(
          (fluxSPlus.momentumR - fluxSMinus.momentumR) / this.ds
          + (fluxRPlus.momentumR - fluxRMinus.momentumR) / this.dr
        ) + sourceR;
      }
    }
    return result;
  }

  private addScaled(base: ConservedState, increment: ConservedState, scale: number): ConservedState {
    const result = this.createState();
    for (let index = 0; index < this.count; index += 1) {
      result.mass[index] = base.mass[index]! + scale * increment.mass[index]!;
      result.momentumS[index] = base.momentumS[index]! + scale * increment.momentumS[index]!;
      result.momentumR[index] = base.momentumR[index]! + scale * increment.momentumR[index]!;
    }
    this.enforcePositiveDepth(result);
    return result;
  }

  private enforcePositiveDepth(state: ConservedState): void {
    const minimumDepth = 0.08 * this.parameters.meanDepth;
    for (let row = 0; row < this.parameters.rows; row += 1) {
      for (let column = 0; column < this.parameters.columns; column += 1) {
        const index = this.index(column, row);
        const minimumMass = this.geometry(column, row).sqrtMetric * minimumDepth;
        if (state.mass[index]! < minimumMass) {
          state.mass[index] = minimumMass;
          state.momentumS[index] = 0;
          state.momentumR[index] = 0;
        }
      }
    }
  }

  private stableTimeStep(): number {
    let maximumS = 1e-9;
    let maximumR = 1e-9;
    for (let row = 0; row < this.parameters.rows; row += 1) {
      for (let column = 0; column < this.parameters.columns; column += 1) {
        const sample = this.sample(column, row);
        const metric = this.geometry(column, row).metricSS;
        maximumS = Math.max(
          maximumS,
          Math.abs(sample.velocityS) + Math.sqrt(this.parameters.gravity * sample.depth / metric),
        );
        maximumR = Math.max(
          maximumR,
          Math.abs(sample.velocityR) + Math.sqrt(this.parameters.gravity * sample.depth),
        );
      }
    }
    return Math.min(this.parameters.timeStep, 0.32 * this.ds / maximumS, 0.32 * this.dr / maximumR);
  }

  step(iterations = 1): void {
    for (let iteration = 0; iteration < iterations; iteration += 1) {
      const dt = this.stableTimeStep();
      const firstDerivative = this.rightHandSide(this.state);
      const first = this.addScaled(this.state, firstDerivative, dt);
      const secondDerivative = this.rightHandSide(first);
      const second = this.addScaled(first, secondDerivative, dt);
      for (let index = 0; index < this.count; index += 1) {
        this.state.mass[index] = 0.5 * (this.state.mass[index]! + second.mass[index]!);
        this.state.momentumS[index] = 0.5 * (this.state.momentumS[index]! + second.momentumS[index]!);
        this.state.momentumR[index] = 0.5 * (this.state.momentumR[index]! + second.momentumR[index]!);
      }
      this.enforcePositiveDepth(this.state);
      this.time += dt;
      this.steps += 1;
    }
  }

  depthField(): Float64Array {
    const result = new Float64Array(this.count);
    for (let row = 0; row < this.parameters.rows; row += 1) {
      for (let column = 0; column < this.parameters.columns; column += 1) {
        result[this.index(column, row)] = this.sample(column, row).depth;
      }
    }
    return result;
  }

  speedField(): Float64Array {
    const result = new Float64Array(this.count);
    for (let row = 0; row < this.parameters.rows; row += 1) {
      for (let column = 0; column < this.parameters.columns; column += 1) {
        result[this.index(column, row)] = this.sample(column, row).speed;
      }
    }
    return result;
  }

  private covectorComponent(state: ConservedState, column: number, row: number, component: "s" | "r"): number {
    let mappedColumn = column;
    let mappedRow = row;
    let transverseSign = 1;
    if (mappedColumn < 0) {
      mappedColumn += this.parameters.columns;
      mappedRow = this.parameters.rows - 1 - mappedRow;
      transverseSign = -1;
    } else if (mappedColumn >= this.parameters.columns) {
      mappedColumn -= this.parameters.columns;
      mappedRow = this.parameters.rows - 1 - mappedRow;
      transverseSign = -1;
    }
    if (mappedRow < 0) {
      mappedRow = 0;
      transverseSign *= -1;
    } else if (mappedRow >= this.parameters.rows) {
      mappedRow = this.parameters.rows - 1;
      transverseSign *= -1;
    }
    const primitive = this.primitiveFrom(state, mappedColumn, mappedRow);
    if (component === "s") return this.geometry(mappedColumn, mappedRow).metricSS * primitive.velocityS;
    return transverseSign * primitive.velocityR;
  }

  vorticityField(): Float64Array {
    const result = new Float64Array(this.count);
    for (let row = 0; row < this.parameters.rows; row += 1) {
      for (let column = 0; column < this.parameters.columns; column += 1) {
        const dSOfR = (
          this.covectorComponent(this.state, column + 1, row, "r")
          - this.covectorComponent(this.state, column - 1, row, "r")
        ) / (2 * this.ds);
        const dROfS = (
          this.covectorComponent(this.state, column, row + 1, "s")
          - this.covectorComponent(this.state, column, row - 1, "s")
        ) / (2 * this.dr);
        result[this.index(column, row)] = (dSOfR - dROfS) / this.geometry(column, row).sqrtMetric;
      }
    }
    return result;
  }

  potentialVorticityField(): Float64Array {
    const vorticity = this.vorticityField();
    const depth = this.depthField();
    return Float64Array.from(vorticity, (value, index) => value / Math.max(depth[index]!, 1e-9));
  }

  mass(): number {
    let result = 0;
    for (const value of this.state.mass) result += value;
    return result * this.ds * this.dr;
  }

  energy(): number {
    let result = 0;
    for (let row = 0; row < this.parameters.rows; row += 1) {
      for (let column = 0; column < this.parameters.columns; column += 1) {
        const sample = this.sample(column, row);
        const sqrtMetric = this.geometry(column, row).sqrtMetric;
        result += sqrtMetric * (
          0.5 * sample.depth * sample.speed ** 2
          + 0.5 * this.parameters.gravity * sample.depth ** 2
        );
      }
    }
    return result * this.ds * this.dr;
  }

  boundaryCirculation(): number {
    let circulation = 0;
    const topRow = this.parameters.rows - 1;
    for (let column = 0; column < this.parameters.columns; column += 1) {
      const top = this.sample(column, topRow);
      const bottom = this.sample(column, 0);
      circulation += (
        this.geometry(column, topRow).metricSS * top.velocityS
        + this.geometry(column, 0).metricSS * bottom.velocityS
      ) * this.ds;
    }
    return circulation;
  }

  diagnostics(): MobiusWaterDiagnostics {
    const depth = this.depthField();
    const speed = this.speedField();
    const vorticity = this.vorticityField();
    const potentialVorticity = this.potentialVorticityField();
    const mass = this.mass();
    const energy = this.energy();
    const circulation = this.boundaryCirculation();
    return {
      mass,
      massDrift: (mass - this.initialMass) / Math.max(Math.abs(this.initialMass), 1e-12),
      energy,
      energyDrift: (energy - this.initialEnergy) / Math.max(Math.abs(this.initialEnergy), 1e-12),
      minimumDepth: Math.min(...depth),
      maximumSpeed: Math.max(...speed),
      vorticityRms: rms(vorticity),
      potentialVorticityRms: rms(potentialVorticity),
      boundaryCirculation: circulation,
      circulationDrift: circulation - this.initialCirculation,
      seamConstraint: 0,
    };
  }
}
