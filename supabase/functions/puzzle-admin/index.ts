import { createClient } from "npm:@supabase/supabase-js@2.116.0";

import locale from "../../../locales/es-ES.json" with { type: "json" };
import { validatePuzzle } from "../_shared/puzzle-validation.ts";
import type { LocalePack } from "../../../src/types.ts";

const maximumBodyBytes = 256 * 1024;
const defaultOrigins = new Set([
  "https://entre-parentesis.es",
  "http://127.0.0.1:5173",
  "http://localhost:5173"
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function allowedOrigins(): Set<string> {
  const configured = (Deno.env.get("NEXO_ADMIN_ORIGINS") ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  return new Set([...defaultOrigins, ...configured]);
}

function corsHeaders(origin: string | null): HeadersInit {
  return {
    ...(origin && allowedOrigins().has(origin) ? { "Access-Control-Allow-Origin": origin } : {}),
    "Access-Control-Allow-Headers": "authorization, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin"
  };
}

function response(origin: string | null, body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: corsHeaders(origin) });
}

function errorResponse(origin: string | null, code: string, message: string, status: number): Response {
  return response(origin, { code, message }, status);
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const [year = 0, month = 0, day = 0] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function madridDate(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function databaseErrorCode(error: { code?: string; message: string }): { code: string; status: number } {
  if (error.code === "23505") return { code: "PUZZLE_ID_EXISTS", status: 409 };
  for (const [code, status] of [
    ["DATE_EXISTS", 409],
    ["REVISION_CONFLICT", 409],
    ["INVALID_CORRECTION", 422],
    ["INVALID_PUZZLE", 422],
    ["PUZZLE_TRASHED", 409],
    ["PUZZLE_NOT_FOUND", 404],
    ["STATUS_UNCHANGED", 409],
    ["PUZZLE_LIMIT", 507]
  ] as const) {
    if (error.message.includes(code)) return { code, status };
  }
  return { code: "DATABASE_ERROR", status: 500 };
}

Deno.serve(async (request: Request): Promise<Response> => {
  const origin = request.headers.get("Origin");
  if (origin && !allowedOrigins().has(origin)) {
    return errorResponse(origin, "ORIGIN_NOT_ALLOWED", "Este origen no puede usar la administración.", 403);
  }
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (request.method !== "POST") {
    return errorResponse(origin, "METHOD_NOT_ALLOWED", "Usa una solicitud POST.", 405);
  }
  const length = Number(request.headers.get("Content-Length") ?? 0);
  if (Number.isFinite(length) && length > maximumBodyBytes) {
    return errorResponse(origin, "REQUEST_TOO_LARGE", "La solicitud es demasiado grande.", 413);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const publishableKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const authorization = request.headers.get("Authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!supabaseUrl || !publishableKey || !serviceRoleKey) {
    return errorResponse(origin, "SERVER_CONFIG", "La administración no está configurada.", 503);
  }
  if (!token) return errorResponse(origin, "AUTH_REQUIRED", "Inicia sesión para continuar.", 401);

  const auth = createClient(supabaseUrl, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const { data: userData, error: userError } = await auth.auth.getUser(token);
  if (userError || !userData.user) {
    return errorResponse(origin, "AUTH_REQUIRED", "La sesión no es válida.", 401);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const { data: isManager, error: managerError } = await admin.rpc("is_puzzle_manager", {
    candidate_user_id: userData.user.id
  });
  if (managerError) return errorResponse(origin, "AUTH_CHECK_FAILED", "No se pudo comprobar el permiso.", 500);
  if (isManager !== true) return errorResponse(origin, "MANAGER_REQUIRED", "No tienes permiso para administrar rompecabezas.", 403);

  let body: unknown;
  try {
    const source = await request.text();
    if (new TextEncoder().encode(source).byteLength > maximumBodyBytes) {
      return errorResponse(origin, "REQUEST_TOO_LARGE", "La solicitud es demasiado grande.", 413);
    }
    body = JSON.parse(source);
  } catch {
    return errorResponse(origin, "INVALID_JSON", "La solicitud no contiene JSON válido.", 400);
  }
  if (!isRecord(body) || typeof body.action !== "string") {
    return errorResponse(origin, "INVALID_REQUEST", "Falta la acción de administración.", 400);
  }

  if (body.action === "list") {
    const { data, error } = await admin
      .from("puzzles")
      .select("release_date,puzzle_id,revision")
      .eq("status", "published")
      .order("release_date", { ascending: false });
    if (error) return errorResponse(origin, "DATABASE_ERROR", "No se pudo cargar la lista.", 500);
    return response(origin, { puzzles: data, currentDate: madridDate(), timeZone: "Europe/Madrid" });
  }

  if (body.action === "load") {
    if (!validDate(body.date)) return errorResponse(origin, "INVALID_DATE", "La fecha no es válida.", 400);
    const { data, error } = await admin
      .from("puzzles")
      .select("definition")
      .eq("release_date", body.date)
      .eq("status", "published")
      .maybeSingle();
    if (error) return errorResponse(origin, "DATABASE_ERROR", "No se pudo cargar el rompecabezas.", 500);
    if (!data) return errorResponse(origin, "PUZZLE_NOT_FOUND", "No se encontró el rompecabezas.", 404);
    return response(origin, { definition: data.definition });
  }

  if (body.action === "save") {
    if (!isRecord(body.definition) || body.definition.locale !== locale.id) {
      return errorResponse(origin, "UNSUPPORTED_LOCALE", "El idioma del rompecabezas no está disponible.", 422);
    }
    const validation = validatePuzzle(body.definition, locale as LocalePack);
    if (!validation.valid) {
      return errorResponse(origin, "INVALID_PUZZLE", validation.errors.map((issue) => `${issue.path}: ${issue.message}`).join("\n"), 422);
    }
    const overwrite = body.overwrite === true;
    const expectedRevision = Number.isSafeInteger(body.expectedRevision) ? body.expectedRevision as number : null;
    if (overwrite && expectedRevision === null) {
      return errorResponse(origin, "REVISION_REQUIRED", "Falta la revisión que se quiere corregir.", 422);
    }
    const { data, error } = await admin.rpc("admin_save_puzzle", {
      p_actor_id: userData.user.id,
      p_definition: body.definition,
      p_expected_revision: expectedRevision,
      p_overwrite: overwrite
    });
    if (error) {
      const mapped = databaseErrorCode(error);
      return errorResponse(origin, mapped.code, "No se pudo guardar el rompecabezas.", mapped.status);
    }
    return response(origin, data, overwrite ? 200 : 201);
  }

  if (body.action === "trash" || body.action === "restore") {
    if (!validDate(body.date)) return errorResponse(origin, "INVALID_DATE", "La fecha no es válida.", 400);
    const { data, error } = await admin.rpc("admin_set_puzzle_status", {
      p_actor_id: userData.user.id,
      p_release_date: body.date,
      p_status: body.action === "trash" ? "trash" : "published"
    });
    if (error) {
      const mapped = databaseErrorCode(error);
      return errorResponse(origin, mapped.code, "No se pudo cambiar el estado del rompecabezas.", mapped.status);
    }
    return response(origin, data);
  }

  return errorResponse(origin, "UNKNOWN_ACTION", "La acción no está permitida.", 400);
});
