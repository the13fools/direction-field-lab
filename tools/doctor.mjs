import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const checks = [];
const nodeMajor = Number(process.versions.node.split(".")[0]);
checks.push({
  label: `Node ${process.versions.node}`,
  required: true,
  ok: nodeMajor >= 22,
  help: "Install Node 22 or newer (the repository includes .nvmrc and .node-version).",
});

for (const file of ["package.json", "public/wasm/gp_lab_kernels.js", "public/wasm/gp_lab_kernels.wasm"]) {
  checks.push({
    label: file,
    required: true,
    ok: existsSync(file),
    help: `Restore ${file} from the repository checkout.`,
  });
}

function commandVersion(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  return result.status === 0 ? (result.stdout || result.stderr).trim().split("\n")[0] : null;
}

const git = commandVersion("git", ["--version"]);
checks.push({ label: git ?? "Git", required: true, ok: Boolean(git), help: "Install Git to clone and checkpoint experiments." });
const cmake = commandVersion("cmake", ["--version"]);
checks.push({ label: cmake ?? "CMake (optional)", required: false, ok: Boolean(cmake), help: "CMake 3.24+ is needed only for native TinyAD/Polyscope work." });
const compiler = commandVersion(process.platform === "win32" ? "cl" : "c++", ["--version"]);
checks.push({ label: compiler ? `C++ compiler: ${compiler}` : "C++ compiler (optional)", required: false, ok: Boolean(compiler), help: "A C++20 compiler is needed only for the student-starter/native path." });

console.log("Geometry Processing Lab · environment check\n");
for (const check of checks) {
  const icon = check.ok ? "✓" : check.required ? "✗" : "○";
  console.log(`${icon} ${check.label}${check.ok ? "" : `\n  ${check.help}`}`);
}

const failed = checks.filter((check) => check.required && !check.ok);
if (failed.length > 0) {
  console.error("\nFix the required checks above, then run npm run doctor again.");
  process.exitCode = 1;
} else {
  console.log("\nBrowser path ready: npm run dev");
  console.log(cmake && compiler ? "Native prerequisites detected: continue with the student-starter when ready." : "Native tools are optional; the browser lab is ready now.");
}
