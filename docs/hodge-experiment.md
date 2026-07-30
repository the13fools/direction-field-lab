# Hodge decomposition experiment

This experiment is the shortest honest bridge from a mesh incidence complex to
an integrable projection. It uses a periodic triangulated square—a flat torus—so
the harmonic subspace is nonzero and has the expected dimension two.

For vertex, edge, and face cochains,

```text
C⁰ --d₀--> C¹ --d₁--> C²
```

the input edge 1-form is decomposed as

```text
ω = d₀φ + δ₂ψ + h,
δ₂ = ★₁⁻¹ d₁ᵀ ★₂.
```

The first implementation deliberately uses a uniform flat mesh, so the Hodge
stars are identity weights. The two potentials are recovered from sparse least
squares:

```text
φ = argmin ½‖d₀φ - ω‖²,
ψ = argmin ½‖δ₂ψ - (ω - d₀φ)‖².
```

A one-variable gauge term removes each constant nullspace. Both objectives are
quadratic, so projected Newton reaches the minimizer in one accepted step up to
floating-point and linear-solver tolerance. The remaining 1-form `h` is checked
for both `d₁h ≈ 0` and `d₀ᵀh ≈ 0`. The UI also reports reconstruction,
orthogonality, and Pythagorean defects.

## The code panel is literal

`cpp/include/HodgeProjectionCallbacks.hh` is compiled into the committed Wasm
kernel and imported into the browser as raw text. The panel is therefore showing
the actual TinyAD element callbacks. Browser edits are saved locally and are
included in an exported experiment repository.

Arbitrary edited C++ is **not** executed by the browser. The panel marks edited
source as “modified · rebuild required”; use `npm run build:wasm` with Emscripten
to produce a new kernel. This boundary prevents the UI from claiming that a
display-only edit changed the running mathematics.

## Relation to the TinyAD examples

The organization follows TinyAD’s
[`parametrization_polymesh.cc`](https://github.com/patr-schm/TinyAD-Examples/blob/main/apps/parametrization_polymesh.cc)
and
[`parametrization_geometrycentral.cc`](https://github.com/patr-schm/TinyAD-Examples/blob/main/apps/parametrization_geometrycentral.cc):
variables are attached to mesh elements, local callbacks assemble a sparse
objective, and projected Newton uses the resulting gradient and Hessian.

The next production step is not “more optimizer.” It is importing an arbitrary
oriented manifold mesh and constructing metric-aware diagonal Hodge stars from
primal and dual measures. Geometry Central is a natural owner for that topology
and metric layer; TinyAD should remain responsible for differentiating the
chosen objective.
