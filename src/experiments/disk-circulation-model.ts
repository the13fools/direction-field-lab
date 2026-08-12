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

