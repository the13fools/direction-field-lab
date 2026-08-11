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
import {
  nearestHarmonicLoopIndex,
  reduceHarmonicLoop,
  sampleClebschLoop,
} from "./clebsch-torus-loop-model";
import type { Vec3 } from "./random-surface-fluid-model";

type ConstructionStep = "labels" | "differentials" | "wedge" | "assemble" | "project";
type ScalarLayer = "alpha" | "beta" | "phi" | "vorticity" | "none";
type GlyphLayer = "dAlpha" | "dBeta" | "dPhi" | "alphaDBeta" | "velocity" | "none";
type VelocityView = "raw" | "projected";
type FieldCase = "controlled" | "taylor-green";
type TorusChartMode = "single" | "atlas" | "pair" | "harmonic";

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

function initializeDualPairingLab(): void {
  const canvas = byId<HTMLCanvasElement>("cs-pairing-canvas");
  const canvasContext = canvas.getContext("2d");
  if (!canvasContext) throw new Error("Unable to create the dual-pairing canvas.");
  const context: CanvasRenderingContext2D = canvasContext;

  const angleInput = byId<HTMLInputElement>("cs-vector-angle");
  const lengthInput = byId<HTMLInputElement>("cs-vector-length");
  const strengthInput = byId<HTMLInputElement>("cs-covector-strength");
  const angleOutput = byId<HTMLOutputElement>("cs-vector-angle-output");
  const lengthOutput = byId<HTMLOutputElement>("cs-vector-length-output");
  const strengthOutput = byId<HTMLOutputElement>("cs-covector-strength-output");
  const equation = byId<HTMLDivElement>("cs-pairing-equation");
  const valueOutput = byId<HTMLElement>("cs-pairing-value");
  const copy = byId<HTMLParagraphElement>("cs-pairing-copy");

  function arrow(
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    color: string,
    width: number,
  ): void {
    const direction = Math.atan2(endY - startY, endX - startX);
    const head = 10 + width;
    context.beginPath();
    context.moveTo(startX, startY);
    context.lineTo(endX, endY);
    context.strokeStyle = color;
    context.lineWidth = width;
    context.lineCap = "round";
    context.stroke();
    context.beginPath();
    context.moveTo(endX, endY);
    context.lineTo(
      endX - head * Math.cos(direction - Math.PI / 6),
      endY - head * Math.sin(direction - Math.PI / 6),
    );
    context.lineTo(
      endX - head * Math.cos(direction + Math.PI / 6),
      endY - head * Math.sin(direction + Math.PI / 6),
    );
    context.closePath();
    context.fillStyle = color;
    context.fill();
  }

  function draw(): void {
    const bounds = canvas.getBoundingClientRect();
    const width = Math.max(1, bounds.width);
    const height = Math.max(1, bounds.height);
    const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
    const pixelWidth = Math.round(width * pixelRatio);
    const pixelHeight = Math.round(height * pixelRatio);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, width, height);

    const angleDegrees = Number(angleInput.value);
    const angle = angleDegrees * Math.PI / 180;
    const drawnAngle = -angle;
    const vectorLength = Number(lengthInput.value);
    const strength = Number(strengthInput.value);
    const pairing = strength * vectorLength * Math.cos(angle);
    const originX = width * 0.48;
    const originY = height * 0.51;
    const physicalScale = Math.min(102, width * 0.16, height * 0.27);
    const levelSpacing = physicalScale / strength;
    const vectorPixels = physicalScale * vectorLength;
    const vectorEndX = originX + vectorPixels * Math.cos(drawnAngle);
    const vectorEndY = originY + vectorPixels * Math.sin(drawnAngle);
    const plotBottom = height - 48;

    context.save();
    context.beginPath();
    context.rect(0, 0, width, plotBottom);
    context.clip();

    const furthestLevel = Math.ceil(width / levelSpacing) + 1;
    for (let level = -furthestLevel; level <= furthestLevel; level += 1) {
      const x = originX + level * levelSpacing;
      if (x < 10 || x > width - 10) continue;
      context.beginPath();
      context.moveTo(x, 18);
      context.lineTo(x, plotBottom - 10);
      context.strokeStyle = level === 0 ? "rgba(89, 227, 239, .78)" : "rgba(179, 160, 203, .28)";
      context.lineWidth = level === 0 ? 2 : 1;
      context.stroke();
      if (Math.abs(level) <= 3) {
        context.fillStyle = level === 0 ? "#59e3ef" : "#9d8db1";
        context.font = "700 10px SFMono-Regular, Consolas, monospace";
        context.textAlign = "center";
        context.fillText(`η=${level}`, x, 15);
      }
    }

    context.beginPath();
    context.arc(originX, originY, 38, 0, drawnAngle, drawnAngle < 0);
    context.strokeStyle = "rgba(255, 216, 109, .78)";
    context.lineWidth = 2;
    context.stroke();
    const angleLabelDirection = drawnAngle / 2;
    context.fillStyle = "#ffd86d";
    context.font = "700 10px SFMono-Regular, Consolas, monospace";
    context.textAlign = "center";
    context.fillText(
      `${angleDegrees}°`,
      originX + 52 * Math.cos(angleLabelDirection),
      originY + 52 * Math.sin(angleLabelDirection),
    );

    const sharpPixels = physicalScale * Math.min(strength, 1.75);
    arrow(originX, originY, originX + sharpPixels, originY, "#59e3ef", 3);
    context.fillStyle = "#59e3ef";
    context.font = "700 12px SFMono-Regular, Consolas, monospace";
    context.textAlign = "left";
    context.fillText("η♯", originX + sharpPixels + 8, originY + 4);

    arrow(originX, originY, vectorEndX, vectorEndY, "#ff7a3d", 5);
    context.fillStyle = "#ffb084";
    context.font = "700 12px SFMono-Regular, Consolas, monospace";
    context.textAlign = vectorEndX >= originX ? "left" : "right";
    context.fillText("v", vectorEndX + (vectorEndX >= originX ? 9 : -9), vectorEndY - 7);

    const projectedPixels = vectorEndX - originX;
    if (Math.abs(projectedPixels) > 1e-6) {
      for (let level = -furthestLevel; level <= furthestLevel; level += 1) {
        if (level === 0) continue;
        const lineX = originX + level * levelSpacing;
        const t = (lineX - originX) / projectedPixels;
        if (t <= 0 || t >= 1) continue;
        const lineY = originY + t * (vectorEndY - originY);
        context.beginPath();
        context.arc(lineX, lineY, 5, 0, TAU);
        context.fillStyle = "#ffd86d";
        context.fill();
        context.strokeStyle = "#21163e";
        context.lineWidth = 2;
        context.stroke();
      }
    }

    context.beginPath();
    context.arc(originX, originY, 6, 0, TAU);
    context.fillStyle = "#fffdf7";
    context.fill();
    context.strokeStyle = "#24164c";
    context.lineWidth = 2;
    context.stroke();
    context.fillStyle = "#d7cbe2";
    context.font = "700 10px SFMono-Regular, Consolas, monospace";
    context.textAlign = "right";
    context.fillText("p", originX - 10, originY + 4);
    context.restore();

    angleOutput.value = `${angleDegrees}°`;
    lengthOutput.value = vectorLength.toFixed(2);
    strengthOutput.value = strength.toFixed(2);
    renderLatex(
      equation,
      String.raw`\eta(v)=${strength.toFixed(2)}\cdot${vectorLength.toFixed(2)}\cos(${angleDegrees}^{\circ})=${pairing.toFixed(3)}`,
      true,
    );
    valueOutput.textContent = `η(v) = ${pairing.toFixed(3)} level spacings`;
    copy.textContent = Math.abs(pairing) < 0.015
      ? "The vector follows a covector level line, so it produces no signed crossing."
      : pairing > 0
        ? `The endpoint moves ${pairing.toFixed(3)} level spacings in the positive covector direction.`
        : `The endpoint moves ${Math.abs(pairing).toFixed(3)} level spacings in the negative covector direction.`;
    canvas.setAttribute(
      "aria-label",
      `A tangent vector at ${angleDegrees} degrees has covector pairing ${pairing.toFixed(3)}.`,
    );
  }

  for (const input of [angleInput, lengthInput, strengthInput]) {
    input.addEventListener("input", draw);
  }
  new ResizeObserver(draw).observe(canvas);
  draw();
}

function initializeTorusChartLab(): void {
  const canvas = byId<HTMLCanvasElement>("cs-torus-chart-canvas");
  const caption = byId<HTMLElement>("cs-torus-chart-caption");
  const kicker = byId<HTMLElement>("cs-torus-mode-kicker");
  const title = byId<HTMLElement>("cs-torus-mode-title");
  const equation = byId<HTMLElement>("cs-torus-mode-equation");
  const copy = byId<HTMLElement>("cs-torus-mode-copy");
  const buttons = [...document.querySelectorAll<HTMLButtonElement>("[data-cs-torus-mode]")];
  const pairAnatomy = byId<HTMLElement>("cs-torus-pair-anatomy");
  const harmonicReduction = byId<HTMLElement>("cs-torus-harmonic-reduction");
  const labelCanvas = byId<HTMLCanvasElement>("cs-torus-label-canvas");
  const labelCanvasContext = labelCanvas.getContext("2d");
  if (!labelCanvasContext) throw new Error("Unable to create the Clebsch label-space canvas.");
  const labelContext: CanvasRenderingContext2D = labelCanvasContext;
  const thetaInput = byId<HTMLInputElement>("cs-torus-theta");
  const thetaOutput = byId<HTMLOutputElement>("cs-torus-theta-output");
  const coefficientInput = byId<HTMLInputElement>("cs-torus-c");
  const coefficientOutput = byId<HTMLOutputElement>("cs-torus-c-output");
  const quantumInput = byId<HTMLInputElement>("cs-torus-q");
  const quantumOutput = byId<HTMLOutputElement>("cs-torus-q-output");
  const harmonicButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-cs-harmonic-k]")];

  const atlasScene = new THREE.Scene();
  atlasScene.background = new THREE.Color(0x0d081f);
  atlasScene.fog = new THREE.FogExp2(0x0d081f, 0.075);

  const atlasCamera = new THREE.PerspectiveCamera(36, 1, 0.05, 50);
  atlasCamera.position.set(3.5, -3.4, 2.55);

  const atlasRenderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  atlasRenderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  atlasRenderer.outputColorSpace = THREE.SRGBColorSpace;
  atlasRenderer.toneMapping = THREE.ACESFilmicToneMapping;
  atlasRenderer.toneMappingExposure = 1.12;

  const atlasOrbit = new OrbitControls(atlasCamera, canvas);
  atlasOrbit.enablePan = false;
  atlasOrbit.enableDamping = false;
  atlasOrbit.minDistance = 3.1;
  atlasOrbit.maxDistance = 7;

  atlasScene.add(new THREE.HemisphereLight(0xc4f7ff, 0x24133d, 1.75));
  const atlasKey = new THREE.DirectionalLight(0xffd5b9, 3.1);
  atlasKey.position.set(3, -2, 5);
  atlasScene.add(atlasKey);
  const atlasRim = new THREE.DirectionalLight(0x59e3ef, 2.1);
  atlasRim.position.set(-4, 2, -2);
  atlasScene.add(atlasRim);

  const majorRadius = 1.4;
  const minorRadius = 0.55;
  const torusGeometry = new THREE.TorusGeometry(majorRadius, minorRadius, 48, 112);
  const torusMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    metalness: 0.08,
    roughness: 0.72,
    side: THREE.DoubleSide,
    vertexColors: true,
  });
  const torus = new THREE.Mesh(torusGeometry, torusMaterial);
  atlasScene.add(torus);

  function torusPoint(theta: number, phi: number, offset = 0): THREE.Vector3 {
    const tube = minorRadius + offset;
    return new THREE.Vector3(
      (majorRadius + tube * Math.cos(phi)) * Math.cos(theta),
      (majorRadius + tube * Math.cos(phi)) * Math.sin(theta),
      tube * Math.sin(phi),
    );
  }

  function makeThetaLoop(theta: number, color: number): THREE.LineLoop {
    const points = Array.from({ length: 96 }, (_, index) => torusPoint(theta, TAU * index / 96, 0.025));
    return new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.98 }),
    );
  }

  function makePhiLoop(phi: number, color: number): THREE.LineLoop {
    const points = Array.from({ length: 144 }, (_, index) => torusPoint(TAU * index / 144, phi, 0.035));
    return new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95 }),
    );
  }

  const chartASeam = makeThetaLoop(0, 0xff7a3d);
  const chartBSeam = makeThetaLoop(Math.PI, 0x59e3ef);
  const thetaCycle = makePhiLoop(0.22, 0xffd86d);
  atlasScene.add(chartASeam, chartBSeam, thetaCycle);

  const arrowGroup = new THREE.Group();
  for (const phi of [-1.05, -0.1, 0.95]) {
    for (let index = 0; index < 9; index += 1) {
      const theta = TAU * (index + 0.25) / 9;
      const origin = torusPoint(theta, phi, 0.07);
      const direction = new THREE.Vector3(-Math.sin(theta), Math.cos(theta), 0);
      const metricDualLength = 0.28 * majorRadius / (majorRadius + minorRadius * Math.cos(phi));
      arrowGroup.add(new THREE.ArrowHelper(direction, origin, metricDualLength, 0xfff0a7, 0.085, 0.055));
    }
  }
  atlasScene.add(arrowGroup);

  const rawHarmonicArrowGroup = new THREE.Group();
  const residualHarmonicArrowGroup = new THREE.Group();
  const rawHarmonicArrows: THREE.ArrowHelper[] = [];
  const residualHarmonicArrows: THREE.ArrowHelper[] = [];
  for (let index = 0; index < 12; index += 1) {
    const theta = TAU * (index + 0.25) / 12;
    const direction = new THREE.Vector3(-Math.sin(theta), Math.cos(theta), 0);
    const rawArrow = new THREE.ArrowHelper(direction, torusPoint(theta, 0.72, 0.085), 0.25, 0xffd86d, 0.08, 0.05);
    const residualArrow = new THREE.ArrowHelper(direction, torusPoint(theta, -0.72, 0.085), 0.25, 0x59e3ef, 0.08, 0.05);
    rawHarmonicArrows.push(rawArrow);
    residualHarmonicArrows.push(residualArrow);
    rawHarmonicArrowGroup.add(rawArrow);
    residualHarmonicArrowGroup.add(residualArrow);
  }
  atlasScene.add(rawHarmonicArrowGroup, residualHarmonicArrowGroup);

  const loopMarker = new THREE.Mesh(
    new THREE.SphereGeometry(0.095, 18, 12),
    new THREE.MeshBasicMaterial({ color: 0xff7a3d, depthTest: false }),
  );
  loopMarker.renderOrder = 9;
  atlasScene.add(loopMarker);

  const colors = new Float32Array(torusGeometry.getAttribute("position").count * 3);
  torusGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const colorAttribute = torusGeometry.getAttribute("color") as THREE.BufferAttribute;
  const uvAttribute = torusGeometry.getAttribute("uv");
  const violet = new THREE.Color(0x7249a7);
  const orange = new THREE.Color(0xff7a3d);
  const cyan = new THREE.Color(0x59e3ef);
  const overlap = new THREE.Color(0x8c62bd);
  const harmonicDark = new THREE.Color(0x0c564c);
  const harmonicLight = new THREE.Color(0x18a58d);
  const workingColor = new THREE.Color();

  function angularDistance(left: number, right: number): number {
    const difference = Math.abs(left - right) % TAU;
    return Math.min(difference, TAU - difference);
  }

  function updateTorusColors(mode: TorusChartMode): void {
    for (let index = 0; index < colorAttribute.count; index += 1) {
      const angleFraction = uvAttribute.getX(index);
      const theta = TAU * angleFraction;
      if (mode === "single") {
        workingColor.lerpColors(violet, orange, angleFraction);
      } else if (mode === "atlas") {
        const distanceToASeam = angularDistance(theta, 0);
        const distanceToBSeam = angularDistance(theta, Math.PI);
        if (distanceToASeam < 0.5) workingColor.copy(orange);
        else if (distanceToBSeam < 0.5) workingColor.copy(cyan);
        else workingColor.copy(overlap);
      } else if (mode === "pair") {
        workingColor.lerpColors(cyan, orange, 0.5 + 0.5 * Math.sin(theta));
      } else {
        const phiFraction = uvAttribute.getY(index);
        workingColor.lerpColors(harmonicDark, harmonicLight, 0.25 + 0.65 * Math.sin(Math.PI * phiFraction) ** 2);
      }
      colorAttribute.setXYZ(index, workingColor.r, workingColor.g, workingColor.b);
    }
    colorAttribute.needsUpdate = true;
  }

  function formatLoopValue(value: number, digits = 2): string {
    const rounded = Math.abs(value) < 0.5 * 10 ** -digits ? 0 : value;
    return rounded.toFixed(digits).replaceAll("-", "−");
  }

  function latexLoopValue(value: number, digits = 2): string {
    const rounded = Math.abs(value) < 0.5 * 10 ** -digits ? 0 : value;
    return rounded.toFixed(digits);
  }

  function updateArrowSet(arrows: THREE.ArrowHelper[], coefficient: number): void {
    const magnitude = Math.abs(coefficient);
    const length = 0.13 + 0.17 * Math.min(2, magnitude);
    for (let index = 0; index < arrows.length; index += 1) {
      const theta = TAU * (index + 0.25) / arrows.length;
      const directionSign = coefficient < 0 ? -1 : 1;
      arrows[index]!.visible = magnitude > 0.012;
      arrows[index]!.setDirection(new THREE.Vector3(
        -directionSign * Math.sin(theta),
        directionSign * Math.cos(theta),
        0,
      ));
      arrows[index]!.setLength(length, Math.min(0.085, 0.45 * length), Math.min(0.055, 0.3 * length));
    }
  }

  function drawLabelSpace(theta: number): void {
    const bounds = labelCanvas.getBoundingClientRect();
    const width = Math.max(1, bounds.width);
    const height = Math.max(1, bounds.height);
    const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
    const pixelWidth = Math.round(width * pixelRatio);
    const pixelHeight = Math.round(height * pixelRatio);
    if (labelCanvas.width !== pixelWidth || labelCanvas.height !== pixelHeight) {
      labelCanvas.width = pixelWidth;
      labelCanvas.height = pixelHeight;
    }
    labelContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    labelContext.clearRect(0, 0, width, height);
    labelContext.fillStyle = "#0f0925";
    labelContext.fillRect(0, 0, width, height);
    const paddingX = 32;
    const paddingY = 23;
    const centerX = width / 2;
    const centerY = height / 2;
    const radiusX = Math.max(12, (width - 2 * paddingX) / 2);
    const radiusY = Math.max(12, (height - 2 * paddingY) / 2);
    labelContext.strokeStyle = "rgba(220,208,235,.25)";
    labelContext.lineWidth = 1;
    labelContext.beginPath();
    labelContext.moveTo(paddingX, centerY);
    labelContext.lineTo(width - paddingX, centerY);
    labelContext.moveTo(centerX, paddingY);
    labelContext.lineTo(centerX, height - paddingY);
    labelContext.stroke();
    labelContext.strokeStyle = "#59e3ef";
    labelContext.lineWidth = 2;
    labelContext.beginPath();
    labelContext.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, TAU);
    labelContext.stroke();
    const sample = sampleClebschLoop(theta);
    const pointX = centerX + radiusX * sample.alpha / 2;
    const pointY = centerY - radiusY * sample.beta;
    labelContext.beginPath();
    labelContext.arc(pointX, pointY, 6, 0, TAU);
    labelContext.fillStyle = "#ff7a3d";
    labelContext.fill();
    labelContext.strokeStyle = "#ffd86d";
    labelContext.lineWidth = 2;
    labelContext.stroke();
    labelContext.fillStyle = "#cfc3d9";
    labelContext.font = "700 9px SFMono-Regular, Consolas, monospace";
    labelContext.textAlign = "right";
    labelContext.fillText("α", width - 9, centerY - 6);
    labelContext.textAlign = "left";
    labelContext.fillText("β", centerX + 7, 12);
    labelCanvas.setAttribute(
      "aria-label",
      `At theta ${Math.round(theta * 180 / Math.PI)} degrees, the labels are alpha ${sample.alpha.toFixed(2)} and beta ${sample.beta.toFixed(2)} on a closed ellipse.`,
    );
  }

  function updateClebschAnatomy(): void {
    const thetaDegrees = Number(thetaInput.value);
    const theta = thetaDegrees * Math.PI / 180;
    const sample = sampleClebschLoop(theta);
    thetaOutput.value = `${thetaDegrees}°`;
    byId("cs-torus-alpha-value").textContent = formatLoopValue(sample.alpha, 3);
    byId("cs-torus-beta-value").textContent = formatLoopValue(sample.beta, 3);
    byId("cs-torus-alphadbeta-value").textContent = formatLoopValue(sample.alphaDBetaCoefficient, 3);
    byId("cs-torus-dphi-value").textContent = formatLoopValue(sample.dPhiCoefficient, 3);
    renderLatex(
      byId("cs-torus-pair-equation"),
      String.raw`\underbrace{${latexLoopValue(sample.alphaDBetaCoefficient, 3)}\,d\theta}_{\alpha d\beta}+\underbrace{${latexLoopValue(sample.dPhiCoefficient, 3)}\,d\theta}_{d\phi}=${latexLoopValue(sample.velocityCoefficient, 3)}\,d\theta`,
      true,
    );
    loopMarker.position.copy(torusPoint(theta, 0.22, 0.12));
    drawLabelSpace(theta);
  }

  let harmonicIndex = 2;

  function updateHarmonicReduction(): void {
    const coefficient = Number(coefficientInput.value);
    const quantum = Number(quantumInput.value);
    const reduction = reduceHarmonicLoop(coefficient, quantum, harmonicIndex);
    coefficientOutput.value = formatLoopValue(coefficient);
    quantumOutput.value = formatLoopValue(quantum);
    renderLatex(
      byId("cs-torus-harmonic-equation"),
      String.raw`${latexLoopValue(coefficient)}\,d\theta-${latexLoopValue(quantum)}(${harmonicIndex})\,d\theta=${latexLoopValue(reduction.residualCoefficient)}\,d\theta`,
      true,
    );
    byId("cs-torus-raw-period").textContent = formatLoopValue(reduction.originalPeriod, 3);
    byId("cs-torus-removed-period").textContent = formatLoopValue(reduction.removedPeriod, 3);
    byId("cs-torus-residual-period").textContent = formatLoopValue(reduction.residualPeriod, 3);
    updateArrowSet(rawHarmonicArrows, coefficient);
    updateArrowSet(residualHarmonicArrows, reduction.residualCoefficient);
    for (const button of harmonicButtons) {
      const active = Number(button.dataset.csHarmonicK) === harmonicIndex;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    }
  }

  const content: Record<TorusChartMode, {
    kicker: string;
    title: string;
    equation: string;
    copy: string;
    caption: string;
    aria: string;
  }> = {
    single: {
      kicker: "ONE REAL-VALUED POTENTIAL",
      title: "The angle tears at the orange seam.",
      equation: String.raw`\phi_A=\theta_A\in(0,2\pi),\qquad \eta_h=c\,d\phi_A`,
      copy: "Approaching the seam from opposite sides gives values near 2π and 0. The physical one-form is smooth, but a naïve difference of scalar samples sees a false jump of 2π.",
      caption: "orange ring: the unavoidable branch cut of one angle field",
      aria: "A torus colored by one angle potential with a discontinuity at an orange meridian.",
    },
    atlas: {
      kicker: "TWO OVERLAPPING LOCAL POTENTIALS",
      title: "Each chart covers the other chart’s cut.",
      equation: String.raw`\phi_B=\phi_A+2\pi k\quad\Longrightarrow\quad d\phi_B=d\phi_A=d\theta`,
      copy: "Orange marks where chart A hands off to chart B; cyan marks the reverse handoff. The potentials disagree only by a constant on each overlap component, so their derivatives glue into one smooth global velocity one-form.",
      caption: "orange: chart B covers A’s cut · cyan: chart A covers B’s cut · violet: overlap",
      aria: "A torus covered by two overlapping angle charts with separate orange and cyan seams.",
    },
    pair: {
      kicker: "LABELS, NOT AUTOMATICALLY COORDINATES",
      title: "Watch αdβ and dφ divide the work.",
      equation: String.raw`\alpha=-2\sin\theta,\quad\beta=\cos\theta,\quad\phi=\tfrac12\sin2\theta`,
      copy: "The pair (α,β) maps each torus point into a label plane. Here it collapses the second torus direction and traces only an ellipse, so it is not a surface chart. Even so, αdβ can carry circulation, while dφ corrects its local variation.",
      caption: "orange marker: selected θ · label-space point moves on a closed ellipse",
      aria: "A torus smoothly colored by periodic Clebsch labels with a selected point on one noncontractible loop.",
    },
    harmonic: {
      kicker: "GLOBAL COHOMOLOGY COEFFICIENT",
      title: "Subtract a quantized harmonic representative.",
      equation: String.raw`\eta_h=c\,d\theta\ \mapsto\ \eta_h-qk\,d\theta,\qquad k\in\mathbb Z`,
      copy: "The real coefficient c records the physical period around this torus cycle. Choosing an integer k subtracts one imposed lattice representative. Curl stays zero, but the closed-loop circulation and particle winding would change.",
      caption: "gold arrows: raw c dθ · cyan arrows: residual (c−qk)dθ",
      aria: "A dark green torus comparing raw gold harmonic arrows with cyan arrows after quantized subtraction.",
    },
  };

  let mode: TorusChartMode = "single";

  function resizeAndRender(): void {
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    const pixelRatio = atlasRenderer.getPixelRatio();
    if (canvas.width !== Math.round(width * pixelRatio) || canvas.height !== Math.round(height * pixelRatio)) {
      atlasRenderer.setSize(width, height, false);
      atlasCamera.aspect = width / height;
      atlasCamera.updateProjectionMatrix();
    }
    atlasRenderer.render(atlasScene, atlasCamera);
  }

  function setMode(nextMode: TorusChartMode): void {
    mode = nextMode;
    const next = content[mode];
    updateTorusColors(mode);
    chartASeam.visible = mode === "single" || mode === "atlas";
    chartBSeam.visible = mode === "atlas";
    thetaCycle.visible = mode === "pair" || mode === "harmonic";
    arrowGroup.visible = mode !== "harmonic";
    rawHarmonicArrowGroup.visible = mode === "harmonic";
    residualHarmonicArrowGroup.visible = mode === "harmonic";
    loopMarker.visible = mode === "pair";
    pairAnatomy.hidden = mode !== "pair";
    harmonicReduction.hidden = mode !== "harmonic";
    kicker.textContent = next.kicker;
    title.textContent = next.title;
    renderLatex(equation, next.equation, true);
    copy.textContent = next.copy;
    caption.textContent = next.caption;
    canvas.setAttribute("aria-label", next.aria);
    for (const button of buttons) {
      const active = button.dataset.csTorusMode === mode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    }
    if (mode === "pair") updateClebschAnatomy();
    if (mode === "harmonic") updateHarmonicReduction();
    resizeAndRender();
  }

  for (const button of buttons) {
    button.addEventListener("click", () => setMode(button.dataset.csTorusMode as TorusChartMode));
  }
  thetaInput.addEventListener("input", () => {
    updateClebschAnatomy();
    resizeAndRender();
  });
  for (const input of [coefficientInput, quantumInput]) {
    input.addEventListener("input", () => {
      updateHarmonicReduction();
      resizeAndRender();
    });
  }
  for (const button of harmonicButtons) {
    button.addEventListener("click", () => {
      harmonicIndex = Number(button.dataset.csHarmonicK);
      updateHarmonicReduction();
      resizeAndRender();
    });
  }
  byId<HTMLButtonElement>("cs-torus-nearest-k").addEventListener("click", () => {
    harmonicIndex = nearestHarmonicLoopIndex(Number(coefficientInput.value), Number(quantumInput.value));
    updateHarmonicReduction();
    resizeAndRender();
  });
  atlasOrbit.addEventListener("change", resizeAndRender);
  new ResizeObserver(resizeAndRender).observe(canvas);
  new ResizeObserver(() => {
    if (!pairAnatomy.hidden) updateClebschAnatomy();
  }).observe(labelCanvas);
  setMode(mode);
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
const controlCopy = {
  crossingLabel: byId<HTMLElement>("cs-crossing-label"),
  crossingHelp: byId<HTMLElement>("cs-crossing-help"),
  labelLabel: byId<HTMLElement>("cs-label-label"),
  labelHelp: byId<HTMLElement>("cs-label-help"),
  potentialLabel: byId<HTMLElement>("cs-potential-label"),
  potentialHelp: byId<HTMLElement>("cs-potential-help"),
};

let surface: ClebschSurface = "plane";
let fieldCase: FieldCase = "controlled";
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
  if (surface === "plane" && fieldCase === "taylor-green") {
    return model.sampleTaylorGreenPlane(TAU * uvs!.getX(index), TAU * uvs!.getY(index));
  }
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
  if (fieldCase === "taylor-green") {
    byId("cs-probe-reading").textContent = velocityView === "projected"
      ? `Projection removes the exact contamination speed ${format(removed)} here and recovers Taylor–Green speed ${format(magnitude(probeSample.projectedVelocity))}. The vorticity value above is unchanged.`
      : `Raw speed is ${format(raw)}. Of that field, ${format(removed)} is the deliberately added gradient dq; it creates sources and sinks but no vorticity.`;
  } else {
    byId("cs-probe-reading").textContent = velocityView === "projected"
      ? `The resolved Hodge reconstruction changes the velocity by ${format(removed)} here. Its coexact speed is ${format(magnitude(probeSample.projectedVelocity))}; resolved curl is retained while exact source/sink motion is removed.`
      : `The label crossing control is ${labelAngle}°. Raw speed is ${format(raw)}; Clebsch form alone does not force its divergence to vanish.`;
  }
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
    probeSample = surface === "plane" && fieldCase === "taylor-green"
      ? model.sampleTaylorGreenPlane(0.19 * TAU, 0.31 * TAU)
      : model.sampleParameter(surface, 0.19 * TAU, 0.31 * TAU);
    probeDescription = "u = 0.19 · v = 0.31";
  }
}

const stepCopy: Record<ConstructionStep, {
  kicker: string;
  equation: string;
  type: string;
  example: string;
  copy: string;
}> = {
  labels: {
    kicker: "STEP 01 · LABELS",
    equation: String.raw`\phi,\alpha,\beta\in\Omega^0(S)`,
    type: "SMOOTH VIEW: evaluate at a point · MESH VIEW: sample at vertices",
    example: String.raw`\alpha=A\sin x,\quad\beta=\cos\theta\sin x+\sin\theta\sin y`,
    copy: "The angle θ controls whether the two label families change in the same direction or independently. These 0-forms are scalar fields, not velocity arrows.",
  },
  differentials: {
    kicker: "STEP 02 · DIFFERENTIALS",
    equation: String.raw`d\alpha,d\beta\in T_p^*S,\qquad d\alpha(v)=v[\alpha]`,
    type: "LOCAL VIEW: measure tangent arrows · INTEGRAL VIEW: measure curves",
    example: String.raw`d\alpha=A\cos x\,dx,\quad d\beta=\cos\theta\cos x\,dx+\sin\theta\cos y\,dy`,
    copy: "The smooth 1-forms exist at every point. An edge cochain stores their line integrals; the drawn arrows are (dα)♯ and (dβ)♯ after the metric converts covectors into vectors.",
  },
  wedge: {
    kicker: "STEP 03 · VORTICITY",
    equation: String.raw`du^\flat=d\alpha\wedge d\beta\in\Omega^2(S)`,
    type: "LOCAL VIEW: evaluate an oriented parallelogram · INTEGRAL VIEW: measure a patch",
    example: String.raw`d\alpha\wedge d\beta=A\sin\theta\cos x\cos y\,dx\wedge dy`,
    copy: "This determinant measures the signed independence of the two label changes. By Stokes, its integral over a patch equals velocity circulation around the patch boundary.",
  },
  assemble: {
    kicker: "STEP 04 · ASSEMBLY",
    equation: String.raw`u^\flat=d\phi+\alpha\,d\beta`,
    type: "ONE-FORM VIEW: measure circulation · VECTOR VIEW: apply ♯g to advect",
    example: String.raw`d\phi=P\sin(x-y)(-dx+dy),\qquad u=(u^\flat)^{\sharp_g}`,
    copy: "The scalar α scales dβ pointwise. The exact term dφ changes the local velocity but not closed-loop circulation or vorticity because ∮dφ = 0 and d²φ = 0.",
  },
  project: {
    kicker: "STEP 05 · HODGE PROJECTION",
    equation: String.raw`\delta d p=\delta u^\flat,\qquad u_\perp^\flat=u^\flat-dp`,
    type: "METRIC STEP: p is a 0-form; dp and both velocities are 1-forms",
    example: String.raw`\delta u_\perp^\flat=0,\qquad du_\perp^\flat=du^\flat-d^2p=du^\flat`,
    copy: "The projection removes the exact source/sink part. It preserves resolved vorticity and closed-loop circulation because d(dp) = 0 and ∮dp = 0.",
  },
};

const taylorGreenStepCopy: typeof stepCopy = {
  labels: {
    kicker: "TEST 01 · EXACT LABELS",
    equation: String.raw`\phi,\alpha,\beta\in\Omega^0(\mathbb T^2)`,
    type: "ALL THREE SCALARS ARE SINGLE-VALUED AND 2π-PERIODIC",
    example: String.raw`\alpha=2U\cos x,\quad\beta=\cos y,\quad\phi=-U\cos x\cos y+C\sin(x+y)`,
    copy: "This triple is chosen so its assembled one-form is the Taylor–Green vortex plus one known exact contaminant dq.",
  },
  differentials: {
    kicker: "TEST 02 · DIFFERENTIATE",
    equation: String.raw`d\alpha=-2U\sin x\,dx,\qquad d\beta=-\sin y\,dy`,
    type: "THE LABEL COVECTORS CROSS ORTHOGONALLY EXCEPT ON THEIR NODAL LINES",
    example: String.raw`d\phi=U(\sin x\cos y\,dx+\cos x\sin y\,dy)+dq`,
    copy: "The metric duals are the arrows you see. Before raising the index, these one-forms measure directional change and line circulation.",
  },
  wedge: {
    kicker: "TEST 03 · VORTICITY ORACLE",
    equation: String.raw`d\alpha\wedge d\beta=2U\sin x\sin y\,dx\wedge dy`,
    type: "FOUR ALTERNATING VORTICITY CELLS ON THE PERIODIC SQUARE",
    example: String.raw`d(d\phi+\alpha d\beta)=d\alpha\wedge d\beta`,
    copy: "The exact contaminant cannot alter this checkerboard: d(dq) = 0. That gives the test a known vorticity answer before projection.",
  },
  assemble: {
    kicker: "TEST 04 · ADD A KNOWN ERROR",
    equation: String.raw`u_C^\flat=u_{TG}^\flat+dq,\qquad q=C\sin(x+y)`,
    type: "RAW FIELD = DIVERGENCE-FREE TARGET + EXACT SOURCE/SINK MOTION",
    example: String.raw`u_{TG}^\flat=U(\sin x\cos y\,dx-\cos x\sin y\,dy)`,
    copy: "The diagonal dq term is not random noise: its exact formula makes the expected projection result unambiguous.",
  },
  project: {
    kicker: "TEST 05 · VERIFY",
    equation: String.raw`P_{\mathrm{div}=0}(u_{TG}^\flat+dq)=u_{TG}^\flat`,
    type: "PASS: ZERO DIVERGENCE, SAME VORTICITY, EXACT TARGET RECOVERED",
    example: String.raw`\operatorname{div}u_C=-2C\sin(x+y),\qquad \operatorname{div}u_{TG}=0`,
    copy: "Switch between raw and projected arrows. The diagonal source/sink motion should disappear, while the vorticity colors remain identical.",
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
    scalarLayer = fieldCase === "taylor-green" ? "vorticity" : "phi";
    glyphLayer = "velocity";
    velocityView = "raw";
  } else {
    scalarLayer = "vorticity";
    glyphLayer = "velocity";
    velocityView = "projected";
  }
  const copy = (fieldCase === "taylor-green" ? taylorGreenStepCopy : stepCopy)[step];
  byId("cs-step-kicker").textContent = copy.kicker;
  renderLatex(byId("cs-step-equation"), copy.equation, true);
  byId("cs-step-type").textContent = copy.type;
  renderLatex(byId("cs-step-example"), copy.example, true);
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
  outputs.crossing.value = fieldCase === "taylor-green"
    ? "fixed"
    : `${Math.round(90 * Number(controls.crossing.value))}°`;
  outputs.label.value = Number(controls.label.value).toFixed(2);
  outputs.potential.value = Number(controls.potential.value).toFixed(2);
  byId("cs-tg-raw-divergence").textContent = `√2 C = ${(Math.SQRT2 * Number(controls.potential.value)).toFixed(3)}`;
}

function updateStageTitle(): void {
  byId("cs-stage-title").textContent = surface === "plane"
    ? fieldCase === "taylor-green"
      ? "periodic plane · exact Taylor–Green verification case"
      : "periodic plane · two crossing label foliations"
    : surface === "frog"
      ? "tree frog · scalar Laplace–Beltrami modes"
      : `${surface} · intrinsic differentials and metric duals`;
}

function updateFieldCaseInterface(): void {
  const taylorGreen = fieldCase === "taylor-green";
  controls.crossing.disabled = taylorGreen;
  byId("cs-crossing-control").classList.toggle("cs-control-locked", taylorGreen);
  byId<HTMLElement>("cs-taylor-green-case").hidden = !taylorGreen;
  controlCopy.crossingLabel.textContent = taylorGreen ? "Taylor–Green labels" : "Label crossing";
  controlCopy.crossingHelp.textContent = taylorGreen ? "α = 2U cos x and β = cos y are fixed" : "0° parallel → 90° independent";
  controlCopy.labelLabel.textContent = taylorGreen ? "Vortex amplitude U" : "Label strength";
  controlCopy.labelHelp.textContent = taylorGreen ? "scales target velocity and vorticity" : "scales α and its vorticity";
  controlCopy.potentialLabel.textContent = taylorGreen ? "Exact contamination C" : "Potential strength";
  controlCopy.potentialHelp.textContent = taylorGreen ? "adds dq = C cos(x+y)(dx+dy)" : "changes dφ, never dα∧dβ";
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-cs-case]")) {
    const active = button.dataset.csCase === fieldCase;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  updateStageTitle();
  updateControlOutputs();
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
  if (next !== "plane" && fieldCase === "taylor-green") {
    fieldCase = "controlled";
    controls.crossing.value = "0.78";
    controls.label.value = "0.7";
    controls.potential.value = "0.24";
    updateFieldCaseInterface();
  }
  surface = next;
  if (surface === "plane") camera.position.set(0.15, -0.2, 4.55);
  else if (surface === "frog") camera.position.set(0.15, -0.1, 6.7);
  else camera.position.set(2.9, 1.8, 3.4);
  orbit.target.set(0, 0, 0);
  orbit.update();
  updateStageTitle();
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-cs-surface]")) {
    const active = button.dataset.csSurface === surface;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  rebuildSurface();
  activateStep(constructionStep);
}

function setFieldCase(next: FieldCase): void {
  fieldCase = next;
  if (fieldCase === "taylor-green") {
    controls.crossing.value = "1";
    controls.label.value = "1";
    controls.potential.value = "0.3";
  } else {
    controls.crossing.value = "0.78";
    controls.label.value = "0.7";
    controls.potential.value = "0.24";
  }
  updateFieldCaseInterface();
  if (fieldCase === "taylor-green" && surface !== "plane") setSurface("plane");
  else rebuildSamples();
  activateStep(fieldCase === "taylor-green" ? "assemble" : "labels");
}

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-cs-surface]")) {
  button.addEventListener("click", () => setSurface(button.dataset.csSurface as ClebschSurface));
}
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-cs-case]")) {
  button.addEventListener("click", () => setFieldCase(button.dataset.csCase as FieldCase));
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
    probeSample = fieldCase === "taylor-green"
      ? model.sampleTaylorGreenPlane(u, v)
      : model.sampleParameter("plane", u, v);
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
initializeDualPairingLab();
initializeTorusChartLab();
updateFieldCaseInterface();
rebuildSurface();
activateStep("labels");
animate();
