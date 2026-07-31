# A cozy C++-first workflow

The lab is a front door to C++ geometry processing, not an attempt to replace
it. A student should be able to inspect an experiment before installing a
toolchain, edit the important local energy with little ceremony, and then keep
the same code and data when the project becomes serious.

## The two honest execution modes

### Static mode

The published site contains a pinned WebAssembly module. It can:

- run the compiled TinyAD objectives;
- change validated parameters and objective weights;
- show gradients, Hessian sparsity, steps, and geometric certificates;
- edit and persist callback source as project text;
- export a Git-ready experiment.

It does **not** compile arbitrary C++ in a visitor's browser. Pretending that an
edited header had taken effect would make the lab pedagogically dangerous.

### Connected mode

`npm run serve:bridge` serves the same built page from loopback and adds one
trusted local endpoint. **Build + open in Polyscope** writes the edited callback
to a fixed workspace, rebuilds the native target, and launches it with the
current problem parameters.

This supplies the desired beginner loop:

1. open one page;
2. change a local TinyAD energy;
3. press one button;
4. TinyAD produces the gradient and Hessian during native execution;
5. inspect the result in Polyscope;
6. open `.lab-workspace/current` in an editor when the experiment outgrows the
   worksheet.

Because the header is compiled and executed locally, connected mode is for
trusted source only.

## One system, two front ends

The reference implementation has three layers:

```text
VertexFieldCallbacks.hh       local element energies
          │
          ▼
geometry_lab::VertexFieldSystem
mesh + variables + TinyAD assembly + Newton steps + diagnostics
          │
          ├── Embind adapter ──► Web Worker ──► Three.js
          │
          └── native app ──────► Polyscope
```

The adapters are intentionally thin. If a numerical fix appears in only the
browser or only the native application, the architecture has failed.

## Why local element programs are the right editing unit

Geometry-processing energies are usually sums over vertices, edges, faces, or
small neighborhoods. A student can reason about one element while TinyAD
handles local derivatives and global sparse assembly.

This follows the useful part of two larger systems:

- [SymX](https://github.com/InteractiveComputerGraphics/SymX) treats a local
  symbolic energy as the source of derivatives, code generation, and global
  assembly. Its native JIT and caching ideas belong in an optional native
  backend, not in the static page.
- [Simit](https://fredrikbk.com/publications/simit.pdf) connects local
  graph/mesh stencils to global sparse linear algebra. The lab's operator
  registry and element callbacks should preserve that separation.

The current callback editor is deliberately narrower: it swaps known headers
with fixed element arities. The next generalization should be a manifest that
declares unknowns, element ranges, source files, outputs, and tests. It should
not be an unrestricted shell endpoint.

## Persistent project state

The browser autosaves the current problem and callback sources in IndexedDB.
Named saves are explicit checkpoints. Exported archives should eventually
settle on this layout:

```text
experiment.json
cpp/include/ExperimentCallbacks.hh
cpp/src/main.cpp
results/
lab.lock.json
README.md
```

`experiment.json` describes data and parameters. The callback is real source.
`lab.lock.json` records dependency revisions and backend provenance. Results are
portable artifacts, not screenshots.

## Daily native loop

```sh
cmake --preset native
cmake --build --preset native
ctest --preset native
./build/native/geometry-lab-vertex-field
```

For numerical work without a window:

```sh
cmake --preset native-core
cmake --build --preset native-core
ctest --preset native-core
```

The native target accepts problem parameters on the command line. This makes
small convergence sweeps scriptable without adding browser automation.

## What remains before this is a long-lived research bench

1. Replace the callback whitelist with a versioned experiment manifest while
   retaining fixed-path, no-shell execution.
2. Add OBJ/PLY mesh loading and geometry-central-backed intrinsic operators.
3. Add convergence sweeps and manufactured solutions as first-class artifacts.
4. Export the connected workspace as a complete standalone CMake project.
5. Add an optional native code-generation backend inspired by SymX, with a
   cache keyed by source, compiler, dependency revisions, and scalar type.
6. Keep browser publication a deliberate second step after native tests pass.

The priority order is intentional: make ordinary C++ development excellent,
then make stable experiments effortless to publish.
