import assert from "node:assert/strict";
import test from "node:test";
import { Effect, Layer } from "effect";

import {
  BrowserStorage,
  DecodeError,
  HttpClient,
  HttpRequestError,
  StorageError,
  decodePuzzleDefinition,
  makeBrowserStorageLayer,
  makeHttpClient,
  makeHttpClientLayer
} from "../src/effect.ts";
import { branchPuzzle } from "./fixtures.ts";

test("Effect Schema rejects excess puzzle fields with a tagged decode error", async () => {
  const error = await Effect.runPromise(Effect.flip(decodePuzzleDefinition("test puzzle", {
    ...branchPuzzle,
    unexpected: true
  })));

  assert.ok(error instanceof DecodeError);
  assert.equal(error._tag, "DecodeError");
  assert.equal(error.source, "test puzzle");
  assert.match(error.message, /unexpected|excess|is unexpected/iu);
});

test("the HTTP service rejects a non-JSON response and retains diagnostic fields", async () => {
  const client = makeHttpClient(async () => new Response("<html>wrong origin</html>", {
    status: 200,
    headers: { "content-type": "text/html" }
  }));
  const error = await Effect.runPromise(Effect.flip(client.json("https://example.test/puzzle")));

  assert.ok(error instanceof HttpRequestError);
  assert.equal(error.url, "https://example.test/puzzle");
  assert.equal(error.status, 200);
  assert.equal(error.body, "<html>wrong origin</html>");
});

test("fake HTTP and storage layers provide deterministic Effect services", async () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); }
  };
  const program = Effect.gen(function*() {
    const http = yield* HttpClient;
    const browserStorage = yield* BrowserStorage;
    const body = yield* http.json("https://example.test/catalog");
    yield* browserStorage.set("catalog", JSON.stringify(body));
    return yield* browserStorage.get("catalog");
  }).pipe(Effect.provide(Layer.mergeAll(
    makeHttpClientLayer(async () => new Response('{"ok":true}', {
      headers: { "content-type": "application/json" }
    })),
    makeBrowserStorageLayer(storage)
  )));

  assert.equal(await Effect.runPromise(program), '{"ok":true}');
});

test("unavailable browser storage produces a tagged storage error", async () => {
  const layer = makeBrowserStorageLayer({
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("blocked"); }
  });
  const error = await Effect.runPromise(Effect.flip(Effect.gen(function*() {
    const storage = yield* BrowserStorage;
    return yield* storage.get("progress");
  }).pipe(Effect.provide(layer))));

  assert.ok(error instanceof StorageError);
  assert.equal(error.operation, "get");
  assert.equal(error.key, "progress");
});
