import { describe, expect, it } from "vitest";

import { EMBED_LOAD_PROBLEM, isEmbedLoadProblemMessage } from "./embed";

describe("course embedding messages", () => {
  it("recognizes the versioned load-problem envelope", () => {
    expect(
      isEmbedLoadProblemMessage({
        type: EMBED_LOAD_PROBLEM,
        problem: { schema: "geometry-lab/problem@1" },
      }),
    ).toBe(true);
  });

  it("rejects unrelated or malformed messages", () => {
    expect(isEmbedLoadProblemMessage(null)).toBe(false);
    expect(isEmbedLoadProblemMessage([])).toBe(false);
    expect(isEmbedLoadProblemMessage({ type: "geometry-lab/load-problem@2" })).toBe(false);
  });
});
