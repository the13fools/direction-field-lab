export type ProjectiveDomainKind = "annulus" | "two-hole";
export type ProjectiveLoopKind = "hole-1" | "hole-2" | "outer";

export interface ProjectivePoint {
  x: number;
  y: number;
}

export interface ProjectiveHole extends ProjectivePoint {
  radius: number;
  cutAngle: number;
  label: string;
}

export interface ProjectiveDomain {
  kind: ProjectiveDomainKind;
  outerRadius: number;
  holes: readonly ProjectiveHole[];
}

export interface LineTensor {
  xx: number;
  xy: number;
  yy: number;
}

const TAU = 2 * Math.PI;

export const PROJECTIVE_DOMAINS: Record<ProjectiveDomainKind, ProjectiveDomain> = {
  annulus: {
    kind: "annulus",
    outerRadius: 1.34,
    holes: [
      { x: 0, y: 0, radius: 0.38, cutAngle: -0.5 * Math.PI, label: "central hole" },
    ],
  },
  "two-hole": {
    kind: "two-hole",
    outerRadius: 1.42,
    holes: [
      { x: -0.47, y: 0, radius: 0.25, cutAngle: -0.5 * Math.PI, label: "left hole" },
      { x: 0.47, y: 0, radius: 0.25, cutAngle: 0.5 * Math.PI, label: "right hole" },
    ],
  },
};

function positiveModulo(value: number, period: number): number {
  return ((value % period) + period) % period;
}

function wrapSigned(angle: number): number {
  return positiveModulo(angle + Math.PI, TAU) - Math.PI;
}

export function projectiveDomainContains(domain: ProjectiveDomain, point: ProjectivePoint): boolean {
  if (Math.hypot(point.x, point.y) >= domain.outerRadius) return false;
  return domain.holes.every((hole) => Math.hypot(point.x - hole.x, point.y - hole.y) > hole.radius);
}

export function projectiveCutAngle(point: ProjectivePoint, hole: ProjectiveHole): number {
  const raw = Math.atan2(point.y - hole.y, point.x - hole.x);
  return hole.cutAngle + positiveModulo(raw - hole.cutAngle, TAU);
}

export function projectivePowerPhase(
  domain: ProjectiveDomain,
  point: ProjectivePoint,
  charges: readonly number[],
): number {
  return domain.holes.reduce((phase, hole, index) => (
    phase + (charges[index] ?? 0) * projectiveCutAngle(point, hole)
  ), 0);
}

export function projectiveRosyDirections(
  symmetry: number,
  powerPhase: number,
  magnitude = 1,
): ProjectivePoint[] {
  if (!Number.isInteger(symmetry) || symmetry < 1) throw new Error("symmetry must be a positive integer");
  return Array.from({ length: symmetry }, (_, branch) => {
    const angle = (powerPhase + branch * TAU) / symmetry;
    return { x: magnitude * Math.cos(angle), y: magnitude * Math.sin(angle) };
  });
}

/** Q = p⊗p - 1/2 I for the local line branch p=(cos(phase/2),sin(phase/2)). */
export function projectiveLineTensor(powerPhase: number): LineTensor {
  return {
    xx: 0.5 * Math.cos(powerPhase),
    xy: 0.5 * Math.sin(powerPhase),
    yy: -0.5 * Math.cos(powerPhase),
  };
}

export function projectiveLoopCharge(
  domain: ProjectiveDomain,
  charges: readonly number[],
  loop: ProjectiveLoopKind,
): number {
  if (loop === "hole-1") return charges[0] ?? 0;
  if (loop === "hole-2") return domain.holes.length > 1 ? charges[1] ?? 0 : 0;
  return domain.holes.reduce((sum, _, index) => sum + (charges[index] ?? 0), 0);
}

export function projectiveBranchShift(
  domain: ProjectiveDomain,
  symmetry: number,
  charges: readonly number[],
  loop: ProjectiveLoopKind,
): number {
  return positiveModulo(projectiveLoopCharge(domain, charges, loop), symmetry);
}

export function projectiveLoopPoint(
  domain: ProjectiveDomain,
  loop: ProjectiveLoopKind,
  turn: number,
): ProjectivePoint {
  const angle = TAU * turn;
  if (loop === "outer") {
    const radius = domain.outerRadius - 0.13;
    return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
  }
  const index = loop === "hole-2" ? 1 : 0;
  const hole = domain.holes[Math.min(index, domain.holes.length - 1)]!;
  const radius = hole.radius + (domain.kind === "annulus" ? 0.22 : 0.115);
  return {
    x: hole.x + radius * Math.cos(angle),
    y: hole.y + radius * Math.sin(angle),
  };
}

/**
 * Continuously follows one local branch instead of reselecting a principal
 * root after crossing a cut. At one full turn the endpoint differs by the
 * loop's monodromy, 2πm/N.
 */
export function projectiveTransportedBranchAngle(
  domain: ProjectiveDomain,
  symmetry: number,
  charges: readonly number[],
  loop: ProjectiveLoopKind,
  turn: number,
  branch = 0,
): number {
  const clampedTurn = Math.max(0, Math.min(1, turn));
  const steps = Math.max(1, Math.ceil(160 * clampedTurn));
  const start = projectiveLoopPoint(domain, loop, 0);
  const previousAngles = domain.holes.map((hole) => Math.atan2(start.y - hole.y, start.x - hole.x));
  const unwrappedAngles = [...previousAngles];
  for (let step = 1; step <= steps; step += 1) {
    const point = projectiveLoopPoint(domain, loop, clampedTurn * step / steps);
    for (let holeIndex = 0; holeIndex < domain.holes.length; holeIndex += 1) {
      const hole = domain.holes[holeIndex]!;
      const next = Math.atan2(point.y - hole.y, point.x - hole.x);
      unwrappedAngles[holeIndex] = unwrappedAngles[holeIndex]!
        + wrapSigned(next - previousAngles[holeIndex]!);
      previousAngles[holeIndex] = next;
    }
  }
  const phase = unwrappedAngles.reduce((sum, angle, index) => (
    sum + (charges[index] ?? 0) * angle
  ), 0);
  return (phase + branch * TAU) / symmetry;
}
