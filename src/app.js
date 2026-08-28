import {
  PuzzleValidationError,
  calculateScore,
  compilePuzzle,
  peekClue,
  recordKeystroke,
  restoreProgress,
  saveProgress,
  submitGuess
} from "./engine.js";
import {
  announce,
  createGameShell,
  focusGuess,
  formatMessage,
  renderPuzzle,
  scrollClueIntoView,
  updateGameSummary
} from "./view.js";

async function loadJson(url) {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Could not load ${url}: ${response.status}`);
  return response.json();
}

function renderFatalError(mount, message) {
  const panel = document.createElement("section");
  panel.className = "fatal-panel";
  panel.setAttribute("role", "alert");
  const title = document.createElement("h1");
  title.textContent = "Nexo";
  const body = document.createElement("p");
  body.textContent = message;
  panel.append(title, body);
  mount.replaceChildren(panel);
}

function eventMessage(transition, puzzle, locale) {
  const answer = transition.clueId ? puzzle.nodes.get(transition.clueId)?.answer : "";
  const unlock = transition.newlyAvailable.length
    ? ` ${formatMessage(locale.ui.unlocked, { count: transition.newlyAvailable.length })}`
    : "";
  switch (transition.type) {
    case "correct":
      return `${formatMessage(locale.ui.correct, { answer })}${unlock}`;
    case "wrong":
      return locale.ui.wrong;
    case "peek":
      return formatMessage(locale.ui.peeked, { peek: transition.peek });
    default:
      return "";
  }
}

export async function startApp({
  mount = document.querySelector("#app"),
  puzzleUrl = new URL("puzzles/demo-es.json", document.baseURI),
  localeUrl = new URL("locales/es-ES.json", document.baseURI),
  storage
} = {}) {
  if (!mount) return null;

  try {
    const [definition, locale] = await Promise.all([loadJson(puzzleUrl), loadJson(localeUrl)]);
    if (definition.locale !== locale.id) throw new Error("Puzzle and locale pack do not match.");
    const puzzle = compilePuzzle(definition, locale);
    let progress = restoreProgress(puzzle, storage ?? null);
    let view;

    const persist = () => saveProgress(puzzle, progress, storage);
    const refresh = (transition = null) => {
      renderPuzzle(view.puzzleText, puzzle, progress, locale, handleHint);
      const score = calculateScore(progress, puzzle.definition.scoring);
      updateGameSummary(view, puzzle, progress, score, locale, {
        focusCompletion: transition?.becameComplete
      });
      if (transition?.becameComplete) {
        announce(view, `${locale.ui.complete} ${puzzle.definition.finalText} ${formatMessage(locale.ui.scoreValue, { score: score.score })}`);
      } else if (transition) {
        const message = eventMessage(transition, puzzle, locale);
        if (message) announce(view, message);
      }
      if (transition?.newlyAvailable.length) {
        requestAnimationFrame(() => scrollClueIntoView(view, transition.newlyAvailable[0]));
      }
    };

    const handleSubmit = (rawGuess) => {
      const transition = submitGuess(puzzle, progress, rawGuess);
      progress = transition.progress;
      if (transition.type === "empty" || transition.type === "noop") {
        focusGuess(view);
        return;
      }
      persist();
      if (transition.type === "correct") view.input.value = "";
      refresh(transition);
      if (!transition.completed) focusGuess(view, transition.type === "wrong");
    };

    function handleHint(clueId) {
      const transition = peekClue(puzzle, progress, clueId);
      progress = transition.progress;
      if (transition.type === "noop") return;
      persist();
      refresh(transition);
      view.puzzleText.querySelector(`[data-clue-id="${clueId}"][data-clue-state="available"]`)?.focus();
    }

    const handleInput = () => {
      progress = recordKeystroke(progress);
      persist();
    };

    view = createGameShell(mount, puzzle, locale, {
      onSubmit: handleSubmit,
      onHint: handleHint,
      onPhysicalInput: handleInput,
      onVirtualInput: handleInput
    });
    document.documentElement.lang = locale.id;
    document.documentElement.dir = locale.dir;
    document.title = `${locale.ui.gameName} — ${definition.title ?? locale.ui.gameLabel}`;
    refresh();
    if (!view.composer.hidden) focusGuess(view);
    return { puzzle, locale, getProgress: () => progress, view };
  } catch (error) {
    const isValidationError = error instanceof PuzzleValidationError;
    const detail = isValidationError ? error.result.errors[0]?.message : error.message;
    renderFatalError(mount, `No se pudo cargar el rompecabezas. ${detail ?? ""}`.trim());
    return null;
  }
}

if (document.querySelector("#app") && !globalThis.__NEXO_DISABLE_AUTO_START__) {
  startApp();
}
