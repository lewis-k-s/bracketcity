import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";
import { AUTHOR_STORAGE_KEY } from "../src/author.js";
import { startAuthorApp } from "../src/author-view.js";

const locale = JSON.parse(readFileSync(new URL("../locales/es-ES.json", import.meta.url), "utf8"));

function readPuzzle(filename) {
  return JSON.parse(readFileSync(new URL(`../puzzles/${filename}`, import.meta.url), "utf8"));
}

function installDom() {
  const dom = new JSDOM("<!doctype html><html><body><main id='app'></main></body></html>", {
    url: "https://example.test/?mode=author"
  });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.CSS = dom.window.CSS;
  globalThis.requestAnimationFrame = (callback) => callback();
  globalThis.confirm = () => true;
  return dom;
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
    value(key) { return values.get(key); }
  };
}

function button(label) {
  const match = [...document.querySelectorAll("button")].find((node) => node.textContent.trim() === label);
  assert.ok(match, `Button '${label}' must exist.`);
  return match;
}

function setPreviewSelection(owner, segmentIndex, selectedText) {
  const literals = [...document.querySelectorAll('[data-testid="author-preview-literal"]')]
    .filter((node) => node.textContent.includes(selectedText));
  assert.equal(literals.length, 1, `Selection '${selectedText}' must identify one preview literal for ${owner}:${segmentIndex}.`);
  const [literal] = literals;
  assert.ok(literal, `Preview literal '${owner}:${segmentIndex}' must exist.`);
  const start = literal.textContent.indexOf(selectedText);
  assert.notEqual(start, -1, `Selection '${selectedText}' must exist in the preview literal.`);
  const range = document.createRange();
  range.setStart(literal.firstChild, start);
  range.setEnd(literal.firstChild, start + selectedText.length);
  const selection = document.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  document.dispatchEvent(new window.Event("selectionchange"));
  return literal;
}

function convertPreviewSelection(owner, segmentIndex, selectedText) {
  setPreviewSelection(owner, segmentIndex, selectedText);
  const convert = document.querySelector('[data-testid="author-convert-selection"]');
  assert.equal(convert.disabled, false);
  convert.click();
}

function buildDirectedDraft(storage) {
  const app = startAuthorApp({ mount: document.querySelector("#app"), locale, storage });
  const finalInput = document.querySelector('[data-testid="author-final-text"]');
  finalInput.value = "El dosel.";
  button(locale.ui.authorApplyFinal).click();

  convertPreviewSelection("root", 0, "dosel");

  const parentPrompt = document.querySelector('[data-testid="c01-literal-0"]');
  parentPrompt.value = "cubierta formada por dos";
  parentPrompt.closest(".segment-row").querySelector('[data-testid="author-save-text"]').click();
  convertPreviewSelection("c01", 0, "dos");

  const leafPrompt = document.querySelector('[data-testid="c02-literal-0"]');
  leafPrompt.value = "número después de uno";
  leafPrompt.closest(".segment-row").querySelector('[data-testid="author-save-text"]').click();

  const direction = document.querySelector('[data-testid="author-direction"]');
  direction.value = "right";
  direction.dispatchEvent(new window.Event("change", { bubbles: true }));
  return app;
}

test("author mode starts with a stored draft, labelled fields, and validation feedback", () => {
  installDom();
  const storage = memoryStorage();
  const app = startAuthorApp({ mount: document.querySelector("#app"), locale, storage });

  assert.ok(app);
  assert.equal(document.querySelector("h1").textContent, locale.ui.authorTitle);
  assert.ok(document.querySelector('[data-testid="author-final-text"]'));
  assert.match(document.querySelector('[data-testid="author-validation-state"]').textContent, /todavía no es válido/u);
  assert.equal(document.querySelector('[data-testid="author-download"]').disabled, true);
  assert.ok(storage.value(AUTHOR_STORAGE_KEY));
});

test("author mode falls back to an in-memory draft when storage reads fail", () => {
  installDom();
  const storage = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("blocked"); }
  };
  const app = startAuthorApp({ mount: document.querySelector("#app"), locale, storage });
  assert.ok(app);
  assert.equal(app.getDraft().finalText, "");
  assert.match(document.querySelector(".author-error").textContent, /No se pudo guardar/u);
  assert.equal(document.querySelector("main main"), null);
  const finalInput = document.querySelector('[data-testid="author-final-text"]');
  finalInput.value = "Texto sin guardar";
  button(locale.ui.authorApplyFinal).click();
  assert.equal(app.getDraft().finalText, "Texto sin guardar");
  assert.match(document.querySelector(".author-error").textContent, /No se pudo guardar/u);
  assert.equal(document.querySelector('[data-testid="author-live"]').textContent, locale.ui.authorStorageError);
});

test("an initial phrase selection enables conversion when the browser uses preview boundaries", () => {
  installDom();
  startAuthorApp({ mount: document.querySelector("#app"), locale, storage: memoryStorage() });
  const finalInput = document.querySelector('[data-testid="author-final-text"]');
  finalInput.value = "Empieza el viaje.";
  button(locale.ui.authorApplyFinal).click();

  const preview = document.querySelector('[data-testid="author-structure-preview"]');
  const range = document.createRange();
  range.setStart(preview, 0);
  range.setEnd(preview, 1);
  const selection = document.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  document.dispatchEvent(new window.Event("selectionchange"));

  assert.equal(document.querySelector('[data-testid="author-convert-selection"]').disabled, false);
  assert.match(document.querySelector('[data-testid="author-selection-summary"]').textContent, /Empieza el viaje\./u);

  selection.removeAllRanges();
  document.dispatchEvent(new window.Event("selectionchange"));
  assert.equal(document.querySelector('[data-testid="author-convert-selection"]').disabled, true);
  assert.equal(document.querySelector('[data-testid="author-selection-summary"]').textContent, "");
});

test("a selection that crosses an existing bracket boundary cannot be converted", () => {
  installDom();
  startAuthorApp({ mount: document.querySelector("#app"), locale, storage: memoryStorage() });
  const finalInput = document.querySelector('[data-testid="author-final-text"]');
  finalInput.value = "Empieza el viaje.";
  button(locale.ui.authorApplyFinal).click();
  convertPreviewSelection("root", 0, "viaje");

  const prompt = document.querySelector('[data-testid="c01-literal-0"]');
  prompt.value = "desplazamiento";
  prompt.closest(".segment-row").querySelector('[data-testid="author-save-text"]').click();
  const [before, nested] = document.querySelectorAll('[data-testid="author-preview-literal"]');
  const range = document.createRange();
  range.setStart(before.firstChild, 2);
  range.setEnd(nested.firstChild, 5);
  const selection = document.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  document.dispatchEvent(new window.Event("selectionchange"));

  assert.equal(document.querySelector('[data-testid="author-convert-selection"]').disabled, true);
  assert.equal(document.querySelector('[data-testid="author-selection-summary"]').textContent, "");
});

test("preview selection creates nested clues, an internal answer slot, and exact JSON", () => {
  installDom();
  const storage = memoryStorage();
  const app = buildDirectedDraft(storage);

  assert.equal(Object.keys(app.getDraft().clues).length, 2);
  assert.deepEqual(app.getDraft().clues.c01.prompt, ["cubierta formada por ", { ref: "c02", direction: "right" }]);
  assert.equal(document.querySelector('[data-testid="author-validation-state"]').textContent, locale.ui.authorValid);
  assert.equal(document.querySelector('[data-testid="author-download"]').disabled, false);

  const preview = document.querySelector('[data-testid="author-structure-preview"]');
  assert.equal(preview.textContent.includes("dosel"), false);
  assert.equal(preview.textContent.includes("dos"), false);
  const leaf = [...preview.querySelectorAll('[data-author-bracket]')].at(-1);
  assert.equal(leaf.querySelector('[data-author-direction="right"]')?.textContent, "→");
  assert.equal(leaf.querySelector('[data-answer-slot]')?.textContent, "___");
  assert.notEqual(leaf.nextElementSibling?.dataset.authorDirection, "right");
  assert.ok(document.querySelector('[data-testid="author-final-text"]')
    .closest(".author-panel").contains(preview));
  assert.equal(document.querySelectorAll('[data-testid="author-convert-selection"]').length, 1);
  assert.equal(document.querySelectorAll('[data-testid$="-convert-0"]').length, 0);

  const definition = JSON.parse(document.querySelector('[data-testid="author-json"]').value);
  assert.deepEqual(definition.clues.c01.prompt[1], { ref: "c02", direction: "right" });
  assert.equal(definition.finalText, "El dosel.");
  assert.equal(JSON.parse(storage.value(AUTHOR_STORAGE_KEY)).selectedClueId, "c02");
});

test("a directed hint can contain a deeper nested clue", () => {
  installDom();
  const app = buildDirectedDraft(memoryStorage());

  convertPreviewSelection("c02", 0, "uno");
  assert.equal(Object.keys(app.getDraft().clues).length, 3);
  assert.deepEqual(app.getDraft().clues.c02.prompt.at(-1), { ref: "c03" });
  assert.deepEqual(app.getDraft().clues.c01.prompt.at(-1), { ref: "c02", direction: "right" });
  assert.equal(document.querySelector('[data-testid="author-download"]').disabled, true);
});

test("the editor adds two independent hints and supports preview selection on the right", () => {
  installDom();
  const app = startAuthorApp({ mount: document.querySelector("#app"), locale, storage: memoryStorage() });
  const finalInput = document.querySelector('[data-testid="author-final-text"]');
  finalInput.value = "light";
  button(locale.ui.authorApplyFinal).click();
  convertPreviewSelection("root", 0, "light");

  const left = document.querySelector('[data-testid="c01-literal-0"]');
  left.value = "sun";
  left.closest(".segment-row").querySelector('[data-testid="author-save-text"]').click();
  document.querySelector('[data-testid="author-right-prompt-toggle"]').click();
  const right = document.querySelector('[data-testid="c01:right-literal-0"]');
  right.value = "house";
  right.closest(".segment-row").querySelector('[data-testid="author-save-text"]').click();

  assert.equal(document.querySelector('[data-testid="author-direction"]'), null);
  assert.equal(document.querySelector('[data-testid="author-structure-preview"]').textContent, "[sun→___←house]");
  const definition = JSON.parse(document.querySelector('[data-testid="author-json"]').value);
  assert.deepEqual(definition.clues.c01.rightPrompt, ["house"]);

  convertPreviewSelection("c01:right", 0, "house");
  assert.deepEqual(app.getDraft().clues.c01.rightPrompt, [{ ref: "c02" }]);
  assert.equal(app.getDraft().clues.c02.answer, "house");
});

test("only preview selections add exact partial-word bracket layers", () => {
  installDom();
  const app = startAuthorApp({ mount: document.querySelector("#app"), locale, storage: memoryStorage() });
  const finalInput = document.querySelector('[data-testid="author-final-text"]');
  finalInput.value = "La sartén.";
  button(locale.ui.authorApplyFinal).click();
  convertPreviewSelection("root", 0, "arté");

  assert.deepEqual(app.getDraft().root, ["La s", { ref: "c01" }, "n."]);
  assert.equal(document.querySelector(`[aria-label="${locale.ui.authorAddTextBefore}"]`), null);
  assert.equal(document.querySelector(`[aria-label="${locale.ui.authorAddTextAfter}"]`), null);
  assert.equal(document.querySelector('[data-testid="root-literal-0"]'), null);

  const prompt = document.querySelector('[data-testid="c01-literal-0"]');
  prompt.value = "algo que imita la vida";
  prompt.focus();
  prompt.setSelectionRange(19, 23);
  assert.equal(document.querySelector('[data-testid="author-convert-selection"]').disabled, true);
  prompt.closest(".segment-row").querySelector('[data-testid="author-save-text"]').click();
  convertPreviewSelection("c01", 0, "ida");

  assert.deepEqual(app.getDraft().clues.c01.prompt, ["algo que imita la v", { ref: "c02" }]);
  assert.equal(app.getDraft().clues.c02.answer, "ida");
  assert.deepEqual(app.getDraft().root, ["La s", { ref: "c01" }, "n."]);
});

test("existing dated puzzles load into the creator without rebuilding them by hand", () => {
  installDom();
  const existingPuzzles = [
    { date: "2026-08-30", definition: readPuzzle("2026-08-30-es.json") },
    { date: "2026-08-31", definition: readPuzzle("2026-08-31-es.json") }
  ];
  const app = startAuthorApp({
    mount: document.querySelector("#app"),
    locale,
    storage: memoryStorage(),
    existingPuzzles
  });
  const select = document.querySelector('[data-testid="author-existing-puzzle"]');
  const load = document.querySelector('[data-testid="author-load-existing"]');
  assert.equal(load.disabled, true);
  select.value = "1";
  select.dispatchEvent(new window.Event("change", { bubbles: true }));
  assert.equal(load.disabled, false);
  load.click();

  assert.equal(app.getDraft().finalText, existingPuzzles[1].definition.finalText);
  assert.deepEqual(app.getDraft().root, existingPuzzles[1].definition.root);
  assert.deepEqual(Object.keys(app.getDraft().clues), Object.keys(existingPuzzles[1].definition.clues));
  assert.equal(document.querySelector('[data-testid="author-puzzle-id"]').value, existingPuzzles[1].definition.id);

  document.querySelector('button.author-tree-button[data-clue-id="c03"]').click();
  const aliases = document.querySelector('[data-testid="author-aliases-disclosure"]');
  assert.equal(aliases.open, false);
  assert.equal(document.querySelector('[data-testid="author-aliases"]').value, "arte");
  assert.equal(document.querySelector("#author-peek"), null);
  assert.equal(document.body.textContent.includes(locale.ui.authorPeek), false);
});

test("copy and download include edits that are still visible in fields", async () => {
  installDom();
  const storage = memoryStorage();
  buildDirectedDraft(storage);
  const copied = [];
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { clipboard: { writeText: async (value) => copied.push(value) } }
  });

  document.querySelector('[data-testid="author-answer"]').value = "tres";
  button(locale.ui.authorCopyJson).click();
  await Promise.resolve();
  const copiedDefinition = JSON.parse(copied.at(-1));
  assert.equal(copiedDefinition.clues.c02.answer, "tres");
  assert.equal(JSON.parse(storage.value(AUTHOR_STORAGE_KEY)).clues.c02.answer, "tres");

  let downloadedBlob = null;
  let downloadedName = null;
  const originalCreateObjectUrl = globalThis.URL.createObjectURL;
  const originalRevokeObjectUrl = globalThis.URL.revokeObjectURL;
  const originalAnchorClick = window.HTMLAnchorElement.prototype.click;
  globalThis.URL.createObjectURL = (blob) => {
    downloadedBlob = blob;
    return "blob:author-test";
  };
  globalThis.URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = function click() {
    downloadedName = this.download;
  };
  try {
    document.querySelector('[data-testid="author-answer"]').value = "cuatro";
    document.querySelector('[data-testid="author-puzzle-id"]').value = "puzzle-updated";
    document.querySelector('[data-testid="author-download"]').click();
    const downloadedDefinition = JSON.parse(await downloadedBlob.text());
    assert.equal(downloadedDefinition.id, "puzzle-updated");
    assert.equal(downloadedDefinition.clues.c02.answer, "cuatro");
    assert.equal(downloadedName, "puzzle-updated.json");
  } finally {
    globalThis.URL.createObjectURL = originalCreateObjectUrl;
    globalThis.URL.revokeObjectURL = originalRevokeObjectUrl;
    window.HTMLAnchorElement.prototype.click = originalAnchorClick;
  }
});

test("a stale preview selection fails safely and still persists visible edits", () => {
  installDom();
  const storage = memoryStorage();
  startAuthorApp({ mount: document.querySelector("#app"), locale, storage });
  const finalInput = document.querySelector('[data-testid="author-final-text"]');
  finalInput.value = "Texto inicial";
  button(locale.ui.authorApplyFinal).click();

  setPreviewSelection("root", 0, "inicial");
  document.querySelector('[data-testid="author-final-text"]').value = "Texto editado";
  document.querySelector('[data-testid="author-convert-selection"]').click();

  assert.match(document.querySelector(".author-error").textContent, /STALE_SELECTION/u);
  const restored = JSON.parse(storage.value(AUTHOR_STORAGE_KEY));
  assert.equal(restored.root[0], "Texto editado");
  assert.equal(restored.finalText, "Texto editado");
});

test("a valid dated draft publishes for play and updates the Jugar link", () => {
  installDom();
  const storage = memoryStorage();
  buildDirectedDraft(storage);
  const published = [];
  startAuthorApp({
    mount: document.querySelector("#app"),
    locale,
    storage,
    onPublish(definition, options) { published.push({ definition, options }); }
  });

  const date = document.querySelector("#author-release-date");
  date.value = "2026-09-01";
  const publish = document.querySelector('[data-testid="author-publish"]');
  assert.equal(publish.disabled, false);
  publish.click();

  assert.equal(published.length, 1);
  assert.equal(published[0].definition.releaseDate, "2026-09-01");
  assert.equal(published[0].options.overwrite, false);
  assert.equal(document.querySelector('[data-testid="author-publish-status"]').textContent, "Guardado para jugar el 2026-09-01.");
  assert.equal(document.querySelector(".mode-link").getAttribute("href"), "?date=2026-09-01");
});

test("publishing an existing date requires confirmation before replacement", () => {
  installDom();
  const storage = memoryStorage();
  buildDirectedDraft(storage);
  const definition = readPuzzle("2026-08-31-es.json");
  const published = [];
  startAuthorApp({
    mount: document.querySelector("#app"),
    locale,
    storage,
    existingPuzzles: [{ date: definition.releaseDate, definition }],
    onPublish(next, options) { published.push({ next, options }); }
  });
  document.querySelector("#author-release-date").value = definition.releaseDate;

  globalThis.confirm = () => false;
  document.querySelector('[data-testid="author-publish"]').click();
  assert.equal(published.length, 0);

  globalThis.confirm = () => true;
  document.querySelector('[data-testid="author-publish"]').click();
  assert.equal(published.length, 1);
  assert.equal(published[0].options.overwrite, true);
});

test("a valid draft asks for a date instead of publishing without one", () => {
  installDom();
  const storage = memoryStorage();
  buildDirectedDraft(storage);
  let calls = 0;
  startAuthorApp({
    mount: document.querySelector("#app"),
    locale,
    storage,
    onPublish() { calls += 1; }
  });

  const publish = document.querySelector('[data-testid="author-publish"]');
  assert.equal(publish.disabled, false);
  publish.click();
  assert.equal(calls, 0);
  assert.equal(document.querySelector(".author-error").textContent, locale.ui.authorPublishDateRequired);
});

test("an invalid creator draft cannot publish", () => {
  installDom();
  let calls = 0;
  startAuthorApp({
    mount: document.querySelector("#app"),
    locale,
    storage: memoryStorage(),
    onPublish() { calls += 1; }
  });
  const publish = document.querySelector('[data-testid="author-publish"]');
  assert.equal(publish.disabled, true);
  publish.click();
  assert.equal(calls, 0);
});
