import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";
import { AUTHOR_STORAGE_KEY } from "../src/author.ts";
import {
  AUTHOR_INLINE_STORAGE_KEY,
  SUGGESTION_STORAGE_KEY,
  startAuthorApp
} from "../src/author-view.ts";
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

  q('[data-testid="author-bracket-format-right"]').click();
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
  assert.match(q('[data-testid="author-bracket-guide"]').textContent, /pista=respuesta/u);
});

test("author mode opens the suggestion page in place, explains access, and copies its URL", async () => {
  installDom();
  const suggestionUrl = "https://example.test/sugerir";
  const copied: string[] = [];
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { clipboard: { writeText: async (value: string) => { copied.push(value); } } }
  });
  try {
    startAuthorApp({ mount: q("#app"), locale, storage: memoryStorage(), suggestionUrl });

    const link = q('[data-testid="suggestion-page-link"]');
    assert.equal(link.getAttribute("href"), suggestionUrl);
    assert.equal(link.getAttribute("target"), null);
    assert.equal(link.textContent, locale.ui.suggestionShareLink);

    const dialog = q('[data-testid="suggestion-info-dialog"]');
    assert.equal(dialog.hasAttribute("open"), false);
    q('[data-testid="suggestion-info-open"]').click();
    assert.equal(dialog.hasAttribute("open"), true);
    assert.match(dialog.textContent, /sin iniciar sesión en WordPress/u);
    assert.match(dialog.textContent, /administrador/u);
    q('[data-testid="suggestion-info-close"]').click();
    assert.equal(dialog.hasAttribute("open"), false);

    q('[data-testid="suggestion-copy-link"]').click();
    await Promise.resolve();

    assert.deepEqual(copied, [suggestionUrl]);
    assert.equal(q('[data-testid="author-live"]').textContent, locale.ui.suggestionLinkCopied);
  } finally {
    if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
    else delete (globalThis as { navigator?: Navigator }).navigator;
  }
});

test("guided bracket formats explain directional forms without rendering internal IDs", () => {
  installDom();
  const app = buildDirectedDraft(memoryStorage());

  const workspace = q('[data-testid="author-guided-workspace"]');
  assert.ok(workspace.contains(q('[data-testid="author-tree-panel"]')));
  assert.ok(workspace.contains(q('[data-testid="clue-inspector"]')));
  assert.doesNotMatch(q(".author-tree").textContent, /c\d+/u);
  assert.match(q(".author-tree").textContent, /\[cubierta formada por dos=dosel\]/u);
  assert.match(q(".author-tree").textContent, /\[número después de uno→dos\]/u);
  assert.equal(q('[data-testid="author-bracket-format-right"]').getAttribute("aria-pressed"), "true");
  assert.match(q('[data-testid="author-bracket-format"]').textContent, /pista→respuesta/u);
  assert.equal(q('[data-testid="author-bracket-format-right"] .author-syntax-answer').textContent, "respuesta");

  q('[data-testid="author-bracket-format-both"]').click();
  assert.deepEqual(app.getDraft().clues.c02!.rightPrompt, [""]);
  assert.equal(q('[data-testid="author-bracket-format-both"]').getAttribute("aria-pressed"), "true");

  q('[data-testid="author-bracket-format-left"]').click();
  assert.equal(app.getDraft().clues.c02!.rightPrompt, undefined);
  assert.deepEqual(app.getDraft().clues.c01!.prompt.at(-1), { ref: "c02", direction: "left" });

  q('button.author-tree-button[data-clue-id="c01"]').click();
  assert.doesNotMatch(q(".reference-chip").textContent, /c\d+/u);
  assert.match(q(".reference-chip").textContent, /\[dos←número después de uno\]/u);
});

test("the editor flow and whole-page panel skin stay independent", () => {
  installDom();
  startAuthorApp({
    mount: q("#app"),
    locale,
    storage: memoryStorage(),
    flow: "inline",
    skin: "blueprint",
    existingPuzzles: [{ date: "2026-08-31", definition: readPuzzle("2026-08-31-es.json") }]
  });

  const shell = q(".author-shell");
  const utilities = q('[data-testid="author-utilities"]');
  assert.equal(shell.getAttribute("data-panel-skin"), "blueprint");
  const topLoader = q('[data-testid="author-load-panel"]');
  assert.ok(topLoader.contains(q('[data-testid="author-existing-puzzle"]')));
  assert.equal(utilities.querySelector('[data-testid="author-existing-puzzle"]'), null);
  assert.ok(utilities.contains(q('[data-testid="author-puzzle-id"]')));
  assert.ok(utilities.contains(q(".author-output")));
  assert.equal(q('[data-testid="author-json-details"]').hasAttribute("open"), false);
  assert.equal(q('[data-testid="author-style-options"]').hasAttribute("open"), false);
  assert.ok(q('[data-testid="author-inline-styles"]'));

  const skinLinks = Array.from(qa('[data-panel-skin-option]'));
  assert.equal(skinLinks.length, 4);
  assert.ok(skinLinks.some((link) => /skin=cards/u.test(link.getAttribute("href") ?? "")));
  assert.ok(skinLinks.every((link) => /flow=inline/u.test(link.getAttribute("href") ?? "")));
  const flowLinks = Array.from(qa('.author-flow-mode a'));
  assert.equal(flowLinks.length, 2);
  for (const link of flowLinks) assert.match(link.getAttribute("href") ?? "", /skin=blueprint/u);
  assert.ok(flowLinks.some((link) => /flow=inline/u.test(link.getAttribute("href") ?? "")));
});

test("the direct editor parses nested groups, inserts syntax keys, and undoes a group", () => {
  installDom();
  const storage = memoryStorage();
  const app = startAuthorApp({ mount: q("#app"), locale, storage, flow: "inline" });
  assert.ok(app);
  assert.ok(q('[data-testid="author-inline-composer"]'));
  assert.equal(q('[data-testid="author-final-text"]'), null);

  inputValue(q('[data-testid="author-inline-source"]'), "La [animal [de casa→doméstico]=gata].");
  assert.deepEqual(app.getDraft().root, ["La ", { ref: "c01" }, "."]);
  assert.deepEqual(app.getDraft().clues.c01!.prompt, ["animal ", { ref: "c02", direction: "right" }]);
  assert.equal(app.getDraft().clues.c01!.answer, "gata");
  assert.equal(app.getDraft().clues.c02!.answer, "doméstico");
  assert.equal(app.getDraft().finalText, "La gata.");
  assert.equal(q('[data-testid="author-inline-group-count"]').textContent, "2");
  assert.equal(q('[data-testid="author-inline-group-depth"]').textContent, "2");
  assert.equal(qa('[data-testid="author-inline-remove"]').length, 2);
  assert.equal(storage.value(AUTHOR_INLINE_STORAGE_KEY), "La [animal [de casa→doméstico]=gata].");
  assert.equal(q('[data-testid="author-answer"]'), null);
  assert.ok(q('[data-testid="author-inline-key-answer"]'));

  q('[data-clue-id="c02"] > .author-inline-group-contents').click();
  assert.match(q('[data-testid="author-inline-inspector"]').textContent, /doméstico/u);

  q('[data-clue-id="c01"] > [data-testid="author-inline-remove"]').click();
  assert.equal(q('[data-testid="author-inline-source"]').value, "La gata.");
  assert.deepEqual(app.getDraft().clues, {});

  const source = q('[data-testid="author-inline-source"]');
  source.focus();
  source.setSelectionRange(3, 7);
  q('[data-testid="author-inline-key-wrap"]').click();
  assert.equal(q('[data-testid="author-inline-source"]').value, "La [=gata].");
});

test("the direct editor keeps malformed syntax visible and blocks export", () => {
  installDom();
  startAuthorApp({ mount: q("#app"), locale, storage: memoryStorage(), flow: "inline" });
  inputValue(q('[data-testid="author-inline-source"]'), "Una [pista");

  assert.match(q('[data-testid="author-inline-parse-error"]').textContent, /Falta \]/u);
  assert.equal(q('[data-testid="author-download"]').disabled, true);
  assert.equal(q('[data-testid="author-inline-source"]').value, "Una [pista");
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

test("typing in a prompt keeps the text control selection intact", () => {
  installDom();
  buildDirectedDraft(memoryStorage());
  const prompt = q('[data-testid="c02-literal-0"]');
  const selection = document.getSelection()!;
  const originalRemoveAllRanges = selection.removeAllRanges.bind(selection);
  let removedRanges = 0;
  selection.removeAllRanges = () => {
    removedRanges += 1;
    originalRemoveAllRanges();
  };

  prompt.focus();
  inputValue(prompt, "una pista escrita sin perder el foco");

  assert.equal(document.activeElement, prompt);
  assert.equal(removedRanges, 0);
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

test("a directional clue does not show a spare field for trailing prompt whitespace", () => {
  installDom();
  const app = startAuthorApp({ mount: q("#app"), locale, storage: memoryStorage() });
  inputValue(q('[data-testid="author-final-text"]'), "era");
  convertPreviewSelection("root", 0, "era");
  inputValue(q('[data-testid="c01-literal-0"]'), "cuando ");
  q('[data-testid="author-bracket-format-both"]').click();

  convertPreviewSelection("c01", 0, "ando");

  assert.deepEqual(app.getDraft().clues.c01!.prompt, ["cu", { ref: "c02" }]);
  q('button.author-tree-button[data-clue-id="c01"]').click();
  assert.equal(q('[data-testid="c01-literal-2"]'), null);
  assert.ok(q('[data-testid="c01:right-literal-0"]'));
});

test("the editor adds two independent hints and supports preview selection on the right", () => {
  installDom();
  const app = startAuthorApp({ mount: q("#app"), locale, storage: memoryStorage() });
  const finalInput = q('[data-testid="author-final-text"]');
  inputValue(finalInput, "light");
  convertPreviewSelection("root", 0, "light");

  const left = q('[data-testid="c01-literal-0"]');
  inputValue(left, "sun");
  q('[data-testid="author-bracket-format-both"]').click();
  const right = q('[data-testid="c01:right-literal-0"]');
  inputValue(right, "house");

  assert.equal(q('[data-testid="author-bracket-format-both"]').getAttribute("aria-pressed"), "true");
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
  assert.equal(q('[data-testid="author-aliases-disclosure"]'), null);
  assert.deepEqual(app.getDraft().clues.c03!.accept, ["arte"]);
  assert.equal(q("#author-peek"), null);
  assert.equal(document.body.textContent.includes(locale.ui.authorPeek ?? ""), false);
});

test("a loaded puzzle can move to Trash and be restored immediately", async () => {
  installDom();
  const definition = readPuzzle("2026-08-31-es.json");
  const existingPuzzles = [{ date: definition.releaseDate!, definition }];
  const deleted: string[] = [];
  const restored: string[] = [];
  const app = startAuthorApp({
    mount: q("#app"),
    locale,
    storage: memoryStorage(),
    existingPuzzles,
    onPublish() {},
    async onDeletePuzzle(date) { deleted.push(date); },
    async onRestorePuzzle(date) { restored.push(date); }
  });
  const select = q('[data-testid="author-existing-puzzle"]');
  select.value = "0";
  select.dispatchEvent(new window.Event("change", { bubbles: true }));
  q('[data-testid="author-load-existing"]').click();

  q('[data-testid="author-delete-puzzle"]').click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(deleted, [definition.releaseDate]);
  assert.equal(existingPuzzles.length, 0);
  assert.equal(q('[data-testid="author-delete-puzzle"]'), null);

  q('[data-testid="author-undo-delete"]').click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(restored, [definition.releaseDate]);
  assert.equal(existingPuzzles.length, 1);
  assert.equal(app.getDraft().metadata.id, definition.id);
  assert.ok(q('[data-testid="author-delete-puzzle"]'));
});

test("the release limit pauses new suggestions but keeps the draft editable", () => {
  installDom();
  let submissions = 0;
  startAuthorApp({
    mount: q("#app"),
    locale,
    storage: memoryStorage(),
    variant: "suggestion",
    acceptingNewPuzzles: false,
    puzzleLimit: 1000,
    onSubmitSuggestion() { submissions += 1; }
  });

  assert.equal(q('[data-testid="suggestion-submit"]').disabled, true);
  assert.match(q('[data-testid="puzzle-limit-message"]').textContent, /1000/u);
  inputValue(q("#author-title-input"), "Un borrador que se conserva");
  assert.equal(q("#author-title-input").value, "Un borrador que se conserva");
  assert.equal(submissions, 0);
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
  assert.equal(q('[data-testid="author-publish-status"]').textContent, "Guardado para 2026-09-01.");
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

test("suggestion mode submits a valid undated draft without exposing JSON controls", async () => {
  installDom();
  const storage = memoryStorage();
  buildDirectedDraft(storage);
  storage.setItem(SUGGESTION_STORAGE_KEY, storage.value(AUTHOR_STORAGE_KEY)!);
  const submitted: PuzzleDefinition[] = [];
  startAuthorApp({
    mount: q("#app"),
    locale,
    storage,
    variant: "suggestion",
    async onSubmitSuggestion(definition) {
      submitted.push(definition);
      return { suggestionId: 17, status: "pending" };
    }
  });

  assert.equal(q("h1").textContent, locale.ui.suggestionTitle);
  assert.equal(q("#author-release-date").value, "");
  assert.equal(q('[data-testid="author-json"]'), null);
  assert.equal(q('[data-testid="author-download"]'), null);
  q('[data-testid="suggestion-info-open"]').click();
  assert.match(q('[data-testid="suggestion-info-dialog"]').textContent, /queda pendiente/u);
  q('[data-testid="suggestion-submit"]').click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(submitted.length, 1);
  assert.equal(submitted[0]!.releaseDate, undefined);
  assert.match(q('[data-testid="suggestion-submit-status"]').textContent, /#17/u);
  assert.equal(q('[data-testid="suggestion-submit"]').disabled, true);
});

test("an admin can load a pending suggestion and approve it with a date", () => {
  installDom();
  const definition = readPuzzle("2026-08-31-es.json");
  delete definition.releaseDate;
  const storage = memoryStorage();
  const published: Array<{ definition: PuzzleDefinition; suggestionId?: number }> = [];
  const suggestions = [{
    metadata: { suggestionId: 17, id: definition.id, title: definition.title ?? definition.id },
    definition
  }];
  const onPublish = (next: PuzzleDefinition, options: { readonly suggestionId?: number }) => {
      published.push({
        definition: next,
        ...(options.suggestionId === undefined ? {} : { suggestionId: options.suggestionId })
      });
  };
  startAuthorApp({ mount: q("#app"), locale, storage, suggestions, onPublish });
  const select = q('[data-testid="author-existing-suggestion"]');
  select.value = "0";
  select.dispatchEvent(new window.Event("change", { bubbles: true }));
  q('[data-testid="suggestion-load"]').click();
  startAuthorApp({ mount: q("#app"), locale, storage, suggestions, onPublish });
  inputValue(q("#author-release-date"), "2026-09-04");
  q('[data-testid="author-publish"]').click();
  assert.equal(published.length, 1);
  assert.equal(published[0]!.suggestionId, 17);
  assert.equal(published[0]!.definition.releaseDate, "2026-09-04");
  assert.equal(published[0]!.definition.revision, 1);
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
  assert.equal(q('[data-testid="author-publish-status"]').textContent, "Guardado para 2026-09-01.");
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
