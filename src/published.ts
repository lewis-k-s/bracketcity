import { Data, Effect } from "effect";

import { validatePuzzle } from "./engine.ts";
import { decodePublishedPuzzleStore } from "./effect.ts";
import type { CatalogEntry, LocalePack, PuzzleDefinition, StorageLike } from "./types.ts";

export const PUBLISHED_STORAGE_KEY = "nested-clue:published:v1";
export const PUBLISHED_STORAGE_VERSION = 1;

export class PublishedPuzzleError extends Data.TaggedError("PublishedPuzzleError")<{
  readonly code: string;
  readonly message: string;
}> {
  constructor(code: string, message: string) {
    super({ code, message });
  }
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function validStoredDefinition(
  date: string,
  definition: unknown,
  localePack: LocalePack
): definition is PuzzleDefinition {
  if (!isRecord(definition) || definition.releaseDate !== date) return false;
  return validatePuzzle(definition, localePack).valid;
}

function parsePublishedStore(serialized: unknown, localePack: LocalePack): PuzzleDefinition[] | null {
  let source: unknown;
  try {
    const input: unknown = typeof serialized === "string" ? JSON.parse(serialized) : serialized;
    source = Effect.runSync(decodePublishedPuzzleStore("published puzzle storage", input));
  } catch {
    return null;
  }
  if (
    !isRecord(source) ||
    source.version !== PUBLISHED_STORAGE_VERSION ||
    !isRecord(source.puzzles) ||
    Object.keys(source).some((key) => !["version", "puzzles"].includes(key))
  ) return null;

  const definitions: PuzzleDefinition[] = [];
  const ids = new Map<string, string>();
  for (const [date, definition] of Object.entries(source.puzzles)) {
    if (!validStoredDefinition(date, definition, localePack)) return null;
    const priorDate = ids.get(definition.id);
    if (priorDate && priorDate !== date) return null;
    ids.set(definition.id, date);
    definitions.push(clone(definition));
  }
  return definitions.sort((left, right) => (right.releaseDate ?? "").localeCompare(left.releaseDate ?? ""));
}

export function restorePublishedPuzzles(storage: Pick<StorageLike, "getItem"> | null | undefined, localePack: LocalePack): PuzzleDefinition[] {
  try {
    const serialized = storage?.getItem?.(PUBLISHED_STORAGE_KEY);
    if (serialized === null || serialized === undefined) return [];
    return parsePublishedStore(serialized, localePack) ?? [];
  } catch {
    return [];
  }
}

export function serializePublishedPuzzles(definitions: readonly PuzzleDefinition[], localePack: LocalePack): string {
  if (!Array.isArray(definitions)) {
    throw new PublishedPuzzleError("INVALID_PUBLISHED_LIST", "Published puzzles must be an array.");
  }
  const puzzles: Record<string, PuzzleDefinition> = {};
  const ids = new Map<string, string>();
  for (const definition of definitions) {
    const date = definition?.releaseDate;
    if (!date || !validStoredDefinition(date, definition, localePack)) {
      throw new PublishedPuzzleError("INVALID_PUZZLE", "Only a valid puzzle with a release date can be published.");
    }
    if (Object.hasOwn(puzzles, date)) {
      throw new PublishedPuzzleError("DUPLICATE_DATE", `More than one local puzzle uses ${date}.`);
    }
    const priorDate = ids.get(definition.id);
    if (priorDate && priorDate !== date) {
      throw new PublishedPuzzleError("DUPLICATE_ID", `Puzzle ID '${definition.id}' is already used on ${priorDate}.`);
    }
    ids.set(definition.id, date);
    puzzles[date] = clone(definition);
  }
  return JSON.stringify({ version: PUBLISHED_STORAGE_VERSION, puzzles });
}

export function publishPuzzle(definition: PuzzleDefinition, {
  storage,
  localePack,
  staticDates = new Set(),
  staticPuzzles = [],
  overwrite = false
}: {
  storage?: Pick<StorageLike, "getItem" | "setItem"> | null;
  localePack: LocalePack;
  staticDates?: Set<string>;
  staticPuzzles?: readonly PuzzleDefinition[];
  overwrite?: boolean;
}): { definition: PuzzleDefinition; replaced: boolean; puzzles: PuzzleDefinition[] } {
  const date = definition?.releaseDate;
  if (!date || !validStoredDefinition(date, definition, localePack)) {
    throw new PublishedPuzzleError("INVALID_PUZZLE", "Only a valid puzzle with a release date can be published.");
  }

  const current = restorePublishedPuzzles(storage, localePack);
  const existingIndex = current.findIndex((candidate) => candidate.releaseDate === date);
  const dateExists = existingIndex >= 0 || staticDates.has(date);
  if (dateExists && !overwrite) {
    throw new PublishedPuzzleError("DATE_EXISTS", `A puzzle already exists for ${date}.`);
  }
  const duplicateId = [...current, ...staticPuzzles]
    .find((candidate) => candidate.id === definition.id && candidate.releaseDate !== date);
  if (duplicateId) {
    throw new PublishedPuzzleError(
      "DUPLICATE_ID",
      `Puzzle ID '${definition.id}' is already used on ${duplicateId.releaseDate}.`
    );
  }

  const next = current.map(clone);
  if (existingIndex >= 0) next.splice(existingIndex, 1, clone(definition));
  else next.push(clone(definition));
  const serialized = serializePublishedPuzzles(next, localePack);
  try {
    if (!storage || typeof storage.setItem !== "function") throw new Error("Storage is unavailable.");
    storage.setItem(PUBLISHED_STORAGE_KEY, serialized);
  } catch {
    throw new PublishedPuzzleError("STORAGE_WRITE_FAILED", "The published puzzle could not be saved.");
  }
  return {
    definition: clone(definition),
    replaced: dateExists,
    puzzles: next.sort((left, right) => (right.releaseDate ?? "").localeCompare(left.releaseDate ?? ""))
  };
}

export function mergePublishedPuzzles(
  staticEntries: readonly CatalogEntry[],
  definitions: readonly PuzzleDefinition[]
): Array<CatalogEntry & { origin: "static" | "local" }> {
  const byDate = new Map<string, CatalogEntry & { origin: "static" | "local" }>();
  for (const entry of staticEntries ?? []) {
    byDate.set(entry.date, { ...clone(entry), origin: "static" });
  }
  for (const definition of definitions ?? []) {
    if (!definition.releaseDate) continue;
    byDate.set(definition.releaseDate, {
      date: definition.releaseDate,
      definition: clone(definition),
      origin: "local"
    });
  }
  return [...byDate.values()].sort((left, right) => right.date.localeCompare(left.date));
}
