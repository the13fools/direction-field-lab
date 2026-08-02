import { describe, expect, it } from "vitest";

import { highlightCpp, highlightTypeScript } from "./code-highlight";

describe("C++ callback highlighting", () => {
  it("escapes source before adding token markup", () => {
    const highlighted = highlightCpp("if (a < b) return 0.5; // note\n");
    expect(highlighted).toContain('<span class="tok-keyword">if</span>');
    expect(highlighted).toContain("a &lt; b");
    expect(highlighted).toContain('<span class="tok-number">0.5</span>');
    expect(highlighted).toContain('<span class="tok-comment">// note</span>');
  });

  it("recognizes preprocessor lines, types, and TinyAD macros", () => {
    const highlighted = highlightCpp(
      "#include <array>\ntemplate <typename Element>\nTINYAD_SCALAR_TYPE(element)\n",
    );
    expect(highlighted).toContain('tok-preprocessor');
    expect(highlighted).toContain('<span class="tok-keyword">template</span>');
    expect(highlighted).toContain('<span class="tok-type">Element</span>');
    expect(highlighted).toContain('<span class="tok-macro">TINYAD_SCALAR_TYPE</span>');
  });
});

describe("TypeScript adapter highlighting", () => {
  it("recognizes imports, declarations, browser types, and template strings", () => {
    const highlighted = highlightTypeScript(
      "import type { Mesh } from './mesh';\nconst values: Float64Array = new Float64Array(2);\nreturn `${values}`;\n",
    );
    expect(highlighted).toContain('<span class="tok-keyword">import</span>');
    expect(highlighted).toContain('<span class="tok-keyword">const</span>');
    expect(highlighted).toContain('<span class="tok-type">Float64Array</span>');
    expect(highlighted).toContain('<span class="tok-string">`${values}`</span>');
  });
});
