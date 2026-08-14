import {
  DEFAULT_REVERSIBLE_LINE_FLUID_PARAMETERS,
  forwardEulerSample,
  gradientContamination,
  tentativeLineBranch,
  type ReversibleLineFluidParameters,
} from "./reversible-line-fluid-model";

export type RosySymmetry = 2 | 4;

export interface PolyvectorProjectionDiagnostics {
  tentativeDivergenceRms: number;
  blendedDivergenceRms: number;
  tentativeRosyDefect: number;
  blendedRosyDefect: number;
  projectedOrthogonalRetention: number;
  branchSpeedRms: number;
}

export interface PolyvectorBranchSample {
  velocity: readonly [number, number];
  divergence: number;
}

function rotateQuarterTurns(vector: readonly [number, number], turns: number): readonly [number, number] {
  const wrapped = ((turns % 4) + 4) % 4;
  if (wrapped === 0) return vector;
  if (wrapped === 1) return [-vector[1], vector[0]];
  if (wrapped === 2) return [-vector[0], -vector[1]];
  return [vector[1], -vector[0]];
}

export function rosyBranchCount(symmetry: RosySymmetry): number {
  return symmetry;
}

export function rosyQuarterTurn(symmetry: RosySymmetry, branch: number): number {
  if (symmetry === 2) return 2 * branch;
  return branch;
}

export function tentativePolyvectorBranch(
  symmetry: RosySymmetry,
  branch: number,
  x: number,
  y: number,
  time: number,
  parameters: ReversibleLineFluidParameters = DEFAULT_REVERSIBLE_LINE_FLUID_PARAMETERS,
): PolyvectorBranchSample {
  const root = tentativeLineBranch(1, x, y, time, parameters);
  const turns = rosyQuarterTurn(symmetry, branch);
  const velocity = rotateQuarterTurns(root.velocity, turns);
  if (turns === 0) return { velocity, divergence: root.divergence };
  if (turns === 2) return { velocity, divergence: -root.divergence };
  const vorticity = forwardEulerSample(x, y, time, parameters).vorticity;
  return { velocity, divergence: turns === 1 ? -vorticity : vorticity };
}

/**
 * Exact flat-torus Hodge projections for the four quarter-turn roots.
 * The root u* projects to u. Its quarter turn projects to the harmonic
 * transverse current plus the already-solenoidal J grad(chi) term.
 */
export function projectedPolyvectorBranch(
  symmetry: RosySymmetry,
  branch: number,
  x: number,
  y: number,
  time: number,
  parameters: ReversibleLineFluidParameters = DEFAULT_REVERSIBLE_LINE_FLUID_PARAMETERS,
): PolyvectorBranchSample {
  const turns = rosyQuarterTurn(symmetry, branch);
  const forward = forwardEulerSample(x, y, time, parameters).velocity;
  if (turns === 0) return { velocity: forward, divergence: 0 };
  if (turns === 2) return { velocity: [-forward[0], -forward[1]], divergence: 0 };
  const gradient = gradientContamination(x, y, time).gradient;
  const orthogonal: readonly [number, number] = [
    -parameters.contamination * gradient[1],
    parameters.drift + parameters.contamination * gradient[0],
  ];
  return {
    velocity: turns === 1 ? orthogonal : [-orthogonal[0], -orthogonal[1]],
    divergence: 0,
  };
}

export function blendedPolyvectorBranch(
  symmetry: RosySymmetry,
  branch: number,
  x: number,
  y: number,
  time: number,
  projectionStrength: number,
  parameters: ReversibleLineFluidParameters = DEFAULT_REVERSIBLE_LINE_FLUID_PARAMETERS,
): PolyvectorBranchSample {
  const amount = Math.max(0, Math.min(1, projectionStrength));
  const tentative = tentativePolyvectorBranch(symmetry, branch, x, y, time, parameters);
  const projected = projectedPolyvectorBranch(symmetry, branch, x, y, time, parameters);
  return {
    velocity: [
      tentative.velocity[0] + amount * (projected.velocity[0] - tentative.velocity[0]),
      tentative.velocity[1] + amount * (projected.velocity[1] - tentative.velocity[1]),
    ],
    divergence: (1 - amount) * tentative.divergence,
  };
}

export function topologicalPolyvectorDiagnostics(
  symmetry: RosySymmetry,
  time: number,
  projectionStrength: number,
  parameters: ReversibleLineFluidParameters = DEFAULT_REVERSIBLE_LINE_FLUID_PARAMETERS,
  columns = 48,
  rows = 40,
): PolyvectorProjectionDiagnostics {
  let tentativeDivergenceSquared = 0;
  let blendedDivergenceSquared = 0;
  let tentativeRosySquared = 0;
  let blendedRosySquared = 0;
  let firstProjectedSpeedSquared = 0;
  let orthogonalProjectedSpeedSquared = 0;
  let speedSquared = 0;
  let branchCount = 0;
  let pointCount = 0;
  for (let row = 0; row < rows; row += 1) {
    const y = 2 * Math.PI * (row + 0.5) / rows;
    for (let column = 0; column < columns; column += 1) {
      const x = 2 * Math.PI * (column + 0.5) / columns;
      const tentativeRoot = tentativePolyvectorBranch(symmetry, 0, x, y, time, parameters);
      const blendedRoot = blendedPolyvectorBranch(symmetry, 0, x, y, time, projectionStrength, parameters);
      const projectedRoot = projectedPolyvectorBranch(symmetry, 0, x, y, time, parameters);
      firstProjectedSpeedSquared += projectedRoot.velocity[0] ** 2 + projectedRoot.velocity[1] ** 2;
      for (let branch = 0; branch < rosyBranchCount(symmetry); branch += 1) {
        const tentative = tentativePolyvectorBranch(symmetry, branch, x, y, time, parameters);
        const blended = blendedPolyvectorBranch(symmetry, branch, x, y, time, projectionStrength, parameters);
        const expectedTentative = rotateQuarterTurns(tentativeRoot.velocity, rosyQuarterTurn(symmetry, branch));
        const expectedBlended = rotateQuarterTurns(blendedRoot.velocity, rosyQuarterTurn(symmetry, branch));
        tentativeDivergenceSquared += tentative.divergence ** 2;
        blendedDivergenceSquared += blended.divergence ** 2;
        tentativeRosySquared += (tentative.velocity[0] - expectedTentative[0]) ** 2
          + (tentative.velocity[1] - expectedTentative[1]) ** 2;
        blendedRosySquared += (blended.velocity[0] - expectedBlended[0]) ** 2
          + (blended.velocity[1] - expectedBlended[1]) ** 2;
        speedSquared += blended.velocity[0] ** 2 + blended.velocity[1] ** 2;
        branchCount += 1;
      }
      if (symmetry === 4) {
        const orthogonal = projectedPolyvectorBranch(symmetry, 1, x, y, time, parameters);
        orthogonalProjectedSpeedSquared += orthogonal.velocity[0] ** 2 + orthogonal.velocity[1] ** 2;
      } else {
        orthogonalProjectedSpeedSquared += projectedRoot.velocity[0] ** 2 + projectedRoot.velocity[1] ** 2;
      }
      pointCount += 1;
    }
  }
  return {
    tentativeDivergenceRms: Math.sqrt(tentativeDivergenceSquared / branchCount),
    blendedDivergenceRms: Math.sqrt(blendedDivergenceSquared / branchCount),
    tentativeRosyDefect: Math.sqrt(tentativeRosySquared / branchCount),
    blendedRosyDefect: Math.sqrt(blendedRosySquared / branchCount),
    projectedOrthogonalRetention: Math.sqrt(orthogonalProjectedSpeedSquared / pointCount)
      / Math.max(1e-12, Math.sqrt(firstProjectedSpeedSquared / pointCount)),
    branchSpeedRms: Math.sqrt(speedSquared / branchCount),
  };
}

export function mobiusRosyAngle(s: number, sheet: 0 | 1): number {
  const base = 0.25 * s;
  return sheet === 0 ? base : -base;
}

export function mobiusReflectedAngle(angle: number): number {
  return -angle;
}
