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
