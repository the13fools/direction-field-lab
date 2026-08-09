# Direction Field Lab

Clone the course repository from
[`the13fools/direction-field-lab`](https://github.com/the13fools/direction-field-lab).

A static, fork-friendly reference implementation for small geometry-processing
experiments. A researcher can try compiled C++/WebAssembly kernels in the
browser, fork the repository, and continue the same experiment in native C++
with TinyAD and Polyscope.

Students should begin at `getting-started.html`: it separates the no-install
browser activity, the Node-only web clone, the copyable native C++ starter, and
the static publishing path. In a local development server, open
<http://localhost:4173/getting-started.html>.

The first reference experiment is intentionally modest: a sparse Newton solve
for a two-dimensional mass-spring grid using TinyAD and Eigen. Its purpose is to
make the architecture and the numerics inspectable before adding larger topics
such as parameterization, Hodge decomposition, integrable projection, or fluids
on surfaces.

The collapsible vector-field tour separates the ideas that are often conflated:

1. an explorable primal/dual DEC map where students paint a cochain, apply `d`
   and `⋆`, inspect the sparse matrix, and turn the residual into an energy;
2. a mixed finite-element Hodge split of piecewise-constant face vectors;
3. an identity-weighted cochain Hodge split of signed edge integrals, with a
   metric DEC Hodge star left explicit as the next extension;
4. reconstruction of an edge 1-form as vertex tangent vectors, including an
   explicit warning that reconstruction is not a native vertex Hodge complex;
5. a true per-vertex tangent-field optimization whose objective weights are
   edited with guided controls or portable JSON and passed live into generic
   TinyAD callbacks;
6. a face-circulation penalty on those native vertex unknowns that introduces
   local integrability without hiding the torus's two global period
   obstructions;
7. a manifest-driven manufactured-solution bench comparing primal-triangle and
   barycentric-dual curl, plus extrinsic and intrinsic connection baselines over
   a refinement sequence with log-scale comparison charts;
8. an integrable-and-unit vertex projection in which the circulation and
   quartic norm penalties visibly compete;
9. a shareable live-energy workshop that differentiates a student-written
   per-vertex expression through second order and generates TinyAD or Python
   source without a rebuild.

The chapter organization borrows a useful principle from the
[Directional tutorial](https://avaxman.github.io/Directional/tutorial/)—one
concept per stop and explicit field representations—while keeping this
repository small and organized around comparable, portable experiments.
The experiment brief also contains a collapsible
[projection-family map](docs/integrable-projection-family.md) distinguishing
the current soft circulation penalty from closest-field, direction-rescaling,
and integrable-unit formulations.

Students can inspect and edit the literal callback header compiled into each
kernel. In the static site, changing guided objective controls is immediate;
the workshop can also change the complete per-vertex scalar expression and
generate source. Editing arbitrary C++ still produces a downloadable project.
In connected local mode, the same editor rebuilds that C++ with TinyAD and
opens the result in Polyscope. See
[`docs/vector-field-representations.md`](docs/vector-field-representations.md).
The intended progression through these representations is recorded in the
[explorable course ladder](docs/explorable-course-ladder.md).
The browser-facing [`references.html`](references.html) and the repository
[reading map](docs/references.md) connect each chapter to the canonical paper,
course notes, or reference implementation that motivates it.

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
npm run doctor
npm run dev
```

Open <http://localhost:4173>. Use the guided controls at right (or switch to
JSON), choose **Reset + build**, then inspect individual Newton steps. `npm
test` validates the portable formats;
`npm run build` creates the static site in `dist/`.

Open <http://localhost:4173/vertex-curl.html> for the standalone curl operator
observatory. It runs `examples/vertex-curl-baseline.experiment.json` directly,
shows the executable reference operator beside the manifest, and downloads a
viewer-neutral `geometry-lab/result@2` artifact.

Open <http://localhost:4173/energy-playground.html> for the vertex-based
integrable-unit workshop. Its math-only expression editor is safe on a static
host. One editable `element-program@1` file drives exact local differentiation,
full sparse Hessian scatter, a PCG Newton step, URL sharing, and generated
TinyAD/Python vertex, edge, and face functions. See the
[shared-file guide](docs/shared-element-program.md) and
[research-sharing workflow](docs/research-sharing-workflow.md).
Its publication panel produces a compact blog iframe, a full-page fallback,
and a zip containing the exact program and generated research source. See the
[blog publishing guide](docs/publishing-a-blog-experiment.md).
The stripe projection now offers 19², 31², 43², and 49² phase grids and reports
cells per stripe so high-frequency aliasing is visible before the solve.
The matching compiled-Wasm lesson is also stored as
[`examples/vertex-unit-integrable.problem.json`](examples/vertex-unit-integrable.problem.json).

Open <http://localhost:4173/dec-playground.html> first for the discrete-forms
playground. It moves one cochain among primal/dual 0-, 1-, and 2-form spaces,
shows the actual sparse `d` or diagonal `⋆` matrix, verifies `d² = 0`, and then
rewrites the current residual as a local quadratic energy.

Open <http://localhost:4173/representations.html> for the optional
face/edge/vertex breakout. It keeps a native vertex field fixed while exposing
the edge integration, face reconstruction, and vertex round-trip maps. The
main objective workshop remains vertex-only.

Open <http://localhost:4173/shallow-water.html> for the first runnable dynamics
milestone. It stores height and tangent velocity at vertices, derives an edge
flux, audits mass/curl/adjointness, and lets students edit the local height
energy without recompiling. The intentionally flat periodic baseline is the
contract that later surface and vorticity-based formulations must preserve.

Open <http://localhost:4173/random-fluids.html> for a seeded random-flow
laboratory on a periodic square, sphere, or torus. Smooth one-dimensional
Perlin processes modulate every spatial mode in time. The page compares exact
curl-free fields, coexact divergence-free fields, and a Clebsch construction
`u♭ = dφ + α dβ`, while two material clouds make transport visible. The model
reports tangency, divergence, vorticity, and field-correlation audits.

No C++ toolchain is needed for this path: the generated WebAssembly kernel is
committed. `npm run check` validates the numerical kernels, builds `dist/`, and
audits the result for repository-subpath hosting. See the complete
[usage guide](docs/usage.md) for GitHub Pages,
forking, native research workflows, and the browser/Polyscope handoff.

## Geometry Processing Starter Kit

[`geometry-processing-starter-kit/`](geometry-processing-starter-kit/) is a copyable TinyAD + Polyscope project
for the Summer Geometry Initiative. It generates its own triangle grid and
keeps the editable objective in one clearly marked block of `main.cpp`, so a
first experiment does not require the web application, the shared solver
architecture, or mesh-loading boilerplate. Its README provides a ten-minute
path, the circulation derivation, suggested extensions, troubleshooting, and a
headless smoke-test command. CMake options let students add libigl, Geometry
Central, both libraries, or neither without changing the objective-first entry
point.

A fork owner can also edit a callback through GitHub, run **Recompile kernel
and publish** from the Actions tab, and receive a Pages deployment containing
the newly compiled Wasm. This uses the fork's isolated GitHub runner rather than
a shared compiler operated by the teaching site.

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

For the edit-in-browser/build-Wasm loop, use **Download rebuild files** in the
callback panel, then copy the exported callback headers into a clone:

```sh
source /absolute/path/to/emsdk/emsdk_env.sh
npm ci
npm run build:wasm
npm test
npm run dev
```

For a faster native loop, first run `npm run build`, then `npm run
serve:bridge:python` and open <http://127.0.0.1:4174>. The page labels itself
**local bridge** and exposes **Build + open native** for vertex-field lessons.
After an explicit confirmation, the bridge writes only whitelisted callback
headers to `.lab-workspace/current`, invokes the fixed CMake target, and opens
its Polyscope application. It does not accept browser-supplied shell commands,
paths, targets, or compiler flags.

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

Both bridge variants enable the fixed native vertex-field rebuild action. The
`:python` variant additionally launches the portable snapshot viewer.

If the bridge is absent, **Open in Polyscope** downloads the same neutral
snapshot for manual use.

## Fork, publish, or keep work private

This repository is an ordinary static web project: fork it on GitHub, enable the
included Pages workflow, or push it to a private remote. The app never asks for
Git credentials. **Download experiment files** creates a small Git-ready archive
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
src/experiments/          manifest adapters and manufactured-solution benches
src/solver/               worker boundary and WebAssembly client
src/viewer/               browser rendering
cpp/                      shared TinyAD + Eigen numerical core and Wasm adapter
native/experiments/       native Polyscope applications using the shared core
native/polyscope-viewer/  optional neutral-snapshot viewer
geometry-processing-starter-kit/          copyable objective-first TinyAD + Polyscope project
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
