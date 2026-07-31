# Using Geometry Processing Lab

The repository supports three deliberately different levels of commitment:

1. **Visit the static page.** Try a compiled experiment without installing a
   numerical toolchain.
2. **Fork the web lab.** Edit experiment documents and TypeScript locally with
   Node.js.
3. **Move to native research code.** Keep the same portable result while using
   Python or C++ and Polyscope instead of the browser viewer.

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

## Fork and run locally

Requirements:

- Git;
- Node.js 22 or newer.

```sh
git clone https://github.com/YOUR-NAME/geometry-processing-lab.git
cd geometry-processing-lab
npm ci
npm run dev
```

Open <http://localhost:4173>. The committed WebAssembly kernel is sufficient.

Inside the lab:

- choose a small tutorial;
- edit the versioned problem document;
- use **Reset + build** to reconstruct solver state;
- take one numerical step at a time before pressing **Play**;
- inspect energy, gradient norm, sparse-system size, and field certificates;
- save locally or use **Download experiment repo** to make a small,
  host-neutral research record.

Before committing:

```sh
npm test
npm run build
```

`npm test` checks TypeScript formats, Python snapshot parsing, and the compiled
WebAssembly kernels.

## Edit a C++/TinyAD kernel

Only kernel development needs CMake and Emscripten. Activate an Emscripten SDK
and make its root available as `EMSDK`:

```sh
source /absolute/path/to/emsdk/emsdk_env.sh
npm run build:wasm
npm test
```

The build writes `public/wasm/gp_lab_kernels.js` and
`public/wasm/gp_lab_kernels.wasm`. Reload the Vite page to use them.

The practical research loop is:

1. prototype the formulation in native C++ or Python;
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

For the browser’s live **Open in Polyscope** button, use two terminals:

```sh
# terminal 1
npm run dev

# terminal 2
npm run build
npm run serve:bridge:python
```

The bridge binds only to `127.0.0.1`, writes an atomic snapshot under
`.lab-bridge`, and launches the Python viewer once. Later browser updates reuse
the same watched file and camera.

## Use the thin C++ Polyscope viewer

Researchers already working in C++ can build the native viewer:

```sh
npm run build:native
./build/polyscope-viewer/geometry-lab-viewer result.geometry-view.json
```

To use it as the browser handoff:

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

