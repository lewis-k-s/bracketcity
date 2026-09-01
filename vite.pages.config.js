import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    outDir: "dist-pages",
    emptyOutDir: true,
    manifest: true,
    cssCodeSplit: false,
    rollupOptions: {
      input: resolve("src/pages-entry.js"),
      output: {
        format: "iife",
        name: "NexoApplication",
        inlineDynamicImports: true,
        entryFileNames: "assets/nexo-[hash].js",
        assetFileNames: "assets/nexo-[hash][extname]"
      }
    }
  }
});
