import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import type { HodgeFieldLayout } from "../solver/messages";

import {
  periodicGridFaces,
  periodicVertexFieldFromOneForm,
  torusPositions,
} from "./hodge-visualization";

export class WebViewer {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(42, 1, 0.01, 2000);
  private readonly renderer = new THREE.WebGLRenderer({ antialias: true });
  private readonly controls: OrbitControls;
  private points?: THREE.Points;
  private lines?: THREE.LineSegments;
  private fieldLines?: THREE.LineSegments;
  private surface?: THREE.Mesh;
  private readonly viewerNote = document.createElement("div");
  private center = new THREE.Vector2();
  private positions2d = new Float64Array();
  private positions3d: Float32Array<ArrayBufferLike> = new Float32Array();
  private edgeIndices = new Int32Array();
  private faceIndices: Int32Array<ArrayBufferLike> = new Int32Array();
  private gridSize = 0;
  private restLength = 1;
  private periodic = false;

  constructor(private readonly container: HTMLElement) {
    this.scene.background = new THREE.Color(0x07120f);
    this.camera.position.set(0, 0, 18);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.container.append(this.renderer.domElement);
    this.viewerNote.className = "viewer-note";
    this.viewerNote.textContent = "drag to orbit · scroll to zoom";
    this.container.append(this.viewerNote);
    this.scene.add(new THREE.HemisphereLight(0xdafcf1, 0x07120f, 1.7));
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
    keyLight.position.set(4, -5, 7);
    this.scene.add(keyLight);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    new ResizeObserver(() => this.resize()).observe(this.container);
    this.resize();
    this.animate();
  }

  initialize(
    positions: Float64Array,
    edges: Int32Array,
    gridSize: number,
    restLength: number,
    periodic = false,
  ): void {
    this.clear();
    this.positions2d = positions.slice();
    this.edgeIndices = edges.slice();
    this.gridSize = gridSize;
    this.restLength = restLength;
    this.periodic = periodic;

    if (periodic) {
      this.initializeTorus(gridSize);
      return;
    }

    this.center.set(0.5 * (gridSize - 1) * restLength, 0.5 * (gridSize - 1) * restLength);
    const xyz = this.toXYZ(positions);
    this.positions3d = xyz;
    const pointGeometry = new THREE.BufferGeometry();
    pointGeometry.setAttribute("position", new THREE.BufferAttribute(xyz, 3));
    this.points = new THREE.Points(
      pointGeometry,
      new THREE.PointsMaterial({ color: 0xdffc5b, size: Math.max(0.07, restLength * 0.13) }),
    );
    const lineGeometry = this.networkGeometry(xyz, edges);
    this.lines = new THREE.LineSegments(
      lineGeometry,
      new THREE.LineBasicMaterial({ color: 0x75ad9a, transparent: true, opacity: 0.78 }),
    );
    this.scene.add(this.lines, this.points);
    const extent = Math.max(2, gridSize * restLength);
    this.camera.position.set(0, 0, extent * 1.18);
    this.controls.target.set(0, 0, 0);
    this.viewerNote.textContent = "drag to orbit · scroll to zoom";
  }

  update(positions: Float64Array): void {
    if (!this.points || !this.lines) return;
    if (this.periodic) return;
    const xyz = this.toXYZ(positions);
    this.positions3d = xyz;
    this.positions2d = positions.slice();
    const pointPositions = this.points.geometry.getAttribute("position") as THREE.BufferAttribute;
    const linePositions = this.lines.geometry.getAttribute("position") as THREE.BufferAttribute;
    pointPositions.copyArray(xyz);
    pointPositions.needsUpdate = true;
    if (!this.periodic) {
      linePositions.copyArray(xyz);
      linePositions.needsUpdate = true;
    }
  }

  showHodgeField(
    values: Float64Array,
    color: number,
    label: string,
    layout: HodgeFieldLayout,
    scaleReference: Float64Array = values,
  ): void {
    this.removeField();
    if (!this.periodic) return;
    if (layout === "face-vector") {
      this.showFaceVectorField(values, color, label, scaleReference);
      return;
    }
    if (layout === "vertex-vector") {
      this.showVertexVectorField(values, color, label, scaleReference);
      return;
    }
    if (values.length * 2 !== this.edgeIndices.length) return;
    if (layout === "edge-form") {
      this.showEdgeForm(values, color, label, scaleReference);
      return;
    }
    this.showVertexField(values, color, label, scaleReference);
  }

  showVertexVectorField(
    values: Float64Array,
    color: number,
    label: string,
    scaleReference: Float64Array = values,
  ): void {
    this.removeField();
    if (!this.periodic || values.length !== this.gridSize * this.gridSize * 2) return;
    const samples: VectorGlyph[] = [];
    for (let vertex = 0; vertex < this.gridSize * this.gridSize; vertex += 1) {
      const x = vertex % this.gridSize;
      const y = Math.floor(vertex / this.gridSize);
      const u = 2 * Math.PI * x / this.gridSize;
      const v = 2 * Math.PI * y / this.gridSize;
      const tangentU = new THREE.Vector3(-Math.sin(u), Math.cos(u), 0).normalize();
      const tangentV = new THREE.Vector3(
        -Math.sin(v) * Math.cos(u),
        -Math.sin(v) * Math.sin(u),
        Math.cos(v),
      ).normalize();
      const normal = tangentU.clone().cross(tangentV).normalize();
      const vector = tangentU.multiplyScalar(values[2 * vertex]!)
        .addScaledVector(tangentV, values[2 * vertex + 1]!);
      samples.push({
        position: vectorTuple(vectorAt(this.positions3d, vertex)),
        normal: vectorTuple(normal),
        vector: vectorTuple(vector),
      });
    }
    this.renderVectorGlyphs(
      samples,
      color,
      `${label} · native per-vertex tangent vectors`,
      maximumVector2Magnitude(scaleReference),
    );
  }

  currentPositions(): number[] {
    if (!this.points) return [];
    return Array.from(this.points.geometry.attributes.position!.array);
  }

  currentEdges(): number[] {
    return Array.from(this.edgeIndices);
  }

  clear(): void {
    for (const object of [this.points, this.lines, this.fieldLines, this.surface]) {
      if (!object) continue;
      this.scene.remove(object);
      object.geometry.dispose();
      if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
      else object.material.dispose();
    }
    this.points = undefined;
    this.lines = undefined;
    this.fieldLines = undefined;
    this.surface = undefined;
    this.positions3d = new Float32Array();
    this.faceIndices = new Int32Array();
  }

  private initializeTorus(gridSize: number): void {
    this.center.set(0, 0);
    this.positions3d = torusPositions(gridSize);
    this.faceIndices = periodicGridFaces(gridSize);

    const surfaceGeometry = new THREE.BufferGeometry();
    surfaceGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(this.positions3d.slice(), 3),
    );
    surfaceGeometry.setIndex(Array.from(this.faceIndices));
    surfaceGeometry.computeVertexNormals();
    this.surface = new THREE.Mesh(
      surfaceGeometry,
      new THREE.MeshStandardMaterial({
        color: 0x17463b,
        emissive: 0x071711,
        emissiveIntensity: 0.32,
        metalness: 0.04,
        roughness: 0.74,
        side: THREE.DoubleSide,
      }),
    );

    const pointGeometry = new THREE.BufferGeometry();
    pointGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(this.positions3d.slice(), 3),
    );
    this.points = new THREE.Points(
      pointGeometry,
      new THREE.PointsMaterial({ color: 0xdffc5b, size: 0.062 }),
    );
    this.lines = new THREE.LineSegments(
      this.networkGeometry(this.positions3d, this.edgeIndices),
      new THREE.LineBasicMaterial({ color: 0xb1d4c8, transparent: true, opacity: 0.22 }),
    );
    this.scene.add(this.surface, this.lines, this.points);
    this.camera.position.set(5.7, -6.9, 4.8);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
    this.viewerNote.textContent = "vertex tangent field · drag to orbit · scroll to zoom";
  }

  private showVertexField(
    values: Float64Array,
    color: number,
    label: string,
    scaleReference: Float64Array,
  ): void {
    const reconstructed = periodicVertexFieldFromOneForm(
      this.gridSize,
      this.edgeIndices,
      values,
    );
    const reconstructedReference = periodicVertexFieldFromOneForm(
      this.gridSize,
      this.edgeIndices,
      scaleReference,
    );
    this.showVertexVectorField(reconstructed, color, label, reconstructedReference);
    this.viewerNote.textContent =
      `${label} · flat Whitney reconstruction · input-relative scale · drag to orbit`;
  }

  private showFaceVectorField(
    values: Float64Array,
    color: number,
    label: string,
    scaleReference: Float64Array,
  ): void {
    if (values.length !== (this.faceIndices.length / 3) * 2) return;
    const samples: VectorGlyph[] = [];
    for (let face = 0; face < this.faceIndices.length / 3; face += 1) {
      const cell = Math.floor(face / 2);
      const x = cell % this.gridSize;
      const y = Math.floor(cell / this.gridSize);
      const firstTriangle = face % 2 === 0;
      const u = 2 * Math.PI * (x + (firstTriangle ? 2 / 3 : 1 / 3)) / this.gridSize;
      const v = 2 * Math.PI * (y + (firstTriangle ? 1 / 3 : 2 / 3)) / this.gridSize;
      const radius = 2.55 + 1.02 * Math.cos(v);
      const position = new THREE.Vector3(
        radius * Math.cos(u),
        radius * Math.sin(u),
        1.02 * Math.sin(v),
      );
      const tangentU = new THREE.Vector3(-Math.sin(u), Math.cos(u), 0).normalize();
      const tangentV = new THREE.Vector3(
        -Math.sin(v) * Math.cos(u),
        -Math.sin(v) * Math.sin(u),
        Math.cos(v),
      ).normalize();
      const normal = tangentU.clone().cross(tangentV).normalize();
      const vector = tangentU.multiplyScalar(values[2 * face]!)
        .addScaledVector(tangentV, values[2 * face + 1]!);
      samples.push({
        position: [position.x, position.y, position.z],
        normal: [normal.x, normal.y, normal.z],
        vector: [vector.x, vector.y, vector.z],
      });
    }
    this.renderVectorGlyphs(
      samples,
      color,
      `${label} · one constant vector per face · input-relative scale`,
      maximumVector2Magnitude(scaleReference),
    );
  }

  private showEdgeForm(
    values: Float64Array,
    color: number,
    label: string,
    scaleReference: Float64Array,
  ): void {
    const maxAbsolute = maximumAbsolute(scaleReference);
    const segments: number[] = [];
    const maximumLength = 0.68 * (2 * Math.PI * 1.02) / this.gridSize;
    for (let edge = 0; edge < values.length; edge += 1) {
      const tailIndex = this.edgeIndices[2 * edge]!;
      const headIndex = this.edgeIndices[2 * edge + 1]!;
      const tailPosition = vectorAt(this.positions3d, tailIndex);
      const headPosition = vectorAt(this.positions3d, headIndex);
      const chord = headPosition.clone().sub(tailPosition);
      const chordLength = chord.length();
      if (chordLength < 1e-12 || Math.abs(values[edge]!) < maxAbsolute * 1e-6) continue;
      const direction = chord.multiplyScalar((Math.sign(values[edge]!) || 1) / chordLength);
      const center = tailPosition.clone().add(headPosition).multiplyScalar(0.5);
      const ringAngle = Math.atan2(center.y, center.x);
      const normal = center.clone().sub(new THREE.Vector3(
        2.55 * Math.cos(ringAngle),
        2.55 * Math.sin(ringAngle),
        0,
      )).normalize();
      center.addScaledVector(normal, 0.05);
      const length = maximumLength * Math.sqrt(Math.abs(values[edge]!) / maxAbsolute);
      const arrowTail = center.clone().addScaledVector(direction, -0.5 * length);
      const arrowTip = center.clone().addScaledVector(direction, 0.5 * length);
      appendArrow(segments, arrowTail, arrowTip, direction, normal, length);
    }
    this.installGlyphGeometry(segments, color);
    this.viewerNote.textContent =
      `${label} · signed integrals on oriented edges · input-relative scale · drag to orbit`;
  }

  private renderVectorGlyphs(
    samples: VectorGlyph[],
    color: number,
    note: string,
    referenceMagnitude?: number,
  ): void {
    let maxMagnitude = referenceMagnitude ?? 1e-12;
    if (referenceMagnitude === undefined) {
      for (const sample of samples) {
        maxMagnitude = Math.max(maxMagnitude, Math.hypot(...sample.vector));
      }
    }

    const segments: number[] = [];
    const maximumLength = 0.78 * (2 * Math.PI * 1.02) / this.gridSize;
    for (const sample of samples) {
      const magnitude = Math.hypot(...sample.vector);
      if (magnitude < maxMagnitude * 1e-6) continue;
      const direction = new THREE.Vector3(...sample.vector).multiplyScalar(1 / magnitude);
      const normal = new THREE.Vector3(...sample.normal);
      const center = new THREE.Vector3(...sample.position).addScaledVector(normal, 0.045);
      const length = maximumLength * Math.sqrt(magnitude / maxMagnitude);
      const tail = center;
      const tip = center.clone().addScaledVector(direction, length);
      appendArrow(segments, tail, tip, direction, normal, length);
    }

    this.installGlyphGeometry(segments, color);
    this.viewerNote.textContent = `${note} · drag to orbit`;
  }

  private installGlyphGeometry(segments: number[], color: number): void {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(segments, 3),
    );
    this.fieldLines = new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.98 }),
    );
    this.fieldLines.renderOrder = 3;
    this.scene.add(this.fieldLines);
  }

  private toXYZ(positions: Float64Array): Float32Array {
    const xyz = new Float32Array((positions.length / 2) * 3);
    for (let i = 0; i < positions.length / 2; i += 1) {
      xyz[i * 3] = positions[i * 2]! - this.center.x;
      xyz[i * 3 + 1] = positions[i * 2 + 1]! - this.center.y;
    }
    return xyz;
  }

  private networkGeometry(xyz: Float32Array, edges: Int32Array): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(xyz.slice(), 3));
    geometry.setIndex(Array.from(edges));
    return geometry;
  }

  private removeField(): void {
    if (!this.fieldLines) return;
    this.scene.remove(this.fieldLines);
    this.fieldLines.geometry.dispose();
    if (Array.isArray(this.fieldLines.material)) {
      this.fieldLines.material.forEach((material) => material.dispose());
    } else {
      this.fieldLines.material.dispose();
    }
    this.fieldLines = undefined;
  }

  private resize(): void {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private animate = (): void => {
    requestAnimationFrame(this.animate);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };
}

function pushSegment(target: number[], a: THREE.Vector3, b: THREE.Vector3): void {
  target.push(a.x, a.y, a.z, b.x, b.y, b.z);
}

interface VectorGlyph {
  position: [number, number, number];
  normal: [number, number, number];
  vector: [number, number, number];
}

function appendArrow(
  segments: number[],
  tail: THREE.Vector3,
  tip: THREE.Vector3,
  direction: THREE.Vector3,
  normal: THREE.Vector3,
  length: number,
): void {
  const side = normal.clone().cross(direction).normalize();
  const wingBase = tip.clone().addScaledVector(direction, -0.24 * length);
  const wingA = wingBase.clone().addScaledVector(side, 0.13 * length);
  const wingB = wingBase.clone().addScaledVector(side, -0.13 * length);
  pushSegment(segments, tail, tip);
  pushSegment(segments, tip, wingA);
  pushSegment(segments, tip, wingB);
}

function vectorAt(positions: Float32Array<ArrayBufferLike>, index: number): THREE.Vector3 {
  return new THREE.Vector3(
    positions[3 * index]!,
    positions[3 * index + 1]!,
    positions[3 * index + 2]!,
  );
}

function vectorTuple(vector: THREE.Vector3): [number, number, number] {
  return [vector.x, vector.y, vector.z];
}

function maximumAbsolute(values: Float64Array): number {
  let maximum = 1e-12;
  for (const value of values) maximum = Math.max(maximum, Math.abs(value));
  return maximum;
}

function maximumVector2Magnitude(values: Float64Array): number {
  let maximum = 1e-12;
  for (let index = 0; index + 1 < values.length; index += 2) {
    maximum = Math.max(maximum, Math.hypot(values[index]!, values[index + 1]!));
  }
  return maximum;
}
