import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    target: "es2022",
    sourcemap: true,
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
