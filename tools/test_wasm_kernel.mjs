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

const faceSystem = new kernels.FaceHodgeSystem();
try {
  faceSystem.init(14, 1.2, 0.8, 1.4, -0.7, 0, 17);
  const before = faceSystem.getHodgeMetrics();
  faceSystem.step(1);
  const after = faceSystem.getHodgeMetrics();

  assert.ok(before.reconstructionNorm > 1, "face input should be nontrivial before projection");
  assert.ok(after.exactNorm > 1, "mixed FEM exact component should be nontrivial");
  assert.ok(after.coexactNorm > 1, "mixed FEM coexact component should be nontrivial");
  assert.ok(after.harmonicNorm > 0.1, "mixed FEM harmonic component should be nontrivial");
  assert.ok(after.reconstructionNorm < 1e-10, "face components should reconstruct the input");
  assert.ok(after.harmonicDivergenceMax < 1e-6, "face harmonic residual should be divergence-free");
  assert.ok(after.harmonicCurlMax < 1e-6, "face harmonic residual should be curl-free");
  assert.ok(after.orthogonalityDefect < 1e-6, "mixed FEM components should be orthogonal");
  console.log("Face Hodge Wasm kernel: mixed finite-element checks passed.");
} finally {
  faceSystem.delete();
}

const vertexSystem = new kernels.VertexFieldSystem();
try {
  vertexSystem.init(16, 1, 0.35, 0.65, 0.08, 0.85, 0.18, 17);
  const before = vertexSystem.getDiagnostics();
  const integrabilityBefore = vertexSystem.getIntegrabilityMetrics();
  vertexSystem.step(12);
  const after = vertexSystem.getDiagnostics();
  const integrabilityAfter = vertexSystem.getIntegrabilityMetrics();
  const field = Array.from(vertexSystem.getField());
  const target = Array.from(vertexSystem.getTargetField());
  const dataEnergyLowerBound = 0.5 * field.reduce(
    (sum, value, index) => sum + (value - target[index]) ** 2,
    0,
  );
  assert.equal(vertexSystem.getField().length, 16 * 16 * 2, "vertex field should store two values per vertex");
  assert.equal(vertexSystem.getTargetField().length, 16 * 16 * 2, "target should store two values per vertex");
  assert.ok(Number.isFinite(after.energy), "vertex objective energy should remain finite");
  assert.ok(after.energy < before.energy, "editable vertex objective should decrease");
  assert.ok(after.gradientNorm < before.gradientNorm, "vertex optimization should reduce its gradient");
  assert.ok(
    after.energy + 1e-9 >= dataEnergyLowerBound,
    "reported energy should include the requested data term",
  );
  assert.ok(
    integrabilityAfter.curlRms < integrabilityBefore.curlRms,
    "the enabled vertex integrability term should reduce local curl",
  );
  for (const value of Object.values(integrabilityAfter)) {
    assert.ok(Number.isFinite(value), "vertex integrability diagnostics should be finite");
  }
  console.log("Vertex field Wasm kernel: data-driven objective and integrability checks passed.");
} finally {
  vertexSystem.delete();
}

const dataOnlyVertexSystem = new kernels.VertexFieldSystem();
try {
  dataOnlyVertexSystem.init(12, 1, 0, 0, 0, 0.85, 0.18, 17);
  dataOnlyVertexSystem.step(4);
  const field = Array.from(dataOnlyVertexSystem.getField());
  const target = Array.from(dataOnlyVertexSystem.getTargetField());
  const distance = Math.sqrt(field.reduce(
    (sum, value, index) => sum + (value - target[index]) ** 2,
    0,
  ));
  const diagnostics = dataOnlyVertexSystem.getDiagnostics();
  assert.ok(distance < 1e-8, "a data-only objective should recover the target field");
  assert.ok(diagnostics.energy < 1e-12, "a recovered data-only target should have zero energy");
  console.log("Vertex field Wasm kernel: stored callback weights remain valid after initialization.");
} finally {
  dataOnlyVertexSystem.delete();
}
