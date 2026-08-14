interface PreviewParticle {
  x: number;
  y: number;
  age: number;
}

function fract(value: number): number {
  return value - Math.floor(value);
}

function seeded(index: number, offset: number): number {
  return fract(Math.sin(index * 91.731 + offset * 17.113) * 43758.5453);
}

function velocity(x: number, y: number, time: number): { x: number; y: number } {
  const tau = 2 * Math.PI;
  const ax = tau * (x + 0.025 * time);
  const ay = tau * (y - 0.018 * time);
  const bx = 2 * tau * x - 0.11 * time;
  const by = tau * y + 0.08 * time;
  return {
    x: 0.72 * tau * Math.sin(ax) * Math.cos(ay) - 0.16 * tau * Math.sin(bx) * Math.sin(by),
    y: -0.72 * tau * Math.cos(ax) * Math.sin(ay) - 0.32 * tau * Math.cos(bx) * Math.cos(by),
  };
}

export function initializeHomeFlowPreview(): void {
  const canvas = document.querySelector<HTMLCanvasElement>("#home-flow-preview");
  const context = canvas?.getContext("2d");
  if (!canvas || !context) return;

  const particles: PreviewParticle[] = Array.from({ length: 76 }, (_, index) => ({
    x: seeded(index, 1),
    y: seeded(index, 2),
    age: seeded(index, 3),
  }));
  let width = 1;
  let height = 1;
  let lastTime = performance.now();
  let firstFrame = true;

  const fit = (): void => {
    const bounds = canvas.getBoundingClientRect();
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    width = Math.max(1, bounds.width);
    height = Math.max(1, bounds.height);
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    firstFrame = true;
  };

  const drawBackground = (opacity: number): void => {
    context.fillStyle = `rgba(7,22,35,${opacity})`;
    context.fillRect(0, 0, width, height);
    const gradient = context.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, "rgba(88,224,232,.13)");
    gradient.addColorStop(0.52, "rgba(7,22,35,0)");
    gradient.addColorStop(1, "rgba(255,117,64,.17)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
  };

  const frame = (now: number): void => {
    const dt = Math.min(0.025, Math.max(0, (now - lastTime) / 1000));
    lastTime = now;
    drawBackground(firstFrame ? 1 : 0.12);
    firstFrame = false;
    context.lineWidth = 1.05;
    context.lineCap = "round";

    for (let index = 0; index < particles.length; index += 1) {
      const particle = particles[index]!;
      const oldX = particle.x;
      const oldY = particle.y;
      const field = velocity(oldX, oldY, now / 1000);
      const scale = 0.018 / Math.max(1, Math.hypot(field.x, field.y));
      particle.x = fract(oldX + dt * field.x * scale * 55);
      particle.y = fract(oldY + dt * field.y * scale * 55);
      particle.age += dt;
      if (particle.age > 3.6) {
        particle.x = seeded(index + Math.floor(now / 900), 4);
        particle.y = seeded(index + Math.floor(now / 900), 5);
        particle.age = 0;
        continue;
      }
      if (Math.abs(particle.x - oldX) > 0.5 || Math.abs(particle.y - oldY) > 0.5) continue;
      context.strokeStyle = index % 5 === 0 ? "rgba(255,210,106,.82)" : "rgba(88,224,232,.58)";
      context.beginPath();
      context.moveTo(oldX * width, (1 - oldY) * height);
      context.lineTo(particle.x * width, (1 - particle.y) * height);
      context.stroke();
    }
    requestAnimationFrame(frame);
  };

  new ResizeObserver(fit).observe(canvas);
  fit();
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    drawBackground(1);
  } else {
    requestAnimationFrame(frame);
  }
}
