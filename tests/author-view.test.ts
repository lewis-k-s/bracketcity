import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";
import { AUTHOR_STORAGE_KEY } from "../src/author.ts";
import { startAuthorApp } from "../src/author-view.ts";
import type { LocalePack, PuzzleDefinition, StorageLike } from "../src/types.ts";
import { installDomWindow, q, qa, type TestElement } from "./test-dom.ts";

interface PublishCall {
  readonly definition: PuzzleDefinition;
  readonly options: { readonly overwrite: boolean };
}

const locale = JSON.parse(readFileSync(new URL("../locales/es-ES.json", import.meta.url), "utf8")) as LocalePack;

function readPuzzle(filename: string): PuzzleDefinition {
  return JSON.parse(readFileSync(new URL(`../puzzles/${filename}`, import.meta.url), "utf8")) as PuzzleDefinition;
}

function installDom(): JSDOM {
  const dom = new JSDOM("<!doctype html><html><body><main id='app'></main></body></html>", {
    url: "https://example.test/?mode=author"
  });
  installDomWindow(dom.window);
  globalThis.requestAnimationFrame = (callback) => {
    callback(0);
    return 0;
  };
  globalThis.confirm = () => true;
  return dom;
}

interface MemoryStorage extends StorageLike {
  value(key: string): string | undefined;
}

function memoryStorage(): MemoryStorage {
  const values = new Map<string, string>();
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
    value(key) { return values.get(key); }
  };
}

function button(label: string | undefined): HTMLElement {
  const match = [...qa("button")].find((node) => node.textContent.trim() === label);
  assert.ok(match, `Button '${label}' must exist.`);
  return match;
}

function inputValue(control: TestElement, value: string): void {
  control.value = value;
  control.dispatchEvent(new window.Event("input", { bubbles: true }));
}

function setPreviewSelection(owner: string, segmentIndex: number, selectedText: string): Element {
  const literals = [...qa('[data-testid="author-preview-literal"]')]
    .filter((node) => node.textContent.includes(selectedText));
  assert.equal(literals.length, 1, `Selection '${selectedText}' must identify one preview literal for ${owner}:${segmentIndex}.`);
  const [literal] = literals;
  assert.ok(literal, `Preview literal '${owner}:${segmentIndex}' must exist.`);
  const start = literal.textContent.indexOf(selectedText);
  assert.notEqual(start, -1, `Selection '${selectedText}' must exist in the preview literal.`);
  const range = document.createRange();
  range.setStart(literal.firstChild, start);
  range.setEnd(literal.firstChild, start + selectedText.length);
  const selection = document.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  document.dispatchEvent(new window.Event("selectionchange"));
  return literal;
}

function convertPreviewSelection(owner: string, segmentIndex: number, selectedText: string): void {
  setPreviewSelection(owner, segmentIndex, selectedText);
  const convert = q('[data-testid="author-convert-selection"]');
  assert.equal(convert.disabled, false);
  convert.click();
}

function buildDirectedDraft(storage: StorageLike) {
  const app = startAuthorApp({ mount: q("#app"), locale, storage });
  assert.ok(app);
  const finalInput = q('[data-testid="author-final-text"]');
  inputValue(finalInput, "El dosel.");

  convertPreviewSelection("root", 0, "dosel");

  const parentPrompt = q('[data-testid="c01-literal-0"]');
  inputValue(parentPrompt, "cubierta formada por dos");
  convertPreviewSelection("c01", 0, "dos");

  const leafPrompt = q('[data-testid="c02-literal-0"]');
  inputValue(leafPrompt, "número después de uno");

  const direction = q('[data-testid="author-direction"]');
  direction.value = "right";
  direction.dispatchEvent(new window.Event("change", { bubbles: true }));
  return app;
}

test("author mode starts with a stored draft, labelled fields, and validation feedback", () => {
  installDom();
  const storage = memoryStorage();
  const app = startAuthorApp({ mount: q("#app"), locale, storage });

  assert.ok(app);
  assert.equal(q("h1").textContent, locale.ui.authorTitle);
  assert.ok(q('[data-testid="author-final-text"]'));
  assert.match(q('[data-testid="author-validation-state"]').textContent, /todavía no es válido/u);
  assert.equal(q('[data-testid="author-download"]').disabled, true);
  assert.ok(storage.value(AUTHOR_STORAGE_KEY));
});

test("author mode falls back to an in-memory draft when storage reads fail", () => {
  installDom();
  const storage = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("blocked"); }
  };
  const app = startAuthorApp({ mount: q("#app"), locale, storage });
  assert.ok(app);
  assert.equal(app.getDraft().finalText, "");
  assert.match(q(".author-error").textContent, /No se pudo guardar/u);
  assert.equal(q("main main"), null);
  const finalInput = q('[data-testid="author-final-text"]');
  inputValue(finalInput, "Texto sin guardar");
  assert.equal(app.getDraft().finalText, "Texto sin guardar");
  assert.match(q(".author-error").textContent, /No se pudo guardar/u);
  assert.equal(q('[data-testid="author-live"]').textContent, locale.ui.authorStorageError);
});

test("an initial phrase selection enables conversion when the browser uses preview boundaries", () => {
  installDom();
  startAuthorApp({ mount: q("#app"), locale, storage: memoryStorage() });
  const finalInput = q('[data-testid="author-final-text"]');
  inputValue(finalInput, "Empieza el viaje.");

  const preview = q('[data-testid="author-structure-preview"]');
  const range = document.createRange();
  range.setStart(preview, 0);
  range.setEnd(preview, 1);
  const selection = document.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  document.dispatchEvent(new window.Event("selectionchange"));

  assert.equal(q('[data-testid="author-convert-selection"]').disabled, false);
  assert.match(q('[data-testid="author-selection-summary"]').textContent, /Empieza el viaje\./u);

  selection.removeAllRanges();
  document.dispatchEvent(new window.Event("selectionchange"));
  assert.equal(q('[data-testid="author-convert-selection"]').disabled, true);
  assert.equal(q('[data-testid="author-selection-summary"]').textContent, "");
});

test("a selection that crosses an existing bracket boundary cannot be converted", () => {
  installDom();
  startAuthorApp({ mount: q("#app"), locale, storage: memoryStorage() });
  const finalInput = q('[data-testid="author-final-text"]');
  inputValue(finalInput, "Empieza el viaje.");
  convertPreviewSelection("root", 0, "viaje");

  const prompt = q('[data-testid="c01-literal-0"]');
  inputValue(prompt, "desplazamiento");
  const [before, nested] = qa('[data-testid="author-preview-literal"]');
  const range = document.createRange();
  range.setStart(before!.firstChild, 2);
  range.setEnd(nested!.firstChild, 5);
  const selection = document.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  document.dispatchEvent(new window.Event("selectionchange"));

  assert.equal(q('[data-testid="author-convert-selection"]').disabled, true);
  assert.equal(q('[data-testid="author-selection-summary"]').textContent, "");
});

test("preview selection creates nested clues, an internal answer slot, and exact JSON", () => {
  installDom();
  const storage = memoryStorage();
  const app = buildDirectedDraft(storage);

  assert.equal(Object.keys(app.getDraft().clues).length, 2);
  assert.deepEqual(app.getDraft().clues.c01!.prompt, ["cubierta formada por ", { ref: "c02", direction: "right" }]);
  assert.equal(q('[data-testid="author-validation-state"]').textContent, locale.ui.authorValid);
  assert.equal(q('[data-testid="author-download"]').disabled, false);

  const preview = q('[data-testid="author-structure-preview"]');
  assert.equal(preview.textContent.includes("dosel"), false);
  assert.equal(preview.textContent.includes("dos"), false);
  const leaf = [...preview.querySelectorAll('[data-author-bracket]')].at(-1)!;
  assert.equal(leaf.querySelector('[data-author-direction="right"]')?.textContent, "→");
  assert.equal(leaf.querySelector('[data-answer-slot]')?.textContent, "___");
  assert.notEqual(leaf.nextElementSibling?.getAttribute("data-author-direction"), "right");
  assert.ok(q('[data-testid="author-final-text"]')
    .closest(".author-panel").contains(preview));
  assert.equal(qa('[data-testid="author-convert-selection"]').length, 1);
  assert.equal(qa('[data-testid$="-convert-0"]').length, 0);

  const definition = JSON.parse(q('[data-testid="author-json"]').value);
  assert.deepEqual(definition.clues.c01!.prompt[1], { ref: "c02", direction: "right" });
  assert.equal(definition.finalText, "El dosel.");
  assert.equal(JSON.parse(storage.value(AUTHOR_STORAGE_KEY)!).selectedClueId, "c02");
});

test("a directed hint can contain a deeper nested clue", () => {
  installDom();
  const app = buildDirectedDraft(memoryStorage());

  convertPreviewSelection("c02", 0, "uno");
  assert.equal(Object.keys(app.getDraft().clues).length, 3);
  assert.deepEqual(app.getDraft().clues.c02!.prompt.at(-1), { ref: "c03" });
  assert.deepEqual(app.getDraft().clues.c01!.prompt.at(-1), { ref: "c02", direction: "right" });
  assert.equal(q('[data-testid="author-download"]').disabled, true);
});

test("the editor adds two independent hints and supports preview selection on the right", () => {
  installDom();
  const app = startAuthorApp({ mount: q("#app"), locale, storage: memoryStorage() });
  const finalInput = q('[data-testid="author-final-text"]');
  inputValue(finalInput, "light");
  convertPreviewSelection("root", 0, "light");

  const left = q('[data-testid="c01-literal-0"]');
  inputValue(left, "sun");
  q('[data-testid="author-right-prompt-toggle"]').click();
  const right = q('[data-testid="c01:right-literal-0"]');
  inputValue(right, "house");

  assert.equal(q('[data-testid="author-direction"]'), null);
  assert.equal(q('[data-testid="author-structure-preview"]').textContent, "[sun→___←house]");
  const definition = JSON.parse(q('[data-testid="author-json"]').value);
  assert.deepEqual(definition.clues.c01!.rightPrompt, ["house"]);

  convertPreviewSelection("c01:right", 0, "house");
  assert.deepEqual(app.getDraft().clues.c01!.rightPrompt, [{ ref: "c02" }]);
  assert.equal(app.getDraft().clues.c02!.answer, "house");
});

test("only preview selections add exact partial-word bracket layers", () => {
  installDom();
  const app = startAuthorApp({ mount: q("#app"), locale, storage: memoryStorage() });
  const finalInput = q('[data-testid="author-final-text"]');
  inputValue(finalInput, "La sartén.");
  convertPreviewSelection("root", 0, "arté");

  assert.deepEqual(app.getDraft().root, ["La s", { ref: "c01" }, "n."]);
  assert.equal(q(`[aria-label="${locale.ui.authorAddTextBefore}"]`), null);
  assert.equal(q(`[aria-label="${locale.ui.authorAddTextAfter}"]`), null);
  assert.equal(q('[data-testid="root-literal-0"]'), null);

  const prompt = q('[data-testid="c01-literal-0"]');
  inputValue(prompt, "algo que imita la vida");
  prompt.focus();
  prompt.setSelectionRange(19, 23);
  assert.equal(q('[data-testid="author-convert-selection"]').disabled, true);
  convertPreviewSelection("c01", 0, "ida");

  assert.deepEqual(app.getDraft().clues.c01!.prompt, ["algo que imita la v", { ref: "c02" }]);
  assert.equal(app.getDraft().clues.c02!.answer, "ida");
  assert.deepEqual(app.getDraft().root, ["La s", { ref: "c01" }, "n."]);
});

test("existing dated puzzles load into the creator without rebuilding them by hand", () => {
  installDom();
  const existingPuzzles = [
    { date: "2026-08-30", definition: readPuzzle("2026-08-30-es.json") },
    { date: "2026-08-31", definition: readPuzzle("2026-08-31-es.json") }
  ];
  const app = startAuthorApp({
    mount: q("#app"),
    locale,
    storage: memoryStorage(),
    existingPuzzles
  });
  const select = q('[data-testid="author-existing-puzzle"]');
  const load = q('[data-testid="author-load-existing"]');
  assert.equal(load.disabled, true);
  select.value = "1";
  select.dispatchEvent(new window.Event("change", { bubbles: true }));
  assert.equal(load.disabled, false);
  load.click();

  assert.equal(app.getDraft().finalText, existingPuzzles[1]!.definition.finalText);
  assert.deepEqual(app.getDraft().root, existingPuzzles[1]!.definition.root);
  assert.deepEqual(Object.keys(app.getDraft().clues), Object.keys(existingPuzzles[1]!.definition.clues));
  assert.equal(q('[data-testid="author-puzzle-id"]').value, existingPuzzles[1]!.definition.id);

  q('button.author-tree-button[data-clue-id="c03"]').click();
  const aliases = q('[data-testid="author-aliases-disclosure"]');
  assert.equal(aliases.open, false);
  assert.equal(q('[data-testid="author-aliases"]').value, "arte");
  assert.equal(q("#author-peek"), null);
  assert.equal(document.body.textContent.includes(locale.ui.authorPeek ?? ""), false);
});

test("field edits update the draft before copy and download", async () => {
  installDom();
  const storage = memoryStorage();
  buildDirectedDraft(storage);
  const copied: string[] = [];
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { clipboard: { writeText: async (value: string) => { copied.push(value); } } }
  });

  inputValue(q('[data-testid="author-answer"]'), "tres");
  button(locale.ui.authorCopyJson).click();
  await Promise.resolve();
  const copiedDefinition = JSON.parse(copied.at(-1)!);
  assert.equal(copiedDefinition.clues.c02!.answer, "tres");
  assert.equal(JSON.parse(storage.value(AUTHOR_STORAGE_KEY)!).clues.c02!.answer, "tres");

  let downloadedBlob: Blob | null = null;
  let downloadedName: string | null = null;
  const originalCreateObjectUrl = globalThis.URL.createObjectURL;
  const originalRevokeObjectUrl = globalThis.URL.revokeObjectURL;
  const originalAnchorClick = window.HTMLAnchorElement.prototype.click;
  globalThis.URL.createObjectURL = (blob) => {
    downloadedBlob = blob as Blob;
    return "blob:author-test";
  };
  globalThis.URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = function click() {
    downloadedName = this.download;
  };
  try {
    inputValue(q('[data-testid="author-answer"]'), "cuatro");
    inputValue(q('[data-testid="author-puzzle-id"]'), "puzzle-updated");
    q('[data-testid="author-download"]').click();
    const downloadedDefinition = JSON.parse(await downloadedBlob!.text());
    assert.equal(downloadedDefinition.id, "puzzle-updated");
    assert.equal(downloadedDefinition.clues.c02!.answer, "cuatro");
    assert.equal(downloadedName, "puzzle-updated.json");
  } finally {
    globalThis.URL.createObjectURL = originalCreateObjectUrl;
    globalThis.URL.revokeObjectURL = originalRevokeObjectUrl;
    window.HTMLAnchorElement.prototype.click = originalAnchorClick;
  }
});

test("editing text clears an old preview selection and persists the draft", () => {
  installDom();
  const storage = memoryStorage();
  startAuthorApp({ mount: q("#app"), locale, storage });
  const finalInput = q('[data-testid="author-final-text"]');
  inputValue(finalInput, "Texto inicial");

  setPreviewSelection("root", 0, "inicial");
  inputValue(q('[data-testid="author-final-text"]'), "Texto editado");

  assert.equal(q('[data-testid="author-convert-selection"]').disabled, true);
  const restored = JSON.parse(storage.value(AUTHOR_STORAGE_KEY)!);
  assert.equal(restored.root[0], "Texto editado");
  assert.equal(restored.finalText, "Texto editado");
});

test("a valid dated draft publishes for play and updates the Jugar link", () => {
  installDom();
  const storage = memoryStorage();
  buildDirectedDraft(storage);
  const published: PublishCall[] = [];
  startAuthorApp({
    mount: q("#app"),
    locale,
    storage,
    onPublish(definition, options) { published.push({ definition, options }); }
  });

  const date = q("#author-release-date");
  inputValue(date, "2026-09-01");
  const publish = q('[data-testid="author-publish"]');
  assert.equal(publish.disabled, false);
  publish.click();

  assert.equal(published.length, 1);
  assert.equal(published[0]!.definition.releaseDate, "2026-09-01");
  assert.equal(published[0]!.options.overwrite, false);
  assert.equal(q('[data-testid="author-publish-status"]').textContent, "Guardado para jugar el 2026-09-01.");
  assert.equal(q(".mode-link").getAttribute("href"), "?date=2026-09-01");
});

test("publishing an existing date increments its revision without a confirmation", () => {
  installDom();
  const storage = memoryStorage();
  buildDirectedDraft(storage);
  const definition = readPuzzle("2026-08-31-es.json");
  const published: Array<{ readonly next: PuzzleDefinition; readonly options: { readonly overwrite: boolean } }> = [];
  startAuthorApp({
    mount: q("#app"),
    locale,
    storage,
    existingPuzzles: [{ date: definition.releaseDate!, definition }],
    onPublish(next, options) { published.push({ next, options }); }
  });
  inputValue(q("#author-release-date"), definition.releaseDate!);
  globalThis.confirm = () => { throw new Error("Publishing must not ask for confirmation."); };
  q('[data-testid="author-publish"]').click();
  assert.equal(published.length, 1);
  assert.equal(published[0]!.options.overwrite, true);
  assert.equal(published[0]!.next.revision, (definition.revision ?? 1) + 1);
  assert.equal(q("#author-revision"), null);
});

test("a valid draft asks for a date instead of publishing without one", () => {
  installDom();
  const storage = memoryStorage();
  buildDirectedDraft(storage);
  let calls = 0;
  startAuthorApp({
    mount: q("#app"),
    locale,
    storage,
    onPublish() { calls += 1; }
  });

  const publish = q('[data-testid="author-publish"]');
  assert.equal(publish.disabled, false);
  publish.click();
  assert.equal(calls, 0);
  assert.equal(q(".author-error").textContent, locale.ui.authorPublishDateRequired);
});

test("an invalid creator draft cannot publish", () => {
  installDom();
  let calls = 0;
  startAuthorApp({
    mount: q("#app"),
    locale,
    storage: memoryStorage(),
    onPublish() { calls += 1; }
  });
  const publish = q('[data-testid="author-publish"]');
  assert.equal(publish.disabled, true);
  publish.click();
  assert.equal(calls, 0);
});

test("an asynchronous WordPress save reports progress and a useful failure", async () => {
  installDom();
  const storage = memoryStorage();
  buildDirectedDraft(storage);
  let rejectSave: (reason?: unknown) => void = () => {};
  startAuthorApp({
    mount: q("#app"),
    locale,
    storage,
    onPublish() {
      return new Promise((resolve, reject) => { rejectSave = reject; });
    }
  });
  inputValue(q("#author-release-date"), "2026-09-01");
  q('[data-testid="author-publish"]').click();
  assert.equal(q('[data-testid="author-publish"]').disabled, true);
  rejectSave(Object.assign(new Error("La fecha ya existe."), { code: "DATE_EXISTS" }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.match(q(".author-error").textContent, /DATE_EXISTS.*fecha ya existe/u);
  assert.equal(q('[data-testid="author-publish"]').disabled, false);
});

test("an asynchronous correction succeeds and keeps the WordPress page permalink", async () => {
  installDom();
  const storage = memoryStorage();
  buildDirectedDraft(storage);
  const existing = readPuzzle("2026-08-31-es.json");
  const calls: PublishCall[] = [];
  startAuthorApp({
    mount: q("#app"),
    locale,
    storage,
    existingPuzzles: [{ date: "2026-09-01", definition: existing }],
    currentDate: "2026-09-01",
    pageUrl: "https://example.test/juegos/nexo/?ref=menu",
    async onPublish(definition, options) {
      calls.push({ definition, options });
      return { ok: true };
    }
  });
  inputValue(q("#author-release-date"), "2026-09-01");
  globalThis.confirm = () => true;
  q('[data-testid="author-publish"]').click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls[0]!.options.overwrite, true);
  assert.equal(q('[data-testid="author-publish-status"]').textContent, "Guardado para jugar el 2026-09-01.");
  assert.equal(q(".mode-link").href, "https://example.test/juegos/nexo/?ref=menu&date=2026-09-01");
});

test("a future save never adds its date to the WordPress play link", async () => {
  installDom();
  const storage = memoryStorage();
  buildDirectedDraft(storage);
  startAuthorApp({
    mount: q("#app"),
    locale,
    storage,
    currentDate: "2026-09-01",
    pageUrl: "https://example.test/juegos/nexo/",
    async onPublish() { return { ok: true }; }
  });
  inputValue(q("#author-release-date"), "2026-09-02");
  q('[data-testid="author-publish"]').click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(q(".mode-link").href, "https://example.test/juegos/nexo/");
});

test("legacy browser puzzles have an import action that keeps local records", async () => {
  installDom();
  const storage = memoryStorage();
  const definition = readPuzzle("2026-08-31-es.json");
  let imported = 0;
  startAuthorApp({
    mount: q("#app"),
    locale,
    storage,
    legacyPuzzles: [definition],
    async onImportLegacy() {
      imported += 1;
      return [{ date: definition.releaseDate!, ok: true }];
    }
  });
  q('[data-testid="author-import-legacy"]').click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(imported, 1);
  assert.equal(q('[data-testid="author-import-legacy"]'), null);
  assert.match(document.body.textContent, /datos locales se conservaron/u);
});
