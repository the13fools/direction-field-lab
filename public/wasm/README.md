# Generated kernel artifacts

`gp_lab_kernels.js` and `gp_lab_kernels.wasm` were generated from
`cpp/src/mass_spring.cpp` with Emscripten 5.0.7. The CMake configuration pins:

- Eigen: `f1df74068ea982ba88964460b534ce296c70b40d`
- TinyAD: `4b48d1a1a588874556a692a3abbdecd0db4c23e1`

The artifacts are committed so running the website requires only Node.js. They
must be rebuilt and committed whenever the C++ source or pinned dependencies
change.
