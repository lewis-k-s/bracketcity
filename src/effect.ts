import { Context, Data, Effect, Layer, Schema } from "effect";

import type {
  AuthorDraft,
  CatalogEntry,
  LocalePack,
  Progress,
  PublishedPuzzleStore,
  PuzzleCatalog,
  PuzzleDefinition,
  StorageLike,
  WordPressConfig
} from "./types.ts";

const DirectionSchema = Schema.Literals(["left", "right"]);
const ReferenceSegmentSchema = Schema.Struct({
  ref: Schema.String,
  direction: Schema.optionalKey(DirectionSchema)
});
const SegmentSchema = Schema.Union([Schema.String, ReferenceSegmentSchema]);
const SegmentsSchema = Schema.Array(SegmentSchema);
const MatchPolicySchema = Schema.Struct({
  locale: Schema.optionalKey(Schema.String),
  foldCase: Schema.optionalKey(Schema.Boolean),
  trim: Schema.optionalKey(Schema.Boolean),
  collapseWhitespace: Schema.optionalKey(Schema.Boolean),
  canonicalizeQuotes: Schema.optionalKey(Schema.Boolean),
  canonicalizeHyphens: Schema.optionalKey(Schema.Boolean),
  optionalAcuteVowels: Schema.optionalKey(Schema.Boolean),
  ignorePunctuation: Schema.optionalKey(Schema.Boolean)
});
const ScoreRankSchema = Schema.Struct({ minScore: Schema.Finite, labelKey: Schema.String });
const ScoringSchema = Schema.Struct({
  base: Schema.optionalKey(Schema.Finite),
  wrongGuess: Schema.optionalKey(Schema.Finite),
  peek: Schema.optionalKey(Schema.Finite),
  ranks: Schema.optionalKey(Schema.Array(ScoreRankSchema))
});
const PuzzleSourceSchema = Schema.Struct({
  label: Schema.String,
  url: Schema.optionalKey(Schema.String)
});
const ClueSchema = Schema.Struct({
  answer: Schema.String,
  prompt: SegmentsSchema,
  rightPrompt: Schema.optionalKey(SegmentsSchema),
  accept: Schema.optionalKey(Schema.Array(Schema.String)),
  peek: Schema.optionalKey(Schema.String),
  match: Schema.optionalKey(MatchPolicySchema)
});

export const PuzzleDefinitionSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  id: Schema.String,
  revision: Schema.optionalKey(Schema.Finite),
  locale: Schema.String,
  title: Schema.optionalKey(Schema.String),
  releaseDate: Schema.optionalKey(Schema.String),
  factDate: Schema.optionalKey(Schema.String),
  finalText: Schema.String,
  root: SegmentsSchema,
  clues: Schema.Record(Schema.String, ClueSchema),
  source: Schema.optionalKey(PuzzleSourceSchema),
  scoring: Schema.optionalKey(ScoringSchema)
});

export const LocalePackSchema = Schema.Struct({
  id: Schema.String,
  dir: Schema.Literals(["ltr", "rtl"]),
  ui: Schema.Record(Schema.String, Schema.String),
  matching: Schema.optionalKey(MatchPolicySchema),
  keyboard: Schema.Struct({
    mode: Schema.String,
    rows: Schema.Array(Schema.Array(Schema.String)),
    extras: Schema.Array(Schema.String)
  })
});

export const CatalogEntrySchema = Schema.Struct({
  date: Schema.String,
  file: Schema.optionalKey(Schema.String),
  definition: Schema.optionalKey(PuzzleDefinitionSchema),
  id: Schema.optionalKey(Schema.String),
  revision: Schema.optionalKey(Schema.Finite),
  // Older bridge releases included this metadata. Accept it during the
  // rollout, but never use it in the player.
  title: Schema.optionalKey(Schema.String)
});

export const PuzzleCatalogSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  defaultDate: Schema.String,
  puzzles: Schema.Array(CatalogEntrySchema)
});

export const ProgressSchema = Schema.Struct({
  version: Schema.Literal(3),
  puzzleId: Schema.String,
  puzzleRevision: Schema.Finite,
  solved: Schema.Record(Schema.String, Schema.Literal("guess")),
  peeked: Schema.Array(Schema.String),
  wrongGuesses: Schema.Finite,
  keystrokes: Schema.Finite,
  startedAt: Schema.optionalKey(Schema.String),
  completedAt: Schema.optionalKey(Schema.String)
});

export const WordPressConfigSchema = Schema.Struct({
  restBase: Schema.String,
  assetBase: Schema.optionalKey(Schema.String),
  nonce: Schema.optionalKey(Schema.String),
  canAuthor: Schema.Boolean,
  pageUrl: Schema.optionalKey(Schema.String),
  localeUrl: Schema.optionalKey(Schema.String),
  currentDate: Schema.optionalKey(Schema.String),
  timeZone: Schema.optionalKey(Schema.String)
});

export const AuthorDraftSchema = Schema.Struct({
  version: Schema.Literal(1),
  metadata: Schema.Struct({
    id: Schema.String,
    revision: Schema.Finite,
    locale: Schema.String,
    title: Schema.String,
    releaseDate: Schema.String,
    factDate: Schema.optionalKey(Schema.String)
  }),
  finalText: Schema.String,
  root: SegmentsSchema,
  clues: Schema.Record(Schema.String, ClueSchema),
  selectedClueId: Schema.NullOr(Schema.String),
  source: Schema.optionalKey(PuzzleSourceSchema),
  scoring: Schema.optionalKey(ScoringSchema)
});

export const PublishedPuzzleStoreSchema = Schema.Struct({
  version: Schema.Literal(1),
  puzzles: Schema.Record(Schema.String, PuzzleDefinitionSchema)
});

export class DecodeError extends Data.TaggedError("DecodeError")<{
  readonly source: string;
  readonly message: string;
  readonly cause: unknown;
}> {}

export class HttpRequestError extends Data.TaggedError("HttpRequestError")<{
  readonly url: string;
  readonly message: string;
  readonly status: number;
  readonly body?: unknown;
  readonly cause?: unknown;
}> {}

export class StorageError extends Data.TaggedError("StorageError")<{
  readonly operation: "get" | "set" | "remove";
  readonly key: string;
  readonly cause: unknown;
}> {}

type Decodable = typeof PuzzleDefinitionSchema
  | typeof LocalePackSchema
  | typeof PuzzleCatalogSchema
  | typeof ProgressSchema
  | typeof WordPressConfigSchema
  | typeof AuthorDraftSchema
  | typeof PublishedPuzzleStoreSchema
  | typeof CatalogEntrySchema;

export function decodeUnknownEffect<S extends Decodable>(schema: S, source: string, input: unknown) {
  return Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })(input).pipe(
    Effect.mapError((cause) => new DecodeError({ source, message: String(cause), cause }))
  );
}

export const decodePuzzleDefinition = (source: string, input: unknown) =>
  decodeUnknownEffect(PuzzleDefinitionSchema, source, input) as Effect.Effect<PuzzleDefinition, DecodeError>;

export const decodeLocalePack = (source: string, input: unknown) =>
  decodeUnknownEffect(LocalePackSchema, source, input) as Effect.Effect<LocalePack, DecodeError>;

export const decodePuzzleCatalog = (source: string, input: unknown) =>
  decodeUnknownEffect(PuzzleCatalogSchema, source, input) as Effect.Effect<PuzzleCatalog, DecodeError>;

export const decodeCatalogEntry = (source: string, input: unknown) =>
  decodeUnknownEffect(CatalogEntrySchema, source, input) as Effect.Effect<CatalogEntry, DecodeError>;

export const decodeProgress = (source: string, input: unknown) =>
  decodeUnknownEffect(ProgressSchema, source, input) as Effect.Effect<Progress, DecodeError>;

export const decodeWordPressConfig = (source: string, input: unknown) =>
  decodeUnknownEffect(WordPressConfigSchema, source, input) as Effect.Effect<WordPressConfig, DecodeError>;

export const decodeAuthorDraft = (source: string, input: unknown) =>
  decodeUnknownEffect(AuthorDraftSchema, source, input) as Effect.Effect<AuthorDraft, DecodeError>;

export const decodePublishedPuzzleStore = (source: string, input: unknown) =>
  decodeUnknownEffect(PublishedPuzzleStoreSchema, source, input) as Effect.Effect<PublishedPuzzleStore, DecodeError>;

export interface HttpClient {
  readonly json: (url: URL | string, init?: RequestInit) => Effect.Effect<unknown, HttpRequestError>;
}

export const HttpClient = Context.Service<HttpClient>("@nexo/HttpClient");

export function makeHttpClient(fetchImpl: typeof fetch = globalThis.fetch): HttpClient {
  return {
    json(url, init) {
      const href = String(url);
      return Effect.tryPromise({
        try: (signal) => fetchImpl(url, { ...init, signal }),
        catch: (cause) => new HttpRequestError({
          url: href,
          status: 0,
          message: `Could not load ${href}.`,
          cause
        })
      }).pipe(
        Effect.flatMap((response) => Effect.tryPromise({
          try: () => response.text(),
          catch: (cause) => new HttpRequestError({
            url: href,
            status: response.status,
            message: `Could not read ${href}.`,
            cause
          })
        }).pipe(Effect.map((text) => ({ response, text })))),
        Effect.flatMap(({ response, text }) => {
          const contentType = response.headers.get("content-type") ?? "";
          if (!contentType.toLocaleLowerCase().includes("json")) {
            return Effect.fail(new HttpRequestError({
              url: href,
              status: response.status,
              message: `Expected a JSON response from ${href}.`,
              body: text
            }));
          }
          let body: unknown = null;
          try {
            body = text.length > 0 ? JSON.parse(text) : null;
          } catch (cause) {
            return Effect.fail(new HttpRequestError({
              url: href,
              status: response.status,
              message: `Could not decode ${href} as JSON.`,
              body: text,
              cause
            }));
          }
          return response.ok
            ? Effect.succeed(body)
            : Effect.fail(new HttpRequestError({
              url: href,
              status: response.status,
              message: typeof body === "object" && body !== null && "message" in body
                ? String(body.message)
                : `The request failed (${response.status}).`,
              body
            }));
        })
      );
    }
  };
}

export const makeHttpClientLayer = (fetchImpl: typeof fetch = globalThis.fetch) =>
  Layer.succeed(HttpClient, makeHttpClient(fetchImpl));

export interface BrowserStorage {
  readonly get: (key: string) => Effect.Effect<string | null, StorageError>;
  readonly set: (key: string, value: string) => Effect.Effect<void, StorageError>;
  readonly remove: (key: string) => Effect.Effect<void, StorageError>;
}

export const BrowserStorage = Context.Service<BrowserStorage>("@nexo/BrowserStorage");

export function makeBrowserStorage(storage: StorageLike): BrowserStorage {
  return {
    get: (key) => Effect.try({
      try: () => storage.getItem(key),
      catch: (cause) => new StorageError({ operation: "get", key, cause })
    }),
    set: (key, value) => Effect.try({
      try: () => storage.setItem(key, value),
      catch: (cause) => new StorageError({ operation: "set", key, cause })
    }),
    remove: (key) => Effect.try({
      try: () => storage.removeItem?.(key),
      catch: (cause) => new StorageError({ operation: "remove", key, cause })
    }).pipe(Effect.asVoid)
  };
}

export const makeBrowserStorageLayer = (storage: StorageLike) =>
  Layer.succeed(BrowserStorage, makeBrowserStorage(storage));

export type DecodedCatalogEntry = CatalogEntry;
