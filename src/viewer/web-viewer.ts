import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

export class WebViewer {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(42, 1, 0.01, 2000);
  private readonly renderer = new THREE.WebGLRenderer({ antialias: true });
  private readonly controls: OrbitControls;
  private points?: THREE.Points;
  private lines?: THREE.LineSegments;
  private fieldLines?: THREE.LineSegments;
  private center = new THREE.Vector2();
  private positions2d = new Float64Array();
  private edgeIndices = new Int32Array();
  private gridSize = 0;
  private restLength = 1;
  private periodic = false;

  constructor(private readonly container: HTMLElement) {
    this.scene.background = new THREE.Color(0x07120f);
    this.camera.position.set(0, 0, 18);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.container.append(this.renderer.domElement);
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
    this.center.set(0.5 * (gridSize - 1) * restLength, 0.5 * (gridSize - 1) * restLength);
    const xyz = this.toXYZ(positions);
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
  }

  update(positions: Float64Array): void {
    if (!this.points || !this.lines) return;
    const xyz = this.toXYZ(positions);
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

  showEdgeField(values: Float64Array, color: number): void {
    if (values.length * 2 !== this.edgeIndices.length) return;
    this.removeField();
    const maxAbs = Math.max(1e-12, ...Array.from(values, Math.abs));
    const scale = 0.72 * this.restLength / maxAbs;
    const period = this.gridSize * this.restLength;
    const segments = new Float32Array(values.length * 18);
    for (let edge = 0; edge < values.length; edge += 1) {
      const tail = this.edgeIndices[edge * 2]!;
      const head = this.edgeIndices[edge * 2 + 1]!;
      let x0 = this.positions2d[tail * 2]! - this.center.x;
      let y0 = this.positions2d[tail * 2 + 1]! - this.center.y;
      let dx = this.positions2d[head * 2]! - this.positions2d[tail * 2]!;
      let dy = this.positions2d[head * 2 + 1]! - this.positions2d[tail * 2 + 1]!;
      if (this.periodic) {
        if (dx > period * 0.5) dx -= period;
        if (dx < -period * 0.5) dx += period;
        if (dy > period * 0.5) dy -= period;
        if (dy < -period * 0.5) dy += period;
      }
      const length = Math.max(1e-12, Math.hypot(dx, dy));
      let midX = x0 + dx * 0.5;
      let midY = y0 + dy * 0.5;
      if (this.periodic) {
        midX = this.wrap(midX, period);
        midY = this.wrap(midY, period);
      }
      const magnitude = scale * Math.abs(values[edge]!);
      const sign = Math.sign(values[edge]!) || 1;
      const ux = sign * dx / length;
      const uy = sign * dy / length;
      const tailX = midX - 0.5 * magnitude * ux;
      const tailY = midY - 0.5 * magnitude * uy;
      const tipX = midX + 0.5 * magnitude * ux;
      const tipY = midY + 0.5 * magnitude * uy;
      const wing = Math.min(0.18 * this.restLength, 0.35 * magnitude);
      const baseX = tipX - wing * ux;
      const baseY = tipY - wing * uy;
      const perpX = -uy * wing * 0.45;
      const perpY = ux * wing * 0.45;
      const offset = edge * 18;
      const writeSegment = (slot: number, ax: number, ay: number, bx: number, by: number) => {
        const index = offset + slot * 6;
        segments[index] = ax;
        segments[index + 1] = ay;
        segments[index + 2] = 0.025;
        segments[index + 3] = bx;
        segments[index + 4] = by;
        segments[index + 5] = 0.025;
      };
      writeSegment(0, tailX, tailY, tipX, tipY);
      writeSegment(1, tipX, tipY, baseX + perpX, baseY + perpY);
      writeSegment(2, tipX, tipY, baseX - perpX, baseY - perpY);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(segments, 3));
    this.fieldLines = new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.98 }),
    );
    this.scene.add(this.fieldLines);
  }

  currentPositions(): number[] {
    if (!this.points) return [];
    return Array.from(this.points.geometry.attributes.position!.array);
  }

  currentEdges(): number[] {
    return Array.from(this.edgeIndices);
  }

  clear(): void {
    for (const object of [this.points, this.lines, this.fieldLines]) {
      if (!object) continue;
      this.scene.remove(object);
      object.geometry.dispose();
      if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
      else object.material.dispose();
    }
    this.points = undefined;
    this.lines = undefined;
    this.fieldLines = undefined;
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
    if (!this.periodic) {
      geometry.setAttribute("position", new THREE.BufferAttribute(xyz.slice(), 3));
      geometry.setIndex(Array.from(edges));
      return geometry;
    }
    const visible: number[] = [];
    const cutoff = 1.5 * this.restLength;
    for (let edge = 0; edge < edges.length / 2; edge += 1) {
      const a = edges[edge * 2]!;
      const b = edges[edge * 2 + 1]!;
      const dx = this.positions2d[a * 2]! - this.positions2d[b * 2]!;
      const dy = this.positions2d[a * 2 + 1]! - this.positions2d[b * 2 + 1]!;
      if (Math.hypot(dx, dy) <= cutoff) visible.push(a, b);
    }
    geometry.setAttribute("position", new THREE.BufferAttribute(xyz.slice(), 3));
    geometry.setIndex(visible);
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

  private wrap(value: number, period: number): number {
    const half = period * 0.5;
    return ((value + half) % period + period) % period - half;
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
