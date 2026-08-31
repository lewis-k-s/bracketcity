import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolvePuzzleEntry, validatePuzzleCatalog } from "../src/catalog.js";
import { compilePuzzle, createProgress, getAvailableClues, submitGuess } from "../src/engine.js";

function readJson(relativePath) {
  return JSON.parse(readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8"));
}

const locale = readJson("locales/es-ES.json");
const manifest = readJson("puzzles/manifest.json");

test("every catalog entry loads a valid puzzle with a matching release date", () => {
  const catalog = validatePuzzleCatalog(manifest);
  for (const entry of catalog.puzzles) {
    const definition = readJson(`puzzles/${entry.file}`);
    assert.equal(definition.releaseDate, entry.date);
    assert.doesNotThrow(() => compilePuzzle(definition, locale));
  }
});

test("30 August is the catalog default and solves to the confirmed sentence", () => {
  const entry = resolvePuzzleEntry(manifest).entry;
  assert.equal(entry.date, "2026-08-30");
  const puzzle = compilePuzzle(readJson(`puzzles/${entry.file}`), locale);
  const viaje = puzzle.nodes.get("c02");
  assert.equal(puzzle.definition.revision, 2);
  assert.equal(viaje.answer, "viaje");
  assert.equal(viaje.prompt[0], "tras ");
  assert.deepEqual(viaje.children, ["c03"]);
  assert.equal(puzzle.nodes.get("c03").parent, "c02");
  assert.ok(puzzle.rootChildren.includes("c02"));
  let progress = createProgress(puzzle);
  assert.deepEqual(getAvailableClues(puzzle, progress).map((clue) => clue.id), ["c01", "c03", "c05", "c07", "c08"]);
  for (const answer of ["pieza", "lado", "para", "Hermann", "Ran", "viaje", "cono", "tío"]) {
    const transition = submitGuess(puzzle, progress, answer);
    assert.equal(transition.type, "correct", `Expected '${answer}' to solve an available clue.`);
    progress = transition.progress;
  }
  assert.ok(progress.completedAt);
  assert.equal(puzzle.definition.finalText, "Empieza el viaje para conocer otro sitio a Francia.");
});

test("31 August resolves three nested branches into the confirmed sartén sentence", () => {
  const entry = resolvePuzzleEntry(manifest, "2026-08-31").entry;
  const puzzle = compilePuzzle(readJson(`puzzles/${entry.file}`), locale);
  let progress = createProgress(puzzle);

  assert.deepEqual(getAvailableClues(puzzle, progress).map((clue) => clue.id), ["c02", "c05", "c07"]);
  assert.deepEqual(puzzle.nodes.get("c03").children, ["c04"]);
  assert.deepEqual(puzzle.nodes.get("c04").children, ["c05"]);
  assert.equal(
    puzzle.nodes
      .get("c04")
      .prompt.map((segment) => (typeof segment === "string" ? segment : puzzle.nodes.get(segment.ref).answer))
      .join(""),
    "antes de la vuelta"
  );
  assert.equal(puzzle.nodes.get("c03").answer, "arté");
  assert.equal(`s${puzzle.nodes.get("c03").answer}n`, "sartén");

  for (const answer of ["ando", "tés", "vez", "era", "ida", "Sol", "arte"]) {
    const transition = submitGuess(puzzle, progress, answer);
    assert.equal(transition.type, "correct", `Expected '${answer}' to solve an available clue.`);
    progress = transition.progress;
  }

  assert.ok(progress.completedAt);
  assert.equal(puzzle.definition.revision, 2);
  assert.equal(puzzle.definition.finalText, "Lewis se entera de la sartén para un solo huevo.");
});

test("31 August rejects simulacion and accepts unaccented arte for the sartén fragment", () => {
  const entry = resolvePuzzleEntry(manifest, "2026-08-31").entry;
  const puzzle = compilePuzzle(readJson(`puzzles/${entry.file}`), locale);
  let progress = createProgress(puzzle);

  progress = submitGuess(puzzle, progress, "tés").progress;
  progress = submitGuess(puzzle, progress, "ida").progress;
  assert.ok(getAvailableClues(puzzle, progress).some((clue) => clue.id === "c03"));

  const obsoleteAnswer = submitGuess(puzzle, progress, "simulacion");
  assert.equal(obsoleteAnswer.type, "wrong");
  assert.equal(obsoleteAnswer.progress.wrongGuesses, 1);
  assert.equal(obsoleteAnswer.progress.solved.c03, undefined);

  const correctedAnswer = submitGuess(puzzle, obsoleteAnswer.progress, "arte");
  assert.equal(correctedAnswer.type, "correct");
  assert.equal(correctedAnswer.clueId, "c03");
  assert.equal(correctedAnswer.progress.solved.c03, "guess");
});
