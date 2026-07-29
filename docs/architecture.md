# Architecture

The lab is split at data boundaries instead of framework boundaries.

```text
problem JSON
    │ validate
    ▼
browser controller ── message ──► Web Worker ── embind ──► C++ kernel
    │                                                   TinyAD + Eigen
    │ positions, edges, diagnostics                           │
    ▼                                                         │
Three.js viewer ◄─────────────────────────────────────────────┘
    │
    └── geometry-lab/view@1 ──► download or local bridge ──► Polyscope
```

## Core boundary

`src/core` has no rendering or solver dependency. It owns schema identifiers,
runtime validation, formatting, persistence, and repository export. A schema
change requires a migration or a new major schema identifier.

## Solver boundary

The worker owns the WebAssembly module and all mutable solver state. The main
thread sends typed requests and receives copied arrays plus scalar diagnostics.
This keeps an expensive factorization from freezing the editor or camera.

Every kernel should expose:

1. deterministic initialization from a validated problem;
2. bounded stepping, never an uninterruptible solve-to-completion call;
3. enough diagnostics to distinguish progress, convergence, and numerical
   failure;
4. geometry in a format that can be viewed without knowing the kernel.

## Viewer boundary

The Three.js viewer is the default because it is zero-install and easy to
publish. Polyscope is optional and consumes `geometry-lab/view@1`. Neither viewer
owns ground-truth solver state.

## Course embedding boundary

An enclosing course page may send a validated problem through
`geometry-lab/load-problem@1`. The lab reports readiness and scalar diagnostics
through `geometry-lab/ready@1` and `geometry-lab/diagnostics@1`. These
`postMessage` events are the entire embedding API: the parent cannot reach into
worker or solver state, and the standalone app remains fully usable without a
parent page.

## Adding a kernel

Add a discriminated problem type and validator in `src/core/problem.ts`; add a
C++ binding with deterministic initialization; extend the worker dispatch; add
one smallest-possible example and a format/kernel test. Do not add a new global
control panel before the example has a specific learning question.

libigl and geometry-central should enter as pinned CMake dependencies only when
a kernel needs them. This avoids making the first build pay for an aspirational
dependency graph.
