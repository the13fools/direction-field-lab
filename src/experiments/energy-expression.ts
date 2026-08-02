export const DEFAULT_UNIT_ENERGY =
  "0.5 * data * ((ux - tx)^2 + (uy - ty)^2) + 0.5 * unit * (ux^2 + uy^2 - length^2)^2";

export interface EnergyEnvironment {
  ux: number;
  uy: number;
  tx: number;
  ty: number;
  data: number;
  unit: number;
  length: number;
}

export interface EnergyJet {
  value: number;
  gradient: [number, number];
  hessian: [[number, number], [number, number]];
}

export interface CompiledEnergyExpression {
  source: string;
  cppExpression: string;
  pythonExpression: string;
  evaluate(environment: EnergyEnvironment): EnergyJet;
}

type VariableName = keyof EnergyEnvironment;
type Node =
  | { kind: "number"; value: number }
  | { kind: "variable"; name: VariableName }
  | { kind: "negate"; value: Node }
  | { kind: "binary"; operator: "+" | "-" | "*" | "/"; left: Node; right: Node }
  | { kind: "power"; base: Node; exponent: number };

interface Token {
  kind: "number" | "identifier" | "symbol" | "eof";
  text: string;
  offset: number;
}

const VARIABLES = new Set<VariableName>(["ux", "uy", "tx", "ty", "data", "unit", "length"]);

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let offset = 0;
  while (offset < source.length) {
    const rest = source.slice(offset);
    const whitespace = /^\s+/.exec(rest);
    if (whitespace) {
      offset += whitespace[0].length;
      continue;
    }
    const number = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(rest);
    if (number) {
      tokens.push({ kind: "number", text: number[0], offset });
      offset += number[0].length;
      continue;
    }
    const identifier = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest);
    if (identifier) {
      tokens.push({ kind: "identifier", text: identifier[0], offset });
      offset += identifier[0].length;
      continue;
    }
    if ("+-*/^()".includes(source[offset]!)) {
      tokens.push({ kind: "symbol", text: source[offset]!, offset });
      offset += 1;
      continue;
    }
    throw new Error(`Unexpected character “${source[offset]}” at column ${offset + 1}.`);
  }
  tokens.push({ kind: "eof", text: "", offset: source.length });
  return tokens;
}

class Parser {
  private cursor = 0;

  constructor(private readonly tokens: readonly Token[]) {}

  parse(): Node {
    const result = this.additive();
    const trailing = this.peek();
    if (trailing.kind !== "eof") {
      throw new Error(`Unexpected “${trailing.text}” at column ${trailing.offset + 1}.`);
    }
    return result;
  }

  private peek(): Token {
    return this.tokens[this.cursor]!;
  }

  private take(text?: string): Token | undefined {
    const token = this.peek();
    if (text !== undefined && token.text !== text) return undefined;
    this.cursor += 1;
    return token;
  }

  private additive(): Node {
    let node = this.multiplicative();
    while (this.peek().text === "+" || this.peek().text === "-") {
      const operator = this.take()!.text as "+" | "-";
      node = { kind: "binary", operator, left: node, right: this.multiplicative() };
    }
    return node;
  }

  private multiplicative(): Node {
    let node = this.unary();
    while (this.peek().text === "*" || this.peek().text === "/") {
      const operator = this.take()!.text as "*" | "/";
      node = { kind: "binary", operator, left: node, right: this.unary() };
    }
    return node;
  }

  private unary(): Node {
    if (this.take("+")) return this.unary();
    if (this.take("-")) return { kind: "negate", value: this.unary() };
    return this.power();
  }

  private power(): Node {
    const base = this.primary();
    if (!this.take("^")) return base;
    const token = this.take();
    if (!token || token.kind !== "number") {
      throw new Error(`Powers must be integer literals from 0 through 8.`);
    }
    const exponent = Number(token.text);
    if (!Number.isInteger(exponent) || exponent < 0 || exponent > 8) {
      throw new Error(`Power ${token.text} is outside the supported range 0…8.`);
    }
    return { kind: "power", base, exponent };
  }

  private primary(): Node {
    const token = this.take()!;
    if (token.kind === "number") return { kind: "number", value: Number(token.text) };
    if (token.kind === "identifier") {
      if (!VARIABLES.has(token.text as VariableName)) {
        throw new Error(
          `Unknown symbol “${token.text}” at column ${token.offset + 1}. Use ux, uy, tx, ty, data, unit, or length.`,
        );
      }
      return { kind: "variable", name: token.text as VariableName };
    }
    if (token.text === "(") {
      const value = this.additive();
      const close = this.take(")");
      if (!close) throw new Error(`Missing “)” for the group at column ${token.offset + 1}.`);
      return value;
    }
    throw new Error(`Expected a number, variable, or “(” at column ${token.offset + 1}.`);
  }
}

function constant(value: number): EnergyJet {
  return { value, gradient: [0, 0], hessian: [[0, 0], [0, 0]] };
}

function variable(value: number, axis: 0 | 1 | undefined): EnergyJet {
  const result = constant(value);
  if (axis !== undefined) result.gradient[axis] = 1;
  return result;
}

function scale(value: EnergyJet, factor: number): EnergyJet {
  return {
    value: factor * value.value,
    gradient: [factor * value.gradient[0], factor * value.gradient[1]],
    hessian: [
      [factor * value.hessian[0][0], factor * value.hessian[0][1]],
      [factor * value.hessian[1][0], factor * value.hessian[1][1]],
    ],
  };
}

function add(a: EnergyJet, b: EnergyJet): EnergyJet {
  return {
    value: a.value + b.value,
    gradient: [a.gradient[0] + b.gradient[0], a.gradient[1] + b.gradient[1]],
    hessian: [
      [a.hessian[0][0] + b.hessian[0][0], a.hessian[0][1] + b.hessian[0][1]],
      [a.hessian[1][0] + b.hessian[1][0], a.hessian[1][1] + b.hessian[1][1]],
    ],
  };
}

function multiply(a: EnergyJet, b: EnergyJet): EnergyJet {
  const hessian = [[0, 0], [0, 0]] as [[number, number], [number, number]];
  for (let row = 0; row < 2; row += 1) {
    for (let column = 0; column < 2; column += 1) {
      hessian[row]![column] =
        a.hessian[row]![column]! * b.value +
        b.hessian[row]![column]! * a.value +
        a.gradient[row]! * b.gradient[column]! +
        b.gradient[row]! * a.gradient[column]!;
    }
  }
  return {
    value: a.value * b.value,
    gradient: [
      a.gradient[0] * b.value + b.gradient[0] * a.value,
      a.gradient[1] * b.value + b.gradient[1] * a.value,
    ],
    hessian,
  };
}

function compose(value: EnergyJet, f: number, first: number, second: number): EnergyJet {
  const hessian = [[0, 0], [0, 0]] as [[number, number], [number, number]];
  for (let row = 0; row < 2; row += 1) {
    for (let column = 0; column < 2; column += 1) {
      hessian[row]![column] =
        first * value.hessian[row]![column]! +
        second * value.gradient[row]! * value.gradient[column]!;
    }
  }
  return {
    value: f,
    gradient: [first * value.gradient[0], first * value.gradient[1]],
    hessian,
  };
}

function reciprocal(value: EnergyJet): EnergyJet {
  if (Math.abs(value.value) < 1e-12) throw new Error("The energy divided by a value too close to zero.");
  return compose(value, 1 / value.value, -1 / value.value ** 2, 2 / value.value ** 3);
}

function power(value: EnergyJet, exponent: number): EnergyJet {
  if (exponent === 0) return constant(1);
  return compose(
    value,
    value.value ** exponent,
    exponent * value.value ** (exponent - 1),
    exponent > 1 ? exponent * (exponent - 1) * value.value ** (exponent - 2) : 0,
  );
}

function evaluate(node: Node, environment: EnergyEnvironment): EnergyJet {
  if (node.kind === "number") return constant(node.value);
  if (node.kind === "variable") {
    return variable(environment[node.name], node.name === "ux" ? 0 : node.name === "uy" ? 1 : undefined);
  }
  if (node.kind === "negate") return scale(evaluate(node.value, environment), -1);
  if (node.kind === "power") return power(evaluate(node.base, environment), node.exponent);
  const left = evaluate(node.left, environment);
  const right = evaluate(node.right, environment);
  if (node.operator === "+") return add(left, right);
  if (node.operator === "-") return add(left, scale(right, -1));
  if (node.operator === "*") return multiply(left, right);
  return multiply(left, reciprocal(right));
}

function assertFinite(jet: EnergyJet): EnergyJet {
  const values = [jet.value, ...jet.gradient, ...jet.hessian[0], ...jet.hessian[1]];
  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error("The energy or one of its derivatives is not finite at the current field.");
  }
  return jet;
}

function formatExpression(node: Node, language: "cpp" | "python"): string {
  if (node.kind === "number") return String(node.value);
  if (node.kind === "variable") return node.name;
  if (node.kind === "negate") return `(-${formatExpression(node.value, language)})`;
  if (node.kind === "power") {
    const base = `(${formatExpression(node.base, language)})`;
    if (language === "python") return `(${base} ** ${node.exponent})`;
    if (node.exponent === 0) return "1.0";
    return `(${Array.from({ length: node.exponent }, () => base).join(" * ")})`;
  }
  return `(${formatExpression(node.left, language)} ${node.operator} ${formatExpression(node.right, language)})`;
}

export function compileEnergyExpression(source: string): CompiledEnergyExpression {
  if (source.trim() === "") throw new Error("Enter a per-vertex energy expression.");
  const tree = new Parser(tokenize(source)).parse();
  return {
    source,
    cppExpression: formatExpression(tree, "cpp"),
    pythonExpression: formatExpression(tree, "python"),
    evaluate(environment) {
      for (const [name, value] of Object.entries(environment)) {
        if (!Number.isFinite(value)) throw new Error(`${name} must be finite.`);
      }
      return assertFinite(evaluate(tree, environment));
    },
  };
}
