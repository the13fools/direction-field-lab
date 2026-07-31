# Optional Polyscope viewer

This is a deliberately thin native viewer. It watches one
`geometry-lab/view@1` JSON snapshot and reloads its curve network while leaving
the camera under the user's control. It does not contain a second solver.

```sh
npm run build:native
./build/polyscope-viewer/geometry-lab-viewer result.geometry-view.json
```

The browser's local bridge writes the same file format. This keeps browser and
desktop rendering interchangeable without coupling the numerical kernel to a
specific UI.

For Python development and `geometry-lab/result@2` triangle meshes and fields,
use `tools/polyscope_viewer.py`. The C++ viewer remains a minimal
`geometry-lab/view@1` curve-network reader so it is easy to copy into a native
research project.
