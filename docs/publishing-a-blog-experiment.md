# Publishing an interactive experiment on a blog

The publication unit is not a screenshot and not a server process. It is a
static experiment URL containing a validated `element-program@1`, accompanied
by a downloadable program and diagnostics. The same file can generate the
TinyAD and Python reference implementations used to continue the work.

## Authoring flow

1. Open `energy-playground.html` from a deployed copy of the lab.
2. Choose a manufactured target and set the objective weights.
3. Edit and apply the per-vertex energy.
4. Take enough sparse Newton steps to expose the behavior you want to discuss.
5. Record the energy, curl RMS, unit defect, and sparse-Hessian nonzero count.
6. Choose **Copy iframe** under **Publish this exact state**.
7. Paste the iframe into a draft article and keep its full-lab fallback link.
8. Choose **Download blog kit** and archive that zip with the article material.

The solver iterate is deliberately not placed in the URL. The program and
deterministic initialization are sufficient to reproduce it by taking the
documented number of steps. An article should state that number rather than
silently publishing an opaque final state.

## The compact reader view

Adding `?embed=1` to an energy-workshop URL creates a compact, responsive
reader view. It keeps the field, diagnostics, Newton controls, data/unit/curl
weights, and presets. The expression editor, full JSON, code generation, and
PolyCurl bonus remain on the full page reached through **Open full lab**.

The generated iframe uses a fixed 680-pixel height because this works in
ordinary article layouts without requiring a cross-origin resize script. On a
narrow screen the figure drops the secondary controls and keeps the field and
solver usable.

## If the blog removes iframes

Many hosted blogs sanitize arbitrary iframe HTML. The publication kit also
contains `web/blog-fallback.md`, which links directly to the exact full-page
experiment. A good fallback is:

1. the social-preview image or one carefully labeled result image;
2. one sentence stating the mathematical question;
3. the full-page experiment link;
4. a direct link to the shared element-program file or publication kit.

Do not work around a blog's security policy with injected scripts. Hosting the
interactive figure separately and linking to it preserves the same scientific
content.

## Hosting choices

### GitHub Pages

For a student fork, enable **Settings → Pages → GitHub Actions**. The included
**Publish website** workflow runs `npm run check`, builds the static site, audits
relative asset paths, and deploys `dist/`. Pushing to `main` publishes; the same
workflow can also be started manually.

The manual **Recompile kernel and publish** workflow is only needed after
editing the C++/TinyAD kernel. It installs the pinned Emscripten version on the
fork's runner and then performs the same verification and deployment.

### Another static host

Use this build configuration:

```text
install: npm ci
build:   npm run check
output:  dist
```

The Vite base is relative, so the pages and assets can be served at the domain
root or below a repository/project path. Preserve `.html` in direct lesson URLs
unless the host is explicitly configured with matching rewrite rules.

## What static publication cannot do

A public static page can parse energies, run browser AD, assemble sparse
Hessians, solve with PCG, execute committed Wasm, and generate source files. It
cannot compile arbitrary submitted C++, launch a desktop Polyscope process, or
write to a clone. Those actions remain in a local clone, the loopback bridge,
or a trusted repository CI workflow.

This boundary keeps a course/blog deployment inexpensive and auditable while
leaving the native research path unrestricted.
