import { describe, expect, it } from "vitest";

import { DEFAULT_ELEMENT_PROGRAM } from "./element-program";
import {
  experimentPublicationUrls,
  generateBlogEmbedHtml,
  generateBlogMarkdown,
} from "./experiment-publishing";

describe("experiment publishing", () => {
  it("preserves a complete program across full and embedded URLs", () => {
    const urls = experimentPublicationUrls(
      "https://example.org/lab/energy-playground.html?embed=1",
      DEFAULT_ELEMENT_PROGRAM,
    );
    expect(new URL(urls.full).searchParams.has("embed")).toBe(false);
    expect(new URL(urls.embed).searchParams.get("embed")).toBe("1");
    expect(new URL(urls.full).hash).toContain("program=");
    expect(new URL(urls.embed).hash).toBe(new URL(urls.full).hash);
  });

  it("emits an iframe plus an accessible full-page fallback", () => {
    const source = generateBlogEmbedHtml("https://example.org/lab/energy-playground.html", DEFAULT_ELEMENT_PROGRAM);
    expect(source).toContain("<iframe");
    expect(source).toContain("embed=1");
    expect(source).toContain("Open the full lab");
    expect(generateBlogMarkdown("https://example.org/lab/energy-playground.html", DEFAULT_ELEMENT_PROGRAM))
      .toContain("static hosting");
  });
});
