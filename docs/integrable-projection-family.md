# Which integrable projection are we computing?

“Integrable projection” names a family of problems, not one canonical solver.
The useful comparison axes are:

- the field representation and compatibility operator `C`;
- the inner product or mass matrix defining “closest”;
- whether integrability is a hard constraint or a finite penalty;
- whether direction, magnitude, or both may change;
- boundary conditions, singularities, and global periods.

## Soft penalty: the current vertex lesson

```text
min_w E_fit(w) + μ/2 ||Cw||².
```

This formulation is convenient for a live TinyAD objective. Increasing `μ`
suppresses the chosen circulation residual. For finite `μ`, however, it is not
an exact projection onto `ker C`. It is the right baseline for studying scaling,
conditioning, and continuation before adding constrained solves.

## Closest integrable field: Hodge projection

```text
min_δ 1/2 ||δ||²_M   subject to C(w + δ) = 0.
```

This asks for the closest compatible field in a specified metric. The lab's
face and edge Hodge lessons belong to this family, but use different native
unknowns and inner products. They should agree only after an explicit transfer
and a convergence study—not because their arrows happen to look similar.

## Direction-preserving rescaling

```text
min_(s,δ) 1/2 ||δ||² + λ/2 ||∇s||²
subject to C(sw + δ) = 0 and a normalization of (s,δ).
```

Here the projected field can change magnitude through a scalar factor `s`
while staying close to the input direction. This is a natural follow-up for
streamline, stripe, and weaving applications. A manufactured test should check
angular error separately from magnitude error.

## Integrable and approximately unit

The current unit-aware vertex lesson keeps the native field `w` and applies
finite penalties to both circulation and squared-length defect:

```text
min_w E_fit(w) + μ/2 ||Cw||² + ν/2 sum_i (||w_i||² - 1)².
```

It is “as integrable and unit as possible,” not an exact constrained
projection. A geodesic-field variant instead substitutes an exactly integrable
field `∇u` and is closely related to an Aviles-Giga energy:

```text
min_u 1/2 (||∇u||² - 1)² + λ/2 ||∇(∇u)||².
```

Unlike the first two families, this is nonconvex and can form defects. It should
come after the linear compatibility operators are well tested.

## Recommended implementation order

1. Repair and validate the closest-field projections with manufactured exact,
   coexact, and harmonic inputs.
2. Add a hard-constraint or null-space version next to the existing soft
   circulation penalty.
3. Add direction-preserving rescaling, reporting angular and magnitude error
   independently.
4. Promote the existing unit-aware penalties to a constrained or
   potential-based geodesic variant, with continuation and explicit defect
   diagnostics.

This order reuses one compatibility operator while changing one modeling choice
at a time.
