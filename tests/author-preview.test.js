import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { mapAuthorPreviewSelection, renderAuthorPreview } from "../src/author-preview.js";

function setup(draft) {
  const dom = new JSDOM("<!doctype html><main id='preview'></main>");
  const container = dom.window.document.querySelector("#preview");
  renderAuthorPreview(container, draft);
  return { dom, container };
}

function select(dom, startNode, startOffset, endNode, endOffset) {
  const range = dom.window.document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  const selection = dom.window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  return selection;
}

test("an invalid initial draft still renders selectable root text", () => {
  const { container } = setup({ root: ["Texto inicial"], clues: {} });
  const literal = container.querySelector('[data-testid="author-preview-literal"]');
  assert.equal(literal.textContent, "Texto inicial");
  assert.equal(literal.hasAttribute("data-owner"), false);
  assert.equal(literal.hasAttribute("data-segment-index"), false);
});

test("recursive rendering identifies nested prompt literals without exposing answer metadata", () => {
  const draft = {
    root: ["La ", { ref: "parent" }, "."],
    clues: {
      parent: {
        answer: "respuesta secreta",
        accept: ["alias secreto"],
        peek: "R",
        prompt: ["antes ", { ref: "leaf" }, " después"]
      },
      leaf: { answer: "hoja secreta", accept: ["otra"], peek: "H", prompt: ["pista visible"] }
    }
  };
  const { container } = setup(draft);
  const nested = [...container.querySelectorAll('[data-testid="author-preview-literal"]')];
  assert.deepEqual(nested.map((node) => node.textContent), ["La ", "antes ", "pista visible", " después", "."]);
  assert.doesNotMatch(container.textContent, /respuesta secreta|alias secreto|hoja secreta|otra/u);
  assert.doesNotMatch(container.outerHTML, /parent|leaf|respuesta secreta|alias secreto|hoja secreta|otra/u);
});

test("clue IDs that equal answers are not exposed in preview markup", () => {
  const { container } = setup({
    root: ["Un ", { ref: "telescopio" }],
    clues: { telescopio: { answer: "telescopio", prompt: ["instrumento óptico"] } }
  });
  assert.doesNotMatch(container.outerHTML, /telescopio/u);
  assert.equal(container.textContent, "Un [instrumento óptico]");
});

test("one-sided direction arrows and answer slots render inside their bracket", () => {
  const { container } = setup({
    root: [{ ref: "left", direction: "left" }, " ", { ref: "right", direction: "right" }, " ", { ref: "parent", direction: "left" }],
    clues: {
      left: { answer: "a", prompt: ["izquierda"] },
      right: { answer: "b", prompt: ["derecha"] },
      parent: { answer: "c", prompt: [{ ref: "child" }] },
      child: { answer: "d", prompt: ["hija"] }
    }
  });
  const wrappers = container.querySelectorAll("[data-author-bracket]");
  assert.equal(wrappers[0].textContent, "[___←izquierda]");
  assert.equal(wrappers[1].textContent, "[derecha→___]");
  assert.equal(wrappers[2].textContent, "[___←[hija]]");
  assert.equal(container.querySelectorAll("[data-answer-slot]").length, 3);
  assert.equal(wrappers[0].previousSibling?.dataset?.authorDirection, undefined);
});

test("two distinct hints share one bracket and map right-side selections", () => {
  const { dom, container } = setup({
    root: [{ ref: "light" }],
    clues: {
      light: { answer: "light", prompt: ["sun"], rightPrompt: ["house"] }
    }
  });
  const wrapper = container.querySelector("[data-author-bracket]");
  assert.equal(wrapper.textContent, "[sun→___←house]");
  assert.doesNotMatch(container.outerHTML, /light/u);
  const right = container.querySelector('[data-author-hint="after"] [data-testid="author-preview-literal"]');
  assert.deepEqual(mapAuthorPreviewSelection(select(dom, right.firstChild, 0, right.firstChild, 5), container), {
    owner: "light:right", segmentIndex: 0, start: 0, end: 5
  });
});

test("selection mapping returns exact root and nested UTF-16 offsets", () => {
  const { dom, container } = setup({
    root: ["A😀rbol ", { ref: "clue" }],
    clues: { clue: { answer: "x", prompt: ["pista anidada"] } }
  });
  const [root, nested] = container.querySelectorAll('[data-testid="author-preview-literal"]');
  assert.deepEqual(mapAuthorPreviewSelection(select(dom, root.firstChild, 1, root.firstChild, 3), container), {
    owner: "root", segmentIndex: 0, start: 1, end: 3
  });
  assert.deepEqual(mapAuthorPreviewSelection(select(dom, nested.firstChild, 6, nested.firstChild, 13), container), {
    owner: "clue", segmentIndex: 0, start: 6, end: 13
  });
});

test("selection mapping accepts browser-shaped boundaries around one literal", () => {
  const { dom, container } = setup({ root: ["Texto inicial"], clues: {} });

  assert.deepEqual(mapAuthorPreviewSelection(select(dom, container, 0, container, 1), container), {
    owner: "root", segmentIndex: 0, start: 0, end: 13
  });
});

test("selection mapping rejects collapsed, cross-literal, bracket, and outside selections", () => {
  const { dom, container } = setup({
    root: ["uno", { ref: "clue" }, "tres"],
    clues: { clue: { answer: "dos", prompt: ["pista"] } }
  });
  const literals = container.querySelectorAll('[data-testid="author-preview-literal"]');
  const collapsed = select(dom, literals[0].firstChild, 1, literals[0].firstChild, 1);
  assert.equal(mapAuthorPreviewSelection(collapsed, container), null);
  assert.equal(mapAuthorPreviewSelection(select(dom, literals[0].firstChild, 1, literals[1].firstChild, 2), container), null);

  const bracket = container.querySelector('[data-author-bracket-edge="open"]');
  assert.equal(mapAuthorPreviewSelection(select(dom, bracket.firstChild, 0, bracket.firstChild, 1), container), null);

  const outside = dom.window.document.createElement("p");
  outside.textContent = "fuera";
  dom.window.document.body.append(outside);
  assert.equal(mapAuthorPreviewSelection(select(dom, outside.firstChild, 0, outside.firstChild, 2), container), null);
});

test("cyclic and missing references render finite non-answer brackets", () => {
  const { container } = setup({
    root: [{ ref: "cycle" }, { ref: "missing" }],
    clues: { cycle: { answer: "no mostrar", prompt: [{ ref: "cycle" }] } }
  });
  assert.equal(container.querySelectorAll("[data-author-bracket]").length, 3);
  assert.doesNotMatch(container.outerHTML, /no mostrar/u);
});
