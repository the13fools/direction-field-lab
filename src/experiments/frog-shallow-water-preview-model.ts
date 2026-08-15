import type { FrogEigenbasis, FrogTriangleMesh } from "./frog-surface-fluid-model";
import type { Vec3 } from "./random-surface-fluid-model";

interface WaveMode {
  basisIndex: number;
  omega: number;
  amplitude: number;
  values: Float64Array;
  faceGradients: Float64Array;
}

const WAVE_MODE_INDICES = [3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 21, 24, 27, 31] as const;

interface ParticleState {
  face: number;
  barycentric: [number, number, number];
}

export interface FrogWaveState {
  height: Float64Array;
  vertexVelocity: Float64Array;
  faceVelocity: Float64Array;
}

const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const subtract = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const scale = (a: Vec3, amount: number): Vec3 => ({ x: amount * a.x, y: amount * a.y, z: amount * a.z });
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;

function arrayVector(values: ArrayLike<number>, index: number): Vec3 {
  return { x: values[3 * index]!, y: values[3 * index + 1]!, z: values[3 * index + 2]! };
}

function setArrayVector(values: Float64Array, index: number, vector: Vec3): void {
  values[3 * index] = vector.x;
  values[3 * index + 1] = vector.y;
  values[3 * index + 2] = vector.z;
}

function tangent(vector: Vec3, normal: Vec3): Vec3 {
  return subtract(vector, scale(normal, dot(vector, normal)));
}

function seeded(index: number, offset: number): number {
  const value = Math.sin(index * 91.731 + offset * 17.113) * 43758.5453;
  return value - Math.floor(value);
}

/**
 * A deliberately small, exact-in-time linear shallow-water preview on the
 * frog mesh. It is not the nonlinear course solver: it evolves a localized
 * Laplace--Beltrami wave packet so the mesh teaser has honest surface physics.
 */
export class FrogShallowWaterPreviewModel {
  readonly mesh: FrogTriangleMesh;
  readonly eigenbasis: FrogEigenbasis;
  readonly gravity: number;
  readonly meanDepth: number;
  readonly particles: ParticleState[];
  time = 0;
  private readonly modes: WaveMode[];
  private cachedTime = Number.NaN;
  private cachedState: FrogWaveState | undefined;

  readonly waveModeIndices = WAVE_MODE_INDICES;

  constructor(
    mesh: FrogTriangleMesh,
    eigenbasis: FrogEigenbasis,
    particleCount = 5000,
    gravity = 9.81,
    meanDepth = 1,
  ) {
    if (mesh.positions.length / 3 !== eigenbasis.vertexCount) {
      throw new Error("The frog mesh and shallow-water eigenbasis do not match.");
    }
    if (eigenbasis.modeCount <= this.waveModeIndices[this.waveModeIndices.length - 1]!) {
      throw new Error("The frog wave preview needs at least 32 eigenmodes.");
    }
    this.mesh = mesh;
    this.eigenbasis = eigenbasis;
    this.gravity = gravity;
    this.meanDepth = meanDepth;
    this.modes = this.makeLocalizedPacket();
    this.particles = Array.from({ length: particleCount }, (_, index) => {
      const face = Math.floor(seeded(index, 17) * (mesh.faces.length / 3));
      const root = Math.sqrt(seeded(index, 31));
      const split = seeded(index, 47);
      return {
        face,
        barycentric: [1 - root, root * (1 - split), root * split],
      };
    });
  }

  reset(): void {
    this.time = 0;
    this.cachedTime = Number.NaN;
    this.particles.forEach((particle, index) => {
      particle.face = Math.floor(seeded(index, 17) * (this.mesh.faces.length / 3));
      const root = Math.sqrt(seeded(index, 31));
      const split = seeded(index, 47);
      particle.barycentric = [1 - root, root * (1 - split), root * split];
    });
  }

  private makeMode(basisIndex: number): WaveMode {
    const vertexCount = this.eigenbasis.vertexCount;
    const values = new Float64Array(vertexCount);
    const offset = basisIndex * vertexCount;
    let area = 0;
    let mean = 0;
    for (let vertex = 0; vertex < vertexCount; vertex += 1) {
      const weight = this.mesh.vertexAreas[vertex]!;
      values[vertex] = this.eigenbasis.modes[offset + vertex]!;
      mean += weight * values[vertex]!;
      area += weight;
    }
    mean /= Math.max(area, 1e-14);
    for (let vertex = 0; vertex < vertexCount; vertex += 1) {
      values[vertex] = values[vertex]! - mean;
    }
    const faceGradients = this.faceGradients(values);
    const eigenvalue = this.eigenbasis.eigenvalues[basisIndex]!;
    return {
      basisIndex,
      omega: Math.sqrt(this.gravity * this.meanDepth * eigenvalue),
      amplitude: 0,
      values,
      faceGradients,
    };
  }

  private makeLocalizedPacket(): WaveMode[] {
    const modes = this.waveModeIndices.map((basisIndex) => this.makeMode(basisIndex));
    const sourceTarget = { x: 0, y: -0.34, z: 0.46 };
    let sourceVertex = 0;
    let sourceDistance2 = Infinity;
    for (let vertex = 0; vertex < this.mesh.positions.length / 3; vertex += 1) {
      const delta = subtract(arrayVector(this.mesh.positions, vertex), sourceTarget);
      const distance2 = dot(delta, delta);
      if (distance2 < sourceDistance2) {
        sourceDistance2 = distance2;
        sourceVertex = vertex;
      }
    }

    // A heat-kernel-shaped spectral packet: coefficients agree in sign at a
    // single point, while the exponential envelope suppresses unresolved
    // mesh-scale ringing. Omitting the first modes keeps useful fine structure.
    for (const mode of modes) {
      const eigenvalue = this.eigenbasis.eigenvalues[mode.basisIndex]!;
      let norm2 = 0;
      for (let vertex = 0; vertex < mode.values.length; vertex += 1) {
        norm2 += this.mesh.vertexAreas[vertex]! * mode.values[vertex]! ** 2;
      }
      mode.amplitude = (
        mode.values[sourceVertex]!
        * Math.exp(-0.022 * eigenvalue)
        / Math.max(norm2, 1e-14)
      );
    }

    let packetMaximum = 0;
    for (let vertex = 0; vertex < this.mesh.positions.length / 3; vertex += 1) {
      let value = 0;
      for (const mode of modes) value += mode.amplitude * mode.values[vertex]!;
      packetMaximum = Math.max(packetMaximum, Math.abs(value));
    }
    const scaleFactor = 0.092 / Math.max(packetMaximum, 1e-14);
    for (const mode of modes) mode.amplitude *= scaleFactor;
    return modes;
  }

  private faceGradients(values: Float64Array): Float64Array {
    const faceCount = this.mesh.faces.length / 3;
    const gradients = new Float64Array(3 * faceCount);
    for (let face = 0; face < faceCount; face += 1) {
      let gradient = { x: 0, y: 0, z: 0 };
      for (let local = 0; local < 3; local += 1) {
        const vertex = this.mesh.faces[3 * face + local]!;
        const offset = 9 * face + 3 * local;
        gradient = add(gradient, scale({
          x: this.mesh.faceGradients[offset]!,
          y: this.mesh.faceGradients[offset + 1]!,
          z: this.mesh.faceGradients[offset + 2]!,
        }, values[vertex]!));
      }
      setArrayVector(gradients, face, gradient);
    }
    return gradients;
  }

  private vertexAverage(faceVectors: Float64Array): Float64Array {
    const result = new Float64Array(this.mesh.positions.length);
    for (let vertex = 0; vertex < this.mesh.positions.length / 3; vertex += 1) {
      let vector = { x: 0, y: 0, z: 0 };
      let area = 0;
      for (const face of this.mesh.vertexFaces[vertex]!) {
        const faceArea = this.mesh.faceAreas[face]!;
        vector = add(vector, scale(arrayVector(faceVectors, face), faceArea));
        area += faceArea;
      }
      setArrayVector(
        result,
        vertex,
        tangent(scale(vector, 1 / Math.max(area, 1e-14)), arrayVector(this.mesh.vertexNormals, vertex)),
      );
    }
    return result;
  }

  private faceVelocityAt(time: number): Float64Array {
    const faceVelocity = new Float64Array(this.mesh.faces.length);
    for (const mode of this.modes) {
      const coefficient = -mode.amplitude * this.gravity / mode.omega * Math.sin(mode.omega * time);
      for (let index = 0; index < faceVelocity.length; index += 1) {
        faceVelocity[index] = faceVelocity[index]! + coefficient * mode.faceGradients[index]!;
      }
    }
    return faceVelocity;
  }

  private weakDivergence(faceVelocity: Float64Array): Float64Array {
    const divergence = new Float64Array(this.mesh.positions.length / 3);
    for (let face = 0; face < this.mesh.faces.length / 3; face += 1) {
      const velocity = arrayVector(faceVelocity, face);
      const area = this.mesh.faceAreas[face]!;
      for (let local = 0; local < 3; local += 1) {
        const vertex = this.mesh.faces[3 * face + local]!;
        const offset = 9 * face + 3 * local;
        const basisGradient = {
          x: this.mesh.faceGradients[offset]!,
          y: this.mesh.faceGradients[offset + 1]!,
          z: this.mesh.faceGradients[offset + 2]!,
        };
        divergence[vertex] = divergence[vertex]! - area * dot(basisGradient, velocity);
      }
    }
    for (let vertex = 0; vertex < divergence.length; vertex += 1) {
      divergence[vertex] = divergence[vertex]! / Math.max(this.mesh.vertexAreas[vertex]!, 1e-14);
    }
    return divergence;
  }

  stateAt(time = this.time): FrogWaveState {
    if (time === this.cachedTime && this.cachedState) return this.cachedState;
    const vertexCount = this.mesh.positions.length / 3;
    const height = new Float64Array(vertexCount);
    height.fill(this.meanDepth);
    const faceVelocity = this.faceVelocityAt(time);
    for (const mode of this.modes) {
      const heightCoefficient = mode.amplitude * Math.cos(mode.omega * time);
      for (let vertex = 0; vertex < vertexCount; vertex += 1) {
        height[vertex] = height[vertex]! + heightCoefficient * mode.values[vertex]!;
      }
    }
    const state = { height, faceVelocity, vertexVelocity: this.vertexAverage(faceVelocity) };
    if (time === this.time) {
      this.cachedTime = time;
      this.cachedState = state;
    }
    return state;
  }

  particlePosition(particle: ParticleState): Vec3 {
    return add(
      this.facePoint(particle.face, particle.barycentric),
      scale(arrayVector(this.mesh.faceNormals, particle.face), 0.012),
    );
  }

  private facePoint(face: number, barycentric: readonly number[]): Vec3 {
    let point = { x: 0, y: 0, z: 0 };
    for (let local = 0; local < 3; local += 1) {
      point = add(point, scale(
        arrayVector(this.mesh.positions, this.mesh.faces[3 * face + local]!),
        barycentric[local]!,
      ));
    }
    return point;
  }

  private barycentric(face: number, point: Vec3): [number, number, number] {
    const a = arrayVector(this.mesh.positions, this.mesh.faces[3 * face]!);
    const b = arrayVector(this.mesh.positions, this.mesh.faces[3 * face + 1]!);
    const c = arrayVector(this.mesh.positions, this.mesh.faces[3 * face + 2]!);
    const normal = arrayVector(this.mesh.faceNormals, face);
    const projected = add(point, scale(normal, -dot(subtract(point, a), normal)));
    const edge0 = subtract(b, a);
    const edge1 = subtract(c, a);
    const relative = subtract(projected, a);
    const d00 = dot(edge0, edge0);
    const d01 = dot(edge0, edge1);
    const d11 = dot(edge1, edge1);
    const d20 = dot(relative, edge0);
    const d21 = dot(relative, edge1);
    const denominator = d00 * d11 - d01 * d01;
    const second = (d11 * d20 - d01 * d21) / denominator;
    const third = (d00 * d21 - d01 * d20) / denominator;
    return [1 - second - third, second, third];
  }

  private walk(start: ParticleState, velocity: Vec3, duration: number): ParticleState {
    let face = start.face;
    let barycentric = [...start.barycentric] as [number, number, number];
    let point = this.facePoint(face, barycentric);
    let remaining = duration;
    for (let crossing = 0; crossing < 12 && remaining > 1e-10; crossing += 1) {
      const direction = tangent(velocity, arrayVector(this.mesh.faceNormals, face));
      const end = this.barycentric(face, add(point, scale(direction, remaining)));
      if (Math.min(...end) >= -1e-9) return { face, barycentric: end };
      let fraction = 1;
      let crossedLocal = -1;
      for (let local = 0; local < 3; local += 1) {
        if (end[local]! >= 0) continue;
        const candidate = barycentric[local]! / Math.max(1e-14, barycentric[local]! - end[local]!);
        if (candidate < fraction) {
          fraction = candidate;
          crossedLocal = local;
        }
      }
      if (crossedLocal < 0) break;
      point = add(point, scale(direction, remaining * Math.max(0, fraction)));
      remaining *= Math.max(0, 1 - fraction);
      const nextFace = this.mesh.faceNeighbors[3 * face + crossedLocal]!;
      if (nextFace < 0) return { face, barycentric };
      face = nextFace;
      const next = this.barycentric(face, point);
      const clamped = next.map((value) => Math.max(1e-9, value)) as [number, number, number];
      const total = clamped[0] + clamped[1] + clamped[2];
      barycentric = [clamped[0] / total, clamped[1] / total, clamped[2] / total];
      point = this.facePoint(face, barycentric);
    }
    return { face, barycentric };
  }

  step(timeStep = 0.012): void {
    const midpointTime = this.time + 0.5 * timeStep;
    const startVelocity = this.faceVelocityAt(this.time);
    const midpointVelocity = this.faceVelocityAt(midpointTime);
    this.particles.forEach((particle) => {
      const first = arrayVector(startVelocity, particle.face);
      const midpoint = this.walk(particle, first, 0.5 * timeStep);
      const second = arrayVector(midpointVelocity, midpoint.face);
      const next = this.walk(particle, second, timeStep);
      particle.face = next.face;
      particle.barycentric = next.barycentric;
    });
    this.time += timeStep;
    this.cachedTime = Number.NaN;
  }

  /** Relative lumped-mass residual of eta_t + H div(u) = 0. */
  continuityResidualRms(time = this.time): number {
    const divergence = this.weakDivergence(this.faceVelocityAt(time));
    let residual2 = 0;
    let reference2 = 0;
    for (let vertex = 0; vertex < divergence.length; vertex += 1) {
      let heightRate = 0;
      for (const mode of this.modes) {
        heightRate -= mode.amplitude * mode.omega * Math.sin(mode.omega * time) * mode.values[vertex]!;
      }
      const fluxDivergence = this.meanDepth * divergence[vertex]!;
      const weight = this.mesh.vertexAreas[vertex]!;
      residual2 += weight * (heightRate + fluxDivergence) ** 2;
      reference2 += 0.5 * weight * (heightRate ** 2 + fluxDivergence ** 2);
    }
    return reference2 < 1e-24 ? 0 : Math.sqrt(residual2 / reference2);
  }

  massDrift(): number {
    const state = this.stateAt();
    let area = 0;
    let mass = 0;
    for (let vertex = 0; vertex < state.height.length; vertex += 1) {
      const weight = this.mesh.vertexAreas[vertex]!;
      area += weight;
      mass += weight * (state.height[vertex]! - this.meanDepth);
    }
    return mass / Math.max(area, 1e-14);
  }

  /**
   * For B=(X,Y,Z), the minimum-norm Clebsch weights equal the ambient
   * components of the tangent velocity. This reports the projection defect.
   */
  ambientRechartDefect(): number {
    const velocity = this.stateAt().vertexVelocity;
    let error2 = 0;
    let reference2 = 0;
    for (let vertex = 0; vertex < this.mesh.positions.length / 3; vertex += 1) {
      const vector = arrayVector(velocity, vertex);
      const reconstructed = tangent(vector, arrayVector(this.mesh.vertexNormals, vertex));
      const error = subtract(reconstructed, vector);
      error2 += dot(error, error);
      reference2 += dot(vector, vector);
    }
    return Math.sqrt(error2 / Math.max(reference2, 1e-24));
  }
}
