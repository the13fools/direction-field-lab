# Geometry Processing Lab

A static, fork-friendly reference implementation for small geometry-processing
experiments. A researcher can try compiled C++/WebAssembly kernels in the
browser, fork the repository, and continue the same experiment in native C++
with TinyAD and Polyscope.

The first reference experiment is intentionally modest: a sparse Newton solve
for a two-dimensional mass-spring grid using TinyAD and Eigen. Its purpose is to
make the architecture and the numerics inspectable before adding larger topics
such as parameterization, Hodge decomposition, integrable projection, or fluids
on surfaces.

The vector-field sequence now separates five ideas that are often conflated:

1. a mixed finite-element Hodge split of piecewise-constant face vectors;
2. a DEC Hodge split of signed edge integrals;
3. reconstruction of an edge 1-form as vertex tangent vectors, including an
   explicit warning that reconstruction is not a native vertex Hodge complex;
4. a true per-vertex tangent-field optimization whose objective weights are
   edited in JSON and passed live into generic TinyAD callbacks;
5. a face-circulation penalty on those native vertex unknowns that introduces
   local integrability without hiding the torus's two global period
   obstructions.

Students can inspect and edit the literal callback header compiled into each
kernel. In the static site, changing objective weights is immediate and changing
C++ produces a downloadable project. In connected local mode, the same editor
rebuilds that C++ with TinyAD and opens the result in Polyscope. See
[`docs/vector-field-representations.md`](docs/vector-field-representations.md).

## Design promises

- **A result is a file, not hidden UI state.** Problems and viewer snapshots have
  documented, versioned JSON schemas.
- **One solver, multiple viewers.** The browser and Polyscope consume the same
  shared C++ numerical core; the native application is not a second
  implementation of the method.
- **Local first.** The current problem and edited callback sources autosave to
  IndexedDB. No account, server, analytics, or token is required.
- **Reproducible builds.** JavaScript packages use a lockfile. Eigen, TinyAD,
  Polyscope, and Polyscope's native subdependencies are pinned by CMake and Git.
- **No vendored SDK.** Generated WebAssembly is committed for ordinary users;
  its source and exact rebuild path remain in the repository.

## Run the lab

Requirements: Node.js 22 or newer.

```sh
npm ci
npm run dev
```

Open <http://localhost:4173>. Edit the JSON at right, choose **Reset + build**,
then inspect individual Newton steps. `npm test` validates the portable formats;
`npm run build` creates the static site in `dist/`.

No C++ toolchain is needed for this path: the generated WebAssembly kernel is
committed. See the complete [usage guide](docs/usage.md) for GitHub Pages,
forking, native research workflows, and the browser/Polyscope handoff.

## Continue in native C++ and Polyscope

Requirements: CMake 3.24+, a C++17 compiler, and Git. The native preset fetches
the pinned dependencies on its first configure.

```sh
cmake --preset native
cmake --build --preset native
ctest --preset native
./build/native/geometry-lab-vertex-field
```

This application calls the same `VertexFieldSystem` and TinyAD callbacks as the
WebAssembly build. It adds a Polyscope UI, not a parallel solver.

For the edit-in-browser/build-native loop:

```sh
npm ci
npm run build
npm run serve:bridge
```

Open <http://127.0.0.1:4174>, choose a vertex-field exercise, expand **Actual
TinyAD callbacks**, edit the header, and press **Build + open in Polyscope**.
The local bridge writes only the whitelisted callback files to
`.lab-workspace/current`, compiles the native target, and launches it. This is a
trusted local developer mode: edited C++ is real native code.

## Rebuild the WebAssembly kernel

An ordinary user does not need CMake or Emscripten because the generated kernel
is stored in `public/wasm`. Kernel developers can rebuild it with CMake 3.24+
and an activated Emscripten SDK:

```sh
export EMSDK=/absolute/path/to/emsdk
npm run build:wasm
```

CMake fetches the pinned Eigen and TinyAD revisions. See [`cpp/README.md`](cpp/README.md).

## Optional Polyscope handoff

The lowest-overhead native viewer is the optional Python package:

```sh
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install -r requirements-polyscope.txt
npm run view:python -- result.geometry-view.json
```

It reads both the current curve-network snapshot and the generic `result@2`
mesh/field artifact. It watches the file by default, preserving the camera as a
solver writes new results.

Researchers who prefer a compiled viewer can build the thin C++ reader and the
native reference experiment:

```sh
npm run build:native
```

For a live local handoff:

```sh
npm run build
npm run serve:bridge
```

Then open <http://127.0.0.1:4174>. Use this variant when the result should be
watched by the optional Python viewer instead:

```sh
npm run serve:bridge:python
```

If the bridge is absent, **Open in Polyscope** downloads the same neutral
snapshot for manual use.

## Fork, publish, or keep work private

This repository is an ordinary static web project: fork it on GitHub, enable the
included Pages workflow, or push it to a private remote. The app never asks for
Git credentials. **Download experiment repo** creates a small Git-ready archive
containing the current problem and reproduction lock; its owner can commit that
archive to any public or private host.

```sh
git init
git add .
git commit -m "Start geometry experiment"
git branch -M main
git remote add origin git@github.com:YOUR-NAME/YOUR-REPOSITORY.git
git push -u origin main
```

An OAuth-based GitHub publisher can be added later as a separate adapter. It is
not part of the numerical core, and personal access tokens should never be put
in browser source or experiment files.

## Repository map

```text
src/core/                 versioned formats, validation, local storage
src/solver/               worker boundary and WebAssembly client
src/viewer/               browser rendering
cpp/                      shared TinyAD + Eigen numerical core and Wasm adapter
native/experiments/       native Polyscope applications using the shared core
native/polyscope-viewer/  optional neutral-snapshot viewer
tools/                    local-only bridge
examples/                 portable problem files
docs/                     architecture, formats, and extension roadmap
```

Start with [`docs/usage.md`](docs/usage.md), then read
[`docs/cpp-first-workflow.md`](docs/cpp-first-workflow.md) and
[`docs/architecture.md`](docs/architecture.md) before adding a new solver. The
route from Hodge decomposition to a surface shallow-water solver is recorded in
[`docs/shallow-water-roadmap.md`](docs/shallow-water-roadmap.md).
The project is MIT licensed; exported experiment data defaults to CC0.
