import { Data, Effect } from "effect";

import {
  decodeCatalogEntry,
  decodePuzzleDefinition,
  decodeSupabaseConfig
} from "./effect.ts";
import type {
  AuthenticatedSupabaseConfig,
  CatalogEntry,
  PuzzleDefinition,
  PuzzleListing,
  PuzzleRepositoryConfig,
  SupabaseConfig
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
  if (definition.id !== existingDefinition.id) {
    throw new PuzzleRepositoryError(
      "CORRECTION_ID_MISMATCH",
      messages.idMismatch ?? "La corrección debe conservar el identificador del rompecabezas.",
      422
    );
  }
  const existingRevision = existingDefinition.revision ?? 1;
  if (!Number.isSafeInteger(definition.revision) || definition.revision === undefined || definition.revision <= existingRevision) {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function responseMessage(body: unknown, status: number): string {
  if (!isRecord(body)) return `La solicitud falló (${status}).`;
  const message = body.message ?? body.error;
  return typeof message === "string" ? message : `La solicitud falló (${status}).`;
}

async function responseBody(response: Response): Promise<unknown> {
  const contentType = response.headers?.get?.("content-type") ?? "";
  if (contentType.toLocaleLowerCase().includes("json")) return response.json();
  const text = await response.text();
  throw new PuzzleRepositoryError(
    "INVALID_CONTENT_TYPE",
    "Supabase devolvió una respuesta que no era JSON.",
    response.status,
    text
  );
}

export function readSupabaseConfig(doc: Document = globalThis.document): SupabaseConfig | null {
  const node = doc?.querySelector?.("#nexo-supabase-config");
  if (!node) return null;
  try {
    const config: unknown = JSON.parse(node.textContent || "{}");
    if (!isRecord(config)) throw new Error("Configuration must be an object.");
    const url = new URL(String(config.url ?? ""));
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
      throw new Error("url must be an HTTPS origin.");
    }
    if (url.pathname !== "/") throw new Error("url must not contain a path.");
    if (typeof config.publishableKey !== "string" || !config.publishableKey.startsWith("sb_publishable_")) {
      throw new Error("publishableKey is required.");
    }
    return Effect.runSync(decodeSupabaseConfig("Supabase DOM configuration", {
      ...config,
      url: trimSlash(url.href),
      publishableKey: config.publishableKey,
      authorModeEnabled: config.authorModeEnabled === true,
      canAuthor: false,
      timeZone: typeof config.timeZone === "string" ? config.timeZone : "Europe/Madrid"
    }));
  } catch (error) {
    throw new PuzzleRepositoryError("INVALID_CONFIG", `Configuración de Supabase no válida: ${errorMessage(error)}`);
  }
}

export interface PuzzleRepository<C extends PuzzleRepositoryConfig = PuzzleRepositoryConfig> {
  readonly config: C;
  readonly listPublic: (signal?: AbortSignal) => Promise<PuzzleListing>;
  readonly listAdmin: (signal?: AbortSignal) => Promise<PuzzleListing>;
  readonly loadPublic: (date: string, signal?: AbortSignal) => Promise<PuzzleDefinition>;
  readonly loadAdmin: (date: string, signal?: AbortSignal) => Promise<PuzzleDefinition>;
  readonly save: (
    definition: PuzzleDefinition,
    options?: { overwrite?: boolean; expectedRevision?: number; signal?: AbortSignal }
  ) => Promise<unknown>;
  readonly trashPuzzle: (date: string, signal?: AbortSignal) => Promise<unknown>;
  readonly restorePuzzle: (date: string, signal?: AbortSignal) => Promise<unknown>;
}

export type SupabasePuzzleRepository = PuzzleRepository<SupabaseConfig>;
export type AuthenticatedSupabasePuzzleRepository = PuzzleRepository<AuthenticatedSupabaseConfig>;

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type AccessTokenProvider = () => Promise<string>;

export function createSupabasePuzzleRepository(
  config: SupabaseConfig,
  fetchImpl: FetchLike = globalThis.fetch
): SupabasePuzzleRepository {
  if (!config?.url || !config.publishableKey || typeof fetchImpl !== "function") {
    throw new PuzzleRepositoryError("INVALID_CONFIG", "Falta la configuración del repositorio de rompecabezas.");
  }
  const base = trimSlash(config.url);
  const request = async (query: URLSearchParams, signal?: AbortSignal): Promise<unknown> => {
    const url = new URL(`${base}/rest/v1/puzzles`);
    url.search = query.toString();
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "GET",
        headers: { Accept: "application/json", apikey: config.publishableKey },
        ...(signal ? { signal } : {})
      });
    } catch (error) {
      throw new PuzzleRepositoryError("NETWORK_ERROR", `No se pudo conectar con Supabase. ${errorMessage(error)}`);
    }
    const parsed = await responseBody(response);
    if (!response.ok) {
      throw new PuzzleRepositoryError("REQUEST_FAILED", responseMessage(parsed, response.status), response.status, parsed);
    }
    return parsed;
  };
  const authRequired = (): never => {
    throw new PuzzleRepositoryError(
      "AUTH_REQUIRED",
      "La administración de rompecabezas requiere una sesión de Supabase.",
      403
    );
  };

  return {
    config,
    async listPublic(signal) {
      const result = await request(new URLSearchParams({
        select: "release_date,puzzle_id,revision",
        status: "eq.published",
        order: "release_date.desc"
      }), signal);
      if (!Array.isArray(result)) {
        throw new PuzzleRepositoryError("INVALID_RESPONSE", "Supabase devolvió una lista no válida.");
      }
      const entries = await Promise.all(result.map((row, index): Promise<CatalogEntry> => {
        if (!isRecord(row)) throw new PuzzleRepositoryError("INVALID_RESPONSE", "Supabase devolvió una fila no válida.");
        return Effect.runPromise(decodeCatalogEntry(`Supabase puzzle listing[${index}]`, {
          date: row.release_date,
          id: row.puzzle_id,
          revision: row.revision
        }));
      }));
      return {
        entries,
        ...(config.currentDate ? { currentDate: config.currentDate } : {}),
        timeZone: config.timeZone ?? "Europe/Madrid"
      };
    },
    async loadPublic(date, signal) {
      const result = await request(new URLSearchParams({
        select: "definition",
        release_date: `eq.${date}`,
        status: "eq.published",
        limit: "1"
      }), signal);
      if (!Array.isArray(result) || result.length !== 1 || !isRecord(result[0])) {
        throw new PuzzleRepositoryError("NOT_FOUND", "No se encontró el rompecabezas solicitado.", 404);
      }
      return Effect.runPromise(decodePuzzleDefinition(`Supabase puzzle ${date}`, result[0].definition));
    },
    listAdmin: async () => authRequired(),
    loadAdmin: async () => authRequired(),
    save: async () => authRequired(),
    trashPuzzle: async () => authRequired(),
    restorePuzzle: async () => authRequired()
  };
}

export function createAuthenticatedSupabasePuzzleRepository(
  config: SupabaseConfig,
  accessToken: AccessTokenProvider,
  fetchImpl: FetchLike = globalThis.fetch
): AuthenticatedSupabasePuzzleRepository {
  if (!config?.url || !config.publishableKey || typeof accessToken !== "function" || typeof fetchImpl !== "function") {
    throw new PuzzleRepositoryError("INVALID_CONFIG", "Falta la configuración de administración de rompecabezas.");
  }
  const adminConfig: AuthenticatedSupabaseConfig = { ...config, canAuthor: true };
  const endpoint = `${trimSlash(config.url)}/functions/v1/puzzle-admin`;
  const request = async (body: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> => {
    const token = await accessToken();
    if (!token) throw new PuzzleRepositoryError("AUTH_REQUIRED", "La sesión de administración ha caducado.", 401);
    let response: Response;
    try {
      response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          apikey: config.publishableKey,
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(body),
        ...(signal ? { signal } : {})
      });
    } catch (error) {
      throw new PuzzleRepositoryError("NETWORK_ERROR", `No se pudo conectar con Supabase. ${errorMessage(error)}`);
    }
    const parsed = await responseBody(response);
    if (!response.ok) {
      const code = response.status === 401 || response.status === 403
        ? "AUTH_REQUIRED"
        : isRecord(parsed) && typeof parsed.code === "string" ? parsed.code : "REQUEST_FAILED";
      throw new PuzzleRepositoryError(code, responseMessage(parsed, response.status), response.status, parsed);
    }
    return parsed;
  };
  const publicRepository = createSupabasePuzzleRepository(config, fetchImpl);

  return {
    config: adminConfig,
    listPublic: publicRepository.listPublic,
    loadPublic: publicRepository.loadPublic,
    async listAdmin(signal) {
      const result = await request({ action: "list" }, signal);
      if (!isRecord(result) || !Array.isArray(result.puzzles)) {
        throw new PuzzleRepositoryError("INVALID_RESPONSE", "Supabase devolvió una lista no válida.");
      }
      const entries = await Promise.all(result.puzzles.map((row, index): Promise<CatalogEntry> => {
        if (!isRecord(row)) throw new PuzzleRepositoryError("INVALID_RESPONSE", "Supabase devolvió una fila no válida.");
        return Effect.runPromise(decodeCatalogEntry(`Supabase admin puzzle listing[${index}]`, {
          date: row.release_date,
          id: row.puzzle_id,
          revision: row.revision
        }));
      }));
      return {
        entries,
        ...(typeof result.currentDate === "string" ? { currentDate: result.currentDate } : {}),
        timeZone: "Europe/Madrid"
      };
    },
    async loadAdmin(date, signal) {
      const result = await request({ action: "load", date }, signal);
      if (!isRecord(result) || !Object.hasOwn(result, "definition")) {
        throw new PuzzleRepositoryError("INVALID_RESPONSE", "Supabase devolvió un rompecabezas no válido.");
      }
      return Effect.runPromise(decodePuzzleDefinition(`Supabase admin puzzle ${date}`, result.definition));
    },
    save(definition, { overwrite = false, expectedRevision, signal } = {}) {
      return request({
        action: "save",
        definition,
        overwrite,
        ...(overwrite && expectedRevision !== undefined ? { expectedRevision } : {})
      }, signal);
    },
    trashPuzzle(date, signal) {
      return request({ action: "trash", date }, signal);
    },
    restorePuzzle(date, signal) {
      return request({ action: "restore", date }, signal);
    }
  };
}
