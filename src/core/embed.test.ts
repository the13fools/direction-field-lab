import { describe, expect, it } from "vitest";

import {
  EMBED_HELLO_V2,
  EMBED_LOAD_PROBLEM,
  isEmbedHelloV2Message,
  isEmbedLoadProblemMessage,
} from "./embed";

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

  it("recognizes a protocol-v2 capability handshake", () => {
    expect(
      isEmbedHelloV2Message({
        type: EMBED_HELLO_V2,
        requestId: "course-session-17",
      }),
    ).toBe(true);
    expect(isEmbedHelloV2Message({ type: EMBED_HELLO_V2, requestId: "" })).toBe(false);
  });
});
