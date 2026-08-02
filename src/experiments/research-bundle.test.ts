import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { DEFAULT_ELEMENT_PROGRAM } from "./element-program";
import { buildResearchBundle } from "./research-bundle";

describe("research source bundle", () => {
  it("keeps the shared file beside generated TinyAD and Python code", async () => {
    const blob = await buildResearchBundle(DEFAULT_ELEMENT_PROGRAM, {
      pageUrl: "https://example.org/lab/energy-playground.html",
    });
    const archive = await JSZip.loadAsync(await blob.arrayBuffer());
    expect(Object.keys(archive.files)).toContain("integrable-unit-vertex-field.element-program.json");
    expect(Object.keys(archive.files)).toContain("cpp/GeneratedElementProgram.hh");
    expect(Object.keys(archive.files)).toContain("python/generated_element_program.py");
    expect(Object.keys(archive.files)).toContain("web/blog-embed.html");
    expect(Object.keys(archive.files)).toContain("web/blog-fallback.md");
  });
});
