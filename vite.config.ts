import { cp } from "node:fs/promises";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import type { Plugin } from "vite";

function copyRuntimeData(): Plugin {
  return {
    name: "copy-runtime-puzzle-data",
    apply: "build",
    async closeBundle() {
      for (const directory of ["locales", "puzzles"]) {
        await cp(resolve(directory), resolve("dist", directory), { recursive: true });
      }
    }
  };
}

export default defineConfig({
  base: "./",
  plugins: [copyRuntimeData()],
  build: {
    manifest: true,
    rollupOptions: {
      output: {
        assetFileNames: "assets/[name]-[hash][extname]",
        chunkFileNames: "assets/[name]-[hash].js",
        entryFileNames: "assets/[name]-[hash].js"
      }
    }
  },
  preview: {
    allowedHosts: ["macsimus.tail6f70c7.ts.net"]
  }
});
