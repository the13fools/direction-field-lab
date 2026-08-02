# From a live energy to a shareable research project

The long-term interface should feel closer to a geometry-processing
“energy toy” than to a remote IDE. A reader opens a static experiment, changes
one local mathematical program, sees the consequences, and can take that exact
program into a serious sparse C++ or Python project.

## What works now

The unit-field workshop is the first end-to-end slice:

1. one `element-program@1` file declares the vertex tangent unknown, mesh,
   manufactured target, parameters, and vertex/edge/face terms;
2. the per-vertex scalar energy is parsed from a safe arithmetic language;
3. second-order jets differentiate every local element without `eval` or
   recompilation;
4. local Hessian blocks scatter into a complete sparse symmetric global
   Hessian, including edge and face off-diagonal couplings;
5. a diagonally preconditioned conjugate-gradient solve computes a damped
   sparse Newton direction, followed by backtracking;
6. the complete file is editable, importable, downloadable, and shareable in a
   static URL;
7. the file generates matching TinyAD callbacks and Python functions for every
   declared element range;
8. the main application can export a project, compile a fixed local TinyAD
   target, and open a shared result in Polyscope.
9. the same program can render in a compact `?embed=1` reader view and export
   an iframe plus a linked fallback for a static research blog.

The current web backend is intentionally small, but it now has the same central
decomposition as TinyAD: differentiate a local element, scatter its gradient
and Hessian through a DOF map, then solve the resulting sparse system. It does
not yet provide a production sparse direct factorization, constraints, multiple
unknown blocks, or arbitrary user-authored element neighborhoods.

## The missing abstraction: an element-program IR

A general experiment should describe five things independently:

```text
topology     vertex | edge | face | one-ring element range
unknowns     entity association, dimension, initial values
inputs       geometry, fields, parameters, connection data
program      scalar or residual-vector expression per element
outputs      fields, certificates, plots, portable result artifacts
```

The local program now begins to compile to several backends:

- a browser second-order AD evaluator plus sparse scatter/PCG assembly;
- TinyAD C++ callbacks using the same vertex, edge, and face variables;
- plain Python functions compatible with an AD array library;
- eventually an LLVM/Enzyme path for larger existing compiled programs.

[Enzyme](https://enzyme.mit.edu/) is complementary rather than a replacement
for this IR: it differentiates existing code at LLVM level across several
languages, while the lab still needs mesh element ranges, sparsity/scatter
structure, boundary conditions, and viewer metadata.

## The round trip

```text
static URL
  expression + mesh + parameters + expected certificates
       │
       ├── browser AD + sparse assembly ──► interactive result@2
       │
       ├── generated TinyAD/Python ───────► standalone project
       │                                      │
       └──────────────────────────────────────┤
                                              ▼
                                      native solve + Polyscope
                                              │
                                              ▼
                                      imported result@2 / sweep
```

The portable experiment ID and content hash should survive this round trip.
That makes a web result a reproducible entry point, not a screenshot of a
separate implementation.

## One-click publication without a dangerous compiler service

The near-term publishing unit is a repository fork:

1. generate or export the small project;
2. run native and Wasm tests in the fork's CI;
3. publish the committed Wasm bundle and experiment artifact to static hosting;
4. embed the resulting page in a paper, course page, or research blog.

The workshop implements the last step directly. Its publication kit contains
the exact element program, blog iframe, no-iframe Markdown fallback, generated
TinyAD header, and Python reference. The compact reader view intentionally
keeps only the field, certificates, solver buttons, and the three weights that
explain the main compromise. Source editing remains one click away on the full
page rather than being squeezed into the article figure.

The local bridge may compile whitelisted files and launch fixed targets. A
public service must instead isolate untrusted compilation, remove network and
secrets, enforce strict resource limits, and return Wasm without executing the
submitted native binary. `docs/cpp-first-workflow.md` records that boundary.

## Shallow-water publication target

The first blog-quality surface-flow experiment should be a deliberately small
vertical slice:

- a fixed plane, sphere, or torus mesh;
- height and one explicitly named velocity/flux representation;
- paired gradient and divergence with a displayed adjointness defect;
- a linear gravity-wave step before advection or wet/dry fronts;
- live timestep, gravity, and initial-pulse controls;
- mass and discrete-energy histories;
- a refinement/timestep preset that downloads a `result@2` sweep;
- a Polyscope handoff using the same state and operators.

That is enough for an interactive SGI blog embed while remaining auditable.
Advection, surface tension, obstacles, and changing bottom height should only
arrive after the linear wave conserves the quantities it claims to conserve.
