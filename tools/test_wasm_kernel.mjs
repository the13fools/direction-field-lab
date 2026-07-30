import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const moduleFactory = (await import("../public/wasm/gp_lab_kernels.js")).default;
const wasmBinary = await readFile(new URL("../public/wasm/gp_lab_kernels.wasm", import.meta.url));
const kernels = await moduleFactory({ wasmBinary });

const system = new kernels.HodgeDecompositionSystem();
try {
  system.init(14, 1.2, 0.8, 1.4, -0.7, 0, 17);
  const before = system.getHodgeMetrics();
  system.step(1);
  const after = system.getHodgeMetrics();

  assert.ok(before.reconstructionNorm > 1, "input should be nontrivial before projection");
  assert.ok(after.exactNorm > 1, "exact component should be nontrivial");
  assert.ok(after.coexactNorm > 1, "coexact component should be nontrivial");
  assert.ok(after.harmonicNorm > 0.1, "harmonic component should be nontrivial");
  assert.ok(after.reconstructionNorm < 1e-10, "components should reconstruct the input");
  assert.ok(after.harmonicDivergenceMax < 1e-6, "harmonic residual should be co-closed");
  assert.ok(after.harmonicCurlMax < 1e-6, "harmonic residual should be closed");
  assert.ok(after.orthogonalityDefect < 1e-6, "Hodge components should be orthogonal");
  assert.ok(after.pythagoreanDefect < 1e-6, "component energies should satisfy Pythagoras");
  console.log("Hodge Wasm kernel: reconstruction, harmonicity, and orthogonality checks passed.");
} finally {
  system.delete();
}
