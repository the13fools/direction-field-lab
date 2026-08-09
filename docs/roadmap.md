# Roadmap

The roadmap is ordered by what makes the lab more trustworthy, not by spectacle.

## Reference foundation

- deterministic mass-spring sparse Newton solve;
- stepwise diagnostics and worker cancellation boundary;
- local save, file import, experiment-repository export;
- WebGL and optional Polyscope views of one snapshot.

## Geometry operators

- mesh import with explicit manifold and orientation diagnostics;
- pinned libigl parameterization examples;
- geometry-central discrete exterior calculus operators;
- sparse least-squares “integrable projection” bench with downloadable fixtures;
- convergence tests against analytic fields and manufactured solutions.

## Research exercises

- Hodge decomposition with residuals for exact, coexact, and harmonic pieces;
- vector-field design and singularity constraints;
- second-order optimization with live, safely bounded code parameters;
- a minimal shallow-water-on-surfaces experiment after the operators and tests
  are mature;
- seeded multiscale ensembles on a periodic square, sphere, and torus, with
  temporal Perlin modulation, exact/coexact/Clebsch constructions, particle
  advection, vorticity display, and invariant audits.

## Repository publishing

The current export is host-neutral and never handles credentials. A future
GitHub adapter may use OAuth/device flow to create a repository and commit an
exported experiment. It must be optional, request the narrowest scopes, and keep
tokens outside IndexedDB experiment records.
