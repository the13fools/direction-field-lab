export type DiskCirculationMode = "smooth" | "punctured";

export interface DiskPoint {
  x: number;
  y: number;
}

export interface DiskFieldSample {
  velocity: DiskPoint;
  oneForm: DiskPoint;
  vorticity: number;
  alpha: number | null;
  beta: number | null;
  phi: number | null;
}

export interface AnnulusCoefficients {
  solidRotation: number;
  harmonic: number;
  vorticity: number;
}

export function sampleSmoothDisk(x: number, y: number, boundarySpeed: number): DiskFieldSample {
  return {
    velocity: { x: -boundarySpeed * y, y: boundarySpeed * x },
    oneForm: { x: -boundarySpeed * y, y: boundarySpeed * x },
    vorticity: 2 * boundarySpeed,
    alpha: 2 * boundarySpeed * x,
    beta: y,
    phi: -boundarySpeed * x * y,
  };
}

export function samplePuncturedDisk(x: number, y: number, boundarySpeed: number): DiskFieldSample {
  const radiusSquared = x * x + y * y;
  if (!(radiusSquared > 0)) throw new Error("The punctured-disk field is undefined at the origin");
  return {
    velocity: {
      x: -boundarySpeed * y / radiusSquared,
      y: boundarySpeed * x / radiusSquared,
    },
    oneForm: {
      x: -boundarySpeed * y / radiusSquared,
      y: boundarySpeed * x / radiusSquared,
    },
    vorticity: 0,
    alpha: null,
    beta: Math.atan2(y, x),
    phi: boundarySpeed * Math.atan2(y, x),
  };
}

export function annulusCoefficients(
  innerRadius: number,
  innerCirculation: number,
  outerCirculation: number,
): AnnulusCoefficients {
  if (!(innerRadius > 0 && innerRadius < 1)) throw new Error("innerRadius must lie in (0,1)");
  const denominator = 2 * Math.PI * (1 - innerRadius * innerRadius);
  const solidRotation = (outerCirculation - innerCirculation) / denominator;
  const harmonic = (
    innerCirculation - 2 * Math.PI * solidRotation * innerRadius * innerRadius
  ) / (2 * Math.PI);
  return { solidRotation, harmonic, vorticity: 2 * solidRotation };
}

export function annulusCirculation(
  radius: number,
  innerRadius: number,
  innerCirculation: number,
  outerCirculation: number,
): number {
  if (!(radius >= innerRadius && radius <= 1)) throw new Error("radius must lie in the annulus");
  const coefficients = annulusCoefficients(innerRadius, innerCirculation, outerCirculation);
  return 2 * Math.PI * (
    coefficients.solidRotation * radius * radius + coefficients.harmonic
  );
}

export function sampleAnnulus(
  x: number,
  y: number,
  innerRadius: number,
  innerCirculation: number,
  outerCirculation: number,
): DiskFieldSample {
  const radiusSquared = x * x + y * y;
  if (!(radiusSquared >= innerRadius * innerRadius && radiusSquared <= 1 + 1e-12)) {
    throw new Error("sample point must lie in the annulus");
  }
  const coefficients = annulusCoefficients(innerRadius, innerCirculation, outerCirculation);
  const angularSpeed = coefficients.solidRotation + coefficients.harmonic / radiusSquared;
  return {
    velocity: { x: -angularSpeed * y, y: angularSpeed * x },
    oneForm: { x: -angularSpeed * y, y: angularSpeed * x },
    vorticity: coefficients.vorticity,
    alpha: null,
    beta: Math.atan2(y, x),
    phi: coefficients.harmonic * Math.atan2(y, x),
  };
}

export function advectAnnulusPoint(
  point: DiskPoint,
  time: number,
  innerRadius: number,
  innerCirculation: number,
  outerCirculation: number,
): DiskPoint {
  const radiusSquared = point.x * point.x + point.y * point.y;
  if (!(radiusSquared >= innerRadius * innerRadius)) throw new Error("point lies inside the annulus hole");
  const coefficients = annulusCoefficients(innerRadius, innerCirculation, outerCirculation);
  const angle = (coefficients.solidRotation + coefficients.harmonic / radiusSquared) * time;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return {
    x: cosine * point.x - sine * point.y,
    y: sine * point.x + cosine * point.y,
  };
}

export function loopCirculation(
  radius: number,
  boundarySpeed: number,
  mode: DiskCirculationMode,
): number {
  if (!(radius >= 0 && radius <= 1)) throw new Error("radius must lie in [0,1]");
  if (mode === "punctured" && radius === 0) throw new Error("the punctured-disk loop must avoid the origin");
  return mode === "smooth"
    ? 2 * Math.PI * boundarySpeed * radius * radius
    : 2 * Math.PI * boundarySpeed;
}

export function advectDiskPoint(
  point: DiskPoint,
  time: number,
  boundarySpeed: number,
  mode: DiskCirculationMode,
): DiskPoint {
  const radiusSquared = point.x * point.x + point.y * point.y;
  if (mode === "punctured" && !(radiusSquared > 0)) {
    throw new Error("cannot advect the removed center of the punctured disk");
  }
  const angularSpeed = mode === "smooth" ? boundarySpeed : boundarySpeed / radiusSquared;
  const angle = angularSpeed * time;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return {
    x: cosine * point.x - sine * point.y,
    y: sine * point.x + cosine * point.y,
  };
}
