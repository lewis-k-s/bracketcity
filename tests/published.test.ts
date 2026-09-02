import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  PUBLISHED_STORAGE_KEY,
  PublishedPuzzleError,
  mergePublishedPuzzles,
  publishPuzzle,
  restorePublishedPuzzles,
  serializePublishedPuzzles
} from "../src/published.ts";
import { esLocale } from "./fixtures.ts";
import type { PuzzleDefinition, StorageLike } from "../src/types.ts";

function puzzle(filename: string): PuzzleDefinition {
  return JSON.parse(readFileSync(new URL(`../puzzles/${filename}`, import.meta.url), "utf8")) as PuzzleDefinition;
}

function memoryStorage(initial: string | null = null): StorageLike & { value(key: string): string | null } {
  const values = new Map<string, string>(initial === null ? [] : [[PUBLISHED_STORAGE_KEY, initial]]);
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
    value(key) { return values.get(key) ?? null; }
  };
}

function errorCode(operation: () => unknown): string | null {
  try {
    operation();
    return null;
  } catch (error) {
    assert.ok(error instanceof PublishedPuzzleError);
    return error.code;
  }
}

test("published puzzles serialize and restore as validated newest-first definitions", () => {
  const older = puzzle("2026-08-30-es.json");
  const newer = puzzle("2026-08-31-es.json");
  const storage = memoryStorage(serializePublishedPuzzles([older, newer], esLocale));
  assert.deepEqual(restorePublishedPuzzles(storage, esLocale), [newer, older]);
});

test("restore fails closed for unreadable, malformed, invalid, and duplicate-ID stores", () => {
  const valid = puzzle("2026-08-30-es.json");
  const invalid = clone(valid);
  invalid.finalText = "No coincide";
  const duplicate = clone(valid);
  duplicate.releaseDate = "2026-09-01";
  for (const value of [
    "{",
    JSON.stringify({ version: 2, puzzles: {} }),
    JSON.stringify({ version: 1, puzzles: { "2026-08-30": invalid } }),
    JSON.stringify({ version: 1, puzzles: { "2026-08-30": valid, "2026-09-01": duplicate } })
  ]) {
    assert.deepEqual(restorePublishedPuzzles(memoryStorage(value), esLocale), []);
  }
  assert.deepEqual(restorePublishedPuzzles({ getItem() { throw new Error("blocked"); } }, esLocale), []);
});

test("publishing a new date writes it without changing the caller definition", () => {
  const definition = puzzle("2026-08-31-es.json");
  const before = clone(definition);
  const storage = memoryStorage();
  const result = publishPuzzle(definition, { storage, localePack: esLocale });
  assert.deepEqual(definition, before);
  assert.equal(result.replaced, false);
  assert.deepEqual(restorePublishedPuzzles(storage, esLocale), [definition]);
});

test("existing local and static dates require explicit overwrite", () => {
  const definition = puzzle("2026-08-30-es.json");
  const storage = memoryStorage(serializePublishedPuzzles([definition], esLocale));
  assert.equal(errorCode(() => publishPuzzle(definition, { storage, localePack: esLocale })), "DATE_EXISTS");

  const empty = memoryStorage();
  assert.equal(errorCode(() => publishPuzzle(definition, {
    storage: empty,
    localePack: esLocale,
    staticDates: new Set([definition.releaseDate!])
  })), "DATE_EXISTS");
  const replaced = publishPuzzle(definition, {
    storage: empty,
    localePack: esLocale,
    staticDates: new Set([definition.releaseDate!]),
    overwrite: true
  });
  assert.equal(replaced.replaced, true);
});

test("publishing rejects a duplicate puzzle ID on another local date", () => {
  const first = puzzle("2026-08-30-es.json");
  const duplicate = clone(first);
  duplicate.releaseDate = "2026-09-01";
  const storage = memoryStorage(serializePublishedPuzzles([first], esLocale));
  assert.equal(errorCode(() => publishPuzzle(duplicate, { storage, localePack: esLocale })), "DUPLICATE_ID");
  assert.deepEqual(restorePublishedPuzzles(storage, esLocale), [first]);
});

test("publishing rejects a puzzle ID used by a static puzzle on another date", () => {
  const existing = puzzle("2026-08-30-es.json");
  const duplicate = clone(existing);
  duplicate.releaseDate = "2026-09-01";
  const storage = memoryStorage();
  assert.equal(errorCode(() => publishPuzzle(duplicate, {
    storage,
    localePack: esLocale,
    staticPuzzles: [existing]
  })), "DUPLICATE_ID");
  assert.equal(storage.value(PUBLISHED_STORAGE_KEY), null);
});

test("a failed write leaves prior published data intact", () => {
  const prior = puzzle("2026-08-30-es.json");
  const next = puzzle("2026-08-31-es.json");
  const serialized = serializePublishedPuzzles([prior], esLocale);
  const storage = {
    getItem() { return serialized; },
    setItem() { throw new Error("quota"); }
  };
  assert.equal(errorCode(() => publishPuzzle(next, { storage, localePack: esLocale })), "STORAGE_WRITE_FAILED");
  assert.deepEqual(restorePublishedPuzzles(storage, esLocale), [prior]);
  assert.equal(errorCode(() => publishPuzzle(next, { localePack: esLocale })), "STORAGE_WRITE_FAILED");
});

test("local definitions replace static dates and add new dates in merged order", () => {
  const local = puzzle("2026-08-30-es.json");
  local.title = "Versión local";
  const extra = puzzle("2026-08-31-es.json");
  const merged = mergePublishedPuzzles([
    { date: "2026-08-30", file: "static.json" },
    { date: "2026-08-28", file: "older.json" }
  ], [local, extra]);
  assert.deepEqual(merged.map((entry) => [entry.date, entry.origin]), [
    ["2026-08-31", "local"],
    ["2026-08-30", "local"],
    ["2026-08-28", "static"]
  ]);
  assert.equal(merged[1]!.definition!.title, "Versión local");
  assert.equal(Object.hasOwn(merged[1]!, "file"), false);
});

function clone<T>(value: T): T {
  return structuredClone(value);
}
