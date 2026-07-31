const KEYWORDS = new Set([
  "auto",
  "break",
  "case",
  "class",
  "const",
  "constexpr",
  "continue",
  "default",
  "do",
  "else",
  "enum",
  "for",
  "if",
  "namespace",
  "return",
  "struct",
  "template",
  "typename",
  "using",
  "while",
]);

const TYPES = new Set([
  "bool",
  "char",
  "double",
  "Element",
  "float",
  "int",
  "Scalar",
  "size_t",
  "void",
]);

const LITERALS = new Set(["false", "nullptr", "true"]);

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function token(kind: string, value: string): string {
  return `<span class="tok-${kind}">${escapeHtml(value)}</span>`;
}

/**
 * A deliberately small C++ lexer for the editable callback headers.
 *
 * This is presentation only: the returned markup never changes the source sent
 * to the compiler. Keeping the lexer local also keeps the static lab free of a
 * large editor dependency.
 */
export function highlightCpp(source: string): string {
  let result = "";
  let index = 0;
  let lineStart = true;

  while (index < source.length) {
    const character = source[index]!;
    const next = source[index + 1];

    if (character === "\n") {
      result += "\n";
      index += 1;
      lineStart = true;
      continue;
    }

    if (lineStart && (character === " " || character === "\t")) {
      result += character;
      index += 1;
      continue;
    }

    if (lineStart && character === "#") {
      const end = source.indexOf("\n", index);
      const stop = end === -1 ? source.length : end;
      result += token("preprocessor", source.slice(index, stop));
      index = stop;
      lineStart = false;
      continue;
    }

    if (character === "/" && next === "/") {
      const end = source.indexOf("\n", index);
      const stop = end === -1 ? source.length : end;
      result += token("comment", source.slice(index, stop));
      index = stop;
      lineStart = false;
      continue;
    }

    if (character === "/" && next === "*") {
      const end = source.indexOf("*/", index + 2);
      const stop = end === -1 ? source.length : end + 2;
      const value = source.slice(index, stop);
      result += token("comment", value);
      index = stop;
      lineStart = value.endsWith("\n");
      continue;
    }

    if (character === '"' || character === "'") {
      const quote = character;
      let stop = index + 1;
      while (stop < source.length) {
        if (source[stop] === "\\") {
          stop += 2;
          continue;
        }
        if (source[stop] === quote) {
          stop += 1;
          break;
        }
        stop += 1;
      }
      result += token("string", source.slice(index, stop));
      index = stop;
      lineStart = false;
      continue;
    }

    const remainder = source.slice(index);
    const number = remainder.match(/^(?:0[xX][0-9a-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/)?.[0];
    if (number) {
      result += token("number", number);
      index += number.length;
      lineStart = false;
      continue;
    }

    const identifier = remainder.match(/^[A-Za-z_][A-Za-z0-9_]*/)?.[0];
    if (identifier) {
      const kind = KEYWORDS.has(identifier)
        ? "keyword"
        : TYPES.has(identifier)
          ? "type"
          : LITERALS.has(identifier)
            ? "literal"
            : /^[A-Z][A-Z0-9_]+$/.test(identifier)
              ? "macro"
              : undefined;
      result += kind ? token(kind, identifier) : escapeHtml(identifier);
      index += identifier.length;
      lineStart = false;
      continue;
    }

    result += escapeHtml(character);
    index += 1;
    lineStart = false;
  }

  return result;
}
