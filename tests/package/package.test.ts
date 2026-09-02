import assert from "node:assert/strict";
import { after, test } from "node:test";
import { execFile } from "node:child_process";
import { access, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { packagePlugin } from "../../scripts/package-plugin.ts";

const projectRoot = resolve(import.meta.dirname, "../..");
const execute = promisify(execFile);
const packageDefinition = JSON.parse(await readFile(resolve(projectRoot, "package.json"), "utf8"));
const releaseArchive = resolve(projectRoot, "release", `nexo-${packageDefinition.version}.zip`);
let testArchive = "";
let createdTestArchive = false;
const createdStages: string[] = [];

after(async () => {
  await Promise.all(createdStages.map((stage) => rm(stage, { recursive: true, force: true })));
  if (createdTestArchive) await rm(testArchive, { force: true });
});

test("staged WordPress plugin contains the bridge and dated seeds only", async () => {
  const result = await packagePlugin({ runChecks: false, writeArchive: false });
  createdStages.push(dirname(result.pluginStage));
  const names = result.files.map((file) => file.name);
  assert.ok(names.includes("bracket-city/nexo.php"));
  assert.ok(names.includes("bracket-city/includes/class-nexo-capabilities.php"));
  assert.ok(names.includes("bracket-city/seed/2026-08-30-es.json"));
  assert.ok(names.includes("bracket-city/seed/2026-08-31-es.json"));
  assert.ok(!names.some((name) => name.endsWith("manifest.json") && name.includes("seed/")));
  assert.ok(!names.some((name) => name.includes("demo-es.json")));
  assert.ok(!names.some((name) => name.startsWith("bracket-city/build/")));
  assert.ok(!names.some((name) => /\.(?:css|js)$/.test(name)));
  assert.ok(!names.some((name) => name.endsWith(".gitkeep")));
});

test("upload ZIP passes system validation and declares the package version", async () => {
  const releaseAlreadyExists = await access(releaseArchive).then(() => true, () => false);
  testArchive = releaseAlreadyExists
    ? resolve(tmpdir(), `nexo-package-test-${process.pid}.zip`)
    : releaseArchive;
  const result = await packagePlugin({
    runChecks: false,
    writeArchive: true,
    archivePath: testArchive
  });
  createdStages.push(dirname(result.pluginStage));
  createdTestArchive = true;

  const integrity = await execute("unzip", ["-t", testArchive]);
  assert.match(integrity.stdout, /No errors detected in compressed data/);

  const listing = await execute("unzip", ["-Z1", testArchive]);
  const names = listing.stdout.trim().split("\n");
  assert.ok(names.includes("bracket-city/nexo.php"));
  assert.ok(names.includes("bracket-city/includes/class-nexo-capabilities.php"));
  assert.ok(names.includes("bracket-city/seed/2026-08-30-es.json"));
  assert.ok(names.every((name) => name.startsWith("bracket-city/")));
  assert.ok(!names.some((name) => name.startsWith("bracket-city/build/")));
  assert.ok(!names.some((name) => name.endsWith(".gitkeep")));

  const bootstrap = await execute("unzip", ["-p", testArchive, "bracket-city/nexo.php"]);
  const version = bootstrap.stdout.match(/^\s*\*\s*Version:\s*(\S+)\s*$/m)?.[1];
  assert.equal(version, packageDefinition.version);

});
