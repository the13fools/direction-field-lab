export interface ClebschLoopSample {
  theta: number;
  alpha: number;
  beta: number;
  alphaDBetaCoefficient: number;
  dPhiCoefficient: number;
  velocityCoefficient: number;
}

export interface HarmonicLoopReduction {
  coefficient: number;
  quantum: number;
  latticeIndex: number;
  removedCoefficient: number;
  residualCoefficient: number;
  originalPeriod: number;
  removedPeriod: number;
  residualPeriod: number;
}

/**
 * A globally single-valued Clebsch triple for c dθ on a torus:
 * α = -2c sin θ, β = cos θ, φ = (c/2) sin(2θ).
 * Coefficients below are relative to dθ.
 */
export function sampleClebschLoop(theta: number, coefficient = 1): ClebschLoopSample {
  if (!Number.isFinite(theta) || !Number.isFinite(coefficient)) throw new Error("theta and coefficient must be finite");
  const alpha = -2 * coefficient * Math.sin(theta);
  const beta = Math.cos(theta);
  const alphaDBetaCoefficient = 2 * coefficient * Math.sin(theta) ** 2;
  const dPhiCoefficient = coefficient * Math.cos(2 * theta);
  return {
    theta,
    alpha,
    beta,
    alphaDBetaCoefficient,
    dPhiCoefficient,
    velocityCoefficient: alphaDBetaCoefficient + dPhiCoefficient,
  };
}

export function reduceHarmonicLoop(
  coefficient: number,
  quantum: number,
  latticeIndex: number,
): HarmonicLoopReduction {
  if (!Number.isFinite(coefficient)) throw new Error("coefficient must be finite");
  if (!(Number.isFinite(quantum) && quantum > 0)) throw new Error("quantum must be positive and finite");
  if (!Number.isInteger(latticeIndex)) throw new Error("latticeIndex must be an integer");
  const removedCoefficient = quantum * latticeIndex;
  const residualCoefficient = coefficient - removedCoefficient;
  return {
    coefficient,
    quantum,
    latticeIndex,
    removedCoefficient,
    residualCoefficient,
    originalPeriod: 2 * Math.PI * coefficient,
    removedPeriod: 2 * Math.PI * removedCoefficient,
    residualPeriod: 2 * Math.PI * residualCoefficient,
  };
}

export function nearestHarmonicLoopIndex(coefficient: number, quantum: number): number {
  if (!Number.isFinite(coefficient)) throw new Error("coefficient must be finite");
  if (!(Number.isFinite(quantum) && quantum > 0)) throw new Error("quantum must be positive and finite");
  return Math.round(coefficient / quantum);
}
