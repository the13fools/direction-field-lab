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

## Learning sequence

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
