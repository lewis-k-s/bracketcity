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
      input: resolve("src/pages-entry.ts"),
      output: {
        format: "es",
        entryFileNames: "assets/nexo-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/nexo-[hash][extname]"
      }
    }
  }
});
