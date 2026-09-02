import assert from "node:assert/strict";
import test from "node:test";
import {
  PuzzleCatalogError,
  readRequestedPuzzleDate,
  resolvePuzzleEntry,
  validatePuzzleCatalog
} from "../src/catalog.ts";

function manifest(): any {
  return {
    schemaVersion: 1,
    defaultDate: "2026-08-30",
    puzzles: [
      { date: "2026-08-28", file: "demo-es.json" },
      { date: "2026-08-30", file: "2026-08-30-es.json" }
    ]
  };
}

function errorCode(operation: () => unknown): string | null {
  try {
    operation();
    return null;
  } catch (error) {
    assert.ok(error instanceof PuzzleCatalogError);
    return error.code;
  }
}

test("catalog validation returns newest-first safe entries", () => {
  const result = validatePuzzleCatalog(manifest());
  assert.deepEqual(result.puzzles.map((entry) => entry.date), ["2026-08-30", "2026-08-28"]);
});

test("catalog default and exact requested dates resolve through the table", () => {
  assert.equal(resolvePuzzleEntry(manifest()).entry.file, "2026-08-30-es.json");
  assert.equal(resolvePuzzleEntry(manifest(), "2026-08-28").entry.file, "demo-es.json");
});

test("catalog rejects duplicate dates and a missing default entry", () => {
  const duplicate = manifest();
  duplicate.puzzles.push({ date: "2026-08-30", file: "copy.json" });
  assert.equal(errorCode(() => validatePuzzleCatalog(duplicate)), "DUPLICATE_CATALOG_DATE");
  const missingDefault = manifest();
  missingDefault.defaultDate = "2026-08-29";
  assert.equal(errorCode(() => validatePuzzleCatalog(missingDefault)), "MISSING_DEFAULT_ENTRY");
});

test("catalog rejects impossible and unknown requested dates", () => {
  assert.equal(errorCode(() => resolvePuzzleEntry(manifest(), "2026-02-30")), "INVALID_PUZZLE_DATE");
  assert.equal(errorCode(() => resolvePuzzleEntry(manifest(), "2026-08-29")), "UNKNOWN_PUZZLE_DATE");
});

test("catalog rejects file traversal, URLs, and unknown entry fields", () => {
  for (const file of ["../secret.json", "/puzzle.json", "https://example.test/puzzle.json", "puzzle.json?x=1"]) {
    const unsafe = manifest();
    unsafe.puzzles[0].file = file;
    assert.equal(errorCode(() => validatePuzzleCatalog(unsafe)), "UNSAFE_PUZZLE_FILE");
  }
  const unknown = manifest();
  unknown.puzzles[0].title = "Duplicated metadata";
  assert.equal(errorCode(() => validatePuzzleCatalog(unknown)), "UNKNOWN_CATALOG_KEY");
});

test("date query parsing rejects duplicate values", () => {
  assert.equal(readRequestedPuzzleDate(new URLSearchParams()), null);
  assert.equal(readRequestedPuzzleDate(new URLSearchParams("date=2026-08-30")), "2026-08-30");
  assert.equal(
    errorCode(() => readRequestedPuzzleDate(new URLSearchParams("date=2026-08-30&date=2026-08-28"))),
    "DUPLICATE_PUZZLE_DATE"
  );
});
