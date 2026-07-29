# Contributing

Keep examples small enough that a reader can predict something before pressing
Run. A contribution that adds a numerical method should include:

- a one-sentence learning question;
- a versioned, validated input fixture;
- deterministic initialization;
- diagnostics and at least one automated invariant;
- documentation of units, conventions, and failure modes.

Run `npm test` and `npm run build` before opening a pull request. C++ changes
must also rebuild `public/wasm` and state the Emscripten version used. Do not
commit personal meshes, access tokens, SDK installations, or unlicensed assets.

Format changes are compatibility changes. Extend a schema additively or create a
new version; do not silently reinterpret an existing field.
