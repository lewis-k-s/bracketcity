import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  AUTHOR_STORAGE_KEY,
  AuthoringError,
  addLiteralSegment,
  authorDraftFromDefinition,
  compileAuthorPreview,
  createAuthorDraft,
  definitionFromDraft,
  removeClue,
  replaceLiteralSelection,
  restoreAuthorDraft,
  serializeAuthorDraft,
  serializeAuthorPuzzle,
  setFinalText,
  setReferenceDirection,
  setRightPrompt,
  updateClue,
  updateLiteral,
  updateMetadata,
  validateAuthorDraft
} from "../src/author.ts";
import { createProgress, getAvailableClues, submitGuess } from "../src/engine.ts";
import { esLocale } from "./fixtures.ts";
import type { AuthorDraft, PuzzleDefinition, ReferenceSegment } from "../src/types.ts";

function readPuzzle(filename: string): PuzzleDefinition {
  return JSON.parse(readFileSync(new URL(`../puzzles/${filename}`, import.meta.url), "utf8")) as PuzzleDefinition;
}

function minimalDraft() {
  let draft = createAuthorDraft({ finalText: "La gata duerme.", title: "Gata" });
  const created = replaceLiteralSelection(draft, { owner: "root", segmentIndex: 0, start: 3, end: 7 });
  draft = updateLiteral(created.draft, { owner: created.clueId, segmentIndex: 0, value: "animal doméstico" });
  return { draft, clueId: created.clueId };
}

function nestedDraft() {
  let { draft, clueId: parentId } = minimalDraft();
  draft = updateLiteral(draft, { owner: parentId, segmentIndex: 0, value: "gata" });
  const child = replaceLiteralSelection(draft, { owner: parentId, segmentIndex: 0, start: 0, end: 1 });
  draft = updateLiteral(child.draft, { owner: child.clueId, segmentIndex: 0, value: "letra antes de h" });
  return { draft, parentId, childId: child.clueId };
}

test("fresh author draft keeps exact final text and valid metadata defaults", () => {
  const draft = createAuthorDraft({ finalText: "  Texto exacto.  " });
  assert.equal(draft.finalText, "  Texto exacto.  ");
  assert.deepEqual(draft.root, ["  Texto exacto.  "]);
  assert.equal(draft.metadata.revision, 1);
  assert.equal(AUTHOR_STORAGE_KEY, "nested-clue:author:v1");
});

test("final text can change only before clue structure exists", () => {
  const changed = setFinalText(createAuthorDraft(), "La gata duerme.");
  assert.deepEqual(changed.root, ["La gata duerme."]);
  const { draft } = minimalDraft();
  assert.throws(() => setFinalText(draft, "Otro texto"), (error) => error instanceof AuthoringError && error.code === "STRUCTURE_EXISTS");
});

test("root substring replacement creates one opaque clue and preserves adjacency", () => {
  const { draft, clueId } = minimalDraft();
  assert.equal(clueId, "c01");
  assert.deepEqual(draft.root, ["La ", { ref: "c01" }, " duerme."]);
  assert.equal(draft.clues.c01!.answer, "gata");
  assert.deepEqual(draft.clues.c01!.prompt, ["animal doméstico"]);
  assert.equal(draft.finalText, "La gata duerme.");
  assert.equal(validateAuthorDraft(draft, esLocale).valid, true);
});

test("nested substring replacement creates a true child and preserves partial-word adjacency", () => {
  const { draft, parentId, childId } = nestedDraft();
  assert.equal(childId, "c02");
  assert.deepEqual(draft.clues[parentId]!.prompt, [{ ref: childId }, "ata"]);
  const compiled = compileAuthorPreview(draft, esLocale);
  assert.equal(compiled.nodes.get(childId)!.parent, parentId);
  assert.deepEqual(compiled.nodes.get(parentId)!.children, [childId]);
  assert.equal(validateAuthorDraft(draft, esLocale).valid, true);
});

test("substring replacement rejects empty, out-of-range, and split-grapheme selections", () => {
  const draft = createAuthorDraft({ finalText: "Árbol" });
  for (const selection of [
    { start: 1, end: 1, code: "INVALID_SELECTION" },
    { start: -1, end: 2, code: "INVALID_SELECTION" },
    { start: 1, end: 2, code: "SPLIT_GRAPHEME" }
  ]) {
    assert.throws(
      () => replaceLiteralSelection(draft, { owner: "root", segmentIndex: 0, start: selection.start, end: selection.end }),
      (error) => error instanceof AuthoringError && error.code === selection.code
    );
  }
});

test("literal segments can be inserted and edited without automatic whitespace", () => {
  const { draft, clueId } = minimalDraft();
  let changed = addLiteralSegment(draft, { owner: clueId, at: 1 });
  changed = updateLiteral(changed, { owner: clueId, segmentIndex: 1, value: "sin espacio" });
  assert.deepEqual(changed.clues[clueId]!.prompt, ["animal doméstico", "sin espacio"]);
});

test("changing a canonical root answer synchronizes finalText", () => {
  const { draft, clueId } = minimalDraft();
  const changed = updateClue(draft, clueId, { answer: "perra", accept: ["can"], peek: "p" });
  assert.equal(changed.finalText, "La perra duerme.");
  assert.deepEqual(changed.clues[clueId]!.accept, ["can"]);
  assert.equal(changed.clues[clueId]!.peek, "p");
});

test("direction changes only the incoming reference", () => {
  const { draft, childId } = nestedDraft();
  const left = setReferenceDirection(draft, childId, "left");
  assert.deepEqual(left.clues.c01!.prompt[0], { ref: childId, direction: "left" });
  const right = setReferenceDirection(left, childId, "right");
  assert.deepEqual(right.clues.c01!.prompt[0], { ref: childId, direction: "right" });
  const cleared = setReferenceDirection(right, childId, null);
  assert.deepEqual(cleared.clues.c01!.prompt[0], { ref: childId });
});

test("directed hints can contain nested clues and reject only invalid values", () => {
  const { draft, parentId, childId } = nestedDraft();
  assert.throws(
    () => setReferenceDirection(draft, childId, "up" as any),
    (error) => error instanceof AuthoringError && error.code === "INVALID_DIRECTION"
  );
  const directedParent = setReferenceDirection(draft, parentId, "left");
  assert.equal((directedParent.root[1] as ReferenceSegment).direction, "left");
  const directedChild = setReferenceDirection(draft, childId, "right");
  const nested = replaceLiteralSelection(directedChild, { owner: childId, segmentIndex: 0, start: 0, end: 5 });
  assert.equal(nested.draft.clues[nested.clueId]!.answer, "letra");
});

test("a right prompt creates a two-sided hint, clears direction, and supports nesting", () => {
  let { draft, childId } = nestedDraft();
  draft = setReferenceDirection(draft, childId, "right");
  draft = setRightPrompt(draft, childId, true);
  assert.deepEqual(draft.clues.c01!.prompt[0], { ref: childId });
  assert.deepEqual(draft.clues[childId]!.rightPrompt, [""]);
  draft = updateLiteral(draft, { owner: `${childId}:right`, segmentIndex: 0, value: "hacia la derecha" });
  const nested = replaceLiteralSelection(draft, {
    owner: `${childId}:right`,
    segmentIndex: 0,
    start: 9,
    end: 16
  });
  assert.equal(nested.draft.clues[nested.clueId]!.answer, "derecha");
  assert.deepEqual(nested.draft.clues[childId]!.rightPrompt, ["hacia la ", { ref: nested.clueId }]);
  assert.throws(
    () => setReferenceDirection(nested.draft, childId, "left"),
    (error) => error instanceof AuthoringError && error.code === "DUAL_HINT_DIRECTION"
  );
});

test("removing a right prompt removes only its nested subtree", () => {
  let { draft, childId } = nestedDraft();
  draft = setRightPrompt(draft, childId, true);
  draft = updateLiteral(draft, { owner: `${childId}:right`, segmentIndex: 0, value: "otro" });
  const nested = replaceLiteralSelection(draft, { owner: `${childId}:right`, segmentIndex: 0, start: 0, end: 4 });
  const removed = setRightPrompt(nested.draft, childId, false);
  assert.equal(removed.clues[childId]!.rightPrompt, undefined);
  assert.equal(removed.clues[nested.clueId], undefined);
  assert.ok(removed.clues.c01);
});

test("removing a clue unwraps its answer and removes its subtree", () => {
  const { draft, parentId, childId } = nestedDraft();
  const removed = removeClue(draft, parentId);
  assert.deepEqual(removed.root, ["La gata duerme."]);
  assert.equal(removed.clues[parentId], undefined);
  assert.equal(removed.clues[childId], undefined);
  assert.equal(removed.finalText, "La gata duerme.");
});

test("valid author export is deterministic JSON and plays through the existing engine", () => {
  let { draft, parentId, childId } = nestedDraft();
  draft = setReferenceDirection(draft, childId, "right");
  draft = updateMetadata(draft, { id: "gata-anidada", revision: 2 });
  const serialized = serializeAuthorPuzzle(draft, esLocale);
  assert.equal(serialized.endsWith("\n"), true);
  const definition = JSON.parse(serialized);
  assert.deepEqual(definition.clues[parentId]!.prompt[0], { ref: childId, direction: "right" });
  const puzzle = compileAuthorPreview(draft, esLocale);
  let progress = createProgress(puzzle);
  assert.deepEqual(getAvailableClues(puzzle, progress).map((clue) => clue.id), [childId]);
  progress = submitGuess(puzzle, progress, "g").progress;
  assert.deepEqual(getAvailableClues(puzzle, progress).map((clue) => clue.id), [parentId]);
  progress = submitGuess(puzzle, progress, "gata").progress;
  assert.equal(progress.completedAt !== undefined, true);
});

test("invalid author drafts cannot export", () => {
  const draft = createAuthorDraft({ finalText: "Sin pistas" });
  assert.equal(validateAuthorDraft(draft, esLocale).valid, false);
  assert.throws(
    () => serializeAuthorPuzzle(draft, esLocale),
    (error) => error instanceof AuthoringError && error.code === "INVALID_DRAFT"
  );
});

test("definition export omits editor state and empty optional fields", () => {
  const { draft } = minimalDraft();
  const definition = definitionFromDraft(draft);
  assert.equal(Object.hasOwn(definition, "selectedClueId"), false);
  assert.equal(Object.hasOwn(definition.clues.c01!, "accept"), false);
  assert.equal(Object.hasOwn(definition.clues.c01!, "peek"), false);
  assert.equal(Object.hasOwn(definition.clues.c01!, "rightPrompt"), false);
});

test("definition export preserves a right prompt exactly", () => {
  let { draft, clueId } = minimalDraft();
  draft = setRightPrompt(draft, clueId, true);
  draft = updateLiteral(draft, { owner: `${clueId}:right`, segmentIndex: 0, value: "que duerme" });
  const definition = definitionFromDraft(draft);
  assert.deepEqual(definition.clues[clueId]!.rightPrompt, ["que duerme"]);
  assert.deepEqual(authorDraftFromDefinition(definition, esLocale).clues[clueId]!.rightPrompt, ["que duerme"]);
});

for (const filename of ["2026-08-30-es.json", "2026-08-31-es.json"]) {
  test(`existing puzzle ${filename} loads into an author draft and exports without data loss`, () => {
    const definition = readPuzzle(filename);
    const draft = authorDraftFromDefinition(definition, esLocale);

    assert.deepEqual(definitionFromDraft(draft), definition);
    assert.deepEqual(Object.keys(draft.clues), Object.keys(definition.clues));
    assert.equal(draft.selectedClueId, null);
  });
}

test("puzzle loading preserves directions and all optional editable definition data", () => {
  const definition = readPuzzle("2026-08-30-es.json");
  definition.factDate = "2026-08-25";
  definition.source!.url = "https://example.com/puzzle";
  (definition.root[1] as ReferenceSegment).direction = "left";
  definition.clues.c01!.peek = "P";
  definition.clues.c01!.match = { optionalAcuteVowels: false, ignorePunctuation: true };

  const draft = authorDraftFromDefinition(definition, esLocale);
  const restoredDraft = restoreAuthorDraft(serializeAuthorDraft(draft));

  assert.deepEqual(definitionFromDraft(restoredDraft), definition);
});

test("puzzle loading rejects definitions that are not playable", () => {
  const definition = readPuzzle("2026-08-31-es.json");
  definition.clues.c01!.prompt = [{ ref: "missing" }];
  assert.throws(
    () => authorDraftFromDefinition(definition, esLocale),
    (error) => error instanceof AuthoringError && error.code === "INVALID_DEFINITION"
  );
});

test("author draft persistence round-trips and malformed input fails closed", () => {
  const { draft } = minimalDraft();
  assert.deepEqual(restoreAuthorDraft(serializeAuthorDraft(draft)), draft);
  assert.deepEqual(restoreAuthorDraft("{"), createAuthorDraft());
  const missingReference = structuredClone(draft);
  missingReference.root[1] = { ref: "missing" };
  assert.deepEqual(restoreAuthorDraft(serializeAuthorDraft(missingReference)), createAuthorDraft());
  const cycle = structuredClone(draft);
  cycle.clues.c01!.prompt = [{ ref: "c01" }];
  assert.deepEqual(restoreAuthorDraft(serializeAuthorDraft(cycle)), createAuthorDraft());
  const invalidClue = structuredClone(draft);
  (invalidClue.clues as Record<string, unknown>).c01 = null;
  assert.deepEqual(restoreAuthorDraft(serializeAuthorDraft(invalidClue)), createAuthorDraft());
});
