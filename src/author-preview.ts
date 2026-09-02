import type { ClueDefinition, Direction, Segment } from "./types.ts";

export type AuthorPreviewDraft = {
  root: Segment[];
  clues: Record<string, ClueDefinition>;
};

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isReference(segment: unknown): segment is { ref: string; direction?: Direction } {
  return isRecord(segment) && typeof segment.ref === "string";
}

interface LiteralLocation {
  owner: string;
  segmentIndex: number;
}

const literalLocations = new WeakMap<Element, LiteralLocation>();

function element(document: Document, tagName: string, attributes: Record<string, unknown> = {}): HTMLElement {
  const node = document.createElement(tagName);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  return node;
}

function literalSpan(document: Document, value: string, owner: string, segmentIndex: number): HTMLElement {
  const span = element(document, "span", {
    "data-testid": "author-preview-literal"
  });
  span.textContent = value;
  literalLocations.set(span, { owner, segmentIndex });
  return span;
}

function directionMarker(document: Document, direction: Direction): HTMLElement {
  const marker = element(document, "span", {
    "data-author-direction": direction,
    "aria-hidden": "true"
  });
  marker.textContent = direction === "left" ? "←" : "→";
  return marker;
}

function answerSlot(document: Document): HTMLElement {
  const slot = element(document, "span", {
    "data-answer-slot": "",
    role: "img",
    "aria-label": "respuesta en blanco"
  });
  slot.textContent = "___";
  return slot;
}

function hintSpan(document: Document, side: "before" | "after", contents: DocumentFragment): HTMLElement {
  const hint = element(document, "span", { "data-author-hint": side });
  hint.append(contents);
  return hint;
}

function renderSegments(
  document: Document,
  draft: AuthorPreviewDraft,
  owner: string,
  segments: readonly Segment[],
  active: Set<string>
): DocumentFragment {
  const fragment = document.createDocumentFragment();
  if (!Array.isArray(segments)) return fragment;

  segments.forEach((segment, segmentIndex) => {
    if (typeof segment === "string") {
      fragment.append(literalSpan(document, segment, owner, segmentIndex));
      return;
    }
    if (!isReference(segment)) return;

    const clue: ClueDefinition | null = isRecord(draft.clues?.[segment.ref])
      ? draft.clues[segment.ref] ?? null
      : null;
    const wrapper = element(document, "span", {
      "data-author-bracket": ""
    });
    const open = element(document, "span", { "data-author-bracket-edge": "open", "aria-hidden": "true" });
    open.textContent = "[";
    const close = element(document, "span", { "data-author-bracket-edge": "close", "aria-hidden": "true" });
    close.textContent = "]";
    wrapper.append(open);
    if (clue && !active.has(segment.ref)) {
      const nextActive = new Set(active);
      nextActive.add(segment.ref);
      const before = () => hintSpan(
        document,
        "before",
        renderSegments(document, draft, segment.ref, clue.prompt, nextActive)
      );
      if (Array.isArray(clue.rightPrompt)) {
        wrapper.append(
          before(),
          directionMarker(document, "right"),
          answerSlot(document),
          directionMarker(document, "left"),
          hintSpan(
            document,
            "after",
            renderSegments(document, draft, `${segment.ref}:right`, clue.rightPrompt, nextActive)
          )
        );
      } else if (segment.direction === "left") {
        wrapper.append(answerSlot(document), directionMarker(document, "left"), before());
      } else {
        wrapper.append(before());
        if (segment.direction === "right") {
          wrapper.append(directionMarker(document, "right"), answerSlot(document));
        }
      }
    }
    wrapper.append(close);
    fragment.append(wrapper);
  });
  return fragment;
}

export function renderAuthorPreview(container: HTMLElement, draft: AuthorPreviewDraft): HTMLElement {
  const document = container.ownerDocument;
  const root = Array.isArray(draft.root) ? draft.root : [];
  container.replaceChildren(renderSegments(document, draft, "root", root, new Set()));
  return container;
}

function literalForEndpoint(node: Node | null | undefined, container: HTMLElement): Element | null {
  const elementNode = node?.nodeType === 1 ? node as Element : node?.parentElement;
  const literal = elementNode?.closest?.('[data-testid="author-preview-literal"]') ?? null;
  return literal && container.contains(literal) ? literal : null;
}

function edgeDescendant(node: Node | null | undefined, side: "start" | "end"): Node | null | undefined {
  let current = node;
  while (current?.nodeType === 1 && !(current as Element).matches('[data-testid="author-preview-literal"]')) {
    current = side === "start" ? current.firstChild : current.lastChild;
  }
  return current;
}

function offsetWithinLiteral(literal: Element, node: Node, offset: number): number | null {
  if (node !== literal && !literal.contains(node)) return null;
  try {
    const range = literal.ownerDocument.createRange();
    range.selectNodeContents(literal);
    range.setEnd(node, offset);
    return range.toString().length;
  } catch {
    return null;
  }
}

function boundaryWithinLiteral(
  node: Node,
  offset: number,
  container: HTMLElement,
  side: "start" | "end"
): { literal: Element; offset: number } | null {
  const directLiteral = literalForEndpoint(node, container);
  if (directLiteral) {
    const directOffset = offsetWithinLiteral(directLiteral, node, offset);
    return directOffset === null ? null : { literal: directLiteral, offset: directOffset };
  }

  if (node.nodeType !== 1 || !container.contains(node)) return null;
  const adjacent = side === "start" ? node.childNodes[offset] : node.childNodes[offset - 1];
  const literal = literalForEndpoint(edgeDescendant(adjacent, side), container);
  if (!literal) return null;
  return { literal, offset: side === "start" ? 0 : (literal.textContent ?? "").length };
}

export function mapAuthorPreviewSelection(selection: Selection | null, container: HTMLElement): {
  owner: string;
  segmentIndex: number;
  start: number;
  end: number;
} | null {
  if (!selection || !container || selection.rangeCount !== 1 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (range.collapsed) return null;
  const startBoundary = boundaryWithinLiteral(range.startContainer, range.startOffset, container, "start");
  const endBoundary = boundaryWithinLiteral(range.endContainer, range.endOffset, container, "end");
  if (!startBoundary || !endBoundary || startBoundary.literal !== endBoundary.literal) return null;

  const start = startBoundary.offset;
  const end = endBoundary.offset;
  const location = literalLocations.get(startBoundary.literal);
  if (
    start === null ||
    end === null ||
    start >= end ||
    !location ||
    !Number.isSafeInteger(location.segmentIndex) ||
    typeof location.owner !== "string"
  ) return null;
  return { owner: location.owner, segmentIndex: location.segmentIndex, start, end };
}
