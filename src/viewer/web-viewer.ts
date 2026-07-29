import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

export class WebViewer {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(42, 1, 0.01, 2000);
  private readonly renderer = new THREE.WebGLRenderer({ antialias: true });
  private readonly controls: OrbitControls;
  private points?: THREE.Points;
  private lines?: THREE.LineSegments;
  private center = new THREE.Vector2();

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

  initialize(positions: Float64Array, edges: Int32Array, gridSize: number, restLength: number): void {
    this.clear();
    this.center.set(0.5 * (gridSize - 1) * restLength, 0.5 * (gridSize - 1) * restLength);
    const xyz = this.toXYZ(positions);
    const pointGeometry = new THREE.BufferGeometry();
    pointGeometry.setAttribute("position", new THREE.BufferAttribute(xyz, 3));
    this.points = new THREE.Points(
      pointGeometry,
      new THREE.PointsMaterial({ color: 0xdffc5b, size: Math.max(0.07, restLength * 0.13) }),
    );
    const lineGeometry = new THREE.BufferGeometry();
    lineGeometry.setAttribute("position", new THREE.BufferAttribute(xyz.slice(), 3));
    lineGeometry.setIndex(Array.from(edges));
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
    const pointPositions = this.points.geometry.getAttribute("position") as THREE.BufferAttribute;
    const linePositions = this.lines.geometry.getAttribute("position") as THREE.BufferAttribute;
    pointPositions.copyArray(xyz);
    pointPositions.needsUpdate = true;
    linePositions.copyArray(xyz);
    linePositions.needsUpdate = true;
  }

  currentPositions(): number[] {
    if (!this.points) return [];
    return Array.from(this.points.geometry.attributes.position!.array);
  }

  currentEdges(): number[] {
    return this.lines?.geometry.index ? Array.from(this.lines.geometry.index.array) : [];
  }

  clear(): void {
    for (const object of [this.points, this.lines]) {
      if (!object) continue;
      this.scene.remove(object);
      object.geometry.dispose();
      if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
      else object.material.dispose();
    }
    this.points = undefined;
    this.lines = undefined;
  }

  private toXYZ(positions: Float64Array): Float32Array {
    const xyz = new Float32Array((positions.length / 2) * 3);
    for (let i = 0; i < positions.length / 2; i += 1) {
      xyz[i * 3] = positions[i * 2]! - this.center.x;
      xyz[i * 3 + 1] = positions[i * 2 + 1]! - this.center.y;
    }
    return xyz;
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
