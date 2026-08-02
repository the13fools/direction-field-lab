import type { LocalSecondOrderValue } from "./local-autodiff";

export class SparseSymmetricMatrix {
  private readonly values = new Map<number, number>();

  constructor(readonly size: number) {
    if (!Number.isInteger(size) || size <= 0) throw new Error("Sparse matrix size must be positive.");
  }

  private key(row: number, column: number): number {
    if (row < 0 || column < 0 || row >= this.size || column >= this.size) {
      throw new Error(`Sparse entry (${row}, ${column}) is outside a ${this.size}×${this.size} matrix.`);
    }
    const lower = Math.min(row, column);
    const upper = Math.max(row, column);
    return lower * this.size + upper;
  }

  add(row: number, column: number, value: number): void {
    if (Math.abs(value) < 1e-14) return;
    const key = this.key(row, column);
    const next = (this.values.get(key) ?? 0) + value;
    if (Math.abs(next) < 1e-14) this.values.delete(key);
    else this.values.set(key, next);
  }

  get(row: number, column: number): number {
    return this.values.get(this.key(row, column)) ?? 0;
  }

  storedNonzeros(): number {
    return this.values.size;
  }

  expandedNonzeros(): number {
    let count = 0;
    for (const key of this.values.keys()) {
      const row = Math.floor(key / this.size);
      const column = key % this.size;
      count += row === column ? 1 : 2;
    }
    return count;
  }

  multiply(vector: ArrayLike<number>, diagonalShift = 0): Float64Array {
    if (vector.length !== this.size) throw new Error("Sparse matrix-vector dimensions do not match.");
    const result = new Float64Array(this.size);
    for (const [key, value] of this.values) {
      const row = Math.floor(key / this.size);
      const column = key % this.size;
      result[row] = result[row]! + value * vector[column]!;
      if (row !== column) result[column] = result[column]! + value * vector[row]!;
    }
    if (diagonalShift !== 0) {
      for (let index = 0; index < this.size; index += 1) {
        result[index] = result[index]! + diagonalShift * vector[index]!;
      }
    }
    return result;
  }

  gershgorinLowerBound(): number {
    const diagonal = new Float64Array(this.size);
    const offDiagonalRadius = new Float64Array(this.size);
    for (const [key, value] of this.values) {
      const row = Math.floor(key / this.size);
      const column = key % this.size;
      if (row === column) diagonal[row] = diagonal[row]! + value;
      else {
        offDiagonalRadius[row] = offDiagonalRadius[row]! + Math.abs(value);
        offDiagonalRadius[column] = offDiagonalRadius[column]! + Math.abs(value);
      }
    }
    let lowerBound = Number.POSITIVE_INFINITY;
    for (let row = 0; row < this.size; row += 1) {
      lowerBound = Math.min(lowerBound, diagonal[row]! - offDiagonalRadius[row]!);
    }
    return lowerBound;
  }
}

export class SparseObjectiveAssembler {
  value = 0;
  readonly gradient: Float64Array;
  readonly hessian: SparseSymmetricMatrix;

  constructor(readonly degreesOfFreedom: number) {
    this.gradient = new Float64Array(degreesOfFreedom);
    this.hessian = new SparseSymmetricMatrix(degreesOfFreedom);
  }

  addElement(globalDofs: readonly number[], local: LocalSecondOrderValue): void {
    const dimension = globalDofs.length;
    if (local.gradient.length !== dimension || local.hessian.length !== dimension ** 2) {
      throw new Error("Local derivatives do not match the element's global DOF map.");
    }
    this.value += local.value;
    for (let row = 0; row < dimension; row += 1) {
      const globalRow = globalDofs[row]!;
      if (!Number.isInteger(globalRow) || globalRow < 0 || globalRow >= this.degreesOfFreedom) {
        throw new Error(`Global DOF ${globalRow} is outside this objective.`);
      }
      this.gradient[globalRow] = this.gradient[globalRow]! + local.gradient[row]!;
      for (let column = row; column < dimension; column += 1) {
        this.hessian.add(globalRow, globalDofs[column]!, local.hessian[row * dimension + column]!);
      }
    }
  }
}
