import assert from "node:assert/strict";
import test from "node:test";

import { calculateScore, compilePuzzle, createProgress } from "../src/engine.ts";
import { completionBar, createCompletionShare } from "../src/share.ts";
import { branchPuzzle, esLocale } from "./fixtures.ts";

test("completion share card includes a dated, spoiler-free score result", () => {
  const puzzle = compilePuzzle(branchPuzzle, esLocale);
  const share = createCompletionShare(
    puzzle,
    calculateScore(createProgress(puzzle)),
    esLocale,
    "https://example.test/?date=2026-08-28"
  );

  assert.equal(share.title, "Entre Paréntesis · Ramas");
  assert.match(share.text, /28 de agosto de 2026/u);
  assert.match(share.text, /100\/100 puntos/u);
  assert.match(share.text, /⟦▰{10}⟧/u);
  assert.match(share.text, /\?date=2026-08-28/u);
  assert.doesNotMatch(share.text, /El libro azul/u);
  assert.doesNotMatch(share.text, /inicio de una palabra/u);
});

test("completion share uses the game label and configured total when a title is absent", () => {
  const definition = structuredClone(branchPuzzle);
  delete definition.title;
  definition.scoring = { base: 40 };
  const puzzle = compilePuzzle(definition, esLocale);
  const share = createCompletionShare(puzzle, { ...calculateScore(createProgress(puzzle), definition.scoring), score: 26 }, esLocale, "https://example.test/");

  assert.equal(share.title, "Entre Paréntesis · Pistas anidadas");
  assert.match(share.text, /26\/40 puntos/u);
  assert.match(share.text, /⟦▰{7}▱{3}⟧/u);
});

test("completion bar clamps scores at both ends", () => {
  assert.equal(completionBar(-1, 100), "⟦▱▱▱▱▱▱▱▱▱▱⟧");
  assert.equal(completionBar(150, 100), "⟦▰▰▰▰▰▰▰▰▰▰⟧");
  assert.equal(completionBar(0, 0), "⟦▱▱▱▱▱▱▱▱▱▱⟧");
});
