import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import {
  draftFromAuthorInlineParse,
  formatAuthorDraftAsInlineSource,
  MAX_INLINE_DEPTH,
  MAX_INLINE_GROUPS,
  parseAuthorInlineSource,
  renderAuthorInlinePreview,
  replaceInlineGroup
} from "../src/author-inline.ts";
import { createAuthorDraft } from "../src/author.ts";

test("inline syntax parses nesting and all direction forms", () => {
  const parsed = parseAuthorInlineSource(
    "Inicio [sol [estrella=astro]→luz] y [hogar←casa], [día→claroscuro←noche]."
  );

  assert.deepEqual(parsed.issues, []);
  assert.equal(parsed.groups.length, 4);
  assert.equal(parsed.groups[0]!.direction, "right");
  assert.equal(parsed.groups[1]!.direction, undefined);
  assert.equal(parsed.groups[2]!.direction, "left");
  assert.deepEqual(parsed.groups.map((group) => group.answer), ["luz", "astro", "hogar", "claroscuro"]);
  assert.deepEqual(parsed.groups[3]!.rightPrompt?.map((node) => node.type === "text" ? node.value : node.type), ["noche"]);
  assert.deepEqual(parsed.groups[0]!.prompt.map((node) => node.type === "text" ? node.value : node.type), ["sol ", "group"]);
  assert.deepEqual(parsed.groups[2]!.prompt.map((node) => node.type === "text" ? node.value : node.type), ["casa"]);
  assert.equal(parsed.bracketCount, 4);
  assert.equal(parsed.bracketDepth, 2);
});

test("inline syntax reports incomplete brackets and misplaced arrows", () => {
  assert.equal(parseAuthorInlineSource("texto]").issues[0]?.code, "UNEXPECTED_CLOSE");
  assert.equal(parseAuthorInlineSource("[texto").issues[0]?.code, "UNCLOSED_GROUP");
  assert.equal(parseAuthorInlineSource("[uno→dos=respuesta]").issues[0]?.code, "INVALID_DIRECTION");
  assert.equal(parseAuthorInlineSource("[pista]").issues[0]?.code, "MISSING_ANSWER");
  assert.equal(parseAuthorInlineSource("[pista= ]").issues[0]?.code, "EMPTY_ANSWER");
  assert.equal(parseAuthorInlineSource("[pista=uno=dos]").issues[0]?.code, "MULTIPLE_ANSWERS");
  assert.equal(parseAuthorInlineSource("[pista=uno|dos]").issues[0]?.code, "ALTERNATIVES_DISABLED");
  assert.equal(parseAuthorInlineSource("[pista=uno\\|dos]").groups[0]?.answer, "uno|dos");
  const spaced = parseAuthorInlineSource("[ pista con espacios = respuesta final ]");
  assert.deepEqual(spaced.issues, []);
  assert.deepEqual(spaced.groups[0]?.prompt.map((node) => node.type === "text" ? node.value : node.type), ["pista con espacios"]);
  assert.equal(spaced.groups[0]?.answer, "respuesta final");
});

test("inline syntax records bracket limits and rejects excessive count or depth", () => {
  const tooMany = parseAuthorInlineSource(Array.from({ length: MAX_INLINE_GROUPS + 1 }, () => "[pista=respuesta]").join(" "));
  assert.equal(tooMany.bracketCount, MAX_INLINE_GROUPS + 1);
  assert.equal(tooMany.bracketDepth, 1);
  assert.ok(tooMany.issues.some((issue) => issue.code === "TOO_MANY_GROUPS"));

  const tooDeep = parseAuthorInlineSource(`${"[".repeat(MAX_INLINE_DEPTH + 1)}pista${"]".repeat(MAX_INLINE_DEPTH + 1)}`);
  assert.equal(tooDeep.bracketCount, MAX_INLINE_DEPTH + 1);
  assert.equal(tooDeep.bracketDepth, MAX_INLINE_DEPTH + 1);
  assert.ok(tooDeep.issues.some((issue) => issue.code === "TOO_DEEP"));
});

test("inline syntax creates a nested author draft and preserves answers", () => {
  const initial = createAuthorDraft({ finalText: "" });
  const firstParse = parseAuthorInlineSource("La [animal [de casa→=doméstico]=gata].");
  const first = draftFromAuthorInlineParse(initial, firstParse);

  assert.deepEqual(first.root, ["La ", { ref: "c01" }, "."]);
  assert.deepEqual(first.clues.c01!.prompt, ["animal ", { ref: "c02", direction: "right" }]);
  assert.deepEqual(first.clues.c02!.prompt, ["de casa"]);
  assert.equal(first.clues.c01!.answer, "gata");
  assert.equal(first.clues.c02!.answer, "doméstico");

  const secondParse = parseAuthorInlineSource("La [animal muy [de casa→=doméstico]=perra].");
  const second = draftFromAuthorInlineParse(first, secondParse);
  assert.equal(second.clues.c01!.answer, "perra");
  assert.equal(second.clues.c02!.answer, "doméstico");
  assert.equal(second.finalText, "La perra.");
});

test("adding a group preserves matching siblings and selects the new group", () => {
  const initial = draftFromAuthorInlineParse(
    createAuthorDraft(),
    parseAuthorInlineSource("[primera=uno] y [segunda=dos]")
  );
  initial.selectedClueId = "c02";

  const parsed = parseAuthorInlineSource("[primera=uno] y [nueva=tres] y [segunda=dos]");
  const next = draftFromAuthorInlineParse(initial, parsed);
  assert.equal(next.clues.c01!.answer, "uno");
  assert.equal(next.clues.c02!.answer, "dos");
  const added = Object.entries(next.clues).find(([, clue]) => clue.prompt[0] === "nueva");
  assert.equal(added?.[1].answer, "tres");
  assert.equal(next.selectedClueId, added?.[0]);
});

test("editing inline answers preserves aliases from an existing puzzle", () => {
  const initial = draftFromAuthorInlineParse(createAuthorDraft(), parseAuthorInlineSource("[pista=uno]"));
  initial.clues.c01!.accept = ["alternativa heredada"];

  const next = draftFromAuthorInlineParse(initial, parseAuthorInlineSource("[pista=dos]"));

  assert.equal(next.clues.c01!.answer, "dos");
  assert.deepEqual(next.clues.c01!.accept, ["alternativa heredada"]);
});

test("draft formatting escapes literal syntax characters and round trips", () => {
  const draft = draftFromAuthorInlineParse(
    createAuthorDraft(),
    parseAuthorInlineSource("Literal \\[ y [pista\\=igual→=res\\|puesta]")
  );

  const formatted = formatAuthorDraftAsInlineSource(draft);
  assert.equal(formatted, "Literal \\[ y [pista\\=igual→res\\|puesta]");
  assert.deepEqual(parseAuthorInlineSource(formatted).issues, []);

  const legacyDraft = draftFromAuthorInlineParse(
    createAuthorDraft(),
    parseAuthorInlineSource("[pista→=respuesta] [←otra=dos] [izquierda→←derecha=tres]")
  );
  assert.equal(
    formatAuthorDraftAsInlineSource(legacyDraft),
    "[pista→respuesta] [dos←otra] [izquierda→tres←derecha]"
  );
});

test("the preview renders nested groups and removes a group as its answer", () => {
  const parsed = parseAuthorInlineSource("La [animal [doméstico=casero]=gata].");
  const draft = draftFromAuthorInlineParse(createAuthorDraft(), parsed);
  const dom = new JSDOM("<!doctype html><main id='preview'></main>");
  const preview = dom.window.document.querySelector<HTMLElement>("#preview")!;
  let removed = "";
  renderAuthorInlinePreview(preview, parsed, {
    selectedClueId: "c01",
    onRemove(group) { removed = group.clueId ?? ""; }
  });

  assert.equal(preview.querySelectorAll("[data-testid='author-inline-group']").length, 2);
  assert.ok(preview.querySelector("[data-clue-id='c01']")?.classList.contains("is-selected"));
  (preview.querySelector("[data-clue-id='c01'] > .author-inline-remove") as HTMLButtonElement).click();
  assert.equal(removed, "c01");
  assert.deepEqual(replaceInlineGroup(parsed.source, parsed.groups[0]!, draft), {
    source: "La gata.",
    caret: 7
  });
});

test("the preview renders a canonical answer gap for every directional form", () => {
  const parsed = parseAuthorInlineSource("[pista→a] [b←otra] [izquierda→c←derecha]");
  const dom = new JSDOM("<!doctype html><main id='preview'></main>");
  const preview = dom.window.document.querySelector<HTMLElement>("#preview")!;
  renderAuthorInlinePreview(preview, parsed);

  const contents = [...preview.querySelectorAll<HTMLElement>(".author-inline-group-contents")];
  assert.deepEqual(contents.map((node) => node.textContent), [
    "pista→___",
    "___←otra",
    "izquierda→___←derecha"
  ]);
  assert.equal(preview.querySelectorAll("[data-testid='author-inline-answer-slot']").length, 3);
  assert.equal(preview.querySelector("[data-testid='author-inline-answer-slot']")?.getAttribute("aria-label"), "respuesta en blanco");
});

test("clicking a group body selects the deepest tapped group", () => {
  const parsed = parseAuthorInlineSource("[exterior [interior=dos]=uno]");
  draftFromAuthorInlineParse(createAuthorDraft(), parsed);
  const dom = new JSDOM("<!doctype html><main id='preview'></main>");
  const preview = dom.window.document.querySelector<HTMLElement>("#preview")!;
  const selected: string[] = [];
  renderAuthorInlinePreview(preview, parsed, {
    onSelect(group) { selected.push(group.clueId ?? ""); }
  });

  const outer = preview.querySelector<HTMLElement>("[data-clue-id='c01']")!;
  const inner = preview.querySelector<HTMLElement>("[data-clue-id='c02']")!;
  outer.querySelector<HTMLElement>(":scope > .author-inline-edge")!.click();
  inner.querySelector<HTMLElement>(".author-inline-group-contents")!.click();

  assert.deepEqual(selected, ["c01", "c02"]);
});
