export type SymmetricClebschPreset = "even-even" | "odd-odd" | "mixed" | "gauge";

export interface SymmetricClebschParameters {
  preset: SymmetricClebschPreset;
  amplitude: number;
  gauge: number;
  phase: number;
  harmonicSpeed: number;
}

export interface SymmetricClebschSample {
  alpha: number;
  beta: number;
  phi: number;
  alphaGradient: readonly [number, number];
  betaGradient: readonly [number, number];
  phiGradient: readonly [number, number];
  velocity: readonly [number, number];
  vorticity: number;
}

export interface SymmetricClebschDiagnostics {
  velocitySymmetryDefect: number;
  vorticityFormSymmetryDefect: number;
  gaugeReconstructionDefect: number;
  alphaParity: "even" | "odd" | "mixed";
  betaParity: "even" | "odd" | "mixed";
  alphaEvenDefect: number;
  alphaOddDefect: number;
  betaEvenDefect: number;
  betaOddDefect: number;
  vorticityRms: number;
}

const HALF_PI = 0.5 * Math.PI;

interface ScalarJet {
  value: number;
  dx: number;
  dy: number;
}

function basePotential(x: number, y: number): ScalarJet {
  const cosineY = Math.cos(HALF_PI * y);
  const sineY = Math.sin(HALF_PI * y);
  return {
    value: 0.11 * Math.sin(2 * x) * cosineY,
    dx: 0.22 * Math.cos(2 * x) * cosineY,
    dy: -0.11 * HALF_PI * Math.sin(2 * x) * sineY,
  };
}

function evenEvenLabels(x: number, y: number, amplitude: number): { alpha: ScalarJet; beta: ScalarJet } {
  const cosineY = Math.cos(HALF_PI * y);
  const sineY = Math.sin(HALF_PI * y);
  return {
    alpha: {
      value: amplitude * Math.cos(x) * cosineY,
      dx: -amplitude * Math.sin(x) * cosineY,
      dy: -amplitude * HALF_PI * Math.cos(x) * sineY,
    },
    beta: {
      value: Math.sin(x) * cosineY,
      dx: Math.cos(x) * cosineY,
      dy: -HALF_PI * Math.sin(x) * sineY,
    },
  };
}

function oddOddLabels(x: number, y: number, amplitude: number): { alpha: ScalarJet; beta: ScalarJet } {
  const cosineY = Math.cos(HALF_PI * y);
  const sineY = Math.sin(HALF_PI * y);
  return {
    alpha: {
      value: amplitude * Math.cos(x) * sineY,
      dx: -amplitude * Math.sin(x) * sineY,
      dy: amplitude * HALF_PI * Math.cos(x) * cosineY,
    },
    beta: {
      value: Math.sin(x) * sineY,
      dx: Math.cos(x) * sineY,
      dy: HALF_PI * Math.sin(x) * cosineY,
    },
  };
}

function mixedLabels(x: number, y: number, amplitude: number): { alpha: ScalarJet; beta: ScalarJet } {
  const even = evenEvenLabels(x, y, amplitude);
  const cosineY = Math.cos(HALF_PI * y);
  const sineY = Math.sin(HALF_PI * y);
  return {
    alpha: even.alpha,
    beta: {
      value: y + 0.35 * Math.sin(x) * cosineY,
      dx: 0.35 * Math.cos(x) * cosineY,
      dy: 1 - 0.35 * HALF_PI * Math.sin(x) * sineY,
    },
  };
}

export const DEFAULT_SYMMETRIC_CLEBSCH_PARAMETERS: SymmetricClebschParameters = {
  preset: "even-even",
  amplitude: 0.72,
  gauge: 0.8,
  phase: 0,
  harmonicSpeed: 0.56,
};

export function symmetricClebschSample(
  x: number,
  y: number,
  parameters: SymmetricClebschParameters = DEFAULT_SYMMETRIC_CLEBSCH_PARAMETERS,
): SymmetricClebschSample {
  const shiftedX = x + parameters.phase;
  let labels: { alpha: ScalarJet; beta: ScalarJet };
  let phi = basePotential(shiftedX, y);
  if (parameters.preset === "even-even") labels = evenEvenLabels(shiftedX, y, parameters.amplitude);
  else if (parameters.preset === "mixed") labels = mixedLabels(shiftedX, y, parameters.amplitude);
  else labels = oddOddLabels(shiftedX, y, parameters.amplitude);

  if (parameters.preset === "gauge") {
    const alpha = labels.alpha;
    const originalBeta = labels.beta;
    const gauge = parameters.gauge;
    labels = {
      alpha,
      beta: {
        value: originalBeta.value + gauge * alpha.value * alpha.value,
        dx: originalBeta.dx + 2 * gauge * alpha.value * alpha.dx,
        dy: originalBeta.dy + 2 * gauge * alpha.value * alpha.dy,
      },
    };
    phi = {
      value: phi.value - 2 * gauge * alpha.value ** 3 / 3,
      dx: phi.dx - 2 * gauge * alpha.value * alpha.value * alpha.dx,
      dy: phi.dy - 2 * gauge * alpha.value * alpha.value * alpha.dy,
    };
  }

  const alpha = labels.alpha;
  const beta = labels.beta;
  const velocity: [number, number] = [
    parameters.harmonicSpeed + phi.dx + alpha.value * beta.dx,
    phi.dy + alpha.value * beta.dy,
  ];
  return {
    alpha: alpha.value,
    beta: beta.value,
    phi: phi.value,
    alphaGradient: [alpha.dx, alpha.dy],
    betaGradient: [beta.dx, beta.dy],
    phiGradient: [phi.dx, phi.dy],
    velocity,
    vorticity: alpha.dx * beta.dy - alpha.dy * beta.dx,
  };
}

function parityLabel(evenDefect: number, oddDefect: number): "even" | "odd" | "mixed" {
  const best = Math.min(evenDefect, oddDefect);
  if (best > 1e-5) return "mixed";
  return evenDefect <= oddDefect ? "even" : "odd";
}

export function symmetricClebschDiagnostics(
  parameters: SymmetricClebschParameters = DEFAULT_SYMMETRIC_CLEBSCH_PARAMETERS,
  columns = 72,
  rows = 38,
): SymmetricClebschDiagnostics {
  let velocityDefectSquared = 0;
  let vorticityDefectSquared = 0;
  let gaugeDefectSquared = 0;
  let alphaEvenSquared = 0;
  let alphaOddSquared = 0;
  let betaEvenSquared = 0;
  let betaOddSquared = 0;
  let vorticitySquared = 0;
  let count = 0;
  const baseParameters: SymmetricClebschParameters = { ...parameters, preset: "odd-odd", gauge: 0 };
  for (let row = 0; row < rows; row += 1) {
    const y = -1 + 2 * (row + 0.5) / rows;
    for (let column = 0; column < columns; column += 1) {
      const x = 2 * Math.PI * (column + 0.5) / columns;
      const sample = symmetricClebschSample(x, y, parameters);
      const reflected = symmetricClebschSample(x, -y, parameters);
      const velocityDx = sample.velocity[0] - reflected.velocity[0];
      const velocityDy = sample.velocity[1] + reflected.velocity[1];
      velocityDefectSquared += velocityDx * velocityDx + velocityDy * velocityDy;
      const vorticityDefect = sample.vorticity + reflected.vorticity;
      vorticityDefectSquared += vorticityDefect * vorticityDefect;
      const alphaEven = sample.alpha - reflected.alpha;
      const alphaOdd = sample.alpha + reflected.alpha;
      const betaEven = sample.beta - reflected.beta;
      const betaOdd = sample.beta + reflected.beta;
      alphaEvenSquared += alphaEven * alphaEven;
      alphaOddSquared += alphaOdd * alphaOdd;
      betaEvenSquared += betaEven * betaEven;
      betaOddSquared += betaOdd * betaOdd;
      vorticitySquared += sample.vorticity * sample.vorticity;
      if (parameters.preset === "gauge") {
        const base = symmetricClebschSample(x, y, baseParameters);
        const gaugeDx = sample.velocity[0] - base.velocity[0];
        const gaugeDy = sample.velocity[1] - base.velocity[1];
        gaugeDefectSquared += gaugeDx * gaugeDx + gaugeDy * gaugeDy;
      }
      count += 1;
    }
  }
  const alphaEvenDefect = Math.sqrt(alphaEvenSquared / count);
  const alphaOddDefect = Math.sqrt(alphaOddSquared / count);
  const betaEvenDefect = Math.sqrt(betaEvenSquared / count);
  const betaOddDefect = Math.sqrt(betaOddSquared / count);
  return {
    velocitySymmetryDefect: Math.sqrt(velocityDefectSquared / count),
    vorticityFormSymmetryDefect: Math.sqrt(vorticityDefectSquared / count),
    gaugeReconstructionDefect: Math.sqrt(gaugeDefectSquared / count),
    alphaParity: parityLabel(alphaEvenDefect, alphaOddDefect),
    betaParity: parityLabel(betaEvenDefect, betaOddDefect),
    alphaEvenDefect,
    alphaOddDefect,
    betaEvenDefect,
    betaOddDefect,
    vorticityRms: Math.sqrt(vorticitySquared / count),
  };
}
