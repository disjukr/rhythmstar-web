import { defineConfig } from "vite";

export default defineConfig({
  root: import.meta.dirname,
  server: {
    port: 8000,
  },
  build: {
    outDir: "dist",
    assetsInlineLimit: 0,
    emptyOutDir: true,
  },
});
