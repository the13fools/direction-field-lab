# Using Geometry Processing Lab

The repository supports three deliberately different levels of commitment:

1. **Visit the static page.** Try a compiled experiment without installing a
   numerical toolchain.
2. **Fork the web lab.** Edit experiment documents and TypeScript locally with
   Node.js.
3. **Move to native research code.** Keep the same portable result while using
   the same shared C++ system with TinyAD and Polyscope instead of the browser
   viewer.

You do not need Emscripten merely to run the page, and you do not need to put a
native research iteration through WebAssembly.

## Visit the static page

The generated JavaScript and WebAssembly kernel live in the repository. A
GitHub Pages deployment therefore needs no application server, database, or
account system.

On a fork:

1. Open **Settings → Pages**.
2. Select **GitHub Actions** as the source.
3. Run the included **Publish website** workflow, or push to `main`.

Do not open `index.html` through a `file://` URL. WebAssembly workers should be
served over HTTP by Pages, Vite, or another static server.

### Recompile a fork's hosted kernel

The ordinary **Publish website** workflow deploys the committed Wasm artifact.
To publish an edited C++ callback without installing Emscripten locally:

1. edit and commit the callback in your fork;
2. open the fork's **Actions** tab;
3. choose **Recompile kernel and publish**;
4. choose **Run workflow**;
5. open the Pages URL reported by the deployment.

That manual workflow installs the pinned Emscripten SDK, rebuilds the kernel,
runs the numerical tests, and deploys the resulting static site. It has no
source-text or shell-command inputs and does not run on pull requests.

The runner still executes the fork's repository code. Only run it on a commit
you trust. GitHub supplies the isolated build machine and accounts its usage to
the fork, so the course site does not become a multi-tenant compilation server.

## Fork and run locally

Requirements:

- Git;
- Node.js 22 or newer.

```sh
git clone https://github.com/YOUR-NAME/geometry-processing-lab.git
cd geometry-processing-lab
npm ci
npm run doctor
npm run dev
```

Open <http://localhost:4173/getting-started.html>. The environment check treats
the CMake/compiler path as optional; the committed WebAssembly kernel is
sufficient for all browser lessons.

Inside the lab:

- open one collapsible tour chapter and choose a small lesson;
- edit the versioned problem document;
- use **Reset + build** to reconstruct solver state;
- take one numerical step at a time before pressing **Play**;
- inspect energy, gradient norm, sparse-system size, and field certificates;
- save locally or use **Download experiment files** to make a small,
  host-neutral research record.

### Begin with the discrete-forms playground

Open <http://localhost:4173/dec-playground.html>. Paint coefficients on the
current support, then move through the six primal/dual form spaces with `d` and
`⋆`. The four abstraction tabs keep the mesh picture, cochain array, sparse
matrix, and induced local energy synchronized. Use the composition presets to
verify `d² = 0`, construct a codifferential path, and return to a scalar through
a Laplacian path before opening the Hodge lessons.

### Run the curl operator observatory

Open <http://localhost:4173/vertex-curl.html> or choose **10 · Curl observatory**
in the main lab. The observatory is a standalone `experiment@2` client:

1. choose a manufactured field preset;
2. compare triangle-boundary and barycentric-dual curl against the analytic
   torus answer;
3. inspect the two noncontractible periods separately from local curl;
4. compare endpoint normal rotation with the one-ring polar-map baseline;
5. use the log-scale charts and resolution table before drawing conclusions
   from a single mesh;
6. edit or import the manifest, then download the complete `result@2` artifact.

The source drawer shows the TypeScript reference implementation actually used
by that page. The main workbench separately exposes the C++/TinyAD callback used
by the optimization kernel; the two are not presented as the same backend.

The current problem and the three editable callback headers autosave in
IndexedDB. Reloading the page restores that draft. **Save locally** also creates
a named checkpoint.

### Run the live unit-energy workshop

Open <http://localhost:4173/energy-playground.html> or choose **11 · Live
unit-energy workshop**. The page combines editable per-vertex data/unit energy
with fixed, visible triangle-circulation and connection-smoothing stencils.
Choose **Apply live energy** to parse and differentiate the math expression in
the browser; no C++ compilation occurs. **Copy experiment link** stores the
expression and controls in the URL. The code-generation buttons translate the
same validated expression into a TinyAD header or Python function.

This is deliberately narrower than the callback editor. It changes a scalar
per-vertex program, not arbitrary element topology. Use the connected bridge or
exported project when adding new mesh neighborhoods, external libraries, or
unrestricted C++.

Before committing:

```sh
npm run check
```

This checks TypeScript formats, Python snapshot parsing, the compiled
WebAssembly kernels, the production build, and relative paths needed when the
site is hosted below a repository path.

### Publish the current energy as a blog figure

The live workshop has a **Publish this exact state** card. **Copy iframe**
creates a compact reader view with the validated element program in its URL;
**Preview figure** opens that view before it is inserted in an article;
**Download blog kit** stores the iframe, linked fallback, program, and generated
TinyAD/Python source together.

The publication URL reproduces the program and deterministic initialization,
not an opaque optimized iterate. State the number of Newton steps used in the
article. See [publishing-a-blog-experiment.md](publishing-a-blog-experiment.md)
for GitHub Pages, general static hosting, and blogs that remove iframes.

## Edit C++ in the browser, then run it locally

Choose a Hodge or vertex-field exercise, expand **Actual TinyAD callbacks**, and
edit the highlighted source. Comments marked `LAB NOTE` explain the local
automatic-differentiation program; comments marked `TRY` suggest controlled
changes. Then choose **Download rebuild files**.

Copy the exported `cpp/include/*.hh` files over the matching files in a full
clone and rebuild:

```sh
source /absolute/path/to/emsdk/emsdk_env.sh
npm ci
npm run build:wasm
npm test
npm run dev
```

The C++ is not evaluated by the hosted browser. Static hosting cannot launch a
compiler, so the page keeps showing the committed kernel until this explicit
local rebuild succeeds.

### Connected local build button

From a full clone, build the static files and start the loopback bridge:

```sh
npm run build
npm run serve:bridge:python
```

Open <http://127.0.0.1:4174> and choose a vertex-field lesson. The status strip
changes from **static web** to **local bridge**, and the callback drawer reveals
**Build + open native**. After confirmation, that button:

1. validates a `vertex-field` problem and a fixed callback-file whitelist;
2. writes a scratch project under `.lab-workspace/current`;
3. configures and builds only `geometry-lab-vertex-field`;
4. launches that native Polyscope application with the current JSON weights.

The endpoint accepts no shell string, target name, output path, or arbitrary
file path. Compilation still executes source you edited, so use connected mode
only with a clone and callbacks you trust. **Download rebuild files** remains
the portable fallback and the route to a new Wasm build.

TinyAD computes derivatives of the edited callback when the native target is
rebuilt. The callback still has a fixed element arity; changing the unknown
layout or mesh operators belongs in the shared C++ system rather than in the
header alone.

## Build the native reference application directly

Requirements:

- CMake 3.24 or newer;
- a C++17 compiler;
- Git and network access for the first dependency fetch.

```sh
cmake --preset native
cmake --build --preset native
ctest --preset native
./build/native/geometry-lab-vertex-field
```

The faster headless loop omits Polyscope:

```sh
cmake --preset native-core
cmake --build --preset native-core
ctest --preset native-core
```

The browser and native application share
`geometry_lab::VertexFieldSystem`. Emscripten bindings and Polyscope widgets are
thin adapters around it.

## Rebuild a static C++/TinyAD kernel

Only kernel development needs CMake and Emscripten. Activate an Emscripten SDK
and make its root available as `EMSDK`:

```sh
source /absolute/path/to/emsdk/emsdk_env.sh
npm run build:wasm
npm test
```

The build writes `public/wasm/gp_lab_kernels.js` and
`public/wasm/gp_lab_kernels.wasm`. Reload the Vite page to use them.

The practical publication loop is:

1. prototype the formulation in the connected editor or native C++;
2. inspect it in Polyscope;
3. add manufactured-solution and convergence tests;
4. compile the stable operator to WebAssembly only when it is ready for the
   static lab.

This avoids paying browser-build overhead for every exploratory change.

## Use Polyscope from Python

The optional Python viewer is the shortest route from an exported lab result to
a native research environment:

```sh
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install -r requirements-polyscope.txt
npm run view:python -- result.geometry-view.json
```

The viewer accepts:

- `geometry-lab/view@1` curve-network snapshots produced by the current web
  button;
- `geometry-lab/result@2` triangle meshes with vertex-, edge-, face-, and
  dual-cell fields.

It understands ambient vectors, vertex/face tangent vectors with explicit basis
frames, and oriented edge one-forms. By default it watches the file and reloads
when a solver replaces it. Pass `--no-watch` for a one-time view.

For the browser’s live **Open in Polyscope** snapshot button:

```sh
npm run build
npm run serve:bridge:python
```

Open <http://127.0.0.1:4174>. The bridge binds only to `127.0.0.1`, writes an atomic snapshot under
`.lab-bridge`, and launches the Python viewer once. Later browser updates reuse
the same watched file and camera. This server also exposes the fixed native
vertex-field rebuild described above.

## Use the thin C++ Polyscope viewer

Researchers already working in C++ can build the native viewer:

```sh
npm run build:native
./build/polyscope-viewer/geometry-lab-viewer result.geometry-view.json
```

To use the thin snapshot reader as the browser handoff:

```sh
npm run build
npm run serve:bridge -- \
  --viewer build/polyscope-viewer/geometry-lab-viewer
```

The C++ viewer is intentionally small and currently reads
`geometry-lab/view@1`. The Python viewer is the reference reader for the richer
`result@2` mesh-and-field format.

For a native C++ project, it is often simpler to use Polyscope directly and
write `result@2` only when an experiment must cross the browser/native boundary.
The numerical library never needs to depend on the web UI.

## Add a reproducible research experiment

Keep four concerns separate:

1. An `experiment@2` document states the mesh, field, methods, sweep, and
   metrics.
2. A capability manifest advertises which operators this build actually has.
3. A worker or native executable runs the numerical method.
4. A `result@2` artifact stores meshes, field associations, metrics, messages,
   and backend provenance.

Prefer mathematical operator identifiers such as
`projection.hodge-edge-dec` over implementation names such as a C++ class.
This permits the WebAssembly, Python, and native C++ implementations to be
compared without changing the saved experiment.

See [architecture.md](architecture.md), [file-formats.md](file-formats.md), and
[vector-field-representations.md](vector-field-representations.md).

## Publish or keep private

The lab never requests Git credentials. A fork may be public or private, and
exported experiment archives are ordinary files:

```sh
git add .
git commit -m "Add connection convergence experiment"
git push
```

This keeps authentication and repository policy outside the numerical core.

For the intended C++-first development philosophy and the boundary between
static Wasm and connected native execution, see
[cpp-first-workflow.md](cpp-first-workflow.md).
### Advance the shallow-water baseline

Open <http://localhost:4173/shallow-water.html>. Start with the linear gravity
energy, confirm mass drift and curl remain near roundoff, then seed the vortical
mode. Edit `V(h)` in the browser to change the pressure law without recompiling;
the declared gradient/divergence pair and its adjointness audit stay fixed.
