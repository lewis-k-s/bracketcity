import { readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dockerImage = "php:8.3-cli";

function commandAvailable(command, args = ["--version"]) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: "ignore"
  });
  return !result.error && result.status === 0;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    stdio: "inherit",
    ...options
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with ${result.status}`);
  }
}

function phpFiles(directory) {
  const files = [];
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) files.push(...phpFiles(path));
    else if (name.endsWith(".php")) files.push(path);
  }
  return files.sort();
}

function runWithLocalPhp() {
  for (const path of phpFiles(join(projectRoot, "wordpress-plugin"))) {
    run("php", ["-l", path]);
  }
  for (const path of phpFiles(join(projectRoot, "tests", "php"))) {
    run("php", ["-l", path]);
  }
  run("sh", ["tests/php/run.sh"]);
}

function runWithDocker() {
  const checks = [
    "find wordpress-plugin tests/php -type f -name '*.php' -exec php -l {} \\;",
    "sh tests/php/run.sh"
  ].join(" && ");
  run("docker", [
    "run",
    "--rm",
    "--mount",
    `type=bind,src=${projectRoot},dst=/workspace,readonly`,
    "--workdir",
    "/workspace",
    dockerImage,
    "sh",
    "-c",
    checks
  ]);
}

export function selectPhpRuntime({ hasPhp, hasShell, hasDocker }) {
  if (hasPhp && hasShell) return "local";
  if (hasDocker) return "docker";
  return null;
}

export function main() {
  const runtime = selectPhpRuntime({
    hasPhp: commandAvailable("php"),
    hasShell: commandAvailable("sh", ["-c", "exit 0"]),
    hasDocker: commandAvailable("docker")
  });
  if (runtime === "local") {
    console.log("Running PHP lint and tests with local PHP.");
    runWithLocalPhp();
    return;
  }
  if (runtime === "docker") {
    console.log(`Local PHP is unavailable; running PHP lint and tests with ${dockerImage}.`);
    runWithDocker();
    return;
  }
  throw new Error(
    "PHP checks require either local `php` plus `sh`, or a working Docker installation. " +
    `Install one of them, then run \`npm run test:php\` again. Docker uses ${dockerImage}.`
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`PHP validation failed: ${error.message}`);
    process.exitCode = 1;
  }
}
