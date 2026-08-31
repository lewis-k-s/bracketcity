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
} from "./author.js";
import { mapAuthorPreviewSelection, renderAuthorPreview } from "./author-preview.js";
import { formatMessage } from "./view.js";

function element(tagName, options = {}) {
  const node = document.createElement(tagName);
  if (options.className) node.className = options.className;
  if (options.text !== undefined) node.textContent = options.text;
  if (options.attributes) {
    for (const [name, value] of Object.entries(options.attributes)) {
      if (value !== undefined && value !== null) node.setAttribute(name, String(value));
    }
  }
  return node;
}

function field(labelText, control, helpText = "") {
  const wrapper = element("div", { className: "author-field" });
  const label = element("label", { className: "author-label", text: labelText });
  if (control.id) label.htmlFor = control.id;
  wrapper.append(label, control);
  if (helpText) wrapper.append(element("p", { className: "author-help", text: helpText }));
  return wrapper;
}

function isReference(segment) {
  return segment !== null && typeof segment === "object" && typeof segment.ref === "string";
}

function incomingReference(draft, clueId) {
  const owners = [["root", draft.root]];
  for (const [id, clue] of Object.entries(draft.clues)) {
    owners.push([id, clue.prompt]);
    if (Array.isArray(clue.rightPrompt)) owners.push([`${id}:right`, clue.rightPrompt]);
  }
  for (const [owner, segments] of owners) {
    const segmentIndex = segments.findIndex((segment) => isReference(segment) && segment.ref === clueId);
    if (segmentIndex >= 0) return { owner, segmentIndex, segment: segments[segmentIndex] };
  }
  return null;
}

function treeChildren(draft, owner) {
  const clue = draft.clues[owner];
  const segments = owner === "root"
    ? draft.root
    : [...(clue?.prompt ?? []), ...(clue?.rightPrompt ?? [])];
  return segments.filter(isReference).map((segment) => segment.ref);
}

function segmentsForOwner(draft, owner) {
  if (owner === "root") return draft.root;
  const rightSide = owner.endsWith(":right");
  const clueId = rightSide ? owner.slice(0, -":right".length) : owner;
  return rightSide ? draft.clues[clueId]?.rightPrompt : draft.clues[clueId]?.prompt;
}

function downloadJson(filename, contents) {
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

export function startAuthorApp({
  mount = document.querySelector("#app"),
  locale,
  storage,
  existingPuzzles = [],
  onPublish = null
} = {}) {
  if (!mount || !locale) return null;

  let operationError = "";
  let liveMessage = "";
  let publishedDate = null;
  const knownPuzzleDates = new Set(existingPuzzles.map((item) => item.date));
  let storageTarget = storage;
  let storageUnavailable = false;
  let serializedDraft = null;
  try {
    if (storageTarget === undefined) storageTarget = globalThis.localStorage;
    serializedDraft = storageTarget?.getItem?.(AUTHOR_STORAGE_KEY) ?? null;
  } catch {
    storageTarget = null;
    storageUnavailable = true;
    operationError = locale.ui.authorStorageError;
  }
  let draft = restoreAuthorDraft(serializedDraft);
  let previewSelection = null;

  const draftLiteral = ({ owner, segmentIndex }) => {
    const segments = segmentsForOwner(draft, owner);
    return Array.isArray(segments) && typeof segments[segmentIndex] === "string" ? segments[segmentIndex] : null;
  };

  const updateSelectionControls = () => {
    const convert = mount.querySelector('[data-testid="author-convert-selection"]');
    const summary = mount.querySelector('[data-testid="author-selection-summary"]');
    if (convert) convert.disabled = previewSelection === null;
    if (summary) summary.textContent = previewSelection
      ? formatMessage(locale.ui.authorSelectionReady, { selection: previewSelection.text })
      : "";
  };

  const clearPreviewSelection = ({ clearBrowserSelection = false } = {}) => {
    previewSelection = null;
    if (clearBrowserSelection) document.getSelection?.()?.removeAllRanges?.();
    updateSelectionControls();
  };

  const capturePreviewSelection = () => {
    const container = mount.querySelector('[data-testid="author-structure-preview"]');
    const selection = document.getSelection?.();
    const mapped = mapAuthorPreviewSelection(selection, container);
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

  const selectionChangeHandler = () => capturePreviewSelection();
  const focusInHandler = (event) => {
    if (event.target?.matches?.("input, textarea, select")) clearPreviewSelection({ clearBrowserSelection: true });
  };
  mount.__nexoAuthorDestroy?.();
  document.addEventListener("selectionchange", selectionChangeHandler);
  mount.addEventListener("focusin", focusInHandler);
  const destroy = () => {
    document.removeEventListener("selectionchange", selectionChangeHandler);
    mount.removeEventListener("focusin", focusInHandler);
    if (mount.__nexoAuthorDestroy === destroy) delete mount.__nexoAuthorDestroy;
  };
  mount.__nexoAuthorDestroy = destroy;

  const persist = () => {
    if (storageUnavailable) {
      operationError = locale.ui.authorStorageError;
      return false;
    }
    try {
      storageTarget?.setItem?.(AUTHOR_STORAGE_KEY, serializeAuthorDraft(draft));
      return true;
    } catch {
      storageTarget = null;
      storageUnavailable = true;
      operationError = locale.ui.authorStorageError;
      return false;
    }
  };

  const captureVisibleEdits = () => {
    let next = draft;
    const metadata = {
      id: mount.querySelector("#author-puzzle-id")?.value,
      title: mount.querySelector("#author-title-input")?.value,
      revision: Number(mount.querySelector("#author-revision")?.value),
      releaseDate: mount.querySelector("#author-release-date")?.value
    };
    if (Object.values(metadata).every((value) => value !== undefined)) next = updateMetadata(next, metadata);

    const finalInput = mount.querySelector('[data-testid="author-final-text"]');
    const finalChanged = Object.keys(next.clues).length === 0 && finalInput && finalInput.value !== next.finalText;
    if (finalChanged) next = setFinalText(next, finalInput.value);

    for (const textarea of mount.querySelectorAll(".author-literal[data-owner][data-segment-index]")) {
      const owner = textarea.dataset.owner;
      if (finalChanged && owner === "root") continue;
      const segmentIndex = Number(textarea.dataset.segmentIndex);
      const segments = segmentsForOwner(next, owner);
      if (Array.isArray(segments) && typeof segments[segmentIndex] === "string") {
        next = updateLiteral(next, { owner, segmentIndex, value: textarea.value });
      }
    }

    const answerInput = mount.querySelector('[data-testid="author-answer"]');
    if (answerInput && next.selectedClueId && next.clues[next.selectedClueId]) {
      const aliasesInput = mount.querySelector("#author-aliases");
      const changes = { answer: answerInput.value };
      if (aliasesInput) {
        changes.accept = aliasesInput.value.split(/\r?\n/u).map((value) => value.trim()).filter(Boolean);
      }
      next = updateClue(next, next.selectedClueId, changes);
    }
    draft = next;
  };

  const apply = (operation, message = locale.ui.authorDraftSaved, focusSelector = null) => {
    try {
      captureVisibleEdits();
      // Save field edits before a structural operation can fail. This keeps the
      // visible draft and the restored draft in the same state after an error.
      persist();
      draft = operation();
      operationError = "";
      liveMessage = message;
      if (!persist()) liveMessage = locale.ui.authorStorageError;
      render();
      if (focusSelector) {
        (globalThis.requestAnimationFrame ?? setTimeout)(() => {
          mount.querySelector(focusSelector)?.focus({ preventScroll: true });
        });
      }
    } catch (error) {
      operationError = error instanceof AuthoringError ? `${error.code}: ${error.message}` : error.message;
      liveMessage = operationError;
      render();
    }
  };

  const prepareExport = () => {
    try {
      captureVisibleEdits();
      operationError = "";
      if (!persist()) liveMessage = locale.ui.authorStorageError;
      const validation = validateAuthorDraft(draft, locale);
      if (!validation.valid) {
        throw new AuthoringError("INVALID_DRAFT", "Correct validation errors before export.");
      }
      return serializeAuthorPuzzle(draft, locale);
    } catch (error) {
      operationError = error instanceof AuthoringError ? `${error.code}: ${error.message}` : error.message;
      liveMessage = operationError;
      render();
      return null;
    }
  };

  const createTreeButton = (clueId, depth = 0) => {
    const item = element("li", { className: "author-tree-item" });
    const clue = draft.clues[clueId];
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

  const createSegmentEditor = (owner, segments, heading, visibleLabel = "") => {
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
        const actions = element("div", { className: "segment-actions" });
        const save = element("button", {
          className: "author-button author-button--quiet author-button--compact",
          text: locale.ui.authorSaveText,
          attributes: { type: "button", "data-testid": "author-save-text" }
        });
        save.addEventListener("click", () => apply(
          () => updateLiteral(draft, { owner, segmentIndex, value: textarea.value }),
          locale.ui.authorTextSaved
        ));
        actions.append(save);
        row.append(textarea, actions);
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

  const renderMetadata = () => {
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
    const revisionInput = element("input", {
      className: "author-input",
      attributes: { id: "author-revision", type: "number", min: "1", step: "1" }
    });
    revisionInput.value = String(draft.metadata.revision);
    const releaseInput = element("input", {
      className: "author-input",
      attributes: { id: "author-release-date", type: "date" }
    });
    releaseInput.value = draft.metadata.releaseDate;
    grid.append(
      field(locale.ui.authorPuzzleId, idInput),
      field(locale.ui.authorPuzzleTitle, titleInput),
      field(locale.ui.authorRevision, revisionInput),
      field(locale.ui.authorReleaseDate, releaseInput)
    );
    const save = element("button", {
      className: "author-button",
      text: locale.ui.authorSaveDetails,
      attributes: { type: "button" }
    });
    save.addEventListener("click", () => apply(() => updateMetadata(draft, {
      id: idInput.value.trim(),
      title: titleInput.value,
      revision: Number(revisionInput.value),
      releaseDate: releaseInput.value
    }), locale.ui.authorDetailsSaved));
    section.append(grid, save);
    return section;
  };

  const renderExistingPuzzleLoader = () => {
    if (!existingPuzzles.length) return null;
    const section = element("section", { className: "author-panel author-load-panel" });
    section.append(element("h2", { className: "author-panel-title", text: locale.ui.authorLoadHeading }));
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
      apply(() => authorDraftFromDefinition(selected.definition, locale), locale.ui.authorPuzzleLoaded);
    });
    const controls = element("div", { className: "author-load-controls" });
    controls.append(field(locale.ui.authorLoadPuzzleLabel, select), load);
    section.append(controls);
    return section;
  };

  const renderStructurePreview = () => {
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
    const scheduleSelectionCapture = () => {
      (globalThis.requestAnimationFrame ?? setTimeout)(capturePreviewSelection);
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

  const renderFinalText = () => {
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
    const applyText = element("button", {
      className: "author-button",
      text: locale.ui.authorApplyFinal,
      attributes: { type: "button", disabled: Object.keys(draft.clues).length ? "" : undefined }
    });
    applyText.addEventListener("click", () => apply(() => setFinalText(draft, finalInput.value), locale.ui.authorFinalSaved));
    section.append(field(locale.ui.authorFinalText, finalInput), applyText, renderStructurePreview());
    return section;
  };

  const renderTree = () => {
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

  const renderInspector = () => {
    const clueId = draft.selectedClueId;
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
    const save = element("button", {
      className: "author-button",
      text: locale.ui.authorSaveClue,
      attributes: { type: "button" }
    });
    save.addEventListener("click", () => apply(() => updateClue(draft, clueId, {
      answer: answerInput.value,
      accept: aliasesInput.value.split(/\r?\n/u).map((value) => value.trim()).filter(Boolean)
    }), locale.ui.authorClueSaved));
    section.append(fields, aliases, save);

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
        () => setReferenceDirection(draft, clueId, directionSelect.value || null),
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
        clue.rightPrompt,
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

  const renderValidation = (validation) => {
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

  const renderOutput = (validation) => {
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
          disabled: validation.valid ? undefined : "",
          "data-testid": "author-publish"
        }
      });
      publish.addEventListener("click", () => {
        const currentJson = prepareExport();
        if (currentJson === null) return;
        const definition = JSON.parse(currentJson);
        const date = definition.releaseDate;
        if (!date) {
          operationError = locale.ui.authorPublishDateRequired;
          liveMessage = operationError;
          render();
          return;
        }
        const replace = knownPuzzleDates.has(date);
        if (replace && globalThis.confirm?.(formatMessage(locale.ui.authorPublishReplaceConfirm, { date })) === false) {
          publish.focus({ preventScroll: true });
          return;
        }
        try {
          onPublish(definition, { overwrite: replace });
          knownPuzzleDates.add(date);
          publishedDate = date;
          operationError = "";
          liveMessage = formatMessage(locale.ui.authorPublished, { date });
          render();
        } catch (error) {
          operationError = error?.code ? `${error.code}: ${error.message}` : error.message;
          liveMessage = operationError;
          render();
        }
      });
      exportPanel.append(publish);
      if (publishedDate) {
        exportPanel.append(element("p", {
          className: "author-publish-status",
          text: formatMessage(locale.ui.authorPublished, { date: publishedDate }),
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
        liveMessage = locale.ui.authorJsonCopied;
      } catch {
        output.value = currentJson;
        output.focus();
        output.select();
        liveMessage = locale.ui.authorCopyFallback;
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
      liveMessage = locale.ui.authorDownloadStarted;
      render();
    });
    actions.append(copy, download);
    exportPanel.append(output, actions);
    aside.append(exportPanel);
    return aside;
  };

  function render() {
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
      attributes: { href: publishedDate ? `?date=${encodeURIComponent(publishedDate)}` : "./" }
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
