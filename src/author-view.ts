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
import { mapAuthorPreviewSelection, renderAuthorPreview } from "./author-preview.ts";
import { formatMessage } from "./view.ts";
import type {
  AuthorDraft,
  Direction,
  ExistingPuzzle,
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
  readonly onPublish?: ((definition: PuzzleDefinition, options: { readonly overwrite: boolean }) => unknown) | null | undefined;
  readonly legacyPuzzles?: PuzzleDefinition[] | undefined;
  readonly onImportLegacy?: (() => Promise<ImportResult[]>) | null | undefined;
  readonly currentDate?: string | null | undefined;
  readonly pageUrl?: string | null | undefined;
}

export interface AuthorAppHandle {
  readonly getDraft: () => AuthorDraft;
  readonly render: () => void;
  readonly destroy: () => void;
}

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
  onPublish = null,
  legacyPuzzles = [],
  onImportLegacy = null,
  currentDate = null,
  pageUrl = null
}: StartAuthorAppOptions = {}): AuthorAppHandle | null {
  if (!mountOption || !localeOption) return null;
  const mount = mountOption;
  const locale = localeOption;

  let operationError = "";
  let liveMessage = "";
  let publishedDate: string | null = null;
  let savedDate: string | null = null;
  let publishing = false;
  let importing = false;
  let legacyImportComplete = false;
  const knownPuzzleDates = new Set(existingPuzzles.map((item) => item.date));
  let storageTarget: StorageLike | null | undefined = storage;
  let storageUnavailable = false;
  let serializedDraft: string | null = null;
  try {
    if (storageTarget === undefined) storageTarget = globalThis.localStorage;
    serializedDraft = storageTarget?.getItem?.(AUTHOR_STORAGE_KEY) ?? null;
  } catch {
    storageTarget = null;
    storageUnavailable = true;
    operationError = locale.ui.authorStorageError ?? "";
  }
  let draft = restoreAuthorDraft(serializedDraft);
  let previewSelection: PreviewSelection | null = null;

  const playHref = () => {
    if (!pageUrl) return publishedDate ? `?date=${encodeURIComponent(publishedDate)}` : "./";
    const target = new URL(pageUrl, document.baseURI);
    target.searchParams.delete("mode");
    target.searchParams.delete("date");
    if (publishedDate) target.searchParams.set("date", publishedDate);
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
    if (clearBrowserSelection) document.getSelection?.()?.removeAllRanges?.();
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
      storageTarget?.setItem?.(AUTHOR_STORAGE_KEY, serializeAuthorDraft(draft));
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
    if (id !== undefined && title !== undefined && releaseDate !== undefined) {
      next = updateMetadata(next, { id, title, releaseDate });
    }

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
    renderAuthorPreview(preview, draft);
    clearPreviewSelection({ clearBrowserSelection: true });
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
      operationError = "";
      liveMessage = message ?? "";
      if (!persist()) liveMessage = locale.ui.authorStorageError ?? "";
      render();
      if (focusSelector) {
        const focus = (): void => mount.querySelector<HTMLElement>(focusSelector)?.focus({ preventScroll: true });
        if (globalThis.requestAnimationFrame) globalThis.requestAnimationFrame(focus);
        else setTimeout(focus, 0);
      }
    } catch (error) {
      operationError = errorMessage(error);
      liveMessage = operationError;
      render();
    }
  };

  const prepareExport = (): string | null => {
    try {
      captureVisibleEdits();
      operationError = "";
      if (!persist()) liveMessage = locale.ui.authorStorageError ?? "";
      const validation = validateAuthorDraft(draft, locale);
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

  const createTreeButton = (clueId: string, depth = 0): HTMLLIElement => {
    const item = element("li", { className: "author-tree-item" });
    const clue = draft.clues[clueId];
    if (!clue) throw new AuthoringError("UNKNOWN_CLUE", `Unknown clue '${clueId}'.`);
    const incoming = incomingReference(draft, clueId)?.segment;
    const direction = Array.isArray(clue.rightPrompt)
      ? " ↔"
      : incoming?.direction === "left" ? "← " : incoming?.direction === "right" ? " →" : "";
    const button = element("button", {
      className: `author-tree-button${draft.selectedClueId === clueId ? " is-selected" : ""}`,
      text: `${clueId} · ${clue.answer}${direction}`,
      attributes: {
        type: "button",
        "data-clue-id": clueId,
        "aria-current": draft.selectedClueId === clueId ? "true" : undefined,
        style: `--tree-depth:${depth}`
      }
    });
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
        const direction = Array.isArray(clue?.rightPrompt)
          ? "both"
          : segment.direction;
        const chip = element("button", {
          className: "reference-chip",
          text: direction === "both"
            ? `[${segment.ref} · ${clue?.answer ?? "?"}] ↔`
            : `${direction === "left" ? "← " : ""}[${segment.ref} · ${clue?.answer ?? "?"}]${direction === "right" ? " →" : ""}`,
          attributes: { type: "button", "data-reference": segment.ref }
        });
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
    grid.append(
      field(locale.ui.authorPuzzleId, idInput),
      field(locale.ui.authorPuzzleTitle, titleInput),
      field(locale.ui.authorReleaseDate, releaseInput)
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
    const section = element("section", { className: "author-panel author-load-panel" });
    if (existingPuzzles.length) section.append(element("h2", { className: "author-panel-title", text: locale.ui.authorLoadHeading }));
    const select = element("select", {
      className: "author-input",
      attributes: { id: "author-existing-puzzle", "data-testid": "author-existing-puzzle" }
    });
    select.append(element("option", { text: locale.ui.authorLoadPlaceholder, attributes: { value: "" } }));
    existingPuzzles.forEach((item, index) => {
      select.append(element("option", {
        text: `${item.date} · ${item.definition.title || item.definition.id}`,
        attributes: { value: String(index) }
      }));
    });
    const load = element("button", {
      className: "author-button",
      text: locale.ui.authorLoadPuzzle,
      attributes: { type: "button", disabled: "", "data-testid": "author-load-existing" }
    });
    select.addEventListener("change", () => { load.disabled = select.value === ""; });
    load.addEventListener("click", () => {
      if (select.value === "") return;
      if (globalThis.confirm?.(locale.ui.authorLoadConfirm) === false) return;
      const selected = existingPuzzles[Number(select.value)];
      if (!selected) return;
      apply(() => authorDraftFromDefinition(selected.definition, locale), locale.ui.authorPuzzleLoaded);
    });
    if (existingPuzzles.length) {
      const controls = element("div", { className: "author-load-controls" });
      controls.append(field(locale.ui.authorLoadPuzzleLabel, select), load);
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
    section.append(field(locale.ui.authorFinalText, finalInput), renderStructurePreview());
    return section;
  };

  const renderTree = (): HTMLElement => {
    const section = element("section", { className: "author-panel" });
    section.append(element("h2", { className: "author-panel-title", text: locale.ui.authorTree }));
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

  const renderInspector = (): HTMLElement | null => {
    const clueId = draft.selectedClueId;
    if (clueId === null) return null;
    const clue = draft.clues[clueId];
    if (!clue) return null;
    const section = element("section", { className: "author-panel", attributes: { "data-testid": "clue-inspector" } });
    section.append(element("h2", { className: "author-panel-title", text: clue.answer || locale.ui.authorUntitledClue }));

    const answerInput = element("input", {
      className: "author-input",
      attributes: { id: "author-answer", type: "text", "data-testid": "author-answer" }
    });
    answerInput.value = clue.answer;
    const aliasesInput = element("textarea", {
      className: "author-input",
      attributes: {
        id: "author-aliases",
        rows: "3",
        "data-testid": "author-aliases",
        "aria-label": locale.ui.authorAliases
      }
    });
    aliasesInput.value = (clue.accept ?? []).join("\n");
    const fields = element("div", { className: "author-field-grid" });
    fields.append(field(locale.ui.authorAnswer, answerInput));
    const aliases = element("details", {
      className: "author-aliases",
      attributes: { "data-testid": "author-aliases-disclosure" }
    });
    aliases.append(
      element("summary", {
        className: "author-aliases-toggle",
        text: locale.ui.authorAliases,
        attributes: { "data-testid": "author-aliases-toggle" }
      }),
      aliasesInput
    );
    const syncClue = () => {
      draft = updateClue(draft, clueId, {
        answer: answerInput.value,
        accept: aliasesInput.value.split(/\r?\n/u).map((value) => value.trim()).filter(Boolean)
      });
      persistInput();
      const finalInput = mount.querySelector<HTMLTextAreaElement>('[data-testid="author-final-text"]');
      if (finalInput?.readOnly) finalInput.value = draft.finalText;
      refreshPreview();
      refreshDerivedPanels();
    };
    answerInput.addEventListener("input", syncClue);
    aliasesInput.addEventListener("input", syncClue);
    section.append(fields, aliases);

    const incoming = incomingReference(draft, clueId);
    const hasRightPrompt = Array.isArray(clue.rightPrompt);
    if (!hasRightPrompt) {
      const directionSelect = element("select", {
        className: "author-input",
        attributes: { id: "author-direction", "data-testid": "author-direction" }
      });
      for (const [value, label] of [
        ["", locale.ui.authorNoDirection],
        ["right", locale.ui.authorDirectionRight],
        ["left", locale.ui.authorDirectionLeft]
      ]) {
        directionSelect.append(element("option", { text: label, attributes: { value } }));
      }
      directionSelect.value = incoming?.segment.direction ?? "";
      directionSelect.addEventListener("change", () => apply(
        () => setReferenceDirection(draft, clueId, (directionSelect.value || null) as Direction | null),
        locale.ui.authorDirectionSaved
      ));
      section.append(field(locale.ui.authorDirection, directionSelect));
    }

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
    const rightPromptToggle = element("button", {
      className: "author-button author-button--quiet author-button--compact",
      text: hasRightPrompt ? locale.ui.authorRemoveRightPrompt : locale.ui.authorAddRightPrompt,
      attributes: { type: "button", "data-testid": "author-right-prompt-toggle" }
    });
    rightPromptToggle.addEventListener("click", () => {
      if (hasRightPrompt && globalThis.confirm?.(locale.ui.authorRemoveRightPromptConfirm) === false) return;
      apply(
        () => setRightPrompt(draft, clueId, !hasRightPrompt),
        hasRightPrompt ? locale.ui.authorRightPromptRemoved : locale.ui.authorRightPromptAdded
      );
    });
    section.append(rightPromptToggle);

    const remove = element("button", {
      className: "author-button author-button--danger",
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
    const aside = element("aside", { className: "author-output" });
    const exportPanel = element("section", { className: "author-panel" });
    exportPanel.append(element("h2", { className: "author-panel-title", text: locale.ui.authorExport }));
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
      const publish = element("button", {
        className: "author-button author-button--accent author-publish",
        text: locale.ui.authorPublish,
        attributes: {
          type: "button",
          disabled: validation.valid && !publishing ? undefined : "",
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
        const existing = existingPuzzles.find((item) => item.date === date);
        const replace = existing !== undefined || knownPuzzleDates.has(date);
        if (existing) {
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
          const result = onPublish(definition, { overwrite: replace });
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
      if (savedDate) {
        exportPanel.append(element("p", {
          className: "author-publish-status",
          text: formatMessage(locale.ui.authorPublished, { date: savedDate }),
          attributes: { "data-testid": "author-publish-status" }
        }));
      }
    }

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
    exportPanel.append(output, actions);
    aside.append(exportPanel);
    return aside;
  };

  const refreshDerivedPanels = (): void => {
    const validation = validateAuthorDraft(draft, locale);
    const currentValidation = mount.querySelector<HTMLElement>('[data-testid="author-validation"]');
    if (currentValidation) currentValidation.replaceWith(renderValidation(validation));
    const currentOutput = mount.querySelector<HTMLElement>(".author-output");
    if (currentOutput) currentOutput.replaceWith(renderOutput(validation));
  };

  function render(): void {
    clearPreviewSelection({ clearBrowserSelection: true });
    const validation = validateAuthorDraft(draft, locale);
    const shell = element("div", { className: "author-shell", attributes: { lang: locale.id, dir: locale.dir } });
    const header = element("header", { className: "author-header" });
    const identity = element("div");
    identity.append(
      element("span", { className: "eyebrow", text: locale.ui.authorLabel }),
      element("h1", { className: "brand", text: locale.ui.authorTitle })
    );
    const nav = element("nav", { className: "mode-nav", attributes: { "aria-label": locale.ui.modeNavigation } });
    nav.append(element("a", {
      className: "mode-link",
      text: locale.ui.playMode,
      attributes: { href: playHref() }
    }));
    header.append(identity, nav);

    const intro = element("section", { className: "author-intro" });
    const reset = element("button", {
      className: "author-button author-button--danger author-reset",
      text: locale.ui.authorNewDraft,
      attributes: { type: "button" }
    });
    reset.addEventListener("click", () => {
      if (globalThis.confirm?.(locale.ui.authorResetConfirm) === false) return;
      apply(() => createAuthorDraft(), locale.ui.authorDraftReset);
    });
    intro.append(reset);

    const layout = element("div", { className: "author-layout" });
    const editor = element("div", { className: "author-editor" });
    const existingLoader = renderExistingPuzzleLoader();
    if (existingLoader) editor.append(existingLoader);
    editor.append(renderMetadata(), renderFinalText(), renderTree());
    const inspector = renderInspector();
    if (inspector) editor.append(inspector);
    editor.append(renderValidation(validation));
    layout.append(editor, renderOutput(validation));

    const live = element("div", {
      className: "visually-hidden",
      text: liveMessage,
      attributes: { role: "status", "aria-live": "polite", "aria-atomic": "true", "data-testid": "author-live" }
    });
    shell.append(header, intro, layout, live);
    mount.replaceChildren(shell);
    document.documentElement.lang = locale.id;
    document.documentElement.dir = locale.dir;
    document.title = `${locale.ui.authorTitle} — ${locale.ui.gameName}`;
  }

  persist();
  render();
  return { getDraft: () => draft, render, destroy };
}
