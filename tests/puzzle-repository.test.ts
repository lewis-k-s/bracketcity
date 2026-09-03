import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import {
  PuzzleRepositoryError,
  addSuccessfulLegacyImports,
  assertValidCorrection,
  createWordPressPuzzleRepository,
  importLegacyPublishedPuzzles,
  latestAvailablePuzzleDate,
  readWordPressConfig
} from "../src/puzzle-repository.ts";
import type { PuzzleDefinition, WordPressConfig } from "../src/types.ts";
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

function config(overrides: Partial<WordPressConfig> = {}): WordPressConfig {
  return {
    restBase: "https://example.test/wp-json/bracket-city/v1/",
    currentDate: "2026-08-31",
    timeZone: "Europe/Madrid",
    canAuthor: true,
    nonce: "rest-nonce",
    ...overrides
  };
}

function puzzle(overrides: Partial<PuzzleDefinition> = {}): PuzzleDefinition {
  return { ...structuredClone(branchPuzzle), ...overrides };
}

test("shortcode JSON configuration is read without executing markup", () => {
  const dom = new JSDOM('<script id="bracket-city-config" type="application/json">{"restBase":"/wp-json/bracket-city/v1/","assetBase":"https://assets.example.test","canAuthor":true,"nonce":"n"}</script>');
  assert.deepEqual(readWordPressConfig(dom.window.document), {
    restBase: "/wp-json/bracket-city/v1",
    assetBase: "https://assets.example.test",
    canAuthor: true,
    nonce: "n"
  });
  assert.equal(readWordPressConfig(new JSDOM("").window.document), null);
});

test("the newest available puzzle is selected independently of the server calendar date", () => {
  assert.equal(latestAvailablePuzzleDate([
    { date: "2026-08-28" },
    { date: "2026-08-31" },
    { date: "2026-08-30" }
  ]), "2026-08-31");
  assert.equal(latestAvailablePuzzleDate([]), null);
});

test("public listing uses the server canonical date and public puzzle route", async () => {
  const calls: FetchCall[] = [];
  const repository = createWordPressPuzzleRepository(config(), async (url, options) => {
    const href = String(url);
    calls.push({ url: href, options: options ?? {} });
    if (href.endsWith("/puzzles")) return response({
      currentDate: "2026-09-01",
      timeZone: "Europe/Madrid",
      puzzles: [{ date: "2026-09-01", title: "Legacy metadata" }, { date: "2026-08-31" }]
    });
    return response(puzzle({ id: "daily", releaseDate: "2026-09-01" }));
  });
  const listing = await repository.listPublic();
  assert.equal(listing.currentDate, "2026-09-01");
  assert.deepEqual(listing.entries.map((entry) => entry.date), ["2026-09-01", "2026-08-31"]);
  assert.equal(listing.entries[0]!.title, "Legacy metadata");
  assert.equal((await repository.loadPublic("2026-09-01")).id, "daily");
  assert.deepEqual(calls.map((call) => call.url), [
    "https://example.test/wp-json/bracket-city/v1/puzzles",
    "https://example.test/wp-json/bracket-city/v1/puzzles/2026-09-01"
  ]);
  assert.equal(calls[0]!.options.credentials, "same-origin");
  assert.equal((calls[0]!.options.headers as Record<string, string>)["X-WP-Nonce"], undefined);
});

test("admin listing includes future dates and sends the REST nonce", async () => {
  let captured: FetchCall | undefined;
  const repository = createWordPressPuzzleRepository(config(), async (url, options) => {
    captured = { url: String(url), options: options ?? {} };
    return response({ currentDate: "2026-08-31", puzzles: [{ date: "2026-09-03" }] });
  });
  const listing = await repository.listAdmin();
  assert.equal(listing.entries[0]!.date, "2026-09-03");
  assert.equal(captured!.url.endsWith("/admin/puzzles"), true);
  assert.equal((captured!.options.headers as Record<string, string>)["X-WP-Nonce"], "rest-nonce");
});

test("create and correction use POST and PUT with the exact definition", async () => {
  const calls: FetchCall[] = [];
  const repository = createWordPressPuzzleRepository(config(), async (url, options) => {
    calls.push({ url: String(url), options: options ?? {} });
    return response({ ok: true }, options?.method === "POST" ? 201 : 200);
  });
  const definition = puzzle({ id: "daily", releaseDate: "2026-09-01", revision: 2 });
  await repository.save(definition);
  await repository.save(definition, { overwrite: true });
  assert.deepEqual(calls.map(({ url, options }) => [url, options.method]), [
    ["https://example.test/wp-json/bracket-city/v1/puzzles", "POST"],
    ["https://example.test/wp-json/bracket-city/v1/puzzles/2026-09-01", "PUT"]
  ]);
  assert.deepEqual(JSON.parse(String(calls[1]!.options.body)), definition);
});

test("trash and undo use authenticated puzzle routes", async () => {
  const calls: FetchCall[] = [];
  const repository = createWordPressPuzzleRepository(config(), async (url, options) => {
    calls.push({ url: String(url), options: options ?? {} });
    return response({ ok: true });
  });

  await repository.trashPuzzle("2026-09-01");
  await repository.restorePuzzle("2026-09-01");

  assert.deepEqual(calls.map(({ url, options }) => [url, options.method]), [
    ["https://example.test/wp-json/bracket-city/v1/puzzles/2026-09-01", "DELETE"],
    ["https://example.test/wp-json/bracket-city/v1/admin/puzzles/trash/2026-09-01", "POST"]
  ]);
  for (const call of calls) {
    assert.equal((call.options.headers as Record<string, string>)["X-WP-Nonce"], "rest-nonce");
  }
});

test("shared-link submissions and admin review use separate authorization", async () => {
  const calls: FetchCall[] = [];
  const repository = createWordPressPuzzleRepository(config({
    canSuggest: true,
    suggestionKey: "shared-secret"
  }), async (url, options) => {
    const call = { url: String(url), options: options ?? {} };
    calls.push(call);
    if (call.url.endsWith("/admin/suggestions")) {
      return response({ suggestions: [{ suggestionId: 17, id: "idea", title: "Idea" }] });
    }
    if (call.url.endsWith("/admin/suggestions/17") && call.options.method === "GET") {
      const loaded = puzzle({ id: "idea" });
      delete loaded.releaseDate;
      return response(loaded);
    }
    return response({ suggestionId: 17, status: "pending" }, call.options.method === "POST" ? 201 : 200);
  });
  const definition = puzzle({ id: "idea" });
  delete definition.releaseDate;
  await repository.submitSuggestion(definition);
  const suggestions = await repository.listSuggestions();
  await repository.loadSuggestion(17);
  await repository.approveSuggestion(17, { ...definition, releaseDate: "2026-09-04" });
  await repository.rejectSuggestion(17);

  assert.equal(suggestions[0]!.suggestionId, 17);
  assert.deepEqual(calls.map(({ url, options }) => [url, options.method]), [
    ["https://example.test/wp-json/bracket-city/v1/suggestions", "POST"],
    ["https://example.test/wp-json/bracket-city/v1/admin/suggestions", "GET"],
    ["https://example.test/wp-json/bracket-city/v1/admin/suggestions/17", "GET"],
    ["https://example.test/wp-json/bracket-city/v1/admin/suggestions/17/approve", "POST"],
    ["https://example.test/wp-json/bracket-city/v1/admin/suggestions/17", "DELETE"]
  ]);
  const submitHeaders = calls[0]!.options.headers as Record<string, string>;
  assert.equal(submitHeaders["X-Nexo-Suggestion-Key"], "shared-secret");
  assert.equal(submitHeaders["X-WP-Nonce"], undefined);
  for (const call of calls.slice(1)) {
    assert.equal((call.options.headers as Record<string, string>)["X-WP-Nonce"], "rest-nonce");
  }
});

test("corrections keep the puzzle ID and strictly increase the revision before transport", () => {
  const existing = puzzle({ id: "daily", releaseDate: "2026-09-01", revision: 3 });
  assert.doesNotThrow(() => assertValidCorrection({ ...existing, revision: 4 }, existing));
  assert.throws(
    () => assertValidCorrection({ ...existing, id: "renamed", revision: 4 }, existing),
    (error) => error instanceof PuzzleRepositoryError && error.code === "CORRECTION_ID_MISMATCH" && error.status === 422
  );
  for (const revision of [2, 3]) {
    assert.throws(
      () => assertValidCorrection({ ...existing, revision }, existing),
      (error) => error instanceof PuzzleRepositoryError && error.code === "CORRECTION_REVISION_REQUIRED" && error.status === 422
    );
  }
});

test("a correction treats a missing stored revision as revision one", () => {
  const stored = puzzle({ id: "daily", releaseDate: "2026-09-01" });
  delete stored.revision;
  assert.throws(
    () => assertValidCorrection(
      puzzle({ id: "daily", releaseDate: "2026-09-01", revision: 1 }),
      stored
    ),
    (error) => error instanceof PuzzleRepositoryError && error.code === "CORRECTION_REVISION_REQUIRED"
  );
});

test("authenticated operations fail locally without authorization or a nonce", async () => {
  let calls = 0;
  const repository = createWordPressPuzzleRepository(config({ canAuthor: false, nonce: "" }), async () => {
    calls += 1;
    return response({});
  });
  await assert.rejects(repository.listAdmin(), (error) => error instanceof PuzzleRepositoryError && error.code === "AUTH_REQUIRED");
  assert.equal(calls, 0);
});

test("WordPress conflict and permission responses retain useful error codes", async () => {
  const conflict = createWordPressPuzzleRepository(config(), async () => response({ message: "La fecha ya existe." }, 409));
  await assert.rejects(conflict.save(puzzle({ releaseDate: "2026-09-01" })), (error) => (
    error instanceof PuzzleRepositoryError && error.code === "DATE_EXISTS" && error.status === 409 && /fecha/u.test(error.message)
  ));
  const forbidden = createWordPressPuzzleRepository(config(), async () => response({ message: "No permitido." }, 403));
  await assert.rejects(forbidden.listAdmin(), (error) => error instanceof PuzzleRepositoryError && error.code === "AUTH_REQUIRED" && error.status === 403);
});

test("WordPress rejects a successful response with a non-JSON content type", async () => {
  const repository = createWordPressPuzzleRepository(config(), async () => new Response("<html>login</html>", {
    status: 200,
    headers: { "content-type": "text/html" }
  }));
  await assert.rejects(repository.listPublic(), (error) => (
    error instanceof PuzzleRepositoryError &&
    error.code === "INVALID_CONTENT_TYPE" &&
    error.status === 200 &&
    error.details === "<html>login</html>"
  ));
});

test("legacy import skips server dates, keeps going after a failure, and never deletes browser data", async () => {
  const calls: Array<{ definition: PuzzleDefinition; options: { overwrite?: boolean } }> = [];
  const repository = {
    async save(definition: PuzzleDefinition, options: { overwrite?: boolean } = {}) {
      calls.push({ definition, options });
      if (definition.releaseDate === "2026-09-02") throw new Error("broken");
      return { ok: true };
    }
  };
  const definitions = [
    puzzle({ id: "one", releaseDate: "2026-09-01" }),
    puzzle({ id: "two", releaseDate: "2026-09-02" })
  ];
  const existing = new Set(["2026-09-01"]);
  const results = await importLegacyPublishedPuzzles(repository, definitions, existing);
  assert.deepEqual(results.map((item) => item.ok), [true, false]);
  assert.equal(results[0]!.skipped, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.options.overwrite, false);
  assert.deepEqual(definitions, [
    puzzle({ id: "one", releaseDate: "2026-09-01" }),
    puzzle({ id: "two", releaseDate: "2026-09-02" })
  ]);
});

test("successful legacy imports become immediately available to the creator loader", () => {
  const existing = [{ date: "2026-08-31", definition: puzzle({ id: "old", releaseDate: "2026-08-31" }) }];
  const definitions = [
    puzzle({ id: "new", releaseDate: "2026-09-02", title: "Nuevo" }),
    puzzle({ id: "failed", releaseDate: "2026-09-01" })
  ];
  addSuccessfulLegacyImports(existing, definitions, [
    { date: "2026-09-02", ok: true },
    { date: "2026-09-01", ok: false }
  ]);
  assert.deepEqual(existing.map((item) => item.date), ["2026-09-02", "2026-08-31"]);
  assert.notEqual(existing[0]!.definition, definitions[0]);
});
