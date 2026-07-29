# Geometry Processing Lab

A local-first, fork-friendly reference implementation for small geometry
processing experiments in the browser. It combines an editable, versioned
problem file with C++ numerical kernels compiled to WebAssembly, a WebGL viewer,
solver diagnostics, and an optional Polyscope desktop viewer.

The first reference experiment is intentionally modest: a sparse Newton solve
for a two-dimensional mass-spring grid using TinyAD and Eigen. Its purpose is to
make the architecture and the numerics inspectable before adding larger topics
such as parameterization, Hodge decomposition, integrable projection, or fluids
on surfaces.

## Design promises

- **A result is a file, not hidden UI state.** Problems and viewer snapshots have
  documented, versioned JSON schemas.
- **One solver, multiple viewers.** The browser and Polyscope consume the same
  snapshot; the native viewer does not reimplement the numerical method.
- **Local first.** Saving uses IndexedDB. No account, server, analytics, or token
  is required.
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

Build the desktop viewer:

```sh
npm run build:native
```

For a live local handoff, run the site and bridge in separate terminals:

```sh
npm run dev
npm run serve:bridge -- --viewer build/polyscope-viewer/geometry-lab-viewer
```

If the bridge is absent, **Open in Polyscope** downloads the same
`.geometry-view.json` snapshot instead. It can be opened manually with:

```sh
./build/polyscope-viewer/geometry-lab-viewer result.geometry-view.json
```

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
cpp/                      TinyAD + Eigen WebAssembly kernel
native/polyscope-viewer/  optional snapshot viewer
tools/                    local-only bridge
examples/                 portable problem files
docs/                     architecture, formats, and extension roadmap
```

Read [`docs/architecture.md`](docs/architecture.md) before adding a new solver.
The project is MIT licensed; exported experiment data defaults to CC0.
