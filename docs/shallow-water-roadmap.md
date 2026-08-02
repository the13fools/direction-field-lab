# From Hodge decomposition to shallow water on surfaces

The target is not to ask beginners to implement a full fluid solver at once.
The course should expose a sequence of least-squares projections and sparse
solves whose composition eventually becomes a surface shallow-water method.

The reference target is Huamin Wang, Gavin Miller, and Greg Turk, *Solving
General Shallow Wave Equations on Surfaces* (SCA 2007). Its state consists of a
normal water height and a tangent velocity field. The method combines
characteristic advection with an implicit sparse height solve; gravity gives a
symmetric one-ring system, while surface tension introduces a
Laplace--Beltrami/roughly bi-Laplacian contribution.

## Runnable baseline now in the lab

`shallow-water.html` implements the first deliberately small milestone on a
flat periodic grid. It advances vertex height and vertex tangent velocity with
a centered adjoint gradient/divergence pair, derives an oriented-edge flux,
and exposes mass drift, energy, curl, CFL, and the adjointness defect. Students
can replace the scalar height potential `V(h)` in the browser; its first and
second derivatives are generated without recompiling.

A passive dye is advected only as a visualization audit. It makes a seeded,
discretely divergence-free vortex visibly move something while the height
field remains flat. This is intentionally not yet advection of the physical
shallow-water state.

This is not presented as the final surface discretization. Its role is to make
the contracts executable before curvature and transport enter: a pressure
increment is a vertex gradient, mass is conserved by the periodic divergence,
and a seeded vortical mode cannot be represented away by an irrotational
pressure update. The next implementation step is a matched vorticity/divergence
or vorticity/streamfunction state with the same audits, followed by replacing
the flat operators with mass-matrix-aware surface operators.

## Learning sequence

The main workbench mirrors this sequence as four collapsible chapters:
variational foundations, Hodge representations, integrable projection, and a
compact shallow-water roadmap. New experiments should earn a place in that
spine by supplying a distinct representation, invariant, or convergence test;
otherwise they belong in a manifest or a separate research branch rather than
another permanent sidebar item.

### 1. Sparse least squares on a mesh

Build one quadratic energy from local residuals. Inspect its gradient, Hessian,
null space, and boundary conditions. Compare a dense toy system with sparse
assembly.

**Deliverable:** a manufactured problem whose residual converges under
refinement.

### 2. Scalar potential and integrable projection

Given a noisy tangent field `u`, solve

```text
min_phi ||grad(phi) - u||^2_M.
```

Separate the mathematical operator from its vertex-, edge-, or face-based
discretization. Gauge-fix the constant null space explicitly.

**Deliverable:** exact-gradient recovery plus a counterexample with a harmonic
period on a torus.

### 3. The three Hodge representations

Run matched experiments for:

- face-based piecewise-constant vectors;
- oriented edge 1-forms with DEC;
- vertex tangent vectors with a discrete connection.

Do not imply that converting an edge 1-form to vertex arrows creates a native
vertex Hodge complex. Record what inner product, derivative, codifferential, and
boundary condition each formulation uses.

**Deliverable:** a convergence table and an explanation of every residual.

### 4. Linear waves on a fixed surface

Introduce height `h` and tangent velocity `u` without advection or wet/dry
fronts. Assemble discrete gradient and divergence as adjoints under the chosen
mass matrices:

```text
h_t + div(H u) = 0
u_t + g grad(h) = 0.
```

Check mass conservation and the spectrum of the linearized operator.

**Deliverable:** a pulse propagating on a plane, sphere, and torus with a
timestep/refinement study.

### 5. Implicit gravity step

Eliminate velocity to obtain the sparse height system. Compare an explicit
step, backward Euler, and a second-order method. The lab should show why the
implicit solve permits a larger timestep and how numerical damping changes the
wave.

**Deliverable:** measured stability regions, not merely a pleasing animation.

### 6. Surface tension and curvature

Add the Laplace--Beltrami pressure term. Compare the complete wider stencil with
the paper's incomplete one-ring approximation. Report symmetry, definiteness,
iteration count, and visible dispersion.

**Deliverable:** a solver comparison with PCG where the matrix is SPD and an
appropriate nonsymmetric method when it is not.

### 7. Advection and the full method

Only now add characteristic tracing, external forces, obstacles, changing
bottom height, and wet/dry handling. Treat each as a separate diagnostic
exercise.

**Deliverable:** reproduce one paper-style scene and list every place where the
modern triangle-mesh implementation differs from the 2007 particle
discretization.

## Architecture needed by the lab

Each exercise should be one project manifest with:

- mesh and field representation;
- local element programs;
- sparse operator choices and mass matrices;
- boundary/gauge conditions;
- timestep and nonlinear-solver settings;
- manufactured truth, invariants, and convergence metrics;
- viewer quantities for both Three.js and Polyscope.

The browser should remain good for reading, changing parameters, and inspecting
small operators. Connected/native mode should own compilation, large sparse
systems, profiler access, and long simulations.

## Student scaffold: variables fixed before the energy is assigned

To continue the vertex-field teaching path, the first live linear-wave demo
should arrive with these arrays already allocated and visualized:

| id | association | dimension | meaning |
| --- | --- | ---: | --- |
| `h` | vertex | 1 | water-surface height at the new time level |
| `u` | vertex tangent frame | 2 | velocity at the new time level |
| `h_prev` | vertex | 1 | fixed height from the previous time level |
| `u_prev` | vertex tangent frame | 2 | fixed previous velocity |
| `alpha` | oriented edge, derived | 1 | line-integrated velocity used to audit flux/curl |

The scaffold—not student code—should provide vertex and vector mass matrices,
a named scalar-to-vertex-tangent gradient `G`, its mass adjoint
`D = -M_h^{-1} G^T M_u`, boundary/gauge handling, the mesh, and the initial
height pulse. The first editable program should contain only the pressure or
implicit linear-wave energy. The viewer should already show `h`, `u`, derived
`alpha`, total mass, discrete energy, and the `G`/`D` adjointness defect.

This keeps the research question focused: students can change one energy and
immediately see whether it produces a plausible, conservative wave, then
export the same declared element ranges to TinyAD. The required multi-block
extension of `element-program@1` is outlined in
[`shared-element-program.md`](shared-element-program.md).

## First implementation milestone

Before adding fluids, finish a credible integrable-projection bench:

1. load a triangle mesh;
2. author a vertex tangent field;
3. switch among face, edge, and connection-based formulations;
4. solve the least-squares projection;
5. display exact, coexact, and harmonic diagnostics;
6. run the same experiment in the browser and Polyscope from one shared C++
   numerical system;
7. save a refinement sweep as a portable result artifact.

That milestone exercises nearly every architectural requirement of the later
shallow-water solver without hiding mistakes behind a complicated animation.

## SGI blog vertical slice

The first publishable demo should stop at linear gravity waves on one closed
surface. It should expose timestep, gravity, pulse location, and resolution;
plot total mass, discrete energy, and gradient/divergence adjointness; and
download the same state that the local Polyscope viewer opens. Keeping this as
a static embeddable page makes it suitable for an SGI project blog while the
research version continues in the native project.

The element-program and publication loop needed for that demo is specified in
[`research-sharing-workflow.md`](research-sharing-workflow.md).
