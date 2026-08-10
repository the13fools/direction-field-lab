import { readFileSync, statSync } from "node:fs";

const pages = ["index.html", "vertex-curl.html", "energy-playground.html", "dec-playground.html", "getting-started.html", "shallow-water.html", "clebsch-shallow-water.html", "random-fluids.html", "representations.html", "references.html"];
const assets = ["wasm/gp_lab_kernels.js", "wasm/gp_lab_kernels.wasm", "og.png", "random-fluids-og-v2.png"];
const failures = [];

for (const path of [...pages, ...assets]) {
  try {
    if (statSync(`dist/${path}`).size === 0) failures.push(`${path} is empty`);
  } catch {
    failures.push(`${path} is missing`);
  }
}

for (const page of pages) {
  let source = "";
  try {
    source = readFileSync(`dist/${page}`, "utf8");
  } catch {
    continue;
  }
  if (/\b(?:src|href)=["']\/(?:assets|wasm)\//.test(source)) {
    failures.push(`${page} contains a root-relative built asset and will break on a repository subpath`);
  }
  if (/\b(?:src|href)=["']\/src\//.test(source)) {
    failures.push(`${page} still points at unbuilt source code`);
  }
}

if (failures.length > 0) {
  console.error(`Static-host check failed:\n- ${failures.join("\n- ")}`);
  process.exitCode = 1;
} else {
  console.log(`Static-host check passed: ${pages.length} pages, committed Wasm, and subpath-safe assets.`);
}
