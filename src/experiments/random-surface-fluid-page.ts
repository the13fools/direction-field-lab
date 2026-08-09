import "./random-surface-fluid.css";

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import {
  RandomSurfaceFluidModel,
  torusNormal,
  type FluidParticle,
  type RandomFluidSurface,
  type Vec3,
} from "./random-surface-fluid-model";

function byId<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing #${id}.`);
  return value as T;
}

const viewer = byId<HTMLDivElement>("random-fluid-viewer");
const playButton = byId<HTMLButtonElement>("fluid-play");
const vectorButton = byId<HTMLButtonElement>("fluid-vectors");
const trailButton = byId<HTMLButtonElement>("fluid-trails");
const spectrumCanvas = byId<HTMLCanvasElement>("fluid-spectrum");
const controls = {
  seed: byId<HTMLInputElement>("fluid-seed"),
  slope: byId<HTMLInputElement>("fluid-slope"),
  modes: byId<HTMLInputElement>("fluid-modes"),
  band: byId<HTMLInputElement>("fluid-band"),
  turnover: byId<HTMLInputElement>("fluid-turnover"),
  speed: byId<HTMLInputElement>("fluid-speed"),
  particles: byId<HTMLInputElement>("fluid-particles"),
};
const outputs = {
  slope: byId<HTMLOutputElement>("fluid-slope-output"),
  modes: byId<HTMLOutputElement>("fluid-modes-output"),
  band: byId<HTMLOutputElement>("fluid-band-output"),
  turnover: byId<HTMLOutputElement>("fluid-turnover-output"),
  speed: byId<HTMLOutputElement>("fluid-speed-output"),
  particles: byId<HTMLOutputElement>("fluid-particles-output"),
};

let surface: RandomFluidSurface = "sphere";
let model = readModel();
let playing = true;
let vectorsVisible = true;
let trailsVisible = true;
let frame = 0;
let trailHistory: Vec3[][] = [];

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d081f);
scene.fog = new THREE.FogExp2(0x0d081f, 0.075);

const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 100);
camera.position.set(2.8, 1.9, 3.5);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
viewer.prepend(renderer.domElement);

const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;
orbit.dampingFactor = 0.055;
orbit.enablePan = false;
orbit.minDistance = 2.5;
orbit.maxDistance = 7;

scene.add(new THREE.HemisphereLight(0xa9efff, 0x2b1643, 1.5));
const keyLight = new THREE.DirectionalLight(0xffd5ed, 2.6);
keyLight.position.set(3, 4, 5);
scene.add(keyLight);
const rimLight = new THREE.DirectionalLight(0x59e3ef, 2.1);
rimLight.position.set(-4, 0, -2);
scene.add(rimLight);

const surfaceGroup = new THREE.Group();
const fieldGroup = new THREE.Group();
const particleGroup = new THREE.Group();
scene.add(surfaceGroup, fieldGroup, particleGroup);

let particlePoints: THREE.Points | undefined;
let trailLines: THREE.LineSegments | undefined;
let fieldLines: THREE.LineSegments | undefined;

function readModel(): RandomSurfaceFluidModel {
  return new RandomSurfaceFluidModel({
    surface,
    seed: Math.trunc(Number(controls.seed.value)),
    modeCount: Math.round(Number(controls.modes.value)),
    maxBand: Math.round(Number(controls.band.value)),
    spectralSlope: Number(controls.slope.value),
    turnover: Number(controls.turnover.value),
    speed: Number(controls.speed.value),
    particleCount: Math.round(Number(controls.particles.value)),
  });
}

function updateControlOutputs(): void {
  outputs.slope.value = Number(controls.slope.value).toFixed(2);
  outputs.modes.value = String(Math.round(Number(controls.modes.value)));
  outputs.band.value = String(Math.round(Number(controls.band.value)));
  outputs.turnover.value = Number(controls.turnover.value).toFixed(2);
  outputs.speed.value = Number(controls.speed.value).toFixed(2);
  outputs.particles.value = String(Math.round(Number(controls.particles.value)));
}

function disposeMaterial(material: THREE.Material | THREE.Material[]): void {
  if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
  else material.dispose();
}

function clearGroup(group: THREE.Group): void {
  for (const child of [...group.children]) {
    group.remove(child);
    const candidate = child as THREE.Mesh | THREE.LineSegments | THREE.Points;
    candidate.geometry?.dispose();
    if (candidate.material) disposeMaterial(candidate.material);
  }
}

function rebuildSurface(): void {
  clearGroup(surfaceGroup);
  const geometry = surface === "sphere"
    ? new THREE.SphereGeometry(1, 56, 34)
    : new THREE.TorusGeometry(1.25, 0.46, 30, 72);
  const material = new THREE.MeshPhysicalMaterial({
    color: 0x3d2868,
    emissive: 0x111533,
    emissiveIntensity: 0.65,
    roughness: 0.55,
    metalness: 0.06,
    transparent: true,
    opacity: 0.9,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  surfaceGroup.add(mesh);

  const wire = new THREE.LineSegments(
    new THREE.WireframeGeometry(geometry),
    new THREE.LineBasicMaterial({
      color: 0x8edbe4,
      transparent: true,
      opacity: surface === "sphere" ? 0.09 : 0.11,
    }),
  );
  wire.renderOrder = 2;
  surfaceGroup.add(wire);
}

function renderPosition(particle: FluidParticle): Vec3 {
  const position = model.particlePosition(particle);
  if (particle.surface === "sphere") {
    return { x: 1.022 * position.x, y: 1.022 * position.y, z: 1.022 * position.z };
  }
  const normal = torusNormal(particle.u!, particle.v!);
  return {
    x: position.x + 0.022 * normal.x,
    y: position.y + 0.022 * normal.y,
    z: position.z + 0.022 * normal.z,
  };
}

function initializeParticles(): void {
  clearGroup(particleGroup);
  trailHistory = model.particles.map((particle) => [renderPosition(particle)]);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(model.particles.length * 3), 3));
  const colors = new Float32Array(model.particles.length * 3);
  const warm = new THREE.Color(0xff6fbd);
  const cool = new THREE.Color(0x59e3ef);
  model.particles.forEach((particle, index) => {
    const color = particle.group === 0 ? warm : cool;
    colors[3 * index] = color.r;
    colors[3 * index + 1] = color.g;
    colors[3 * index + 2] = color.b;
  });
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  particlePoints = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      size: surface === "sphere" ? 0.035 : 0.032,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 0.94,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  particlePoints.renderOrder = 5;
  particleGroup.add(particlePoints);

  trailLines = new THREE.LineSegments(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  trailLines.renderOrder = 4;
  trailLines.visible = trailsVisible;
  particleGroup.add(trailLines);
  updateParticles(false);
}

function updateParticles(appendTrail: boolean): void {
  if (!particlePoints || !trailLines) return;
  const positions = particlePoints.geometry.getAttribute("position") as THREE.BufferAttribute;
  model.particles.forEach((particle, index) => {
    const point = renderPosition(particle);
    positions.setXYZ(index, point.x, point.y, point.z);
    if (appendTrail) {
      const history = trailHistory[index]!;
      history.push(point);
      if (history.length > 20) history.shift();
    }
  });
  positions.needsUpdate = true;

  let segmentCount = 0;
  for (const history of trailHistory) segmentCount += Math.max(0, history.length - 1);
  const segmentPositions = new Float32Array(segmentCount * 6);
  const segmentColors = new Float32Array(segmentCount * 6);
  const warm = new THREE.Color(0xff6fbd);
  const cool = new THREE.Color(0x59e3ef);
  let cursor = 0;
  trailHistory.forEach((history, particleIndex) => {
    const base = model.particles[particleIndex]!.group === 0 ? warm : cool;
    for (let index = 1; index < history.length; index += 1) {
      const start = history[index - 1]!;
      const end = history[index]!;
      const strengthStart = 0.18 + 0.72 * (index - 1) / Math.max(1, history.length - 1);
      const strengthEnd = 0.18 + 0.72 * index / Math.max(1, history.length - 1);
      segmentPositions.set([start.x, start.y, start.z, end.x, end.y, end.z], cursor * 6);
      segmentColors.set([
        strengthStart * base.r, strengthStart * base.g, strengthStart * base.b,
        strengthEnd * base.r, strengthEnd * base.g, strengthEnd * base.b,
      ], cursor * 6);
      cursor += 1;
    }
  });
  trailLines.geometry.dispose();
  trailLines.geometry = new THREE.BufferGeometry();
  trailLines.geometry.setAttribute("position", new THREE.BufferAttribute(segmentPositions, 3));
  trailLines.geometry.setAttribute("color", new THREE.BufferAttribute(segmentColors, 3));
  trailLines.visible = trailsVisible;
}

function updateField(): void {
  clearGroup(fieldGroup);
  const samples = model.fieldSamples();
  const maxSpeed = Math.max(1e-12, ...samples.map((sample) => Math.hypot(
    sample.velocity.x,
    sample.velocity.y,
    sample.velocity.z,
  )));
  const positions = new Float32Array(samples.length * 6);
  const colors = new Float32Array(samples.length * 6);
  const cyan = new THREE.Color(0x59e3ef);
  const gold = new THREE.Color(0xffd86d);
  samples.forEach((sample, index) => {
    const speed = Math.hypot(sample.velocity.x, sample.velocity.y, sample.velocity.z);
    const amount = speed / maxSpeed;
    const length = 0.055 + 0.15 * Math.sqrt(amount);
    const inverse = speed > 1e-14 ? 1 / speed : 0;
    const end = {
      x: sample.position.x + length * inverse * sample.velocity.x,
      y: sample.position.y + length * inverse * sample.velocity.y,
      z: sample.position.z + length * inverse * sample.velocity.z,
    };
    positions.set([
      sample.position.x, sample.position.y, sample.position.z,
      end.x, end.y, end.z,
    ], 6 * index);
    const tip = cyan.clone().lerp(gold, Math.sqrt(amount));
    colors.set([
      0.35 * cyan.r, 0.35 * cyan.g, 0.35 * cyan.b,
      tip.r, tip.g, tip.b,
    ], 6 * index);
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  fieldLines = new THREE.LineSegments(
    geometry,
    new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.88,
      depthWrite: false,
    }),
  );
  fieldLines.renderOrder = 3;
  fieldLines.visible = vectorsVisible;
  fieldGroup.add(fieldLines);
}

function fitCanvas(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
  const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D is unavailable.");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  return context;
}

function drawSpectrum(): void {
  const context = fitCanvas(spectrumCanvas);
  const width = spectrumCanvas.clientWidth;
  const height = spectrumCanvas.clientHeight;
  context.clearRect(0, 0, width, height);
  const bands = model.spectrum();
  const maxShare = Math.max(1e-12, ...bands.map((band) => band.share));
  const left = 24;
  const right = 7;
  const top = 9;
  const bottom = 22;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  context.strokeStyle = "rgba(255,255,255,.16)";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(left, top);
  context.lineTo(left, top + plotHeight);
  context.lineTo(left + plotWidth, top + plotHeight);
  context.stroke();

  const gap = 4;
  const barWidth = Math.max(2, plotWidth / bands.length - gap);
  bands.forEach((band, index) => {
    const normalized = band.share / maxShare;
    const barHeight = Math.max(1, normalized * plotHeight);
    const x = left + index * plotWidth / bands.length + gap / 2;
    const gradient = context.createLinearGradient(0, top + plotHeight, 0, top);
    gradient.addColorStop(0, "#7249a7");
    gradient.addColorStop(.55, "#ff6fbd");
    gradient.addColorStop(1, "#59e3ef");
    context.fillStyle = gradient;
    context.fillRect(x, top + plotHeight - barHeight, barWidth, barHeight);
    context.fillStyle = "rgba(255,255,255,.65)";
    context.font = "7px ui-monospace, monospace";
    context.textAlign = "center";
    context.fillText(String(band.band), x + barWidth / 2, height - 7);
  });
  context.save();
  context.translate(8, top + plotHeight / 2);
  context.rotate(-Math.PI / 2);
  context.fillStyle = "rgba(255,255,255,.48)";
  context.font = "7px ui-monospace, monospace";
  context.textAlign = "center";
  context.fillText("energy share", 0, 0);
  context.restore();
  byId("spectrum-caption").textContent = `β = ${model.parameters.spectralSlope.toFixed(2)} · ${model.parameters.maxBand} bands`;
}

function formatResidual(value: number): string {
  if (Math.abs(value) < 5e-14) return "< 5e−14";
  return value.toExponential(2).replace("e-", "e−");
}

function updateDiagnostics(): void {
  const diagnostics = model.diagnostics();
  byId("fluid-time").textContent = model.time.toFixed(2);
  byId("fluid-rms").textContent = diagnostics.rmsSpeed.toFixed(3);
  byId("fluid-divergence").textContent = formatResidual(diagnostics.divergenceResidual);
  byId("fluid-tangency").textContent = formatResidual(diagnostics.tangencyResidual);
  byId("fluid-correlation").textContent = diagnostics.fieldCorrelation.toFixed(3);
}

function resizeRenderer(): void {
  const width = Math.max(1, viewer.clientWidth);
  const height = Math.max(1, viewer.clientHeight);
  const canvas = renderer.domElement;
  const targetWidth = Math.round(width * renderer.getPixelRatio());
  const targetHeight = Math.round(height * renderer.getPixelRatio());
  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
}

function rebuild(reason: string): void {
  model = readModel();
  rebuildSurface();
  initializeParticles();
  updateField();
  drawSpectrum();
  updateDiagnostics();
  byId("fluid-stage-title").textContent = `${surface} · two material clouds`;
  byId("fluid-status").textContent = `Seed ${model.parameters.seed} · ${reason}`;
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-fluid-surface]")) {
    const active = button.dataset.fluidSurface === surface;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
}

function setPlaying(value: boolean): void {
  playing = value;
  playButton.textContent = playing ? "Pause" : "Play";
  playButton.setAttribute("aria-pressed", String(playing));
}

function clearPresetSelection(): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-fluid-preset]")) {
    button.classList.remove("active");
  }
}

for (const input of Object.values(controls)) {
  input.addEventListener("input", updateControlOutputs);
  input.addEventListener("change", () => {
    clearPresetSelection();
    rebuild("parameters changed · seeded field rebuilt");
  });
}

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-fluid-surface]")) {
  button.addEventListener("click", () => {
    surface = button.dataset.fluidSurface as RandomFluidSurface;
    rebuild(`new ${surface} realization · invariants re-audited`);
  });
}

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-fluid-preset]")) {
  button.addEventListener("click", () => {
    const preset = button.dataset.fluidPreset;
    if (preset === "coherent") {
      controls.slope.value = "3.1";
      controls.modes.value = "18";
      controls.band.value = "5";
      controls.turnover.value = "0.18";
    } else if (preset === "rough") {
      controls.slope.value = "0.35";
      controls.modes.value = "54";
      controls.band.value = "11";
      controls.turnover.value = "0.82";
    } else {
      controls.slope.value = "1.6667";
      controls.modes.value = "28";
      controls.band.value = "7";
      controls.turnover.value = "0.42";
    }
    for (const candidate of document.querySelectorAll<HTMLButtonElement>("[data-fluid-preset]")) {
      candidate.classList.toggle("active", candidate === button);
    }
    updateControlOutputs();
    rebuild(`${button.textContent?.trim().toLowerCase()} spectrum loaded`);
  });
}

playButton.addEventListener("click", () => setPlaying(!playing));
byId<HTMLButtonElement>("fluid-step").addEventListener("click", () => {
  setPlaying(false);
  model.step();
  updateParticles(true);
  updateField();
  updateDiagnostics();
});
byId<HTMLButtonElement>("fluid-reset-particles").addEventListener("click", () => {
  model.resetParticles();
  initializeParticles();
  byId("fluid-status").textContent = `Seed ${model.parameters.seed} · material clouds reset at t = ${model.time.toFixed(2)}`;
});
byId<HTMLButtonElement>("fluid-new-seed").addEventListener("click", () => {
  controls.seed.value = String(Math.trunc(Number(controls.seed.value)) + 1);
  clearPresetSelection();
  rebuild("new random phases and directions");
});
vectorButton.addEventListener("click", () => {
  vectorsVisible = !vectorsVisible;
  vectorButton.classList.toggle("active", vectorsVisible);
  vectorButton.setAttribute("aria-pressed", String(vectorsVisible));
  if (fieldLines) fieldLines.visible = vectorsVisible;
});
trailButton.addEventListener("click", () => {
  trailsVisible = !trailsVisible;
  trailButton.classList.toggle("active", trailsVisible);
  trailButton.setAttribute("aria-pressed", String(trailsVisible));
  if (trailLines) trailLines.visible = trailsVisible;
});

function animate(): void {
  requestAnimationFrame(animate);
  resizeRenderer();
  orbit.update();
  if (playing) {
    model.step();
    const appendTrail = frame % 2 === 0;
    updateParticles(appendTrail);
    if (frame % 3 === 0) updateField();
    if (frame % 12 === 0) updateDiagnostics();
    frame += 1;
  }
  renderer.render(scene, camera);
}

const resizeObserver = new ResizeObserver(() => {
  resizeRenderer();
  drawSpectrum();
});
resizeObserver.observe(viewer);
window.addEventListener("resize", drawSpectrum);

updateControlOutputs();
rebuild("divergence-free stream field ready");
animate();
