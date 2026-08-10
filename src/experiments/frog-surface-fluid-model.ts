import {
  RandomSurfaceFluidModel,
  temporalPerlinNoise,
  type FieldSample,
  type FlowProjection,
  type FluidParticle,
  type RandomFluidDiagnostics,
  type RandomSurfaceFluidParameters,
  type SpectrumBand,
  type Vec3,
  type VertexVelocitySample,
} from "./random-surface-fluid-model";

const TAU = 2 * Math.PI;

export interface FrogTriangleMesh {
  positions: Float64Array;
  faces: Uint32Array;
  vertexNormals: Float64Array;
  vertexAreas: Float64Array;
  faceNormals: Float64Array;
  faceAreas: Float64Array;
  faceGradients: Float64Array;
  faceNeighbors: Int32Array;
  vertexFaces: number[][];
  laplaceNeighbors: number[][];
  laplaceWeights: number[][];
  positionToVertex: Map<string, number>;
}

interface FrogMode {
  band: number;
  frequency: number;
  amplitude: number;
  phase: number;
  timeOffset: number;
  timeRate: number;
  noiseSeed: number;
  axis: Vec3;
}

interface PreparedFrogMode {
  frequency: number;
  amplitude: number;
  phase: number;
  axis: Vec3;
}

interface PreparedFrogFields {
  primary: PreparedFrogMode[];
  alpha: PreparedFrogMode[];
  beta: PreparedFrogMode[];
}

interface ScalarSample {
  value: number;
  gradient: Vec3;
}

interface FrogFieldState {
  time: number;
  vertexVelocity: Float64Array;
  faceVelocity: Float64Array;
  divergence: Float64Array;
  vorticity: Float64Array;
}

interface FrogParticleState {
  face: number;
  barycentric: [number, number, number];
}

function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function scale(a: Vec3, amount: number): Vec3 {
  return { x: amount * a.x, y: amount * a.y, z: amount * a.z };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function norm(a: Vec3): number {
  return Math.hypot(a.x, a.y, a.z);
}

function normalize(a: Vec3): Vec3 {
  const length = norm(a);
  return length > 1e-14 ? scale(a, 1 / length) : { x: 0, y: 0, z: 1 };
}

function tangent(vector: Vec3, normal: Vec3): Vec3 {
  return add(vector, scale(normal, -dot(vector, normal)));
}

function arrayVector(values: Float64Array, index: number): Vec3 {
  return { x: values[3 * index]!, y: values[3 * index + 1]!, z: values[3 * index + 2]! };
}

function setArrayVector(values: Float64Array, index: number, vector: Vec3): void {
  values[3 * index] = vector.x;
  values[3 * index + 1] = vector.y;
  values[3 * index + 2] = vector.z;
}

function addArrayVector(values: Float64Array, index: number, vector: Vec3, amount = 1): void {
  values[3 * index] = values[3 * index]! + amount * vector.x;
  values[3 * index + 1] = values[3 * index + 1]! + amount * vector.y;
  values[3 * index + 2] = values[3 * index + 2]! + amount * vector.z;
}

function positionKey(position: Vec3): string {
  return [position.x, position.y, position.z].map((value) => Math.round(value * 1e4)).join(":");
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = value + Math.imul(value ^ (value >>> 7), 61 | value) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function randomUnitVector(random: () => number): Vec3 {
  const z = 2 * random() - 1;
  const azimuth = TAU * random();
  const radius = Math.sqrt(Math.max(0, 1 - z * z));
  return { x: radius * Math.cos(azimuth), y: radius * Math.sin(azimuth), z };
}

function addEdgeWeight(weights: Map<string, number>, a: number, b: number, amount: number): void {
  const key = a < b ? `${a}:${b}` : `${b}:${a}`;
  weights.set(key, (weights.get(key) ?? 0) + amount);
}

export function parseFrogTriangleMesh(source: string): FrogTriangleMesh {
  const vertices: number[] = [];
  const faceIndices: number[] = [];
  for (const line of source.split(/\r?\n/)) {
    if (line.startsWith("v ")) {
      const values = line.trim().split(/\s+/);
      vertices.push(Number(values[1]), Number(values[2]), Number(values[3]));
    } else if (line.startsWith("f ")) {
      const values = line.trim().split(/\s+/).slice(1);
      if (values.length !== 3) throw new Error("The tree-frog surface must be triangulated.");
      for (const value of values) faceIndices.push(Number(value.split("/")[0]) - 1);
    }
  }
  if (vertices.length < 9 || faceIndices.length < 3) throw new Error("The tree-frog OBJ is empty.");

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let index = 0; index < vertices.length; index += 3) {
    minX = Math.min(minX, vertices[index]!);
    minY = Math.min(minY, vertices[index + 1]!);
    minZ = Math.min(minZ, vertices[index + 2]!);
    maxX = Math.max(maxX, vertices[index]!);
    maxY = Math.max(maxY, vertices[index + 1]!);
    maxZ = Math.max(maxZ, vertices[index + 2]!);
  }
  const center = { x: 0.5 * (minX + maxX), y: 0.5 * (minY + maxY), z: 0.5 * (minZ + maxZ) };
  const meshScale = 2.65 / Math.max(maxX - minX, maxY - minY, maxZ - minZ);
  const positions = new Float64Array(vertices.length);
  for (let index = 0; index < vertices.length; index += 3) {
    positions[index] = meshScale * (vertices[index]! - center.x);
    positions[index + 1] = meshScale * (vertices[index + 1]! - center.y);
    positions[index + 2] = meshScale * (vertices[index + 2]! - center.z);
  }

  const faces = Uint32Array.from(faceIndices);
  const vertexCount = positions.length / 3;
  const faceCount = faces.length / 3;
  const vertexNormals = new Float64Array(positions.length);
  const vertexAreas = new Float64Array(vertexCount);
  const faceNormals = new Float64Array(3 * faceCount);
  const faceAreas = new Float64Array(faceCount);
  const faceGradients = new Float64Array(9 * faceCount);
  const vertexFaces = Array.from({ length: vertexCount }, () => [] as number[]);
  const faceNeighbors = new Int32Array(3 * faceCount);
  faceNeighbors.fill(-1);
  const edgeOwners = new Map<string, { face: number; opposite: number }>();
  const edgeWeights = new Map<string, number>();

  for (let face = 0; face < faceCount; face += 1) {
    const ids = [faces[3 * face]!, faces[3 * face + 1]!, faces[3 * face + 2]!] as const;
    const a = arrayVector(positions, ids[0]);
    const b = arrayVector(positions, ids[1]);
    const c = arrayVector(positions, ids[2]);
    const ab = subtract(b, a);
    const ac = subtract(c, a);
    const areaVector = cross(ab, ac);
    const twiceArea = norm(areaVector);
    if (twiceArea < 1e-14) throw new Error(`Degenerate tree-frog face ${face}.`);
    const normal = scale(areaVector, 1 / twiceArea);
    const area = 0.5 * twiceArea;
    setArrayVector(faceNormals, face, normal);
    faceAreas[face] = area;
    for (const id of ids) {
      addArrayVector(vertexNormals, id, areaVector);
      vertexAreas[id] = vertexAreas[id]! + area / 3;
      vertexFaces[id]!.push(face);
    }

    const gradients = [
      scale(cross(normal, subtract(c, b)), 1 / twiceArea),
      scale(cross(normal, subtract(a, c)), 1 / twiceArea),
      scale(cross(normal, subtract(b, a)), 1 / twiceArea),
    ];
    for (let local = 0; local < 3; local += 1) {
      const gradient = gradients[local]!;
      const offset = 9 * face + 3 * local;
      faceGradients[offset] = gradient.x;
      faceGradients[offset + 1] = gradient.y;
      faceGradients[offset + 2] = gradient.z;

      const edgeA = ids[(local + 1) % 3]!;
      const edgeB = ids[(local + 2) % 3]!;
      const edgeKey = edgeA < edgeB ? `${edgeA}:${edgeB}` : `${edgeB}:${edgeA}`;
      const owner = edgeOwners.get(edgeKey);
      if (owner) {
        faceNeighbors[3 * face + local] = owner.face;
        faceNeighbors[3 * owner.face + owner.opposite] = face;
      } else {
        edgeOwners.set(edgeKey, { face, opposite: local });
      }
    }

    const cotA = dot(ab, ac) / twiceArea;
    const ba = subtract(a, b);
    const bc = subtract(c, b);
    const cotB = dot(ba, bc) / twiceArea;
    const ca = subtract(a, c);
    const cb = subtract(b, c);
    const cotC = dot(ca, cb) / twiceArea;
    addEdgeWeight(edgeWeights, ids[1], ids[2], 0.5 * cotA);
    addEdgeWeight(edgeWeights, ids[0], ids[2], 0.5 * cotB);
    addEdgeWeight(edgeWeights, ids[0], ids[1], 0.5 * cotC);
  }

  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    setArrayVector(vertexNormals, vertex, normalize(arrayVector(vertexNormals, vertex)));
  }
  const laplaceNeighbors = Array.from({ length: vertexCount }, () => [] as number[]);
  const laplaceWeights = Array.from({ length: vertexCount }, () => [] as number[]);
  for (const [key, weight] of edgeWeights) {
    const [a, b] = key.split(":").map(Number) as [number, number];
    laplaceNeighbors[a]!.push(b);
    laplaceWeights[a]!.push(weight);
    laplaceNeighbors[b]!.push(a);
    laplaceWeights[b]!.push(weight);
  }
  const positionToVertex = new Map<string, number>();
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    positionToVertex.set(positionKey(arrayVector(positions, vertex)), vertex);
  }
  return {
    positions,
    faces,
    vertexNormals,
    vertexAreas,
    faceNormals,
    faceAreas,
    faceGradients,
    faceNeighbors,
    vertexFaces,
    laplaceNeighbors,
    laplaceWeights,
    positionToVertex,
  };
}

export class FrogSurfaceFluidModel extends RandomSurfaceFluidModel {
  readonly frogMesh: FrogTriangleMesh;
  private frogPrimaryModes: FrogMode[] = [];
  private frogAlphaModes: FrogMode[] = [];
  private frogBetaModes: FrogMode[] = [];
  private frogVelocityScale = 1;
  private stateCache = new Map<number, FrogFieldState>();
  private preparedCache = new Map<number, PreparedFrogFields>();
  private initialState: FrogFieldState | undefined;
  private particleStates = new WeakMap<FluidParticle, FrogParticleState>();
  private cloudFaces: [number[], number[]] = [[], []];

  constructor(mesh: FrogTriangleMesh, parameters: Partial<RandomSurfaceFluidParameters> = {}) {
    super({ ...parameters, surface: "sphere" });
    this.frogMesh = mesh;
    this.rebuildFrog();
  }

  private rebuildFrog(): void {
    this.time = 0;
    this.steps = 0;
    const random = mulberry32(this.parameters.seed);
    this.frogPrimaryModes = this.makeFrogModes(random, 101);
    this.frogAlphaModes = this.makeFrogModes(random, 1009);
    this.frogBetaModes = this.makeFrogModes(random, 10007);
    this.frogVelocityScale = 1;
    this.stateCache.clear();
    this.preparedCache.clear();
    const calibration = this.buildState(0);
    let speed2 = 0;
    for (let vertex = 0; vertex < this.frogMesh.positions.length / 3; vertex += 1) {
      const velocity = arrayVector(calibration.vertexVelocity, vertex);
      speed2 += dot(velocity, velocity);
    }
    const rms = Math.sqrt(speed2 / Math.max(1, this.frogMesh.positions.length / 3));
    this.frogVelocityScale = rms > 1e-14 ? this.parameters.speed / rms : 0;
    this.stateCache.clear();
    this.initialState = this.stateAt(0);
    this.prepareCloudFaces();
    this.resetParticles();
  }

  private makeFrogModes(random: () => number, seedOffset: number): FrogMode[] {
    const result: FrogMode[] = [];
    for (let index = 0; index < this.parameters.modeCount; index += 1) {
      const band = 1 + (index % this.parameters.maxBand);
      const frequency = Math.PI * band / 1.3;
      result.push({
        band,
        frequency,
        amplitude: (random() < 0.5 ? -1 : 1) * frequency ** (-(this.parameters.spectralSlope + 2) / 2),
        phase: TAU * random(),
        timeOffset: 40 * random() + 0.371 * seedOffset,
        timeRate: this.parameters.turnover * (0.42 + 0.3 * random()) * Math.sqrt(band),
        noiseSeed: (this.parameters.seed + seedOffset + 104729 * index) | 0,
        axis: randomUnitVector(random),
      });
    }
    return result;
  }

  private prepareModes(modes: readonly FrogMode[], time: number): PreparedFrogMode[] {
    return modes.map((mode) => {
      const coordinate = mode.timeOffset + time * mode.timeRate;
      const envelope = 0.78 + 0.32 * temporalPerlinNoise(coordinate + 13.7, mode.noiseSeed + 17);
      const phase = 1.85 * temporalPerlinNoise(coordinate, mode.noiseSeed);
      return {
        frequency: mode.frequency,
        amplitude: mode.amplitude * envelope,
        phase: mode.phase + phase,
        axis: mode.axis,
      };
    });
  }

  private preparedAt(time: number): PreparedFrogFields {
    const cached = this.preparedCache.get(time);
    if (cached) return cached;
    const prepared = {
      primary: this.prepareModes(this.frogPrimaryModes, time),
      alpha: this.prepareModes(this.frogAlphaModes, time),
      beta: this.prepareModes(this.frogBetaModes, time),
    };
    this.preparedCache.set(time, prepared);
    while (this.preparedCache.size > 5) {
      const removable = [...this.preparedCache.keys()].find((key) => key !== 0);
      if (removable === undefined) break;
      this.preparedCache.delete(removable);
    }
    return prepared;
  }

  private scalar(modes: readonly PreparedFrogMode[], point: Vec3, normal: Vec3): ScalarSample {
    let value = 0;
    let ambientGradient = { x: 0, y: 0, z: 0 };
    for (const mode of modes) {
      const argument = mode.frequency * dot(mode.axis, point) + mode.phase;
      value += mode.amplitude * Math.sin(argument);
      ambientGradient = add(ambientGradient, scale(mode.axis, mode.amplitude * mode.frequency * Math.cos(argument)));
    }
    return { value, gradient: tangent(ambientGradient, normal) };
  }

  private analyticVelocity(point: Vec3, normal: Vec3, time: number): Vec3 {
    const fields = this.preparedAt(time);
    const primary = this.scalar(fields.primary, point, normal);
    if (this.parameters.projection === "curl-free") return primary.gradient;
    if (this.parameters.projection === "divergence-free") return cross(normal, primary.gradient);
    const alpha = this.scalar(fields.alpha, point, normal);
    const beta = this.scalar(fields.beta, point, normal);
    return add(primary.gradient, scale(beta.gradient, alpha.value));
  }

  private clebschVorticity(point: Vec3, normal: Vec3, time: number): number {
    const fields = this.preparedAt(time);
    const alpha = this.scalar(fields.alpha, point, normal);
    const beta = this.scalar(fields.beta, point, normal);
    return dot(normal, cross(alpha.gradient, beta.gradient));
  }

  private multiplyLaplace(vector: Float64Array, result: Float64Array): void {
    for (let vertex = 0; vertex < vector.length; vertex += 1) {
      let value = 1e-10 * this.frogMesh.vertexAreas[vertex]! * vector[vertex]!;
      const neighbors = this.frogMesh.laplaceNeighbors[vertex]!;
      const weights = this.frogMesh.laplaceWeights[vertex]!;
      for (let entry = 0; entry < neighbors.length; entry += 1) {
        value += weights[entry]! * (vector[vertex]! - vector[neighbors[entry]!]!);
      }
      result[vertex] = value;
    }
  }

  private solveStreamFunction(vorticity: Float64Array): Float64Array {
    const count = vorticity.length;
    const rhs = new Float64Array(count);
    let totalArea = 0;
    let mean = 0;
    for (let vertex = 0; vertex < count; vertex += 1) {
      const area = this.frogMesh.vertexAreas[vertex]!;
      totalArea += area;
      mean += area * vorticity[vertex]!;
    }
    mean /= Math.max(1e-14, totalArea);
    for (let vertex = 0; vertex < count; vertex += 1) {
      vorticity[vertex] = vorticity[vertex]! - mean;
      rhs[vertex] = -this.frogMesh.vertexAreas[vertex]! * vorticity[vertex]!;
    }

    const solution = new Float64Array(count);
    const residual = rhs.slice();
    const direction = residual.slice();
    const product = new Float64Array(count);
    let residual2 = 0;
    for (const value of residual) residual2 += value * value;
    const initialResidual2 = Math.max(1e-30, residual2);
    for (let iteration = 0; iteration < 36 && residual2 > 1e-12 * initialResidual2; iteration += 1) {
      this.multiplyLaplace(direction, product);
      let denominator = 0;
      for (let vertex = 0; vertex < count; vertex += 1) denominator += direction[vertex]! * product[vertex]!;
      if (Math.abs(denominator) < 1e-30) break;
      const alpha = residual2 / denominator;
      let nextResidual2 = 0;
      for (let vertex = 0; vertex < count; vertex += 1) {
        solution[vertex] = solution[vertex]! + alpha * direction[vertex]!;
        residual[vertex] = residual[vertex]! - alpha * product[vertex]!;
        nextResidual2 += residual[vertex]! ** 2;
      }
      const beta = nextResidual2 / Math.max(1e-30, residual2);
      for (let vertex = 0; vertex < count; vertex += 1) {
        direction[vertex] = residual[vertex]! + beta * direction[vertex]!;
      }
      residual2 = nextResidual2;
    }
    return solution;
  }

  private weakDivergence(faceVelocity: Float64Array): Float64Array {
    const result = new Float64Array(this.frogMesh.positions.length / 3);
    for (let face = 0; face < this.frogMesh.faces.length / 3; face += 1) {
      const velocity = arrayVector(faceVelocity, face);
      const area = this.frogMesh.faceAreas[face]!;
      for (let local = 0; local < 3; local += 1) {
        const vertex = this.frogMesh.faces[3 * face + local]!;
        const offset = 9 * face + 3 * local;
        const gradient = {
          x: this.frogMesh.faceGradients[offset]!,
          y: this.frogMesh.faceGradients[offset + 1]!,
          z: this.frogMesh.faceGradients[offset + 2]!,
        };
        result[vertex] = result[vertex]! - area * dot(velocity, gradient);
      }
    }
    for (let vertex = 0; vertex < result.length; vertex += 1) {
      result[vertex] = result[vertex]! / Math.max(1e-14, this.frogMesh.vertexAreas[vertex]!);
    }
    return result;
  }

  private weakVorticity(faceVelocity: Float64Array): Float64Array {
    const rotated = new Float64Array(faceVelocity.length);
    for (let face = 0; face < this.frogMesh.faces.length / 3; face += 1) {
      setArrayVector(rotated, face, cross(arrayVector(this.frogMesh.faceNormals, face), arrayVector(faceVelocity, face)));
    }
    const result = this.weakDivergence(rotated);
    for (let vertex = 0; vertex < result.length; vertex += 1) result[vertex] = -result[vertex]!;
    return result;
  }

  private buildState(time: number): FrogFieldState {
    const vertexCount = this.frogMesh.positions.length / 3;
    const faceCount = this.frogMesh.faces.length / 3;
    const vertexVelocity = new Float64Array(3 * vertexCount);
    const faceVelocity = new Float64Array(3 * faceCount);
    const targetVorticity = new Float64Array(vertexCount);

    if (this.parameters.projection === "clebsch-projected") {
      for (let vertex = 0; vertex < vertexCount; vertex += 1) {
        targetVorticity[vertex] = this.clebschVorticity(
          arrayVector(this.frogMesh.positions, vertex),
          arrayVector(this.frogMesh.vertexNormals, vertex),
          time,
        );
      }
      const streamFunction = this.solveStreamFunction(targetVorticity);
      for (let face = 0; face < faceCount; face += 1) {
        let gradient = { x: 0, y: 0, z: 0 };
        for (let local = 0; local < 3; local += 1) {
          const vertex = this.frogMesh.faces[3 * face + local]!;
          const offset = 9 * face + 3 * local;
          gradient = add(gradient, scale({
            x: this.frogMesh.faceGradients[offset]!,
            y: this.frogMesh.faceGradients[offset + 1]!,
            z: this.frogMesh.faceGradients[offset + 2]!,
          }, streamFunction[vertex]!));
        }
        setArrayVector(faceVelocity, face, cross(arrayVector(this.frogMesh.faceNormals, face), gradient));
      }
      for (let vertex = 0; vertex < vertexCount; vertex += 1) {
        let velocity = { x: 0, y: 0, z: 0 };
        let area = 0;
        for (const face of this.frogMesh.vertexFaces[vertex]!) {
          const faceArea = this.frogMesh.faceAreas[face]!;
          velocity = add(velocity, scale(arrayVector(faceVelocity, face), faceArea));
          area += faceArea;
        }
        setArrayVector(vertexVelocity, vertex, tangent(scale(velocity, 1 / Math.max(1e-14, area)), arrayVector(this.frogMesh.vertexNormals, vertex)));
      }
    } else {
      for (let vertex = 0; vertex < vertexCount; vertex += 1) {
        const point = arrayVector(this.frogMesh.positions, vertex);
        const normal = arrayVector(this.frogMesh.vertexNormals, vertex);
        setArrayVector(vertexVelocity, vertex, this.analyticVelocity(point, normal, time));
        if (this.parameters.projection === "clebsch") {
          targetVorticity[vertex] = this.clebschVorticity(point, normal, time);
        }
      }
      for (let face = 0; face < faceCount; face += 1) {
        const ids = [
          this.frogMesh.faces[3 * face]!,
          this.frogMesh.faces[3 * face + 1]!,
          this.frogMesh.faces[3 * face + 2]!,
        ];
        const point = scale(add(add(
          arrayVector(this.frogMesh.positions, ids[0]!),
          arrayVector(this.frogMesh.positions, ids[1]!),
        ), arrayVector(this.frogMesh.positions, ids[2]!)), 1 / 3);
        setArrayVector(faceVelocity, face, this.analyticVelocity(point, arrayVector(this.frogMesh.faceNormals, face), time));
      }
    }

    for (let index = 0; index < vertexVelocity.length; index += 1) vertexVelocity[index] = vertexVelocity[index]! * this.frogVelocityScale;
    for (let index = 0; index < faceVelocity.length; index += 1) faceVelocity[index] = faceVelocity[index]! * this.frogVelocityScale;
    const divergence = this.weakDivergence(faceVelocity);
    const vorticity = this.parameters.projection === "clebsch" || this.parameters.projection === "clebsch-projected"
      ? targetVorticity
      : this.weakVorticity(faceVelocity);
    if (this.parameters.projection === "clebsch" || this.parameters.projection === "clebsch-projected") {
      for (let vertex = 0; vertex < vorticity.length; vertex += 1) vorticity[vertex] = vorticity[vertex]! * this.frogVelocityScale;
    }
    return { time, vertexVelocity, faceVelocity, divergence, vorticity };
  }

  private stateAt(time: number): FrogFieldState {
    const projectionInterval = 3 * this.parameters.timeStep;
    const sampledTime = this.parameters.projection === "clebsch-projected"
      ? Number((Math.round(time / projectionInterval) * projectionInterval).toFixed(12))
      : time;
    const cached = this.stateCache.get(sampledTime);
    if (cached) return cached;
    const state = this.buildState(sampledTime);
    this.stateCache.set(sampledTime, state);
    while (this.stateCache.size > 5) {
      const removable = [...this.stateCache.keys()].find((key) => key !== 0);
      if (removable === undefined) break;
      this.stateCache.delete(removable);
    }
    return state;
  }

  private vertexIndex(position: Vec3): number {
    const exact = this.frogMesh.positionToVertex.get(positionKey(position));
    if (exact !== undefined) return exact;
    let nearest = 0;
    let nearestDistance2 = Infinity;
    for (let vertex = 0; vertex < this.frogMesh.positions.length / 3; vertex += 1) {
      const candidate = arrayVector(this.frogMesh.positions, vertex);
      const distance2 = dot(subtract(candidate, position), subtract(candidate, position));
      if (distance2 < nearestDistance2) {
        nearest = vertex;
        nearestDistance2 = distance2;
      }
    }
    return nearest;
  }

  override velocitySampleAtVertex(position: Vec3): VertexVelocitySample {
    const vertex = this.vertexIndex(position);
    const state = this.stateAt(this.time);
    return {
      position,
      normal: arrayVector(this.frogMesh.vertexNormals, vertex),
      velocity: arrayVector(state.vertexVelocity, vertex),
    };
  }

  override fieldSampleAtVertex(position: Vec3): FieldSample {
    const vertex = this.vertexIndex(position);
    const state = this.stateAt(this.time);
    return {
      position,
      normal: arrayVector(this.frogMesh.vertexNormals, vertex),
      velocity: arrayVector(state.vertexVelocity, vertex),
      divergence: state.divergence[vertex]!,
      vorticity: state.vorticity[vertex]!,
    };
  }

  override fieldSamples(): FieldSample[] {
    const result: FieldSample[] = [];
    const stride = Math.max(1, Math.floor(this.frogMesh.positions.length / 3 / 240));
    for (let vertex = 0; vertex < this.frogMesh.positions.length / 3; vertex += stride) {
      result.push(this.fieldSampleAtVertex(arrayVector(this.frogMesh.positions, vertex)));
    }
    return result;
  }

  private prepareCloudFaces(): void {
    const faceCount = this.frogMesh.faces.length / 3;
    const targets = [{ x: -0.34, y: 0.28, z: 0.58 }, { x: 0.34, y: 0.28, z: 0.58 }];
    for (let group = 0; group < 2; group += 1) {
      let seedFace = 0;
      let minimum = Infinity;
      for (let face = 0; face < faceCount; face += 1) {
        const center = this.facePoint(face, [1 / 3, 1 / 3, 1 / 3]);
        const distance2 = dot(subtract(center, targets[group]!), subtract(center, targets[group]!));
        if (distance2 < minimum) {
          minimum = distance2;
          seedFace = face;
        }
      }
      const seed = this.facePoint(seedFace, [1 / 3, 1 / 3, 1 / 3]);
      const candidates: number[] = [];
      for (let face = 0; face < faceCount; face += 1) {
        const center = this.facePoint(face, [1 / 3, 1 / 3, 1 / 3]);
        if (norm(subtract(center, seed)) < 0.24) candidates.push(face);
      }
      this.cloudFaces[group] = candidates.length > 0 ? candidates : [seedFace];
    }
  }

  override resetParticles(): void {
    if (!this.frogMesh) {
      super.resetParticles();
      return;
    }
    const random = mulberry32(this.parameters.seed ^ 0x9e3779b9);
    this.particles = [];
    this.particleStates = new WeakMap();
    for (let index = 0; index < this.parameters.particleCount; index += 1) {
      const group = (index % 2) as 0 | 1;
      const candidates = this.cloudFaces[group];
      const face = candidates[Math.floor(random() * candidates.length)]!;
      const root = Math.sqrt(random());
      const barycentric: [number, number, number] = [1 - root, root * (1 - random()), root * random()];
      const particle: FluidParticle = { surface: "sphere", position: this.facePoint(face, barycentric), group };
      this.particles.push(particle);
      this.particleStates.set(particle, { face, barycentric });
    }
  }

  private facePoint(face: number, barycentric: readonly number[]): Vec3 {
    let point = { x: 0, y: 0, z: 0 };
    for (let local = 0; local < 3; local += 1) {
      point = add(point, scale(
        arrayVector(this.frogMesh.positions, this.frogMesh.faces[3 * face + local]!),
        barycentric[local]!,
      ));
    }
    return point;
  }

  private barycentric(face: number, point: Vec3): [number, number, number] {
    const a = arrayVector(this.frogMesh.positions, this.frogMesh.faces[3 * face]!);
    const b = arrayVector(this.frogMesh.positions, this.frogMesh.faces[3 * face + 1]!);
    const c = arrayVector(this.frogMesh.positions, this.frogMesh.faces[3 * face + 2]!);
    const normal = arrayVector(this.frogMesh.faceNormals, face);
    const projected = add(point, scale(normal, -dot(subtract(point, a), normal)));
    const v0 = subtract(b, a);
    const v1 = subtract(c, a);
    const v2 = subtract(projected, a);
    const d00 = dot(v0, v0);
    const d01 = dot(v0, v1);
    const d11 = dot(v1, v1);
    const d20 = dot(v2, v0);
    const d21 = dot(v2, v1);
    const denominator = d00 * d11 - d01 * d01;
    const second = (d11 * d20 - d01 * d21) / denominator;
    const third = (d00 * d21 - d01 * d20) / denominator;
    return [1 - second - third, second, third];
  }

  private walk(start: FrogParticleState, velocity: Vec3, duration: number): FrogParticleState {
    let face = start.face;
    let barycentric = [...start.barycentric] as [number, number, number];
    let point = this.facePoint(face, barycentric);
    let remaining = duration;
    for (let crossing = 0; crossing < 12 && remaining > 1e-10; crossing += 1) {
      const normal = arrayVector(this.frogMesh.faceNormals, face);
      const direction = tangent(velocity, normal);
      const proposed = add(point, scale(direction, remaining));
      const end = this.barycentric(face, proposed);
      if (Math.min(...end) >= -1e-9) {
        const total = end[0] + end[1] + end[2];
        return { face, barycentric: [end[0] / total, end[1] / total, end[2] / total] };
      }
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
      const nextFace = this.frogMesh.faceNeighbors[3 * face + crossedLocal]!;
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

  private faceVelocity(face: number, point: Vec3, time: number): Vec3 {
    if (this.parameters.projection === "clebsch-projected") {
      return arrayVector(this.stateAt(time).faceVelocity, face);
    }
    return scale(this.analyticVelocity(point, arrayVector(this.frogMesh.faceNormals, face), time), this.frogVelocityScale);
  }

  override particlePosition(particle: FluidParticle): Vec3 {
    return particle.position!;
  }

  override step(count = 1): void {
    if (!Number.isInteger(count) || count < 1 || count > 200) throw new Error("step count must be from 1 through 200");
    const dt = this.parameters.timeStep;
    for (let iteration = 0; iteration < count; iteration += 1) {
      const halfTime = this.time + 0.5 * dt;
      const firstTime = this.parameters.projection === "clebsch-projected" ? halfTime : this.time;
      for (const particle of this.particles) {
        const state = this.particleStates.get(particle)!;
        const point = this.facePoint(state.face, state.barycentric);
        const first = this.faceVelocity(state.face, point, firstTime);
        const midpoint = this.walk(state, first, 0.5 * dt);
        const midpointPosition = this.facePoint(midpoint.face, midpoint.barycentric);
        const second = this.faceVelocity(midpoint.face, midpointPosition, halfTime);
        const next = this.walk(state, second, dt);
        particle.position = this.facePoint(next.face, next.barycentric);
        this.particleStates.set(particle, next);
      }
      this.time += dt;
      this.steps += 1;
    }
  }

  override spectrum(): SpectrumBand[] {
    const energy = Array.from({ length: this.parameters.maxBand }, () => 0);
    const modes = this.parameters.projection === "clebsch" || this.parameters.projection === "clebsch-projected"
      ? [...this.frogPrimaryModes, ...this.frogAlphaModes, ...this.frogBetaModes]
      : this.frogPrimaryModes;
    for (const mode of modes) energy[mode.band - 1] = energy[mode.band - 1]! + (mode.amplitude * mode.frequency) ** 2;
    const total = energy.reduce((sum, value) => sum + value, 0);
    return energy.map((value, index) => ({
      band: index + 1,
      energy: value,
      share: total > 0 ? value / total : 0,
      modes: modes.filter((mode) => mode.band === index + 1).length,
    }));
  }

  override diagnostics(samples = this.fieldSamples()): RandomFluidDiagnostics {
    const initial = this.initialState ?? this.stateAt(0);
    let speed2 = 0;
    let initialSpeed2 = 0;
    let crossCorrelation = 0;
    let maxSpeed = 0;
    let tangencyResidual = 0;
    let divergence2 = 0;
    let vorticity2 = 0;
    for (const sample of samples) {
      const vertex = this.vertexIndex(sample.position);
      const speed = norm(sample.velocity);
      const initialVelocity = arrayVector(initial.vertexVelocity, vertex);
      speed2 += speed ** 2;
      initialSpeed2 += dot(initialVelocity, initialVelocity);
      crossCorrelation += dot(sample.velocity, initialVelocity);
      maxSpeed = Math.max(maxSpeed, speed);
      tangencyResidual = Math.max(tangencyResidual, Math.abs(dot(sample.velocity, sample.normal)) / Math.max(1e-14, speed));
      divergence2 += sample.divergence ** 2;
      vorticity2 += sample.vorticity ** 2;
    }
    return {
      rmsSpeed: Math.sqrt(speed2 / Math.max(1, samples.length)),
      maxSpeed,
      tangencyResidual,
      divergenceResidual: Math.sqrt(divergence2 / Math.max(1, samples.length)),
      vorticityRms: Math.sqrt(vorticity2 / Math.max(1, samples.length)),
      fieldCorrelation: crossCorrelation / Math.max(1e-14, Math.sqrt(speed2 * initialSpeed2)),
    };
  }
}
