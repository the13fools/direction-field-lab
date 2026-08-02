# One shared file from browser experiment to TinyAD

`geometry-lab/element-program@1` is the first executable research-sharing
format. The same JSON file is:

- edited and run by the static unit-field workshop;
- encoded into a shareable URL;
- downloaded as the record of the experiment;
- translated into matching TinyAD and Python element functions;
- kept beside browser and Polyscope result artifacts.

The reference file is
[`examples/integrable-unit-vertex-field.element-program.json`](../examples/integrable-unit-vertex-field.element-program.json).

## Explicit representation

```json
"unknown": {
  "id": "u",
  "association": "vertex",
  "dimension": 2,
  "frame": "tangent"
}
```

This prevents a face vector, edge 1-form, and reconstructed vertex arrow from
silently becoming the same thing. A future multi-field schema will use the same
association/frame vocabulary for height, flux, and velocity variables.

## Sparse element ranges

The initial vocabulary deliberately exposes one term on each mesh domain:

```text
vertex  expression             editable scalar energy e(u_i, target_i)
edge    connection-difference  ||u_j - R_ij u_i||²
face    triangle-circulation   circulation_f(u)² / area_f
```

For each element the browser creates active local scalars, evaluates the term,
and scatters its gradient and Hessian through the element's global DOF map.
Edge and face terms therefore contribute off-diagonal Hessian blocks. The page
reports the expanded global nonzero count and uses the sparse matrix in its PCG
Newton step.

This is the web analogue of TinyAD's core workflow, not a claim of feature
parity. TinyAD remains the larger-project backend for mature solvers, constraints,
robust sparse factorizations, and Polyscope applications.

## Code generation direction

The shared file is canonical. Generating C++ from a constrained mathematical
IR is reliable; reconstructing the IR from arbitrary C++ is not. The generated
header contains:

- `generated_vertex_energy`;
- `generated_connection_energy`;
- `generated_circulation_energy`;
- parameter, target, connection, and precomputed triangle-coefficient structs.

A C++-first researcher can keep the JSON beside a hand-edited implementation
and preserve the callback names/data contracts. A later annotation tool can
extract those contracts from a narrow TinyAD template, but the website should
not pretend it can safely interpret general C++ on a static host.

## Next schema extension for shallow water

The next version needs multiple unknown blocks and time levels:

```text
h        vertex scalar                 water-surface height
u        vertex tangent vector (2)     velocity
alpha    edge 1-form, derived/audited  line-integrated flux
h_prev   vertex scalar input           previous time level
u_prev   vertex tangent input           previous time level
```

It must also declare mass matrices and the paired operators `G` and
`D = -M_h^{-1} G^T M_u`. The first student slot should be the pressure/gravity
energy of a linear wave step. Advection, wet/dry fronts, and surface tension do
not belong in the first live program.
