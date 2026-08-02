export type RepresentationFieldKind = "constant" | "gradient" | "rotation";

export interface TransferVec2 {
  x: number;
  y: number;
}

export interface TransferEdge {
  tail: number;
  head: number;
  alpha: number;
}

export interface TransferFace {
  vertices: [number, number, number];
  center: TransferVec2;
  area: number;
  vector: TransferVec2;
  circulation: number;
  curl: number;
  reconstructionResidual: number;
}

export interface RepresentationTransferReport {
  resolution: number;
  kind: RepresentationFieldKind;
  positions: TransferVec2[];
  vertexField: TransferVec2[];
  edges: TransferEdge[];
  faces: TransferFace[];
  reconstructedVertexField: TransferVec2[];
  analyticCurl: number;
  curlRms: number;
  curlTruthError: number;
  faceResidualRms: number;
  roundTripRms: number;
}

function fieldAt(position: TransferVec2, kind: RepresentationFieldKind): TransferVec2 {
  if (kind === "constant") return { x: 0.95, y: 0.28 };
  if (kind === "gradient") {
    // grad(0.65 x - 0.15 y + 0.275 (x² + y²))
    return { x: 0.65 + 0.55 * position.x, y: -0.15 + 0.55 * position.y };
  }
  return { x: -position.y, y: position.x };
}

function key(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function signedEdgeValue(
  tail: number,
  head: number,
  edgeLookup: ReadonlyMap<string, TransferEdge>,
): number {
  const edge = edgeLookup.get(key(tail, head));
  if (!edge) throw new Error(`Missing edge ${tail}–${head}.`);
  return edge.tail === tail ? edge.alpha : -edge.alpha;
}

function reconstructConstantFaceVector(
  points: readonly [TransferVec2, TransferVec2, TransferVec2],
  alpha: readonly [number, number, number],
): { vector: TransferVec2; residual: number } {
  const directions = points.map((point, index) => {
    const next = points[(index + 1) % 3]!;
    return { x: next.x - point.x, y: next.y - point.y };
  });
  let a00 = 0;
  let a01 = 0;
  let a11 = 0;
  let b0 = 0;
  let b1 = 0;
  for (let index = 0; index < 3; index += 1) {
    const direction = directions[index]!;
    a00 += direction.x * direction.x;
    a01 += direction.x * direction.y;
    a11 += direction.y * direction.y;
    b0 += direction.x * alpha[index]!;
    b1 += direction.y * alpha[index]!;
  }
  const determinant = a00 * a11 - a01 * a01;
  if (Math.abs(determinant) < 1e-14) throw new Error("Degenerate triangle in face reconstruction.");
  const vector = {
    x: (a11 * b0 - a01 * b1) / determinant,
    y: (a00 * b1 - a01 * b0) / determinant,
  };
  let residual2 = 0;
  for (let index = 0; index < 3; index += 1) {
    const direction = directions[index]!;
    const difference = direction.x * vector.x + direction.y * vector.y - alpha[index]!;
    residual2 += difference * difference;
  }
  return { vector, residual: Math.sqrt(residual2 / 3) };
}

export function buildRepresentationTransfer(
  resolution = 9,
  kind: RepresentationFieldKind = "gradient",
): RepresentationTransferReport {
  if (!Number.isInteger(resolution) || resolution < 3 || resolution > 31) {
    throw new Error("resolution must be an integer from 3 through 31");
  }
  const positions: TransferVec2[] = [];
  const vertex = (column: number, row: number): number => row * resolution + column;
  for (let row = 0; row < resolution; row += 1) {
    for (let column = 0; column < resolution; column += 1) {
      positions.push({
        x: -1 + 2 * column / (resolution - 1),
        y: -1 + 2 * row / (resolution - 1),
      });
    }
  }
  const triangles: Array<[number, number, number]> = [];
  for (let row = 0; row + 1 < resolution; row += 1) {
    for (let column = 0; column + 1 < resolution; column += 1) {
      const a = vertex(column, row);
      const b = vertex(column + 1, row);
      const c = vertex(column, row + 1);
      const d = vertex(column + 1, row + 1);
      triangles.push([a, b, d], [a, d, c]);
    }
  }
  const vertexField = positions.map((position) => fieldAt(position, kind));
  const edgePairs = new Map<string, [number, number]>();
  for (const triangle of triangles) {
    for (let corner = 0; corner < 3; corner += 1) {
      const first = triangle[corner]!;
      const second = triangle[(corner + 1) % 3]!;
      const tail = Math.min(first, second);
      const head = Math.max(first, second);
      edgePairs.set(key(tail, head), [tail, head]);
    }
  }
  const edges = [...edgePairs.values()].map(([tail, head]): TransferEdge => {
    const a = positions[tail]!;
    const b = positions[head]!;
    const u = vertexField[tail]!;
    const v = vertexField[head]!;
    return {
      tail,
      head,
      alpha: 0.5 * ((u.x + v.x) * (b.x - a.x) + (u.y + v.y) * (b.y - a.y)),
    };
  });
  const edgeLookup = new Map(edges.map((edge) => [key(edge.tail, edge.head), edge]));
  const faces = triangles.map((vertices): TransferFace => {
    const points: [TransferVec2, TransferVec2, TransferVec2] = [
      positions[vertices[0]]!,
      positions[vertices[1]]!,
      positions[vertices[2]]!,
    ];
    const alpha: [number, number, number] = [
      signedEdgeValue(vertices[0], vertices[1], edgeLookup),
      signedEdgeValue(vertices[1], vertices[2], edgeLookup),
      signedEdgeValue(vertices[2], vertices[0], edgeLookup),
    ];
    const twiceArea =
      (points[1].x - points[0].x) * (points[2].y - points[0].y) -
      (points[1].y - points[0].y) * (points[2].x - points[0].x);
    const area = 0.5 * twiceArea;
    if (area <= 0) throw new Error("Triangles must be positively oriented.");
    const circulation = alpha[0] + alpha[1] + alpha[2];
    const reconstruction = reconstructConstantFaceVector(points, alpha);
    return {
      vertices,
      center: {
        x: (points[0].x + points[1].x + points[2].x) / 3,
        y: (points[0].y + points[1].y + points[2].y) / 3,
      },
      area,
      vector: reconstruction.vector,
      circulation,
      curl: circulation / area,
      reconstructionResidual: reconstruction.residual,
    };
  });
  const reconstructedVertexField = positions.map(() => ({ x: 0, y: 0 }));
  const vertexWeights = new Float64Array(positions.length);
  for (const face of faces) {
    for (const index of face.vertices) {
      reconstructedVertexField[index]!.x += face.area * face.vector.x;
      reconstructedVertexField[index]!.y += face.area * face.vector.y;
      vertexWeights[index] = vertexWeights[index]! + face.area;
    }
  }
  for (let index = 0; index < positions.length; index += 1) {
    reconstructedVertexField[index]!.x /= vertexWeights[index]!;
    reconstructedVertexField[index]!.y /= vertexWeights[index]!;
  }
  const analyticCurl = kind === "rotation" ? 2 : 0;
  let curl2 = 0;
  let curlTruth2 = 0;
  let faceResidual2 = 0;
  for (const face of faces) {
    curl2 += face.curl * face.curl;
    curlTruth2 += (face.curl - analyticCurl) ** 2;
    faceResidual2 += face.reconstructionResidual ** 2;
  }
  let roundTrip2 = 0;
  for (let index = 0; index < positions.length; index += 1) {
    const differenceX = reconstructedVertexField[index]!.x - vertexField[index]!.x;
    const differenceY = reconstructedVertexField[index]!.y - vertexField[index]!.y;
    roundTrip2 += differenceX * differenceX + differenceY * differenceY;
  }
  return {
    resolution,
    kind,
    positions,
    vertexField,
    edges,
    faces,
    reconstructedVertexField,
    analyticCurl,
    curlRms: Math.sqrt(curl2 / faces.length),
    curlTruthError: Math.sqrt(curlTruth2 / faces.length),
    faceResidualRms: Math.sqrt(faceResidual2 / faces.length),
    roundTripRms: Math.sqrt(roundTrip2 / positions.length),
  };
}
