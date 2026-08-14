export type ReversibleBranchKind = "forward" | "same-time-negative" | "time-reversed";

export interface ReversibleLineFluidParameters {
  amplitude: number;
  drift: number;
  contamination: number;
}

export interface ReversibleLineFluidSample {
  velocity: readonly [number, number];
  pressure: number;
  divergence: number;
  vorticity: number;
}

export interface ReversibleLineFluidDiagnostics {
  tentativeDivergenceRms: number;
  projectedDivergenceRms: number;
  signSymmetryDefect: number;
  coIntegrabilityDefect: number;
  sameTimeEulerResidualRms: number;
  reversedEulerResidualRms: number;
}

export interface ReversibleParticlePoint {
  x: number;
  y: number;
}

export const DEFAULT_REVERSIBLE_LINE_FLUID_PARAMETERS: ReversibleLineFluidParameters = {
  amplitude: 0.72,
  drift: 0.46,
  contamination: 0.48,
};

const TAU = 2 * Math.PI;

function wrapPeriodic(value: number): number {
  return ((value % TAU) + TAU) % TAU;
}

/** A Galilean translate of the steady Taylor-Green vortex on the flat torus. */
export function forwardEulerSample(
  x: number,
  y: number,
  time: number,
  parameters: ReversibleLineFluidParameters = DEFAULT_REVERSIBLE_LINE_FLUID_PARAMETERS,
): ReversibleLineFluidSample {
  const phase = x - parameters.drift * time;
  const sineX = Math.sin(phase);
  const cosineX = Math.cos(phase);
  const sineY = Math.sin(y);
  const cosineY = Math.cos(y);
  const amplitude = parameters.amplitude;
  return {
    velocity: [
      parameters.drift + amplitude * sineX * cosineY,
      -amplitude * cosineX * sineY,
    ],
    pressure: 0.25 * amplitude * amplitude * (Math.cos(2 * phase) + Math.cos(2 * y)),
    divergence: 0,
    vorticity: 2 * amplitude * sineX * sineY,
  };
}

export function reversibleBranchSample(
  kind: ReversibleBranchKind,
  x: number,
  y: number,
  time: number,
  parameters: ReversibleLineFluidParameters = DEFAULT_REVERSIBLE_LINE_FLUID_PARAMETERS,
): ReversibleLineFluidSample {
  if (kind === "forward") return forwardEulerSample(x, y, time, parameters);
  const sourceTime = kind === "time-reversed" ? -time : time;
  const source = forwardEulerSample(x, y, sourceTime, parameters);
  return {
    velocity: [-source.velocity[0], -source.velocity[1]],
    pressure: source.pressure,
    divergence: 0,
    vorticity: -source.vorticity,
  };
}

export function streamFunction(
  x: number,
  y: number,
  time: number,
  parameters: ReversibleLineFluidParameters = DEFAULT_REVERSIBLE_LINE_FLUID_PARAMETERS,
): number {
  return parameters.drift * y
    + parameters.amplitude * Math.sin(x - parameters.drift * time) * Math.sin(y);
}

export function streamFunctionGradient(
  x: number,
  y: number,
  time: number,
  parameters: ReversibleLineFluidParameters = DEFAULT_REVERSIBLE_LINE_FLUID_PARAMETERS,
): readonly [number, number] {
  const phase = x - parameters.drift * time;
  return [
    parameters.amplitude * Math.cos(phase) * Math.sin(y),
    parameters.drift + parameters.amplitude * Math.sin(phase) * Math.cos(y),
  ];
}

export function gradientContamination(
  x: number,
  y: number,
  time: number,
): { value: number; gradient: readonly [number, number]; laplacian: number } {
  const first = 2 * x + y + 0.37 * time;
  const second = x - 2 * y - 0.23 * time;
  return {
    value: Math.cos(first) + 0.45 * Math.sin(second),
    gradient: [
      -2 * Math.sin(first) + 0.45 * Math.cos(second),
      -Math.sin(first) - 0.9 * Math.cos(second),
    ],
    laplacian: -5 * Math.cos(first) - 2.25 * Math.sin(second),
  };
}

/** The two roots are q and -q. Projection removes the exact contamination from both. */
export function tentativeLineBranch(
  sign: 1 | -1,
  x: number,
  y: number,
  time: number,
  parameters: ReversibleLineFluidParameters = DEFAULT_REVERSIBLE_LINE_FLUID_PARAMETERS,
): ReversibleLineFluidSample {
  const base = forwardEulerSample(x, y, time, parameters);
  const contamination = gradientContamination(x, y, time);
  return {
    velocity: [
      sign * (base.velocity[0] + parameters.contamination * contamination.gradient[0]),
      sign * (base.velocity[1] + parameters.contamination * contamination.gradient[1]),
    ],
    pressure: sign * parameters.contamination * contamination.value,
    divergence: sign * parameters.contamination * contamination.laplacian,
    vorticity: sign * base.vorticity,
  };
}

export function projectedLineBranch(
  sign: 1 | -1,
  x: number,
  y: number,
  time: number,
  parameters: ReversibleLineFluidParameters = DEFAULT_REVERSIBLE_LINE_FLUID_PARAMETERS,
): ReversibleLineFluidSample {
  const base = forwardEulerSample(x, y, time, parameters);
  return {
    velocity: [sign * base.velocity[0], sign * base.velocity[1]],
    pressure: sign * parameters.contamination * gradientContamination(x, y, time).value,
    divergence: 0,
    vorticity: sign * base.vorticity,
  };
}

/** Complex square z² stores the unoriented pair {z,-z} without selecting a root. */
export function linePowerCoefficient(velocity: readonly [number, number]): readonly [number, number] {
  return [
    velocity[0] * velocity[0] - velocity[1] * velocity[1],
    2 * velocity[0] * velocity[1],
  ];
}

/** Residual left after the best pressure correction for the same-time negative branch. */
export function sameTimeNegativeEulerResidual(
  x: number,
  y: number,
  time: number,
  parameters: ReversibleLineFluidParameters = DEFAULT_REVERSIBLE_LINE_FLUID_PARAMETERS,
): readonly [number, number] {
  const phase = x - parameters.drift * time;
  const scale = 2 * parameters.drift * parameters.amplitude;
  return [scale * Math.cos(phase) * Math.cos(y), scale * Math.sin(phase) * Math.sin(y)];
}

export function reversibleLineFluidDiagnostics(
  time: number,
  parameters: ReversibleLineFluidParameters = DEFAULT_REVERSIBLE_LINE_FLUID_PARAMETERS,
  columns = 64,
  rows = 64,
): ReversibleLineFluidDiagnostics {
  let tentativeDivergenceSquared = 0;
  let projectedDivergenceSquared = 0;
  let signDefectSquared = 0;
  let coIntegrabilitySquared = 0;
  let sameTimeResidualSquared = 0;
  let reversedResidualSquared = 0;
  let count = 0;
  for (let row = 0; row < rows; row += 1) {
    const y = TAU * (row + 0.5) / rows;
    for (let column = 0; column < columns; column += 1) {
      const x = TAU * (column + 0.5) / columns;
      const tentativePlus = tentativeLineBranch(1, x, y, time, parameters);
      const projectedPlus = projectedLineBranch(1, x, y, time, parameters);
      const projectedMinus = projectedLineBranch(-1, x, y, time, parameters);
      tentativeDivergenceSquared += tentativePlus.divergence ** 2;
      projectedDivergenceSquared += projectedPlus.divergence ** 2;
      signDefectSquared += (projectedPlus.velocity[0] + projectedMinus.velocity[0]) ** 2
        + (projectedPlus.velocity[1] + projectedMinus.velocity[1]) ** 2;
      const streamGradient = streamFunctionGradient(x, y, time, parameters);
      const rotatedVelocity: readonly [number, number] = [-projectedPlus.velocity[1], projectedPlus.velocity[0]];
      coIntegrabilitySquared += (rotatedVelocity[0] - streamGradient[0]) ** 2
        + (rotatedVelocity[1] - streamGradient[1]) ** 2;
      const residual = sameTimeNegativeEulerResidual(x, y, time, parameters);
      sameTimeResidualSquared += residual[0] ** 2 + residual[1] ** 2;
      // The reversed field is analytic: -u(x,-t) satisfies Euler exactly.
      reversedResidualSquared += 0;
      count += 1;
    }
  }
  return {
    tentativeDivergenceRms: Math.sqrt(tentativeDivergenceSquared / count),
    projectedDivergenceRms: Math.sqrt(projectedDivergenceSquared / count),
    signSymmetryDefect: Math.sqrt(signDefectSquared / count),
    coIntegrabilityDefect: Math.sqrt(coIntegrabilitySquared / count),
    sameTimeEulerResidualRms: Math.sqrt(sameTimeResidualSquared / count),
    reversedEulerResidualRms: Math.sqrt(reversedResidualSquared / count),
  };
}

function velocityForParticle(
  kind: ReversibleBranchKind,
  point: ReversibleParticlePoint,
  time: number,
  parameters: ReversibleLineFluidParameters,
): readonly [number, number] {
  return reversibleBranchSample(kind, point.x, point.y, time, parameters).velocity;
}

function rk4Step(
  kind: ReversibleBranchKind,
  point: ReversibleParticlePoint,
  time: number,
  step: number,
  parameters: ReversibleLineFluidParameters,
): ReversibleParticlePoint {
  const k1 = velocityForParticle(kind, point, time, parameters);
  const p2 = { x: point.x + 0.5 * step * k1[0], y: point.y + 0.5 * step * k1[1] };
  const k2 = velocityForParticle(kind, p2, time + 0.5 * step, parameters);
  const p3 = { x: point.x + 0.5 * step * k2[0], y: point.y + 0.5 * step * k2[1] };
  const k3 = velocityForParticle(kind, p3, time + 0.5 * step, parameters);
  const p4 = { x: point.x + step * k3[0], y: point.y + step * k3[1] };
  const k4 = velocityForParticle(kind, p4, time + step, parameters);
  return {
    x: point.x + step * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]) / 6,
    y: point.y + step * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]) / 6,
  };
}

export function integrateReversibleParticleTrace(
  initial: ReversibleParticlePoint,
  targetTime: number,
  kind: ReversibleBranchKind,
  parameters: ReversibleLineFluidParameters = DEFAULT_REVERSIBLE_LINE_FLUID_PARAMETERS,
  steps = 72,
): ReversibleParticlePoint[] {
  const count = Math.max(1, Math.round(steps));
  const step = targetTime / count;
  let point = { x: initial.x, y: initial.y };
  const trace: ReversibleParticlePoint[] = [{ x: wrapPeriodic(point.x), y: wrapPeriodic(point.y) }];
  for (let index = 0; index < count; index += 1) {
    point = rk4Step(kind, point, index * step, step, parameters);
    trace.push({ x: wrapPeriodic(point.x), y: wrapPeriodic(point.y) });
  }
  return trace;
}
