import { Data, Effect, Fiber } from "effect";

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
} from "./engine.ts";
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
} from "./view.ts";
import { PuzzleCatalogError, readRequestedPuzzleDate, resolvePuzzleEntry, validatePuzzleCatalog } from "./catalog.ts";
import {
  addSuccessfulLegacyImports,
  assertValidCorrection,
  createWordPressPuzzleRepository,
  getLegacyPublishedPuzzles,
  importLegacyPublishedPuzzles,
  latestAvailablePuzzleDate,
  readWordPressConfig
} from "./puzzle-repository.ts";
import { mergePublishedPuzzles, publishPuzzle, restorePublishedPuzzles } from "./published.ts";
import type { AuthorAppHandle, AuthorPanelSkin } from "./author-view.ts";
import {
  decodeLocalePack,
  decodePuzzleCatalog,
  decodePuzzleDefinition,
  makeHttpClient
} from "./effect.ts";
import type {
  CatalogEntry,
  CompiledPuzzle,
  ExistingPuzzle,
  ExistingSuggestion,
  LocalePack,
  Progress,
  PuzzleDefinition,
  StorageLike,
  Transition
} from "./types.ts";
import type { GameView } from "./view.ts";

export interface AppHandle {
  readonly puzzle: CompiledPuzzle;
  readonly locale: LocalePack;
  readonly getProgress: () => Progress;
  readonly view: GameView;
  readonly destroy: () => void;
}

interface DateNavigation {
  entries: readonly CatalogEntry[];
  selectedDate: string;
  canAuthor: boolean;
  onDateChange: (date: string) => void | Promise<unknown>;
}

interface StartAppOptions {
  mount?: HTMLElement | null | undefined;
  puzzleUrl?: URL | undefined;
  localeUrl?: URL | undefined;
  definition?: PuzzleDefinition | null | undefined;
  localePack?: LocalePack | null | undefined;
  storage?: StorageLike | null | undefined;
  dateNavigation?: DateNavigation | null | undefined;
}

interface BootstrapOptions {
  mount?: HTMLElement | null | undefined;
  puzzleUrl?: URL | undefined;
  catalogUrl?: URL | undefined;
  localeUrl?: URL | undefined;
  storage?: StorageLike | null | undefined;
}

export class AppError extends Data.TaggedError("AppError")<{
  readonly stage: string;
  readonly message: string;
  readonly cause: unknown;
}> {}

const datedAppPopStateCleanups = new WeakMap<HTMLElement, () => void>();

function loadJsonEffect(url: URL, signal?: AbortSignal): Effect.Effect<unknown, AppError> {
  return makeHttpClient().json(url, signal ? { signal } : undefined).pipe(
    Effect.mapError((cause) => new AppError({ stage: "http", message: cause.message, cause }))
  );
}

function loadPuzzle(url: URL, signal?: AbortSignal): Promise<PuzzleDefinition> {
  return Effect.runPromise(loadJsonEffect(url, signal).pipe(
    Effect.flatMap((input) => decodePuzzleDefinition(String(url), input)),
    Effect.mapError((cause) => new AppError({ stage: "puzzle-decode", message: cause.message, cause }))
  ));
}

function loadLocale(url: URL, signal?: AbortSignal): Promise<LocalePack> {
  return Effect.runPromise(loadJsonEffect(url, signal).pipe(
    Effect.flatMap((input) => decodeLocalePack(String(url), input)),
    Effect.mapError((cause) => new AppError({ stage: "locale-decode", message: cause.message, cause }))
  ));
}

function loadCatalog(url: URL, signal?: AbortSignal): Promise<unknown> {
  return Effect.runPromise(loadJsonEffect(url, signal).pipe(
    Effect.flatMap((input) => decodePuzzleCatalog(String(url), input)),
    Effect.mapError((cause) => new AppError({ stage: "catalog-decode", message: cause.message, cause }))
  ));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function renderFatalError(mount: HTMLElement, message: string): void {
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

function datedPuzzleError(date: string | null | undefined): PuzzleCatalogError {
  return new PuzzleCatalogError(
    "UNKNOWN_PUZZLE_DATE",
    "$.date",
    `No hay rompecabezas para ${date ?? "hoy"}.`
  );
}

function updatePuzzleDateUrl(date: string, method: "pushState" | "replaceState" = "pushState"): void {
  const nextUrl = new URL(globalThis.location.href);
  nextUrl.searchParams.set("date", date);
  nextUrl.searchParams.delete("mode");
  if (typeof globalThis.history?.[method] === "function") {
    globalThis.history[method](null, "", nextUrl.href);
    return;
  }
  globalThis.location.assign(nextUrl.href);
}

export async function startDatedApp({
  mount,
  entries,
  initialDate,
  defaultDate,
  canAuthor,
  locale,
  storage,
  loadDefinition
}: {
  mount: HTMLElement;
  entries: readonly CatalogEntry[];
  initialDate: string;
  defaultDate: string | null;
  canAuthor: boolean;
  locale: LocalePack;
  storage?: StorageLike | null | undefined;
  loadDefinition: (date: string, entry: CatalogEntry, signal: AbortSignal) => Promise<PuzzleDefinition>;
}): Promise<AppHandle | null> {
  let activeApp: AppHandle | null = null;
  let activeDate: string | null = null;
  let activeFiber: Fiber.Fiber<AppHandle | null, AppError | PuzzleCatalogError> | null = null;

  const reportNavigationError = (error: unknown, { restoreUrl = false }: { restoreUrl?: boolean } = {}): null => {
    const detail = error instanceof PuzzleCatalogError ? `${error.code}: ${error.message}` : errorMessage(error);
    if (!activeApp?.view) {
      renderFatalError(mount, `No se pudo cargar el rompecabezas. ${detail ?? ""}`.trim());
      return null;
    }
    if (activeApp.view.dateSelect) activeApp.view.dateSelect.value = activeDate ?? "";
    announce(activeApp.view, `No se pudo cargar el rompecabezas. ${detail ?? ""}`.trim());
    if (restoreUrl && activeDate) updatePuzzleDateUrl(activeDate, "replaceState");
    return null;
  };

  const renderDateEffect = (date: string, { pushHistory = false }: { pushHistory?: boolean } = {}) => Effect.gen(function*() {
    const entry = entries.find((candidate) => candidate.date === date);
    if (!date || !entry) return yield* datedPuzzleError(date);
    const definition = yield* Effect.tryPromise({
      try: (signal) => loadDefinition(date, entry, signal),
      catch: (cause) => new AppError({ stage: "date-load", message: errorMessage(cause), cause })
    });

    activeApp?.view?.destroy?.();
    const nextApp = yield* Effect.tryPromise({
      try: () => startApp({
        mount,
        definition,
        localePack: locale,
        storage,
        dateNavigation: {
          entries,
          selectedDate: date,
          canAuthor,
          onDateChange(nextDate) {
            return renderDate(nextDate, { pushHistory: true }).catch(reportNavigationError);
          }
        }
      }),
      catch: (cause) => new AppError({ stage: "date-render", message: errorMessage(cause), cause })
    });
    if (!nextApp) {
      activeApp = null;
      activeDate = null;
      return null;
    }
    activeApp = nextApp;
    activeDate = date;
    if (pushHistory) updatePuzzleDateUrl(date);
    return activeApp;
  });

  const renderDate = async (date: string, options: { pushHistory?: boolean } = {}): Promise<AppHandle | null> => {
    const priorFiber = activeFiber;
    if (priorFiber) await Effect.runPromise(Fiber.interrupt(priorFiber));
    const fiber = Effect.runFork(renderDateEffect(date, options));
    activeFiber = fiber;
    try {
      return await Effect.runPromise(Fiber.join(fiber));
    } catch (error) {
      if (activeFiber !== fiber) return activeApp;
      throw error;
    }
  };

  const handlePopState = () => {
    try {
      const url = new URL(globalThis.location.href);
      const requestedDate = readRequestedPuzzleDate(url.searchParams);
      const date = requestedDate ?? defaultDate;
      if (date === activeDate) return;
      if (date) void renderDate(date).catch((error) => reportNavigationError(error, { restoreUrl: true }));
    } catch (error) {
      reportNavigationError(error, { restoreUrl: true });
    }
  };
  const initialApp = await renderDate(initialDate);
  if (!initialApp) return null;
  globalThis.addEventListener?.("popstate", handlePopState);
  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    globalThis.removeEventListener?.("popstate", handlePopState);
    if (activeFiber) Effect.runFork(Fiber.interrupt(activeFiber));
    activeApp?.view?.destroy?.();
    datedAppPopStateCleanups.delete(mount);
  };
  datedAppPopStateCleanups.set(mount, cleanup);
  return { ...initialApp, destroy: cleanup };
}

function eventMessage(transition: Transition, puzzle: CompiledPuzzle, locale: LocalePack): string {
  const answer = transition.clueId ? puzzle.nodes.get(transition.clueId)?.answer : "";
  const unlock = transition.newlyAvailable.length
    ? ` ${formatMessage(locale.ui.unlocked, { count: transition.newlyAvailable.length })}`
    : "";
  switch (transition.type) {
    case "correct":
      return `${formatMessage(locale.ui.correct, { answer })}${unlock}`;
    case "wrong":
      return locale.ui.wrong ?? "";
    case "peek":
      return formatMessage(locale.ui.peeked, { peek: transition.peek });
    default:
      return "";
  }
}

export async function startApp({
  mount = document.querySelector<HTMLElement>("#app"),
  puzzleUrl = new URL("puzzles/demo-es.json", document.baseURI),
  localeUrl = new URL("locales/es-ES.json", document.baseURI),
  definition: suppliedDefinition = null,
  localePack: suppliedLocale = null,
  storage,
  dateNavigation = null
}: StartAppOptions = {}): Promise<AppHandle | null> {
  if (!mount) return null;

  try {
    const [definition, locale] = await Promise.all([
      suppliedDefinition ?? loadPuzzle(puzzleUrl),
      suppliedLocale ?? loadLocale(localeUrl)
    ]);
    if (definition.locale !== locale.id) throw new Error("Puzzle and locale pack do not match.");
    if (dateNavigation?.selectedDate && definition.releaseDate !== dateNavigation.selectedDate) {
      throw new Error(`Puzzle releaseDate must match catalog date ${dateNavigation.selectedDate}.`);
    }
    const puzzle = compilePuzzle(definition, locale);
    let progress = restoreProgress(puzzle, storage ?? null);
    let view: GameView;

    const persist = () => saveProgress(puzzle, progress, storage);
    const refresh = (transition: Transition | null = null): void => {
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
        requestAnimationFrame(() => scrollClueIntoView(view, transition.newlyAvailable[0]!));
      }
    };

    const handleSubmit = (rawGuess: string): void => {
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

    function handleHint(clueId: string): void {
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
    return { puzzle, locale, getProgress: () => progress, view, destroy: () => view.destroy?.() };
  } catch (error: unknown) {
    const isValidationError = error instanceof PuzzleValidationError;
    const detail = isValidationError ? error.result.errors[0]?.message : errorMessage(error);
    renderFatalError(mount, `No se pudo cargar el rompecabezas. ${detail ?? ""}`.trim());
    return null;
  }
}

export function startAppEffect(options: StartAppOptions = {}): Effect.Effect<AppHandle | null, AppError> {
  return Effect.tryPromise({
    try: () => startApp(options),
    catch: (cause) => new AppError({ stage: "start", message: errorMessage(cause), cause })
  });
}

export async function bootstrapApp({
  mount = document.querySelector<HTMLElement>("#bracket-city-app") ?? document.querySelector<HTMLElement>("#app"),
  puzzleUrl,
  catalogUrl = new URL("puzzles/manifest.json", document.baseURI),
  localeUrl = new URL("locales/es-ES.json", document.baseURI),
  storage
}: BootstrapOptions = {}): Promise<AppHandle | AuthorAppHandle | null> {
  if (mount) {
    datedAppPopStateCleanups.get(mount)?.();
    datedAppPopStateCleanups.delete(mount);
  }
  if (!mount) return null;
  const wordpressConfig = readWordPressConfig();
  const repository = wordpressConfig ? createWordPressPuzzleRepository(wordpressConfig) : null;
  const deployedLocale = globalThis.__NEXO_LOCALE_PACK__ ?? null;
  if (wordpressConfig?.localeUrl && localeUrl?.pathname?.endsWith?.("/locales/es-ES.json")) {
    localeUrl = new URL(wordpressConfig.localeUrl, document.baseURI);
  }
  const currentUrl = new URL(globalThis.location?.href ?? document.baseURI);
  const mode = currentUrl.searchParams.get("mode");
  const authorFlow = currentUrl.searchParams.get("flow") === "inline" ? "inline" : "classic";
  const requestedAuthorSkin = currentUrl.searchParams.get("skin");
  const authorSkin: AuthorPanelSkin | undefined = requestedAuthorSkin === "plain"
    || requestedAuthorSkin === "lab"
    || requestedAuthorSkin === "blueprint"
    || requestedAuthorSkin === "cards"
    ? requestedAuthorSkin
    : undefined;
  let browserStorage = storage;
  if (browserStorage === undefined) {
    try {
      browserStorage = globalThis.localStorage;
    } catch {
      browserStorage = null;
    }
  }
  if (mode === "suggest") {
    try {
      if (!repository?.config.canSuggest) throw new Error("Este enlace de sugerencias no es válido.");
      const [locale, { startAuthorApp }] = await Promise.all([
        deployedLocale ?? loadLocale(localeUrl),
        import("./author-view.ts")
      ]);
      return startAuthorApp({
        mount,
        locale,
        storage: browserStorage,
        variant: "suggestion",
        flow: authorFlow,
        skin: authorSkin,
        pageUrl: repository.config.pageUrl,
        acceptingNewPuzzles: repository.config.acceptingNewPuzzles,
        puzzleLimit: repository.config.puzzleLimit,
        onSubmitSuggestion: (definition) => repository.submitSuggestion(definition)
      });
    } catch (error: unknown) {
      renderFatalError(mount, `No se pudo abrir el formulario de sugerencias. ${errorMessage(error)}`.trim());
      return null;
    }
  }
  if (mode !== "author") {
    if (puzzleUrl) return startApp({ mount, puzzleUrl, localeUrl, storage });
    try {
      if (repository) {
        const [listing, locale] = await Promise.all([
          repository.listPublic(),
          deployedLocale ?? loadLocale(localeUrl)
        ]);
        const entries = listing.entries;
        const requestedDate = readRequestedPuzzleDate(currentUrl.searchParams);
        const selectedDate = requestedDate ?? latestAvailablePuzzleDate(entries);
        if (!selectedDate || !entries.some((entry) => entry.date === selectedDate)) throw datedPuzzleError(selectedDate);
        return startDatedApp({
          mount,
          entries,
          initialDate: selectedDate,
          defaultDate: latestAvailablePuzzleDate(entries),
          canAuthor: repository.config.canAuthor,
          locale,
          storage,
          loadDefinition: (date, _entry, signal) => repository.loadPublic(date, signal)
        });
      }
      const [manifest, locale] = await Promise.all([
        loadCatalog(catalogUrl),
        deployedLocale ?? loadLocale(localeUrl)
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
      return startDatedApp({
        mount,
        entries,
        initialDate: selectedDate,
        defaultDate: catalog.defaultDate,
        canAuthor: true,
        locale,
        storage,
        loadDefinition: (_date, entry, signal) => {
          if (entry.definition) return Promise.resolve(entry.definition);
          if (!entry.file) return Promise.reject(new AppError({
            stage: "catalog-entry",
            message: "Puzzle catalog entry has no file.",
            cause: entry
          }));
          return loadPuzzle(new URL(entry.file, catalogUrl), signal);
        }
      });
    } catch (error: unknown) {
      const detail = error instanceof PuzzleCatalogError ? `${error.code}: ${error.message}` : errorMessage(error);
      renderFatalError(mount, `No se pudo cargar la lista de rompecabezas. ${detail ?? ""}`.trim());
      return null;
    }
  }
  try {
    if (repository && !repository.config.canAuthor) throw new Error("No tienes permiso para abrir el editor.");
    const { startAuthorApp } = await import("./author-view.ts");
    if (repository) {
      const [locale, listing, suggestionMetadata] = await Promise.all([
        deployedLocale ?? loadLocale(localeUrl),
        repository.listAdmin(),
        repository.listSuggestions()
      ]);
      const existingPuzzles: ExistingPuzzle[] = await Promise.all(listing.entries.map(async (entry) => ({
        date: entry.date,
        definition: await repository.loadAdmin(entry.date)
      })));
      const suggestions: ExistingSuggestion[] = await Promise.all(suggestionMetadata.map(async (metadata) => ({
        metadata,
        definition: await repository.loadSuggestion(metadata.suggestionId)
      })));
      const existingDates = new Set(existingPuzzles.map((item) => item.date));
      const onPublish = async (
        definition: PuzzleDefinition,
        { overwrite = false, suggestionId }: { overwrite?: boolean; suggestionId?: number } = {}
      ): Promise<unknown> => {
        const priorDefinition = existingPuzzles.find((item) => item.date === definition.releaseDate)?.definition;
        if (overwrite && suggestionId === undefined) {
          assertValidCorrection(definition, priorDefinition, {
            idMismatch: locale.ui.authorCorrectionIdMismatch ?? "La corrección debe conservar el identificador del rompecabezas.",
            revisionRequired: locale.ui.authorCorrectionRevisionRequired ?? "La corrección debe usar una revisión superior."
          });
        }
        const result = suggestionId === undefined
          ? await repository.save(definition, { overwrite })
          : await repository.approveSuggestion(suggestionId, definition);
        for (const candidate of [priorDefinition, definition]) {
          if (!candidate || typeof browserStorage?.removeItem !== "function") continue;
          try { browserStorage.removeItem(progressStorageKey(compilePuzzle(candidate, locale))); } catch { /* fail closed */ }
        }
        const existing = existingPuzzles.find((item) => item.date === definition.releaseDate);
        if (existing) existing.definition = structuredClone(definition);
        else if (definition.releaseDate) existingPuzzles.push({ date: definition.releaseDate, definition: structuredClone(definition) });
        if (definition.releaseDate) existingDates.add(definition.releaseDate);
        return result;
      };
      const legacyPuzzles = getLegacyPublishedPuzzles(browserStorage, locale);
      const onImportLegacy = async () => {
        const results = await importLegacyPublishedPuzzles(repository, legacyPuzzles, existingDates);
        addSuccessfulLegacyImports(existingPuzzles, legacyPuzzles, results);
        return results;
      };
      return startAuthorApp({
        mount, locale, storage, existingPuzzles, suggestions, onPublish, legacyPuzzles, onImportLegacy,
        flow: authorFlow,
        skin: authorSkin,
        onRejectSuggestion: (suggestionId) => repository.rejectSuggestion(suggestionId),
        onDeletePuzzle: (date) => repository.trashPuzzle(date),
        onRestorePuzzle: (date) => repository.restorePuzzle(date),
        acceptingNewPuzzles: repository.config.acceptingNewPuzzles,
        puzzleLimit: repository.config.puzzleLimit,
        currentDate: listing.currentDate,
        pageUrl: repository.config.pageUrl,
        suggestionUrl: repository.config.suggestionUrl
      });
    }
    const [locale, manifest] = await Promise.all([
      deployedLocale ?? loadLocale(localeUrl),
      loadCatalog(catalogUrl)
    ]);
    const catalog = validatePuzzleCatalog(manifest);
    const published = restorePublishedPuzzles(browserStorage, locale);
    const entries = mergePublishedPuzzles(catalog.puzzles, published);
    const staticPuzzles: ExistingPuzzle[] = await Promise.all(catalog.puzzles.map(async (entry) => ({
      date: entry.date,
      definition: await loadPuzzle(new URL(entry.file!, catalogUrl))
    })));
    const staticByDate = new Map(staticPuzzles.map((item) => [item.date, item.definition]));
    const existingPuzzles: ExistingPuzzle[] = entries.flatMap((entry) => {
      const definition = entry.definition ?? staticByDate.get(entry.date);
      return definition ? [{ date: entry.date, definition }] : [];
    });
    const staticDates = new Set(catalog.puzzles.map((entry) => entry.date));
    const onPublish = (definition: PuzzleDefinition, { overwrite = false }: { overwrite?: boolean } = {}) => {
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
    return startAuthorApp({ mount, locale, storage, existingPuzzles, onPublish, flow: authorFlow, skin: authorSkin });
  } catch (error: unknown) {
    renderFatalError(mount, `No se pudo cargar el editor. ${errorMessage(error)}`.trim());
    return null;
  }
}

export function bootstrapAppEffect(options: BootstrapOptions = {}) {
  return Effect.tryPromise({
    try: () => bootstrapApp(options),
    catch: (cause) => new AppError({ stage: "bootstrap", message: errorMessage(cause), cause })
  });
}

if ((document.querySelector("#bracket-city-app") || document.querySelector("#app")) && !globalThis.__NEXO_DISABLE_AUTO_START__) {
  Effect.runFork(bootstrapAppEffect());
}
