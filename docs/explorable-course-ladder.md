# The explorable course ladder

The educational interface should let a student move continuously between four
descriptions of the same object:

```text
geometric picture  ↔  cochain data  ↔  sparse operator  ↔  local energy code
```

This is more useful than placing a visualization beside an unrelated formula.
Changing a coefficient in the picture must change the displayed array. Applying
an operator must show the actual matrix and update the geometric support. The
energy view must use the residual currently on screen.

## Design rules

1. **One active sentence.** Each stop begins with an action: paint a vertex,
   apply `d`, cross with `⋆`, place a singularity, or take one Newton step.
2. **Preserve the mathematical object.** The picture, vector, matrix product,
   and code are views of one state rather than canned examples.
3. **Expose one invariant immediately.** Examples include `d₁d₀ = 0`, Hodge
   reconstruction, adjointness, energy descent, or conservation of mass.
4. **Separate topology from metric.** Incidence matrices contain only `−1`,
   `0`, and `1`; lengths and areas first appear in the Hodge star.
5. **Name every representation transfer.** A reconstructed vertex vector is
   not silently identified with the edge 1-form used by DEC.
6. **End in editable local code.** A student should see which edge, face, or
   one-ring variables a TinyAD element reads and how its derivatives scatter.

## Course sequence

| Stop | Student action | Visible certificate | Research handoff |
|---|---|---|---|
| 0. Discrete forms | Paint coefficients on primal and dual supports | association, degree, orientation | cochain arrays |
| 1. Exterior derivative | Apply `d` twice | `d² = 0` | incidence matrices |
| 2. Hodge star | Cross between primal and dual meshes | diagonal metric weights and units | mass matrices |
| 3. Compositions | Build `δ ≈ ⋆d⋆` and `Δ ≈ ⋆d⋆d` | symmetry/nullspace checks | Poisson systems |
| 4. Hodge decomposition | Toggle exact, coexact, and harmonic components | reconstruction and orthogonality | solver/result artifact |
| 5. Vector representations | Compare face vectors, edge forms, and vertex tangent vectors | explicit transfer residual | chosen unknown block |
| 6. Connections | Transport between tangent frames | loop holonomy and convergence | connection data |
| 7. Integrable projection | Change curl, data, and unit objectives | curl, periods, unit defect | element program |
| 8. Live energy | Rewrite a scalar element term | exact local gradient/Hessian | generated TinyAD/Python |
| 9. Native research | Rebuild and inspect in Polyscope | native/browser parity | standalone project |
| 10. Shallow water | Couple height and velocity through paired operators | mass and energy histories | blog-quality surface simulation |

## What the DEC playground establishes

`dec-playground.html` uses a small planar hexagonal complex so every matrix fits
on screen. It implements primal and dual 0-, 1-, and 2-forms; `d` on both
complexes; circumcentric diagonal Hodge stars and their inverses; coefficient
painting; sparse-matrix inspection; and the quadratic energy naturally induced
by the current derivative.

The three composition buttons are deliberately written as paths through the
diagram:

- `d · d` makes exactness visible;
- `⋆ d ⋆` lowers degree and motivates the codifferential, up to the selected
  orientation/sign convention;
- `⋆ d ⋆ d` returns a primal 0-form and motivates a Laplacian/Dirichlet energy.

The page is not a general DEC library or a replacement for a robust sparse
factorization. Its job is to let a student predict what an operator will do
before encountering the larger Hodge kernels.

## Next pieces to implement

The next strongest additions are not more unrelated demos. They are deeper
rungs on the same objects:

1. a curved-mesh version where primal geometry, dual geometry, and tangent
   frames can be toggled without changing the cochain diagram;
2. an adjointness explorer that compares `d`, `δ`, and the selected Hodge
   inner products numerically;
3. a singularity/holonomy activity that leads directly into direction-field
   connections;
4. an energy-program schema with multiple unknown blocks (`h`, `u`, and
   derived edge flux) for the linear shallow-water step.

These additions should reuse the current result formats and code-generation
path instead of introducing page-specific hidden state.

## Related interactive references

- [Geometry Collective: Discrete Exterior Calculus](https://geometrycollective.github.io/geometry-processing-js/projects/discrete-exterior-calculus/index.html)
- [Geometry Collective: Direction Field Design](https://geometrycollective.github.io/geometry-processing-js/projects/direction-field-design/index.html)

The former demonstrates direct movement between the six DEC form spaces. The
latter demonstrates the value of editing topological data—singularities—on the
surface itself before computing a field.
