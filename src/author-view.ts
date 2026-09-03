import {
  AUTHOR_STORAGE_KEY,
  AuthoringError,
  authorDraftFromDefinition,
  createAuthorDraft,
  removeClue,
  replaceLiteralSelection,
  restoreAuthorDraft,
  selectClue,
  serializeAuthorDraft,
  serializeAuthorPuzzle,
  setFinalText,
  setReferenceDirection,
  setRightPrompt,
  updateClue,
  updateLiteral,
  updateMetadata,
  validateAuthorDraft
} from "./author.ts";
import {
  draftFromAuthorInlineParse,
  formatAuthorDraftAsInlineSource,
  parseAuthorInlineSource,
  renderAuthorInlinePreview,
  replaceInlineGroup
} from "./author-inline.ts";
import { mapAuthorPreviewSelection, renderAuthorPreview } from "./author-preview.ts";
import { formatMessage } from "./view.ts";
import type { InlineGroupNode, InlineParseResult } from "./author-inline.ts";
import type {
  AuthorDraft,
  ExistingPuzzle,
  ExistingSuggestion,
  ImportResult,
  LocalePack,
  PuzzleDefinition,
  ReferenceSegment,
  Segment,
  StorageLike,
  ValidationResult
} from "./types.ts";

interface ElementOptions {
  readonly className?: string | undefined;
  readonly text?: unknown;
  readonly attributes?: Readonly<Record<string, unknown>> | undefined;
}

interface AuthorMount extends HTMLElement {
  __nexoAuthorDestroy?: (() => void) | undefined;
}

interface PreviewSelection {
  readonly owner: string;
  readonly segmentIndex: number;
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

interface StartAuthorAppOptions {
  readonly mount?: AuthorMount | null | undefined;
  readonly locale?: LocalePack | undefined;
  readonly storage?: StorageLike | null | undefined;
  readonly existingPuzzles?: ExistingPuzzle[] | undefined;
  readonly suggestions?: ExistingSuggestion[] | undefined;
  readonly onPublish?: ((definition: PuzzleDefinition, options: {
    readonly overwrite: boolean;
    readonly suggestionId?: number;
  }) => unknown) | null | undefined;
  readonly onSubmitSuggestion?: ((definition: PuzzleDefinition) => unknown) | null | undefined;
  readonly onRejectSuggestion?: ((suggestionId: number) => unknown) | null | undefined;
  readonly onDeletePuzzle?: ((date: string) => unknown) | null | undefined;
  readonly onRestorePuzzle?: ((date: string) => unknown) | null | undefined;
  readonly legacyPuzzles?: PuzzleDefinition[] | undefined;
  readonly onImportLegacy?: (() => Promise<ImportResult[]>) | null | undefined;
  readonly currentDate?: string | null | undefined;
  readonly pageUrl?: string | null | undefined;
  readonly suggestionUrl?: string | null | undefined;
  readonly acceptingNewPuzzles?: boolean | undefined;
  readonly puzzleLimit?: number | null | undefined;
  readonly variant?: "author" | "suggestion" | undefined;
  readonly flow?: "classic" | "inline" | undefined;
  readonly skin?: AuthorPanelSkin | undefined;
}

export type AuthorPanelSkin = "plain" | "lab" | "blueprint" | "cards";

export interface AuthorAppHandle {
  readonly getDraft: () => AuthorDraft;
  readonly render: () => void;
  readonly destroy: () => void;
}

export const SUGGESTION_STORAGE_KEY = "nested-clue:suggestion:v1";
export const AUTHOR_INLINE_STORAGE_KEY = "nested-clue:author-inline:v2";
export const SUGGESTION_INLINE_STORAGE_KEY = "nested-clue:suggestion-inline:v2";
const REVIEW_SUGGESTION_STORAGE_KEY = "nested-clue:review-suggestion:v1";
const INLINE_BASE_STORAGE_SUFFIX = ":base";

function errorMessage(error: unknown): string {
  if (error !== null && typeof error === "object") {
    const value = error as { readonly code?: unknown; readonly message?: unknown };
    const message = typeof value.message === "string" ? value.message : String(error);
    return typeof value.code === "string" ? `${value.code}: ${message}` : message;
  }
  return String(error);
}

function element<K extends keyof HTMLElementTagNameMap>(tagName: K, options: ElementOptions = {}): HTMLElementTagNameMap[K] {
  const node = document.createElement(tagName);
  if (options.className) node.className = options.className;
  if (options.text !== undefined) node.textContent = String(options.text ?? "");
  if (options.attributes) {
    for (const [name, value] of Object.entries(options.attributes)) {
      if (value !== undefined && value !== null) node.setAttribute(name, String(value));
    }
  }
  return node;
}

function field(labelText: unknown, control: HTMLElement, helpText: unknown = ""): HTMLDivElement {
  const wrapper = element("div", { className: "author-field" });
  const label = element("label", { className: "author-label", text: labelText });
  if (control.id) label.htmlFor = control.id;
  wrapper.append(label, control);
  if (helpText) wrapper.append(element("p", { className: "author-help", text: helpText }));
  return wrapper;
}

function isReference(segment: unknown): segment is ReferenceSegment {
  return segment !== null && typeof segment === "object" && typeof (segment as Record<string, unknown>).ref === "string";
}

function incomingReference(draft: AuthorDraft, clueId: string): {
  readonly owner: string;
  readonly segmentIndex: number;
  readonly segment: ReferenceSegment;
} | null {
  const owners: Array<[string, Segment[]]> = [["root", draft.root]];
  for (const [id, clue] of Object.entries(draft.clues)) {
    owners.push([id, clue.prompt]);
    if (Array.isArray(clue.rightPrompt)) owners.push([`${id}:right`, clue.rightPrompt]);
  }
  for (const [owner, segments] of owners) {
    const segmentIndex = segments.findIndex((segment) => isReference(segment) && segment.ref === clueId);
    if (segmentIndex >= 0) return { owner, segmentIndex, segment: segments[segmentIndex] as ReferenceSegment };
  }
  return null;
}

function treeChildren(draft: AuthorDraft, owner: string): string[] {
  const clue = draft.clues[owner];
  const segments = owner === "root"
    ? draft.root
    : [...(clue?.prompt ?? []), ...(clue?.rightPrompt ?? [])];
  return segments.filter(isReference).map((segment) => segment.ref);
}

function segmentsForOwner(draft: AuthorDraft, owner: string): Segment[] | undefined {
  if (owner === "root") return draft.root;
  const rightSide = owner.endsWith(":right");
  const clueId = rightSide ? owner.slice(0, -":right".length) : owner;
  return rightSide ? draft.clues[clueId]?.rightPrompt : draft.clues[clueId]?.prompt;
}

function downloadJson(filename: string, contents: string): boolean {
  const urlApi = globalThis.URL;
  if (!urlApi?.createObjectURL) return false;
  const url = urlApi.createObjectURL(new Blob([contents], { type: "application/json;charset=utf-8" }));
  const link = element("a", { attributes: { href: url, download: filename } });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => urlApi.revokeObjectURL(url), 0);
  return true;
}

export function startAuthorApp(options: StartAuthorAppOptions & {
  readonly mount: AuthorMount;
  readonly locale: LocalePack;
}): AuthorAppHandle;
export function startAuthorApp(options?: StartAuthorAppOptions): AuthorAppHandle | null;
export function startAuthorApp({
  mount: mountOption = document.querySelector<AuthorMount>("#app"),
  locale: localeOption,
  storage,
  existingPuzzles = [],
  suggestions = [],
  onPublish = null,
  onSubmitSuggestion = null,
  onRejectSuggestion = null,
  onDeletePuzzle = null,
  onRestorePuzzle = null,
  legacyPuzzles = [],
  onImportLegacy = null,
  currentDate = null,
  pageUrl = null,
  suggestionUrl = null,
  acceptingNewPuzzles: acceptingNewPuzzlesOption = true,
  puzzleLimit = null,
  variant = "author",
  flow = "classic",
  skin
}: StartAuthorAppOptions = {}): AuthorAppHandle | null {
  if (!mountOption || !localeOption) return null;
  const mount = mountOption;
  const locale = localeOption;
  const createBlankDraft = (): AuthorDraft => {
    if (variant !== "suggestion") return createAuthorDraft();
    const random = globalThis.crypto?.randomUUID?.().replace(/-/gu, "").slice(0, 12)
      ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    return createAuthorDraft({
      id: `sugerencia-${random}`,
      title: locale.ui.suggestionDefaultTitle ?? "Propuesta"
    });
  };

  let operationError = "";
  let liveMessage = "";
  let publishedDate: string | null = null;
  let savedDate: string | null = null;
  let publishing = false;
  let importing = false;
  let deletingPuzzle = false;
  let restoringPuzzle = false;
  let activeSuggestionId: number | null = null;
  let activePuzzleDate: string | null = null;
  let lastTrashedPuzzle: ExistingPuzzle | null = null;
  let submittedSuggestionId: number | null = null;
  let legacyImportComplete = false;
  let acceptingNewPuzzles = acceptingNewPuzzlesOption;
  const knownPuzzleDates = new Set(existingPuzzles.map((item) => item.date));
  const additionsPaused = (): boolean => {
    if (!acceptingNewPuzzles) return true;
    if (!Number.isSafeInteger(puzzleLimit) || puzzleLimit === null || puzzleLimit < 1) return false;
    return existingPuzzles.length + suggestions.length >= puzzleLimit;
  };
  let storageTarget: StorageLike | null | undefined = storage;
  let storageUnavailable = false;
  let serializedDraft: string | null = null;
  let serializedReviewSuggestionId: string | null = null;
  let serializedInlineSource: string | null = null;
  let serializedInlineBase: string | null = null;
  const storageKey = variant === "suggestion" ? SUGGESTION_STORAGE_KEY : AUTHOR_STORAGE_KEY;
  const inlineStorageKey = variant === "suggestion" ? SUGGESTION_INLINE_STORAGE_KEY : AUTHOR_INLINE_STORAGE_KEY;
  try {
    if (storageTarget === undefined) storageTarget = globalThis.localStorage;
    serializedDraft = storageTarget?.getItem?.(storageKey) ?? null;
    if (flow === "inline") {
      serializedInlineSource = storageTarget?.getItem?.(inlineStorageKey) ?? null;
      serializedInlineBase = storageTarget?.getItem?.(`${inlineStorageKey}${INLINE_BASE_STORAGE_SUFFIX}`) ?? null;
    }
    if (variant === "author") {
      serializedReviewSuggestionId = storageTarget?.getItem?.(REVIEW_SUGGESTION_STORAGE_KEY) ?? null;
    }
  } catch {
    storageTarget = null;
    storageUnavailable = true;
    operationError = locale.ui.authorStorageError ?? "";
  }
  let draft = restoreAuthorDraft(serializedDraft, createBlankDraft());
  const restoredDraftSource = formatAuthorDraftAsInlineSource(draft);
  let inlineSource = serializedInlineBase === restoredDraftSource && serializedInlineSource !== null
    ? serializedInlineSource
    : restoredDraftSource;
  let inlineParse: InlineParseResult = parseAuthorInlineSource(inlineSource);
  let inlineStyle: "layers" | "marker" | "blueprint" = "layers";
  let inlineStyleControls: HTMLElement | null = null;
  if (flow === "inline" && inlineParse.issues.length === 0) {
    draft = draftFromAuthorInlineParse(draft, inlineParse);
  }
  const restoredSuggestionId = Number(serializedReviewSuggestionId);
  if (Number.isSafeInteger(restoredSuggestionId) && suggestions.some(
    (item) => item.metadata.suggestionId === restoredSuggestionId
  )) {
    activeSuggestionId = restoredSuggestionId;
  }
  let previewSelection: PreviewSelection | null = null;
  const panelSkin: AuthorPanelSkin = skin ?? (flow === "inline" ? "lab" : "plain");
  let styleOptionsOpen = new URL(globalThis.location?.href ?? pageUrl ?? document.baseURI, document.baseURI)
    .searchParams.get("styles") === "open";

  const setStyleOptionsOpen = (open: boolean): void => {
    styleOptionsOpen = open;
    const target = new URL(globalThis.location?.href ?? pageUrl ?? document.baseURI, document.baseURI);
    if (open) target.searchParams.set("styles", "open");
    else target.searchParams.delete("styles");
    if (typeof globalThis.history?.replaceState === "function") {
      globalThis.history.replaceState(null, "", target.href);
    }
  };

  const resetInlineSourceFromDraft = (): void => {
    if (flow !== "inline") return;
    inlineSource = formatAuthorDraftAsInlineSource(draft);
    inlineParse = parseAuthorInlineSource(inlineSource);
    draft = draftFromAuthorInlineParse(draft, inlineParse);
  };

  const playHref = () => {
    if (!pageUrl) return publishedDate ? `?date=${encodeURIComponent(publishedDate)}` : "./";
    const target = new URL(pageUrl, document.baseURI);
    target.searchParams.delete("mode");
    target.searchParams.delete("date");
    target.searchParams.delete("suggestion_key");
    if (publishedDate) target.searchParams.set("date", publishedDate);
    return target.href;
  };

  const flowHref = (targetFlow: "classic" | "inline"): string => {
    const target = new URL(globalThis.location?.href ?? pageUrl ?? document.baseURI, document.baseURI);
    target.searchParams.set("mode", variant === "suggestion" ? "suggest" : "author");
    if (targetFlow === "inline") target.searchParams.set("flow", "inline");
    else target.searchParams.delete("flow");
    target.searchParams.set("skin", panelSkin);
    return target.href;
  };

  const skinHref = (targetSkin: AuthorPanelSkin): string => {
    const target = new URL(globalThis.location?.href ?? pageUrl ?? document.baseURI, document.baseURI);
    target.searchParams.set("mode", variant === "suggestion" ? "suggest" : "author");
    if (flow === "inline") target.searchParams.set("flow", "inline");
    else target.searchParams.delete("flow");
    target.searchParams.set("skin", targetSkin);
    return target.href;
  };

  const draftLiteral = ({ owner, segmentIndex }: { readonly owner: string; readonly segmentIndex: number }): string | null => {
    const segments = segmentsForOwner(draft, owner);
    return Array.isArray(segments) && typeof segments[segmentIndex] === "string" ? segments[segmentIndex] : null;
  };

  const updateSelectionControls = () => {
    const convert = mount.querySelector<HTMLButtonElement>('[data-testid="author-convert-selection"]');
    const summary = mount.querySelector<HTMLElement>('[data-testid="author-selection-summary"]');
    if (convert) convert.disabled = previewSelection === null;
    if (summary) summary.textContent = previewSelection
      ? formatMessage(locale.ui.authorSelectionReady, { selection: previewSelection.text })
      : "";
  };

  const clearPreviewSelection = ({ clearBrowserSelection = false }: { readonly clearBrowserSelection?: boolean } = {}): void => {
    previewSelection = null;
    if (clearBrowserSelection) {
      const selection = document.getSelection?.();
      const isPreviewNode = (node: Node | null): boolean => {
        const target = node?.nodeType === 1 ? node as Element : node?.parentElement;
        return Boolean(target?.closest('[data-testid="author-structure-preview"]'));
      };
      if (selection && (isPreviewNode(selection.anchorNode) || isPreviewNode(selection.focusNode))) {
        selection.removeAllRanges?.();
      }
    }
    updateSelectionControls();
  };

  const capturePreviewSelection = () => {
    const container = mount.querySelector<HTMLElement>('[data-testid="author-structure-preview"]');
    const selection = document.getSelection?.();
    const mapped = container ? mapAuthorPreviewSelection(selection, container) : null;
    if (mapped) {
      const literal = draftLiteral(mapped);
      if (literal !== null) {
        previewSelection = { ...mapped, text: literal.slice(mapped.start, mapped.end) };
      }
    } else {
      previewSelection = null;
    }
    updateSelectionControls();
  };

  const selectionChangeHandler = (): void => capturePreviewSelection();
  const focusInHandler = (event: FocusEvent): void => {
    const target = event.target as Element | null;
    if (target && typeof target.matches === "function" && target.matches("input, textarea, select")) {
      clearPreviewSelection({ clearBrowserSelection: true });
    }
  };
  mount.__nexoAuthorDestroy?.();
  document.addEventListener("selectionchange", selectionChangeHandler);
  mount.addEventListener("focusin", focusInHandler);
  const destroy = (): void => {
    document.removeEventListener("selectionchange", selectionChangeHandler);
    mount.removeEventListener("focusin", focusInHandler);
    if (mount.__nexoAuthorDestroy === destroy) delete mount.__nexoAuthorDestroy;
  };
  mount.__nexoAuthorDestroy = destroy;

  const persist = (): boolean => {
    if (storageUnavailable) {
      operationError = locale.ui.authorStorageError ?? "";
      return false;
    }
    try {
      storageTarget?.setItem?.(storageKey, serializeAuthorDraft(draft));
      if (flow === "inline") {
        storageTarget?.setItem?.(inlineStorageKey, inlineSource);
        storageTarget?.setItem?.(
          `${inlineStorageKey}${INLINE_BASE_STORAGE_SUFFIX}`,
          formatAuthorDraftAsInlineSource(draft)
        );
      }
      if (variant === "author") {
        if (activeSuggestionId === null) {
          if (typeof storageTarget?.removeItem === "function") storageTarget.removeItem(REVIEW_SUGGESTION_STORAGE_KEY);
          else storageTarget?.setItem?.(REVIEW_SUGGESTION_STORAGE_KEY, "");
        } else {
          storageTarget?.setItem?.(REVIEW_SUGGESTION_STORAGE_KEY, String(activeSuggestionId));
        }
      }
      return true;
    } catch {
      storageTarget = null;
      storageUnavailable = true;
      operationError = locale.ui.authorStorageError ?? "";
      return false;
    }
  };

  const captureVisibleEdits = (): void => {
    let next = draft;
    const id = mount.querySelector<HTMLInputElement>("#author-puzzle-id")?.value;
    const title = mount.querySelector<HTMLInputElement>("#author-title-input")?.value;
    const releaseDate = mount.querySelector<HTMLInputElement>("#author-release-date")?.value;
    const metadata: Partial<AuthorDraft["metadata"]> = {};
    if (id !== undefined) metadata.id = id;
    if (title !== undefined) metadata.title = title;
    if (releaseDate !== undefined) metadata.releaseDate = releaseDate;
    if (Object.keys(metadata).length > 0) next = updateMetadata(next, metadata);

    const finalInput = mount.querySelector<HTMLTextAreaElement>('[data-testid="author-final-text"]');
    const finalChanged = Object.keys(next.clues).length === 0 && finalInput && finalInput.value !== next.finalText;
    if (finalChanged) next = setFinalText(next, finalInput.value);

    for (const textarea of mount.querySelectorAll<HTMLTextAreaElement>(".author-literal[data-owner][data-segment-index]")) {
      const owner = textarea.dataset.owner;
      if (owner === undefined) continue;
      if (finalChanged && owner === "root") continue;
      const segmentIndex = Number(textarea.dataset.segmentIndex);
      const segments = segmentsForOwner(next, owner);
      if (Array.isArray(segments) && typeof segments[segmentIndex] === "string") {
        next = updateLiteral(next, { owner, segmentIndex, value: textarea.value });
      }
    }

    const answerInput = mount.querySelector<HTMLInputElement>('[data-testid="author-answer"]');
    if (answerInput && next.selectedClueId && next.clues[next.selectedClueId]) {
      const aliasesInput = mount.querySelector<HTMLTextAreaElement>("#author-aliases");
      const changes: { answer: string; accept?: string[] } = { answer: answerInput.value };
      if (aliasesInput) {
        changes.accept = aliasesInput.value.split(/\r?\n/u).map((value) => value.trim()).filter(Boolean);
      }
      next = updateClue(next, next.selectedClueId, changes);
    }
    draft = next;
  };

  const refreshPreview = (): void => {
    const preview = mount.querySelector<HTMLElement>('[data-testid="author-structure-preview"]');
    if (!preview) return;
    clearPreviewSelection({ clearBrowserSelection: true });
    renderAuthorPreview(preview, draft);
  };

  const persistInput = (): void => {
    operationError = "";
    if (!persist()) liveMessage = locale.ui.authorStorageError ?? "";
    const live = mount.querySelector<HTMLElement>('[data-testid="author-live"]');
    if (live) live.textContent = liveMessage;
  };

  const apply = (
    operation: () => AuthorDraft,
    message: string | undefined = locale.ui.authorDraftSaved,
    focusSelector: string | null = null
  ): void => {
    try {
      captureVisibleEdits();
      // Save field edits before a structural operation can fail. This keeps the
      // visible draft and the restored draft in the same state after an error.
      persist();
      draft = operation();
      resetInlineSourceFromDraft();
      operationError = "";
      liveMessage = message ?? "";
      if (!persist()) liveMessage = locale.ui.authorStorageError ?? "";
      render();
      if (focusSelector) {
        const focus = (): void => {
          const active = document.activeElement;
          if (active instanceof HTMLElement && mount.contains(active)) return;
          mount.querySelector<HTMLElement>(focusSelector)?.focus({ preventScroll: true });
        };
        if (globalThis.requestAnimationFrame) globalThis.requestAnimationFrame(focus);
        else setTimeout(focus, 0);
      }
    } catch (error) {
      operationError = errorMessage(error);
      liveMessage = operationError;
      render();
    }
  };

  const validateCurrentDraft = (): ValidationResult => {
    const validation = validateAuthorDraft(draft, locale);
    if (flow !== "inline" || inlineParse.issues.length === 0) return validation;
    return {
      valid: false,
      errors: [
        ...inlineParse.issues.map((issue) => ({
          code: issue.code,
          path: `inlineSource[${issue.offset}]`,
          message: issue.message
        })),
        ...validation.errors
      ],
      warnings: validation.warnings
    };
  };

  const prepareExport = (): string | null => {
    try {
      captureVisibleEdits();
      operationError = "";
      if (!persist()) liveMessage = locale.ui.authorStorageError ?? "";
      const validation = validateCurrentDraft();
      if (!validation.valid) {
        throw new AuthoringError("INVALID_DRAFT", "Correct validation errors before export.");
      }
      return serializeAuthorPuzzle(draft, locale);
    } catch (error) {
      operationError = errorMessage(error);
      liveMessage = operationError;
      render();
      return null;
    }
  };

  type BracketFormat = "plain" | "right" | "left" | "both";
  interface BracketSyntax {
    readonly format: BracketFormat;
    readonly left: string;
    readonly answer: string;
    readonly right?: string;
  }

  const resolvedSegmentsText = (segments: readonly Segment[]): string => segments.map((segment) => {
    if (typeof segment === "string") return segment;
    return draft.clues[segment.ref]?.answer || "…";
  }).join("").replace(/\s+/gu, " ").trim() || "…";

  const clueBracketSyntax = (clueId: string, reference?: ReferenceSegment): BracketSyntax => {
    const clue = draft.clues[clueId];
    if (!clue) return { format: "plain", left: "…", answer: "…" };
    const incoming = reference ?? incomingReference(draft, clueId)?.segment;
    return {
      format: Array.isArray(clue.rightPrompt) ? "both" : incoming?.direction ?? "plain",
      left: resolvedSegmentsText(clue.prompt),
      answer: clue.answer || "…",
      ...(Array.isArray(clue.rightPrompt) ? { right: resolvedSegmentsText(clue.rightPrompt) } : {})
    };
  };

  const renderBracketSyntax = ({ format, left, answer, right = "pista" }: BracketSyntax, className = ""): HTMLElement => {
    const syntax = element("code", {
      className: `author-bracket-syntax${className ? ` ${className}` : ""}`,
      attributes: { "data-bracket-format": format }
    });
    const edge = (text: string) => element("span", { className: "author-syntax-edge", text });
    const clue = (text: string) => element("span", { className: "author-syntax-clue", text });
    const answerToken = element("span", { className: "author-syntax-answer", text: answer });
    syntax.append(edge("["));
    if (format === "left") {
      syntax.append(answerToken, edge("←"), clue(left));
    } else {
      syntax.append(clue(left), edge(format === "plain" ? "=" : "→"), answerToken);
      if (format === "both") syntax.append(edge("←"), clue(right));
    }
    syntax.append(edge("]"));
    return syntax;
  };

  const createTreeButton = (clueId: string, depth = 0): HTMLLIElement => {
    const item = element("li", { className: "author-tree-item" });
    const clue = draft.clues[clueId];
    if (!clue) throw new AuthoringError("UNKNOWN_CLUE", `Unknown clue '${clueId}'.`);
    const button = element("button", {
      className: `author-tree-button${draft.selectedClueId === clueId ? " is-selected" : ""}`,
      attributes: {
        type: "button",
        "data-clue-id": clueId,
        "aria-current": draft.selectedClueId === clueId ? "true" : undefined,
        style: `--tree-depth:${depth}`
      }
    });
    button.append(renderBracketSyntax(clueBracketSyntax(clueId), "author-tree-syntax"));
    button.addEventListener("click", () => apply(() => selectClue(draft, clueId), locale.ui.authorClueSelected));
    item.append(button);
    const children = treeChildren(draft, clueId);
    if (children.length) {
      const list = element("ul", { className: "author-tree" });
      for (const childId of children) list.append(createTreeButton(childId, depth + 1));
      item.append(list);
    }
    return item;
  };

  const createSegmentEditor = (
    owner: string,
    segments: Segment[],
    heading: string | undefined,
    visibleLabel: string | undefined = ""
  ): HTMLElement => {
    const section = element("section", {
      className: "author-segments",
      attributes: { "aria-label": heading, "data-owner": owner }
    });

    if (visibleLabel) section.append(element("p", { className: "author-side-label", text: visibleLabel }));
    const list = element("div", { className: "segment-list" });
    segments.forEach((segment, segmentIndex) => {
      const redundantBoundaryLiteral = typeof segment === "string"
        && segment.trim().length === 0
        && segments.length > 1
        && (segmentIndex === 0 || segmentIndex === segments.length - 1);
      if (redundantBoundaryLiteral) return;
      const row = element("div", {
        className: `segment-row segment-row--${typeof segment === "string" ? "literal" : "reference"}`,
        attributes: { "data-segment-index": segmentIndex }
      });
      if (typeof segment === "string") {
        const inputId = `literal-${owner}-${segmentIndex}`;
        const textarea = element("textarea", {
          className: "author-input author-literal",
          attributes: {
            id: inputId,
            rows: "2",
            spellcheck: "false",
            "data-owner": owner,
            "data-segment-index": segmentIndex,
            "data-testid": `${owner}-literal-${segmentIndex}`,
            "aria-label": `${locale.ui.authorLiteral} ${segmentIndex + 1}`
          }
        });
        textarea.value = segment;
        textarea.addEventListener("input", () => {
          draft = updateLiteral(draft, { owner, segmentIndex, value: textarea.value });
          persistInput();
          refreshPreview();
          refreshDerivedPanels();
        });
        row.append(textarea);
      } else {
        const clue = draft.clues[segment.ref];
        const chip = element("button", {
          className: "reference-chip",
          attributes: { type: "button", "data-reference": segment.ref }
        });
        if (clue) chip.append(renderBracketSyntax(clueBracketSyntax(segment.ref, segment), "reference-chip-syntax"));
        else chip.append(renderBracketSyntax({ format: "plain", left: "…", answer: "?" }, "reference-chip-syntax"));
        chip.addEventListener("click", () => apply(() => selectClue(draft, segment.ref), locale.ui.authorClueSelected));
        row.append(chip);
      }
      list.append(row);
    });
    section.append(list);
    return section;
  };

  const renderMetadata = (): HTMLElement => {
    const section = element("section", { className: "author-panel" });
    section.append(element("h2", { className: "author-panel-title", text: locale.ui.authorPuzzleDetails }));
    const grid = element("div", { className: "author-field-grid" });
    const idInput = element("input", {
      className: "author-input",
      attributes: { id: "author-puzzle-id", type: "text", "data-testid": "author-puzzle-id" }
    });
    idInput.value = draft.metadata.id;
    const titleInput = element("input", {
      className: "author-input",
      attributes: { id: "author-title-input", type: "text" }
    });
    titleInput.value = draft.metadata.title;
    const releaseInput = element("input", {
      className: "author-input",
      attributes: { id: "author-release-date", type: "date" }
    });
    releaseInput.value = draft.metadata.releaseDate;
    if (variant === "author") grid.append(field(locale.ui.authorPuzzleId, idInput));
    grid.append(
      field(locale.ui.authorPuzzleTitle, titleInput),
      field(variant === "suggestion" ? locale.ui.suggestionRequestedDate : locale.ui.authorReleaseDate, releaseInput)
    );
    const syncMetadata = () => {
      draft = updateMetadata(draft, {
        id: idInput.value.trim(),
        title: titleInput.value,
        releaseDate: releaseInput.value
      });
      persistInput();
      refreshDerivedPanels();
    };
    idInput.addEventListener("input", syncMetadata);
    titleInput.addEventListener("input", syncMetadata);
    releaseInput.addEventListener("input", syncMetadata);
    section.append(grid);
    return section;
  };

  const renderExistingPuzzleLoader = (): HTMLElement | null => {
    if (!existingPuzzles.length && (!legacyPuzzles.length || typeof onImportLegacy !== "function")) return null;
    const section = element("section", {
      className: "author-panel author-load-panel author-load-panel--top",
      attributes: { "data-testid": "author-load-panel" }
    });
    if (existingPuzzles.length) section.append(element("h2", { className: "author-panel-title", text: locale.ui.authorLoadHeading }));
    const select = element("select", {
      className: "author-input",
      attributes: { id: "author-existing-puzzle", "data-testid": "author-existing-puzzle" }
    });
    select.append(element("option", { text: locale.ui.authorLoadPlaceholder, attributes: { value: "" } }));
    existingPuzzles.forEach((item, index) => {
      select.append(element("option", {
        text: `${item.date}\n${item.definition.title || item.definition.id}`,
        attributes: { value: String(index) }
      }));
    });
    const selectFrame = element("div", { className: "author-load-select" });
    const selectedLabel = element("span", {
      className: "author-load-selection is-placeholder",
      attributes: { "aria-hidden": "true", "data-testid": "author-existing-puzzle-label" }
    });
    const renderSelectedLabel = (): void => {
      const selected = select.value === "" ? null : existingPuzzles[Number(select.value)];
      selectedLabel.replaceChildren();
      selectedLabel.classList.toggle("is-placeholder", selected === null);
      if (!selected) {
        selectedLabel.textContent = locale.ui.authorLoadPlaceholder ?? "";
        return;
      }
      selectedLabel.append(
        element("span", { className: "author-load-date", text: selected.date }),
        element("span", { className: "author-load-title", text: selected.definition.title || selected.definition.id })
      );
    };
    selectFrame.append(select, selectedLabel);
    renderSelectedLabel();
    const load = element("button", {
      className: "author-button",
      text: locale.ui.authorLoadPuzzle,
      attributes: { type: "button", disabled: "", "data-testid": "author-load-existing" }
    });
    select.addEventListener("change", () => {
      renderSelectedLabel();
      load.disabled = select.value === "";
    });
    load.addEventListener("click", () => {
      if (select.value === "") return;
      if (globalThis.confirm?.(locale.ui.authorLoadConfirm) === false) return;
      const selected = existingPuzzles[Number(select.value)];
      if (!selected) return;
      apply(() => {
        activeSuggestionId = null;
        activePuzzleDate = selected.date;
        lastTrashedPuzzle = null;
        return authorDraftFromDefinition(selected.definition, locale);
      }, locale.ui.authorPuzzleLoaded);
    });
    if (existingPuzzles.length) {
      const controls = element("div", { className: "author-load-controls" });
      const loadField = element("div", { className: "author-field" });
      const loadLabel = element("label", { className: "author-label", text: locale.ui.authorLoadPuzzleLabel });
      loadLabel.htmlFor = select.id;
      loadField.append(loadLabel, selectFrame);
      controls.append(loadField, load);
      section.append(controls);
    }
    if (legacyPuzzles.length && typeof onImportLegacy === "function" && !legacyImportComplete) {
      const importButton = element("button", {
        className: "author-button author-button--quiet author-button--compact",
        text: importing
          ? locale.ui.authorImportingLegacy
          : formatMessage(locale.ui.authorImportLegacy, { count: legacyPuzzles.length }),
        attributes: {
          type: "button",
          disabled: importing ? "" : undefined,
          "data-testid": "author-import-legacy"
        }
      });
      importButton.addEventListener("click", async () => {
        if (importing) return;
        importing = true;
        operationError = "";
        liveMessage = locale.ui.authorImportingLegacy ?? "";
        render();
        try {
          const results = await onImportLegacy();
          const failed = results.filter((item) => !item.ok);
          if (failed.length) {
            throw new Error(formatMessage(locale.ui.authorImportLegacyFailed, { count: failed.length }));
          }
          legacyImportComplete = true;
          const importedCount = results.filter((item) => item.ok && !item.skipped).length;
          liveMessage = formatMessage(locale.ui.authorImportLegacyComplete, { count: importedCount });
        } catch (error) {
          operationError = errorMessage(error);
          liveMessage = operationError;
        } finally {
          importing = false;
          render();
        }
      });
      section.append(importButton);
    }
    return section;
  };

  const renderSuggestionLoader = (): HTMLElement | null => {
    if (variant !== "author" || suggestions.length === 0) return null;
    const section = element("section", {
      className: "author-panel author-load-panel",
      attributes: { "data-testid": "suggestion-review" }
    });
    section.append(element("h2", { className: "author-panel-title", text: locale.ui.suggestionReviewHeading }));
    const select = element("select", {
      className: "author-input",
      attributes: { id: "author-existing-suggestion", "data-testid": "author-existing-suggestion" }
    });
    select.append(element("option", { text: locale.ui.suggestionReviewPlaceholder, attributes: { value: "" } }));
    suggestions.forEach((item, index) => {
      const date = item.metadata.requestedDate ? ` · ${item.metadata.requestedDate}` : "";
      select.append(element("option", {
        text: `#${item.metadata.suggestionId} · ${item.metadata.title}${date}`,
        attributes: { value: String(index) }
      }));
    });
    const load = element("button", {
      className: "author-button",
      text: locale.ui.suggestionReviewLoad,
      attributes: { type: "button", disabled: "", "data-testid": "suggestion-load" }
    });
    const reject = element("button", {
      className: "author-button author-button--danger",
      text: locale.ui.suggestionReject,
      attributes: { type: "button", disabled: "", "data-testid": "suggestion-reject" }
    });
    select.addEventListener("change", () => {
      load.disabled = select.value === "";
      reject.disabled = select.value === "" || typeof onRejectSuggestion !== "function";
    });
    load.addEventListener("click", () => {
      const selected = suggestions[Number(select.value)];
      if (!selected) return;
      if (globalThis.confirm?.(locale.ui.suggestionReviewLoadConfirm) === false) return;
      apply(() => {
        const next = authorDraftFromDefinition({ ...selected.definition, revision: 1 }, locale);
        activeSuggestionId = selected.metadata.suggestionId;
        activePuzzleDate = null;
        lastTrashedPuzzle = null;
        return next;
      }, locale.ui.suggestionLoaded);
    });
    reject.addEventListener("click", async () => {
      const index = Number(select.value);
      const selected = suggestions[index];
      if (!selected || typeof onRejectSuggestion !== "function") return;
      if (globalThis.confirm?.(locale.ui.suggestionRejectConfirm) === false) return;
      try {
        reject.disabled = true;
        await onRejectSuggestion(selected.metadata.suggestionId);
        suggestions.splice(index, 1);
        acceptingNewPuzzles = true;
        if (activeSuggestionId === selected.metadata.suggestionId) {
          activeSuggestionId = null;
          activePuzzleDate = null;
          draft = createBlankDraft();
          resetInlineSourceFromDraft();
          persist();
        }
        liveMessage = locale.ui.suggestionRejected ?? "";
        operationError = "";
      } catch (error) {
        operationError = errorMessage(error);
        liveMessage = operationError;
      }
      render();
    });
    const controls = element("div", { className: "author-load-controls" });
    controls.append(field(locale.ui.suggestionReviewLabel, select), load, reject);
    section.append(controls);
    return section;
  };

  const renderStructurePreview = (): HTMLElement => {
    const preview = element("section", {
      className: "author-structure-preview",
      attributes: { "aria-label": locale.ui.authorPreview }
    });
    preview.append(element("h3", { className: "author-preview-title", text: locale.ui.authorPreview }));
    const puzzleText = element("p", {
      className: "puzzle-text author-preview-text",
      attributes: {
        tabindex: "0",
        "data-testid": "author-structure-preview"
      }
    });
    renderAuthorPreview(puzzleText, draft);
    const scheduleSelectionCapture = (): void => {
      if (globalThis.requestAnimationFrame) globalThis.requestAnimationFrame(capturePreviewSelection);
      else setTimeout(capturePreviewSelection, 0);
    };
    puzzleText.addEventListener("pointerup", scheduleSelectionCapture);
    puzzleText.addEventListener("touchend", scheduleSelectionCapture);
    puzzleText.addEventListener("keyup", scheduleSelectionCapture);

    const summary = element("span", {
      className: "author-selection-summary",
      attributes: { "data-testid": "author-selection-summary", "aria-live": "polite" }
    });
    const convert = element("button", {
      className: "author-button author-button--accent author-button--compact",
      text: locale.ui.authorConvertSelection,
      attributes: { type: "button", disabled: "", "data-testid": "author-convert-selection" }
    });
    convert.addEventListener("pointerdown", (event) => {
      if (previewSelection) event.preventDefault();
    });
    convert.addEventListener("click", () => {
      if (!previewSelection) return;
      const selected = { ...previewSelection };
      apply(() => {
        const literal = draftLiteral(selected);
        if (literal === null || literal.slice(selected.start, selected.end) !== selected.text) {
          throw new AuthoringError("STALE_SELECTION", "Select the text again in the preview.");
        }
        return replaceLiteralSelection(draft, selected).draft;
      }, locale.ui.authorClueCreated, "#author-answer");
    });
    const toolbar = element("div", { className: "author-selection-toolbar" });
    toolbar.append(summary, convert);
    preview.append(puzzleText, toolbar);
    return preview;
  };

  const restoreInlineEditorSelection = (start: number, end: number): void => {
    const restore = (): void => {
      const input = mount.querySelector<HTMLTextAreaElement>('[data-testid="author-inline-source"]');
      if (!input) return;
      input.focus({ preventScroll: true });
      input.setSelectionRange(start, end);
    };
    if (globalThis.requestAnimationFrame) globalThis.requestAnimationFrame(restore);
    else setTimeout(restore, 0);
  };

  const applyInlineSource = (source: string, selectionStart: number, selectionEnd = selectionStart): void => {
    captureVisibleEdits();
    inlineSource = source;
    inlineParse = parseAuthorInlineSource(inlineSource);
    if (inlineParse.issues.length === 0) {
      try {
        draft = draftFromAuthorInlineParse(draft, inlineParse);
        operationError = "";
        liveMessage = locale.ui.authorInlineParsed ?? "";
      } catch (error) {
        operationError = errorMessage(error);
        liveMessage = operationError;
      }
    } else {
      liveMessage = inlineParse.issues[0]!.message;
    }
    persist();
    render();
    restoreInlineEditorSelection(selectionStart, selectionEnd);
  };

  const renderInlineComposer = (): HTMLElement => {
    const section = element("section", {
      className: "author-panel author-inline-composer",
      attributes: { "data-testid": "author-inline-composer" }
    });
    section.append(
      element("h2", { className: "author-panel-title author-inline-title", text: locale.ui.authorInlineHeading }),
      element("p", { className: "author-inline-lede", text: locale.ui.authorInlineIntro })
    );
    const input = element("textarea", {
      className: "author-input author-inline-source",
      attributes: {
        id: "author-inline-source",
        rows: "6",
        spellcheck: "false",
        "data-testid": "author-inline-source",
        "aria-label": locale.ui.authorInlineSource,
        "aria-describedby": "author-inline-help"
      }
    });
    input.value = inlineSource;
    const resizeSource = (): void => {
      input.style.height = "auto";
      input.style.height = `${input.scrollHeight}px`;
    };
    input.addEventListener("input", () => {
      resizeSource();
      applyInlineSource(
        input.value,
        input.selectionStart ?? input.value.length,
        input.selectionEnd ?? input.value.length
      );
    });
    const help = element("p", {
      className: "author-help author-inline-help",
      text: locale.ui.authorInlineHelp,
      attributes: { id: "author-inline-help" }
    });

    const insertText = (value: string, wrapSelection = false): void => {
      const start = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? start;
      const selected = input.value.slice(start, end);
      const insertion = wrapSelection ? `[=${selected}]` : value;
      const nextSource = `${input.value.slice(0, start)}${insertion}${input.value.slice(end)}`;
      const caret = wrapSelection ? start + 1 : start + insertion.length;
      applyInlineSource(nextSource, caret);
    };
    const keyboard = element("div", {
      className: "author-inline-keyboard",
      attributes: { role: "group", "aria-label": locale.ui.authorInlineKeyboard }
    });
    for (const key of [
      { label: "[", value: "[", name: "open" },
      { label: "]", value: "]", name: "close" },
      { label: "=", value: "=", name: "answer" },
      { label: "←", value: "←", name: "left" },
      { label: "→", value: "→", name: "right" }
    ]) {
      const button = element("button", {
        className: "author-inline-key",
        text: key.label,
        attributes: { type: "button", "data-testid": `author-inline-key-${key.name}` }
      });
      button.addEventListener("pointerdown", (event) => event.preventDefault());
      button.addEventListener("click", () => insertText(key.value));
      keyboard.append(button);
    }
    const wrap = element("button", {
      className: "author-inline-key author-inline-key--wide",
      text: locale.ui.authorInlineWrap,
      attributes: { type: "button", "data-testid": "author-inline-key-wrap" }
    });
    wrap.addEventListener("pointerdown", (event) => event.preventDefault());
    wrap.addEventListener("click", () => insertText("", true));
    keyboard.append(wrap);

    const mapHeader = element("div", { className: "author-inline-map-header" });
    const mapTitle = element("div");
    mapTitle.append(
      element("h3", { className: "author-preview-title", text: locale.ui.authorInlineMap }),
      (() => {
        const groupCount = inlineParse.bracketCount;
        const groupDepth = inlineParse.bracketDepth;
        const status = element("p", {
          className: `author-inline-status${inlineParse.issues.length ? " is-invalid" : ""}`,
          attributes: inlineParse.issues.length ? { role: "alert", "data-testid": "author-inline-parse-error" } : {
            "data-testid": "author-inline-group-stats",
            "aria-label": groupCount > 0
              ? formatMessage(locale.ui.authorInlineGroupStatsLabel ?? "{count} grupos; profundidad máxima {depth}", {
                count: groupCount,
                depth: groupDepth
              })
              : `${groupCount} grupos`
          }
        });
        if (inlineParse.issues.length) {
          status.textContent = inlineParse.issues[0]!.message;
          return status;
        }
        status.append(element("span", {
          text: formatMessage(locale.ui.authorInlineGroupCount ?? "{count}", { count: groupCount }),
          attributes: { "data-testid": "author-inline-group-count" }
        }));
        if (groupCount > 0) {
          status.append(element("span", { text: " · ", attributes: { "aria-hidden": "true" } }));
          status.append(element("span", {
            text: groupDepth,
            attributes: { "data-testid": "author-inline-group-depth" }
          }));
        }
        return status;
      })()
    );
    const styles = element("div", {
      className: "author-inline-styles",
      attributes: {
        role: "group",
        "aria-label": locale.ui.authorInlineStyleLabel,
        "data-testid": "author-inline-styles"
      }
    });
    for (const [value, label] of [
      ["layers", locale.ui.authorInlineStyleLayers],
      ["marker", locale.ui.authorInlineStyleMarker],
      ["blueprint", locale.ui.authorInlineStyleBlueprint]
    ] as const) {
      const style = element("button", {
        className: `author-inline-style${inlineStyle === value ? " is-selected" : ""}`,
        text: label,
        attributes: { type: "button", "aria-pressed": inlineStyle === value ? "true" : "false" }
      });
      style.addEventListener("click", () => {
        inlineStyle = value;
        const canvas = mount.querySelector<HTMLElement>('[data-testid="author-inline-map"]');
        if (!canvas) return;
        canvas.className = `author-inline-map author-inline-map--${inlineStyle}`;
        for (const button of styles.querySelectorAll<HTMLButtonElement>(".author-inline-style")) {
          const selected = button === style;
          button.classList.toggle("is-selected", selected);
          button.setAttribute("aria-pressed", String(selected));
        }
      });
      styles.append(style);
    }
    const inlineStylePicker = element("div", { className: "author-inline-style-picker" });
    inlineStylePicker.append(
      element("span", { className: "author-control-label", text: locale.ui.authorInlineStyleLabel }),
      styles
    );
    inlineStyleControls = inlineStylePicker;
    mapHeader.append(mapTitle);
    const map = element("div", {
      className: `author-inline-map author-inline-map--${inlineStyle}`,
      attributes: { "data-testid": "author-inline-map" }
    });
    renderAuthorInlinePreview(map, inlineParse, {
      selectedClueId: draft.selectedClueId,
      onSelect(group) {
        if (!group.clueId) return;
        apply(() => selectClue(draft, group.clueId!), locale.ui.authorClueSelected);
      },
      onRemove(group) {
        const next = replaceInlineGroup(inlineSource, group, draft);
        applyInlineSource(next.source, next.caret);
      }
    });
    if (inlineParse.groups.length === 0 && inlineParse.issues.length === 0) {
      map.append(element("span", { className: "author-inline-placeholder", text: locale.ui.authorInlineEmpty }));
    }
    section.append(input, help, keyboard, mapHeader, map);
    if (globalThis.requestAnimationFrame) globalThis.requestAnimationFrame(resizeSource);
    else setTimeout(resizeSource, 0);
    return section;
  };

  const renderFinalText = (): HTMLElement => {
    const section = element("section", { className: "author-panel" });
    section.append(element("h2", { className: "author-panel-title", text: locale.ui.authorFinalHeading }));
    const finalInput = element("textarea", {
      className: "author-input author-final-input",
      attributes: {
        id: "author-final-text",
        rows: "3",
        "data-testid": "author-final-text",
        readonly: Object.keys(draft.clues).length ? "" : undefined
      }
    });
    finalInput.value = draft.finalText;
    finalInput.addEventListener("input", () => {
      if (Object.keys(draft.clues).length) return;
      draft = setFinalText(draft, finalInput.value);
      persistInput();
      refreshPreview();
      refreshDerivedPanels();
    });
    const bracketGuide = element("section", {
      className: "author-bracket-guide",
      attributes: { "aria-label": locale.ui.authorBracketGuideHeading, "data-testid": "author-bracket-guide" }
    });
    bracketGuide.append(
      element("h3", { text: locale.ui.authorBracketGuideHeading }),
      element("p", { text: locale.ui.authorBracketGuideHelp })
    );
    const examples = element("div", { className: "author-bracket-examples" });
    for (const format of [
      "[pista=respuesta]",
      "[pista→respuesta]",
      "[respuesta←pista]",
      "[pista izquierda→respuesta←pista derecha]"
    ]) {
      examples.append(element("code", { className: "author-bracket-example", text: format }));
    }
    bracketGuide.append(examples);
    section.append(field(locale.ui.authorFinalText, finalInput), bracketGuide, renderStructurePreview());
    return section;
  };

  const renderTree = (): HTMLElement => {
    const section = element("section", { className: "author-panel author-tree-panel", attributes: { "data-testid": "author-tree-panel" } });
    section.append(element("h2", { className: "author-panel-title", text: locale.ui.authorTree }));
    section.append(element("p", { className: "author-tree-help", text: locale.ui.authorTreeHelp }));
    const rootChildren = treeChildren(draft, "root");
    if (!rootChildren.length) {
      section.append(element("p", { className: "author-empty", text: locale.ui.authorTreeEmpty }));
      return section;
    }
    const list = element("ul", { className: "author-tree author-tree--root" });
    for (const clueId of rootChildren) list.append(createTreeButton(clueId));
    section.append(list);
    return section;
  };

  const renderInlineInspector = (): HTMLElement | null => {
    const clueId = draft.selectedClueId;
    if (!clueId) return null;
    const clue = draft.clues[clueId];
    const group = inlineParse.groups.find((candidate) => candidate.clueId === clueId);
    if (!clue || !group) return null;
    const groupNumber = inlineParse.groups.indexOf(group) + 1;
    const section = element("section", {
      className: "author-panel author-inline-inspector",
      attributes: { "data-testid": "author-inline-inspector" }
    });
    const heading = element("div", { className: "author-inline-inspector-heading" });
    const identity = element("div");
    identity.append(
      element("span", {
        className: "author-experiment-label",
        text: formatMessage(locale.ui.authorInlineGroupLabel, { number: groupNumber })
      }),
      element("h2", {
        className: "author-panel-title",
        text: clue.answer || locale.ui.authorUntitledClue
      })
    );
    const direction = Array.isArray(clue.rightPrompt)
      ? locale.ui.authorInlineDirectionBoth
      : group.direction === "left"
        ? locale.ui.authorInlineDirectionLeft
        : group.direction === "right"
          ? locale.ui.authorInlineDirectionRight
          : locale.ui.authorInlineDirectionNone;
    heading.append(identity, element("span", { className: "author-inline-direction", text: direction }));

    const remove = element("button", {
      className: "author-button author-button--danger author-button--compact",
      text: locale.ui.authorInlineRemoveGroup,
      attributes: { type: "button", "data-testid": "author-inline-remove-selected" }
    });
    remove.addEventListener("click", () => {
      const next = replaceInlineGroup(inlineSource, group, draft);
      applyInlineSource(next.source, next.caret);
    });
    section.append(
      heading,
      remove
    );
    return section;
  };

  const renderInspector = (): HTMLElement | null => {
    const clueId = draft.selectedClueId;
    if (clueId === null) return null;
    const clue = draft.clues[clueId];
    if (!clue) return null;
    const section = element("section", {
      className: "author-panel author-guided-inspector",
      attributes: { "data-testid": "clue-inspector" }
    });

    const answerInput = element("input", {
      className: "author-input",
      attributes: { id: "author-answer", type: "text", "data-testid": "author-answer" }
    });
    answerInput.value = clue.answer;
    const fields = element("div", { className: "author-field-grid" });
    fields.append(field(locale.ui.authorAnswer, answerInput));
    const syncClue = () => {
      draft = updateClue(draft, clueId, {
        answer: answerInput.value
      });
      persistInput();
      const finalInput = mount.querySelector<HTMLTextAreaElement>('[data-testid="author-final-text"]');
      if (finalInput?.readOnly) finalInput.value = draft.finalText;
      refreshPreview();
      refreshDerivedPanels();
    };
    answerInput.addEventListener("input", syncClue);
    const inspectorHeading = element("div", { className: "author-guided-inspector-heading" });
    inspectorHeading.append(
      element("h2", { className: "author-panel-title", text: locale.ui.authorSelectedClue }),
      fields
    );
    section.append(inspectorHeading);

    const incoming = incomingReference(draft, clueId);
    const hasRightPrompt = Array.isArray(clue.rightPrompt);
    const currentBracketFormat = hasRightPrompt ? "both" : incoming?.segment.direction ?? "plain";
    const bracketFormats: ReadonlyArray<{ readonly value: BracketFormat; readonly label: string }> = [
      { value: "plain", label: locale.ui.authorBracketPlain ?? "Sin flechas" },
      { value: "right", label: locale.ui.authorBracketRight ?? "Respuesta a la derecha" },
      { value: "left", label: locale.ui.authorBracketLeft ?? "Respuesta a la izquierda" },
      { value: "both", label: locale.ui.authorBracketBoth ?? "Respuesta central" }
    ];
    const formatField = element("fieldset", {
      className: "author-bracket-format",
      attributes: { "data-testid": "author-bracket-format" }
    });
    formatField.append(
      element("legend", { text: locale.ui.authorBracketFormat }),
      element("p", { className: "author-bracket-format-help", text: locale.ui.authorBracketFormatHelp })
    );
    const formatOptions = element("div", {
      className: "author-bracket-options",
      attributes: { role: "group", "aria-label": locale.ui.authorBracketFormat }
    });
    for (const format of bracketFormats) {
      const option = element("button", {
        className: `author-bracket-option${currentBracketFormat === format.value ? " is-selected" : ""}`,
        attributes: {
          type: "button",
          "aria-label": format.label,
          "aria-pressed": currentBracketFormat === format.value ? "true" : "false",
          "data-testid": `author-bracket-format-${format.value}`
        }
      });
      option.append(
        element("span", { className: "author-bracket-option-label", text: format.label }),
        renderBracketSyntax({
          format: format.value,
          left: "pista",
          answer: "respuesta",
          ...(format.value === "both" ? { right: "pista" } : {})
        }, "author-bracket-option-syntax")
      );
      option.addEventListener("click", () => {
        if (format.value === currentBracketFormat) return;
        if (hasRightPrompt && format.value !== "both" && globalThis.confirm?.(locale.ui.authorRemoveRightPromptConfirm) === false) {
          return;
        }
        apply(() => {
          if (format.value === "both") return setRightPrompt(draft, clueId, true);
          const withoutRightPrompt = hasRightPrompt ? setRightPrompt(draft, clueId, false) : draft;
          return setReferenceDirection(
            withoutRightPrompt,
            clueId,
            format.value === "plain" ? null : format.value
          );
        }, locale.ui.authorDirectionSaved);
      });
      formatOptions.append(option);
    }
    formatField.append(formatOptions);
    section.append(formatField);

    section.append(createSegmentEditor(
      clueId,
      clue.prompt,
      hasRightPrompt ? locale.ui.authorLeftPrompt : locale.ui.authorPromptStructure,
      hasRightPrompt ? locale.ui.authorLeftPrompt : ""
    ));
    if (hasRightPrompt) {
      section.append(createSegmentEditor(
        `${clueId}:right`,
        clue.rightPrompt!,
        locale.ui.authorRightPrompt,
        locale.ui.authorRightPrompt
      ));
    }
    const remove = element("button", {
      className: "author-button author-button--danger author-button--compact",
      text: locale.ui.authorRemoveClue,
      attributes: { type: "button", "data-testid": "author-remove-clue" }
    });
    remove.addEventListener("click", () => {
      if (globalThis.confirm?.(locale.ui.authorRemoveConfirm) === false) return;
      apply(() => removeClue(draft, clueId), locale.ui.authorClueRemoved);
    });
    section.append(remove);
    return section;
  };

  const renderValidation = (validation: ValidationResult): HTMLElement => {
    const section = element("section", { className: "author-panel", attributes: { "data-testid": "author-validation" } });
    const state = element("p", {
      className: `validation-state ${validation.valid ? "is-valid" : "is-invalid"}`,
      text: validation.valid ? locale.ui.authorValid : locale.ui.authorInvalid,
      attributes: { "data-testid": "author-validation-state" }
    });
    section.append(state);
    if (operationError) section.append(element("p", { className: "author-error", text: operationError, attributes: { role: "alert" } }));
    const issues = [...validation.errors.map((issue) => ({ ...issue, kind: locale.ui.authorError })),
      ...validation.warnings.map((issue) => ({ ...issue, kind: locale.ui.authorWarning }))];
    if (issues.length) {
      const list = element("ul", { className: "validation-list" });
      for (const issue of issues) {
        list.append(element("li", {
          text: `${issue.kind} ${issue.code} · ${issue.path}: ${issue.message}`
        }));
      }
      section.append(list);
    }
    return section;
  };

  const renderOutput = (validation: ValidationResult): HTMLElement => {
    const outputRegion = element("div", { className: "author-output" });
    const exportPanel = element("section", { className: "author-panel" });
    exportPanel.append(element("h2", {
      className: "author-panel-title",
      text: variant === "suggestion" ? locale.ui.suggestionSubmitHeading : locale.ui.authorExport
    }));
    let json = "";
    if (validation.valid) json = serializeAuthorPuzzle(draft, locale);
    const output = element("textarea", {
      className: "author-input author-json",
      attributes: {
        rows: "16",
        readonly: "",
        "data-testid": "author-json",
        "aria-label": locale.ui.authorJson
      }
    });
    output.value = json;

    if (typeof onPublish === "function") {
      const capacityBlocked = activePuzzleDate === null && activeSuggestionId === null && additionsPaused();
      const publish = element("button", {
        className: "author-button author-button--accent author-publish",
        text: locale.ui.authorPublish,
        attributes: {
          type: "button",
          disabled: validation.valid && !publishing && !deletingPuzzle && !restoringPuzzle && !capacityBlocked ? undefined : "",
          "data-testid": "author-publish"
        }
      });
      publish.addEventListener("click", () => {
        const currentJson = prepareExport();
        if (currentJson === null) return;
        let definition = JSON.parse(currentJson) as PuzzleDefinition;
        const date = definition.releaseDate;
        if (!date) {
          operationError = locale.ui.authorPublishDateRequired ?? "";
          liveMessage = operationError;
          render();
          return;
        }
        const suggestionId = activeSuggestionId;
        const existing = existingPuzzles.find((item) => item.date === date);
        const replace = suggestionId === null && (existing !== undefined || knownPuzzleDates.has(date));
        if (existing && suggestionId === null) {
          const revision = (existing.definition.revision ?? 1) + 1;
          definition = { ...definition, revision };
          draft = updateMetadata(draft, { revision });
          persistInput();
        }
        const complete = () => {
          const stored = existingPuzzles.find((item) => item.date === date);
          if (stored) stored.definition = structuredClone(definition);
          else existingPuzzles.push({ date, definition: structuredClone(definition) });
          knownPuzzleDates.add(date);
          if (suggestionId !== null) {
            const suggestionIndex = suggestions.findIndex((item) => item.metadata.suggestionId === suggestionId);
            if (suggestionIndex >= 0) suggestions.splice(suggestionIndex, 1);
            activeSuggestionId = null;
            persist();
          }
          activePuzzleDate = date;
          lastTrashedPuzzle = null;
          savedDate = date;
          publishedDate = !currentDate || date <= currentDate ? date : null;
          operationError = "";
          liveMessage = formatMessage(locale.ui.authorPublished, { date });
          publishing = false;
          render();
        };
        const fail = (error: unknown): void => {
          publishing = false;
          operationError = errorMessage(error);
          liveMessage = operationError;
          render();
        };
        try {
          const result = onPublish(definition, {
            overwrite: replace,
            ...(suggestionId !== null ? { suggestionId } : {})
          });
          if (result !== null && typeof result === "object" && "then" in result && typeof result.then === "function") {
            publishing = true;
            liveMessage = locale.ui.authorPublishing ?? "";
            render();
            Promise.resolve(result).then(complete, fail);
          } else {
            complete();
          }
        } catch (error) {
          fail(error);
        }
      });
      exportPanel.append(publish);
      if (capacityBlocked) {
        exportPanel.append(element("p", {
          className: "author-error",
          text: formatMessage(locale.ui.puzzleLimitReached, { limit: puzzleLimit ?? 1000 })
        }));
      }
      if (savedDate) {
        exportPanel.append(element("p", {
          className: "author-publish-status",
          text: formatMessage(locale.ui.authorPublished, { date: savedDate }),
          attributes: { "data-testid": "author-publish-status" }
        }));
      }
    }

    if (variant === "author" && activePuzzleDate !== null && typeof onDeletePuzzle === "function") {
      const date = activePuzzleDate;
      const remove = element("button", {
        className: "author-button author-button--danger",
        text: locale.ui.authorDeletePuzzle,
        attributes: {
          type: "button",
          disabled: deletingPuzzle || restoringPuzzle || publishing ? "" : undefined,
          "data-testid": "author-delete-puzzle"
        }
      });
      remove.addEventListener("click", () => {
        if (globalThis.confirm?.(formatMessage(locale.ui.authorDeletePuzzleConfirm, { date })) === false) return;
        const current = existingPuzzles.find((item) => item.date === date);
        if (!current) return;
        deletingPuzzle = true;
        operationError = "";
        liveMessage = formatMessage(locale.ui.authorDeletingPuzzle, { date });
        render();
        Promise.resolve(onDeletePuzzle(date)).then(() => {
          const index = existingPuzzles.findIndex((item) => item.date === date);
          if (index >= 0) existingPuzzles.splice(index, 1);
          knownPuzzleDates.delete(date);
          lastTrashedPuzzle = { date, definition: structuredClone(current.definition) };
          activePuzzleDate = null;
          acceptingNewPuzzles = true;
          draft = createBlankDraft();
          resetInlineSourceFromDraft();
          savedDate = null;
          publishedDate = null;
          deletingPuzzle = false;
          operationError = "";
          liveMessage = formatMessage(locale.ui.authorDeletedPuzzle, { date });
          persist();
          render();
        }, (error: unknown) => {
          deletingPuzzle = false;
          operationError = errorMessage(error);
          liveMessage = operationError;
          render();
        });
      });
      exportPanel.append(remove);
    }

    if (variant === "author" && lastTrashedPuzzle !== null && typeof onRestorePuzzle === "function") {
      const removed = lastTrashedPuzzle;
      const undo = element("button", {
        className: "author-button author-button--quiet",
        text: locale.ui.authorUndoDelete,
        attributes: {
          type: "button",
          disabled: restoringPuzzle || deletingPuzzle || publishing ? "" : undefined,
          "data-testid": "author-undo-delete"
        }
      });
      undo.addEventListener("click", () => {
        restoringPuzzle = true;
        operationError = "";
        liveMessage = formatMessage(locale.ui.authorRestoringPuzzle, { date: removed.date });
        render();
        Promise.resolve(onRestorePuzzle(removed.date)).then(() => {
          if (!existingPuzzles.some((item) => item.date === removed.date)) existingPuzzles.push(removed);
          existingPuzzles.sort((left, right) => right.date.localeCompare(left.date));
          knownPuzzleDates.add(removed.date);
          draft = authorDraftFromDefinition(removed.definition, locale);
          resetInlineSourceFromDraft();
          activePuzzleDate = removed.date;
          lastTrashedPuzzle = null;
          restoringPuzzle = false;
          operationError = "";
          liveMessage = formatMessage(locale.ui.authorRestoredPuzzle, { date: removed.date });
          persist();
          render();
        }, (error: unknown) => {
          restoringPuzzle = false;
          operationError = errorMessage(error);
          liveMessage = operationError;
          render();
        });
      });
      exportPanel.append(
        element("p", { text: formatMessage(locale.ui.authorDeletedPuzzle, { date: removed.date }) }),
        undo
      );
    }

    if (variant === "suggestion" && typeof onSubmitSuggestion === "function") {
      exportPanel.append(element("p", {
        className: "author-submit-help",
        text: locale.ui.suggestionSubmitHelp
      }));
      const submit = element("button", {
        className: "author-button author-button--accent author-publish",
        text: locale.ui.suggestionSubmit,
        attributes: {
          type: "button",
          disabled: validation.valid && !publishing && submittedSuggestionId === null && !additionsPaused() ? undefined : "",
          "data-testid": "suggestion-submit"
        }
      });
      submit.addEventListener("click", () => {
        const currentJson = prepareExport();
        if (currentJson === null) return;
        const definition = JSON.parse(currentJson) as PuzzleDefinition;
        const complete = (result: unknown): void => {
          const response = result as { readonly suggestionId?: unknown } | null;
          submittedSuggestionId = Number.isSafeInteger(response?.suggestionId) ? Number(response?.suggestionId) : 0;
          publishing = false;
          operationError = "";
          liveMessage = submittedSuggestionId
            ? formatMessage(locale.ui.suggestionSubmittedWithId ?? "", { id: submittedSuggestionId })
            : locale.ui.suggestionSubmitted ?? "";
          render();
        };
        const fail = (error: unknown): void => {
          publishing = false;
          operationError = errorMessage(error);
          liveMessage = operationError;
          render();
        };
        try {
          publishing = true;
          liveMessage = locale.ui.suggestionSubmitting ?? "";
          render();
          Promise.resolve(onSubmitSuggestion(definition)).then(complete, fail);
        } catch (error) {
          fail(error);
        }
      });
      exportPanel.append(submit);
      if (additionsPaused()) {
        exportPanel.append(element("p", {
          className: "author-error",
          text: formatMessage(locale.ui.puzzleLimitReached, { limit: puzzleLimit ?? 1000 }),
          attributes: { "data-testid": "puzzle-limit-message" }
        }));
      }
      if (submittedSuggestionId !== null) {
        exportPanel.append(element("p", {
          className: "author-publish-status",
          text: submittedSuggestionId
            ? formatMessage(locale.ui.suggestionSubmittedWithId ?? "", { id: submittedSuggestionId })
            : locale.ui.suggestionSubmitted,
          attributes: { "data-testid": "suggestion-submit-status" }
        }));
      }
    }

    if (variant === "author") {
      const actions = element("div", { className: "author-export-actions" });
      const copy = element("button", {
        className: "author-button author-button--quiet",
        text: locale.ui.authorCopyJson,
        attributes: { type: "button", disabled: validation.valid ? undefined : "" }
      });
      copy.addEventListener("click", async () => {
        const currentJson = prepareExport();
        if (currentJson === null) return;
        try {
          await navigator.clipboard.writeText(currentJson);
          liveMessage = locale.ui.authorJsonCopied ?? "";
        } catch {
          output.value = currentJson;
          output.focus();
          output.select();
          liveMessage = locale.ui.authorCopyFallback ?? "";
        }
        render();
      });
      const download = element("button", {
        className: "author-button author-button--accent",
        text: locale.ui.authorDownloadJson,
        attributes: { type: "button", disabled: validation.valid ? undefined : "", "data-testid": "author-download" }
      });
      download.addEventListener("click", () => {
        const currentJson = prepareExport();
        if (currentJson === null) return;
        downloadJson(`${draft.metadata.id || "puzzle"}.json`, currentJson);
        liveMessage = locale.ui.authorDownloadStarted ?? "";
        render();
      });
      actions.append(copy, download);
      const jsonDetails = element("details", {
        className: "author-json-details",
        attributes: { "data-testid": "author-json-details" }
      });
      jsonDetails.append(
        element("summary", { className: "author-json-toggle", text: locale.ui.authorJsonDisclosure }),
        output
      );
      exportPanel.append(jsonDetails, actions);
    }
    outputRegion.append(exportPanel);
    return outputRegion;
  };

  const refreshDerivedPanels = (): void => {
    const validation = validateCurrentDraft();
    const currentValidation = mount.querySelector<HTMLElement>('[data-testid="author-validation"]');
    if (currentValidation) currentValidation.replaceWith(renderValidation(validation));
    const currentOutput = mount.querySelector<HTMLElement>(".author-output");
    if (currentOutput) currentOutput.replaceWith(renderOutput(validation));
  };

  function render(): void {
    clearPreviewSelection({ clearBrowserSelection: true });
    const validation = validateCurrentDraft();
    const shell = element("div", {
      className: `author-shell${flow === "inline" ? " author-shell--inline" : ""}`,
      attributes: { lang: locale.id, dir: locale.dir, "data-panel-skin": panelSkin }
    });
    const header = element("header", { className: "author-header" });
    const identity = element("div");
    identity.append(element("h1", { className: "brand", text: variant === "suggestion" ? locale.ui.suggestionTitle : locale.ui.authorTitle }));
    const nav = element("nav", { className: "mode-nav", attributes: { "aria-label": locale.ui.modeNavigation } });
    nav.append(element("a", {
      className: "mode-link",
      text: locale.ui.playMode,
      attributes: { href: playHref(), "aria-current": undefined }
    }));
    nav.append(element("a", {
      className: "mode-link",
      text: locale.ui.authorMode,
      attributes: {
        href: globalThis.location?.href ?? pageUrl ?? document.baseURI,
        "aria-current": "page"
      }
    }));
    header.append(identity, nav);

    const flowMode = element("div", {
      className: "author-flow-mode",
      attributes: { role: "group", "aria-label": locale.ui.authorFlowLabel }
    });
    flowMode.append(element("span", { text: locale.ui.authorFlowShortLabel }));
    for (const option of [
      { value: "classic" as const, label: locale.ui.authorClassicFlow },
      { value: "inline" as const, label: locale.ui.authorInlineFlow }
    ]) {
      flowMode.append(element("a", {
        className: `mode-link${flow === option.value ? " is-selected" : ""}`,
        text: option.label,
        attributes: {
          href: flowHref(option.value),
          "aria-current": flow === option.value ? "page" : undefined,
          "data-testid": flow === option.value ? "author-flow-current" : "author-flow-switch"
        }
      }));
    }

    const skinPicker = element("div", { className: "author-skin-picker" });
    const skinLabelId = "author-panel-style-label";
    skinPicker.append(element("span", {
      className: "author-control-label",
      text: locale.ui.authorPanelStyleLabel ?? "Apariencia",
      attributes: { id: skinLabelId }
    }));
    const skinOptions = element("div", {
      className: "author-skin-options",
      attributes: { role: "group", "aria-labelledby": skinLabelId }
    });
    const availableSkins: ReadonlyArray<{ readonly value: AuthorPanelSkin; readonly label: string }> = [
      { value: "plain", label: locale.ui.authorPanelStylePlain ?? "Clásico" },
      { value: "lab", label: locale.ui.authorPanelStyleLab ?? "Laboratorio" },
      { value: "blueprint", label: locale.ui.authorPanelStyleBlueprint ?? "Plano técnico" },
      { value: "cards", label: locale.ui.authorPanelStyleCards ?? "Fichas" }
    ];
    for (const option of availableSkins) {
      skinOptions.append(element("a", {
        className: `author-skin-option${panelSkin === option.value ? " is-selected" : ""}`,
        text: option.label,
        attributes: {
          href: skinHref(option.value),
          "aria-current": panelSkin === option.value ? "true" : undefined,
          "data-panel-skin-option": option.value
        }
      }));
    }
    skinPicker.append(skinOptions);
    const viewControls = element("div", { className: "author-view-controls" });

    const intro = element("section", { className: "author-intro" });
    const reset = element("button", {
      className: "author-button author-button--danger author-reset",
      text: locale.ui.authorNewDraft,
      attributes: { type: "button" }
    });
    reset.addEventListener("click", () => {
      if (globalThis.confirm?.(locale.ui.authorResetConfirm) === false) return;
      apply(() => {
        activeSuggestionId = null;
        activePuzzleDate = null;
        submittedSuggestionId = null;
        return createBlankDraft();
      }, locale.ui.authorDraftReset);
    });
    const introActions = element("div", { className: "author-intro-actions" });
    introActions.append(reset);
    intro.append(element("p", {
      text: flow === "inline"
        ? locale.ui.authorInlinePageIntro
        : variant === "suggestion" ? locale.ui.suggestionIntro : locale.ui.authorIntro
    }), introActions);
    let suggestionDialog: HTMLDialogElement | null = null;
    const suggestionActions = element("div", { className: "author-suggestion-actions" });
    if (variant === "author" && suggestionUrl) {
      suggestionActions.append(element("span", {
        className: "author-suggestion-label",
        text: locale.ui.suggestionShareHeading ?? "Propuestas"
      }));
      const suggestionLink = element("a", {
        className: "author-button author-button--quiet",
        text: locale.ui.suggestionShareLink,
        attributes: {
          href: suggestionUrl,
          "data-testid": "suggestion-page-link"
        }
      });
      const copySuggestionLink = element("button", {
        className: "author-button author-button--quiet author-button--compact",
        text: locale.ui.suggestionCopyLinkShort ?? "Copiar",
        attributes: {
          type: "button",
          "aria-label": locale.ui.suggestionCopyLink,
          "data-testid": "suggestion-copy-link"
        }
      });
      copySuggestionLink.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(suggestionUrl);
          liveMessage = locale.ui.suggestionLinkCopied ?? "";
        } catch {
          liveMessage = locale.ui.suggestionLinkCopyFailed ?? "";
        }
        render();
      });
      suggestionActions.append(suggestionLink, copySuggestionLink);
    }
    if (variant === "suggestion" || suggestionUrl) {
      const suggestionInfoTitleId = "suggestion-info-title";
      suggestionDialog = element("dialog", {
        className: "author-suggestion-dialog",
        attributes: {
          "aria-labelledby": suggestionInfoTitleId,
          "data-testid": "suggestion-info-dialog"
        }
      });
      suggestionDialog.append(
        element("h2", {
          className: "author-suggestion-dialog-title",
          text: locale.ui.suggestionInfoTitle ?? "Modo de propuestas",
          attributes: { id: suggestionInfoTitleId }
        }),
        element("p", { text: locale.ui.suggestionInfoIntro }),
        element("p", { text: locale.ui.suggestionInfoReview }),
        element("p", { text: locale.ui.suggestionInfoPrivacy })
      );
      const closeSuggestionInfo = element("button", {
        className: "author-button author-button--accent",
        text: locale.ui.suggestionInfoClose ?? "Entendido",
        attributes: { type: "button", "data-testid": "suggestion-info-close" }
      });
      closeSuggestionInfo.addEventListener("click", () => {
        if (typeof suggestionDialog?.close === "function") suggestionDialog.close();
        else suggestionDialog?.removeAttribute("open");
      });
      suggestionDialog.append(closeSuggestionInfo);

      const openSuggestionInfo = element("button", {
        className: "author-button author-button--quiet author-button--compact author-suggestion-info",
        text: locale.ui.suggestionInfoOpen ?? "Cómo funciona",
        attributes: { type: "button", "data-testid": "suggestion-info-open" }
      });
      openSuggestionInfo.addEventListener("click", () => {
        if (typeof suggestionDialog?.showModal === "function") suggestionDialog.showModal();
        else suggestionDialog?.setAttribute("open", "");
      });
      suggestionActions.append(openSuggestionInfo);
      introActions.append(suggestionActions);
    }

    const layout = element("div", { className: "author-layout" });
    const editor = element("div", { className: "author-editor" });
    editor.append(flow === "inline" ? renderInlineComposer() : renderFinalText());
    const inspector = flow === "inline" ? renderInlineInspector() : renderInspector();
    if (flow === "classic") {
      const guidedWorkspace = element("div", { className: "author-guided-workspace", attributes: { "data-testid": "author-guided-workspace" } });
      guidedWorkspace.append(renderTree());
      if (inspector) guidedWorkspace.append(inspector);
      editor.append(guidedWorkspace);
    } else if (inspector) {
      editor.append(inspector);
    }
    editor.append(renderValidation(validation));

    const styleOptions = element("details", {
      className: "author-style-options",
      attributes: {
        "data-testid": "author-style-options",
        open: styleOptionsOpen ? "" : undefined
      }
    });
    styleOptions.append(element("summary", {
      className: "author-style-toggle",
      text: locale.ui.authorStyleOptions ?? "Estilo",
      attributes: { "data-testid": "author-style-toggle" }
    }));
    const styleOptionsContent = element("div", { className: "author-style-options-content" });
    styleOptionsContent.append(skinPicker);
    if (inlineStyleControls) styleOptionsContent.append(inlineStyleControls);
    styleOptions.append(styleOptionsContent);
    styleOptions.addEventListener("toggle", () => {
      setStyleOptionsOpen(styleOptions.open);
      for (const link of [
        ...flowMode.querySelectorAll<HTMLAnchorElement>("a"),
        ...skinOptions.querySelectorAll<HTMLAnchorElement>("a")
      ]) {
        const target = new URL(link.href, document.baseURI);
        if (styleOptions.open) target.searchParams.set("styles", "open");
        else target.searchParams.delete("styles");
        link.href = target.href;
      }
    });
    viewControls.append(flowMode);

    const utilities = element("aside", {
      className: "author-utilities",
      attributes: { "aria-label": locale.ui.authorUtilities, "data-testid": "author-utilities" }
    });
    utilities.append(styleOptions, element("p", { className: "author-utilities-label", text: locale.ui.authorUtilities }));
    const suggestionLoader = renderSuggestionLoader();
    if (suggestionLoader) utilities.append(suggestionLoader);
    utilities.append(renderMetadata(), renderOutput(validation));
    layout.append(editor, utilities);

    const existingLoader = renderExistingPuzzleLoader();
    const topContent = existingLoader
      ? (() => {
        const region = element("div", { className: "author-top-region author-top-region--with-loader" });
        region.append(intro, existingLoader);
        return region;
      })()
      : (() => {
        intro.classList.add("author-intro--align-layout");
        return intro;
      })();

    const live = element("div", {
      className: "visually-hidden",
      text: liveMessage,
      attributes: { role: "status", "aria-live": "polite", "aria-atomic": "true", "data-testid": "author-live" }
    });
    shell.append(header, viewControls, topContent, layout);
    if (suggestionDialog) shell.append(suggestionDialog);
    shell.append(live);
    mount.replaceChildren(shell);
    document.documentElement.lang = locale.id;
    document.documentElement.dir = locale.dir;
    document.title = `${variant === "suggestion" ? locale.ui.suggestionTitle : locale.ui.authorTitle} — ${locale.ui.gameName}`;
  }

  persist();
  render();
  return { getDraft: () => draft, render, destroy };
}
