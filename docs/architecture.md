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

Protocol v2 adds capability discovery before a course loads an experiment. The
parent sends `geometry-lab/hello@2` with a request id and receives
`geometry-lab/capabilities@2` with the same id. This lets a lesson distinguish
an unavailable numerical method from a failed run. The v1 problem messages
remain a compatibility adapter while experiments migrate.

The next v2 boundary is `geometry-lab/experiment@2` in and
`geometry-lab/result@2` out. A result owns generic triangle meshes,
mesh-associated fields, scalar metrics, convergence series, and backend
provenance. Large numerical arrays are transferable typed arrays. The course
may interpret or replot an artifact, but it still cannot reach into worker
state.

The parent should use an explicit iframe origin after it knows the instrument
URL. Protocol v2's request id prevents a stale capability reply from completing
a newer handshake.

## Experiment registry

An experiment is a versioned document, not another branch in the application
controller. It names mesh and field generators, one or more operator methods,
metrics, presets, and an optional parameter sweep. A future runtime registry
will map each operator id to a lazy-loaded backend adapter and a renderer.

Keep operator ids about mathematical behavior (`projection.hodge-edge-dec`,
`connection.phong-rodrigues`), not C++ class names. The C++/Embind surface can
change without invalidating saved experiments.

## Adding a kernel

Add a discriminated problem type and validator in `src/core/problem.ts`; add a
C++ binding with deterministic initialization; extend the worker dispatch; add
one smallest-possible example and a format/kernel test. Do not add a new global
control panel before the example has a specific learning question.

This is the legacy `problem@1` route. New literature-comparison work should add
an operator capability and experiment adapter instead. Once every existing
kernel has an adapter, the hardcoded problem union and worker dispatch can be
retired behind a v1 migration layer.

libigl and geometry-central should enter as pinned CMake dependencies only when
a kernel needs them. This avoids making the first build pay for an aspirational
dependency graph.
