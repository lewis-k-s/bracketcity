import { readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Data, Effect } from "effect";
import type { SpawnSyncOptions } from "node:child_process";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dockerImage = "php:8.3-cli";

export class PhpTestError extends Data.TaggedError("PhpTestError")<{
  readonly message: string;
  readonly cause: unknown;
}> {}

function commandAvailable(command: string, args: readonly string[] = ["--version"]): boolean {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: "ignore"
  });
  return !result.error && result.status === 0;
}

function run(command: string, args: readonly string[], options: SpawnSyncOptions = {}): void {
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

function phpFiles(directory: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) files.push(...phpFiles(path));
    else if (name.endsWith(".php")) files.push(path);
  }
  return files.sort();
}

function runWithLocalPhp(): void {
  for (const path of phpFiles(join(projectRoot, "wordpress-plugin"))) {
    run("php", ["-l", path]);
  }
  for (const path of phpFiles(join(projectRoot, "tests", "php"))) {
    run("php", ["-l", path]);
  }
  for (const path of phpFiles(join(projectRoot, "scripts"))) {
    run("php", ["-l", path]);
  }
  run("sh", ["tests/php/run.sh"]);
}

function runWithDocker(): void {
  const checks = [
    "find wordpress-plugin tests/php scripts -type f -name '*.php' -exec php -l {} \\;",
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

export function selectPhpRuntime({ hasPhp, hasShell, hasDocker }: {
  readonly hasPhp: boolean;
  readonly hasShell: boolean;
  readonly hasDocker: boolean;
}): "local" | "docker" | null {
  if (hasPhp && hasShell) return "local";
  if (hasDocker) return "docker";
  return null;
}

export function main(): void {
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

export const mainEffect: Effect.Effect<void, PhpTestError> = Effect.try({
  try: main,
  catch: (cause) => new PhpTestError({
    message: cause instanceof Error ? cause.message : String(cause),
    cause
  })
});

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  Effect.runPromise(mainEffect).catch((error: PhpTestError) => {
    console.error(`PHP validation failed: ${error.message}`);
    process.exitCode = 1;
  });
}
