import { isComplete, isSolved } from "./engine.js";

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

export function formatMessage(template, values = {}) {
  return String(template ?? "").replace(/\{([a-zA-Z0-9]+)\}/gu, (_, key) => String(values[key] ?? ""));
}

function resolvedPromptText(puzzle, node) {
  return node.prompt
    .map((segment) => (typeof segment === "string" ? segment : puzzle.nodes.get(segment.ref).answer))
    .join("");
}

function renderSegments(target, segments, puzzle, progress, locale, onHint) {
  for (const segment of segments) {
    if (typeof segment === "string") {
      target.append(document.createTextNode(segment));
      continue;
    }
    const node = puzzle.nodes.get(segment.ref);
    if (isSolved(progress, node.id)) {
      const answer = element("span", {
        className: "clue-answer",
        text: node.answer,
        attributes: {
          "data-clue-id": node.id,
          "data-clue-state": "solved"
        }
      });
      target.append(answer);
      continue;
    }

    const available = node.children.every((childId) => isSolved(progress, childId));
    if (!available) {
      const locked = element("span", {
        className: "clue clue--locked",
        attributes: {
          "data-clue-id": node.id,
          "data-clue-state": "locked"
        }
      });
      renderSegments(locked, node.prompt, puzzle, progress, locale, onHint);
      target.append(locked);
      continue;
    }

    const hasPeek = progress.peeked.includes(node.id);
    const prompt = resolvedPromptText(puzzle, node);
    const actionText = hasPeek ? locale.ui.enterAfterPeek : locale.ui.peek;
    const accessiblePrompt = formatMessage(locale.ui.clueLabel, { clue: prompt });
    const hintText = hasPeek ? formatMessage(locale.ui.peekValue, { peek: node.peek }) : "";
    const button = element("button", {
      className: `clue clue-button${hasPeek ? " clue-button--peeked" : ""}`,
      attributes: {
        type: "button",
        "data-clue-id": node.id,
        "data-clue-state": "available",
        "data-hint-state": hasPeek ? "peeked" : "none",
        "aria-label": [accessiblePrompt, hintText, actionText].filter(Boolean).join(" "),
        "aria-describedby": "hint-instructions"
      }
    });
    renderSegments(button, node.prompt, puzzle, progress, locale, onHint);
    if (hasPeek) {
      button.append(
        element("span", {
          className: "peek-marker",
          text: formatMessage(locale.ui.peekMarker, { peek: node.peek }),
          attributes: { "aria-hidden": "true" }
        })
      );
    }
    button.addEventListener("click", () => onHint(node.id));
    target.append(button);
  }
}

export function renderPuzzle(container, puzzle, progress, locale, onHint) {
  const fragment = document.createDocumentFragment();
  renderSegments(fragment, puzzle.definition.root, puzzle, progress, locale, onHint);
  container.replaceChildren(fragment);
}

function formatPuzzleDate(value, localeId) {
  if (!value) return "";
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat(localeId, {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function previousCharacterStart(value, position, localeId) {
  const prefix = value.slice(0, position);
  if (!prefix) return position;
  if (typeof Intl.Segmenter === "function") {
    const segments = [...new Intl.Segmenter(localeId, { granularity: "grapheme" }).segment(prefix)];
    return segments.at(-1)?.index ?? Math.max(0, position - 1);
  }
  return position - (Array.from(prefix).at(-1)?.length ?? 1);
}

function updateInputSelection(input, value, localeId) {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  if (value === "Backspace") {
    const deletionStart = start === end ? previousCharacterStart(input.value, start, localeId) : start;
    input.setRangeText("", deletionStart, end, "end");
  } else {
    input.setRangeText(value, start, end, "end");
  }
  input.focus({ preventScroll: true });
}

function createVirtualKeyboard(locale, input, onVirtualInput) {
  const keyboard = element("div", {
    className: "virtual-keyboard",
    attributes: { hidden: "", "aria-label": locale.ui.virtualKeyboard }
  });
  const rows = [...(locale.keyboard?.rows ?? [])];
  if (locale.keyboard?.extras?.length) rows.push(locale.keyboard.extras);

  for (const values of rows) {
    const row = element("div", { className: "keyboard-row" });
    for (const value of values) {
      const keyLabel = value === " " ? locale.ui.space : value;
      const key = element("button", {
        className: "keyboard-key",
        text: keyLabel,
        attributes: { type: "button", "data-key": value, "aria-label": keyLabel }
      });
      key.addEventListener("click", () => {
        updateInputSelection(input, value, locale.id);
        onVirtualInput();
      });
      row.append(key);
    }
    keyboard.append(row);
  }

  const actionRow = element("div", { className: "keyboard-row keyboard-row--actions" });
  const backspace = element("button", {
    className: "keyboard-key keyboard-key--wide",
    text: locale.ui.backspace,
    attributes: { type: "button", "data-key": "Backspace", "aria-label": locale.ui.backspace }
  });
  backspace.addEventListener("click", () => {
    updateInputSelection(input, "Backspace", locale.id);
    onVirtualInput();
  });
  actionRow.append(backspace);
  keyboard.append(actionRow);
  return keyboard;
}

export function createGameShell(mount, puzzle, locale, handlers) {
  mount.replaceChildren();

  const shell = element("div", {
    className: "game-shell",
    attributes: { lang: locale.id, dir: locale.dir }
  });
  const header = element("header", { className: "game-header" });
  const identity = element("div");
  identity.append(
    element("span", { className: "eyebrow", text: locale.ui.gameLabel }),
    element("h1", { className: "brand", text: locale.ui.gameName })
  );
  const scoreBlock = element("div", { className: "score-block" });
  const scoreLabel = element("span", { className: "score-label", text: locale.ui.score });
  const scoreValue = element("span", {
    className: "score-value",
    text: "100",
    attributes: { "data-testid": "score" }
  });
  scoreBlock.append(scoreLabel, scoreValue);
  header.append(identity, scoreBlock);

  const card = element("section", {
    className: "puzzle-card",
    attributes: { "aria-labelledby": "puzzle-title" }
  });
  const meta = element("p", { className: "puzzle-meta", attributes: { id: "puzzle-title" } });
  const metaParts = [];
  if (puzzle.definition.releaseDate) metaParts.push(formatPuzzleDate(puzzle.definition.releaseDate, locale.id));
  metaParts.push(puzzle.definition.title, formatMessage(locale.ui.clueCount, { count: puzzle.nodes.size }));
  meta.textContent = metaParts.filter(Boolean).join(" · ");
  const puzzleText = element("p", {
    className: "puzzle-text",
    attributes: { "data-testid": "puzzle", "aria-label": locale.ui.puzzleLabel }
  });
  const instruction = element("p", {
    className: "instruction",
    text: locale.ui.instructions,
    attributes: { id: "hint-instructions" }
  });
  card.append(meta, puzzleText, instruction);

  if (puzzle.definition.source?.label) {
    const source = element("p", { className: "source-note" });
    if (puzzle.definition.source.url) {
      source.append(
        element("a", {
          text: puzzle.definition.source.label,
          attributes: { href: puzzle.definition.source.url, target: "_blank", rel: "noreferrer" }
        })
      );
    } else {
      source.textContent = puzzle.definition.source.label;
    }
    card.append(source);
  }

  const completion = element("section", {
    className: "completion-panel",
    attributes: { hidden: "", "data-testid": "completion" }
  });
  const completionHeading = element("h2", {
    className: "completion-title",
    text: locale.ui.completionTitle,
    attributes: { tabindex: "-1" }
  });
  const finalText = element("p", { className: "final-text" });
  const resultText = element("p", { className: "result-text" });
  completion.append(completionHeading, finalText, resultText);
  shell.append(header, card, completion);

  const composer = element("div", { className: "composer" });
  const form = element("form", { className: "guess-form", attributes: { novalidate: "" } });
  const label = element("label", {
    className: "visually-hidden",
    text: locale.ui.guessLabel,
    attributes: { for: "guess" }
  });
  const input = element("input", {
    className: "guess-input",
    attributes: {
      id: "guess",
      type: "text",
      inputmode: "text",
      enterkeyhint: "done",
      autocomplete: "off",
      autocapitalize: "none",
      spellcheck: "false",
      lang: locale.id,
      placeholder: locale.ui.guessPlaceholder,
      "data-testid": "guess-input"
    }
  });
  const submit = element("button", {
    className: "submit-button",
    text: locale.ui.submit,
    attributes: { type: "submit", "aria-label": locale.ui.submit }
  });
  form.append(label, input, submit);
  composer.append(form);

  let keyboard = null;
  let keyboardToggle = null;
  let syncComposerHeight = () => {};
  if (locale.keyboard) {
    keyboardToggle = element("button", {
      className: "keyboard-toggle",
      text: locale.ui.showKeyboard,
      attributes: { type: "button", "aria-expanded": "false" }
    });
    keyboard = createVirtualKeyboard(locale, input, handlers.onVirtualInput);
    keyboardToggle.addEventListener("click", () => {
      const willShow = keyboard.hidden;
      keyboard.hidden = !willShow;
      keyboardToggle.setAttribute("aria-expanded", String(willShow));
      keyboardToggle.textContent = willShow ? locale.ui.hideKeyboard : locale.ui.showKeyboard;
      if (willShow) input.focus({ preventScroll: true });
      (globalThis.requestAnimationFrame ?? setTimeout)(syncComposerHeight);
    });
    composer.append(keyboardToggle, keyboard);
  }

  const live = element("div", {
    className: "visually-hidden",
    attributes: { "aria-live": "polite", "aria-atomic": "true", role: "status", "data-testid": "live-status" }
  });
  mount.append(shell, composer, live);

  syncComposerHeight = () => {
    const height = composer.getBoundingClientRect().height;
    if (height > 0) shell.style.setProperty("--composer-height", `${Math.ceil(height)}px`);
  };
  const composerObserver = typeof ResizeObserver === "function" ? new ResizeObserver(syncComposerHeight) : null;
  composerObserver?.observe(composer);
  (globalThis.requestAnimationFrame ?? setTimeout)(syncComposerHeight);

  let composing = false;
  input.addEventListener("compositionstart", () => {
    composing = true;
  });
  input.addEventListener("compositionend", () => {
    composing = false;
  });
  input.addEventListener("beforeinput", (event) => {
    if (event.isComposing) return;
    if (event.inputType?.startsWith("insert") || event.inputType?.startsWith("delete")) handlers.onPhysicalInput();
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!composing) handlers.onSubmit(input.value);
  });

  return {
    shell,
    scoreBlock,
    scoreValue,
    card,
    puzzleText,
    completion,
    completionHeading,
    finalText,
    resultText,
    composer,
    form,
    input,
    submit,
    keyboard,
    keyboardToggle,
    composerObserver,
    live
  };
}

export function updateGameSummary(view, puzzle, progress, scoreResult, locale, options = {}) {
  view.scoreValue.textContent = String(scoreResult.score);
  view.scoreBlock.setAttribute("aria-label", formatMessage(locale.ui.scoreValue, { score: scoreResult.score }));
  const complete = isComplete(puzzle, progress);
  view.completion.hidden = !complete;
  view.card.hidden = complete;
  view.composer.hidden = complete;
  if (complete) {
    view.finalText.textContent = puzzle.definition.finalText;
    const rankLabel = locale.ui[scoreResult.rank?.labelKey] ?? scoreResult.rank?.labelKey ?? "";
    view.resultText.textContent = formatMessage(locale.ui.result, { score: scoreResult.score, rank: rankLabel });
    if (options.focusCompletion) view.completionHeading.focus({ preventScroll: true });
  }
}

export function announce(view, message) {
  view.live.textContent = "";
  const schedule = globalThis.requestAnimationFrame ?? ((callback) => setTimeout(callback, 0));
  schedule(() => {
    view.live.textContent = message;
  });
}

export function focusGuess(view, select = false) {
  view.input.focus({ preventScroll: true });
  if (select) view.input.select();
}

export function scrollClueIntoView(view, clueId) {
  if (!clueId) return;
  const escapedId = globalThis.CSS?.escape ? CSS.escape(clueId) : clueId.replace(/[^a-z0-9-]/giu, "");
  const target = view.puzzleText.querySelector(`[data-clue-id="${escapedId}"][data-clue-state="available"]`);
  if (!target) return;
  const rect = target.getBoundingClientRect();
  const composerTop = view.composer.hidden ? window.innerHeight : view.composer.getBoundingClientRect().top;
  if (rect.top >= 0 && rect.bottom <= composerTop) return;
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  target.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
}
