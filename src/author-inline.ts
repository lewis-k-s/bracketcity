import type {
  AuthorDraft,
  ClueDefinition,
  Direction,
  ReferenceSegment,
  Segment
} from "./types.ts";

export interface InlineTextNode {
  readonly type: "text";
  value: string;
  readonly start: number;
  end: number;
}

export interface InlineArrowNode {
  readonly type: "arrow";
  readonly direction: Direction;
  readonly start: number;
  readonly end: number;
}

export interface InlineAnswerSeparatorNode {
  readonly type: "answer-separator";
  readonly start: number;
  readonly end: number;
}

export interface InlineAlternativeSeparatorNode {
  readonly type: "alternative-separator";
  readonly start: number;
  readonly end: number;
}

export interface InlineGroupNode {
  readonly type: "group";
  readonly start: number;
  readonly end: number;
  readonly depth: number;
  readonly raw: InlineNode[];
  prompt: InlineNode[];
  rightPrompt?: InlineNode[];
  direction?: Direction;
  answer?: string;
  clueId?: string;
}

export type InlineNode =
  | InlineTextNode
  | InlineArrowNode
  | InlineAnswerSeparatorNode
  | InlineAlternativeSeparatorNode
  | InlineGroupNode;

export interface InlineParseIssue {
  readonly code:
    | "UNEXPECTED_CLOSE"
    | "UNCLOSED_GROUP"
    | "INVALID_DIRECTION"
    | "MISSING_ANSWER"
    | "EMPTY_ANSWER"
    | "MULTIPLE_ANSWERS"
    | "INVALID_ANSWER"
    | "ALTERNATIVES_DISABLED"
    | "TOO_MANY_GROUPS"
    | "TOO_DEEP";
  readonly offset: number;
  readonly message: string;
}

export interface InlineParseResult {
  readonly source: string;
  readonly nodes: InlineNode[];
  readonly groups: InlineGroupNode[];
  readonly bracketCount: number;
  readonly bracketDepth: number;
  readonly issues: InlineParseIssue[];
}

interface SequenceResult {
  readonly nodes: InlineNode[];
  readonly closed: boolean;
}

interface PriorGroup {
  readonly id: string;
  readonly signature: string;
}

const SPECIAL_CHARACTERS = new Set(["\\", "[", "]", "←", "→", "=", "|"]);

export const MAX_INLINE_GROUPS = 100;
export const MAX_INLINE_DEPTH = 10;

function isReference(segment: Segment): segment is ReferenceSegment {
  return typeof segment !== "string";
}

function pushText(nodes: InlineNode[], value: string, start: number, end: number): void {
  const previous = nodes.at(-1);
  if (previous?.type === "text") {
    previous.value += value;
    previous.end = end;
    return;
  }
  nodes.push({ type: "text", value, start, end });
}

function containsOnlyWhitespace(nodes: readonly InlineNode[]): boolean {
  return nodes.every((node) => node.type === "text" && node.value.trim() === "");
}

function containsOnlyAnswerGap(nodes: readonly InlineNode[]): boolean {
  if (containsOnlyWhitespace(nodes)) return true;
  if (!nodes.every((node) => node.type === "text")) return false;
  return /^\s*_+\s*$/u.test(nodes.map((node) => node.value).join(""));
}

function trimOuterWhitespace(nodes: readonly InlineNode[]): InlineNode[] {
  const result = nodes.map((node) => node.type === "text" ? { ...node } : node);
  const first = result.at(0);
  if (first?.type === "text") {
    first.value = first.value.replace(/^\s+/u, "");
    if (!first.value) result.shift();
  }
  const last = result.at(-1);
  if (last?.type === "text") {
    last.value = last.value.replace(/\s+$/u, "");
    if (!last.value) result.pop();
  }
  return result;
}

function analyzeDirection(group: InlineGroupNode, nodes: InlineNode[], issues: InlineParseIssue[]): void {
  const arrowIndexes = nodes.flatMap((node, index) => node.type === "arrow" ? [index] : []);
  if (arrowIndexes.length === 0) {
    group.prompt = nodes;
    return;
  }
  if (arrowIndexes.length === 1) {
    const index = arrowIndexes[0]!;
    const arrow = nodes[index] as InlineArrowNode;
    if (arrow.direction === "left" && containsOnlyAnswerGap(nodes.slice(0, index))) {
      group.direction = "left";
      group.prompt = trimOuterWhitespace(nodes.slice(index + 1));
      return;
    }
    if (arrow.direction === "right" && containsOnlyAnswerGap(nodes.slice(index + 1))) {
      group.direction = "right";
      group.prompt = trimOuterWhitespace(nodes.slice(0, index));
      return;
    }
  }
  if (arrowIndexes.length === 2) {
    const [rightIndex, leftIndex] = arrowIndexes;
    const right = nodes[rightIndex!] as InlineArrowNode;
    const left = nodes[leftIndex!] as InlineArrowNode;
    if (
      right.direction === "right" &&
      left.direction === "left" &&
      containsOnlyAnswerGap(nodes.slice(rightIndex! + 1, leftIndex))
    ) {
      group.prompt = trimOuterWhitespace(nodes.slice(0, rightIndex));
      group.rightPrompt = trimOuterWhitespace(nodes.slice(leftIndex! + 1));
      return;
    }
  }
  group.prompt = nodes;
  issues.push({
    code: "INVALID_DIRECTION",
    offset: (nodes.find((node) => node.type === "arrow") ?? group).start,
    message: "Usa ← al principio, → antes de =, o →← entre dos pistas."
  });
}

function setAnswerFromNodes(group: InlineGroupNode, nodes: readonly InlineNode[], issues: InlineParseIssue[], offset: number): boolean {
  const invalid = nodes.find((node) => node.type !== "text");
  if (invalid) {
    issues.push({
      code: "INVALID_ANSWER",
      offset: invalid.start,
      message: "La respuesta debe ser texto. Escapa los símbolos estructurales con una barra inversa."
    });
    return false;
  }
  const answer = nodes.map((node) => node.type === "text" ? node.value : "").join("").trim();
  if (!answer) {
    issues.push({
      code: "EMPTY_ANSWER",
      offset,
      message: "Escribe una respuesta en el grupo."
    });
    return false;
  }
  group.answer = answer;
  return true;
}

function analyzeDirectionalAnswer(group: InlineGroupNode, issues: InlineParseIssue[]): boolean {
  const arrowIndexes = group.raw.flatMap((node, index) => node.type === "arrow" ? [index] : []);
  if (arrowIndexes.length === 0) return false;

  if (arrowIndexes.length === 1) {
    const index = arrowIndexes[0]!;
    const arrow = group.raw[index] as InlineArrowNode;
    const answerNodes = arrow.direction === "right"
      ? group.raw.slice(index + 1)
      : group.raw.slice(0, index);
    group.direction = arrow.direction;
    group.prompt = trimOuterWhitespace(arrow.direction === "right"
      ? group.raw.slice(0, index)
      : group.raw.slice(index + 1));
    setAnswerFromNodes(group, answerNodes, issues, arrow.end);
    return true;
  }

  if (arrowIndexes.length === 2) {
    const [rightIndex, leftIndex] = arrowIndexes;
    const right = group.raw[rightIndex!] as InlineArrowNode;
    const left = group.raw[leftIndex!] as InlineArrowNode;
    if (right.direction === "right" && left.direction === "left") {
      group.prompt = trimOuterWhitespace(group.raw.slice(0, rightIndex));
      group.rightPrompt = trimOuterWhitespace(group.raw.slice(leftIndex! + 1));
      setAnswerFromNodes(group, group.raw.slice(rightIndex! + 1, leftIndex), issues, right.end);
      return true;
    }
  }

  group.prompt = group.raw;
  issues.push({
    code: "INVALID_DIRECTION",
    offset: (group.raw.find((node) => node.type === "arrow") ?? group).start,
    message: "Usa pista→respuesta, respuesta←pista o pista→respuesta←pista."
  });
  return true;
}

function analyzeGroup(group: InlineGroupNode, issues: InlineParseIssue[]): void {
  const answerSeparators = group.raw.flatMap(
    (node, index) => node.type === "answer-separator" ? [index] : []
  );
  const separatorIndex = answerSeparators[0];
  if (separatorIndex === undefined) {
    if (analyzeDirectionalAnswer(group, issues)) return;
    group.prompt = trimOuterWhitespace(group.raw);
    issues.push({
      code: "MISSING_ANSWER",
      offset: group.start,
      message: "Añade la respuesta con =, por ejemplo [pista=respuesta]."
    });
    return;
  }
  const promptNodes = trimOuterWhitespace(
    group.raw.slice(0, separatorIndex)
  );
  analyzeDirection(group, promptNodes, issues);

  if (answerSeparators.length > 1) {
    issues.push({
      code: "MULTIPLE_ANSWERS",
      offset: group.raw[answerSeparators[1]!]!.start,
      message: "Usa un solo = por grupo. Escribe \\= para incluir el signo en la respuesta."
    });
    return;
  }

  const answerNodes = group.raw.slice(separatorIndex + 1);
  const alternative = answerNodes.find((node) => node.type === "alternative-separator");
  if (alternative) {
    issues.push({
      code: "ALTERNATIVES_DISABLED",
      offset: alternative.start,
      message: "Las respuestas alternativas no están disponibles."
    });
    return;
  }
  setAnswerFromNodes(group, answerNodes, issues, group.raw[separatorIndex]!.end);
}

function collectGroups(nodes: readonly InlineNode[], target: InlineGroupNode[] = []): InlineGroupNode[] {
  for (const node of nodes) {
    if (node.type !== "group") continue;
    target.push(node);
    collectGroups(node.raw, target);
  }
  return target;
}

export function parseAuthorInlineSource(sourceValue: unknown): InlineParseResult {
  const source = String(sourceValue ?? "");
  const issues: InlineParseIssue[] = [];
  let offset = 0;
  let bracketCount = 0;
  let bracketDepth = 0;
  let skippedGroups = 0;
  let groupLimitReported = false;
  let depthLimitReported = false;

  const parseSequence = (depth: number, insideGroup: boolean): SequenceResult => {
    const nodes: InlineNode[] = [];
    while (offset < source.length) {
      const start = offset;
      const character = source[offset]!;
      if (character === "\\" && offset + 1 < source.length && SPECIAL_CHARACTERS.has(source[offset + 1]!)) {
        pushText(nodes, source[offset + 1]!, start, offset + 2);
        offset += 2;
        continue;
      }
      if (character === "[") {
        bracketCount += 1;
        const nextDepth = depth + skippedGroups + 1;
        bracketDepth = Math.max(bracketDepth, nextDepth);
        let skipGroup = false;
        if (bracketCount > MAX_INLINE_GROUPS) {
          skipGroup = true;
          if (!groupLimitReported) {
            issues.push({
              code: "TOO_MANY_GROUPS",
              offset: start,
              message: `Máximo ${MAX_INLINE_GROUPS} grupos con corchetes.`
            });
            groupLimitReported = true;
          }
        }
        if (nextDepth > MAX_INLINE_DEPTH) {
          skipGroup = true;
          if (!depthLimitReported) {
            issues.push({
              code: "TOO_DEEP",
              offset: start,
              message: `Máxima profundidad: ${MAX_INLINE_DEPTH} corchetes.`
            });
            depthLimitReported = true;
          }
        }
        if (skipGroup) {
          skippedGroups += 1;
          pushText(nodes, character, start, start + 1);
          offset += 1;
          continue;
        }
        offset += 1;
        const inner = parseSequence(depth + 1, true);
        const group: InlineGroupNode = {
          type: "group",
          start,
          end: offset,
          depth,
          raw: inner.nodes,
          prompt: inner.nodes
        };
        if (!inner.closed) {
          issues.push({
            code: "UNCLOSED_GROUP",
            offset: start,
            message: "Falta ] para cerrar este grupo."
          });
        }
        analyzeGroup(group, issues);
        nodes.push(group);
        continue;
      }
      if (character === "]") {
        offset += 1;
        if (skippedGroups > 0) {
          skippedGroups -= 1;
          pushText(nodes, character, start, offset);
          continue;
        }
        if (insideGroup) return { nodes, closed: true };
        issues.push({
          code: "UNEXPECTED_CLOSE",
          offset: start,
          message: "Este ] no tiene un [ de apertura."
        });
        pushText(nodes, character, start, offset);
        continue;
      }
      if (insideGroup && character === "=") {
        nodes.push({ type: "answer-separator", start, end: start + 1 });
        offset += 1;
        continue;
      }
      if (insideGroup && character === "|") {
        nodes.push({ type: "alternative-separator", start, end: start + 1 });
        offset += 1;
        continue;
      }
      if (character === "←" || character === "→") {
        nodes.push({
          type: "arrow",
          direction: character === "←" ? "left" : "right",
          start,
          end: start + 1
        });
        offset += 1;
        continue;
      }
      pushText(nodes, character, start, start + 1);
      offset += 1;
    }
    return { nodes, closed: !insideGroup };
  };

  const nodes = parseSequence(0, false).nodes;
  return { source, nodes, groups: collectGroups(nodes), bracketCount, bracketDepth, issues };
}

function escapeLiteral(value: string): string {
  return value.replace(/[\\[\]←→=|]/gu, (character) => `\\${character}`);
}

function formatSegments(
  segments: readonly Segment[],
  clues: Readonly<Record<string, ClueDefinition>>,
  active: Set<string>
): string {
  return segments.map((segment) => {
    if (typeof segment === "string") return escapeLiteral(segment);
    const clue = clues[segment.ref];
    if (!clue || active.has(segment.ref)) return "[]";
    const nextActive = new Set(active);
    nextActive.add(segment.ref);
    const left = formatSegments(clue.prompt, clues, nextActive);
    const answer = escapeLiteral(clue.answer);
    if (Array.isArray(clue.rightPrompt)) {
      return `[${left}→${answer}←${formatSegments(clue.rightPrompt, clues, nextActive)}]`;
    }
    if (segment.direction === "left") return `[${answer}←${left}]`;
    if (segment.direction === "right") return `[${left}→${answer}]`;
    return `[${left}=${answer}]`;
  }).join("");
}

export function formatAuthorDraftAsInlineSource(draft: Pick<AuthorDraft, "root" | "clues">): string {
  return formatSegments(draft.root, draft.clues, new Set());
}

function parsedNodesText(nodes: readonly InlineNode[]): string {
  return nodes.map((node) => {
    if (node.type === "text") return node.value;
    if (node.type === "arrow") return node.direction === "left" ? "←" : "→";
    if (node.type === "answer-separator") return "=";
    if (node.type === "alternative-separator") return "|";
    const left = parsedNodesText(node.prompt);
    if (node.rightPrompt) return `${left}→←${parsedNodesText(node.rightPrompt)}`;
    if (node.direction === "left") return `←${left}`;
    if (node.direction === "right") return `${left}→`;
    return left;
  }).join("");
}

function normalizeSignature(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function parsedGroupSignature(group: InlineGroupNode): string {
  const left = normalizeSignature(parsedNodesText(group.prompt));
  const right = group.rightPrompt ? normalizeSignature(parsedNodesText(group.rightPrompt)) : "";
  const direction = group.rightPrompt ? "both" : group.direction ?? "none";
  return `${direction}|${left}|${right}`;
}

function collectPriorGroups(draft: Pick<AuthorDraft, "root" | "clues">): PriorGroup[] {
  const groups: PriorGroup[] = [];
  const active = new Set<string>();
  const visit = (segments: readonly Segment[]): void => {
    for (const segment of segments) {
      if (!isReference(segment) || active.has(segment.ref)) continue;
      const clue = draft.clues[segment.ref];
      if (!clue) continue;
      active.add(segment.ref);
      const left = normalizeSignature(parsedNodesText(parseAuthorInlineSource(
        formatSegments(clue.prompt, draft.clues, active)
      ).nodes));
      const right = Array.isArray(clue.rightPrompt)
        ? normalizeSignature(parsedNodesText(parseAuthorInlineSource(
          formatSegments(clue.rightPrompt, draft.clues, active)
        ).nodes))
        : "";
      groups.push({
        id: segment.ref,
        signature: `${Array.isArray(clue.rightPrompt) ? "both" : segment.direction ?? "none"}|${left}|${right}`
      });
      visit(clue.prompt);
      if (Array.isArray(clue.rightPrompt)) visit(clue.rightPrompt);
      active.delete(segment.ref);
    }
  };
  visit(draft.root);
  return groups;
}

function matchingSignatures(previous: readonly PriorGroup[], next: readonly InlineGroupNode[]): Map<number, string> {
  const rows = previous.length + 1;
  const columns = next.length + 1;
  const lengths = Array.from({ length: rows }, () => Array<number>(columns).fill(0));
  for (let previousIndex = previous.length - 1; previousIndex >= 0; previousIndex -= 1) {
    for (let nextIndex = next.length - 1; nextIndex >= 0; nextIndex -= 1) {
      lengths[previousIndex]![nextIndex] = previous[previousIndex]!.signature === parsedGroupSignature(next[nextIndex]!)
        ? 1 + lengths[previousIndex + 1]![nextIndex + 1]!
        : Math.max(lengths[previousIndex + 1]![nextIndex]!, lengths[previousIndex]![nextIndex + 1]!);
    }
  }
  const matches = new Map<number, string>();
  let previousIndex = 0;
  let nextIndex = 0;
  while (previousIndex < previous.length && nextIndex < next.length) {
    if (previous[previousIndex]!.signature === parsedGroupSignature(next[nextIndex]!)) {
      matches.set(nextIndex, previous[previousIndex]!.id);
      previousIndex += 1;
      nextIndex += 1;
    } else if (lengths[previousIndex + 1]![nextIndex]! >= lengths[previousIndex]![nextIndex + 1]!) {
      previousIndex += 1;
    } else {
      nextIndex += 1;
    }
  }
  return matches;
}

function nextClueId(used: ReadonlySet<string>): string {
  let index = 1;
  while (used.has(`c${String(index).padStart(2, "0")}`)) index += 1;
  return `c${String(index).padStart(2, "0")}`;
}

function mergeTextSegments(segments: Segment[]): Segment[] {
  const result: Segment[] = [];
  for (const segment of segments) {
    const previous = result.at(-1);
    if (typeof segment === "string" && typeof previous === "string") {
      result[result.length - 1] = previous + segment;
    } else if (typeof segment !== "string" || segment.length > 0) {
      result.push(segment);
    }
  }
  return result.length > 0 ? result : [""];
}

function cloneClueMetadata(clue: ClueDefinition | undefined): Pick<ClueDefinition, "accept" | "peek" | "match"> {
  return {
    ...(clue?.accept ? { accept: [...clue.accept] } : {}),
    ...(clue?.peek ? { peek: clue.peek } : {}),
    ...(clue?.match ? { match: structuredClone(clue.match) } : {})
  };
}

export function draftFromAuthorInlineParse(currentDraft: AuthorDraft, parsed: InlineParseResult): AuthorDraft {
  if (parsed.issues.length > 0) throw new Error(parsed.issues[0]!.message);
  const previous = collectPriorGroups(currentDraft);
  const assignments = previous.length === parsed.groups.length
    ? new Map(parsed.groups.map((_, index) => [index, previous[index]!.id]))
    : matchingSignatures(previous, parsed.groups);
  const used = new Set(assignments.values());
  const added: string[] = [];
  parsed.groups.forEach((group, index) => {
    let clueId = assignments.get(index);
    if (!clueId) {
      clueId = nextClueId(used);
      added.push(clueId);
    }
    used.add(clueId);
    group.clueId = clueId;
  });

  const clues: Record<string, ClueDefinition> = {};
  const segmentsFromNodes = (nodes: readonly InlineNode[]): Segment[] => mergeTextSegments(nodes.map((node): Segment => {
    if (node.type === "text") return node.value;
    if (node.type === "arrow") return node.direction === "left" ? "←" : "→";
    if (node.type === "answer-separator") return "=";
    if (node.type === "alternative-separator") return "|";
    const reference: ReferenceSegment = { ref: node.clueId! };
    if (!node.rightPrompt && node.direction) reference.direction = node.direction;
    return reference;
  }));

  for (const group of parsed.groups) {
    const clueId = group.clueId!;
    const prior = currentDraft.clues[clueId];
    clues[clueId] = {
      ...cloneClueMetadata(prior),
      answer: group.answer ?? "",
      prompt: segmentsFromNodes(group.prompt),
      ...(group.rightPrompt ? { rightPrompt: segmentsFromNodes(group.rightPrompt) } : {})
    };
  }
  const root = segmentsFromNodes(parsed.nodes);
  const finalText = root.map((segment) => typeof segment === "string" ? segment : clues[segment.ref]?.answer ?? "").join("");
  const selectedClueId = added.at(0) ?? (
    currentDraft.selectedClueId && Object.hasOwn(clues, currentDraft.selectedClueId)
      ? currentDraft.selectedClueId
      : parsed.groups.at(0)?.clueId ?? null
  );
  return {
    ...structuredClone(currentDraft),
    finalText,
    root,
    clues,
    selectedClueId
  };
}

function formatParsedNodes(nodes: readonly InlineNode[]): string {
  return nodes.map((node) => {
    if (node.type === "text") return escapeLiteral(node.value);
    if (node.type === "arrow") return node.direction === "left" ? "←" : "→";
    if (node.type === "answer-separator") return "=";
    if (node.type === "alternative-separator") return "|";
    return `[${formatParsedNodes(node.raw)}]`;
  }).join("");
}

export function inlineGroupRemovalText(group: InlineGroupNode, draft: Pick<AuthorDraft, "clues">): string {
  const answer = group.clueId ? draft.clues[group.clueId]?.answer : group.answer;
  if (answer) return escapeLiteral(answer);
  if (group.rightPrompt) return `${formatParsedNodes(group.prompt)} ${formatParsedNodes(group.rightPrompt)}`;
  return formatParsedNodes(group.prompt);
}

export function replaceInlineGroup(
  source: string,
  group: InlineGroupNode,
  draft: Pick<AuthorDraft, "clues">
): { source: string; caret: number } {
  const replacement = inlineGroupRemovalText(group, draft);
  return {
    source: `${source.slice(0, group.start)}${replacement}${source.slice(group.end)}`,
    caret: group.start + replacement.length
  };
}

export function renderAuthorInlinePreview(container: HTMLElement, parsed: InlineParseResult, {
  selectedClueId = null,
  onSelect = () => {},
  onRemove = () => {}
}: {
  readonly selectedClueId?: string | null;
  readonly onSelect?: (group: InlineGroupNode) => void;
  readonly onRemove?: (group: InlineGroupNode) => void;
} = {}): HTMLElement {
  const document = container.ownerDocument;
  const appendArrow = (target: Node, direction: Direction): void => {
    const arrow = document.createElement("span");
    arrow.className = "author-inline-arrow";
    arrow.textContent = direction === "left" ? "←" : "→";
    arrow.setAttribute("aria-hidden", "true");
    target.appendChild(arrow);
  };
  const appendAnswerGap = (target: Node): void => {
    const gap = document.createElement("span");
    gap.className = "author-inline-answer-slot";
    gap.dataset.testid = "author-inline-answer-slot";
    gap.setAttribute("role", "img");
    gap.setAttribute("aria-label", "respuesta en blanco");
    gap.textContent = "___";
    target.appendChild(gap);
  };
  const renderNodes = (target: Node, nodes: readonly InlineNode[]): void => {
    for (const node of nodes) {
      if (node.type === "text") {
        target.appendChild(document.createTextNode(node.value));
        continue;
      }
      if (node.type === "arrow") {
        appendArrow(target, node.direction);
        continue;
      }
      if (node.type === "answer-separator" || node.type === "alternative-separator") {
        target.appendChild(document.createTextNode(node.type === "answer-separator" ? "=" : "|"));
        continue;
      }
      const group = document.createElement("span");
      const groupNumber = parsed.groups.indexOf(node) + 1;
      group.className = `author-inline-group${node.clueId === selectedClueId ? " is-selected" : ""}`;
      group.dataset.depth = String(node.depth);
      group.dataset.tone = String(node.depth % 4);
      group.dataset.testid = "author-inline-group";
      group.style.setProperty("--group-depth", String(node.depth));
      if (node.clueId) group.dataset.clueId = node.clueId;
      group.setAttribute("role", "group");
      group.setAttribute("aria-label", `Grupo ${groupNumber}`);
      group.addEventListener("click", (event) => {
        event.stopPropagation();
        onSelect(node);
      });
      const select = document.createElement("button");
      select.className = "author-inline-select";
      select.type = "button";
      select.textContent = String(groupNumber);
      select.setAttribute("aria-label", `Editar grupo ${groupNumber}`);
      select.addEventListener("click", (event) => {
        event.stopPropagation();
        onSelect(node);
      });
      const open = document.createElement("span");
      open.className = "author-inline-edge";
      open.textContent = "[";
      open.setAttribute("aria-hidden", "true");
      const contents = document.createElement("span");
      contents.className = "author-inline-group-contents";
      if (node.rightPrompt) {
        renderNodes(contents, node.prompt);
        appendArrow(contents, "right");
        appendAnswerGap(contents);
        appendArrow(contents, "left");
        renderNodes(contents, node.rightPrompt);
      } else if (node.direction === "left") {
        appendAnswerGap(contents);
        appendArrow(contents, "left");
        renderNodes(contents, node.prompt);
      } else {
        renderNodes(contents, node.prompt);
        if (node.direction === "right") {
          appendArrow(contents, "right");
          appendAnswerGap(contents);
        }
      }
      const close = document.createElement("span");
      close.className = "author-inline-edge";
      close.textContent = "]";
      close.setAttribute("aria-hidden", "true");
      const remove = document.createElement("button");
      remove.className = "author-inline-remove";
      remove.type = "button";
      remove.textContent = "×";
      remove.setAttribute("aria-label", `Quitar grupo ${groupNumber}`);
      remove.dataset.testid = "author-inline-remove";
      remove.addEventListener("click", (event) => {
        event.stopPropagation();
        onRemove(node);
      });
      group.append(select, open, contents, close, remove);
      target.appendChild(group);
    }
  };
  container.replaceChildren();
  renderNodes(container, parsed.nodes);
  return container;
}
