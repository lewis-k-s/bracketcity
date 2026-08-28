import { cp } from "node:fs/promises";
import { resolve } from "node:path";
import { defineConfig } from "vite";

function copyRuntimeData() {
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
  preview: {
    allowedHosts: ["macsimus.tail6f70c7.ts.net"]
  }
});
