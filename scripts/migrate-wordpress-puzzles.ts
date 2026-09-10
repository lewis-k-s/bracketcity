import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";

import { decodePuzzleDefinition } from "../src/effect.ts";
import { validatePuzzle } from "../src/engine.ts";
import type { PuzzleDefinition } from "../src/types.ts";

interface WordPressListing {
  readonly puzzles?: readonly unknown[];
  readonly dates?: readonly unknown[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function wordPressRestBase(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("The WordPress source must be an HTTPS URL without credentials, a query, or a fragment.");
  }
  const route = "/wp-json/bracket-city/v1";
  const routeIndex = url.pathname.indexOf(route);
  url.pathname = routeIndex >= 0 ? url.pathname.slice(0, routeIndex + route.length) : route;
  return url.href.replace(/\/+$/u, "");
}

export function renderWordPressPuzzleImportSql(definitions: readonly PuzzleDefinition[]): string {
  if (definitions.length === 0) throw new Error("There are no WordPress puzzles to import.");
  const values = definitions.map((definition) => {
    if (!definition.releaseDate) throw new Error(`Puzzle ${definition.id} has no release date.`);
    const encodedDefinition = Buffer.from(JSON.stringify(definition), "utf8").toString("base64");
    return `(
    ${sqlString(definition.releaseDate)}::date,
    ${sqlString(definition.id)},
    ${definition.schemaVersion},
    ${definition.revision ?? 1},
    ${sqlString(definition.locale)},
    ${sqlString(definition.title ?? definition.releaseDate)},
    ${definition.difficulty ? sqlString(definition.difficulty) : "null"},
    convert_from(decode(${sqlString(encodedDefinition)}, 'base64'), 'utf8')::jsonb,
    'published'
  )`;
  }).join(",\n  ");

  return `begin;

insert into public.puzzles (
  release_date,
  puzzle_id,
  schema_version,
  revision,
  locale,
  title,
  difficulty,
  definition,
  status
) values
  ${values}
on conflict (release_date) do update set
  puzzle_id = excluded.puzzle_id,
  schema_version = excluded.schema_version,
  revision = excluded.revision,
  locale = excluded.locale,
  title = excluded.title,
  difficulty = excluded.difficulty,
  definition = excluded.definition,
  status = 'published',
  updated_at = now()
where excluded.revision >= public.puzzles.revision;

commit;
`;
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  const text = await response.text();
  if (!response.ok) throw new Error(`WordPress returned ${response.status} for ${url}.`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`WordPress returned non-JSON content for ${url}.`);
  }
}

export async function readPublicWordPressPuzzles(sourceUrl: string): Promise<PuzzleDefinition[]> {
  const base = wordPressRestBase(sourceUrl);
  const listing = await fetchJson(`${base}/puzzles`);
  if (!isRecord(listing)) throw new Error("WordPress returned an invalid puzzle listing.");
  const rawEntries = (listing as WordPressListing).puzzles ?? (listing as WordPressListing).dates;
  if (!Array.isArray(rawEntries)) throw new Error("WordPress returned no puzzle list.");
  const rawDates = rawEntries.map((entry) => typeof entry === "string"
    ? entry
    : isRecord(entry) ? entry.date : null);
  if (rawDates.some((date) => typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(date))) {
    throw new Error("WordPress returned an invalid puzzle date.");
  }
  const dates = rawDates as string[];

  const definitions = await Promise.all(dates.map(async (date) => {
    const definition = await Effect.runPromise(decodePuzzleDefinition(
      `WordPress puzzle ${date}`,
      await fetchJson(`${base}/puzzles/${encodeURIComponent(date)}`)
    ));
    const validation = validatePuzzle(definition);
    if (!validation.valid) {
      throw new Error(`WordPress puzzle ${date} is invalid: ${validation.errors[0]?.message ?? "unknown error"}`);
    }
    if (definition.releaseDate !== date) {
      throw new Error(`WordPress puzzle ${date} has a different releaseDate.`);
    }
    return definition;
  }));
  return definitions.sort((left, right) => left.releaseDate!.localeCompare(right.releaseDate!));
}

export function qualifyDuplicatePuzzleIds(definitions: readonly PuzzleDefinition[]): PuzzleDefinition[] {
  const counts = new Map<string, number>();
  for (const definition of definitions) {
    counts.set(definition.id, (counts.get(definition.id) ?? 0) + 1);
  }
  const migrated = definitions.map((definition) => {
    if (counts.get(definition.id) === 1) return structuredClone(definition);
    if (!definition.releaseDate) throw new Error(`Puzzle ${definition.id} has no release date.`);
    return {
      ...structuredClone(definition),
      id: `${definition.id}-${definition.releaseDate}`
    };
  });
  const ids = new Set<string>();
  for (const definition of migrated) {
    if (ids.has(definition.id)) {
      throw new Error(`Migration could not create a unique puzzle ID for ${definition.id}.`);
    }
    ids.add(definition.id);
    const validation = validatePuzzle(definition);
    if (!validation.valid) {
      throw new Error(`Migrated puzzle ${definition.releaseDate ?? definition.id} is invalid: ${validation.errors[0]?.message ?? "unknown error"}`);
    }
  }
  return migrated;
}

async function main(): Promise<void> {
  const sourceUrl = process.argv.find((argument, index) => index > 1 && !argument.startsWith("--"));
  const apply = process.argv.includes("--apply");
  if (!sourceUrl) {
    throw new Error("Usage: tsx scripts/migrate-wordpress-puzzles.ts <WordPress page or REST URL> [--apply]");
  }
  const sourceDefinitions = await readPublicWordPressPuzzles(sourceUrl);
  const definitions = qualifyDuplicatePuzzleIds(sourceDefinitions);
  const dates = definitions.map((definition) => definition.releaseDate).join(", ");
  console.log(`Validated ${definitions.length} public WordPress puzzle(s): ${dates}`);
  const changedIds = definitions.flatMap((definition, index) => (
    definition.id === sourceDefinitions[index]!.id
      ? []
      : [`${sourceDefinitions[index]!.id} -> ${definition.id}`]
  ));
  if (changedIds.length > 0) {
    console.log(`Qualified duplicate puzzle IDs: ${changedIds.join(", ")}`);
  }
  if (!apply) {
    console.log("Dry run only. Add --apply to import these rows into the linked Supabase project.");
    return;
  }

  const temporaryDirectory = await mkdtemp(join(tmpdir(), "nexo-wordpress-import-"));
  const sqlPath = join(temporaryDirectory, "import.sql");
  try {
    await writeFile(sqlPath, renderWordPressPuzzleImportSql(definitions), { mode: 0o600 });
    const result = spawnSync(
      "npx",
      ["--yes", "supabase@2.117.0", "db", "query", "--linked", "--file", sqlPath],
      { cwd: fileURLToPath(new URL("..", import.meta.url)), stdio: "inherit" }
    );
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Supabase import exited with status ${result.status}.`);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
