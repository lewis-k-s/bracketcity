import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateScore,
  compilePuzzle,
  createProgress,
  firstGrapheme,
  getAvailableClues,
  isComplete,
  normalizeAnswer,
  peekClue,
  progressStorageKey,
  recordKeystroke,
  restoreProgress,
  serializeProgress,
  submitGuess,
  validatePuzzle
} from "../src/engine.js";
import { branchPuzzle, esLocale, freshBranch } from "./fixtures.js";

const ids = (clues) => clues.map((clue) => clue.id);
const errorCodes = (definition) => validatePuzzle(definition, esLocale).errors.map((error) => error.code);

function solve(puzzle, progress, ...guesses) {
  return guesses.reduce((state, guess, index) => submitGuess(puzzle, state, guess, `2026-08-28T10:00:${String(index).padStart(2, "0")}Z`).progress, progress);
}

test("valid puzzle compiles into ordered parent and child links", () => {
  const puzzle = compilePuzzle(branchPuzzle, esLocale);
  assert.equal(puzzle.nodes.size, 5);
  assert.deepEqual(puzzle.rootChildren, ["object"]);
  assert.deepEqual(puzzle.nodes.get("object").children, ["book", "colour"]);
  assert.equal(puzzle.nodes.get("book").parent, "object");
  assert.equal(puzzle.nodes.get("object").parent, null);
});

test("only leaves are initially available in stable document order", () => {
  const puzzle = compilePuzzle(branchPuzzle, esLocale);
  assert.deepEqual(ids(getAvailableClues(puzzle, createProgress(puzzle))), ["lib", "sky"]);
});

test("solving a leaf unlocks its parent", () => {
  const puzzle = compilePuzzle(branchPuzzle, esLocale);
  const transition = submitGuess(puzzle, createProgress(puzzle), "lib", "2026-08-28T10:00:00Z");
  assert.equal(transition.type, "correct");
  assert.equal(transition.progress.solved.lib, "guess");
  assert.deepEqual(transition.newlyAvailable, ["book"]);
  assert.deepEqual(ids(getAvailableClues(puzzle, transition.progress)), ["book", "sky"]);
});

test("an accepted alias solves the available clue but keeps its canonical answer", () => {
  const puzzle = compilePuzzle(branchPuzzle, esLocale);
  const progress = solve(puzzle, createProgress(puzzle), "lib");
  const transition = submitGuess(puzzle, progress, "volumen", "2026-08-28T10:01:00Z");
  assert.equal(transition.clueId, "book");
  assert.equal(puzzle.nodes.get("book").answer, "libro");
});

test("a parent with one solved branch remains locked", () => {
  const puzzle = compilePuzzle(branchPuzzle, esLocale);
  const progress = solve(puzzle, createProgress(puzzle), "lib", "libro");
  assert.equal(ids(getAvailableClues(puzzle, progress)).includes("object"), false);
});

test("both sibling branches unlock their parent exactly once", () => {
  const puzzle = compilePuzzle(branchPuzzle, esLocale);
  const progress = solve(puzzle, createProgress(puzzle), "lib", "libro", "cielo", "azul");
  assert.deepEqual(ids(getAvailableClues(puzzle, progress)), ["object"]);
});

test("a locked correct answer is treated as one wrong guess", () => {
  const puzzle = compilePuzzle(branchPuzzle, esLocale);
  const transition = submitGuess(puzzle, createProgress(puzzle), "libro azul", "2026-08-28T10:00:00Z");
  assert.equal(transition.type, "wrong");
  assert.equal(transition.progress.wrongGuesses, 1);
  assert.deepEqual(transition.progress.solved, {});
});

test("empty guesses are free no-ops", () => {
  const puzzle = compilePuzzle(branchPuzzle, esLocale);
  const progress = createProgress(puzzle);
  const transition = submitGuess(puzzle, progress, "   ");
  assert.equal(transition.type, "empty");
  assert.strictEqual(transition.progress, progress);
  assert.equal(transition.progress.startedAt, undefined);
});

test("a duplicate solved answer is wrong when no available clue accepts it", () => {
  const puzzle = compilePuzzle(branchPuzzle, esLocale);
  const progress = solve(puzzle, createProgress(puzzle), "lib");
  const transition = submitGuess(puzzle, progress, "lib", "2026-08-28T10:01:00Z");
  assert.equal(transition.type, "wrong");
  assert.equal(transition.progress.wrongGuesses, 1);
});

test("transitions do not mutate their input progress", () => {
  const puzzle = compilePuzzle(branchPuzzle, esLocale);
  const before = createProgress(puzzle);
  const snapshot = structuredClone(before);
  submitGuess(puzzle, before, "lib", "2026-08-28T10:00:00Z");
  assert.deepEqual(before, snapshot);
});

test("the complete leaf-first path produces the final sentence state", () => {
  const puzzle = compilePuzzle(branchPuzzle, esLocale);
  const progress = solve(puzzle, createProgress(puzzle), "lib", "volumen", "cielo", "azul", "libro azul");
  assert.equal(isComplete(puzzle, progress), true);
  assert.equal(progress.completedAt, "2026-08-28T10:00:04.000Z");
  const noChange = submitGuess(puzzle, progress, "anything");
  assert.strictEqual(noChange.progress, progress);
});

test("normalization supports Spanish case, whitespace, NFC, and optional acute vowels", () => {
  const policy = esLocale.matching;
  assert.equal(normalizeAnswer("  ÁR\tBOL  ", policy), "ar bol");
  assert.equal(normalizeAnswer("a\u0301rbol", policy), normalizeAnswer("Árbol", policy));
  assert.equal(normalizeAnswer("envio", policy), normalizeAnswer("envió", policy));
});

test("acute folding does not collapse enye or diaeresis", () => {
  const policy = esLocale.matching;
  assert.notEqual(normalizeAnswer("año", policy), normalizeAnswer("ano", policy));
  assert.notEqual(normalizeAnswer("pingüino", policy), normalizeAnswer("pinguino", policy));
});

test("quote and hyphen canonicalization are configurable", () => {
  const policy = { ...esLocale.matching, optionalAcuteVowels: false };
  assert.equal(normalizeAnswer("d’Artagnan", policy), normalizeAnswer("d'Artagnan", policy));
  assert.equal(normalizeAnswer("María—José", policy), normalizeAnswer("María-José", policy));
  assert.notEqual(normalizeAnswer("hola!", policy), normalizeAnswer("hola", policy));
  assert.equal(normalizeAnswer("hola!", { ...policy, ignorePunctuation: true }), normalizeAnswer("hola", { ...policy, ignorePunctuation: true }));
});

test("first-letter peeks use complete grapheme clusters", () => {
  assert.equal(firstGrapheme("A\u0301rbol", "es-ES"), "Á");
  assert.equal(firstGrapheme("👩🏽‍🔬 ciencia", "es-ES"), "👩🏽‍🔬");
});

test("peeks are idempotent and never solve or unlock a clue", () => {
  const puzzle = compilePuzzle(branchPuzzle, esLocale);
  const initial = createProgress(puzzle);
  const peek = peekClue(puzzle, initial, "lib", "2026-08-28T10:00:00Z");
  assert.equal(peek.type, "peek");
  assert.deepEqual(peek.progress.peeked, ["lib"]);
  assert.equal(peek.progress.solved.lib, undefined);
  const repeatedPeek = peekClue(puzzle, peek.progress, "lib", "2026-08-28T10:01:00Z");
  assert.equal(repeatedPeek.type, "noop");
  assert.strictEqual(repeatedPeek.progress, peek.progress);
  assert.deepEqual(repeatedPeek.progress.solved, {});
  assert.deepEqual(repeatedPeek.newlyAvailable, []);
  assert.equal(ids(getAvailableClues(puzzle, repeatedPeek.progress)).includes("book"), false);

  const submitted = submitGuess(puzzle, repeatedPeek.progress, "lib", "2026-08-28T10:02:00Z");
  assert.equal(submitted.progress.solved.lib, "guess");
  assert.deepEqual(submitted.newlyAvailable, ["book"]);
});

test("tap-only play cannot solve, unlock, or complete any branch", () => {
  const puzzle = compilePuzzle(branchPuzzle, esLocale);
  let progress = createProgress(puzzle);
  for (const clueId of ["lib", "sky"]) {
    progress = peekClue(puzzle, progress, clueId).progress;
    progress = peekClue(puzzle, progress, clueId).progress;
  }
  assert.deepEqual(progress.solved, {});
  assert.deepEqual(progress.peeked, ["lib", "sky"]);
  assert.deepEqual(ids(getAvailableClues(puzzle, progress)), ["lib", "sky"]);
  assert.equal(isComplete(puzzle, progress), false);
});

test("hint actions on locked clues do nothing", () => {
  const puzzle = compilePuzzle(branchPuzzle, esLocale);
  const progress = createProgress(puzzle);
  const transition = peekClue(puzzle, progress, "object");
  assert.equal(transition.type, "noop");
  assert.strictEqual(transition.progress, progress);
});

test("explicit peek metadata overrides the first grapheme", () => {
  const definition = freshBranch();
  definition.clues.lib.peek = "Ele";
  const puzzle = compilePuzzle(definition, esLocale);
  assert.equal(puzzle.nodes.get("lib").peek, "Ele");
});

test("score penalties are data-driven, additive, idempotent, and clamped", () => {
  const puzzle = compilePuzzle(branchPuzzle, esLocale);
  let progress = createProgress(puzzle);
  progress = submitGuess(puzzle, progress, "wrong", "2026-08-28T10:00:00Z").progress;
  progress = peekClue(puzzle, progress, "lib", "2026-08-28T10:01:00Z").progress;
  progress = peekClue(puzzle, progress, "lib", "2026-08-28T10:02:00Z").progress;
  assert.equal(calculateScore(progress).score, 93);
  assert.equal(calculateScore(progress).score, 93);
  const punished = { ...progress, wrongGuesses: 100 };
  assert.equal(calculateScore(punished).score, 0);
});

test("rank selection is independent of declaration order", () => {
  const puzzle = compilePuzzle(branchPuzzle, esLocale);
  const progress = createProgress(puzzle);
  const score = calculateScore(progress, { ranks: [{ minScore: 0, labelKey: "low" }, { minScore: 90, labelKey: "high" }] });
  assert.equal(score.rank.labelKey, "high");
});

test("keystrokes set the start time and serialize", () => {
  const puzzle = compilePuzzle(branchPuzzle, esLocale);
  const progress = recordKeystroke(createProgress(puzzle), 2, "2026-08-28T09:00:00Z");
  assert.equal(progress.keystrokes, 2);
  assert.equal(progress.startedAt, "2026-08-28T09:00:00.000Z");
  assert.match(serializeProgress(progress), /"keystrokes":2/u);
});

test("progress round-trips and derived fields are not serialized", () => {
  const puzzle = compilePuzzle(branchPuzzle, esLocale);
  const progress = solve(puzzle, createProgress(puzzle), "lib");
  const serialized = serializeProgress(progress);
  const restored = restoreProgress(puzzle, serialized);
  assert.deepEqual(restored, progress);
  assert.doesNotMatch(serialized, /available|children|parent|score/u);
});

test("peeked hints round-trip without becoming solved progress", () => {
  const puzzle = compilePuzzle(branchPuzzle, esLocale);
  let progress = createProgress(puzzle);
  progress = peekClue(puzzle, progress, "lib", "2026-08-28T10:00:00Z").progress;
  const restored = restoreProgress(puzzle, serializeProgress(progress));
  assert.deepEqual(restored.peeked, ["lib"]);
  assert.deepEqual(restored.solved, {});
  assert.equal(ids(getAvailableClues(puzzle, restored)).includes("book"), false);
});

test("storage key includes schema namespace, puzzle ID, and revision", () => {
  const puzzle = compilePuzzle(branchPuzzle, esLocale);
  assert.equal(progressStorageKey(puzzle), "nested-clue:v3:branch-es:3");
});

test("malformed, foreign, and dependency-inconsistent progress fail closed", () => {
  const puzzle = compilePuzzle(branchPuzzle, esLocale);
  assert.deepEqual(restoreProgress(puzzle, "{"), createProgress(puzzle));
  const foreign = { ...createProgress(puzzle), puzzleId: "other" };
  assert.deepEqual(restoreProgress(puzzle, JSON.stringify(foreign)), createProgress(puzzle));
  const invalid = {
    ...createProgress(puzzle),
    solved: { object: "guess" },
    startedAt: "2026-08-28T10:00:00Z"
  };
  assert.deepEqual(restoreProgress(puzzle, JSON.stringify(invalid)), createProgress(puzzle));
});

test("restore rejects legacy reveal, inconsistent peek, completion, and timestamp records", () => {
  const puzzle = compilePuzzle(branchPuzzle, esLocale);
  const fresh = createProgress(puzzle);
  const invalidRecords = [
    { ...fresh, version: 2 },
    { ...fresh, solved: { lib: "reveal" }, startedAt: "2026-08-28T10:00:00Z" },
    { ...fresh, revealed: ["lib"], startedAt: "2026-08-28T10:00:00Z" },
    { ...fresh, peeked: ["lib", "lib"], startedAt: "2026-08-28T10:00:00Z" },
    { ...fresh, peeked: ["object"], startedAt: "2026-08-28T10:00:00Z" },
    { ...fresh, completedAt: "2026-08-28T10:01:00Z", startedAt: "2026-08-28T10:00:00Z" }
  ];
  const complete = solve(puzzle, fresh, "lib", "libro", "cielo", "azul", "libro azul");
  const withoutCompletion = { ...complete };
  delete withoutCompletion.completedAt;
  invalidRecords.push(withoutCompletion);
  invalidRecords.push({ ...complete, startedAt: "2026-08-28T11:00:00Z", completedAt: "2026-08-28T10:00:00Z" });

  for (const record of invalidRecords) {
    assert.deepEqual(restoreProgress(puzzle, JSON.stringify(record)), fresh);
  }
});

test("disabled storage cannot stop play", () => {
  const puzzle = compilePuzzle(branchPuzzle, esLocale);
  const storage = { getItem() { throw new Error("disabled"); } };
  assert.deepEqual(restoreProgress(puzzle, storage), createProgress(puzzle));
});

test("partial-word adjacency is preserved without inserted whitespace", () => {
  const puzzle = compilePuzzle(branchPuzzle, esLocale);
  assert.deepEqual(puzzle.nodes.get("book").prompt, [{ ref: "lib" }, "ro"]);
  assert.equal(puzzle.nodes.get("book").answer, "libro");
});

test("NFC-equivalent final text passes exact expansion validation", () => {
  const definition = {
    schemaVersion: 1,
    id: "nfc-es",
    locale: "es-ES",
    finalText: "Árbol.",
    root: [{ ref: "tree" }, "."],
    clues: { tree: { answer: "A\u0301rbol", prompt: ["planta leñosa"] } }
  };
  assert.equal(validatePuzzle(definition, esLocale).valid, true);
});

test("old one-sided directed references remain compatible", () => {
  const definition = freshBranch();
  definition.clues.book.prompt[0] = { ref: "lib", direction: "left" };
  const result = validatePuzzle(definition, esLocale);
  assert.equal(result.valid, true);
  const puzzle = compilePuzzle(definition, esLocale);
  assert.deepEqual(puzzle.nodes.get("book").prompt[0], { ref: "lib", direction: "left" });
});

test("validator rejects invalid directions with a stable code", () => {
  const definition = freshBranch();
  definition.clues.book.prompt[0] = { ref: "lib", direction: "up" };
  assert.equal(errorCodes(definition).includes("INVALID_DIRECTION"), true);
});

test("directed references may target clues with nested prompt references", () => {
  const definition = freshBranch();
  definition.root[1] = { ref: "object", direction: "right" };
  assert.equal(validatePuzzle(definition, esLocale).valid, true);
  assert.deepEqual(compilePuzzle(definition, esLocale).nodes.get("object").children, ["book", "colour"]);
});

test("two-sided prompts compile children from both sides in stable order", () => {
  const definition = freshBranch();
  definition.clues.object.prompt = ["objeto con ", { ref: "book" }];
  definition.clues.object.rightPrompt = [" de color ", { ref: "colour" }];
  const puzzle = compilePuzzle(definition, esLocale);
  assert.deepEqual(puzzle.nodes.get("object").prompt, definition.clues.object.prompt);
  assert.deepEqual(puzzle.nodes.get("object").rightPrompt, definition.clues.object.rightPrompt);
  assert.deepEqual(puzzle.nodes.get("object").children, ["book", "colour"]);
  assert.deepEqual(puzzle.order, ["object", "book", "lib", "colour", "sky"]);
  assert.equal(puzzle.nodes.get("colour").parent, "object");
});

test("children on both prompt sides must solve before their parent unlocks", () => {
  const definition = freshBranch();
  definition.clues.object.prompt = [{ ref: "book" }];
  definition.clues.object.rightPrompt = [{ ref: "colour" }];
  const puzzle = compilePuzzle(definition, esLocale);
  const leftOnly = solve(puzzle, createProgress(puzzle), "lib", "libro");
  assert.equal(ids(getAvailableClues(puzzle, leftOnly)).includes("object"), false);
  const both = solve(puzzle, leftOnly, "cielo", "azul");
  assert.deepEqual(ids(getAvailableClues(puzzle, both)), ["object"]);
});

test("two-sided prompt references participate in cycle, reachability, and parent validation", () => {
  const cycle = freshBranch();
  cycle.clues.lib.rightPrompt = [{ ref: "object" }];
  assert.equal(errorCodes(cycle).includes("CYCLE"), true);

  const multiple = freshBranch();
  multiple.clues.colour.rightPrompt = [{ ref: "lib" }];
  assert.equal(errorCodes(multiple).includes("MULTIPLE_PARENTS"), true);

  const reachable = freshBranch();
  reachable.clues.extra = { answer: "extra", prompt: ["extra"] };
  reachable.clues.lib.rightPrompt = [{ ref: "extra" }];
  assert.equal(errorCodes(reachable).includes("UNREACHABLE_CLUE"), false);
});

test("two-sided clues reject an explicit incoming direction", () => {
  const definition = freshBranch();
  definition.clues.lib.rightPrompt = ["por la derecha"];
  definition.clues.book.prompt[0] = { ref: "lib", direction: "left" };
  assert.equal(errorCodes(definition).includes("DIRECTION_WITH_RIGHT_PROMPT"), true);
});

test("rightPrompt must be a non-empty segment list", () => {
  const definition = freshBranch();
  definition.clues.lib.rightPrompt = [];
  assert.equal(errorCodes(definition).includes("EMPTY_SEGMENTS"), true);
});

for (const [name, mutate, code] of [
  ["unsupported schema", (d) => { d.schemaVersion = 2; }, "UNSUPPORTED_SCHEMA"],
  ["bad puzzle ID", (d) => { d.id = "Bad ID"; }, "INVALID_PUZZLE_ID"],
  ["bad revision", (d) => { d.revision = 0; }, "INVALID_REVISION"],
  ["impossible date", (d) => { d.releaseDate = "2026-02-30"; }, "INVALID_DATE"],
  ["missing reference", (d) => { d.clues.book.prompt[0] = { ref: "missing" }; }, "MISSING_REFERENCE"],
  ["self reference", (d) => { d.clues.lib.prompt = [{ ref: "lib" }]; }, "CYCLE"],
  ["unreachable clue", (d) => { d.clues.orphan = { answer: "x", prompt: ["x"] }; }, "UNREACHABLE_CLUE"],
  ["multiple parents", (d) => { d.clues.colour.prompt.push({ ref: "lib" }); }, "MULTIPLE_PARENTS"],
  ["empty answer", (d) => { d.clues.lib.answer = " "; }, "EMPTY_ANSWER"],
  ["empty prompt", (d) => { d.clues.lib.prompt = []; }, "EMPTY_SEGMENTS"],
  ["answer collision", (d) => { d.clues.sky.answer = "LIB"; d.clues.colour.prompt = ["color del ", { ref: "sky" }]; }, "ANSWER_COLLISION"],
  ["final mismatch", (d) => { d.finalText = "El libro rojo."; }, "FINAL_TEXT_MISMATCH"],
  ["raw HTML", (d) => { d.clues.lib.prompt = ["<script>alert(1)</script>"]; }, "RAW_HTML"],
  ["unknown clue key", (d) => { d.clues.lib.extra = true; }, "UNKNOWN_CLUE_KEY"]
]) {
  test(`validator rejects ${name} with a stable code`, () => {
    const definition = freshBranch();
    mutate(definition);
    assert.equal(errorCodes(definition).includes(code), true, errorCodes(definition).join(", "));
  });
}

test("validator warns for literal brackets and excessive depth", () => {
  const definition = {
    schemaVersion: 1,
    id: "deep-es",
    locale: "es-ES",
    finalText: "n0",
    root: [{ ref: "n0" }],
    clues: {}
  };
  for (let index = 0; index < 9; index += 1) {
    definition.clues[`n${index}`] = {
      answer: `n${index}`,
      prompt: index === 8 ? ["hoja [final]"] : [{ ref: `n${index + 1}` }]
    };
  }
  const result = validatePuzzle(definition, esLocale);
  assert.equal(result.valid, true);
  assert.equal(result.warnings.some((warning) => warning.code === "EXCESSIVE_DEPTH"), true);
  assert.equal(result.warnings.some((warning) => warning.code === "LITERAL_BRACKET"), true);
});

for (const markup of ["<!-- comentario -->", "<!DOCTYPE html>", "<?xml version='1.0'?>", "<strong", "&lt;script&gt;"]) {
  test(`validator rejects raw markup form: ${markup}`, () => {
    const definition = freshBranch();
    definition.clues.lib.prompt = [markup];
    assert.equal(errorCodes(definition).includes("RAW_HTML"), true);
  });
}
