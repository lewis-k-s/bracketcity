import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageDefinition = JSON.parse(
  readFileSync(join(projectRoot, "package.json"), "utf8")
);
const archive = join(
  projectRoot,
  "release",
  `nexo-${packageDefinition.version}.zip`
);
const result = spawnSync(
  "sh",
  ["tests/php/run-wordpress-package-integration.sh", archive],
  { cwd: projectRoot, stdio: "inherit" }
);

if (result.error) throw result.error;
if (result.status !== 0) {
  throw new Error(`Packaged WordPress activation test exited with ${result.status}`);
}
