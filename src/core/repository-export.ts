import JSZip from "jszip";
import type { Problem } from "./problem";

export const KERNEL_BUILD = {
  applicationVersion: "0.1.0",
  eigen: "f1df74068ea982ba88964460b534ce296c70b40d",
  tinyad: "4b48d1a1a588874556a692a3abbdecd0db4c23e1",
  emscripten: "5.0.7",
} as const;

export async function createExperimentRepository(
  problem: Problem,
  sourceFiles: Record<string, string> = {},
): Promise<Blob> {
  const zip = new JSZip();
  const sourceDescription = Object.keys(sourceFiles).length
    ? "- `cpp/`: editable callback source exported with this experiment\n"
    : "";
  zip.file("README.md", `# ${problem.name}\n\nThis experiment was exported from Geometry Processing Lab.\n\n## Contents\n\n- \`experiments/problem.json\`: the versioned problem definition\n- \`lab.lock.json\`: the format and kernel contract used for reproduction\n${sourceDescription}\nImport \`experiments/problem.json\` in a compatible Geometry Processing Lab deployment. Edited C++ source must be rebuilt with the pinned Emscripten/TinyAD toolchain before it changes the running kernel.\n`);
  zip.file("experiments/problem.json", `${JSON.stringify(problem, null, 2)}\n`);
  zip.file(
    "lab.lock.json",
    `${JSON.stringify(
      {
        format: "geometry-lab/repository@1",
        problemSchema: problem.schema,
        kernel: problem.kernel,
        build: KERNEL_BUILD,
      },
      null,
      2,
    )}\n`,
  );
  zip.file(".gitignore", ".DS_Store\n*.log\n");
  zip.file("LICENSE", "Experiment data and configuration are dedicated to the public domain under CC0-1.0.\n");
  for (const [path, source] of Object.entries(sourceFiles)) zip.file(path, source);
  return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
}

export async function downloadRepositoryArchive(
  problem: Problem,
  sourceFiles: Record<string, string> = {},
): Promise<void> {
  const blob = await createExperimentRepository(problem, sourceFiles);
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${problem.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "geometry-experiment"}.zip`;
  link.click();
  URL.revokeObjectURL(link.href);
}
