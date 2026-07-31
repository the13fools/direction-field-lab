# Portable file formats

The schemas are small on purpose. JSON is not the fastest mesh representation;
it is the most inspectable representation for these first experiments.

## `geometry-lab/problem@1`

```json
{
  "schema": "geometry-lab/problem@1",
  "name": "First Newton step",
  "kernel": "mass-spring",
  "parameters": {
    "gridSize": 12,
    "restLength": 1,
    "springWeight": 1,
    "pinWeight": 1000,
    "jitter": 0.65,
    "seed": 17
  },
  "solver": { "iterationsPerStep": 1 }
}
```

All quantities are dimensionless in version 1. The seed and complete parameter
set make initialization reproducible.

The same schema also supports a flat-torus 1-form experiment:

```json
{
  "schema": "geometry-lab/problem@1",
  "name": "Hodge decomposition on a flat torus",
  "kernel": "hodge-1form",
  "parameters": {
    "gridSize": 14,
    "exactStrength": 1.2,
    "coexactStrength": 0.8,
    "harmonicX": 1.4,
    "harmonicY": -0.7,
    "noise": 0,
    "seed": 17
  },
  "solver": { "iterationsPerStep": 1 }
}
```

The strengths construct a reproducible input 1-form with known exact,
coexact, and harmonic content. `noise` adds a seeded arbitrary edge form before
projection.

## `geometry-lab/view@1`

```json
{
  "schema": "geometry-lab/view@1",
  "name": "First Newton step",
  "primitive": "curve-network",
  "positions": [0, 0, 0, 1, 0, 0],
  "edges": [0, 1],
  "problem": {},
  "diagnostics": {
    "energy": 0.1,
    "gradientNorm": 0.02,
    "newtonDecrement": 0.001,
    "dofs": 4,
    "hessianNonzeros": 16,
    "acceptedIterations": 1
  }
}
```

Positions are a flat xyz array and edges are flat vertex-index pairs. The full
problem travels with the snapshot so a screenshot is not the only surviving
record of an experiment.

For large meshes, a later schema may reference glTF or a binary sidecar. Version
1 readers must reject unknown schema identifiers instead of guessing.

## `geometry-lab/experiment@2`

An experiment separates the scientific question from a particular page:

```json
{
  "schema": "geometry-lab/experiment@2",
  "id": "vertex-curl-baseline",
  "title": "Vertex curl discretization observatory",
  "question": "Which discrete curl converges?",
  "inputs": {
    "mesh": {
      "operator": "mesh.torus-grid",
      "parameters": { "resolution": 16 }
    },
    "field": {
      "operator": "field.analytic-torus",
      "parameters": { "preset": "gradient" }
    }
  },
  "methods": [
    {
      "id": "primal",
      "label": "Triangle circulation",
      "operator": "curl.vertex-trapezoid-primal"
    }
  ],
  "sweep": {
    "path": "inputs.mesh.parameters.resolution",
    "values": [8, 16, 32]
  },
  "metrics": ["curl.primal-truth-error"]
}
```

Operator ids are resolved against `geometry-lab/capabilities@1`. A saved
experiment therefore fails with a precise “capability unavailable” diagnosis
rather than silently selecting a different formula.

## `geometry-lab/result@2`

A result contains one or more generic meshes and fields. Each field explicitly
records:

- its mesh;
- whether values live on vertices, edges, faces, or dual cells;
- whether values are scalars, vectors, or one-forms;
- whether components use ambient coordinates, local tangent frames, or
  oriented edges.

Local tangent vectors carry two ambient basis arrays, `basisX` and `basisY`, so
a native viewer never has to guess how two stored components sit in 3D. Edge
one-forms carry one `orientations` bit per edge. These are part of the portable
artifact because both choices affect interpretation, not merely rendering.

Scalar metrics and convergence series accompany the fields. Provenance stores
the complete experiment document, application version, and backend bundle
versions. In memory, large arrays may be typed arrays transferred from a
worker. A later persistence encoder may place them in binary sidecars without
changing their mathematical association.
