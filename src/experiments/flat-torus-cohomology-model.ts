export interface TorusVec2 {
  x: number;
  y: number;
}

export interface FlatTorusCohomologyParameters {
  vortexStrength: number;
  periodX: number;
  periodY: number;
  quantum: number;
  subtractX: number;
  subtractY: number;
  particleCount: number;
}

export interface FlatTorusFieldSample {
  coexactVelocity: TorusVec2;
  rawVelocity: TorusVec2;
  removedHarmonic: TorusVec2;
  reducedVelocity: TorusVec2;
  vorticity: number;
  divergence: number;
}

export interface FlatTorusParticle {
  x: number;
  y: number;
  windingX: number;
  windingY: number;
}

export interface FlatTorusParticlePair {
  raw: FlatTorusParticle;
  reduced: FlatTorusParticle;
}

export interface FlatTorusDiagnostics {
  rawPeriod: TorusVec2;
  removedPeriod: TorusVec2;
  residualPeriod: TorusVec2;
  rawHarmonicEnergy: number;
  residualHarmonicEnergy: number;
  vorticityRms: number;
  rawMeanWinding: TorusVec2;
  reducedMeanWinding: TorusVec2;
}

export const DEFAULT_FLAT_TORUS_COHOMOLOGY_PARAMETERS: FlatTorusCohomologyParameters = {
  vortexStrength: 0.72,
  periodX: 0.85,
  periodY: -0.55,
  quantum: 0.5,
  subtractX: 0,
  subtractY: 0,
  particleCount: 240,
};

function assertParameters(parameters: FlatTorusCohomologyParameters): void {
  for (const [name, value] of Object.entries(parameters)) {
    if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
  }
  if (parameters.vortexStrength < 0) throw new Error("vortexStrength must be nonnegative");
  if (!(parameters.quantum > 0)) throw new Error("quantum must be positive");
  if (!Number.isInteger(parameters.subtractX) || !Number.isInteger(parameters.subtractY)) {
    throw new Error("harmonic subtraction coordinates must be integers");
  }
  if (!Number.isInteger(parameters.particleCount) || parameters.particleCount < 1 || parameters.particleCount > 2000) {
    throw new Error("particleCount must be an integer from 1 through 2000");
  }
}

function copyParticle(particle: FlatTorusParticle): FlatTorusParticle {
  return { ...particle };
}

function wrapCoordinate(value: number): { coordinate: number; winding: number } {
  const winding = Math.floor(value);
  return { coordinate: value - winding, winding };
}

function advanceParticle(
  particle: FlatTorusParticle,
  timeStep: number,
  velocity: (x: number, y: number) => TorusVec2,
): void {
  const first = velocity(particle.x, particle.y);
  const midpointX = particle.x + 0.5 * timeStep * first.x;
  const midpointY = particle.y + 0.5 * timeStep * first.y;
  const midpoint = velocity(midpointX - Math.floor(midpointX), midpointY - Math.floor(midpointY));
  const wrappedX = wrapCoordinate(particle.x + timeStep * midpoint.x);
  const wrappedY = wrapCoordinate(particle.y + timeStep * midpoint.y);
  particle.x = wrappedX.coordinate;
  particle.y = wrappedY.coordinate;
  particle.windingX += wrappedX.winding;
  particle.windingY += wrappedY.winding;
}

export class FlatTorusCohomologyModel {
  parameters: FlatTorusCohomologyParameters;
  particles: FlatTorusParticlePair[] = [];
  materialLines: FlatTorusParticlePair[][] = [];
  time = 0;

  constructor(parameters: Partial<FlatTorusCohomologyParameters> = {}) {
    this.parameters = { ...DEFAULT_FLAT_TORUS_COHOMOLOGY_PARAMETERS, ...parameters };
    assertParameters(this.parameters);
    this.resetParticles();
  }

  reset(parameters: Partial<FlatTorusCohomologyParameters> = {}): void {
    this.parameters = { ...this.parameters, ...parameters };
    assertParameters(this.parameters);
    this.time = 0;
    this.resetParticles();
  }

  update(parameters: Partial<FlatTorusCohomologyParameters>): void {
    const next = { ...this.parameters, ...parameters };
    assertParameters(next);
    this.parameters = next;
  }

  /**
   * Coordinate rounding for the lab's optional q Z^2 experiment.
   * This is nearest only in the chosen orthogonal unit basis and Euclidean energy;
   * it is not an intrinsic operation of Clebsch variables or fluid cohomology.
   */
  nearestQuantizedField(): { x: number; y: number } {
    return {
      x: Math.round(this.parameters.periodX / this.parameters.quantum),
      y: Math.round(this.parameters.periodY / this.parameters.quantum),
    };
  }

  sample(x: number, y: number): FlatTorusFieldSample {
    const angleX = 2 * Math.PI * x;
    const angleY = 2 * Math.PI * y;
    const strength = this.parameters.vortexStrength;
    const coexactVelocity = {
      x: strength * Math.sin(angleX) * Math.cos(angleY),
      y: -strength * Math.cos(angleX) * Math.sin(angleY),
    };
    const removedHarmonic = {
      x: this.parameters.quantum * this.parameters.subtractX,
      y: this.parameters.quantum * this.parameters.subtractY,
    };
    const rawVelocity = {
      x: coexactVelocity.x + this.parameters.periodX,
      y: coexactVelocity.y + this.parameters.periodY,
    };
    return {
      coexactVelocity,
      rawVelocity,
      removedHarmonic,
      reducedVelocity: {
        x: rawVelocity.x - removedHarmonic.x,
        y: rawVelocity.y - removedHarmonic.y,
      },
      vorticity: 4 * Math.PI * strength * Math.sin(angleX) * Math.sin(angleY),
      divergence: 0,
    };
  }

  resetParticles(seed = 13): void {
    let state = seed >>> 0;
    const random = (): number => {
      state = (1664525 * state + 1013904223) >>> 0;
      return state / 0x1_0000_0000;
    };
    this.particles = Array.from({ length: this.parameters.particleCount }, () => {
      const particle = { x: random(), y: random(), windingX: 0, windingY: 0 };
      return { raw: copyParticle(particle), reduced: copyParticle(particle) };
    });
    this.resetMaterialGrid();
    this.time = 0;
  }

  resetMaterialGrid(lineCount = 7, samplesPerLine = 144): void {
    if (!Number.isInteger(lineCount) || lineCount < 2) throw new Error("lineCount must be an integer of at least two");
    if (!Number.isInteger(samplesPerLine) || samplesPerLine < 16) {
      throw new Error("samplesPerLine must be an integer of at least sixteen");
    }
    const makePair = (x: number, y: number): FlatTorusParticlePair => {
      const particle = { x, y, windingX: 0, windingY: 0 };
      return { raw: copyParticle(particle), reduced: copyParticle(particle) };
    };
    this.materialLines = [];
    for (let line = 0; line < lineCount; line += 1) {
      const coordinate = (line + 0.5) / lineCount;
      this.materialLines.push(Array.from(
        { length: samplesPerLine },
        (_, sample) => makePair(coordinate, sample / samplesPerLine),
      ));
      this.materialLines.push(Array.from(
        { length: samplesPerLine },
        (_, sample) => makePair(sample / samplesPerLine, coordinate),
      ));
    }
  }

  step(timeStep: number): void {
    if (!(Number.isFinite(timeStep) && timeStep > 0)) throw new Error("timeStep must be positive and finite");
    for (const pair of this.particles) {
      advanceParticle(pair.raw, timeStep, (x, y) => this.sample(x, y).rawVelocity);
      advanceParticle(pair.reduced, timeStep, (x, y) => this.sample(x, y).reducedVelocity);
    }
    for (const line of this.materialLines) {
      for (const pair of line) {
        advanceParticle(pair.raw, timeStep, (x, y) => this.sample(x, y).rawVelocity);
        advanceParticle(pair.reduced, timeStep, (x, y) => this.sample(x, y).reducedVelocity);
      }
    }
    this.time += timeStep;
  }

  diagnostics(): FlatTorusDiagnostics {
    const removedPeriod = {
      x: this.parameters.quantum * this.parameters.subtractX,
      y: this.parameters.quantum * this.parameters.subtractY,
    };
    const residualPeriod = {
      x: this.parameters.periodX - removedPeriod.x,
      y: this.parameters.periodY - removedPeriod.y,
    };
    const meanWinding = (key: "raw" | "reduced"): TorusVec2 => {
      let x = 0;
      let y = 0;
      for (const pair of this.particles) {
        x += pair[key].windingX;
        y += pair[key].windingY;
      }
      return { x: x / this.particles.length, y: y / this.particles.length };
    };
    return {
      rawPeriod: { x: this.parameters.periodX, y: this.parameters.periodY },
      removedPeriod,
      residualPeriod,
      rawHarmonicEnergy: 0.5 * (this.parameters.periodX ** 2 + this.parameters.periodY ** 2),
      residualHarmonicEnergy: 0.5 * (residualPeriod.x ** 2 + residualPeriod.y ** 2),
      vorticityRms: 2 * Math.PI * this.parameters.vortexStrength,
      rawMeanWinding: meanWinding("raw"),
      reducedMeanWinding: meanWinding("reduced"),
    };
  }
}
