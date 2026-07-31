import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { TUTORIALS } from "./problem";
import { createExperimentRepository } from "./repository-export";

describe("experiment repository export", () => {
  it("contains a portable problem and reproduction lock", async () => {
    const blob = await createExperimentRepository(TUTORIALS[0]!.problem);
    const archive = await JSZip.loadAsync(await blob.arrayBuffer());
    const problem = JSON.parse(await archive.file("experiments/problem.json")!.async("string"));
    const lock = JSON.parse(await archive.file("lab.lock.json")!.async("string"));
    expect(problem).toEqual(TUTORIALS[0]!.problem);
    expect(lock).toMatchObject({
      format: "geometry-lab/repository@1",
      problemSchema: "geometry-lab/problem@1",
      kernel: "mass-spring",
      build: {
        applicationVersion: "0.1.0",
        emscripten: "5.0.7",
      },
    });
  });

  it("includes edited callback source for a Hodge experiment", async () => {
    const source = "// edited TinyAD callback\n";
    const blob = await createExperimentRepository(TUTORIALS[3]!.problem, {
      "cpp/include/HodgeProjectionCallbacks.hh": source,
    });
    const archive = await JSZip.loadAsync(await blob.arrayBuffer());
    expect(await archive.file("cpp/include/HodgeProjectionCallbacks.hh")!.async("string")).toBe(source);
    expect(await archive.file("README.md")!.async("string")).toContain(
      "continues to run the committed Wasm kernel",
    );
  });
});
