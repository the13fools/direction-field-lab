import { ClebschShallowWaterModel, type Vec2 } from "../experiments/clebsch-shallow-water-model";
import { RandomSurfaceFluidModel } from "../experiments/random-surface-fluid-model";

type FlowStoryMode = "random" | "water";
type FlowStoryView = "flat" | "mesh";

interface TrailPoint {
  x: number;
  y: number;
}

interface PreviewTrail {
  x: number;
  y: number;
  points: TrailPoint[];
  group: 0 | 1;
}

const TAU = 2 * Math.PI;

const FLOW_STORIES: Record<FlowStoryMode, {
  kicker: string;
  title: string;
  copy: string;
  audit: string;
  link: string;
  linkLabel: string;
}> = {
  random: {
    kicker: "PRESCRIBED KINEMATICS",
    title: "A random projected Clebsch field",
    copy: "Temporal Perlin coefficients move multiscale scalar labels. A periodic Hodge solve removes the divergent part before the particles are advected.",
    audit: "evolves: noise coordinates · constraint: div u ≈ 0",
    link: "./random-fluids.html",
    linkLabel: "Open the random-field playground →",
  },
  water: {
    kicker: "EVOLVING DYNAMICS",
    title: "A Clebsch shallow-water state",
    copy: "Three ambient-coordinate labels and their weights travel with the water, φ responds to the Bernoulli equation, and depth h changes through mass flux.",
    audit: "evolves: h, φ, λ₁…λ₃, B¹…B³ · audit: total mass",
    link: "./clebsch-shallow-water.html",
    linkLabel: "Open the shallow-water lab →",
  },
};

const MESH_FLOW_STORIES: typeof FLOW_STORIES = {
  random: {
    kicker: "PRESCRIBED SURFACE KINEMATICS",
    title: "A random projected field on the frog",
    copy: "Temporal noise moves Laplace–Beltrami eigenmode coefficients on the actual triangle mesh. A mesh Poisson solve reconstructs a tangent, divergence-free Clebsch field.",
    audit: "evolves: spectral coefficients · constraint: mesh div u ≈ 0",
    link: "./random-fluids.html",
    linkLabel: "Open the random-field playground →",
  },
  water: {
    kicker: "SURFACE-WAVE DYNAMICS",
    title: "A shallow-water wave on the frog",
    copy: "Two Laplace–Beltrami eigenmodes exchange height and tangent velocity. In the ambient Clebsch chart B=(X,Y,Z), the three minimum-norm weights are the tangent velocity components.",
    audit: "evolves: h and u · representation: Σ λₐ dXᵃ · audit: mass",
    link: "./clebsch-shallow-water.html",
    linkLabel: "Open the shallow-water lab →",
  },
};

function fract(value: number): number {
  return value - Math.floor(value);
}

function seeded(index: number, offset: number): number {
  return fract(Math.sin(index * 91.731 + offset * 17.113) * 43758.5453);
}

function mix(a: number, b: number, amount: number): number {
  return a + amount * (b - a);
}

function wrappedDifference(a: number, b: number): number {
  const difference = a - b;
  return difference - Math.round(difference);
}

function pushTrail(trail: PreviewTrail, x: number, y: number, limit: number): void {
  if (Math.abs(wrappedDifference(x, trail.x)) > 0.35 || Math.abs(wrappedDifference(y, trail.y)) > 0.35) {
    trail.points.length = 0;
  }
  trail.x = fract(x);
  trail.y = fract(y);
  trail.points.push({ x: trail.x, y: trail.y });
  if (trail.points.length > limit) trail.points.splice(0, trail.points.length - limit);
}

function drawWrappedSegment(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  first: TrailPoint,
  second: TrailPoint,
): void {
  if (Math.abs(first.x - second.x) > 0.45 || Math.abs(first.y - second.y) > 0.45) return;
  context.moveTo(first.x * width, (1 - first.y) * height);
  context.lineTo(second.x * width, (1 - second.y) * height);
}

function samplePeriodicVector(vectors: readonly Vec2[], resolution: number, x: number, y: number): Vec2 {
  const gx = fract(x) * resolution - 0.5;
  const gy = fract(y) * resolution - 0.5;
  const left = Math.floor(gx);
  const bottom = Math.floor(gy);
  const tx = gx - left;
  const ty = gy - bottom;
  const index = (column: number, row: number): number => (
    ((row % resolution + resolution) % resolution) * resolution
    + ((column % resolution + resolution) % resolution)
  );
  const v00 = vectors[index(left, bottom)]!;
  const v10 = vectors[index(left + 1, bottom)]!;
  const v01 = vectors[index(left, bottom + 1)]!;
  const v11 = vectors[index(left + 1, bottom + 1)]!;
  return {
    x: mix(mix(v00.x, v10.x, tx), mix(v01.x, v11.x, tx), ty),
    y: mix(mix(v00.y, v10.y, tx), mix(v01.y, v11.y, tx), ty),
  };
}

function initializeFlowStory(root: HTMLElement): void {
  const canvas = root.querySelector<HTMLCanvasElement>("[data-flow-canvas]");
  const context = canvas?.getContext("2d");
  if (!canvas || !context) return;
  const meshTarget = root.querySelector<HTMLElement>("[data-flow-mesh]");
  let meshController: {
    setMode(mode: FlowStoryMode): void;
    setPlaying(playing: boolean): void;
    setVisible(visible: boolean): void;
    reset(): void;
  } | undefined;

  const isHomeTeaser = root.classList.contains("home-flow-teaser");
  const randomModel = new RandomSurfaceFluidModel({
    surface: "square",
    projection: "clebsch-projected",
    seed: 13,
    modeCount: 15,
    maxBand: 5,
    turnover: 0.34,
    speed: 0.56,
    timeStep: 0.018,
    particleCount: isHomeTeaser ? 68 : 130,
  });
  const waterModel = new ClebschShallowWaterModel({
    resolution: isHomeTeaser ? 24 : 32,
    timeStep: 0.0015,
    clebschStrength: 0.19,
    preset: "crossing-labels",
  });

  const randomTrails: PreviewTrail[] = randomModel.particles.map((particle) => ({
    x: particle.u! / TAU,
    y: particle.v! / TAU,
    points: [],
    group: particle.group,
  }));
  const waterTrails: PreviewTrail[] = Array.from(
    { length: isHomeTeaser ? 58 : 110 },
    (_, index) => ({
      x: seeded(index, 31),
      y: seeded(index, 47),
      points: [],
      group: (index % 2) as 0 | 1,
    }),
  );

  let mode = (root.dataset.flowStory === "water" ? "water" : "random") as FlowStoryMode;
  let view = (meshTarget && root.dataset.flowView === "mesh" ? "mesh" : "flat") as FlowStoryView;
  let playing = root.dataset.flowPlaying !== "false";
  let width = 1;
  let height = 1;
  let previousFrame = performance.now();
  let frameNumber = 0;

  const updateCopy = (): void => {
    const story = view === "mesh" ? MESH_FLOW_STORIES[mode] : FLOW_STORIES[mode];
    const kicker = root.querySelector<HTMLElement>("[data-flow-kicker]");
    const title = root.querySelector<HTMLElement>("[data-flow-title]");
    const copy = root.querySelector<HTMLElement>("[data-flow-copy]");
    const audit = root.querySelector<HTMLElement>("[data-flow-audit]");
    const link = root.querySelector<HTMLAnchorElement>("[data-flow-link]");
    if (kicker) kicker.textContent = story.kicker;
    if (title) title.textContent = story.title;
    if (copy) copy.textContent = story.copy;
    if (audit) audit.textContent = story.audit;
    if (link) {
      link.href = story.link;
      link.textContent = story.linkLabel;
    }
    for (const button of root.querySelectorAll<HTMLButtonElement>("[data-flow-mode]")) {
      const active = button.dataset.flowMode === mode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    }
    for (const button of root.querySelectorAll<HTMLButtonElement>("[data-flow-view]")) {
      const active = button.dataset.flowView === view;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    }
  };

  const reset = (): void => {
    if (mode === "random") {
      randomModel.reset();
      randomTrails.forEach((trail, index) => {
        const particle = randomModel.particles[index]!;
        trail.x = particle.u! / TAU;
        trail.y = particle.v! / TAU;
        trail.points.length = 0;
      });
    } else {
      waterModel.reset({ preset: "crossing-labels" });
      waterTrails.forEach((trail, index) => {
        trail.x = seeded(index, 31);
        trail.y = seeded(index, 47);
        trail.points.length = 0;
      });
    }
  };

  const fit = (): void => {
    const bounds = canvas.getBoundingClientRect();
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    width = Math.max(1, bounds.width);
    height = Math.max(1, bounds.height);
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  };

  const updateView = (): void => {
    canvas.hidden = view !== "flat";
    if (meshTarget) meshTarget.hidden = view !== "mesh";
    meshController?.setVisible(view === "mesh");
    const hint = root.querySelector<HTMLElement>("[data-flow-view-hint]");
    if (hint) hint.textContent = view === "mesh"
      ? "drag to orbit · scroll to zoom"
      : "opposite edges are identified";
    if (view === "flat") {
      frameNumber = 0;
      fit();
      draw();
    }
    updateCopy();
  };

  if (meshTarget) {
    meshTarget.textContent = "Loading the tree-frog mesh and Laplace–Beltrami basis…";
    import("../experiments/solver-stories-mesh-preview")
      .then(({ initializeSolverStoriesMeshPreview }) => initializeSolverStoriesMeshPreview(
        meshTarget,
        (label) => {
          if (view !== "mesh") return;
          const time = root.querySelector<HTMLElement>("[data-flow-time]");
          if (time) time.textContent = label;
        },
      ))
      .then((controller) => {
        meshController = controller;
        controller.setMode(mode);
        controller.setPlaying(playing);
        controller.setVisible(view === "mesh");
      })
      .catch(() => {
        meshTarget.textContent = "The mesh view could not start here. The flat chart remains available.";
        view = "flat";
        updateView();
      });
  }

  const drawGrid = (): void => {
    context.strokeStyle = "rgba(255,255,255,.1)";
    context.lineWidth = 0.7;
    for (let index = 1; index < 8; index += 1) {
      const x = width * index / 8;
      const y = height * index / 8;
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, height);
      context.stroke();
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
    }
  };

  const drawArrow = (x: number, y: number, vx: number, vy: number, color: string): void => {
    const magnitude = Math.hypot(vx, vy);
    if (magnitude < 1e-9) return;
    const scale = Math.min(width / 28, height / 17) / magnitude;
    const dx = vx * scale;
    const dy = -vy * scale;
    context.strokeStyle = color;
    context.fillStyle = color;
    context.lineWidth = 1.05;
    context.beginPath();
    context.moveTo(x - 0.45 * dx, y - 0.45 * dy);
    context.lineTo(x + 0.45 * dx, y + 0.45 * dy);
    context.stroke();
    const angle = Math.atan2(dy, dx);
    context.beginPath();
    context.moveTo(x + 0.45 * dx, y + 0.45 * dy);
    context.lineTo(x + 0.45 * dx - 4 * Math.cos(angle - 0.52), y + 0.45 * dy - 4 * Math.sin(angle - 0.52));
    context.lineTo(x + 0.45 * dx - 4 * Math.cos(angle + 0.52), y + 0.45 * dy - 4 * Math.sin(angle + 0.52));
    context.closePath();
    context.fill();
  };

  const drawTrails = (trails: readonly PreviewTrail[]): void => {
    context.lineCap = "round";
    context.lineWidth = isHomeTeaser ? 1 : 1.35;
    trails.forEach((trail) => {
      context.strokeStyle = trail.group === 0 ? "rgba(88,224,232,.72)" : "rgba(255,184,91,.78)";
      context.beginPath();
      for (let index = 1; index < trail.points.length; index += 1) {
        drawWrappedSegment(context, width, height, trail.points[index - 1]!, trail.points[index]!);
      }
      context.stroke();
      context.fillStyle = trail.group === 0 ? "#76f0f4" : "#ffd26a";
      context.beginPath();
      context.arc(trail.x * width, (1 - trail.y) * height, isHomeTeaser ? 1.35 : 1.8, 0, TAU);
      context.fill();
    });
  };

  const drawRandom = (): void => {
    const columns = Math.max(12, Math.min(25, Math.round(width / 27)));
    const rows = Math.max(8, Math.min(17, Math.round(height / 25)));
    const samples = Array.from({ length: columns * rows }, (_, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      return randomModel.velocityAtSquare(TAU * (column + 0.5) / columns, TAU * (row + 0.5) / rows);
    });
    const at = (column: number, row: number) => samples[((row % rows + rows) % rows) * columns + ((column % columns + columns) % columns)]!;
    context.fillStyle = "#071c21";
    context.fillRect(0, 0, width, height);
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const curl = (at(column + 1, row).y - at(column - 1, row).y) - (at(column, row + 1).x - at(column, row - 1).x);
        const strength = Math.min(0.42, 0.08 + 0.38 * Math.abs(curl));
        context.fillStyle = curl >= 0 ? `rgba(255,117,64,${strength})` : `rgba(43,207,210,${strength})`;
        context.fillRect(column * width / columns, (rows - row - 1) * height / rows, width / columns + 1, height / rows + 1);
      }
    }
    drawGrid();
    const arrowStride = isHomeTeaser ? 3 : 2;
    for (let row = 0; row < rows; row += arrowStride) {
      for (let column = 0; column < columns; column += arrowStride) {
        const field = at(column, row);
        drawArrow(
          (column + 0.5) * width / columns,
          (rows - row - 0.5) * height / rows,
          field.x,
          field.y,
          "rgba(232,255,246,.66)",
        );
      }
    }
    drawTrails(randomTrails);
  };

  const drawWater = (): void => {
    const resolution = waterModel.parameters.resolution;
    const state = waterModel.state;
    const velocity = waterModel.velocity();
    context.fillStyle = "#071c21";
    context.fillRect(0, 0, width, height);
    for (let row = 0; row < resolution; row += 1) {
      for (let column = 0; column < resolution; column += 1) {
        const index = row * resolution + column;
        const displacement = state.height[index]! - waterModel.parameters.meanDepth;
        const labelMix = 0.5 + 0.5 * Math.sin(7 * state.alpha[index]! + 1.8 * state.beta[index]!);
        const amplitude = Math.min(1, Math.abs(displacement) * 18);
        const red = Math.round(mix(22, displacement >= 0 ? 255 : 45, amplitude));
        const green = Math.round(mix(70 + 35 * labelMix, displacement >= 0 ? 131 : 220, amplitude));
        const blue = Math.round(mix(75 + 55 * (1 - labelMix), displacement >= 0 ? 73 : 220, amplitude));
        context.fillStyle = `rgb(${red},${green},${blue})`;
        context.fillRect(column * width / resolution, (resolution - row - 1) * height / resolution, width / resolution + 1, height / resolution + 1);
      }
    }
    drawGrid();
    const stride = isHomeTeaser ? 4 : 3;
    for (let row = 1; row < resolution; row += stride) {
      for (let column = 1; column < resolution; column += stride) {
        const field = velocity[row * resolution + column]!;
        drawArrow(
          (column + 0.5) * width / resolution,
          (resolution - row - 0.5) * height / resolution,
          field.x,
          field.y,
          "rgba(240,255,238,.72)",
        );
      }
    }
    drawTrails(waterTrails);
  };

  const advance = (elapsed: number): void => {
    if (!playing) return;
    if (mode === "random") {
      randomModel.step(1);
      randomModel.particles.forEach((particle, index) => {
        pushTrail(randomTrails[index]!, particle.u! / TAU, particle.v! / TAU, isHomeTeaser ? 18 : 34);
      });
    } else {
      const velocity = waterModel.velocity();
      const dt = Math.min(0.012, elapsed * 0.23);
      waterTrails.forEach((trail) => {
        const field = samplePeriodicVector(velocity, waterModel.parameters.resolution, trail.x, trail.y);
        pushTrail(trail, trail.x + dt * field.x, trail.y + dt * field.y, isHomeTeaser ? 18 : 34);
      });
      waterModel.step(isHomeTeaser ? 1 : 2);
    }
  };

  const draw = (): void => {
    if (mode === "random") drawRandom();
    else drawWater();
    const time = root.querySelector<HTMLElement>("[data-flow-time]");
    if (time && frameNumber % 10 === 0) {
      if (mode === "random") time.textContent = `t ${randomModel.time.toFixed(2)} · projected periodic field`;
      else time.textContent = `t ${waterModel.state.time.toFixed(3)} · mass drift ${waterModel.diagnostics().massDrift.toExponential(1)}`;
    }
  };

  const frame = (now: number): void => {
    const elapsed = Math.min(0.04, Math.max(0, (now - previousFrame) / 1000));
    previousFrame = now;
    if (view === "flat") {
      advance(elapsed);
      draw();
    }
    frameNumber += 1;
    requestAnimationFrame(frame);
  };

  for (const button of root.querySelectorAll<HTMLButtonElement>("[data-flow-mode]")) {
    button.addEventListener("click", () => {
      mode = button.dataset.flowMode as FlowStoryMode;
      meshController?.setMode(mode);
      updateCopy();
      if (view === "flat") draw();
    });
  }
  for (const button of root.querySelectorAll<HTMLButtonElement>("[data-flow-view]")) {
    button.addEventListener("click", () => {
      view = button.dataset.flowView as FlowStoryView;
      updateView();
    });
  }
  root.querySelector<HTMLButtonElement>("[data-flow-reset]")?.addEventListener("click", () => {
    if (view === "mesh") meshController?.reset();
    else {
      reset();
      draw();
    }
  });
  const playButton = root.querySelector<HTMLButtonElement>("[data-flow-play]");
  playButton?.addEventListener("click", () => {
    playing = !playing;
    meshController?.setPlaying(playing);
    playButton.textContent = playing ? "Pause" : "Play";
    playButton.setAttribute("aria-pressed", String(playing));
  });

  new ResizeObserver(fit).observe(canvas);
  fit();
  updateView();
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    playing = false;
    if (playButton) playButton.textContent = "Play";
    draw();
  } else {
    requestAnimationFrame(frame);
  }
}

export function initializeHomeFlowPreview(): void {
  for (const root of document.querySelectorAll<HTMLElement>("[data-flow-story]")) initializeFlowStory(root);
}
