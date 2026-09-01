import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { calculateScore, compilePuzzle, createProgress, submitGuess } from "../src/engine.js";
import {
  announce,
  createGameShell,
  getRenderedClueElement,
  renderPuzzle,
  showSubmitFeedback,
  updateGameSummary
} from "../src/view.js";
import { branchPuzzle, esLocale } from "./fixtures.js";

function installDom() {
  const dom = new JSDOM("<!doctype html><html><body><main id='app'></main></body></html>", { url: "https://example.test/" });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.CSS = dom.window.CSS;
  globalThis.requestAnimationFrame = (callback) => callback();
  return dom;
}

function shell(puzzle, dateNavigation = {}) {
  return createGameShell(document.querySelector("#app"), puzzle, esLocale, {
    onSubmit() {},
    onHint() {},
    onVirtualInput() {}
  }, dateNavigation);
}

test("date selector lists catalog dates and reports a selected date change", () => {
  installDom();
  const puzzle = compilePuzzle(branchPuzzle, esLocale);
  const selected = [];
  shell(puzzle, {
    entries: [
      { date: "2026-08-30", file: "today.json" },
      { date: "2026-08-28", file: "demo.json" }
    ],
    selectedDate: "2026-08-28",
    onDateChange(date) { selected.push(date); }
  });
  const select = document.querySelector('[data-testid="date-selector"]');
  assert.equal(select.labels[0].textContent, esLocale.ui.dateSelector);
  assert.deepEqual([...select.options].map((option) => option.value), ["2026-08-30", "2026-08-28"]);
  assert.equal(select.value, "2026-08-28");
  select.value = "2026-08-30";
  select.dispatchEvent(new window.Event("change", { bubbles: true }));
  assert.deepEqual(selected, ["2026-08-30"]);
});

test("play shell hides answer-bearing titles and uses only the visible virtual keyboard", () => {
  installDom();
  const puzzle = compilePuzzle(branchPuzzle, esLocale);
  const view = shell(puzzle);

  assert.equal(document.querySelector("#puzzle-title"), null);
  assert.equal(document.querySelector(".puzzle-card").getAttribute("aria-label"), esLocale.ui.puzzleLabel);
  assert.equal(document.querySelector(".puzzle-card").textContent.includes(branchPuzzle.title), false);
  assert.equal(document.querySelector(".instruction"), null);
  assert.equal(document.querySelector(".source-note"), null);
  assert.equal(view.input.readOnly, true);
  assert.equal(view.input.getAttribute("inputmode"), "none");
  assert.equal(view.input.getAttribute("virtualkeyboardpolicy"), "manual");
  assert.equal(view.keyboard.hidden, false);
  assert.equal(view.keyboard.getAttribute("role"), "group");
  assert.equal(view.keyboard.getAttribute("aria-label"), esLocale.ui.virtualKeyboard);
  assert.equal(document.querySelector(".keyboard-toggle"), null);
});

test("recursive rendering exposes only leaves as inline button controls", () => {
  installDom();
  const puzzle = compilePuzzle(branchPuzzle, esLocale);
  const progress = createProgress(puzzle);
  const view = shell(puzzle);
  renderPuzzle(view.puzzleText, puzzle, progress, esLocale, () => {});
  assert.equal(view.puzzleText.querySelectorAll('[role="button"]').length, 2);
  assert.equal(getRenderedClueElement(view.puzzleText, "lib", "available").tagName, "SPAN");
  assert.equal(getRenderedClueElement(view.puzzleText, "sky", "available").tagName, "SPAN");
  assert.equal(view.puzzleText.querySelector('[role="button"] [role="button"]'), null);
  assert.equal(getRenderedClueElement(view.puzzleText, "object").dataset.clueState, "locked");
});

test("solving a leaf replaces its button with canonical answer and unlocks its parent", () => {
  installDom();
  const puzzle = compilePuzzle(branchPuzzle, esLocale);
  const progress = submitGuess(puzzle, createProgress(puzzle), "lib", "2026-08-28T10:00:00Z").progress;
  const view = shell(puzzle);
  renderPuzzle(view.puzzleText, puzzle, progress, esLocale, () => {});
  assert.equal(getRenderedClueElement(view.puzzleText, "lib").textContent, "lib");
  assert.equal(getRenderedClueElement(view.puzzleText, "lib").dataset.clueState, "solved");
  assert.equal(getRenderedClueElement(view.puzzleText, "book").tagName, "SPAN");
  assert.equal(view.puzzleText.querySelector('[role="button"] [role="button"]'), null);
});

test("puzzle rendering treats answer text as text, never HTML", () => {
  installDom();
  const puzzle = compilePuzzle(branchPuzzle, esLocale);
  puzzle.nodes.get("lib").answer = "<b>lib</b>";
  const progress = { ...createProgress(puzzle), solved: { lib: "guess" }, startedAt: "2026-08-28T10:00:00Z" };
  const view = shell(puzzle);
  renderPuzzle(view.puzzleText, puzzle, progress, esLocale, () => {});
  assert.equal(view.puzzleText.querySelector("b"), null);
  assert.equal(getRenderedClueElement(view.puzzleText, "lib").textContent, "<b>lib</b>");
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
  getRenderedClueElement(view.puzzleText, "lib").click();
  assert.deepEqual(activated, ["lib"]);
});

test("inline clue controls support Enter and Space", () => {
  installDom();
  const puzzle = compilePuzzle(branchPuzzle, esLocale);
  const view = shell(puzzle);
  const activated = [];
  renderPuzzle(view.puzzleText, puzzle, createProgress(puzzle), esLocale, (id) => activated.push(id));
  const clue = getRenderedClueElement(view.puzzleText, "lib");
  clue.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  clue.dispatchEvent(new window.KeyboardEvent("keydown", { key: " ", bubbles: true }));
  assert.deepEqual(activated, ["lib", "lib"]);
});

test("one-sided directions render an answer slot inside the unresolved bracket", () => {
  installDom();
  const definition = structuredClone(branchPuzzle);
  definition.clues.book.prompt[0] = { ref: "lib", direction: "left" };
  definition.clues.colour.prompt[1] = { ref: "sky", direction: "right" };
  const puzzle = compilePuzzle(definition, esLocale);
  const view = shell(puzzle);
  const fresh = createProgress(puzzle);
  renderPuzzle(view.puzzleText, puzzle, fresh, esLocale, () => {});

  const lib = getRenderedClueElement(view.puzzleText, "lib");
  assert.equal(lib.querySelector('[data-answer-slot]').textContent, "___");
  assert.equal(lib.querySelector('[data-answer-slot]').getAttribute("aria-label"), "respuesta");
  assert.equal(lib.querySelector('[data-clue-hint="after"]').textContent, branchPuzzle.clues.lib.prompt[0]);
  assert.match(lib.textContent, /^___\s*←/u);
  const sky = getRenderedClueElement(view.puzzleText, "sky");
  assert.equal(sky.querySelector('[data-clue-hint="before"]').textContent, branchPuzzle.clues.sky.prompt[0]);
  assert.match(sky.textContent, /→\s*___$/u);

  const solved = submitGuess(puzzle, fresh, "lib").progress;
  renderPuzzle(view.puzzleText, puzzle, solved, esLocale, () => {});
  assert.equal(getRenderedClueElement(view.puzzleText, "lib").textContent, "lib");
  assert.equal(getRenderedClueElement(view.puzzleText, "lib").querySelector("[data-answer-slot]"), null);
});

test("two-sided hints share one bracket and do not expose their answer", () => {
  installDom();
  const definition = structuredClone(branchPuzzle);
  definition.clues.book.answer = "secreto";
  definition.clues.book.rightPrompt = ["pista derecha"];
  const puzzle = compilePuzzle(definition, esLocale);
  const view = shell(puzzle);
  const fresh = createProgress(puzzle);
  renderPuzzle(view.puzzleText, puzzle, fresh, esLocale, () => {});

  let clue = getRenderedClueElement(view.puzzleText, "book");
  assert.equal(clue.dataset.clueState, "locked");
  assert.equal(
    clue.querySelector('[data-clue-hint="before"]').textContent,
    `${definition.clues.lib.prompt[0]}ro`
  );
  assert.equal(clue.querySelector('[data-clue-hint="after"]').textContent, "pista derecha");
  assert.equal(clue.querySelectorAll('[data-answer-slot]').length, 1);
  assert.match(clue.textContent, /→___←/u);
  assert.equal(clue.outerHTML.includes(definition.clues.book.answer), false);

  renderPuzzle(view.puzzleText, puzzle, submitGuess(puzzle, fresh, "lib").progress, esLocale, () => {});
  clue = getRenderedClueElement(view.puzzleText, "book");
  assert.equal(clue.dataset.clueState, "available");
  assert.equal(clue.querySelector('[data-clue-hint="before"]').textContent, "libro");
  assert.equal(clue.querySelectorAll('[data-answer-slot]').length, 1);
  assert.equal(clue.outerHTML.includes(definition.clues.book.answer), false);
});

test("semantic clue IDs never appear in unsolved player markup", () => {
  installDom();
  const definition = structuredClone(branchPuzzle);
  definition.clues.telescopio = { ...definition.clues.lib, answer: "telescopio" };
  delete definition.clues.lib;
  definition.clues.book.prompt[0] = { ref: "telescopio" };
  const puzzle = compilePuzzle(definition, esLocale);
  const view = shell(puzzle);
  renderPuzzle(view.puzzleText, puzzle, createProgress(puzzle), esLocale, () => {});
  assert.equal(view.puzzleText.outerHTML.includes("telescopio"), false);
  assert.equal(getRenderedClueElement(view.puzzleText, "telescopio").dataset.clueState, "available");
});

test("submit feedback returns to idle and the latest submission wins", async () => {
  installDom();
  const puzzle = compilePuzzle(branchPuzzle, esLocale);
  const view = shell(puzzle);
  assert.equal(view.submit.dataset.submitFeedback, "idle");
  showSubmitFeedback(view, "correct", 20);
  showSubmitFeedback(view, "wrong", 60);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(view.submit.dataset.submitFeedback, "wrong");
  await new Promise((resolve) => setTimeout(resolve, 45));
  assert.equal(view.submit.dataset.submitFeedback, "idle");
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
  const dateChanges = [];
  const view = shell(puzzle, {
    entries: [
      { date: "2026-08-28", file: "demo.json" },
      { date: "2026-08-31", file: "new.json" }
    ],
    selectedDate: "2026-08-28",
    onDateChange(date) { dateChanges.push(date); }
  });
  const dateSelector = document.querySelector('[data-testid="date-selector"]');
  updateGameSummary(view, puzzle, progress, calculateScore(progress), esLocale, { focusCompletion: true });
  assert.equal(view.completion.hidden, false);
  assert.equal(view.finalText.textContent, branchPuzzle.finalText);
  assert.match(view.resultText.textContent, /100 puntos/u);
  assert.equal(view.card.hidden, false);
  assert.equal(view.puzzleText.hidden, true);
  assert.strictEqual(view.completion.parentElement, view.card);
  assert.equal(dateSelector.closest("[hidden]"), null);
  assert.equal(dateSelector.disabled, false);
  assert.equal(dateSelector.value, "2026-08-28");
  assert.equal(view.composer.hidden, true);
  assert.strictEqual(document.activeElement, view.completionHeading);
  dateSelector.value = "2026-08-31";
  dateSelector.dispatchEvent(new window.Event("change", { bubbles: true }));
  assert.deepEqual(dateChanges, ["2026-08-31"]);
});

test("the virtual keyboard value submits through the visible form", () => {
  installDom();
  const puzzle = compilePuzzle(branchPuzzle, esLocale);
  const submissions = [];
  const view = createGameShell(document.querySelector("#app"), puzzle, esLocale, {
    onSubmit(value) { submissions.push(value); },
    onHint() {},
    onVirtualInput() {}
  });
  view.keyboard.querySelector('[data-key="a"]').click();
  view.form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  assert.deepEqual(submissions, ["a"]);
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
