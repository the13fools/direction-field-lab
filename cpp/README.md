# WebAssembly kernels

This directory contains the numerical code used by the browser. The UI and the
kernel communicate only through the versioned problem and diagnostic types in
`src/core`.

TinyAD and Eigen are pinned by commit in `CMakeLists.txt`; they are fetched at
configure time and are not vendored into this repository. A release of the site
commits the generated `public/wasm/gp_lab_kernels.{js,wasm}` so students do not
need a C++ toolchain to run the lab.

Build with an activated Emscripten SDK:

```sh
npm run build:wasm
```
