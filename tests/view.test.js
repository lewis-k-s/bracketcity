import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { calculateScore, compilePuzzle, createProgress, submitGuess } from "../src/engine.js";
import { announce, createGameShell, renderPuzzle, updateGameSummary } from "../src/view.js";
import { branchPuzzle, esLocale } from "./fixtures.js";

function installDom() {
  const dom = new JSDOM("<!doctype html><html><body><main id='app'></main></body></html>", { url: "https://example.test/" });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.CSS = dom.window.CSS;
  globalThis.requestAnimationFrame = (callback) => callback();
  return dom;
}

function shell(puzzle) {
  return createGameShell(document.querySelector("#app"), puzzle, esLocale, {
    onSubmit() {},
    onHint() {},
    onPhysicalInput() {},
    onVirtualInput() {}
  });
}

test("recursive rendering exposes only leaves as buttons and never nests buttons", () => {
  installDom();
  const puzzle = compilePuzzle(branchPuzzle, esLocale);
  const progress = createProgress(puzzle);
  const view = shell(puzzle);
  renderPuzzle(view.puzzleText, puzzle, progress, esLocale, () => {});
  assert.deepEqual([...view.puzzleText.querySelectorAll("button")].map((node) => node.dataset.clueId), ["lib", "sky"]);
  assert.equal(view.puzzleText.querySelector("button button"), null);
  assert.equal(view.puzzleText.querySelector('[data-clue-id="object"]').dataset.clueState, "locked");
});

test("solving a leaf replaces its button with canonical answer and unlocks its parent", () => {
  installDom();
  const puzzle = compilePuzzle(branchPuzzle, esLocale);
  const progress = submitGuess(puzzle, createProgress(puzzle), "lib", "2026-08-28T10:00:00Z").progress;
  const view = shell(puzzle);
  renderPuzzle(view.puzzleText, puzzle, progress, esLocale, () => {});
  assert.equal(view.puzzleText.querySelector('[data-clue-id="lib"]').textContent, "lib");
  assert.equal(view.puzzleText.querySelector('[data-clue-id="lib"]').dataset.clueState, "solved");
  assert.equal(view.puzzleText.querySelector('[data-clue-id="book"]').tagName, "BUTTON");
  assert.equal(view.puzzleText.querySelector("button button"), null);
});

test("puzzle rendering treats answer text as text, never HTML", () => {
  installDom();
  const puzzle = compilePuzzle(branchPuzzle, esLocale);
  puzzle.nodes.get("lib").answer = "<b>lib</b>";
  const progress = { ...createProgress(puzzle), solved: { lib: "guess" }, startedAt: "2026-08-28T10:00:00Z" };
  const view = shell(puzzle);
  renderPuzzle(view.puzzleText, puzzle, progress, esLocale, () => {});
  assert.equal(view.puzzleText.querySelector("b"), null);
  assert.equal(view.puzzleText.querySelector('[data-clue-id="lib"]').textContent, "<b>lib</b>");
});

test("puzzle rerender keeps the mounted input node and focus", () => {
  installDom();
  const puzzle = compilePuzzle(branchPuzzle, esLocale);
  const view = shell(puzzle);
  const input = view.input;
  input.focus();
  renderPuzzle(view.puzzleText, puzzle, createProgress(puzzle), esLocale, () => {});
  renderPuzzle(view.puzzleText, puzzle, submitGuess(puzzle, createProgress(puzzle), "lib").progress, esLocale, () => {});
  assert.strictEqual(view.input, input);
  assert.strictEqual(document.activeElement, input);
});

test("available clue activation calls the hint handler with its stable ID", () => {
  installDom();
  const puzzle = compilePuzzle(branchPuzzle, esLocale);
  const view = shell(puzzle);
  const activated = [];
  renderPuzzle(view.puzzleText, puzzle, createProgress(puzzle), esLocale, (id) => activated.push(id));
  view.puzzleText.querySelector('[data-clue-id="lib"]').click();
  assert.deepEqual(activated, ["lib"]);
});

test("virtual keyboard edits the real input at its current selection", () => {
  installDom();
  const puzzle = compilePuzzle(branchPuzzle, esLocale);
  const view = shell(puzzle);
  view.input.value = "ao";
  view.input.setSelectionRange(1, 1);
  view.keyboard.querySelector('[data-key="ñ"]').click();
  assert.equal(view.input.value, "año");
  view.keyboard.querySelector('[data-key="Backspace"]').click();
  assert.equal(view.input.value, "ao");
});

test("completion panel contains exact final text, score, and rank", () => {
  installDom();
  const puzzle = compilePuzzle(branchPuzzle, esLocale);
  let progress = createProgress(puzzle);
  for (const answer of ["lib", "libro", "cielo", "azul", "libro azul"]) progress = submitGuess(puzzle, progress, answer).progress;
  const view = shell(puzzle);
  updateGameSummary(view, puzzle, progress, calculateScore(progress), esLocale, { focusCompletion: true });
  assert.equal(view.completion.hidden, false);
  assert.equal(view.finalText.textContent, branchPuzzle.finalText);
  assert.match(view.resultText.textContent, /100 puntos/u);
  assert.equal(view.composer.hidden, true);
  assert.strictEqual(document.activeElement, view.completionHeading);
});

test("composition sessions suppress form submission until composition ends", () => {
  installDom();
  const puzzle = compilePuzzle(branchPuzzle, esLocale);
  let submissions = 0;
  const view = createGameShell(document.querySelector("#app"), puzzle, esLocale, {
    onSubmit() { submissions += 1; },
    onHint() {},
    onPhysicalInput() {},
    onVirtualInput() {}
  });
  view.input.dispatchEvent(new window.CompositionEvent("compositionstart", { bubbles: true }));
  view.form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  assert.equal(submissions, 0);
  view.input.dispatchEvent(new window.CompositionEvent("compositionend", { bubbles: true }));
  view.form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  assert.equal(submissions, 1);
});

test("live announcements update only the dedicated status node", () => {
  installDom();
  const puzzle = compilePuzzle(branchPuzzle, esLocale);
  const view = shell(puzzle);
  announce(view, "Correcto: lib.");
  assert.equal(view.live.textContent, "Correcto: lib.");
  assert.equal(view.live.getAttribute("aria-live"), "polite");
  assert.equal(view.puzzleText.textContent, "");
});
