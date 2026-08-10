import "./clebsch-surface.css";
import "katex/dist/katex.min.css";

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import katex from "katex";
import treefrogEigenbasisUrl from "../assets/treefrog-lb-eigenbasis.bin?url";
import treefrogUrl from "../assets/treefrog.obj?url";

import {
  parseFrogEigenbasis,
  parseFrogTriangleMesh,
} from "./frog-surface-fluid-model";
import {
  ControlledClebschSurfaceModel,
  type ClebschSurface,
  type ControlledClebschSample,
} from "./clebsch-surface-model";
import type { Vec3 } from "./random-surface-fluid-model";

type ConstructionStep = "labels" | "differentials" | "wedge" | "assemble" | "project";
type ScalarLayer = "alpha" | "beta" | "phi" | "vorticity" | "none";
type GlyphLayer = "dAlpha" | "dBeta" | "dPhi" | "alphaDBeta" | "velocity" | "none";
type VelocityView = "raw" | "projected";

const TAU = 2 * Math.PI;
const PLANE_WIDTH = 2.8;
const TORUS_MAJOR_RADIUS = 1.25;

function byId<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing #${id}.`);
  return value as T;
}

function renderLatex(element: HTMLElement, source: string, displayMode = false): void {
  katex.render(source, element, {
    displayMode,
    output: "htmlAndMathml",
    throwOnError: false,
  });
}

function renderStaticLatex(): void {
  for (const element of document.querySelectorAll<HTMLElement>("[data-latex]")) {
    renderLatex(element, element.dataset.latex!, element.classList.contains("cs-math-display"));
  }
}

function magnitude(vector: Vec3): number {
  return Math.hypot(vector.x, vector.y, vector.z);
}

function normalize(vector: Vec3): Vec3 {
  const length = magnitude(vector);
  return length > 1e-14
    ? { x: vector.x / length, y: vector.y / length, z: vector.z / length }
    : { x: 0, y: 0, z: 1 };
}

function format(value: number): string {
  if (Math.abs(value) < 5e-5) return "0.000";
  if (Math.abs(value) >= 100) return value.toExponential(2).replace("e-", "e−");
  return value.toFixed(3);
}

const [treefrogResponse, treefrogEigenbasisResponse] = await Promise.all([
  fetch(treefrogUrl),
  fetch(treefrogEigenbasisUrl),
]);
if (!treefrogResponse.ok) throw new Error(`Unable to load the tree-frog surface (${treefrogResponse.status}).`);
if (!treefrogEigenbasisResponse.ok) throw new Error(`Unable to load the tree-frog basis (${treefrogEigenbasisResponse.status}).`);
const frogMesh = parseFrogTriangleMesh(await treefrogResponse.text());
const frogEigenbasis = parseFrogEigenbasis(
  await treefrogEigenbasisResponse.arrayBuffer(),
  frogMesh.positions.length / 3,
);

const viewer = byId<HTMLDivElement>("cs-viewer");
const controls = {
  crossing: byId<HTMLInputElement>("cs-crossing"),
  label: byId<HTMLInputElement>("cs-label"),
  potential: byId<HTMLInputElement>("cs-potential"),
};
const outputs = {
  crossing: byId<HTMLOutputElement>("cs-crossing-output"),
  label: byId<HTMLOutputElement>("cs-label-output"),
  potential: byId<HTMLOutputElement>("cs-potential-output"),
};

let surface: ClebschSurface = "plane";
let constructionStep: ConstructionStep = "labels";
let scalarLayer: ScalarLayer = "alpha";
let glyphLayer: GlyphLayer = "dAlpha";
let velocityView: VelocityView = "raw";
let model = new ControlledClebschSurfaceModel({}, frogMesh, frogEigenbasis);
let surfaceGeometry: THREE.BufferGeometry;
let surfaceMesh: THREE.Mesh;
let vertexSamples: ControlledClebschSample[] = [];
let probeSample = model.sampleParameter("plane", 0.19 * TAU, 0.31 * TAU);
let probeDescription = "u = 0.19 · v = 0.31";

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d081f);
scene.fog = new THREE.FogExp2(0x0d081f, 0.07);

const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 100);
camera.position.set(0.15, -0.2, 4.55);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
viewer.prepend(renderer.domElement);

const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;
orbit.dampingFactor = 0.055;
orbit.enablePan = false;
orbit.minDistance = 2.4;
orbit.maxDistance = 7.4;

scene.add(new THREE.HemisphereLight(0xb8f4ff, 0x2b1643, 1.55));
const keyLight = new THREE.DirectionalLight(0xffd5b9, 2.7);
keyLight.position.set(3, 4, 5);
scene.add(keyLight);
const rimLight = new THREE.DirectionalLight(0x59e3ef, 2.2);
rimLight.position.set(-4, 0, -2);
scene.add(rimLight);

const surfaceGroup = new THREE.Group();
const glyphGroup = new THREE.Group();
const probeGroup = new THREE.Group();
scene.add(surfaceGroup, glyphGroup, probeGroup);

function disposeMaterial(material: THREE.Material | THREE.Material[]): void {
  if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
  else material.dispose();
}

function clearGroup(group: THREE.Group): void {
  for (const child of [...group.children]) {
    group.remove(child);
    const drawable = child as THREE.Mesh | THREE.LineSegments | THREE.Points;
    drawable.geometry?.dispose();
    if (drawable.material) disposeMaterial(drawable.material);
  }
}

function sampleGeometryVertex(
  positions: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  uvs: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined,
  index: number,
): ControlledClebschSample {
  const point = { x: positions.getX(index), y: positions.getY(index), z: positions.getZ(index) };
  if (surface === "frog") return model.sampleFrogVertex(index);
  if (surface === "sphere") return model.sampleSphere(point);
  return model.sampleParameter(surface, TAU * uvs!.getX(index), TAU * uvs!.getY(index));
}

function makeSurfaceGeometry(): THREE.BufferGeometry {
  if (surface === "frog") {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(Float32Array.from(frogMesh.positions), 3));
    geometry.setIndex(new THREE.BufferAttribute(frogMesh.faces, 1));
    geometry.setAttribute("normal", new THREE.BufferAttribute(Float32Array.from(frogMesh.vertexNormals), 3));
    return geometry;
  }
  if (surface === "sphere") return new THREE.SphereGeometry(1, 56, 34);
  if (surface === "torus") return new THREE.TorusGeometry(1.25, 0.46, 34, 72);
  return new THREE.PlaneGeometry(PLANE_WIDTH, PLANE_WIDTH, 34, 34);
}

function rebuildSurface(): void {
  clearGroup(surfaceGroup);
  surfaceGeometry = makeSurfaceGeometry();
  const positions = surfaceGeometry.getAttribute("position");
  const uvs = surfaceGeometry.getAttribute("uv");
  vertexSamples = Array.from({ length: positions.count }, (_, index) => sampleGeometryVertex(positions, uvs, index));
  surfaceGeometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(positions.count * 3), 3));
  surfaceMesh = new THREE.Mesh(surfaceGeometry, new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    vertexColors: true,
    emissive: surface === "frog" ? 0x063d20 : 0x11132d,
    emissiveIntensity: surface === "frog" ? 0.48 : 0.32,
    roughness: 0.52,
    metalness: 0.03,
    side: THREE.DoubleSide,
  }));
  surfaceGroup.add(surfaceMesh);
  const wire = new THREE.LineSegments(
    new THREE.WireframeGeometry(surfaceGeometry),
    new THREE.LineBasicMaterial({
      color: surface === "frog" ? 0x75d88c : 0x8edbe4,
      transparent: true,
      opacity: surface === "frog" ? 0.08 : surface === "plane" ? 0.22 : 0.12,
    }),
  );
  wire.renderOrder = 2;
  surfaceGroup.add(wire);
  resetProbe();
  updateSceneLayers();
}

function scalarValue(sample: ControlledClebschSample): number {
  if (scalarLayer === "alpha") return sample.alpha;
  if (scalarLayer === "beta") return sample.beta;
  if (scalarLayer === "phi") return sample.phi;
  if (scalarLayer === "vorticity") return sample.vorticity;
  return 0;
}

function scalarColor(value: number, maximum: number): THREE.Color {
  const negative = new THREE.Color(0x59e3ef);
  const neutral = new THREE.Color(0x281a46);
  const positive = new THREE.Color(0xff7a3d);
  const normalized = Math.max(-1, Math.min(1, value / Math.max(1e-12, maximum)));
  return normalized < 0
    ? neutral.lerp(negative, Math.sqrt(-normalized))
    : neutral.lerp(positive, Math.sqrt(normalized));
}

function glyphVector(sample: ControlledClebschSample): Vec3 {
  if (glyphLayer === "dAlpha") return sample.dAlpha;
  if (glyphLayer === "dBeta") return sample.dBeta;
  if (glyphLayer === "dPhi") return sample.dPhi;
  if (glyphLayer === "alphaDBeta") return sample.alphaDBeta;
  if (glyphLayer === "velocity") return velocityView === "projected" ? sample.projectedVelocity : sample.velocity;
  return { x: 0, y: 0, z: 0 };
}

function updateVertexColors(): void {
  const attribute = surfaceGeometry.getAttribute("color") as THREE.BufferAttribute;
  const maximum = Math.max(1e-12, ...vertexSamples.map((sample) => Math.abs(scalarValue(sample))));
  const frogBase = new THREE.Color(0x116b3a);
  const surfaceBase = new THREE.Color(0x4a326f);
  for (let index = 0; index < vertexSamples.length; index += 1) {
    const color = scalarLayer === "none"
      ? (surface === "frog" ? frogBase : surfaceBase)
      : scalarColor(scalarValue(vertexSamples[index]!), maximum);
    attribute.setXYZ(index, color.r, color.g, color.b);
  }
  attribute.needsUpdate = true;
}

function updateGlyphs(): void {
  clearGroup(glyphGroup);
  if (glyphLayer === "none") return;
  const targetCount = surface === "frog" ? 430 : surface === "plane" ? 300 : 360;
  const stride = Math.max(1, Math.ceil(vertexSamples.length / targetCount));
  const selected = vertexSamples.filter((_, index) => index % stride === 0);
  const maximum = Math.max(1e-12, ...selected.map((sample) => magnitude(glyphVector(sample))));
  const positions = new Float32Array(selected.length * 6);
  const colors = new Float32Array(selected.length * 6);
  const base = new THREE.Color(0x59e3ef);
  const tip = new THREE.Color(glyphLayer === "velocity" ? 0xffd86d : 0xffa065);
  const lift = surface === "frog" ? 0.008 : surface === "plane" ? 0.014 : 0.018;
  selected.forEach((sample, index) => {
    const vector = glyphVector(sample);
    const speed = magnitude(vector);
    const direction = speed > 1e-14 ? normalize(vector) : { x: 0, y: 0, z: 0 };
    const length = speed > 1e-14 ? 0.035 + 0.16 * Math.sqrt(speed / maximum) : 0;
    const start = {
      x: sample.position.x + lift * sample.normal.x,
      y: sample.position.y + lift * sample.normal.y,
      z: sample.position.z + lift * sample.normal.z,
    };
    positions.set([
      start.x, start.y, start.z,
      start.x + length * direction.x, start.y + length * direction.y, start.z + length * direction.z,
    ], 6 * index);
    colors.set([0.45 * base.r, 0.45 * base.g, 0.45 * base.b, tip.r, tip.g, tip.b], 6 * index);
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
  }));
  lines.renderOrder = 3;
  glyphGroup.add(lines);
}

const scalarCaptions: Record<ScalarLayer, string> = {
  alpha: "α",
  beta: "β",
  phi: "φ",
  vorticity: "ω = ⋆(dα ∧ dβ)",
  none: "mesh",
};
const glyphCaptions: Record<GlyphLayer, string> = {
  dAlpha: "(dα)♯",
  dBeta: "(dβ)♯",
  dPhi: "(dφ)♯",
  alphaDBeta: "(αdβ)♯",
  velocity: "velocity",
  none: "none",
};

function updateSceneLayers(): void {
  updateVertexColors();
  updateGlyphs();
  byId("cs-layer-caption").textContent = `color: ${scalarCaptions[scalarLayer]} · arrows: ${glyphCaptions[glyphLayer]}`;
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-cs-scalar]")) {
    button.classList.toggle("active", button.dataset.csScalar === scalarLayer);
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-cs-glyph]")) {
    button.classList.toggle("active", button.dataset.csGlyph === glyphLayer);
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-cs-velocity]")) {
    const active = button.dataset.csVelocity === velocityView;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  updateProbeCopy();
}

function updateProbeMarker(): void {
  clearGroup(probeGroup);
  const lift = surface === "frog" ? 0.016 : 0.025;
  const point = new THREE.Vector3(
    probeSample.position.x + lift * probeSample.normal.x,
    probeSample.position.y + lift * probeSample.normal.y,
    probeSample.position.z + lift * probeSample.normal.z,
  );
  const marker = new THREE.Mesh(
    new THREE.SphereGeometry(surface === "frog" ? 0.035 : 0.045, 16, 10),
    new THREE.MeshBasicMaterial({ color: 0xff7a3d, depthTest: false }),
  );
  marker.position.copy(point);
  marker.renderOrder = 8;
  probeGroup.add(marker);
}

function updateProbeCopy(): void {
  byId("cs-probe-location").textContent = probeDescription;
  byId("cs-probe-alpha").textContent = format(probeSample.alpha);
  byId("cs-probe-beta").textContent = format(probeSample.beta);
  byId("cs-probe-phi").textContent = format(probeSample.phi);
  byId("cs-probe-vorticity").textContent = format(probeSample.vorticity);
  const raw = magnitude(probeSample.velocity);
  const removed = magnitude(probeSample.divergentVelocity);
  const labelAngle = Math.round(90 * Number(controls.crossing.value));
  byId("cs-probe-reading").textContent = velocityView === "projected"
    ? `The resolved Hodge reconstruction changes the velocity by ${format(removed)} here. Its coexact speed is ${format(magnitude(probeSample.projectedVelocity))}; resolved curl is retained while exact source/sink motion is removed.`
    : `The label crossing control is ${labelAngle}°. Raw speed is ${format(raw)}; Clebsch form alone does not force its divergence to vanish.`;
  updateProbeMarker();
}

function resetProbe(): void {
  if (surface === "frog") {
    const vertex = Math.min(4300, frogMesh.positions.length / 3 - 1);
    probeSample = model.sampleFrogVertex(vertex);
    probeDescription = `frog vertex ${vertex.toLocaleString()}`;
  } else if (surface === "sphere") {
    probeSample = model.sampleSphere({ x: 0.55, y: -0.22, z: 0.81 });
    probeDescription = "sphere point · intrinsic tangent plane";
  } else {
    probeSample = model.sampleParameter(surface, 0.19 * TAU, 0.31 * TAU);
    probeDescription = "u = 0.19 · v = 0.31";
  }
}

const stepCopy: Record<ConstructionStep, { kicker: string; equation: string; copy: string }> = {
  labels: {
    kicker: "STEP 01 · LABELS",
    equation: String.raw`\alpha,\beta\in\Omega^0(S)`,
    copy: "A scalar assigns one number to each surface point. Its contour lines are not flow lines yet.",
  },
  differentials: {
    kicker: "STEP 02 · DIFFERENTIALS",
    equation: String.raw`d\alpha(v)=v[\alpha],\qquad d\beta(v)=v[\beta]`,
    copy: "A differential is a covector: feed it a tangent displacement and it reports directional change.",
  },
  wedge: {
    kicker: "STEP 03 · VORTICITY",
    equation: String.raw`\omega\,dA=d\alpha\wedge d\beta`,
    copy: "The wedge is signed area in label space. It vanishes when the two label changes are parallel.",
  },
  assemble: {
    kicker: "STEP 04 · ASSEMBLY",
    equation: String.raw`u^\flat=d\phi+\alpha\,d\beta`,
    copy: "The velocity is first assembled as a one-form. The metric raises its index to make the tangent arrow u.",
  },
  project: {
    kicker: "STEP 05 · HODGE PROJECTION",
    equation: String.raw`\Delta p=\delta u^\flat,\qquad u_\perp^\flat=u^\flat-dp`,
    copy: "Solve for the exact source/sink component and subtract it. Since d(dp)=0, the resolved vorticity is unchanged.",
  },
};

function activateStep(step: ConstructionStep): void {
  constructionStep = step;
  if (step === "labels") {
    scalarLayer = "alpha";
    glyphLayer = "none";
  } else if (step === "differentials") {
    scalarLayer = "beta";
    glyphLayer = "dAlpha";
  } else if (step === "wedge") {
    scalarLayer = "vorticity";
    glyphLayer = "dBeta";
  } else if (step === "assemble") {
    scalarLayer = "phi";
    glyphLayer = "velocity";
    velocityView = "raw";
  } else {
    scalarLayer = "vorticity";
    glyphLayer = "velocity";
    velocityView = "projected";
  }
  const copy = stepCopy[step];
  byId("cs-step-kicker").textContent = copy.kicker;
  renderLatex(byId("cs-step-equation"), copy.equation, true);
  byId("cs-step-copy").textContent = copy.copy;
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-cs-step]")) {
    button.classList.toggle("active", button.dataset.csStep === step);
  }
  for (const card of document.querySelectorAll<HTMLElement>("[data-cs-diagram]")) {
    card.classList.toggle("active", card.dataset.csDiagram === step);
  }
  updateSceneLayers();
}

function updateControlOutputs(): void {
  outputs.crossing.value = `${Math.round(90 * Number(controls.crossing.value))}°`;
  outputs.label.value = Number(controls.label.value).toFixed(2);
  outputs.potential.value = Number(controls.potential.value).toFixed(2);
}

function rebuildSamples(): void {
  model.reset({
    crossing: Number(controls.crossing.value),
    labelStrength: Number(controls.label.value),
    potentialStrength: Number(controls.potential.value),
  });
  const positions = surfaceGeometry.getAttribute("position");
  const uvs = surfaceGeometry.getAttribute("uv");
  vertexSamples = Array.from({ length: positions.count }, (_, index) => sampleGeometryVertex(positions, uvs, index));
  resetProbe();
  updateSceneLayers();
}

function setSurface(next: ClebschSurface): void {
  surface = next;
  if (surface === "plane") camera.position.set(0.15, -0.2, 4.55);
  else if (surface === "frog") camera.position.set(0.15, -0.1, 6.7);
  else camera.position.set(2.9, 1.8, 3.4);
  orbit.target.set(0, 0, 0);
  orbit.update();
  byId("cs-stage-title").textContent = surface === "plane"
    ? "periodic plane · two crossing label foliations"
    : surface === "frog"
      ? "tree frog · scalar Laplace–Beltrami modes"
      : `${surface} · intrinsic differentials and metric duals`;
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-cs-surface]")) {
    const active = button.dataset.csSurface === surface;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  rebuildSurface();
}

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-cs-surface]")) {
  button.addEventListener("click", () => setSurface(button.dataset.csSurface as ClebschSurface));
}
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-cs-step]")) {
  button.addEventListener("click", () => activateStep(button.dataset.csStep as ConstructionStep));
}
for (const card of document.querySelectorAll<HTMLElement>("[data-cs-diagram]")) {
  card.addEventListener("click", () => activateStep(card.dataset.csDiagram as ConstructionStep));
}
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-cs-scalar]")) {
  button.addEventListener("click", () => {
    scalarLayer = button.dataset.csScalar as ScalarLayer;
    updateSceneLayers();
  });
}
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-cs-glyph]")) {
  button.addEventListener("click", () => {
    glyphLayer = button.dataset.csGlyph as GlyphLayer;
    updateSceneLayers();
  });
}
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-cs-velocity]")) {
  button.addEventListener("click", () => {
    velocityView = button.dataset.csVelocity as VelocityView;
    glyphLayer = "velocity";
    updateSceneLayers();
  });
}
for (const input of Object.values(controls)) {
  input.addEventListener("input", () => {
    updateControlOutputs();
    rebuildSamples();
  });
}

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let pointerStart = { x: 0, y: 0 };
renderer.domElement.addEventListener("pointerdown", (event) => {
  pointerStart = { x: event.clientX, y: event.clientY };
});
renderer.domElement.addEventListener("pointerup", (event) => {
  if (Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 5) return;
  const bounds = renderer.domElement.getBoundingClientRect();
  pointer.set(
    2 * (event.clientX - bounds.left) / bounds.width - 1,
    1 - 2 * (event.clientY - bounds.top) / bounds.height,
  );
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObject(surfaceMesh, false)[0];
  if (!hit) return;
  const point = { x: hit.point.x, y: hit.point.y, z: hit.point.z };
  if (surface === "plane") {
    const u = TAU * (point.x / PLANE_WIDTH + 0.5);
    const v = TAU * (point.y / PLANE_WIDTH + 0.5);
    probeSample = model.sampleParameter("plane", u, v);
    probeDescription = `u = ${(u / TAU).toFixed(2)} · v = ${(v / TAU).toFixed(2)}`;
  } else if (surface === "sphere") {
    probeSample = model.sampleSphere(point);
    probeDescription = `sphere · (${point.x.toFixed(2)}, ${point.y.toFixed(2)}, ${point.z.toFixed(2)})`;
  } else if (surface === "torus") {
    const u = Math.atan2(point.y, point.x);
    const v = Math.atan2(point.z, Math.hypot(point.x, point.y) - TORUS_MAJOR_RADIUS);
    probeSample = model.sampleParameter("torus", u, v);
    probeDescription = `u = ${((((u / TAU) % 1) + 1) % 1).toFixed(2)} · v = ${((((v / TAU) % 1) + 1) % 1).toFixed(2)}`;
  } else {
    const index = surfaceGeometry.index;
    const face = hit.faceIndex ?? 0;
    const candidates = index
      ? [index.getX(3 * face), index.getX(3 * face + 1), index.getX(3 * face + 2)]
      : [3 * face, 3 * face + 1, 3 * face + 2];
    const positions = surfaceGeometry.getAttribute("position");
    let vertex = candidates[0]!;
    let distance = Infinity;
    for (const candidate of candidates) {
      const candidateDistance = Math.hypot(
        positions.getX(candidate) - point.x,
        positions.getY(candidate) - point.y,
        positions.getZ(candidate) - point.z,
      );
      if (candidateDistance < distance) {
        vertex = candidate;
        distance = candidateDistance;
      }
    }
    probeSample = model.sampleFrogVertex(vertex);
    probeDescription = `frog vertex ${vertex.toLocaleString()}`;
  }
  updateProbeCopy();
});

function resizeRenderer(): void {
  const width = Math.max(1, viewer.clientWidth);
  const height = Math.max(1, viewer.clientHeight);
  const targetWidth = Math.round(width * renderer.getPixelRatio());
  const targetHeight = Math.round(height * renderer.getPixelRatio());
  if (renderer.domElement.width !== targetWidth || renderer.domElement.height !== targetHeight) {
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
}

function animate(): void {
  requestAnimationFrame(animate);
  resizeRenderer();
  orbit.update();
  renderer.render(scene, camera);
}

new ResizeObserver(resizeRenderer).observe(viewer);
renderStaticLatex();
updateControlOutputs();
rebuildSurface();
activateStep("labels");
animate();
