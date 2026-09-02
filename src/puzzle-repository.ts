import { Data, Effect } from "effect";

import { restorePublishedPuzzles } from "./published.ts";
import { decodeCatalogEntry, decodePuzzleDefinition, decodeWordPressConfig } from "./effect.ts";
import type {
  CatalogEntry,
  ExistingPuzzle,
  ImportResult,
  LocalePack,
  PuzzleDefinition,
  PuzzleListing,
  StorageLike,
  WordPressConfig
} from "./types.ts";

export class PuzzleRepositoryError extends Data.TaggedError("PuzzleRepositoryError")<{
  readonly code: string;
  readonly message: string;
  readonly status: number;
  readonly details: unknown;
}> {
  constructor(code: string, message: string, status = 0, details: unknown = null) {
    super({ code, message, status, details });
  }
}

export function assertValidCorrection(
  definition: PuzzleDefinition,
  existingDefinition: PuzzleDefinition | undefined,
  messages: { idMismatch?: string; revisionRequired?: string } = {}
): void {
  if (!existingDefinition) return;
  if (definition?.id !== existingDefinition.id) {
    throw new PuzzleRepositoryError(
      "CORRECTION_ID_MISMATCH",
      messages.idMismatch ?? "La corrección debe conservar el identificador del rompecabezas.",
      422
    );
  }
  const existingRevision = existingDefinition.revision ?? 1;
  const nextRevision = definition.revision;
  if (!Number.isSafeInteger(nextRevision) || nextRevision === undefined || nextRevision <= existingRevision) {
    throw new PuzzleRepositoryError(
      "CORRECTION_REVISION_REQUIRED",
      messages.revisionRequired ?? "La corrección debe usar una revisión superior.",
      422
    );
  }
}

function trimSlash(value: unknown): string {
  return String(value ?? "").replace(/\/+$/u, "");
}

export function latestAvailablePuzzleDate(entries: readonly CatalogEntry[] | unknown): string | null {
  if (!Array.isArray(entries)) return null;
  return entries.reduce<string | null>((latest, entry) => {
    const date = entry?.date;
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(date)) return latest;
    return latest === null || date > latest ? date : latest;
  }, null);
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function responseMessage(body: unknown, status: number): string {
  if (!isRecord(body)) return `La solicitud falló (${status}).`;
  return body?.message ?? body?.error ?? `La solicitud falló (${status}).`;
}

async function responseBody(response: Response): Promise<unknown> {
  const contentType = response.headers?.get?.("content-type") ?? "";
  if (contentType.toLocaleLowerCase().includes("json")) return response.json();
  const text = await response.text();
  throw new PuzzleRepositoryError(
    "INVALID_CONTENT_TYPE",
    "WordPress devolvió una respuesta que no era JSON.",
    response.status,
    text
  );
}

export function readWordPressConfig(doc: Document = globalThis.document): WordPressConfig | null {
  const node = doc?.querySelector?.("#bracket-city-config");
  if (!node) return null;
  try {
    const config: unknown = JSON.parse(node.textContent || "{}");
    if (!isRecord(config)) throw new Error("Configuration must be an object.");
    if (!config.restBase) throw new Error("restBase is required.");
    const normalized = {
      ...config,
      restBase: trimSlash(config.restBase),
      canAuthor: config.canAuthor === true,
      nonce: typeof config.nonce === "string" ? config.nonce : ""
    };
    return Effect.runSync(decodeWordPressConfig("WordPress DOM configuration", normalized));
  } catch (error) {
    throw new PuzzleRepositoryError("INVALID_CONFIG", `Configuración de WordPress no válida: ${errorMessage(error)}`);
  }
}

export interface WordPressPuzzleRepository {
  readonly config: WordPressConfig;
  readonly listPublic: (signal?: AbortSignal) => Promise<PuzzleListing>;
  readonly listAdmin: (signal?: AbortSignal) => Promise<PuzzleListing>;
  readonly loadPublic: (date: string, signal?: AbortSignal) => Promise<PuzzleDefinition>;
  readonly loadAdmin: (date: string, signal?: AbortSignal) => Promise<PuzzleDefinition>;
  readonly save: (
    definition: PuzzleDefinition,
    options?: { overwrite?: boolean; signal?: AbortSignal }
  ) => Promise<unknown>;
}

export interface EffectPuzzleRepository {
  readonly config: WordPressConfig;
  readonly listPublic: Effect.Effect<PuzzleListing, PuzzleRepositoryError>;
  readonly listAdmin: Effect.Effect<PuzzleListing, PuzzleRepositoryError>;
  readonly loadPublic: (date: string) => Effect.Effect<PuzzleDefinition, PuzzleRepositoryError>;
  readonly loadAdmin: (date: string) => Effect.Effect<PuzzleDefinition, PuzzleRepositoryError>;
  readonly save: (
    definition: PuzzleDefinition,
    options?: { overwrite?: boolean }
  ) => Effect.Effect<unknown, PuzzleRepositoryError>;
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export function createWordPressPuzzleRepository(
  config: WordPressConfig,
  fetchImpl: FetchLike = globalThis.fetch
): WordPressPuzzleRepository {
  if (!config?.restBase || typeof fetchImpl !== "function") {
    throw new PuzzleRepositoryError("INVALID_CONFIG", "Falta la configuración del repositorio de rompecabezas.");
  }
  const base = trimSlash(config.restBase);
  const request = async (
    path: string,
    { method = "GET", body, authenticated = false, signal }: {
      method?: string;
      body?: unknown;
      authenticated?: boolean;
      signal?: AbortSignal | undefined;
    } = {}
  ): Promise<unknown> => {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (authenticated) {
      if (!config.canAuthor || !config.nonce) {
        throw new PuzzleRepositoryError("AUTH_REQUIRED", "Inicia sesión como editor para guardar rompecabezas.", 403);
      }
      headers["X-WP-Nonce"] = config.nonce;
    }
    let response: Response;
    try {
      const init: RequestInit = {
        method,
        headers,
        credentials: "same-origin"
      };
      if (signal) init.signal = signal;
      if (body !== undefined) init.body = JSON.stringify(body);
      response = await fetchImpl(`${base}${path}`, init);
    } catch (error) {
      throw new PuzzleRepositoryError("NETWORK_ERROR", `No se pudo conectar con WordPress. ${errorMessage(error)}`);
    }
    const parsed = await responseBody(response);
    if (!response.ok) {
      const code = response.status === 409 ? "DATE_EXISTS"
        : response.status === 401 || response.status === 403 ? "AUTH_REQUIRED"
          : isRecord(parsed) && typeof parsed.code === "string" ? parsed.code : "REQUEST_FAILED";
      throw new PuzzleRepositoryError(code, responseMessage(parsed, response.status), response.status, parsed);
    }
    return parsed;
  };

  const list = async (admin = false, signal?: AbortSignal): Promise<PuzzleListing> => {
    const result = await request(admin ? "/admin/puzzles" : "/puzzles", { authenticated: admin, signal });
    if (!isRecord(result)) throw new PuzzleRepositoryError("INVALID_RESPONSE", "WordPress devolvió una respuesta no válida.");
    const entries: unknown = result.puzzles ?? result.dates ?? [];
    if (!Array.isArray(entries)) throw new PuzzleRepositoryError("INVALID_RESPONSE", "WordPress devolvió una lista no válida.");
    const decodedEntries = await Promise.all(entries.map((entry, index): Promise<CatalogEntry> => (
      typeof entry === "string"
        ? Promise.resolve({ date: entry })
        : Effect.runPromise(decodeCatalogEntry(`WordPress puzzle listing[${index}]`, entry))
    )));
    return {
      entries: decodedEntries,
      currentDate: result.currentDate ?? config.currentDate ?? null,
      timeZone: result.timeZone ?? config.timeZone ?? "Europe/Madrid"
    } as PuzzleListing;
  };

  return {
    config,
    listPublic: (signal) => list(false, signal),
    listAdmin: (signal) => list(true, signal),
    loadPublic: async (date, signal) => Effect.runPromise(decodePuzzleDefinition(
      `WordPress puzzle ${date}`,
      await request(`/puzzles/${encodeURIComponent(date)}`, { signal })
    )),
    loadAdmin: async (date, signal) => Effect.runPromise(decodePuzzleDefinition(
      `WordPress admin puzzle ${date}`,
      await request(`/admin/puzzles/${encodeURIComponent(date)}`, { authenticated: true, signal })
    )),
    save(definition, { overwrite = false, signal } = {}) {
      const date = definition?.releaseDate;
      if (!date) throw new PuzzleRepositoryError("DATE_REQUIRED", "Indica una fecha de publicación.");
      return request(overwrite ? `/puzzles/${encodeURIComponent(date)}` : "/puzzles", {
        method: overwrite ? "PUT" : "POST",
        body: definition,
        authenticated: true,
        signal
      });
    }
  };
}

function repositoryEffect<A>(operation: (signal: AbortSignal) => Promise<A>): Effect.Effect<A, PuzzleRepositoryError> {
  return Effect.tryPromise({
    try: operation,
    catch: (error) => error instanceof PuzzleRepositoryError
      ? error
      : new PuzzleRepositoryError("REQUEST_FAILED", errorMessage(error))
  });
}

export function createWordPressPuzzleRepositoryEffect(
  config: WordPressConfig,
  fetchImpl: FetchLike = globalThis.fetch
): EffectPuzzleRepository {
  const repository = createWordPressPuzzleRepository(config, fetchImpl);
  return {
    config,
    listPublic: repositoryEffect((signal) => repository.listPublic(signal)),
    listAdmin: repositoryEffect((signal) => repository.listAdmin(signal)),
    loadPublic: (date) => repositoryEffect((signal) => repository.loadPublic(date, signal)),
    loadAdmin: (date) => repositoryEffect((signal) => repository.loadAdmin(date, signal)),
    save: (definition, options) => repositoryEffect((signal) => repository.save(definition, { ...options, signal }))
  };
}

export function getLegacyPublishedPuzzles(storage: StorageLike | null, localePack: LocalePack): PuzzleDefinition[] {
  return restorePublishedPuzzles(storage, localePack);
}

export async function importLegacyPublishedPuzzles(
  repository: Pick<WordPressPuzzleRepository, "save">,
  definitions: readonly PuzzleDefinition[],
  existingDates: Set<string> = new Set()
): Promise<ImportResult[]> {
  const results: ImportResult[] = [];
  for (const definition of definitions) {
    const date = definition.releaseDate;
    if (!date) continue;
    if (existingDates.has(date)) {
      results.push({ date, ok: true, skipped: true });
      continue;
    }
    try {
      const result = await repository.save(definition, { overwrite: false });
      existingDates.add(date);
      results.push({ date, ok: true, result });
    } catch (error) {
      results.push({ date, ok: false, error });
    }
  }
  return results;
}

export function addSuccessfulLegacyImports(
  existingPuzzles: ExistingPuzzle[],
  definitions: readonly PuzzleDefinition[],
  results: readonly ImportResult[]
): ExistingPuzzle[] {
  for (const definition of definitions) {
    if (!definition.releaseDate) continue;
    const result = results.find((item) => item.date === definition.releaseDate);
    if (!result?.ok || result.skipped) continue;
    if (!existingPuzzles.some((item) => item.date === definition.releaseDate)) {
      existingPuzzles.push({ date: definition.releaseDate, definition: structuredClone(definition) });
    }
  }
  existingPuzzles.sort((left, right) => right.date.localeCompare(left.date));
  return existingPuzzles;
}
