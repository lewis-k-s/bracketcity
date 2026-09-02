import { deflateRawSync } from "node:zlib";
import {
  cp,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { Data, Effect } from "effect";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pluginSource = join(projectRoot, "wordpress-plugin");
const releaseDirectory = join(projectRoot, "release");
const archiveRoot = "bracket-city";

interface ArchiveFile {
  readonly name: string;
  readonly data: Buffer;
}

interface PackageOptions {
  readonly runChecks?: boolean;
  readonly writeArchive?: boolean;
  readonly archivePath?: string;
}

export interface PackageResult {
  readonly archivePath?: string;
  readonly files: ArchiveFile[];
  readonly pluginStage: string;
}

export class PluginPackageError extends Data.TaggedError("PluginPackageError")<{
  readonly message: string;
  readonly cause: unknown;
}> {}

function run(command: string, args: readonly string[]): void {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    stdio: "inherit",
    shell: process.platform === "win32"
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with ${result.status}`);
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function copyDirectoryContents(source: string, destination: string): Promise<void> {
  if (!(await pathExists(source))) {
    throw new Error(`Required plugin source directory is missing: ${source}`);
  }
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (["build", "seed", ".DS_Store", ".gitkeep"].includes(entry.name)) continue;
    await cp(join(source, entry.name), join(destination, entry.name), {
      recursive: true
    });
  }
}

async function copySeeds(destination: string): Promise<void> {
  await mkdir(destination, { recursive: true });
  const puzzleDirectory = join(projectRoot, "puzzles");
  const names = (await readdir(puzzleDirectory))
    .filter((name) => /^\d{4}-\d{2}-\d{2}(?:-[a-z]{2})?\.json$/i.test(name))
    .sort();
  if (names.length === 0) throw new Error("No dated seed puzzles were found.");
  for (const name of names) {
    await cp(join(puzzleDirectory, name), join(destination, name));
  }
}

async function collectFiles(root: string, directory = root): Promise<ArchiveFile[]> {
  const files: ArchiveFile[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(root, absolute));
    else if (entry.isFile()) {
      files.push({
        name: relative(dirname(root), absolute).split(sep).join("/"),
        data: await readFile(absolute)
      });
    }
  }
  return files.sort((left, right) => left.name.localeCompare(right.name));
}

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
  }
  return crc >>> 0;
});

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function createZip(files: readonly ArchiveFile[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const compressed = deflateRawSync(file.data, { level: 9 });
    const checksum = crc32(file.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(33, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(33, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(file.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + compressed.length;
  }

  const centralSize = centralParts.reduce((size, part) => size + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, ...centralParts, end]);
}

export async function stagePlugin(): Promise<string> {
  const stageDirectory = await mkdtemp(join(tmpdir(), "nexo-package-"));
  const pluginStage = join(stageDirectory, archiveRoot);
  await copyDirectoryContents(pluginSource, pluginStage);
  await copySeeds(join(pluginStage, "seed"));
  return pluginStage;
}

export async function verifyStagedPlugin(pluginStage: string): Promise<ArchiveFile[]> {
  const required = [
    "nexo.php",
    "includes",
    "seed"
  ];
  for (const item of required) {
    if (!(await pathExists(join(pluginStage, item)))) {
      throw new Error(`Packaged plugin is missing ${item}`);
    }
  }
  return collectFiles(pluginStage);
}

export async function packagePlugin({
  runChecks = true,
  writeArchive = true,
  archivePath: requestedArchivePath
}: PackageOptions = {}): Promise<PackageResult> {
  if (runChecks) {
    run("npm", ["run", "test:unit"]);
    run("npm", ["run", "test:php"]);
    run(process.execPath, ["--import", "tsx", "--test", "tests/package/package.test.ts", "tests/package/php-runner.test.ts"]);
  }
  const packageDefinition = JSON.parse(await readFile(join(projectRoot, "package.json"), "utf8"));
  const pluginStage = await stagePlugin();
  const files = await verifyStagedPlugin(pluginStage);
  if (!writeArchive) return { files, pluginStage };
  const archivePath = requestedArchivePath
    ? resolve(requestedArchivePath)
    : join(releaseDirectory, `nexo-${packageDefinition.version}.zip`);
  await mkdir(dirname(archivePath), { recursive: true });
  await writeFile(archivePath, createZip(files));
  return { archivePath, files, pluginStage };
}

export function packagePluginEffect(options: PackageOptions = {}): Effect.Effect<PackageResult, PluginPackageError> {
  return Effect.tryPromise({
    try: () => packagePlugin(options),
    catch: (cause) => new PluginPackageError({
      message: cause instanceof Error ? cause.message : String(cause),
      cause
    })
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const verifyOnly = process.argv.includes("--verify-only");
  const skipChecks = process.argv.includes("--skip-checks");
  let result;
  try {
    result = await Effect.runPromise(packagePluginEffect({ runChecks: !skipChecks, writeArchive: !verifyOnly }));
    if (verifyOnly) {
      console.log(`Verified ${result.files.length} packaged files.`);
    } else {
      console.log(`Created ${result.archivePath ?? "archive"} with ${result.files.length} files.`);
    }
  } finally {
    if (result?.pluginStage) {
      await rm(dirname(result.pluginStage), { recursive: true, force: true });
    }
  }
}
