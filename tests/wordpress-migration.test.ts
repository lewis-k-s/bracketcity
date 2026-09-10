import assert from "node:assert/strict";
import test from "node:test";

import {
  qualifyDuplicatePuzzleIds,
  renderWordPressPuzzleImportSql,
  wordPressRestBase
} from "../scripts/migrate-wordpress-puzzles.ts";
import { branchPuzzle } from "./fixtures.ts";

test("WordPress migration derives the plugin REST base from a page or route URL", () => {
  assert.equal(
    wordPressRestBase("https://blog.example/puzzles/"),
    "https://blog.example/wp-json/bracket-city/v1"
  );
  assert.equal(
    wordPressRestBase("https://blog.example/wp-json/bracket-city/v1/puzzles"),
    "https://blog.example/wp-json/bracket-city/v1"
  );
  assert.throws(() => wordPressRestBase("http://blog.example/puzzles/"), /HTTPS URL/u);
});

test("WordPress migration SQL is transactional and does not expose answer text", () => {
  const definition = {
    ...structuredClone(branchPuzzle),
    id: "migration-test",
    title: "L'été",
    releaseDate: "2026-09-01",
    revision: 4
  };
  const sql = renderWordPressPuzzleImportSql([definition]);
  assert.match(sql, /^begin;/u);
  assert.match(sql, /on conflict \(release_date\) do update/u);
  assert.match(sql, /where excluded\.revision >= public\.puzzles\.revision/u);
  assert.match(sql, /'L''été'/u);
  assert.doesNotMatch(sql, new RegExp(branchPuzzle.clues.book!.answer, "u"));
  assert.match(sql, /commit;\n$/u);
});

test("WordPress migration gives reused puzzle IDs stable date-qualified values", () => {
  const source = [
    { ...structuredClone(branchPuzzle), id: "reused", releaseDate: "2026-09-02", revision: 2 },
    { ...structuredClone(branchPuzzle), id: "reused", releaseDate: "2026-09-03", revision: 5 },
    { ...structuredClone(branchPuzzle), id: "already-unique", releaseDate: "2026-09-04", revision: 1 }
  ];
  const migrated = qualifyDuplicatePuzzleIds(source);
  assert.deepEqual(migrated.map((definition) => definition.id), [
    "reused-2026-09-02",
    "reused-2026-09-03",
    "already-unique"
  ]);
  assert.deepEqual(migrated.map((definition) => definition.revision), [2, 5, 1]);
  assert.equal(source[0]!.id, "reused");
});
