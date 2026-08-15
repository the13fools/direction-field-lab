import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import treefrogEigenbasisUrl from "../assets/treefrog-lb-eigenbasis.bin?url";
import treefrogUrl from "../assets/treefrog.obj?url";
import {
  FrogSurfaceFluidModel,
  parseFrogEigenbasis,
  parseFrogTriangleMesh,
} from "./frog-surface-fluid-model";
import { FrogShallowWaterPreviewModel } from "./frog-shallow-water-preview-model";
import type { Vec3 } from "./random-surface-fluid-model";

export type MeshFlowMode = "random" | "water";

export interface MeshFlowPreviewController {
  setMode(mode: MeshFlowMode): void;
  setPlaying(playing: boolean): void;
  setVisible(visible: boolean): void;
  reset(): void;
}

interface Trail {
  points: Vec3[];
  group: 0 | 1;
}

const FROG_PARTICLE_COUNT = 5000;
const TRAIL_PARTICLE_LIMIT = 640;
const TRAIL_POINT_LIMIT = 20;

function vectorAt(values: ArrayLike<number>, index: number): Vec3 {
  return { x: values[3 * index]!, y: values[3 * index + 1]!, z: values[3 * index + 2]! };
}

function disposeObject(object: THREE.Object3D): void {
  const drawable = object as THREE.LineSegments | THREE.Points;
  drawable.geometry?.dispose();
  const material = drawable.material;
  if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
  else material?.dispose();
}

export async function initializeSolverStoriesMeshPreview(
  target: HTMLElement,
  onStatus: (label: string) => void,
): Promise<MeshFlowPreviewController> {
  const [meshResponse, basisResponse] = await Promise.all([
    fetch(treefrogUrl),
    fetch(treefrogEigenbasisUrl),
  ]);
  if (!meshResponse.ok || !basisResponse.ok) throw new Error("Unable to load the frog mesh preview.");
  const mesh = parseFrogTriangleMesh(await meshResponse.text());
  const basis = parseFrogEigenbasis(await basisResponse.arrayBuffer(), mesh.positions.length / 3);
  const makeRandomModel = (): FrogSurfaceFluidModel => new FrogSurfaceFluidModel(mesh, basis, {
      projection: "clebsch-projected",
      seed: 13,
      modeCount: 15,
      maxBand: 5,
      turnover: 0.34,
      speed: 0.56,
      timeStep: 0.018,
      particleCount: FROG_PARTICLE_COUNT,
    });
  let randomModel = makeRandomModel();
  const waterModel = new FrogShallowWaterPreviewModel(mesh, basis, FROG_PARTICLE_COUNT);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x071c21);
  scene.fog = new THREE.FogExp2(0x071c21, 0.07);
  const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 100);
  camera.position.set(0, 0, 6.7);
  camera.up.set(0, 1, 0);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  target.replaceChildren(renderer.domElement);

  const orbit = new OrbitControls(camera, renderer.domElement);
  orbit.enableDamping = true;
  orbit.dampingFactor = 0.055;
  orbit.enablePan = false;
  orbit.minDistance = 3;
  orbit.maxDistance = 7.2;
  orbit.target.set(0, 0, 0);

  scene.add(new THREE.HemisphereLight(0xb8fff1, 0x24153f, 1.55));
  const key = new THREE.DirectionalLight(0xffd4b5, 2.5);
  key.position.set(3, 4, 5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x4ce8ed, 2.1);
  rim.position.set(-4, 0, -2);
  scene.add(rim);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(Float32Array.from(mesh.positions), 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(Float32Array.from(mesh.vertexNormals), 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(mesh.positions.length), 3));
  geometry.setIndex(new THREE.BufferAttribute(mesh.faces, 1));
  const material = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    vertexColors: true,
    emissive: 0x06351d,
    emissiveIntensity: 0.52,
    roughness: 0.48,
    metalness: 0.02,
    side: THREE.DoubleSide,
  });
  scene.add(new THREE.Mesh(geometry, material));
  const wire = new THREE.LineSegments(
    new THREE.WireframeGeometry(geometry),
    new THREE.LineBasicMaterial({ color: 0x86efa0, transparent: true, opacity: 0.1 }),
  );
  wire.renderOrder = 2;
  scene.add(wire);

  const overlay = new THREE.Group();
  scene.add(overlay);
  let fieldLines: THREE.LineSegments | undefined;
  let particlePoints: THREE.Points | undefined;
  let trailLines: THREE.LineSegments | undefined;
  let trails: Trail[] = [];
  let mode: MeshFlowMode = "random";
  let playing = true;
  let visible = true;
  let previous = performance.now();
  let frameCount = 0;

  const positions = mesh.positions;
  const normals = mesh.vertexNormals;
  const vertexStride = Math.ceil(mesh.positions.length / 3 / 280);
  const readableVertices = Array.from(
    { length: Math.ceil(mesh.positions.length / 3 / vertexStride) },
    (_, index) => index * vertexStride,
  ).filter((vertex) => vertex < mesh.positions.length / 3);

  const updateSurface = (): void => {
    const colors = geometry.getAttribute("color") as THREE.BufferAttribute;
    if (mode === "random") {
      const base = new THREE.Color(0x1aa756);
      for (let vertex = 0; vertex < colors.count; vertex += 1) {
        const light = 0.82 + 0.18 * Math.max(0, normals[3 * vertex + 2]!);
        colors.setXYZ(vertex, light * base.r, light * base.g, light * base.b);
      }
      material.emissive.setHex(0x06351d);
    } else {
      const state = waterModel.stateAt();
      const warm = new THREE.Color(0xd9f45f);
      const cool = new THREE.Color(0x25d2d5);
      const neutral = new THREE.Color(0x11924f);
      for (let vertex = 0; vertex < colors.count; vertex += 1) {
        const displacement = state.height[vertex]! - waterModel.meanDepth;
        const amount = Math.min(1, Math.abs(displacement) / 0.075);
        const source = displacement >= 0 ? warm : cool;
        const blend = 0.72 * Math.sqrt(amount);
        colors.setXYZ(
          vertex,
          neutral.r + blend * (source.r - neutral.r),
          neutral.g + blend * (source.g - neutral.g),
          neutral.b + blend * (source.b - neutral.b),
        );
      }
      material.emissive.setHex(0x063d27);
    }
    colors.needsUpdate = true;
  };

  const currentVelocity = (vertex: number): Vec3 => {
    if (mode === "random") return randomModel.velocitySampleAtVertex(vectorAt(positions, vertex)).velocity;
    return vectorAt(waterModel.stateAt().vertexVelocity, vertex);
  };

  const rebuildField = (): void => {
    if (fieldLines) {
      overlay.remove(fieldLines);
      disposeObject(fieldLines);
    }
    const samples = readableVertices.map((vertex) => ({ vertex, velocity: currentVelocity(vertex) }));
    const maximum = Math.max(1e-12, ...samples.map(({ velocity }) => Math.hypot(velocity.x, velocity.y, velocity.z)));
    const linePositions = new Float32Array(samples.length * 6);
    const lineColors = new Float32Array(samples.length * 6);
    const cyan = new THREE.Color(0x59e3ef);
    const gold = new THREE.Color(0xffd26a);
    samples.forEach(({ vertex, velocity }, index) => {
      const normal = vectorAt(normals, vertex);
      const point = vectorAt(positions, vertex);
      const speed = Math.hypot(velocity.x, velocity.y, velocity.z);
      const inverse = speed > 1e-14 ? 1 / speed : 0;
      const length = 0.055 + 0.14 * Math.sqrt(speed / maximum);
      const start = {
        x: point.x + 0.009 * normal.x,
        y: point.y + 0.009 * normal.y,
        z: point.z + 0.009 * normal.z,
      };
      linePositions.set([
        start.x, start.y, start.z,
        start.x + length * inverse * velocity.x,
        start.y + length * inverse * velocity.y,
        start.z + length * inverse * velocity.z,
      ], 6 * index);
      const tip = cyan.clone().lerp(gold, Math.sqrt(speed / maximum));
      lineColors.set([0.3 * cyan.r, 0.3 * cyan.g, 0.3 * cyan.b, tip.r, tip.g, tip.b], 6 * index);
    });
    const lineGeometry = new THREE.BufferGeometry();
    lineGeometry.setAttribute("position", new THREE.BufferAttribute(linePositions, 3));
    lineGeometry.setAttribute("color", new THREE.BufferAttribute(lineColors, 3));
    fieldLines = new THREE.LineSegments(
      lineGeometry,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    fieldLines.renderOrder = 4;
    overlay.add(fieldLines);
  };

  const particlePosition = (index: number): Vec3 => {
    if (mode === "random") return randomModel.particlePosition(randomModel.particles[index]!);
    return waterModel.particlePosition(waterModel.particles[index]!);
  };

  const particleCount = (): number => mode === "random" ? randomModel.particles.length : waterModel.particles.length;

  const rebuildParticles = (): void => {
    for (const object of [particlePoints, trailLines]) {
      if (!object) continue;
      overlay.remove(object);
      disposeObject(object);
    }
    const count = particleCount();
    const pointGeometry = new THREE.BufferGeometry();
    pointGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    const colors = new Float32Array(count * 3);
    const warm = new THREE.Color(0xff8a4d);
    const cool = new THREE.Color(0x62edf1);
    trails = Array.from({ length: Math.min(count, TRAIL_PARTICLE_LIMIT) }, (_, index) => ({
      points: [particlePosition(index)],
      group: (index % 2) as 0 | 1,
    }));
    for (let index = 0; index < count; index += 1) {
      const color = index % 2 === 0 ? warm : cool;
      colors.set([color.r, color.g, color.b], 3 * index);
    }
    pointGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    particlePoints = new THREE.Points(
      pointGeometry,
      new THREE.PointsMaterial({
        size: 0.018,
        sizeAttenuation: true,
        vertexColors: true,
        transparent: true,
        opacity: 0.96,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    particlePoints.renderOrder = 6;
    overlay.add(particlePoints);
    trailLines = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.52,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    trailLines.renderOrder = 5;
    overlay.add(trailLines);
    updateParticles(false);
  };

  const updateParticles = (append: boolean): void => {
    if (!particlePoints || !trailLines) return;
    const pointPositions = particlePoints.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let index = 0; index < particleCount(); index += 1) {
      const point = particlePosition(index);
      pointPositions.setXYZ(index, point.x, point.y, point.z);
      if (append && index < trails.length) {
        trails[index]!.points.push(point);
        if (trails[index]!.points.length > TRAIL_POINT_LIMIT) trails[index]!.points.shift();
      }
    }
    pointPositions.needsUpdate = true;
    const segments = trails.reduce((sum, trail) => sum + Math.max(0, trail.points.length - 1), 0);
    const segmentPositions = new Float32Array(segments * 6);
    const segmentColors = new Float32Array(segments * 6);
    const warm = new THREE.Color(0xff8a4d);
    const cool = new THREE.Color(0x62edf1);
    let cursor = 0;
    trails.forEach((trail) => {
      const color = trail.group === 0 ? warm : cool;
      for (let index = 1; index < trail.points.length; index += 1) {
        const start = trail.points[index - 1]!;
        const end = trail.points[index]!;
        const fade = index / Math.max(1, trail.points.length - 1);
        segmentPositions.set([start.x, start.y, start.z, end.x, end.y, end.z], 6 * cursor);
        segmentColors.set([
          0.16 * fade * color.r, 0.16 * fade * color.g, 0.16 * fade * color.b,
          fade * color.r, fade * color.g, fade * color.b,
        ], 6 * cursor);
        cursor += 1;
      }
    });
    trailLines.geometry.dispose();
    trailLines.geometry = new THREE.BufferGeometry();
    trailLines.geometry.setAttribute("position", new THREE.BufferAttribute(segmentPositions, 3));
    trailLines.geometry.setAttribute("color", new THREE.BufferAttribute(segmentColors, 3));
  };

  const rebuild = (): void => {
    updateSurface();
    rebuildField();
    rebuildParticles();
  };

  const resize = (): void => {
    const width = Math.max(1, target.clientWidth);
    const height = Math.max(1, target.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(target);
  resize();
  rebuild();

  const frame = (now: number): void => {
    const elapsed = Math.min(0.04, Math.max(0, (now - previous) / 1000));
    previous = now;
    if (visible && playing) {
      if (frameCount % 2 === 0) {
        if (mode === "random") randomModel.step(1);
        else waterModel.step(Math.min(0.006, 0.16 * elapsed));
        updateParticles(true);
      }
      if (frameCount % 4 === 0) {
        updateSurface();
        rebuildField();
      }
      if (frameCount % 12 === 0) {
        onStatus(mode === "random"
          ? "t " + randomModel.time.toFixed(2) + " · 5,000 particles · frog LB field"
          : "t " + waterModel.time.toFixed(2) + " · mass drift " + waterModel.massDrift().toExponential(1)
            + " · continuity " + waterModel.continuityResidualRms().toExponential(1)
            + " · LB packet 4–32 · 5,000 particles");
      }
    }
    orbit.update();
    if (visible) renderer.render(scene, camera);
    frameCount += 1;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  return {
    setMode(nextMode) {
      if (mode === nextMode) return;
      mode = nextMode;
      rebuild();
    },
    setPlaying(nextPlaying) {
      playing = nextPlaying;
    },
    setVisible(nextVisible) {
      visible = nextVisible;
      if (visible) {
        resize();
        rebuild();
      }
    },
    reset() {
      if (mode === "random") randomModel = makeRandomModel();
      else waterModel.reset();
      rebuild();
    },
  };
}
