import {
  PuzzleValidationError,
  calculateScore,
  compilePuzzle,
  peekClue,
  progressStorageKey,
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
  getRenderedClueElement,
  renderPuzzle,
  scrollClueIntoView,
  showSubmitFeedback,
  updateGameSummary
} from "./view.js";
import { PuzzleCatalogError, readRequestedPuzzleDate, resolvePuzzleEntry, validatePuzzleCatalog } from "./catalog.js";
import {
  addSuccessfulLegacyImports,
  assertValidCorrection,
  createWordPressPuzzleRepository,
  getLegacyPublishedPuzzles,
  importLegacyPublishedPuzzles,
  latestAvailablePuzzleDate,
  readWordPressConfig
} from "./puzzle-repository.js";
import { mergePublishedPuzzles, publishPuzzle, restorePublishedPuzzles } from "./published.js";
import { startAuthorApp } from "./author-view.js";

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
  definition: suppliedDefinition = null,
  localePack: suppliedLocale = null,
  storage,
  dateNavigation = null
} = {}) {
  if (!mount) return null;

  try {
    const [definition, locale] = await Promise.all([
      suppliedDefinition ?? loadJson(puzzleUrl),
      suppliedLocale ?? loadJson(localeUrl)
    ]);
    if (definition.locale !== locale.id) throw new Error("Puzzle and locale pack do not match.");
    if (dateNavigation?.selectedDate && definition.releaseDate !== dateNavigation.selectedDate) {
      throw new Error(`Puzzle releaseDate must match catalog date ${dateNavigation.selectedDate}.`);
    }
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
      showSubmitFeedback(view, transition.type);
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
      getRenderedClueElement(view.puzzleText, clueId, "available")?.focus();
    }

    const handleInput = () => {
      progress = recordKeystroke(progress);
      persist();
    };

    view = createGameShell(mount, puzzle, locale, {
      onSubmit: handleSubmit,
      onHint: handleHint,
      onVirtualInput: handleInput
    }, dateNavigation ?? {});
    document.documentElement.lang = locale.id;
    document.documentElement.dir = locale.dir;
    document.title = `${locale.ui.gameName} — ${locale.ui.gameLabel}`;
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

export async function bootstrapApp({
  mount = document.querySelector("#bracket-city-app") ?? document.querySelector("#app"),
  puzzleUrl,
  catalogUrl = new URL("puzzles/manifest.json", document.baseURI),
  localeUrl = new URL("locales/es-ES.json", document.baseURI),
  storage
} = {}) {
  const wordpressConfig = readWordPressConfig();
  const repository = wordpressConfig ? createWordPressPuzzleRepository(wordpressConfig) : null;
  const deployedLocale = globalThis.__NEXO_LOCALE_PACK__ ?? null;
  if (wordpressConfig?.localeUrl && localeUrl?.pathname?.endsWith?.("/locales/es-ES.json")) {
    localeUrl = new URL(wordpressConfig.localeUrl, document.baseURI);
  }
  const currentUrl = new URL(globalThis.location?.href ?? document.baseURI);
  const mode = currentUrl.searchParams.get("mode");
  let browserStorage = storage;
  if (browserStorage === undefined) {
    try {
      browserStorage = globalThis.localStorage;
    } catch {
      browserStorage = null;
    }
  }
  if (mode !== "author") {
    if (puzzleUrl) return startApp({ mount, puzzleUrl, localeUrl, storage });
    try {
      if (repository) {
        const [listing, locale] = await Promise.all([
          repository.listPublic(),
          deployedLocale ?? loadJson(localeUrl)
        ]);
        const entries = listing.entries;
        const requestedDate = readRequestedPuzzleDate(currentUrl.searchParams);
        const selectedDate = requestedDate ?? latestAvailablePuzzleDate(entries);
        const selectedEntry = entries.find((entry) => entry.date === selectedDate);
        if (!selectedDate || !selectedEntry) {
          throw new PuzzleCatalogError("UNKNOWN_PUZZLE_DATE", "$.date", `No hay rompecabezas para ${selectedDate ?? "hoy"}.`);
        }
        const definition = await repository.loadPublic(selectedDate);
        return startApp({
          mount,
          definition,
          localePack: locale,
          storage,
          dateNavigation: {
            entries,
            selectedDate,
            canAuthor: wordpressConfig.canAuthor,
            onDateChange(date) {
              const nextUrl = new URL(globalThis.location.href);
              nextUrl.searchParams.set("date", date);
              nextUrl.searchParams.delete("mode");
              globalThis.location.assign(nextUrl.href);
            }
          }
        });
      }
      const [manifest, locale] = await Promise.all([
        loadJson(catalogUrl),
        deployedLocale ?? loadJson(localeUrl)
      ]);
      const catalog = validatePuzzleCatalog(manifest);
      const published = restorePublishedPuzzles(browserStorage, locale);
      const entries = mergePublishedPuzzles(catalog.puzzles, published);
      const requestedDate = readRequestedPuzzleDate(currentUrl.searchParams);
      const selectedDate = requestedDate ?? catalog.defaultDate;
      const selectedEntry = entries.find((entry) => entry.date === selectedDate);
      if (!selectedEntry) {
        // Reuse the catalog's stable invalid-date and unknown-date errors.
        resolvePuzzleEntry(manifest, selectedDate);
      }
      const dateNavigation = {
        entries,
        selectedDate,
        canAuthor: true,
        onDateChange(date) {
          const nextUrl = new URL(globalThis.location.href);
          nextUrl.searchParams.set("date", date);
          nextUrl.searchParams.delete("mode");
          globalThis.location.assign(nextUrl.href);
        }
      };
      if (selectedEntry.definition) {
        return startApp({
          mount,
          definition: selectedEntry.definition,
          localePack: locale,
          storage,
          dateNavigation
        });
      }
      const selectedPuzzleUrl = new URL(selectedEntry.file, catalogUrl);
      return startApp({ mount, puzzleUrl: selectedPuzzleUrl, localePack: locale, storage, dateNavigation });
    } catch (error) {
      const detail = error instanceof PuzzleCatalogError ? `${error.code}: ${error.message}` : error.message;
      renderFatalError(mount, `No se pudo cargar la lista de rompecabezas. ${detail ?? ""}`.trim());
      return null;
    }
  }
  if (!mount) return null;

  try {
    if (repository) {
      if (!wordpressConfig.canAuthor) throw new Error("No tienes permiso para abrir el editor.");
      const [locale, listing] = await Promise.all([deployedLocale ?? loadJson(localeUrl), repository.listAdmin()]);
      const existingPuzzles = await Promise.all(listing.entries.map(async (entry) => ({
        date: entry.date,
        definition: await repository.loadAdmin(entry.date)
      })));
      const existingDates = new Set(existingPuzzles.map((item) => item.date));
      const onPublish = async (definition, { overwrite = false } = {}) => {
        const priorDefinition = existingPuzzles.find((item) => item.date === definition.releaseDate)?.definition;
        if (overwrite) {
          assertValidCorrection(definition, priorDefinition, {
            idMismatch: locale.ui.authorCorrectionIdMismatch,
            revisionRequired: locale.ui.authorCorrectionRevisionRequired
          });
        }
        const result = await repository.save(definition, { overwrite });
        for (const candidate of [priorDefinition, definition]) {
          if (!candidate || typeof browserStorage?.removeItem !== "function") continue;
          try { browserStorage.removeItem(progressStorageKey(compilePuzzle(candidate, locale))); } catch { /* fail closed */ }
        }
        const existing = existingPuzzles.find((item) => item.date === definition.releaseDate);
        if (existing) existing.definition = structuredClone(definition);
        else existingPuzzles.push({ date: definition.releaseDate, definition: structuredClone(definition) });
        existingDates.add(definition.releaseDate);
        return result;
      };
      const legacyPuzzles = getLegacyPublishedPuzzles(browserStorage, locale);
      const onImportLegacy = async () => {
        const results = await importLegacyPublishedPuzzles(repository, legacyPuzzles, existingDates);
        addSuccessfulLegacyImports(existingPuzzles, legacyPuzzles, results);
        return results;
      };
      return startAuthorApp({
        mount, locale, storage, existingPuzzles, onPublish, legacyPuzzles, onImportLegacy,
        currentDate: listing.currentDate,
        pageUrl: wordpressConfig.pageUrl
      });
    }
    const [locale, manifest] = await Promise.all([
      deployedLocale ?? loadJson(localeUrl),
      loadJson(catalogUrl)
    ]);
    const catalog = validatePuzzleCatalog(manifest);
    const published = restorePublishedPuzzles(browserStorage, locale);
    const entries = mergePublishedPuzzles(catalog.puzzles, published);
    const staticPuzzles = await Promise.all(catalog.puzzles.map(async (entry) => ({
      date: entry.date,
      definition: await loadJson(new URL(entry.file, catalogUrl))
    })));
    const staticByDate = new Map(staticPuzzles.map((item) => [item.date, item.definition]));
    const existingPuzzles = entries.map((entry) => ({
      date: entry.date,
      definition: entry.definition ?? staticByDate.get(entry.date)
    }));
    const staticDates = new Set(catalog.puzzles.map((entry) => entry.date));
    const onPublish = (definition, { overwrite = false } = {}) => {
      const priorDefinition = existingPuzzles.find((item) => item.date === definition.releaseDate)?.definition;
      const result = publishPuzzle(definition, {
        storage: browserStorage,
        localePack: locale,
        staticDates,
        staticPuzzles: staticPuzzles.map((item) => item.definition),
        overwrite
      });
      for (const candidate of [priorDefinition, definition]) {
        if (!candidate || typeof browserStorage?.removeItem !== "function") continue;
        try { browserStorage.removeItem(progressStorageKey(compilePuzzle(candidate, locale))); } catch { /* fail closed */ }
      }
      return result;
    };
    return startAuthorApp({ mount, locale, storage, existingPuzzles, onPublish });
  } catch (error) {
    renderFatalError(mount, `No se pudo cargar el editor. ${error.message ?? ""}`.trim());
    return null;
  }
}

if ((document.querySelector("#bracket-city-app") || document.querySelector("#app")) && !globalThis.__NEXO_DISABLE_AUTO_START__) {
  bootstrapApp();
}
