import { Data, Effect, Result } from "effect";

import { decodeProgress } from "./effect.ts";

import type {
  ClueDefinition,
  CompiledClue,
  CompiledPuzzle,
  LocalePack,
  MatchPolicy,
  Progress,
  PuzzleDefinition,
  ScoreResult,
  Scoring,
  StorageLike,
  Transition,
  TransitionType,
  ValidationIssue,
  ValidationResult,
  ReferenceSegment
} from "./types.ts";

export const DEFAULT_MATCH_POLICY: Readonly<MatchPolicy> = Object.freeze({
  locale: "en",
  foldCase: true,
  trim: true,
  collapseWhitespace: true,
  canonicalizeQuotes: true,
  canonicalizeHyphens: true,
  optionalAcuteVowels: false,
  ignorePunctuation: false
});

export const DEFAULT_SCORING = Object.freeze({
  base: 100,
  wrongGuess: -2,
  peek: -5,
  ranks: [
    { minScore: 95, labelKey: "rankPerfect" },
    { minScore: 80, labelKey: "rankSharp" },
    { minScore: 0, labelKey: "rankSteady" }
  ]
});

const TOP_LEVEL_KEYS = new Set([
  "schemaVersion",
  "id",
  "revision",
  "locale",
  "title",
  "releaseDate",
  "factDate",
  "finalText",
  "root",
  "clues",
  "source",
  "scoring"
]);
const CLUE_KEYS = new Set(["answer", "prompt", "rightPrompt", "accept", "peek", "match"]);
const MATCH_KEYS = new Set([
  "locale",
  "foldCase",
  "trim",
  "collapseWhitespace",
  "canonicalizeQuotes",
  "canonicalizeHyphens",
  "optionalAcuteVowels",
  "ignorePunctuation"
]);
const RESERVED_IDS = new Set(["__proto__", "constructor", "prototype"]);
const RAW_HTML = /(?:<!--|-->|<![^>]*(?:>|$)|<\?[^>]*(?:\?>|$)|<\/?[a-z][^<]*(?:>|$)|&(?:lt|gt|#0*(?:60|62)|#x0*3[ce]);)/iu;
const SIMPLE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class PuzzleValidationError extends Data.TaggedError("PuzzleValidationError")<{
  readonly code: string;
  readonly path: string;
  readonly message: string;
  readonly result: ValidationResult;
}> {
  constructor(result: ValidationResult) {
    const first = result.errors[0];
    super({
      code: first?.code ?? "INVALID_PUZZLE",
      path: first?.path ?? "$",
      message: result.errors.map((error) => `${error.path}: ${error.message}`).join("\n"),
      result
    });
  }
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isReferenceSegment(value: unknown): value is ReferenceSegment {
  return isRecord(value) && typeof value.ref === "string";
}

function ownEntries(value: unknown): [string, any][] {
  return isRecord(value) ? Object.entries(value) : [];
}

function addIssue(list: ValidationIssue[], code: string, path: string, message: string): void {
  list.push({ code, path, message });
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hasRawHtml(value: unknown): boolean {
  return typeof value === "string" && RAW_HTML.test(value);
}

function isValidLocale(locale: unknown): locale is string {
  if (!isNonEmptyString(locale)) return false;
  try {
    Intl.getCanonicalLocales(locale);
    return true;
  } catch {
    return false;
  }
}

function isValidDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year = 0, month = 0, day = 0] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function effectivePolicy(
  definition: Pick<PuzzleDefinition, "locale"> | Record<string, any>,
  localePack: LocalePack | null,
  clue: ClueDefinition | Record<string, any> | null
): MatchPolicy {
  return {
    ...DEFAULT_MATCH_POLICY,
    locale: definition.locale || DEFAULT_MATCH_POLICY.locale,
    ...(localePack?.matching ?? {}),
    ...(clue?.match ?? {})
  };
}

export function normalizeAnswer(raw: unknown, policy: Partial<MatchPolicy> = DEFAULT_MATCH_POLICY): string | null {
  if (typeof raw !== "string") return null;
  const options = { ...DEFAULT_MATCH_POLICY, ...policy };
  let value = raw.normalize("NFC");

  if (options.canonicalizeQuotes) {
    value = value.replace(/[‘’‚‛]/gu, "'").replace(/[“”„‟]/gu, '"');
  }
  if (options.canonicalizeHyphens) {
    value = value.replace(/[‐‑‒–—―−]/gu, "-");
  }
  if (options.foldCase) value = value.toLocaleLowerCase(options.locale);
  if (options.optionalAcuteVowels) {
    value = value
      .replace(/á/gu, "a")
      .replace(/é/gu, "e")
      .replace(/í/gu, "i")
      .replace(/ó/gu, "o")
      .replace(/ú/gu, "u");
  }
  if (options.ignorePunctuation) value = value.replace(/\p{P}+/gu, "");
  if (options.trim) value = value.trim();
  if (options.collapseWhitespace) value = value.replace(/\s+/gu, " ");
  return value.normalize("NFC");
}

function validateMatchPolicy(match: unknown, path: string, errors: ValidationIssue[]): void {
  if (!isRecord(match)) {
    addIssue(errors, "INVALID_MATCH_POLICY", path, "Match policy must be an object.");
    return;
  }
  for (const key of Object.keys(match)) {
    if (!MATCH_KEYS.has(key)) {
      addIssue(errors, "UNKNOWN_MATCH_KEY", `${path}.${key}`, "Unknown match option.");
      continue;
    }
    if (key === "locale") {
      if (!isValidLocale(match[key])) {
        addIssue(errors, "INVALID_LOCALE", `${path}.locale`, "Locale must be a valid BCP 47 tag.");
      }
    } else if (typeof match[key] !== "boolean") {
      addIssue(errors, "INVALID_MATCH_OPTION", `${path}.${key}`, "Match option must be Boolean.");
    }
  }
}

function validateScoring(scoring: unknown, path: string, errors: ValidationIssue[]): void {
  if (!isRecord(scoring)) {
    addIssue(errors, "INVALID_SCORING", path, "Scoring must be an object.");
    return;
  }
  const allowed = new Set(["base", "wrongGuess", "peek", "ranks"]);
  for (const key of Object.keys(scoring)) {
    if (!allowed.has(key)) addIssue(errors, "UNKNOWN_SCORING_KEY", `${path}.${key}`, "Unknown scoring option.");
  }
  for (const key of ["base", "wrongGuess", "peek"]) {
    if (key in scoring && !Number.isFinite(scoring[key])) {
      addIssue(errors, "INVALID_SCORING_VALUE", `${path}.${key}`, "Scoring value must be finite.");
    }
  }
  if (Array.isArray(scoring.ranks)) {
    const thresholds = new Set<number>();
    for (const [index, rank] of scoring.ranks.entries()) {
      const rankPath = `${path}.ranks[${index}]`;
      if (!isRecord(rank) || !Number.isFinite(rank.minScore) || !isNonEmptyString(rank.labelKey)) {
        addIssue(errors, "INVALID_RANK", rankPath, "Rank needs a finite minScore and a labelKey.");
        continue;
      }
      if (thresholds.has(rank.minScore)) {
        addIssue(errors, "DUPLICATE_RANK", `${rankPath}.minScore`, "Rank thresholds must be unique.");
      }
      thresholds.add(rank.minScore);
    }
  } else if ("ranks" in scoring) {
    addIssue(errors, "INVALID_RANKS", `${path}.ranks`, "Ranks must be an array.");
  }
}

function validateSegments(
  segments: unknown,
  path: string,
  clues: Record<string, any>,
  errors: ValidationIssue[],
  warnings: ValidationIssue[],
  referenceVisitor?: (child: string, path: string, direction: unknown, directionPath: string) => void
): void {
  if (!Array.isArray(segments) || segments.length === 0) {
    addIssue(errors, "EMPTY_SEGMENTS", path, "Segment list must not be empty.");
    return;
  }
  let hasContent = false;
  for (const [index, segment] of segments.entries()) {
    const segmentPath = `${path}[${index}]`;
    if (typeof segment === "string") {
      if (segment.length > 0) hasContent = true;
      if (hasRawHtml(segment)) addIssue(errors, "RAW_HTML", segmentPath, "Raw HTML is not allowed.");
      if (/[\[\]]/u.test(segment)) addIssue(warnings, "LITERAL_BRACKET", segmentPath, "Literal square brackets can be confusing.");
      continue;
    }
    const keys = isRecord(segment) ? Object.keys(segment) : [];
    if (!isRecord(segment) || !isNonEmptyString(segment.ref) || keys.some((key) => !["ref", "direction"].includes(key))) {
      addIssue(errors, "INVALID_SEGMENT", segmentPath, "Segment must be text or a reference with ref and optional direction keys.");
      continue;
    }
    if ("direction" in segment && !["left", "right"].includes(segment.direction)) {
      addIssue(errors, "INVALID_DIRECTION", `${segmentPath}.direction`, "Reference direction must be 'left' or 'right'.");
    }
    hasContent = true;
    if (!Object.hasOwn(clues, segment.ref)) {
      addIssue(errors, "MISSING_REFERENCE", `${segmentPath}.ref`, `Unknown clue '${segment.ref}'.`);
    }
    referenceVisitor?.(segment.ref, `${segmentPath}.ref`, segment.direction, `${segmentPath}.direction`);
  }
  if (!hasContent) addIssue(errors, "EMPTY_PROMPT", path, "Prompt must contain text or a clue reference.");
}

export function validatePuzzle(definition: unknown, localePack: LocalePack | null = null): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  if (!isRecord(definition)) {
    addIssue(errors, "INVALID_PUZZLE", "$", "Puzzle must be an object.");
    return { valid: false, errors, warnings };
  }

  for (const key of Object.keys(definition)) {
    if (!TOP_LEVEL_KEYS.has(key)) addIssue(errors, "UNKNOWN_PUZZLE_KEY", `$.${key}`, "Unknown puzzle field.");
  }
  if (definition.schemaVersion !== 1) {
    addIssue(errors, "UNSUPPORTED_SCHEMA", "$.schemaVersion", "schemaVersion must be 1.");
  }
  if (!isNonEmptyString(definition.id) || !SIMPLE_SLUG.test(definition.id) || RESERVED_IDS.has(definition.id)) {
    addIssue(errors, "INVALID_PUZZLE_ID", "$.id", "Puzzle ID must be a simple lowercase slug.");
  }
  if (
    "revision" in definition &&
    (!Number.isSafeInteger(definition.revision) || definition.revision < 1)
  ) {
    addIssue(errors, "INVALID_REVISION", "$.revision", "Revision must be a positive safe integer.");
  }
  if (!isValidLocale(definition.locale)) {
    addIssue(errors, "INVALID_LOCALE", "$.locale", "Locale must be a valid BCP 47 tag.");
  }
  if (!isNonEmptyString(definition.finalText)) {
    addIssue(errors, "EMPTY_FINAL_TEXT", "$.finalText", "Final text must not be empty.");
  } else if (hasRawHtml(definition.finalText)) {
    addIssue(errors, "RAW_HTML", "$.finalText", "Raw HTML is not allowed.");
  }
  for (const key of ["title"]) {
    if (key in definition && (!isNonEmptyString(definition[key]) || hasRawHtml(definition[key]))) {
      addIssue(errors, hasRawHtml(definition[key]) ? "RAW_HTML" : "INVALID_TEXT", `$.${key}`, "Text must be non-empty and contain no raw HTML.");
    }
  }
  for (const key of ["releaseDate", "factDate"]) {
    if (key in definition && !isValidDate(definition[key])) {
      addIssue(errors, "INVALID_DATE", `$.${key}`, "Date must be a real YYYY-MM-DD date.");
    }
  }
  if ("source" in definition) {
    if (!isRecord(definition.source) || !isNonEmptyString(definition.source.label)) {
      addIssue(errors, "INVALID_SOURCE", "$.source", "Source needs a non-empty label.");
    } else if (hasRawHtml(definition.source.label)) {
      addIssue(errors, "RAW_HTML", "$.source.label", "Raw HTML is not allowed.");
    }
    if (definition.source?.url !== undefined) {
      try {
        const sourceUrl = new URL(definition.source.url);
        if (!/^https?:$/u.test(sourceUrl.protocol)) throw new Error("protocol");
      } catch {
        addIssue(errors, "INVALID_SOURCE_URL", "$.source.url", "Source URL must use HTTP or HTTPS.");
      }
    }
  }
  if ("scoring" in definition) validateScoring(definition.scoring, "$.scoring", errors);

  const clues = isRecord(definition.clues) ? definition.clues : {};
  if (!isRecord(definition.clues) || Object.keys(clues).length === 0) {
    addIssue(errors, "EMPTY_CLUES", "$.clues", "Puzzle must contain clues.");
  }

  for (const [id, clue] of ownEntries(clues)) {
    const path = `$.clues.${id}`;
    if (!SIMPLE_SLUG.test(id) || RESERVED_IDS.has(id)) {
      addIssue(errors, "INVALID_CLUE_ID", path, "Clue ID must be a simple lowercase slug.");
    }
    if (!isRecord(clue)) {
      addIssue(errors, "INVALID_CLUE", path, "Clue must be an object.");
      continue;
    }
    for (const key of Object.keys(clue)) {
      if (!CLUE_KEYS.has(key)) addIssue(errors, "UNKNOWN_CLUE_KEY", `${path}.${key}`, "Unknown clue field.");
    }
    if (!isNonEmptyString(clue.answer)) {
      addIssue(errors, "EMPTY_ANSWER", `${path}.answer`, "Answer must not be empty.");
    } else if (hasRawHtml(clue.answer)) {
      addIssue(errors, "RAW_HTML", `${path}.answer`, "Raw HTML is not allowed.");
    }
    if ("peek" in clue && (!isNonEmptyString(clue.peek) || hasRawHtml(clue.peek))) {
      addIssue(errors, hasRawHtml(clue.peek) ? "RAW_HTML" : "INVALID_PEEK", `${path}.peek`, "Peek must be non-empty text without raw HTML.");
    }
    if ("accept" in clue) {
      if (!Array.isArray(clue.accept)) {
        addIssue(errors, "INVALID_ALIASES", `${path}.accept`, "Accepted aliases must be an array.");
      } else {
        clue.accept.forEach((alias, index) => {
          if (!isNonEmptyString(alias)) addIssue(errors, "EMPTY_ALIAS", `${path}.accept[${index}]`, "Alias must not be empty.");
          else if (hasRawHtml(alias)) addIssue(errors, "RAW_HTML", `${path}.accept[${index}]`, "Raw HTML is not allowed.");
        });
      }
    }
    if ("match" in clue) validateMatchPolicy(clue.match, `${path}.match`, errors);
  }

  const parentOf = new Map<string, string | null>();
  const referencePaths = new Map<string, string[]>();
  const directedReferences: Array<{ child: string; directionPath: string }> = [];
  const visitReference = (parent: string | null) => (child: string, path: string, direction: unknown, directionPath: string) => {
    if (!referencePaths.has(child)) referencePaths.set(child, []);
    referencePaths.get(child)!.push(path);
    if (parentOf.has(child)) {
      addIssue(errors, "MULTIPLE_PARENTS", path, `Clue '${child}' is referenced more than once.`);
    } else {
      parentOf.set(child, parent);
    }
    if (direction === "left" || direction === "right") directedReferences.push({ child, directionPath });
  };

  validateSegments(definition.root, "$.root", clues, errors, warnings, visitReference(null));
  if (Array.isArray(definition.root) && !definition.root.some((segment) => isRecord(segment) && "ref" in segment)) {
    addIssue(errors, "ROOT_WITHOUT_CLUES", "$.root", "Root must reference at least one clue.");
  }
  for (const [id, clue] of ownEntries(clues)) {
    if (!isRecord(clue)) continue;
    validateSegments(clue.prompt, `$.clues.${id}.prompt`, clues, errors, warnings, visitReference(id));
    if ("rightPrompt" in clue) {
      validateSegments(clue.rightPrompt, `$.clues.${id}.rightPrompt`, clues, errors, warnings, visitReference(id));
    }
  }

  const childrenOf = new Map(
    ownEntries(clues).map(([id, clue]) => [
      id,
      [
        ...(Array.isArray(clue?.prompt) ? clue.prompt : []),
        ...(Array.isArray(clue?.rightPrompt) ? clue.rightPrompt : [])
      ].filter((segment) => isRecord(segment) && typeof segment.ref === "string").map((segment) => segment.ref)
    ])
  );
  for (const { child, directionPath } of directedReferences) {
    if (Object.hasOwn(clues, child) && Object.hasOwn(clues[child], "rightPrompt")) {
      addIssue(errors, "DIRECTION_WITH_RIGHT_PROMPT", directionPath, "A two-sided clue must not have an explicit direction.");
    }
  }

  const colors = new Map<string, "gray" | "black">();
  const visitForCycles = (id: string, trail: string[] = []): void => {
    if (!Object.hasOwn(clues, id)) return;
    if (colors.get(id) === "gray") {
      addIssue(errors, "CYCLE", `$.clues.${id}.prompt`, `Cycle detected: ${[...trail, id].join(" -> ")}.`);
      return;
    }
    if (colors.get(id) === "black") return;
    colors.set(id, "gray");
    for (const child of childrenOf.get(id) ?? []) visitForCycles(child, [...trail, id]);
    colors.set(id, "black");
  };
  for (const id of Object.keys(clues)) visitForCycles(id);

  const reachable = new Set<string>();
  let maxDepth = 0;
  const markReachable = (id: string, depth: number, trail: Set<string> = new Set()): void => {
    if (!Object.hasOwn(clues, id) || trail.has(id)) return;
    reachable.add(id);
    maxDepth = Math.max(maxDepth, depth);
    const nextTrail = new Set(trail).add(id);
    for (const child of childrenOf.get(id) ?? []) markReachable(child, depth + 1, nextTrail);
  };
  if (Array.isArray(definition.root)) {
    for (const segment of definition.root) {
      if (isRecord(segment) && typeof segment.ref === "string") markReachable(segment.ref, 1);
    }
  }
  for (const id of Object.keys(clues)) {
    if (!reachable.has(id)) addIssue(errors, "UNREACHABLE_CLUE", `$.clues.${id}`, "Clue is not reachable from root.");
  }
  if (maxDepth > 8) addIssue(warnings, "EXCESSIVE_DEPTH", "$.root", `Puzzle nesting depth is ${maxDepth}.`);
  if (Object.keys(clues).length > 40) addIssue(warnings, "LARGE_PUZZLE", "$.clues", "Large puzzles can wrap poorly on mobile.");

  for (const [id, clue] of ownEntries(clues)) {
    if (!isRecord(clue) || !Array.isArray(clue.prompt)) continue;
    const literalLength = [...clue.prompt, ...(Array.isArray(clue.rightPrompt) ? clue.rightPrompt : [])]
      .reduce((total, segment) => total + (typeof segment === "string" ? segment.length : 0), 0);
    if (literalLength > 240) addIssue(warnings, "LONG_PROMPT", `$.clues.${id}.prompt`, "Clue prompt is long for mobile play.");
  }

  const acceptedByClue = new Map<string, { accepted: Set<string>; policy: MatchPolicy }>();
  const rawValues = new Set<string>();
  for (const [id, clue] of ownEntries(clues)) {
    if (!isRecord(clue) || !isNonEmptyString(clue.answer)) continue;
    const policy = effectivePolicy(definition, localePack, clue);
    const accepted = new Set<string>();
    for (const [index, value] of [clue.answer, ...(Array.isArray(clue.accept) ? clue.accept : [])].entries()) {
      if (!isNonEmptyString(value)) continue;
      rawValues.add(value);
      const normalized = normalizeAnswer(value, policy);
      if (!normalized) {
        addIssue(errors, "EMPTY_NORMALIZED_ANSWER", `$.clues.${id}.${index === 0 ? "answer" : `accept[${index - 1}]`}`, "Answer is empty after normalization.");
      } else if (accepted.has(normalized)) {
        addIssue(warnings, "DUPLICATE_ALIAS", `$.clues.${id}`, "An alias duplicates another accepted value after normalization.");
      }
      if (normalized !== null) accepted.add(normalized);
    }
    acceptedByClue.set(id, { accepted, policy });
  }
  const clueIds = [...acceptedByClue.keys()];
  for (let leftIndex = 0; leftIndex < clueIds.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < clueIds.length; rightIndex += 1) {
      const leftId = clueIds[leftIndex]!;
      const rightId = clueIds[rightIndex]!;
      const left = acceptedByClue.get(leftId)!;
      const right = acceptedByClue.get(rightId)!;
      const collides = [...rawValues].some(
        (raw) => {
          const leftValue = normalizeAnswer(raw, left.policy);
          const rightValue = normalizeAnswer(raw, right.policy);
          return leftValue !== null && rightValue !== null && left.accepted.has(leftValue) && right.accepted.has(rightValue);
        }
      );
      if (collides) {
        addIssue(errors, "ANSWER_COLLISION", `$.clues.${rightId}`, `Accepted answer collides with clue '${leftId}'.`);
      }
    }
  }

  if (Array.isArray(definition.root) && isNonEmptyString(definition.finalText)) {
    const expanded = definition.root
      .map((segment) => {
        if (typeof segment === "string") return segment;
        return isReferenceSegment(segment) && isRecord(clues[segment.ref]) ? clues[segment.ref].answer ?? "" : "";
      })
      .join("")
      .normalize("NFC");
    if (expanded !== definition.finalText.normalize("NFC")) {
      addIssue(errors, "FINAL_TEXT_MISMATCH", "$.finalText", "Root expansion must exactly equal finalText after NFC normalization.");
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

export function firstGrapheme(value: unknown, locale = "en"): string {
  const text = String(value ?? "").normalize("NFC");
  if (!text) return "";
  if (typeof Intl.Segmenter === "function") {
    return new Intl.Segmenter(locale, { granularity: "grapheme" }).segment(text)[Symbol.iterator]().next().value?.segment ?? "";
  }
  return Array.from(text)[0] ?? "";
}

export function compilePuzzle(definition: unknown, localePack: LocalePack | null = null): CompiledPuzzle {
  const validation = validatePuzzle(definition, localePack);
  if (!validation.valid) throw new PuzzleValidationError(validation);
  const validDefinition = definition as PuzzleDefinition;

  const parentOf = new Map<string, string | null>();
  const rootChildren: string[] = [];
  for (const segment of validDefinition.root) {
    if (isReferenceSegment(segment)) {
      rootChildren.push(segment.ref);
      parentOf.set(segment.ref, null);
    }
  }
  for (const [id, clue] of Object.entries(validDefinition.clues)) {
    for (const segment of [...clue.prompt, ...(clue.rightPrompt ?? [])]) {
      if (isReferenceSegment(segment)) parentOf.set(segment.ref, id);
    }
  }

  const order: string[] = [];
  const seen = new Set<string>();
  const visit = (id: string): void => {
    if (seen.has(id)) return;
    seen.add(id);
    order.push(id);
    const clue = validDefinition.clues[id];
    if (!clue) return;
    for (const segment of [...clue.prompt, ...(clue.rightPrompt ?? [])]) {
      if (isReferenceSegment(segment)) visit(segment.ref);
    }
  };
  rootChildren.forEach(visit);

  const nodes = new Map<string, CompiledClue>();
  for (const id of order) {
    const clue = validDefinition.clues[id];
    if (!clue) continue;
    const match = effectivePolicy(validDefinition, localePack, clue);
    const accepted = new Set<string>(
      [clue.answer, ...(clue.accept ?? [])]
        .map((answer) => normalizeAnswer(answer, match))
        .filter((answer): answer is string => answer !== null)
    );
    nodes.set(id, {
      id,
      answer: clue.answer,
      prompt: clue.prompt,
      ...(clue.rightPrompt ? { rightPrompt: clue.rightPrompt } : {}),
      children: [...clue.prompt, ...(clue.rightPrompt ?? [])].filter(isReferenceSegment).map((segment) => segment.ref),
      parent: parentOf.get(id) ?? null,
      accepted,
      peek: clue.peek ?? firstGrapheme(clue.answer, match.locale),
      match
    });
  }

  return { definition: validDefinition, nodes, rootChildren, order, localePack, validation };
}

export function tryCompilePuzzle(
  definition: unknown,
  localePack: LocalePack | null = null
): Result.Result<CompiledPuzzle, PuzzleValidationError> {
  try {
    return Result.succeed(compilePuzzle(definition, localePack));
  } catch (error) {
    if (error instanceof PuzzleValidationError) return Result.fail(error);
    throw error;
  }
}

export function puzzleRevision(puzzle: CompiledPuzzle): number {
  return puzzle.definition.revision ?? 1;
}

export function progressStorageKey(puzzle: CompiledPuzzle): string {
  return `nested-clue:v3:${puzzle.definition.id}:${puzzleRevision(puzzle)}`;
}

export function createProgress(puzzle: CompiledPuzzle): Progress {
  return {
    version: 3,
    puzzleId: puzzle.definition.id,
    puzzleRevision: puzzleRevision(puzzle),
    solved: {},
    peeked: [],
    wrongGuesses: 0,
    keystrokes: 0
  };
}

function cloneProgress(progress: Progress): Progress {
  return {
    ...progress,
    solved: { ...progress.solved },
    peeked: [...progress.peeked]
  };
}

function isoTime(now: string | number | Date | null | undefined): string {
  if (typeof now === "string") return new Date(now).toISOString();
  return (now instanceof Date ? now : new Date(now ?? Date.now())).toISOString();
}

function withStartTime(progress: Progress, now: string | number | Date | null | undefined): Progress {
  if (!progress.startedAt) progress.startedAt = isoTime(now);
  return progress;
}

export function isSolved(progress: Progress, id: string): boolean {
  return Object.hasOwn(progress.solved, id);
}

export function isComplete(puzzle: CompiledPuzzle, progress: Progress): boolean {
  return puzzle.order.every((id) => isSolved(progress, id));
}

export function getAvailableClues(puzzle: CompiledPuzzle, progress: Progress): CompiledClue[] {
  return puzzle.order
    .filter((id) => {
      const node = puzzle.nodes.get(id);
      return node !== undefined && !isSolved(progress, id) && node.children.every((childId) => isSolved(progress, childId));
    })
    .flatMap((id) => {
      const node = puzzle.nodes.get(id);
      return node ? [node] : [];
    });
}

function transitionResult(
  type: TransitionType,
  puzzle: CompiledPuzzle,
  before: Progress,
  progress: Progress,
  extra: Pick<Transition, "clueId" | "peek"> | {} = {}
): Transition {
  const beforeAvailable = new Set(getAvailableClues(puzzle, before).map((clue) => clue.id));
  const newlyAvailable = getAvailableClues(puzzle, progress)
    .map((clue) => clue.id)
    .filter((id) => !beforeAvailable.has(id));
  const wasComplete = isComplete(puzzle, before);
  const completed = isComplete(puzzle, progress);
  return {
    type,
    progress,
    newlyAvailable,
    completed,
    becameComplete: completed && !wasComplete,
    ...extra
  };
}

export function submitGuess(
  puzzle: CompiledPuzzle,
  currentProgress: Progress,
  rawGuess: unknown,
  now: string | number | Date = Date.now()
): Transition {
  if (typeof rawGuess !== "string" || rawGuess.trim().length === 0 || isComplete(puzzle, currentProgress)) {
    return transitionResult(typeof rawGuess === "string" && rawGuess.trim().length === 0 ? "empty" : "noop", puzzle, currentProgress, currentProgress);
  }
  const before = currentProgress;
  const progress = withStartTime(cloneProgress(currentProgress), now);
  const matched = getAvailableClues(puzzle, currentProgress).find((clue) => {
    const normalized = normalizeAnswer(rawGuess, clue.match);
    return normalized !== null && clue.accepted.has(normalized);
  });
  if (!matched) {
    progress.wrongGuesses += 1;
    return transitionResult("wrong", puzzle, before, progress);
  }
  progress.solved[matched.id] = "guess";
  if (isComplete(puzzle, progress) && !progress.completedAt) progress.completedAt = isoTime(now);
  return transitionResult("correct", puzzle, before, progress, { clueId: matched.id });
}

export function peekClue(
  puzzle: CompiledPuzzle,
  currentProgress: Progress,
  clueId: string,
  now: string | number | Date = Date.now()
): Transition {
  const available = getAvailableClues(puzzle, currentProgress).find((clue) => clue.id === clueId);
  if (!available || isComplete(puzzle, currentProgress)) {
    return transitionResult("noop", puzzle, currentProgress, currentProgress, { clueId });
  }
  if (currentProgress.peeked.includes(clueId)) {
    return transitionResult("noop", puzzle, currentProgress, currentProgress, { clueId });
  }
  const before = currentProgress;
  const progress = withStartTime(cloneProgress(currentProgress), now);
  progress.peeked.push(clueId);
  return transitionResult("peek", puzzle, before, progress, { clueId, peek: available.peek });
}

export function recordKeystroke(
  currentProgress: Progress,
  count = 1,
  now: string | number | Date = Date.now()
): Progress {
  if (!Number.isSafeInteger(count) || count < 0 || count === 0) return currentProgress;
  const progress = withStartTime(cloneProgress(currentProgress), now);
  progress.keystrokes += count;
  return progress;
}

export function calculateScore(progress: Progress, scoring: Scoring = {}): ScoreResult {
  const config = {
    ...DEFAULT_SCORING,
    ...scoring,
    ranks: scoring.ranks ?? DEFAULT_SCORING.ranks
  };
  const rawScore =
    config.base +
    progress.wrongGuesses * config.wrongGuess +
    new Set(progress.peeked).size * config.peek;
  const score = Math.max(0, rawScore);
  const ranks = [...config.ranks].sort((left, right) => right.minScore - left.minScore);
  const rank = ranks.find((candidate) => score >= candidate.minScore) ?? ranks.at(-1) ?? null;
  return {
    score,
    rawScore,
    rank,
    breakdown: {
      base: config.base,
      wrongGuesses: progress.wrongGuesses,
      peeked: new Set(progress.peeked).size
    }
  };
}

export function serializeProgress(progress: Progress): string {
  const serialized: Record<string, unknown> = {
    version: progress.version,
    puzzleId: progress.puzzleId,
    puzzleRevision: progress.puzzleRevision,
    solved: progress.solved,
    peeked: [...new Set(progress.peeked)],
    wrongGuesses: progress.wrongGuesses,
    keystrokes: progress.keystrokes
  };
  if (progress.startedAt) serialized.startedAt = progress.startedAt;
  if (progress.completedAt) serialized.completedAt = progress.completedAt;
  return JSON.stringify(serialized);
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function progressIsValid(puzzle: CompiledPuzzle, progress: unknown): progress is Progress {
  if (!isRecord(progress)) return false;
  if (
    progress.version !== 3 ||
    progress.puzzleId !== puzzle.definition.id ||
    progress.puzzleRevision !== puzzleRevision(puzzle) ||
    !isRecord(progress.solved) ||
    !Array.isArray(progress.peeked) ||
    Object.hasOwn(progress, "revealed") ||
    !Number.isSafeInteger(progress.wrongGuesses) ||
    progress.wrongGuesses < 0 ||
    !Number.isSafeInteger(progress.keystrokes) ||
    progress.keystrokes < 0
  ) return false;

  for (const [id, method] of Object.entries(progress.solved)) {
    if (!puzzle.nodes.has(id) || method !== "guess") return false;
    const node = puzzle.nodes.get(id);
    if (!node || !node.children.every((childId) => Object.hasOwn(progress.solved, childId))) return false;
  }
  const peeked = new Set(progress.peeked);
  if (peeked.size !== progress.peeked.length || [...peeked].some((id) => !puzzle.nodes.has(id))) return false;
  const candidate = progress as unknown as Progress;
  const available = new Set(getAvailableClues(puzzle, candidate).map((clue) => clue.id));
  for (const id of peeked) {
    if (!Object.hasOwn(progress.solved, id) && !available.has(id)) return false;
  }

  const hasActivity = Object.keys(progress.solved).length > 0 || peeked.size > 0 || progress.wrongGuesses > 0 || progress.keystrokes > 0;
  if (hasActivity !== Boolean(progress.startedAt) || (progress.startedAt && !validTimestamp(progress.startedAt))) return false;
  const complete = isComplete(puzzle, candidate);
  if (complete !== Boolean(progress.completedAt) || (progress.completedAt && !validTimestamp(progress.completedAt))) return false;
  if (progress.completedAt && Date.parse(progress.completedAt) < Date.parse(progress.startedAt)) return false;
  return true;
}

export function restoreProgress(
  puzzle: CompiledPuzzle,
  source: string | Pick<StorageLike, "getItem"> | Progress | null = null
): Progress {
  let serialized: unknown = source;
  try {
    if (source && typeof source === "object" && "getItem" in source && typeof source.getItem === "function") {
      serialized = source.getItem(progressStorageKey(puzzle));
    }
    else if (source === null && typeof localStorage !== "undefined") serialized = localStorage.getItem(progressStorageKey(puzzle));
    if (!serialized) return createProgress(puzzle);
    const input: unknown = typeof serialized === "string" ? JSON.parse(serialized) : serialized;
    const progress = Effect.runSync(decodeProgress("saved progress", input));
    if (!progressIsValid(puzzle, progress)) return createProgress(puzzle);
    return cloneProgress(progress);
  } catch {
    return createProgress(puzzle);
  }
}

export function saveProgress(puzzle: CompiledPuzzle, progress: Progress, storage?: StorageLike | null): boolean {
  try {
    const target = storage ?? globalThis.localStorage;
    target.setItem(progressStorageKey(puzzle), serializeProgress(progress));
    return true;
  } catch {
    return false;
  }
}
