export interface ComplexPoint {
  re: number;
  im: number;
}

const TAU = 2 * Math.PI;

function complex(re: number, im = 0): ComplexPoint {
  return { re, im };
}

function add(left: ComplexPoint, right: ComplexPoint): ComplexPoint {
  return complex(left.re + right.re, left.im + right.im);
}

function divide(numerator: ComplexPoint, denominator: ComplexPoint): ComplexPoint {
  const normSquared = denominator.re ** 2 + denominator.im ** 2;
  return complex(
    (numerator.re * denominator.re + numerator.im * denominator.im) / normSquared,
    (numerator.im * denominator.re - numerator.re * denominator.im) / normSquared,
  );
}

function scale(value: ComplexPoint, factor: number): ComplexPoint {
  return complex(factor * value.re, factor * value.im);
}

function complexSin(value: ComplexPoint): ComplexPoint {
  return complex(
    Math.sin(value.re) * Math.cosh(value.im),
    Math.cos(value.re) * Math.sinh(value.im),
  );
}

function complexCos(value: ComplexPoint): ComplexPoint {
  return complex(
    Math.cos(value.re) * Math.cosh(value.im),
    -Math.sin(value.re) * Math.sinh(value.im),
  );
}

/** Complete elliptic integral K(m), evaluated by the arithmetic-geometric mean. */
export function completeEllipticK(parameter: number): number {
  if (!(parameter >= 0 && parameter < 1)) throw new Error("elliptic parameter must lie in [0,1)");
  let arithmetic = 1;
  let geometric = Math.sqrt(1 - parameter);
  for (let iteration = 0; iteration < 30; iteration += 1) {
    const nextArithmetic = 0.5 * (arithmetic + geometric);
    const nextGeometric = Math.sqrt(arithmetic * geometric);
    arithmetic = nextArithmetic;
    geometric = nextGeometric;
    if (Math.abs(arithmetic - geometric) < 2e-15) break;
  }
  return Math.PI / (2 * arithmetic);
}

/**
 * Jacobi sn(u|m), using the rapidly convergent theta-function representation.
 * The lab only uses m=c^4 with 0.2<=c<=0.88, where this series is well behaved.
 */
export function jacobiSn(argument: ComplexPoint, parameter: number): ComplexPoint {
  const ellipticK = completeEllipticK(parameter);
  const complementaryK = completeEllipticK(1 - parameter);
  const nome = Math.exp(-Math.PI * complementaryK / ellipticK);
  const thetaArgument = scale(argument, Math.PI / (2 * ellipticK));

  let theta1 = complex(0);
  let theta2AtZero = 0;
  let theta3AtZero = 1;
  let theta4 = complex(1);

  for (let index = 0; index < 32; index += 1) {
    const halfIndex = index + 0.5;
    const weight = nome ** (halfIndex * halfIndex);
    const sign = index % 2 === 0 ? 1 : -1;
    theta1 = add(
      theta1,
      scale(complexSin(scale(thetaArgument, 2 * index + 1)), 2 * sign * weight),
    );
    theta2AtZero += 2 * weight;
  }
  for (let index = 1; index < 32; index += 1) {
    const weight = nome ** (index * index);
    const sign = index % 2 === 0 ? 1 : -1;
    theta3AtZero += 2 * weight;
    theta4 = add(
      theta4,
      scale(complexCos(scale(thetaArgument, 2 * index)), 2 * sign * weight),
    );
  }

  return scale(divide(theta1, theta4), theta3AtZero / theta2AtZero);
}

export function slitDiskMap(coordinate: ComplexPoint, slitTip: number): ComplexPoint {
  return scale(jacobiSn(coordinate, slitTip ** 4), slitTip);
}

function wrapUnit(value: number): number {
  return value - Math.floor(value);
}

function resizeCanvas(canvas: HTMLCanvasElement, context: CanvasRenderingContext2D): { width: number; height: number } {
  const bounds = canvas.getBoundingClientRect();
  const width = Math.max(1, bounds.width);
  const height = Math.max(1, bounds.height);
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const pixelWidth = Math.round(width * ratio);
  const pixelHeight = Math.round(height * ratio);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { width, height };
}

function strokeMappedCurve(
  context: CanvasRenderingContext2D,
  samples: ComplexPoint[],
  centerX: number,
  centerY: number,
  radius: number,
): void {
  context.beginPath();
  let previous: ComplexPoint | null = null;
  for (const sample of samples) {
    const point = { re: centerX + radius * sample.re, im: centerY - radius * sample.im };
    const jump = previous ? Math.hypot(point.re - previous.re, point.im - previous.im) : 0;
    if (!previous || jump > 0.18 * radius) context.moveTo(point.re, point.im);
    else context.lineTo(point.re, point.im);
    previous = point;
  }
  context.stroke();
}

function drawTracer(
  context: CanvasRenderingContext2D,
  point: ComplexPoint,
  centerX: number,
  centerY: number,
  radius: number,
): void {
  const x = centerX + radius * point.re;
  const y = centerY - radius * point.im;
  context.beginPath();
  context.arc(x, y, 4.2, 0, TAU);
  context.fillStyle = "#ffd56c";
  context.shadowColor = "#ffd56c";
  context.shadowBlur = 12;
  context.fill();
  context.shadowBlur = 0;
  context.strokeStyle = "#fff7d6";
  context.lineWidth = 1.2;
  context.stroke();
}

export function drawSlitConformalFlow(
  canvas: HTMLCanvasElement,
  slitTip: number,
  time: number,
): void {
  const canvasContext = canvas.getContext("2d");
  if (!canvasContext) throw new Error("Canvas 2D is unavailable");
  const context: CanvasRenderingContext2D = canvasContext;
  const { width, height } = resizeCanvas(canvas, context);
  const parameter = slitTip ** 4;
  const ellipticK = completeEllipticK(parameter);
  const complementaryK = completeEllipticK(1 - parameter);

  context.clearRect(0, 0, width, height);
  const background = context.createLinearGradient(0, 0, width, height);
  background.addColorStop(0, "#061522");
  background.addColorStop(0.68, "#172441");
  background.addColorStop(1, "#321f3d");
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);

  const isCompact = width < 700;
  const diskCenterX = isCompact ? width / 2 : width * 0.34;
  const diskCenterY = isCompact ? height * 0.34 : height * 0.52;
  const diskRadius = isCompact
    ? Math.min(width * 0.35, height * 0.27)
    : Math.min(width * 0.27, height * 0.4);
  const rectangleLeft = isCompact ? width * 0.15 : width * 0.71;
  const rectangleTop = isCompact ? height * 0.69 : height * 0.18;
  const rectangleWidth = isCompact ? width * 0.7 : width * 0.22;
  const rectangleHeight = isCompact ? height * 0.23 : height * 0.65;

  context.save();
  context.beginPath();
  context.arc(diskCenterX, diskCenterY, diskRadius, 0, TAU);
  context.clip();
  const diskFill = context.createRadialGradient(diskCenterX, diskCenterY, 0, diskCenterX, diskCenterY, diskRadius);
  diskFill.addColorStop(0, "rgba(105,239,242,.2)");
  diskFill.addColorStop(1, "rgba(73,54,111,.34)");
  context.fillStyle = diskFill;
  context.fillRect(diskCenterX - diskRadius, diskCenterY - diskRadius, 2 * diskRadius, 2 * diskRadius);

  const fractions = [-0.84, -0.63, -0.42, -0.21, 0, 0.21, 0.42, 0.63, 0.84];
  context.lineWidth = 1.45;
  context.globalAlpha = 0.88;
  for (const fraction of fractions) {
    const points: ComplexPoint[] = [];
    for (let index = 0; index <= 180; index += 1) {
      const imaginary = complementaryK * (-0.5 + index / 180);
      points.push(slitDiskMap(complex(fraction * ellipticK, imaginary), slitTip));
    }
    context.strokeStyle = "#69eff2";
    strokeMappedCurve(context, points, diskCenterX, diskCenterY, diskRadius);
  }
  for (const fraction of fractions) {
    const points: ComplexPoint[] = [];
    for (let index = 0; index <= 180; index += 1) {
      const real = ellipticK * (-1 + 2 * index / 180);
      points.push(slitDiskMap(complex(real, 0.5 * fraction * complementaryK), slitTip));
    }
    context.strokeStyle = "#ff7d45";
    strokeMappedCurve(context, points, diskCenterX, diskCenterY, diskRadius);
  }
  context.globalAlpha = 1;
  context.restore();

  context.beginPath();
  context.arc(diskCenterX, diskCenterY, diskRadius, 0, TAU);
  context.strokeStyle = "#e6f9f1";
  context.lineWidth = 2.5;
  context.stroke();
  context.beginPath();
  context.moveTo(diskCenterX - diskRadius, diskCenterY);
  context.lineTo(diskCenterX - slitTip * diskRadius, diskCenterY);
  context.moveTo(diskCenterX + slitTip * diskRadius, diskCenterY);
  context.lineTo(diskCenterX + diskRadius, diskCenterY);
  context.strokeStyle = "#071421";
  context.lineWidth = 7;
  context.stroke();
  context.strokeStyle = "#ffd56c";
  context.lineWidth = 1.5;
  context.stroke();

  for (let index = 0; index < fractions.length; index += 1) {
    const fraction = fractions[index]!;
    const phase = wrapUnit(time + index * 0.137);
    const imaginary = complementaryK * (-0.5 + phase);
    const point = slitDiskMap(complex(fraction * ellipticK, imaginary), slitTip);
    drawTracer(context, point, diskCenterX, diskCenterY, diskRadius);
  }

  context.fillStyle = "#d8e5eb";
  context.font = "700 9px SFMono-Regular, Consolas, monospace";
  context.textAlign = "center";
  context.fillText("z-plane · slit disk", diskCenterX, Math.max(14, diskCenterY - diskRadius - 13));
  context.fillStyle = "#ffd56c";
  context.fillText("−c", diskCenterX - slitTip * diskRadius, diskCenterY + 18);
  context.fillText("+c", diskCenterX + slitTip * diskRadius, diskCenterY + 18);

  context.fillStyle = "rgba(9,25,40,.78)";
  context.fillRect(rectangleLeft, rectangleTop, rectangleWidth, rectangleHeight);
  context.strokeStyle = "#d8e5eb";
  context.lineWidth = 1.7;
  context.strokeRect(rectangleLeft, rectangleTop, rectangleWidth, rectangleHeight);
  for (const fraction of fractions) {
    const x = rectangleLeft + 0.5 * (fraction + 1) * rectangleWidth;
    context.beginPath();
    context.moveTo(x, rectangleTop);
    context.lineTo(x, rectangleTop + rectangleHeight);
    context.strokeStyle = "rgba(105,239,242,.76)";
    context.lineWidth = 1;
    context.stroke();
  }
  for (const fraction of fractions) {
    const y = rectangleTop + 0.5 * (fraction + 1) * rectangleHeight;
    context.beginPath();
    context.moveTo(rectangleLeft, y);
    context.lineTo(rectangleLeft + rectangleWidth, y);
    context.strokeStyle = "rgba(255,125,69,.72)";
    context.lineWidth = 1;
    context.stroke();
  }
  for (let index = 0; index < fractions.length; index += 1) {
    const fraction = fractions[index]!;
    const phase = wrapUnit(time + index * 0.137);
    context.beginPath();
    context.arc(
      rectangleLeft + 0.5 * (fraction + 1) * rectangleWidth,
      rectangleTop + phase * rectangleHeight,
      3.5,
      0,
      TAU,
    );
    context.fillStyle = "#ffd56c";
    context.fill();
  }
  context.fillStyle = "#d8e5eb";
  context.textAlign = "center";
  context.fillText("u=s+it · fundamental rectangle", rectangleLeft + rectangleWidth / 2, rectangleTop - 13);
  context.fillStyle = "#8fa5b8";
  context.font = "700 8px SFMono-Regular, Consolas, monospace";
  context.fillText("outer-circle inflow", rectangleLeft + rectangleWidth / 2, rectangleTop + rectangleHeight + 17);
  context.fillText("outer-circle outflow", rectangleLeft + rectangleWidth / 2, rectangleTop - 27);
}
