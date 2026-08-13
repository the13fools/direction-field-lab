import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    target: "es2022",
    sourcemap: true,
    rollupOptions: {
      input: [
        "index.html",
        "vertex-curl.html",
        "energy-playground.html",
        "dec-playground.html",
        "getting-started.html",
        "shallow-water.html",
        "clebsch-surfaces.html",
        "clebsch-surfaces-action.html",
        "clebsch-surfaces-reference.html",
        "clebsch-shallow-water.html",
        "mobius-shallow-water.html",
        "projective-clebsch.html",
        "flat-torus-cohomology.html",
        "disk-circulation.html",
        "random-fluids.html",
        "representations.html",
        "references.html",
      ],
    },
  },
  server: {
    port: 4173,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:4174" },
    watch: { ignored: ["**/build/**", "**/dist/**"] },
  },
  preview: {
    port: 4173,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:4174" },
  },
});
