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
} from "../src/puzzle-repository.js";

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function config(overrides = {}) {
  return {
    restBase: "https://example.test/wp-json/bracket-city/v1/",
    currentDate: "2026-08-31",
    timeZone: "Europe/Madrid",
    canAuthor: true,
    nonce: "rest-nonce",
    ...overrides
  };
}

test("shortcode JSON configuration is read without executing markup", () => {
  const dom = new JSDOM('<script id="bracket-city-config" type="application/json">{"restBase":"/wp-json/bracket-city/v1/","canAuthor":true,"nonce":"n"}</script>');
  assert.deepEqual(readWordPressConfig(dom.window.document), {
    restBase: "/wp-json/bracket-city/v1",
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
  const calls = [];
  const repository = createWordPressPuzzleRepository(config(), async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/puzzles")) return response({
      currentDate: "2026-09-01",
      timeZone: "Europe/Madrid",
      puzzles: [{ date: "2026-09-01" }, { date: "2026-08-31" }]
    });
    return response({ id: "daily", releaseDate: "2026-09-01" });
  });
  const listing = await repository.listPublic();
  assert.equal(listing.currentDate, "2026-09-01");
  assert.deepEqual(listing.entries.map((entry) => entry.date), ["2026-09-01", "2026-08-31"]);
  assert.equal((await repository.loadPublic("2026-09-01")).id, "daily");
  assert.deepEqual(calls.map((call) => call.url), [
    "https://example.test/wp-json/bracket-city/v1/puzzles",
    "https://example.test/wp-json/bracket-city/v1/puzzles/2026-09-01"
  ]);
  assert.equal(calls[0].options.credentials, "same-origin");
  assert.equal(calls[0].options.headers["X-WP-Nonce"], undefined);
});

test("admin listing includes future dates and sends the REST nonce", async () => {
  let captured;
  const repository = createWordPressPuzzleRepository(config(), async (url, options) => {
    captured = { url, options };
    return response({ currentDate: "2026-08-31", puzzles: [{ date: "2026-09-03" }] });
  });
  const listing = await repository.listAdmin();
  assert.equal(listing.entries[0].date, "2026-09-03");
  assert.equal(captured.url.endsWith("/admin/puzzles"), true);
  assert.equal(captured.options.headers["X-WP-Nonce"], "rest-nonce");
});

test("create and correction use POST and PUT with the exact definition", async () => {
  const calls = [];
  const repository = createWordPressPuzzleRepository(config(), async (url, options) => {
    calls.push({ url, options });
    return response({ ok: true }, options.method === "POST" ? 201 : 200);
  });
  const definition = { id: "daily", releaseDate: "2026-09-01", revision: 2 };
  await repository.save(definition);
  await repository.save(definition, { overwrite: true });
  assert.deepEqual(calls.map(({ url, options }) => [url, options.method]), [
    ["https://example.test/wp-json/bracket-city/v1/puzzles", "POST"],
    ["https://example.test/wp-json/bracket-city/v1/puzzles/2026-09-01", "PUT"]
  ]);
  assert.deepEqual(JSON.parse(calls[1].options.body), definition);
});

test("corrections keep the puzzle ID and strictly increase the revision before transport", () => {
  const existing = { id: "daily", releaseDate: "2026-09-01", revision: 3 };
  assert.doesNotThrow(() => assertValidCorrection({ ...existing, revision: 4 }, existing));
  assert.throws(
    () => assertValidCorrection({ ...existing, id: "renamed", revision: 4 }, existing),
    (error) => error.code === "CORRECTION_ID_MISMATCH" && error.status === 422
  );
  for (const revision of [2, 3]) {
    assert.throws(
      () => assertValidCorrection({ ...existing, revision }, existing),
      (error) => error.code === "CORRECTION_REVISION_REQUIRED" && error.status === 422
    );
  }
});

test("a correction treats a missing stored revision as revision one", () => {
  assert.throws(
    () => assertValidCorrection(
      { id: "daily", releaseDate: "2026-09-01", revision: 1 },
      { id: "daily", releaseDate: "2026-09-01" }
    ),
    (error) => error.code === "CORRECTION_REVISION_REQUIRED"
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
  await assert.rejects(conflict.save({ releaseDate: "2026-09-01" }), (error) => (
    error.code === "DATE_EXISTS" && error.status === 409 && /fecha/u.test(error.message)
  ));
  const forbidden = createWordPressPuzzleRepository(config(), async () => response({ message: "No permitido." }, 403));
  await assert.rejects(forbidden.listAdmin(), (error) => error.code === "AUTH_REQUIRED" && error.status === 403);
});

test("legacy import skips server dates, keeps going after a failure, and never deletes browser data", async () => {
  const calls = [];
  const repository = {
    async save(definition, options) {
      calls.push({ definition, options });
      if (definition.releaseDate === "2026-09-02") throw new Error("broken");
      return { ok: true };
    }
  };
  const definitions = [
    { id: "one", releaseDate: "2026-09-01" },
    { id: "two", releaseDate: "2026-09-02" }
  ];
  const existing = new Set(["2026-09-01"]);
  const results = await importLegacyPublishedPuzzles(repository, definitions, existing);
  assert.deepEqual(results.map((item) => item.ok), [true, false]);
  assert.equal(results[0].skipped, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.overwrite, false);
  assert.deepEqual(definitions, [
    { id: "one", releaseDate: "2026-09-01" },
    { id: "two", releaseDate: "2026-09-02" }
  ]);
});

test("successful legacy imports become immediately available to the creator loader", () => {
  const existing = [{ date: "2026-08-31", definition: { id: "old", releaseDate: "2026-08-31" } }];
  const definitions = [
    { id: "new", releaseDate: "2026-09-02", title: "Nuevo" },
    { id: "failed", releaseDate: "2026-09-01" }
  ];
  addSuccessfulLegacyImports(existing, definitions, [
    { date: "2026-09-02", ok: true },
    { date: "2026-09-01", ok: false }
  ]);
  assert.deepEqual(existing.map((item) => item.date), ["2026-09-02", "2026-08-31"]);
  assert.notEqual(existing[0].definition, definitions[0]);
});
