export interface FaceFieldSample {
  vertices: [number, number, number];
  center: [number, number, number];
  normal: [number, number, number];
  vector: [number, number, number];
  area: number;
}

export interface VertexFieldSample {
  vertex: number;
  position: [number, number, number];
  normal: [number, number, number];
  vector: [number, number, number];
}

export function torusPositions(
  gridSize: number,
  majorRadius = 2.55,
  minorRadius = 1.02,
): Float32Array {
  const positions = new Float32Array(gridSize * gridSize * 3);
  for (let y = 0; y < gridSize; y += 1) {
    const v = (2 * Math.PI * y) / gridSize;
    for (let x = 0; x < gridSize; x += 1) {
      const u = (2 * Math.PI * x) / gridSize;
      const index = (y * gridSize + x) * 3;
      const radius = majorRadius + minorRadius * Math.cos(v);
      positions[index] = radius * Math.cos(u);
      positions[index + 1] = radius * Math.sin(u);
      positions[index + 2] = minorRadius * Math.sin(v);
    }
  }
  return positions;
}

export function periodicGridFaces(gridSize: number): Int32Array {
  const faces = new Int32Array(gridSize * gridSize * 2 * 3);
  const vertex = (x: number, y: number) =>
    ((y % gridSize + gridSize) % gridSize) * gridSize +
    ((x % gridSize + gridSize) % gridSize);
  let offset = 0;
  for (let y = 0; y < gridSize; y += 1) {
    for (let x = 0; x < gridSize; x += 1) {
      const v00 = vertex(x, y);
      const v10 = vertex(x + 1, y);
      const v11 = vertex(x + 1, y + 1);
      const v01 = vertex(x, y + 1);
      faces.set([v00, v10, v11, v00, v11, v01], offset);
      offset += 6;
    }
  }
  return faces;
}

/**
 * Convert a discrete primal 1-form (one signed integral per oriented edge)
 * into a tangent vector at each triangle barycenter using Whitney
 * interpolation. This is the same bridge used by mesh DEC viewers: the
 * solver owns edge integrals; the renderer shows a piecewise-linear vector
 * field without changing the underlying degrees of freedom.
 */
export function whitneyFaceField(
  positions: Float32Array,
  edges: Int32Array,
  faces: Int32Array,
  values: Float64Array,
): FaceFieldSample[] {
  if (edges.length !== values.length * 2) {
    throw new Error("A discrete 1-form needs one value per oriented edge.");
  }

  const lookup = new Map<string, { edge: number; tail: number; head: number }>();
  for (let edge = 0; edge < values.length; edge += 1) {
    const tail = edges[edge * 2]!;
    const head = edges[edge * 2 + 1]!;
    lookup.set(edgeKey(tail, head), { edge, tail, head });
  }

  const samples: FaceFieldSample[] = [];
  for (let face = 0; face < faces.length / 3; face += 1) {
    const i = faces[face * 3]!;
    const j = faces[face * 3 + 1]!;
    const k = faces[face * 3 + 2]!;
    const pi = positionAt(positions, i);
    const pj = positionAt(positions, j);
    const pk = positionAt(positions, k);
    const eij = subtract(pj, pi);
    const ejk = subtract(pk, pj);
    const eki = subtract(pi, pk);
    const rawNormal = cross(eij, subtract(pk, pi));
    const twiceArea = norm(rawNormal);
    if (twiceArea < 1e-12) continue;
    const normal = scale(rawNormal, 1 / twiceArea);

    const alphaIJ = orientedValue(i, j, lookup, values);
    const alphaJK = orientedValue(j, k, lookup, values);
    const alphaKI = orientedValue(k, i, lookup, values);
    const covector = add(
      add(
        scale(subtract(eki, ejk), alphaIJ),
        scale(subtract(eij, eki), alphaJK),
      ),
      scale(subtract(ejk, eij), alphaKI),
    );
    const vector = scale(cross(normal, covector), 1 / (3 * twiceArea));
    samples.push({
      vertices: [i, j, k],
      center: scale(add(add(pi, pj), pk), 1 / 3),
      normal,
      vector,
      area: 0.5 * twiceArea,
    });
  }
  return samples;
}

/**
 * Produce a vertex tangent field from an edge-based discrete 1-form.
 * Incident Whitney face vectors are area averaged in R³ and then projected
 * into the vertex tangent plane. This is a display map only: the DEC solve
 * itself remains on oriented edge integrals.
 */
export function vertexFieldFromOneForm(
  positions: Float32Array,
  edges: Int32Array,
  faces: Int32Array,
  values: Float64Array,
): VertexFieldSample[] {
  const vertexCount = positions.length / 3;
  const vectorSums = new Float64Array(vertexCount * 3);
  const normalSums = new Float64Array(vertexCount * 3);
  const weights = new Float64Array(vertexCount);
  const facesWithFields = whitneyFaceField(positions, edges, faces, values);

  for (const face of facesWithFields) {
    for (const vertex of face.vertices) {
      weights[vertex] = weights[vertex]! + face.area;
      for (let axis = 0; axis < 3; axis += 1) {
        const index = vertex * 3 + axis;
        vectorSums[index] = vectorSums[index]! + face.area * face.vector[axis]!;
        normalSums[index] = normalSums[index]! + face.area * face.normal[axis]!;
      }
    }
  }

  const samples: VertexFieldSample[] = [];
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const weight = weights[vertex]!;
    if (weight < 1e-12) continue;
    const normal = normalized([
      normalSums[vertex * 3]!,
      normalSums[vertex * 3 + 1]!,
      normalSums[vertex * 3 + 2]!,
    ]);
    const averaged: Vector3 = [
      vectorSums[vertex * 3]! / weight,
      vectorSums[vertex * 3 + 1]! / weight,
      vectorSums[vertex * 3 + 2]! / weight,
    ];
    const tangent = subtract(averaged, scale(normal, dot(averaged, normal)));
    samples.push({
      vertex,
      position: positionAt(positions, vertex),
      normal,
      vector: tangent,
    });
  }
  return samples;
}

function orientedValue(
  tail: number,
  head: number,
  lookup: Map<string, { edge: number; tail: number; head: number }>,
  values: Float64Array,
): number {
  const record = lookup.get(edgeKey(tail, head));
  if (!record) throw new Error(`Triangle edge ${tail}–${head} is missing from the 1-form.`);
  return (record.tail === tail && record.head === head ? 1 : -1) * values[record.edge]!;
}

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

type Vector3 = [number, number, number];

function positionAt(positions: Float32Array, index: number): Vector3 {
  return [positions[index * 3]!, positions[index * 3 + 1]!, positions[index * 3 + 2]!];
}

function add(a: Vector3, b: Vector3): Vector3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function subtract(a: Vector3, b: Vector3): Vector3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scale(a: Vector3, value: number): Vector3 {
  return [value * a[0], value * a[1], value * a[2]];
}

function cross(a: Vector3, b: Vector3): Vector3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function norm(a: Vector3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

function normalized(a: Vector3): Vector3 {
  const length = norm(a);
  return length < 1e-12 ? [0, 0, 1] : scale(a, 1 / length);
}

function dot(a: Vector3, b: Vector3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
