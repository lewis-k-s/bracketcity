import { validatePuzzle } from "./engine.js";

export const PUBLISHED_STORAGE_KEY = "nested-clue:published:v1";
export const PUBLISHED_STORAGE_VERSION = 1;

export class PublishedPuzzleError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PublishedPuzzleError";
    this.code = code;
  }
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return structuredClone(value);
}

function validStoredDefinition(date, definition, localePack) {
  if (!isRecord(definition) || definition.releaseDate !== date) return false;
  return validatePuzzle(definition, localePack).valid;
}

function parsePublishedStore(serialized, localePack) {
  let source;
  try {
    source = typeof serialized === "string" ? JSON.parse(serialized) : serialized;
  } catch {
    return null;
  }
  if (
    !isRecord(source) ||
    source.version !== PUBLISHED_STORAGE_VERSION ||
    !isRecord(source.puzzles) ||
    Object.keys(source).some((key) => !["version", "puzzles"].includes(key))
  ) return null;

  const definitions = [];
  const ids = new Map();
  for (const [date, definition] of Object.entries(source.puzzles)) {
    if (!validStoredDefinition(date, definition, localePack)) return null;
    const priorDate = ids.get(definition.id);
    if (priorDate && priorDate !== date) return null;
    ids.set(definition.id, date);
    definitions.push(clone(definition));
  }
  return definitions.sort((left, right) => right.releaseDate.localeCompare(left.releaseDate));
}

export function restorePublishedPuzzles(storage, localePack) {
  try {
    const serialized = storage?.getItem?.(PUBLISHED_STORAGE_KEY);
    if (serialized === null || serialized === undefined) return [];
    return parsePublishedStore(serialized, localePack) ?? [];
  } catch {
    return [];
  }
}

export function serializePublishedPuzzles(definitions, localePack) {
  if (!Array.isArray(definitions)) {
    throw new PublishedPuzzleError("INVALID_PUBLISHED_LIST", "Published puzzles must be an array.");
  }
  const puzzles = {};
  const ids = new Map();
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

export function publishPuzzle(definition, {
  storage,
  localePack,
  staticDates = new Set(),
  staticPuzzles = [],
  overwrite = false
} = {}) {
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
    puzzles: next.sort((left, right) => right.releaseDate.localeCompare(left.releaseDate))
  };
}

export function mergePublishedPuzzles(staticEntries, definitions) {
  const byDate = new Map();
  for (const entry of staticEntries ?? []) {
    byDate.set(entry.date, { ...clone(entry), origin: "static" });
  }
  for (const definition of definitions ?? []) {
    byDate.set(definition.releaseDate, {
      date: definition.releaseDate,
      definition: clone(definition),
      origin: "local"
    });
  }
  return [...byDate.values()].sort((left, right) => right.date.localeCompare(left.date));
}
