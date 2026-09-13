import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

import {
  PuzzleRepositoryError,
  assertValidCorrection,
  createAuthenticatedSupabasePuzzleRepository,
  createSupabasePuzzleRepository,
  latestAvailablePuzzleDate,
  readSupabaseConfig
} from "../src/puzzle-repository.ts";
import type { PuzzleDefinition, SupabaseConfig } from "../src/types.ts";
import { branchPuzzle } from "./fixtures.ts";

interface FetchCall {
  readonly url: string;
  readonly options: RequestInit;
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function puzzle(overrides: Partial<PuzzleDefinition> = {}): PuzzleDefinition {
  return { ...structuredClone(branchPuzzle), ...overrides };
}

function supabaseConfig(overrides: Partial<SupabaseConfig> = {}): SupabaseConfig {
  return {
    url: "https://project-ref.supabase.co",
    publishableKey: "sb_publishable_test-key",
    authorModeEnabled: false,
    canAuthor: false,
    timeZone: "Europe/Madrid",
    ...overrides
  };
}

test("Supabase page configuration accepts only a public HTTPS origin and publishable key", () => {
  const dom = new JSDOM('<script id="nexo-supabase-config" type="application/json">{"url":"https://project-ref.supabase.co/","publishableKey":"sb_publishable_test-key"}</script>');
  assert.deepEqual(readSupabaseConfig(dom.window.document), supabaseConfig());
  assert.equal(readSupabaseConfig(new JSDOM("").window.document), null);

  for (const source of [
    '{"url":"http://project-ref.supabase.co","publishableKey":"sb_publishable_test-key"}',
    '{"url":"https://project-ref.supabase.co/rest/v1","publishableKey":"sb_publishable_test-key"}',
    '{"url":"https://project-ref.supabase.co","publishableKey":"sb_secret_private"}'
  ]) {
    const invalid = new JSDOM(`<script id="nexo-supabase-config" type="application/json">${source}</script>`);
    assert.throws(
      () => readSupabaseConfig(invalid.window.document),
      (error) => error instanceof PuzzleRepositoryError && error.code === "INVALID_CONFIG"
    );
  }
});

test("Supabase public reads use PostgREST with the publishable key", async () => {
  const calls: FetchCall[] = [];
  const repository = createSupabasePuzzleRepository(supabaseConfig(), async (url, options) => {
    const href = String(url);
    calls.push({ url: href, options: options ?? {} });
    if (href.includes("select=release_date%2Cpuzzle_id%2Crevision")) {
      return response([{ release_date: "2026-09-01", puzzle_id: "daily", revision: 3 }]);
    }
    return response([{ definition: puzzle({ id: "daily", releaseDate: "2026-09-01", revision: 3 }) }]);
  });

  const listing = await repository.listPublic();
  const definition = await repository.loadPublic("2026-09-01");

  assert.deepEqual(listing.entries, [{ date: "2026-09-01", id: "daily", revision: 3 }]);
  assert.equal(definition.id, "daily");
  assert.equal(calls[0]!.url, "https://project-ref.supabase.co/rest/v1/puzzles?select=release_date%2Cpuzzle_id%2Crevision&status=eq.published&order=release_date.desc");
  assert.match(calls[1]!.url, /release_date=eq\.2026-09-01/u);
  for (const call of calls) {
    const headers = call.options.headers as Record<string, string>;
    assert.equal(headers.apikey, "sb_publishable_test-key");
    assert.equal(headers.Authorization, undefined);
  }
});

test("Supabase management sends the user JWT only to the management function", async () => {
  const calls: FetchCall[] = [];
  const repository = createAuthenticatedSupabasePuzzleRepository(
    supabaseConfig({ authorModeEnabled: true }),
    async () => "user-session-jwt",
    async (url, options) => {
      calls.push({ url: String(url), options: options ?? {} });
      const body = JSON.parse(String(options?.body ?? "{}")) as { action?: string };
      if (body.action === "list") return response({ puzzles: [], currentDate: "2026-09-01" });
      if (body.action === "load") return response({ definition: puzzle({ releaseDate: "2026-09-01" }) });
      return response({ ok: true });
    }
  );

  await repository.listAdmin();
  await repository.loadAdmin("2026-09-01");
  await repository.save(puzzle({ releaseDate: "2026-09-01" }));
  await repository.trashPuzzle("2026-09-01");
  await repository.restorePuzzle("2026-09-01");

  assert.deepEqual(calls.map((call) => JSON.parse(String(call.options.body)).action), [
    "list", "load", "save", "trash", "restore"
  ]);
  for (const call of calls) {
    assert.equal(call.url, "https://project-ref.supabase.co/functions/v1/puzzle-admin");
    const headers = call.options.headers as Record<string, string>;
    assert.equal(headers.apikey, "sb_publishable_test-key");
    assert.equal(headers.Authorization, "Bearer user-session-jwt");
  }
});

test("Supabase management fails before transport when the session expires", async () => {
  let calls = 0;
  const repository = createAuthenticatedSupabasePuzzleRepository(
    supabaseConfig(),
    async () => "",
    async () => {
      calls += 1;
      return response({});
    }
  );
  await assert.rejects(repository.listAdmin(), (error) => (
    error instanceof PuzzleRepositoryError && error.code === "AUTH_REQUIRED" && error.status === 401
  ));
  assert.equal(calls, 0);
});

test("public repository rejects unavailable rows and management writes", async () => {
  const repository = createSupabasePuzzleRepository(supabaseConfig(), async () => response([]));
  await assert.rejects(repository.loadPublic("2026-09-01"), (error) => (
    error instanceof PuzzleRepositoryError && error.code === "NOT_FOUND" && error.status === 404
  ));
  await assert.rejects(repository.save(puzzle()), (error) => (
    error instanceof PuzzleRepositoryError && error.code === "AUTH_REQUIRED" && error.status === 403
  ));
});

test("repository errors retain failed Supabase responses", async () => {
  const repository = createSupabasePuzzleRepository(supabaseConfig(), async () => new Response("<html>login</html>", {
    status: 200,
    headers: { "content-type": "text/html" }
  }));
  await assert.rejects(repository.listPublic(), (error) => (
    error instanceof PuzzleRepositoryError
      && error.code === "INVALID_CONTENT_TYPE"
      && error.status === 200
      && error.details === "<html>login</html>"
  ));
});

test("corrections keep the puzzle ID and strictly increase revision", () => {
  const existing = puzzle({ id: "daily", releaseDate: "2026-09-01", revision: 3 });
  assert.doesNotThrow(() => assertValidCorrection({ ...existing, revision: 4 }, existing));
  assert.throws(
    () => assertValidCorrection({ ...existing, id: "renamed", revision: 4 }, existing),
    (error) => error instanceof PuzzleRepositoryError && error.code === "CORRECTION_ID_MISMATCH"
  );
  assert.throws(
    () => assertValidCorrection({ ...existing, revision: 3 }, existing),
    (error) => error instanceof PuzzleRepositoryError && error.code === "CORRECTION_REVISION_REQUIRED"
  );
});

test("the newest available puzzle is independent of the calendar date", () => {
  assert.equal(latestAvailablePuzzleDate([
    { date: "2026-08-28" },
    { date: "2026-08-31" },
    { date: "2026-08-30" }
  ]), "2026-08-31");
  assert.equal(latestAvailablePuzzleDate([]), null);
});
