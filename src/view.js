import { isComplete, isSolved } from "./engine.js";

const renderedClueElements = new WeakMap();

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

function resolvedSegmentsText(puzzle, segments) {
  return segments
    .map((segment) => (typeof segment === "string" ? segment : puzzle.nodes.get(segment.ref).answer))
    .join("");
}

function resolvedPromptText(puzzle, node, direction) {
  const left = resolvedSegmentsText(puzzle, node.prompt);
  const right = node.rightPrompt ? resolvedSegmentsText(puzzle, node.rightPrompt) : "";
  const slot = "___";
  if (node.rightPrompt) return `${left} → ${slot} ← ${right}`;
  if (direction === "right") return `${left} → ${slot}`;
  if (direction === "left") return `${slot} ← ${left}`;
  return left;
}

function renderHint(target, node, direction, puzzle, progress, locale, onHint, elements) {
  const appendHint = (position, segments) => {
    const hint = element("span", { attributes: { "data-clue-hint": position } });
    renderSegments(hint, segments, puzzle, progress, locale, onHint, elements);
    target.append(hint);
  };
  const appendArrow = (arrow) => target.append(element("span", {
    className: "answer-slot-arrow",
    text: arrow,
    attributes: { "aria-hidden": "true" }
  }));
  const appendSlot = () => target.append(element("span", {
    className: "answer-slot",
    text: "___",
    attributes: {
      "data-answer-slot": "",
      "aria-label": locale.ui.answerSlot ?? "respuesta"
    }
  }));

  if (node.rightPrompt) {
    appendHint("before", node.prompt);
    appendArrow("→");
    appendSlot();
    appendArrow("←");
    appendHint("after", node.rightPrompt);
  } else if (direction === "right") {
    appendHint("before", node.prompt);
    appendArrow("→");
    appendSlot();
  } else if (direction === "left") {
    appendSlot();
    appendArrow("←");
    appendHint("after", node.prompt);
  } else {
    renderSegments(target, node.prompt, puzzle, progress, locale, onHint, elements);
  }
}

function renderSegments(target, segments, puzzle, progress, locale, onHint, elements) {
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
          "data-clue-state": "solved"
        }
      });
      elements.set(node.id, answer);
      target.append(answer);
      continue;
    }

    const direction = segment.direction;

    const available = node.children.every((childId) => isSolved(progress, childId));
    if (!available) {
      const locked = element("span", {
        className: "clue clue--locked",
        attributes: {
          "data-clue-state": "locked"
        }
      });
      elements.set(node.id, locked);
      renderHint(locked, node, direction, puzzle, progress, locale, onHint, elements);
      target.append(locked);
      continue;
    }

    const hasPeek = progress.peeked.includes(node.id);
    const prompt = resolvedPromptText(puzzle, node, direction);
    const actionText = hasPeek ? locale.ui.enterAfterPeek : locale.ui.peek;
    const accessiblePrompt = formatMessage(locale.ui.clueLabel, { clue: prompt });
    const hintText = hasPeek ? formatMessage(locale.ui.peekValue, { peek: node.peek }) : "";
    const button = element("button", {
      className: `clue clue-button${hasPeek ? " clue-button--peeked" : ""}`,
      attributes: {
        type: "button",
        "data-clue-state": "available",
        "data-hint-state": hasPeek ? "peeked" : "none",
        "aria-label": [accessiblePrompt, hintText, actionText].filter(Boolean).join(" ")
      }
    });
    elements.set(node.id, button);
    renderHint(button, node, direction, puzzle, progress, locale, onHint, elements);
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
  const elements = new Map();
  renderSegments(fragment, puzzle.definition.root, puzzle, progress, locale, onHint, elements);
  container.replaceChildren(fragment);
  renderedClueElements.set(container, elements);
}

export function getRenderedClueElement(container, clueId, state = null) {
  const clue = renderedClueElements.get(container)?.get(clueId) ?? null;
  return clue && (state === null || clue.dataset.clueState === state) ? clue : null;
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
    attributes: { role: "group", "aria-label": locale.ui.virtualKeyboard }
  });
  const rows = [...(locale.keyboard?.rows ?? [])];
  if (locale.keyboard?.extras?.length) rows.push(locale.keyboard.extras);
  let lastRow = null;

  for (const values of rows) {
    const row = element("div", { className: "keyboard-row" });
    for (const value of values) {
      const keyLabel = value === " " ? locale.ui.space : value;
      const key = element("button", {
        className: "keyboard-key",
        text: value === " " ? "␠" : keyLabel,
        attributes: { type: "button", "data-key": value, "aria-label": keyLabel }
      });
      key.addEventListener("click", () => {
        updateInputSelection(input, value, locale.id);
        onVirtualInput();
      });
      row.append(key);
    }
    keyboard.append(row);
    lastRow = row;
  }

  const backspace = element("button", {
    className: "keyboard-key keyboard-key--backspace",
    text: "⌫",
    attributes: { type: "button", "data-key": "Backspace", "aria-label": locale.ui.backspace }
  });
  backspace.addEventListener("click", () => {
    updateInputSelection(input, "Backspace", locale.id);
    onVirtualInput();
  });
  if (!lastRow) {
    lastRow = element("div", { className: "keyboard-row" });
    keyboard.append(lastRow);
  }
  lastRow.append(backspace);
  return keyboard;
}

export function createGameShell(mount, puzzle, locale, handlers, dateNavigation = {}) {
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
  const headerActions = element("div", { className: "header-actions" });
  const modeNav = element("nav", { className: "mode-nav", attributes: { "aria-label": locale.ui.modeNavigation } });
  modeNav.append(
    element("a", {
      className: "mode-link",
      text: locale.ui.authorMode,
      attributes: { href: "?mode=author" }
    })
  );
  headerActions.append(modeNav, scoreBlock);
  header.append(identity, headerActions);

  const card = element("section", {
    className: "puzzle-card",
    attributes: { "aria-label": locale.ui.puzzleLabel }
  });
  if (dateNavigation.entries?.length) {
    const picker = element("div", { className: "date-picker" });
    const dateLabel = element("label", {
      className: "date-label",
      text: locale.ui.dateSelector,
      attributes: { for: "puzzle-date" }
    });
    const dateSelect = element("select", {
      className: "date-select",
      attributes: { id: "puzzle-date", "data-testid": "date-selector" }
    });
    for (const entry of dateNavigation.entries) {
      dateSelect.append(
        element("option", {
          text: formatPuzzleDate(entry.date, locale.id),
          attributes: { value: entry.date }
        })
      );
    }
    dateSelect.value = dateNavigation.selectedDate;
    dateSelect.addEventListener("change", () => dateNavigation.onDateChange?.(dateSelect.value));
    picker.append(dateLabel, dateSelect);
    card.append(picker);
  }
  const puzzleText = element("p", {
    className: "puzzle-text",
    attributes: { "data-testid": "puzzle", "aria-label": locale.ui.puzzleLabel }
  });
  card.append(puzzleText);

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
  card.append(completion);
  shell.append(header, card);

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
      inputmode: "none",
      readonly: "",
      virtualkeyboardpolicy: "manual",
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
    attributes: {
      type: "submit",
      "aria-label": locale.ui.submit,
      "data-testid": "submit-button",
      "data-submit-feedback": "idle"
    }
  });
  form.append(label, input, submit);
  composer.append(form);

  let keyboard = null;
  let syncComposerHeight = () => {};
  if (locale.keyboard) {
    keyboard = createVirtualKeyboard(locale, input, handlers.onVirtualInput);
    composer.append(keyboard);
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

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    handlers.onSubmit(input.value);
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
    composerObserver,
    live
  };
}

const submitFeedbackTimers = new WeakMap();

export function showSubmitFeedback(view, feedback, duration = 450) {
  if (feedback !== "correct" && feedback !== "wrong") return;
  const previousTimer = submitFeedbackTimers.get(view.submit);
  if (previousTimer !== undefined) clearTimeout(previousTimer);
  view.submit.dataset.submitFeedback = feedback;
  const timer = setTimeout(() => {
    if (view.submit.dataset.submitFeedback === feedback) view.submit.dataset.submitFeedback = "idle";
    submitFeedbackTimers.delete(view.submit);
  }, duration);
  submitFeedbackTimers.set(view.submit, timer);
}

export function updateGameSummary(view, puzzle, progress, scoreResult, locale, options = {}) {
  view.scoreValue.textContent = String(scoreResult.score);
  view.scoreBlock.setAttribute("aria-label", formatMessage(locale.ui.scoreValue, { score: scoreResult.score }));
  const complete = isComplete(puzzle, progress);
  view.completion.hidden = !complete;
  view.card.hidden = false;
  view.puzzleText.hidden = complete;
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
  const target = getRenderedClueElement(view.puzzleText, clueId, "available");
  if (!target) return;
  const rect = target.getBoundingClientRect();
  const composerTop = view.composer.hidden ? window.innerHeight : view.composer.getBoundingClientRect().top;
  if (rect.top >= 0 && rect.bottom <= composerTop) return;
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  target.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
}
