# Face, edge, and vertex vector-field exercises

These exercises follow the distinction emphasized by Fernando de Goes,
Mathieu Desbrun, and Yiying Tong in *Vector Field Processing on Triangle
Meshes* (SIGGRAPH 2016 course notes). The representations are not interchangeable
containers. They have different degrees of freedom, interpolation rules,
operators, and continuity.

The standalone `representations.html` breakout gives this distinction one
compact visual treatment. It keeps a native vertex field fixed, transfers it
to oriented edge integrals, reconstructs constant face vectors, and area
averages them back to vertices. Its circulation, face-fit, and round-trip
residuals make clear which view is an unknown and which is only a derived
audit. The main objective workshop remains vertex-only after this detour.

## 04 - Face fields: mixed finite elements

The unknown input is one constant tangent vector per triangle. The exact part
is found by fitting gradients of conforming P1 scalar functions, with one scalar
per vertex:

```text
min_f  1/2 sum_t area(t) || grad f |_t - u_t ||^2.
```

The coexact part is fitted with rotated gradients of non-conforming
Crouzeix-Raviart P1 functions, with one scalar per edge midpoint:

```text
min_g  1/2 sum_t area(t) || J grad_CR g |_t - (u - grad f)_t ||^2.
```

The mixture is essential. On a closed genus-g mesh its dimensions leave a
2g-dimensional harmonic remainder. Using the same scalar basis for both pieces
creates spurious harmonic modes.

## 05 - Edge fields: identity-weighted cochain Hodge split

The unknown input is a signed line integral on every oriented edge. TinyAD
solves the two least-squares projections in the discrete de Rham complex:

```text
c = d phi + delta psi + h.
```

The exterior derivative is an incidence matrix. This first baseline uses the
identity inner product on cochains, so its transpose-incidence codifferential is
not yet a geometry-dependent DEC Hodge star. The topological identity
`d1 d0 = 0` is exact, and closedness and co-closedness are tested before any
vector glyph is reconstructed. A later metric DEC comparison should replace
the unit weights with explicit primal/dual measures.

## 06 - Vertex reconstruction: an audit, not a new complex

Whitney interpolation first maps the edge 1-form to one vector per face in the
same flat periodic complex used by the solver. Those vectors are area averaged,
then their two flat coordinates are lifted into tangent frames on the decorative
torus. Reconstructing directly on the curved display mesh would silently change
the metric. The result is useful for display and for transferring data into a
vertex-oriented application.

It is not a native vertex Hodge decomposition. The SIGGRAPH 2016 notes point
out that the then-current vertex basis did not supply an adjoint gradient with
`curl(grad) = 0`, so the correct harmonic dimension was not guaranteed. The
exercise deliberately keeps the edge certificates visible so students can say
which claims belong to the source complex and which belong only to the rendered
field.

## 07 - Native vertex fields: editable TinyAD objective

The final exercise stores two tangent-frame coordinates at every vertex. A
simplicial connection supplies a 2x2 transport rotation for each edge. The live
objective is

```text
E(u) =
  dataWeight / 2 * sum_v ||u_v - target_v||^2
  + connectionSmoothnessWeight / 2 * sum_ij ||u_j - R_ij u_i||^2
  + integrabilityWeight / 2 * sum_f circulation_f(u)^2 / area(f)
  + lengthWeight / 2 * sum_v (||u_v||^2 - targetLength^2)^2.
```

Exercise 07 sets `integrabilityWeight` to zero so students can first isolate
the data, connection-smoothing, and length terms.

## 08 - Vertex integrability: triangle circulation

The local integrability row is assembled from the same native vertex unknowns.
At every oriented triangle `f = (i,j,k)`, endpoint vectors are lifted from
their tangent frames to ambient coordinates and trapezoid-integrated around
the boundary:

```text
circulation_f(u) =
  1/2 (u_i + u_j) dot (p_j - p_i)
  + 1/2 (u_j + u_k) dot (p_k - p_j)
  + 1/2 (u_k + u_i) dot (p_i - p_k).
```

Dividing by face area estimates scalar curl. Penalizing its area-weighted
square makes the field locally closed. It does **not** make the field globally
exact on a torus: the viewer separately reports periods along the two canonical
cycles. This distinction is the teaching point of the first vertex-based
integrability operator, not a missing implementation detail.

The callback vocabulary is compiled into WebAssembly, but every coefficient is
read from the editable problem JSON. **Reset + build** sends the new values
through the worker into the TinyAD objective. Setting a weight to zero removes
that term. This is safer and more reproducible than pretending a browser can
silently reinterpret edited C++ without recompilation.

Useful experiments:

- Set `connectionSmoothnessWeight` to zero and predict the data-only result.
- Raise `integrabilityWeight` and compare local curl before and after solving.
- Make local curl small, then explain why either torus period can remain.
- Set `dataWeight` to zero and compare several positive length weights.
- Set `lengthWeight` to zero and inspect the convex quadratic problem.
- Increase `gridSize` and compare degrees of freedom with Hessian nonzeros.

The next extension should turn the two reported periods into optional
constraints, then add user-authored boundary or singularity terms to this same
data-driven callback vocabulary. That is a more honest route toward a
vertex-based Hodge-like projection than relabeling an edge solve.

## 09 - Integrable and as unit as possible

This lesson enables both nonlinear unit-length and triangle-circulation
penalties on the native vertex unknowns:

```text
min_u E_data(u) + μ/2 sum_f circulation_f(u)^2 / area(f)
                    + ν/2 sum_i (||u_i||^2 - L^2)^2.
```

Finite `μ` and `ν` make this an intentionally soft projection. The viewer shows
where a rotating target sacrifices data fidelity, curl-freedom, or unit length
rather than calling the result exactly integrable and unit.

## 10 - Compare curl locations and connection models

The standalone curl observatory adds a manufactured-solution layer around the
native vertex-field questions. It samples analytic gradient, harmonic, vortex,
and mixed fields on a torus and compares two circulation domains:

- oriented triangle boundaries, producing one curl value per face;
- positive barycentric dual boundaries, producing one curl value per vertex.

Both begin with the same endpoint-trapezoid edge integral. Keeping the output
associations distinct in `result@2` prevents a viewer from treating the two
arrays as interchangeable samples.

The connection comparison is deliberately separate. Endpoint minimal-normal
rotation uses the embedding. The intrinsic baseline normalizes each one-ring's
corner angles to a polar chart and compares edge directions. The latter is a
useful controlled baseline, not a universal canonical connection. Both are
measured against analytic Levi–Civita transport on the reference torus and both
must be read over the manifest's refinement sweep.

## 11 - Rewrite the local energy in the browser

The standalone unit-energy workshop accepts a small arithmetic language over
`ux`, `uy`, `tx`, `ty`, `data`, `unit`, and `length`. The shared
`element-program@1` file also declares the edge connection and face circulation
terms. Second-order jets differentiate each local element, scatter complete
off-diagonal blocks into a sparse global Hessian, and solve a damped Newton
system with diagonally preconditioned conjugate gradients.

The page is not yet a fully general sparse element compiler: the available
vertex, edge, and face term kinds are a small validated vocabulary. It is the
first vertical slice of the element-program IR described in
`docs/research-sharing-workflow.md`.
