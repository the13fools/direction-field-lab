export interface LocalSecondOrderValue {
  value: number;
  gradient: Float64Array;
  hessian: Float64Array;
}

export class LocalScalar implements LocalSecondOrderValue {
  readonly value: number;
  readonly gradient: Float64Array;
  readonly hessian: Float64Array;

  constructor(value: number, gradient: Float64Array, hessian: Float64Array) {
    if (hessian.length !== gradient.length * gradient.length) {
      throw new Error("A local Hessian must be square and match its gradient.");
    }
    this.value = value;
    this.gradient = gradient;
    this.hessian = hessian;
  }

  static constant(value: number, dimension: number): LocalScalar {
    return new LocalScalar(value, new Float64Array(dimension), new Float64Array(dimension ** 2));
  }

  static variable(value: number, dimension: number, index: number): LocalScalar {
    if (!Number.isInteger(index) || index < 0 || index >= dimension) {
      throw new Error(`Local variable ${index} is outside a ${dimension}-variable element.`);
    }
    const gradient = new Float64Array(dimension);
    gradient[index] = 1;
    return new LocalScalar(value, gradient, new Float64Array(dimension ** 2));
  }
}

function sameDimension(a: LocalSecondOrderValue, b: LocalSecondOrderValue): number {
  if (a.gradient.length !== b.gradient.length) {
    throw new Error("Local AD operands must have the same dimension.");
  }
  return a.gradient.length;
}

export function localScale(value: LocalSecondOrderValue, factor: number): LocalScalar {
  return new LocalScalar(
    factor * value.value,
    Float64Array.from(value.gradient, (entry) => factor * entry),
    Float64Array.from(value.hessian, (entry) => factor * entry),
  );
}

export function localAdd(a: LocalSecondOrderValue, b: LocalSecondOrderValue): LocalScalar {
  const dimension = sameDimension(a, b);
  const gradient = new Float64Array(dimension);
  const hessian = new Float64Array(dimension ** 2);
  for (let i = 0; i < dimension; i += 1) gradient[i] = a.gradient[i]! + b.gradient[i]!;
  for (let i = 0; i < hessian.length; i += 1) hessian[i] = a.hessian[i]! + b.hessian[i]!;
  return new LocalScalar(a.value + b.value, gradient, hessian);
}

export function localSubtract(a: LocalSecondOrderValue, b: LocalSecondOrderValue): LocalScalar {
  return localAdd(a, localScale(b, -1));
}

export function localMultiply(a: LocalSecondOrderValue, b: LocalSecondOrderValue): LocalScalar {
  const dimension = sameDimension(a, b);
  const gradient = new Float64Array(dimension);
  const hessian = new Float64Array(dimension ** 2);
  for (let row = 0; row < dimension; row += 1) {
    gradient[row] = a.gradient[row]! * b.value + b.gradient[row]! * a.value;
    for (let column = 0; column < dimension; column += 1) {
      const index = row * dimension + column;
      hessian[index] =
        a.hessian[index]! * b.value + b.hessian[index]! * a.value +
        a.gradient[row]! * b.gradient[column]! + b.gradient[row]! * a.gradient[column]!;
    }
  }
  return new LocalScalar(a.value * b.value, gradient, hessian);
}

export function localSquare(value: LocalSecondOrderValue): LocalScalar {
  return localMultiply(value, value);
}

export function localLinearCombination(
  values: readonly LocalSecondOrderValue[],
  coefficients: readonly number[],
): LocalScalar {
  if (values.length === 0 || values.length !== coefficients.length) {
    throw new Error("A local linear combination needs equally many values and coefficients.");
  }
  let result = LocalScalar.constant(0, values[0]!.gradient.length);
  for (let index = 0; index < values.length; index += 1) {
    result = localAdd(result, localScale(values[index]!, coefficients[index]!));
  }
  return result;
}
