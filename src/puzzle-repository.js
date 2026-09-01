import { restorePublishedPuzzles } from "./published.js";

export class PuzzleRepositoryError extends Error {
  constructor(code, message, status = 0, details = null) {
    super(message);
    this.name = "PuzzleRepositoryError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function assertValidCorrection(definition, existingDefinition, messages = {}) {
  if (!existingDefinition) return;
  if (definition?.id !== existingDefinition.id) {
    throw new PuzzleRepositoryError(
      "CORRECTION_ID_MISMATCH",
      messages.idMismatch ?? "La corrección debe conservar el identificador del rompecabezas.",
      422
    );
  }
  const existingRevision = existingDefinition.revision ?? 1;
  if (!Number.isSafeInteger(definition?.revision) || definition.revision <= existingRevision) {
    throw new PuzzleRepositoryError(
      "CORRECTION_REVISION_REQUIRED",
      messages.revisionRequired ?? "La corrección debe usar una revisión superior.",
      422
    );
  }
}

function trimSlash(value) {
  return String(value ?? "").replace(/\/+$/u, "");
}

export function latestAvailablePuzzleDate(entries) {
  if (!Array.isArray(entries)) return null;
  return entries.reduce((latest, entry) => {
    const date = entry?.date;
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(date)) return latest;
    return latest === null || date > latest ? date : latest;
  }, null);
}

function responseMessage(body, status) {
  return body?.message ?? body?.error ?? `La solicitud falló (${status}).`;
}

async function responseBody(response) {
  const contentType = response.headers?.get?.("content-type") ?? "";
  if (contentType.includes("json")) return response.json();
  const text = await response.text();
  try { return JSON.parse(text); } catch { return text ? { message: text } : null; }
}

export function readWordPressConfig(doc = globalThis.document) {
  const node = doc?.querySelector?.("#bracket-city-config");
  if (!node) return null;
  try {
    const config = JSON.parse(node.textContent || "{}");
    if (!config.restBase) throw new Error("restBase is required.");
    return {
      ...config,
      restBase: trimSlash(config.restBase),
      canAuthor: config.canAuthor === true,
      nonce: typeof config.nonce === "string" ? config.nonce : ""
    };
  } catch (error) {
    throw new PuzzleRepositoryError("INVALID_CONFIG", `Configuración de WordPress no válida: ${error.message}`);
  }
}

export function createWordPressPuzzleRepository(config, fetchImpl = globalThis.fetch) {
  if (!config?.restBase || typeof fetchImpl !== "function") {
    throw new PuzzleRepositoryError("INVALID_CONFIG", "Falta la configuración del repositorio de rompecabezas.");
  }
  const base = trimSlash(config.restBase);
  const request = async (path, { method = "GET", body, authenticated = false } = {}) => {
    const headers = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (authenticated) {
      if (!config.canAuthor || !config.nonce) {
        throw new PuzzleRepositoryError("AUTH_REQUIRED", "Inicia sesión como editor para guardar rompecabezas.", 403);
      }
      headers["X-WP-Nonce"] = config.nonce;
    }
    let response;
    try {
      response = await fetchImpl(`${base}${path}`, {
        method,
        headers,
        credentials: "same-origin",
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    } catch (error) {
      throw new PuzzleRepositoryError("NETWORK_ERROR", `No se pudo conectar con WordPress. ${error.message}`);
    }
    const parsed = await responseBody(response);
    if (!response.ok) {
      const code = response.status === 409 ? "DATE_EXISTS"
        : response.status === 401 || response.status === 403 ? "AUTH_REQUIRED"
          : parsed?.code ?? "REQUEST_FAILED";
      throw new PuzzleRepositoryError(code, responseMessage(parsed, response.status), response.status, parsed);
    }
    return parsed;
  };

  const list = async (admin = false) => {
    const result = await request(admin ? "/admin/puzzles" : "/puzzles", { authenticated: admin });
    const entries = result?.puzzles ?? result?.dates ?? [];
    if (!Array.isArray(entries)) throw new PuzzleRepositoryError("INVALID_RESPONSE", "WordPress devolvió una lista no válida.");
    return {
      entries: entries.map((entry) => typeof entry === "string" ? { date: entry } : entry),
      currentDate: result.currentDate ?? config.currentDate ?? null,
      timeZone: result.timeZone ?? config.timeZone ?? "Europe/Madrid"
    };
  };

  return {
    config,
    listPublic: () => list(false),
    listAdmin: () => list(true),
    loadPublic: (date) => request(`/puzzles/${encodeURIComponent(date)}`),
    loadAdmin: (date) => request(`/admin/puzzles/${encodeURIComponent(date)}`, { authenticated: true }),
    save(definition, { overwrite = false } = {}) {
      const date = definition?.releaseDate;
      if (!date) throw new PuzzleRepositoryError("DATE_REQUIRED", "Indica una fecha de publicación.");
      return request(overwrite ? `/puzzles/${encodeURIComponent(date)}` : "/puzzles", {
        method: overwrite ? "PUT" : "POST",
        body: definition,
        authenticated: true
      });
    }
  };
}

export function getLegacyPublishedPuzzles(storage, localePack) {
  return restorePublishedPuzzles(storage, localePack);
}

export async function importLegacyPublishedPuzzles(repository, definitions, existingDates = new Set()) {
  const results = [];
  for (const definition of definitions) {
    const date = definition.releaseDate;
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

export function addSuccessfulLegacyImports(existingPuzzles, definitions, results) {
  for (const definition of definitions) {
    const result = results.find((item) => item.date === definition.releaseDate);
    if (!result?.ok || result.skipped) continue;
    if (!existingPuzzles.some((item) => item.date === definition.releaseDate)) {
      existingPuzzles.push({ date: definition.releaseDate, definition: structuredClone(definition) });
    }
  }
  existingPuzzles.sort((left, right) => right.date.localeCompare(left.date));
  return existingPuzzles;
}
