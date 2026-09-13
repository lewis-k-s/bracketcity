import { applyBrandName } from "./brand.ts";
import type { LocalePack, SupabaseConfig } from "./types.ts";

export type AnalyticsPeriodDays = 7 | 30 | 90 | null;

export interface AnalyticsMetrics {
  readonly loads: number;
  readonly completions: number;
  readonly completionRate: number | null;
  readonly meanScore: number | null;
  readonly meanMaxScore: number | null;
  readonly meanNormalizedScore: number | null;
  readonly medianNormalizedScore: number | null;
  readonly meanCompletionSeconds: number | null;
  readonly meanMistakes: number | null;
  readonly meanHints: number | null;
}

export interface PuzzleAnalyticsAggregate extends AnalyticsMetrics {
  readonly puzzleId: string;
  readonly puzzleRevision: number;
  readonly title: string | null;
  readonly releaseDate: string | null;
  readonly difficulty: number | null;
  readonly difficultyLabel: string | null;
}

export interface DifficultyAnalyticsAggregate extends AnalyticsMetrics {
  readonly difficulty: number | null;
  readonly difficultyLabel: string | null;
}

export interface PuzzleAnalyticsReport {
  readonly generatedAt: string;
  readonly periodDays: number | null;
  readonly periodStart: string | null;
  readonly summary: AnalyticsMetrics;
  readonly puzzles: readonly PuzzleAnalyticsAggregate[];
  readonly difficulties: readonly DifficultyAnalyticsAggregate[];
}

export type PuzzleAnalyticsLoader = (
  days: AnalyticsPeriodDays,
  signal?: AbortSignal
) => Promise<PuzzleAnalyticsReport>;

export interface AnalyticsDashboardHandle {
  readonly getReport: () => PuzzleAnalyticsReport | null;
  readonly refresh: () => Promise<void>;
  readonly destroy: () => void;
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface StartAnalyticsDashboardOptions {
  readonly mount: HTMLElement;
  readonly locale: LocalePack;
  readonly loadReport: PuzzleAnalyticsLoader;
  readonly onSignOut?: (() => unknown) | null | undefined;
  readonly pageUrl?: string | null | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function numberValue(source: Record<string, unknown>, key: string, nullable = false): number | null {
  const value = source[key];
  if (nullable && value === null) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Analytics field '${key}' is not a number.`);
  return parsed;
}

function textValue(source: Record<string, unknown>, key: string, nullable = false): string | null {
  const value = source[key];
  if (nullable && value === null) return null;
  if (typeof value !== "string") throw new Error(`Analytics field '${key}' is not text.`);
  return value;
}

function metricsValue(source: Record<string, unknown>): AnalyticsMetrics {
  return {
    loads: numberValue(source, "loads")!,
    completions: numberValue(source, "completions")!,
    completionRate: numberValue(source, "completionRate", true),
    meanScore: numberValue(source, "meanScore", true),
    meanMaxScore: numberValue(source, "meanMaxScore", true),
    meanNormalizedScore: numberValue(source, "meanNormalizedScore", true),
    medianNormalizedScore: numberValue(source, "medianNormalizedScore", true),
    meanCompletionSeconds: numberValue(source, "meanCompletionSeconds", true),
    meanMistakes: numberValue(source, "meanMistakes", true),
    meanHints: numberValue(source, "meanHints", true)
  };
}

function recordArray(value: unknown, label: string): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.some((item) => !isRecord(item))) {
    throw new Error(`Analytics field '${label}' is not a list.`);
  }
  return value as Record<string, unknown>[];
}

export function decodePuzzleAnalyticsReport(value: unknown): PuzzleAnalyticsReport {
  if (!isRecord(value) || !isRecord(value.summary)) throw new Error("Supabase returned invalid analytics.");
  const periodDays = numberValue(value, "periodDays", true);
  return {
    generatedAt: textValue(value, "generatedAt")!,
    periodDays,
    periodStart: textValue(value, "periodStart", true),
    summary: metricsValue(value.summary),
    puzzles: recordArray(value.puzzles, "puzzles").map((row) => ({
      ...metricsValue(row),
      puzzleId: textValue(row, "puzzleId")!,
      puzzleRevision: numberValue(row, "puzzleRevision")!,
      title: textValue(row, "title", true),
      releaseDate: textValue(row, "releaseDate", true),
      difficulty: numberValue(row, "difficulty", true),
      difficultyLabel: textValue(row, "difficultyLabel", true)
    })),
    difficulties: recordArray(value.difficulties, "difficulties").map((row) => ({
      ...metricsValue(row),
      difficulty: numberValue(row, "difficulty", true),
      difficultyLabel: textValue(row, "difficultyLabel", true)
    }))
  };
}

function errorMessage(value: unknown, status: number): string {
  if (isRecord(value) && typeof value.message === "string") return value.message;
  return `No se pudo cargar la analítica (${status}).`;
}

export function createSupabaseAnalyticsDashboardLoader(
  config: SupabaseConfig,
  accessToken: () => Promise<string>,
  fetchImpl: FetchLike = globalThis.fetch
): PuzzleAnalyticsLoader {
  const endpoint = new URL("/functions/v1/puzzle-admin", config.url);
  return async (days, signal) => {
    const token = await accessToken();
    if (!token) throw new Error("La sesión de administración ha caducado.");
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        apikey: config.publishableKey,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ action: "analytics", days }),
      ...(signal ? { signal } : {})
    });
    const body: unknown = await response.json();
    if (!response.ok) throw new Error(errorMessage(body, response.status));
    if (!isRecord(body)) throw new Error("Supabase returned invalid analytics.");
    return decodePuzzleAnalyticsReport(body.analytics);
  };
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: { className?: string; text?: string; attributes?: Record<string, string | undefined> } = {}
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options.className) node.className = options.className;
  if (options.text !== undefined) node.textContent = options.text;
  for (const [name, value] of Object.entries(options.attributes ?? {})) {
    if (value !== undefined) node.setAttribute(name, value);
  }
  return node;
}

function pageHref(pageUrl: string | null | undefined, mode: "play" | "author" | "analytics"): string {
  const target = new URL(pageUrl ?? globalThis.location?.href ?? document.baseURI, document.baseURI);
  target.hash = "";
  target.search = "";
  if (mode !== "play") target.searchParams.set("mode", mode);
  return target.href;
}

export function startAnalyticsDashboard({
  mount,
  locale: localeOption,
  loadReport,
  onSignOut = null,
  pageUrl = null
}: StartAnalyticsDashboardOptions): AnalyticsDashboardHandle {
  const locale = applyBrandName(localeOption);
  const text = (key: string, fallback: string): string => locale.ui[key] ?? fallback;
  const countFormat = new Intl.NumberFormat(locale.id, { maximumFractionDigits: 0 });
  const decimalFormat = new Intl.NumberFormat(locale.id, { maximumFractionDigits: 1 });
  const percentFormat = new Intl.NumberFormat(locale.id, { style: "percent", maximumFractionDigits: 1 });
  const dateTimeFormat = new Intl.DateTimeFormat(locale.id, { dateStyle: "medium", timeStyle: "short" });
  const periodOptions: ReadonlyArray<{ readonly value: string; readonly days: AnalyticsPeriodDays; readonly label: string }> = [
    { value: "7", days: 7, label: text("analyticsPeriod7", "7 días") },
    { value: "30", days: 30, label: text("analyticsPeriod30", "30 días") },
    { value: "90", days: 90, label: text("analyticsPeriod90", "90 días") },
    { value: "all", days: null, label: text("analyticsPeriodAll", "Todo el periodo") }
  ];
  let period: AnalyticsPeriodDays = 30;
  let report: PuzzleAnalyticsReport | null = null;
  let controller: AbortController | null = null;
  let destroyed = false;

  const shell = element("div", { className: "analytics-shell", attributes: { lang: locale.id, dir: locale.dir } });
  const header = element("header", { className: "analytics-header" });
  const identity = element("div");
  identity.append(element("h1", { className: "brand", text: text("analyticsTitle", "Analítica de Entre Paréntesis") }));
  const nav = element("nav", { className: "mode-nav", attributes: { "aria-label": locale.ui.modeNavigation } });
  nav.append(
    element("a", { className: "mode-link", text: locale.ui.playMode ?? "Jugar", attributes: { href: pageHref(pageUrl, "play") } }),
    element("a", { className: "mode-link", text: locale.ui.authorMode ?? "Crear", attributes: { href: pageHref(pageUrl, "author") } }),
    element("a", {
      className: "mode-link",
      text: text("analyticsMode", "Analítica"),
      attributes: { href: pageHref(pageUrl, "analytics"), "aria-current": "page" }
    })
  );
  if (typeof onSignOut === "function") {
    const signOut = element("button", {
      className: "mode-link",
      text: locale.ui.authorSignOut ?? "Cerrar sesión",
      attributes: { type: "button", "data-testid": "manager-sign-out" }
    });
    signOut.addEventListener("click", () => {
      signOut.disabled = true;
      Promise.resolve(onSignOut()).catch(() => { signOut.disabled = false; });
    });
    nav.append(signOut);
  }
  header.append(identity, nav);

  const toolbar = element("div", { className: "analytics-toolbar" });
  const periodLabel = element("label", { className: "author-control-label", text: text("analyticsPeriod", "Periodo") });
  const periodSelect = element("select", {
    className: "author-input analytics-period-select",
    attributes: { "data-testid": "analytics-period" }
  });
  for (const option of periodOptions) periodSelect.append(element("option", { text: option.label, attributes: { value: option.value } }));
  periodSelect.value = "30";
  periodLabel.append(periodSelect);
  const refreshed = element("p", { className: "analytics-refreshed", attributes: { "data-testid": "analytics-refreshed" } });
  toolbar.append(periodLabel, refreshed);

  const status = element("p", {
    className: "analytics-status",
    attributes: { role: "status", "aria-live": "polite", "data-testid": "analytics-status" }
  });
  const content = element("main", { className: "analytics-content", attributes: { "data-testid": "analytics-content" } });
  shell.append(header, toolbar, status, content);
  mount.replaceChildren(shell);

  const formatNumber = (value: number | null): string => value === null ? "—" : decimalFormat.format(value);
  const formatPercent = (value: number | null): string => value === null ? "—" : percentFormat.format(value);
  const formatScore = (metrics: AnalyticsMetrics): string => {
    if (metrics.meanScore === null || metrics.meanMaxScore === null) return "—";
    const raw = `${decimalFormat.format(metrics.meanScore)} / ${decimalFormat.format(metrics.meanMaxScore)}`;
    return metrics.meanNormalizedScore === null ? raw : `${raw} · ${formatPercent(metrics.meanNormalizedScore)}`;
  };
  const formatDuration = (seconds: number | null): string => {
    if (seconds === null) return "—";
    const rounded = Math.round(seconds);
    const minutes = Math.floor(rounded / 60);
    const remainder = rounded % 60;
    return minutes ? `${minutes} min ${remainder} s` : `${remainder} s`;
  };
  const difficultyName = (label: string | null, value: number | null): string => {
    if (!label) return locale.ui.difficultyUnset ?? "Sin especificar";
    const name = locale.ui[`difficulty_${label}`] ?? label;
    return value === null ? name : `${value} · ${name}`;
  };

  const metricCard = (label: string, value: string, testId: string): HTMLElement => {
    const card = element("article", { className: "analytics-card", attributes: { "data-testid": testId } });
    card.append(
      element("span", { className: "analytics-card-label", text: label }),
      element("strong", { className: "analytics-card-value", text: value })
    );
    return card;
  };

  const appendCell = (row: HTMLTableRowElement, value: string, header = false): void => {
    row.append(element(header ? "th" : "td", { text: value, attributes: header ? { scope: "col" } : {} }));
  };

  const renderTable = (
    heading: string,
    headers: readonly string[],
    rows: readonly (readonly string[])[],
    testId: string
  ): HTMLElement => {
    const section = element("section", { className: "analytics-section" });
    section.append(element("h2", { text: heading }));
    if (rows.length === 0) {
      section.append(element("p", { className: "analytics-empty", text: text("analyticsEmpty", "Todavía no hay datos para este periodo.") }));
      return section;
    }
    const scroll = element("div", {
      className: "analytics-table-scroll",
      attributes: { tabindex: "0", "aria-label": heading }
    });
    const table = element("table", { className: "analytics-table", attributes: { "data-testid": testId } });
    const head = element("thead");
    const headerRow = element("tr");
    for (const headerText of headers) appendCell(headerRow, headerText, true);
    head.append(headerRow);
    const body = element("tbody");
    for (const values of rows) {
      const row = element("tr");
      values.forEach((value, index) => {
        if (index === 0) row.append(element("th", { text: value, attributes: { scope: "row" } }));
        else appendCell(row, value);
      });
      body.append(row);
    }
    table.append(head, body);
    scroll.append(table);
    section.append(scroll);
    return section;
  };

  const renderReport = (next: PuzzleAnalyticsReport): void => {
    const summary = element("section", { className: "analytics-section" });
    summary.append(element("h2", { text: text("analyticsSummary", "Resumen") }));
    const cards = element("div", { className: "analytics-summary-grid" });
    cards.append(
      metricCard(text("analyticsLoads", "Cargas"), countFormat.format(next.summary.loads), "analytics-loads"),
      metricCard(text("analyticsCompletions", "Finalizaciones"), countFormat.format(next.summary.completions), "analytics-completions"),
      metricCard(text("analyticsCompletionRate", "Tasa de finalización"), formatPercent(next.summary.completionRate), "analytics-completion-rate"),
      metricCard(text("analyticsMeanScore", "Puntuación media"), formatScore(next.summary), "analytics-mean-score"),
      metricCard(text("analyticsMedianScore", "Puntuación normalizada mediana"), formatPercent(next.summary.medianNormalizedScore), "analytics-median-score"),
      metricCard(text("analyticsMeanTime", "Tiempo medio"), formatDuration(next.summary.meanCompletionSeconds), "analytics-mean-time"),
      metricCard(text("analyticsMeanMistakes", "Errores medios"), formatNumber(next.summary.meanMistakes), "analytics-mean-mistakes"),
      metricCard(text("analyticsMeanHints", "Pistas medias"), formatNumber(next.summary.meanHints), "analytics-mean-hints")
    );
    summary.append(cards);

    const headers = [
      text("analyticsPuzzle", "Rompecabezas"),
      locale.ui.difficulty ?? "Dificultad",
      text("analyticsLoads", "Cargas"),
      text("analyticsCompletions", "Finalizaciones"),
      text("analyticsCompletionRate", "Tasa"),
      text("analyticsMeanScore", "Puntuación media"),
      text("analyticsMedianScoreShort", "Mediana normalizada"),
      text("analyticsMeanTime", "Tiempo medio"),
      text("analyticsMeanMistakes", "Errores medios"),
      text("analyticsMeanHints", "Pistas medias")
    ];
    const puzzleRows = next.puzzles.map((row) => [
      `${row.title ?? row.puzzleId} · r${row.puzzleRevision}`,
      difficultyName(row.difficultyLabel, row.difficulty),
      countFormat.format(row.loads),
      countFormat.format(row.completions),
      formatPercent(row.completionRate),
      formatScore(row),
      formatPercent(row.medianNormalizedScore),
      formatDuration(row.meanCompletionSeconds),
      formatNumber(row.meanMistakes),
      formatNumber(row.meanHints)
    ]);
    const difficultyRows = next.difficulties.map((row) => [
      difficultyName(row.difficultyLabel, row.difficulty),
      countFormat.format(row.loads),
      countFormat.format(row.completions),
      formatPercent(row.completionRate),
      formatScore(row),
      formatPercent(row.medianNormalizedScore),
      formatDuration(row.meanCompletionSeconds),
      formatNumber(row.meanMistakes),
      formatNumber(row.meanHints)
    ]);
    content.replaceChildren(
      summary,
      renderTable(text("analyticsByPuzzle", "Rendimiento por rompecabezas"), headers, puzzleRows, "analytics-puzzle-table"),
      renderTable(
        text("analyticsByDifficulty", "Calibración por dificultad"),
        headers.slice(1),
        difficultyRows,
        "analytics-difficulty-table"
      )
    );
    const generated = new Date(next.generatedAt);
    refreshed.textContent = Number.isNaN(generated.getTime())
      ? ""
      : `${text("analyticsUpdated", "Actualizado")}: ${dateTimeFormat.format(generated)}`;
  };

  const refresh = async (): Promise<void> => {
    controller?.abort();
    controller = new AbortController();
    const activeController = controller;
    periodSelect.disabled = true;
    status.textContent = text("analyticsLoading", "Cargando analítica…");
    content.setAttribute("aria-busy", "true");
    try {
      const next = await loadReport(period, activeController.signal);
      if (destroyed || controller !== activeController) return;
      report = next;
      renderReport(next);
      status.textContent = "";
    } catch (error: unknown) {
      if (destroyed || controller !== activeController || activeController.signal.aborted) return;
      const message = error instanceof Error ? error.message : String(error);
      status.textContent = "";
      content.replaceChildren(element("p", { className: "analytics-error", text: message, attributes: { role: "alert" } }));
    } finally {
      if (!destroyed && controller === activeController) {
        periodSelect.disabled = false;
        content.removeAttribute("aria-busy");
      }
    }
  };

  periodSelect.addEventListener("change", () => {
    const selectedPeriod = periodOptions.find((option) => option.value === periodSelect.value);
    period = selectedPeriod ? selectedPeriod.days : 30;
    void refresh();
  });
  document.documentElement.lang = locale.id;
  document.documentElement.dir = locale.dir;
  document.title = `${text("analyticsMode", "Analítica")} — ${locale.ui.gameName}`;
  void refresh();

  return {
    getReport: () => report,
    refresh,
    destroy() {
      destroyed = true;
      controller?.abort();
    }
  };
}
