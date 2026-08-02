# Geometry Processing Starter Kit

This is a small C++ project for your first geometry-processing experiment. It
creates a triangle grid, puts a two-dimensional vector at every vertex,
optimizes those vectors with TinyAD, and displays the result in Polyscope. The
sidebar includes an ImPlot convergence chart for energy, gradient norm, and
triangle-curl RMS, following the diagnostic pattern used by Mint3D.

You do **not** need to understand the Direction Field Lab web application
to use this folder. You can copy `geometry-processing-starter-kit/` into a new repository and
build it on its own.

The starter is intentionally tiny:

```text
geometry-processing-starter-kit/
├── CMakeLists.txt   fetches pinned dependencies and builds one executable
├── main.cpp        objective, Newton loop, and a small viewer callback
├── starter_support.hh generated grid, diagnostics, and display conversions
├── starter_optional_mesh_libraries.hh optional libigl / Geometry Central adapter
├── README.md       the guide you are reading
└── LICENSE         permission to reuse and modify the starter
```

## Before you compile: sketch the experiment in the browser

The static lab and this native starter are two views of the same teaching
sequence. In the browser workshop, choose **Draggable handles** to author a
target field, inspect its harmonic extension, and compare an edge-Hodge
projection, unit-aligned penalties, and a periodic stripe realization. Export
the TinyAD header when the local energy says what you intend.

The separate shallow-water starter fixes the first dynamics variables for you:
vertex height `h`, vertex tangent velocity `u`, and a derived oriented-edge
flux `alpha`. Its editable `V(h)` is a useful place to test a pressure energy
before moving the operator or state into C++. The browser is for rapidly
forming a precise question; this folder is where you change neighborhoods,
representations, sparse solves, and the Polyscope inspection workflow.

## What you will see

The target field rotates around the center of a flat grid:

```text
u_target(x, y) = (-y, x).
```

That field has nonzero curl. The optimization balances three requests:

```text
E(u) = w_data E_data(u)
     + w_unit E_unit(u)
     + w_curl E_curl(u).
```

- `E_data` keeps the answer near the rotating target.
- `E_unit` softly encourages vectors to have unit length.
- `E_curl` penalizes circulation around every triangle.

The data and curl terms disagree on purpose. This gives you something visible
to investigate: increasing the curl weight produces a more locally integrable
field, but moves it farther from the rotating target.

This is a **soft-penalty projection**, not the unique thing called “the
integrable projection.” For a finite curl weight, circulation is reduced rather
than constrained to vanish exactly. Useful next variants include the closest
curl-free field in a chosen mass norm, a direction-preserving projection that
may rescale the input, and an integrable approximately unit field. Each answers
a different modeling question even when all three use the same compatibility
operator.

## Build and run

You need:

- Git;
- CMake 3.24 or newer;
- a C++20 compiler (Apple Clang, Clang, or GCC);
- internet access during the first configuration so CMake can fetch Eigen,
  TinyAD, and Polyscope.

From this folder, run:

```sh
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build -j 4
./build/geometry-processing-starter
```

On Windows with a multi-configuration generator, the executable may instead be
under `build/Release/`.

The default keeps mesh infrastructure minimal. Choose either mesh library—or
both—when the project needs its data structures or algorithms:

```sh
# libigl only
cmake -S . -B build-libigl -DGEOMETRY_STARTER_WITH_LIBIGL=ON

# Geometry Central only
cmake -S . -B build-gc -DGEOMETRY_STARTER_WITH_GEOMETRY_CENTRAL=ON

# Both libraries
cmake -S . -B build-both \
  -DGEOMETRY_STARTER_WITH_LIBIGL=ON \
  -DGEOMETRY_STARTER_WITH_GEOMETRY_CENTRAL=ON
```

The executable prints its configured mesh-library mode at startup. Optional
headers are isolated in `starter_optional_mesh_libraries.hh`; the TinyAD
objective stays unchanged. The first build is the slow one because it downloads
and compiles pinned dependencies. Later builds of `main.cpp` are much faster.

If you are working inside the full Direction Field Lab repository, you can
reuse its native build:

```sh
cmake --preset native
cmake --build --preset native --target geometry-processing-starter
./build/native/geometry-processing-starter-kit/geometry-processing-starter
```

To turn the starter into your own small project, copy the folder and begin a
new history:

```sh
cp -R geometry-processing-starter-kit ../my-geometry-project
cd ../my-geometry-project
git init
git add .
git commit -m "Start geometry experiment"
```

Run those commands from the Direction Field Lab repository root. Rename
the project and executable in `CMakeLists.txt` whenever you are ready; neither
name affects the mathematics.

## Your first ten minutes

1. Build and launch the program.
2. Enable **target field** and **optimized field** in the Polyscope sidebar so
   you can compare them.
3. Press **One Newton step** and watch the energy and gradient norm.
4. Increase **curl weight**, press **Reset objective**, then optimize again.
5. Enable **triangle curl** and compare the scalar field before and after the
   change.

Changing a slider changes the values stored by the UI. Press **Reset
objective** to rebuild the TinyAD objective with those values. Changing C++
requires recompiling.

You can also test the numerical path without opening a window:

```sh
./build/geometry-processing-starter --headless
```

The command prints the initial and final energy, gradient norm, and curl RMS. A
nonzero exit code means the smoke test failed.

## The only code you need to read first

Open `main.cpp` and search for:

```cpp
START HERE: this is the objective
```

There are two TinyAD callbacks in that block.

`starter_support.hh` contains intentionally ordinary mesh-generation and
Polyscope conversion code. You do not need to read it before changing the
objective; it is separated precisely to keep the first reading path short.

The vertex callback gets one unknown vector:

```cpp
const auto u = element.variables(vertex);
```

It returns the data energy plus the unit-length energy for that vertex. The
triangle callback gets the three unknown vectors on one face, computes a
trapezoidal boundary circulation, and returns its squared penalty.

TinyAD calls these same callbacks with ordinary `double` values and with its
automatic-differentiation scalar types. From these local programs it assembles
the global energy, gradient, and sparse Hessian.

The unknown vector is packed vertex by vertex:

```text
field = [u_0.x, u_0.y, u_1.x, u_1.y, ...].
```

Use `objective.x_from_data(...)` and `element.variables(vertex)` instead of
manually relying on that packing whenever possible.

## Why triangle circulation is a curl operator

For an oriented triangle `f = (i, j, k)`, the starter approximates each edge
integral with its endpoint values:

```text
alpha_ij = 1/2 (u_i + u_j) dot (p_j - p_i).
```

It then sums the three oriented edge integrals:

```text
c_f = alpha_ij + alpha_jk + alpha_ki.
```

By Stokes' theorem, `c_f / area(f)` approximates scalar curl on the face. The
energy uses

```text
E_curl,f = 1/2 w_curl c_f^2 / area(f),
```

which is the area-weighted squared curl. Keeping the area factor matters when
you change mesh resolution.

This is a local integrability test. On a surface with handles, zero circulation
on every face does not rule out nonzero periods around global cycles. That is
one reason the full lab also reports harmonic components and torus periods.

## Suggested first experiments

### 1. Replace the manufactured target

Find the line that creates `target` in `make_grid`. Try fields whose answers you
can predict:

```text
constant:  (1, 0)
gradient:  (2x, 2y)       = grad(x^2 + y^2)
rotation:  (-y, x)
shear:     (y, 0)
```

Before running, write down whether you expect the triangle curl to vanish.

### 2. Change one objective term

Try one change at a time:

- replace the unit-length residual with a preferred magnitude;
- use an L1-like robust data penalty;
- remove `/ triangle_area(face)` and perform a refinement study;
- give different faces different curl weights;
- add a smoothness term over edges.

Always keep a manufactured field or invariant that tells you whether the new
formula is doing what you intended.

### 3. Compare curl discretizations

The starter stores vertex vectors and measures circulation on primal triangle
boundaries. Add a second method that measures circulation around vertex dual
cells. Do not compare only pictures: record truth error and convergence as the
grid is refined.

### 4. Move from the plane to a surface

On the flat grid, every vertex uses the same `(x, y)` frame. On a curved
surface, vectors at different vertices live in different tangent planes. Make
these choices explicit:

- how a two-component vector is lifted into three dimensions;
- how vectors are transported between tangent frames;
- whether the connection is defined intrinsically or from the embedding;
- which mass matrix defines the norm;
- what boundary conditions and global cycle constraints are imposed.

At that point, it is reasonable to move the experiment into the full Geometry
Processing Lab numerical core.

## A good Summer Geometry Initiative workflow

For each experiment:

1. State one mathematical question in your README or notebook.
2. Construct a field with a known answer whenever possible.
3. Change one operator or term at a time.
4. Record energy, residuals, and geometric invariants—not just screenshots.
5. Test at several resolutions.
6. Keep the smallest failing example when something goes wrong.
7. Commit a working checkpoint before starting the next idea.

A useful experiment is finished when another student can clone it, run one
documented command, reproduce the result, and explain what numerical evidence
supports the conclusion.

## Common problems

**CMake cannot download a dependency.** Check your network connection, then
rerun the configure command. CMake caches successful downloads in `build/`.

**The build cannot find a compiler.** On macOS, install the command-line tools
with `xcode-select --install`. On Linux, install a recent Clang or GCC toolchain.

**The solve becomes singular.** The default positive data weight anchors every
unknown. If you remove it, your remaining energy may have a constant-vector or
gauge null space. Add an explicit constraint rather than hoping the linear
solver chooses one solution.

**The energy becomes infinite or `NaN`.** Reduce the change, inspect one term in
isolation, and check triangle areas and orientations. Add a headless regression
case before continuing.

If a lambda returns an Eigen expression involving local temporaries, call
`.eval()` or construct an owned vector before returning it. Eigen expressions
are lazy; returning one that refers to a destroyed local variable produces
dangling data.

**The result looks convincing but changes under refinement.** Check the area or
mass weighting of every residual. A formula can be locally plausible and still
have the wrong scaling.

## Where to go next

Use the full Direction Field Lab when you need reusable mesh loading,
connection-aware surface fields, Hodge diagnostics, browser experiments,
portable result files, or richer Polyscope debugging. The starter is meant to
be copied and changed; the lab is where a tested operator can become shared
infrastructure.

This project takes inspiration from Alec Jacobson's
[`libigl-tinyad-example`](https://github.com/alecjacobson/libigl-tinyad-example),
which demonstrates the same valuable pattern: a standard CMake project, a
local TinyAD objective, a Newton loop, and an interactive viewer without a
large application framework. The code in this starter is an independent,
MIT-licensed vector-field example using Polyscope.
