import { Data, Effect, Result } from "effect";

import { compilePuzzle, validatePuzzle } from "./engine.ts";
import { decodeAuthorDraft } from "./effect.ts";
import type {
  AuthorDraft,
  ClueDefinition,
  CompiledPuzzle,
  Direction,
  LocalePack,
  PuzzleDefinition,
  ReferenceSegment,
  Segment,
  ValidationResult
} from "./types.ts";

export const AUTHOR_DRAFT_VERSION = 1;
export const AUTHOR_STORAGE_KEY = "nested-clue:author:v1";

export class AuthoringError extends Data.TaggedError("AuthoringError")<{
  readonly code: string;
  readonly message: string;
}> {
  constructor(code: string, message: string) {
    super({ code, message });
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isReferenceSegment(segment: unknown): segment is ReferenceSegment {
  return isRecord(segment) && typeof segment.ref === "string";
}

function ownerSegments(draft: AuthorDraft, owner: string): Segment[] {
  if (owner === "root") return draft.root;
  const rightSide = owner.endsWith(":right");
  const clueId = rightSide ? owner.slice(0, -":right".length) : owner;
  const clue = draft.clues[clueId];
  if (!clue) throw new AuthoringError("UNKNOWN_OWNER", `Unknown segment owner '${owner}'.`);
  if (rightSide) {
    if (!Array.isArray(clue.rightPrompt)) {
      throw new AuthoringError("UNKNOWN_OWNER", `Clue '${clueId}' has no right prompt.`);
    }
    return clue.rightPrompt;
  }
  return clue.prompt;
}

function clueSegmentGroups(clue: ClueDefinition): Segment[][] {
  return [clue.prompt, ...(Array.isArray(clue.rightPrompt) ? [clue.rightPrompt] : [])];
}

function ownerClueId(owner: string): string {
  return owner.endsWith(":right") ? owner.slice(0, -":right".length) : owner;
}

function nextClueId(clues: Record<string, ClueDefinition>): string {
  let index = 1;
  while (Object.hasOwn(clues, `c${String(index).padStart(2, "0")}`)) index += 1;
  return `c${String(index).padStart(2, "0")}`;
}

function graphemeBoundaries(value: string, locale: string): Set<number> {
  const boundaries = new Set<number>([0, value.length]);
  if (typeof Intl.Segmenter !== "function") {
    let offset = 0;
    for (const grapheme of Array.from(value)) {
      offset += grapheme.length;
      boundaries.add(offset);
    }
    return boundaries;
  }
  for (const part of new Intl.Segmenter(locale, { granularity: "grapheme" }).segment(value)) {
    boundaries.add(part.index);
    boundaries.add(part.index + part.segment.length);
  }
  return boundaries;
}

function mergeAdjacentText(segments: readonly Segment[]): Segment[] {
  const merged: Segment[] = [];
  for (const segment of segments) {
    if (typeof segment === "string" && typeof merged.at(-1) === "string") {
      merged[merged.length - 1] = String(merged[merged.length - 1]) + segment;
    } else if (typeof segment !== "string" || segment.length > 0) {
      merged.push(segment);
    }
  }
  return merged.length > 0 ? merged : [""];
}

function expandRoot(draft: AuthorDraft): string {
  return draft.root
    .map((segment) => (typeof segment === "string" ? segment : draft.clues[segment.ref]?.answer ?? ""))
    .join("");
}

function syncFinalText(draft: AuthorDraft): AuthorDraft {
  draft.finalText = expandRoot(draft);
  return draft;
}

function findIncomingReference(draft: AuthorDraft, clueId: string): {
  owner: string;
  segmentIndex: number;
  segment: ReferenceSegment;
} | null {
  const owners: Array<[string, Segment[]]> = [["root", draft.root]];
  for (const [id, clue] of Object.entries(draft.clues)) {
    owners.push([id, clue.prompt]);
    if (Array.isArray(clue.rightPrompt)) owners.push([`${id}:right`, clue.rightPrompt]);
  }
  for (const [owner, segments] of owners) {
    const segmentIndex = segments.findIndex((segment) => isReferenceSegment(segment) && segment.ref === clueId);
    if (segmentIndex >= 0) return { owner, segmentIndex, segment: segments[segmentIndex] as ReferenceSegment };
  }
  return null;
}

function collectSubtree(draft: AuthorDraft, clueId: string, collected: Set<string> = new Set()): Set<string> {
  if (collected.has(clueId) || !draft.clues[clueId]) return collected;
  collected.add(clueId);
  for (const segments of clueSegmentGroups(draft.clues[clueId])) {
    for (const segment of segments) {
      if (isReferenceSegment(segment)) collectSubtree(draft, segment.ref, collected);
    }
  }
  return collected;
}

function draftSegmentsAreSafe(segments: unknown): segments is Segment[] {
  return Array.isArray(segments) && segments.length > 0 && segments.every((segment) => {
    if (typeof segment === "string") return true;
    if (!isReferenceSegment(segment)) return false;
    const keys = Object.keys(segment);
    return keys.every((key) => ["ref", "direction"].includes(key)) &&
      (!Object.hasOwn(segment, "direction") || segment.direction === "left" || segment.direction === "right");
  });
}

function matchPolicyIsSafe(match: unknown): boolean {
  if (!isRecord(match)) return false;
  const booleanKeys = new Set([
    "foldCase",
    "trim",
    "collapseWhitespace",
    "canonicalizeQuotes",
    "canonicalizeHyphens",
    "optionalAcuteVowels",
    "ignorePunctuation"
  ]);
  return Object.entries(match).every(([key, value]) =>
    (key === "locale" && typeof value === "string") || (booleanKeys.has(key) && typeof value === "boolean")
  );
}

function sourceIsSafe(source: unknown): boolean {
  return isRecord(source) &&
    Object.keys(source).every((key) => ["label", "url"].includes(key)) &&
    typeof source.label === "string" &&
    (!Object.hasOwn(source, "url") || typeof source.url === "string");
}

function scoringIsSafe(scoring: unknown): boolean {
  if (!isRecord(scoring) || !Object.keys(scoring).every((key) => ["base", "wrongGuess", "peek", "ranks"].includes(key))) {
    return false;
  }
  for (const key of ["base", "wrongGuess", "peek"]) {
    if (Object.hasOwn(scoring, key) && !Number.isFinite(scoring[key])) return false;
  }
  return !Object.hasOwn(scoring, "ranks") || (
    Array.isArray(scoring.ranks) && scoring.ranks.every((rank) =>
      isRecord(rank) &&
      Object.keys(rank).every((key) => ["minScore", "labelKey"].includes(key)) &&
      Number.isFinite(rank.minScore) &&
      typeof rank.labelKey === "string"
    )
  );
}

function draftIsStructurallySafe(draft: unknown): draft is AuthorDraft {
  if (
    !isRecord(draft) ||
    draft.version !== AUTHOR_DRAFT_VERSION ||
    !isRecord(draft.metadata) ||
    typeof draft.metadata.id !== "string" ||
    typeof draft.metadata.title !== "string" ||
    typeof draft.metadata.locale !== "string" ||
    typeof draft.metadata.releaseDate !== "string" ||
    (Object.hasOwn(draft.metadata, "factDate") && typeof draft.metadata.factDate !== "string") ||
    typeof draft.metadata.revision !== "number" ||
    !Number.isFinite(draft.metadata.revision) ||
    typeof draft.finalText !== "string" ||
    !draftSegmentsAreSafe(draft.root) ||
    !isRecord(draft.clues) ||
    (draft.selectedClueId !== null && typeof draft.selectedClueId !== "string") ||
    (Object.hasOwn(draft, "source") && !sourceIsSafe(draft.source)) ||
    (Object.hasOwn(draft, "scoring") && !scoringIsSafe(draft.scoring))
  ) return false;

  for (const clue of Object.values(draft.clues)) {
    if (
      !isRecord(clue) ||
      typeof clue.answer !== "string" ||
      !draftSegmentsAreSafe(clue.prompt) ||
      (Object.hasOwn(clue, "rightPrompt") && !draftSegmentsAreSafe(clue.rightPrompt)) ||
      (Object.hasOwn(clue, "accept") && (!Array.isArray(clue.accept) || clue.accept.some((alias) => typeof alias !== "string"))) ||
      (Object.hasOwn(clue, "peek") && typeof clue.peek !== "string") ||
      (Object.hasOwn(clue, "match") && !matchPolicyIsSafe(clue.match))
    ) return false;
  }
  if (draft.selectedClueId !== null && !Object.hasOwn(draft.clues, draft.selectedClueId)) return false;

  const safeDraft = draft as unknown as AuthorDraft;
  const seen = new Set<string>();
  const active = new Set<string>();
  const visit = (segments: readonly Segment[]): boolean => {
    for (const segment of segments) {
      if (!isReferenceSegment(segment)) continue;
      if (!Object.hasOwn(safeDraft.clues, segment.ref) || seen.has(segment.ref) || active.has(segment.ref)) return false;
      active.add(segment.ref);
      for (const childSegments of clueSegmentGroups(safeDraft.clues[segment.ref]!)) {
        if (!visit(childSegments)) return false;
      }
      active.delete(segment.ref);
      seen.add(segment.ref);
    }
    return true;
  };
  return visit(safeDraft.root) && seen.size === Object.keys(safeDraft.clues).length;
}

export function createAuthorDraft({
  id = "mi-rompecabezas",
  revision = 1,
  locale = "es-ES",
  title = "Mi rompecabezas",
  releaseDate = "",
  finalText = ""
}: Partial<{
  id: string;
  revision: number;
  locale: string;
  title: string;
  releaseDate: string;
  finalText: string;
}> = {}): AuthorDraft {
  return {
    version: AUTHOR_DRAFT_VERSION,
    metadata: { id, revision, locale, title, releaseDate },
    finalText,
    root: [finalText],
    clues: {},
    selectedClueId: null
  };
}

export function authorDraftFromDefinition(definition: PuzzleDefinition, localePack: LocalePack): AuthorDraft {
  const validation = validatePuzzle(definition, localePack);
  if (!validation.valid) {
    throw new AuthoringError("INVALID_DEFINITION", "Only a valid playable puzzle can be loaded for editing.");
  }

  const draft: AuthorDraft = {
    version: AUTHOR_DRAFT_VERSION,
    metadata: {
      id: definition.id,
      revision: definition.revision ?? 1,
      locale: definition.locale,
      title: definition.title ?? "",
      releaseDate: definition.releaseDate ?? ""
    },
    finalText: definition.finalText,
    root: clone(definition.root),
    clues: clone(definition.clues),
    selectedClueId: null
  };
  if (definition.factDate) draft.metadata.factDate = definition.factDate;
  if (definition.source) draft.source = clone(definition.source);
  if (definition.scoring) draft.scoring = clone(definition.scoring);
  return draft;
}

export function setFinalText(currentDraft: AuthorDraft, finalText: string): AuthorDraft {
  if (Object.keys(currentDraft.clues).length > 0) {
    throw new AuthoringError("STRUCTURE_EXISTS", "Remove the clue structure before replacing final text.");
  }
  const draft = clone(currentDraft);
  draft.finalText = String(finalText);
  draft.root = [draft.finalText];
  return draft;
}

export function updateMetadata(currentDraft: AuthorDraft, changes: Partial<AuthorDraft["metadata"]>): AuthorDraft {
  const draft = clone(currentDraft);
  draft.metadata = { ...draft.metadata, ...changes };
  return draft;
}

export function replaceLiteralSelection(currentDraft: AuthorDraft, {
  owner = "root",
  segmentIndex,
  start,
  end,
  locale = currentDraft.metadata.locale
}: {
  owner?: string;
  segmentIndex: number;
  start: number;
  end: number;
  locale?: string;
}): { draft: AuthorDraft; clueId: string } {
  const sourceSegments = ownerSegments(currentDraft, owner);
  const literal = sourceSegments[segmentIndex];
  if (typeof literal !== "string") {
    throw new AuthoringError("SELECTION_NOT_LITERAL", "A clue can be created only from literal text.");
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end > literal.length || start >= end) {
    throw new AuthoringError("INVALID_SELECTION", "Select one or more complete characters.");
  }
  const boundaries = graphemeBoundaries(literal, locale);
  if (!boundaries.has(start) || !boundaries.has(end)) {
    throw new AuthoringError("SPLIT_GRAPHEME", "The selection must not split a visible character.");
  }
  const draft = clone(currentDraft);
  const segments = ownerSegments(draft, owner);
  const answer = literal.slice(start, end);
  const clueId = nextClueId(draft.clues);
  const replacement = [literal.slice(0, start), { ref: clueId }, literal.slice(end)].filter(
    (segment) => typeof segment !== "string" || segment.length > 0
  );
  segments.splice(segmentIndex, 1, ...replacement);
  draft.clues[clueId] = { answer, prompt: [""] };
  draft.selectedClueId = clueId;
  syncFinalText(draft);
  return { draft, clueId };
}

export function updateLiteral(
  currentDraft: AuthorDraft,
  { owner = "root", segmentIndex, value }: { owner?: string; segmentIndex: number; value: string }
): AuthorDraft {
  const draft = clone(currentDraft);
  const segments = ownerSegments(draft, owner);
  if (typeof segments[segmentIndex] !== "string") {
    throw new AuthoringError("SEGMENT_NOT_LITERAL", "The selected segment is not editable text.");
  }
  segments[segmentIndex] = String(value);
  if (owner === "root") syncFinalText(draft);
  return draft;
}

export function addLiteralSegment(
  currentDraft: AuthorDraft,
  { owner = "root", at }: { owner?: string; at?: number }
): AuthorDraft {
  const draft = clone(currentDraft);
  const segments = ownerSegments(draft, owner);
  const index = Math.max(0, Math.min(typeof at === "number" && Number.isSafeInteger(at) ? at : segments.length, segments.length));
  segments.splice(index, 0, "");
  return draft;
}

export function updateClue(currentDraft: AuthorDraft, clueId: string, changes: Partial<ClueDefinition> & {
  rightPrompt?: Segment[] | null;
}): AuthorDraft {
  if (!currentDraft.clues[clueId]) throw new AuthoringError("UNKNOWN_CLUE", `Unknown clue '${clueId}'.`);
  const draft = clone(currentDraft);
  const clue = draft.clues[clueId]!;
  if (Object.hasOwn(changes, "answer")) clue.answer = String(changes.answer);
  if (changes.accept !== undefined) clue.accept = [...changes.accept];
  if (Object.hasOwn(changes, "peek")) clue.peek = String(changes.peek);
  if (changes.prompt !== undefined) clue.prompt = clone(changes.prompt);
  if (Object.hasOwn(changes, "rightPrompt")) {
    if (changes.rightPrompt === null) delete clue.rightPrompt;
    else if (changes.rightPrompt !== undefined) clue.rightPrompt = clone(changes.rightPrompt);
  }
  syncFinalText(draft);
  return draft;
}

export function selectClue(currentDraft: AuthorDraft, clueId: string | null): AuthorDraft {
  if (clueId !== null && !currentDraft.clues[clueId]) throw new AuthoringError("UNKNOWN_CLUE", `Unknown clue '${clueId}'.`);
  const draft = clone(currentDraft);
  draft.selectedClueId = clueId;
  return draft;
}

export function setReferenceDirection(
  currentDraft: AuthorDraft,
  clueId: string,
  direction: Direction | null
): AuthorDraft {
  if (direction !== null && direction !== "left" && direction !== "right") {
    throw new AuthoringError("INVALID_DIRECTION", "Direction must be left, right, or empty.");
  }
  const clue = currentDraft.clues[clueId];
  if (!clue) throw new AuthoringError("UNKNOWN_CLUE", `Unknown clue '${clueId}'.`);
  if (direction !== null && Array.isArray(clue.rightPrompt)) {
    throw new AuthoringError("DUAL_HINT_DIRECTION", "A two-sided clue already defines both arrow directions.");
  }
  const incoming = findIncomingReference(currentDraft, clueId);
  if (!incoming) throw new AuthoringError("MISSING_INCOMING_REFERENCE", "The clue has no parent reference.");
  const draft = clone(currentDraft);
  const segment = ownerSegments(draft, incoming.owner)[incoming.segmentIndex] as ReferenceSegment;
  if (direction === null) delete segment.direction;
  else segment.direction = direction;
  return draft;
}

export function setRightPrompt(currentDraft: AuthorDraft, clueId: string, enabled: boolean): AuthorDraft {
  const clue = currentDraft.clues[clueId];
  if (!clue) throw new AuthoringError("UNKNOWN_CLUE", `Unknown clue '${clueId}'.`);
  const draft = clone(currentDraft);
  const nextClue = draft.clues[clueId]!;
  if (enabled) {
    if (!Array.isArray(nextClue.rightPrompt)) nextClue.rightPrompt = [""];
    const incoming = findIncomingReference(draft, clueId);
    if (incoming) delete (ownerSegments(draft, incoming.owner)[incoming.segmentIndex] as ReferenceSegment).direction;
    return draft;
  }
  if (!Array.isArray(nextClue.rightPrompt)) return draft;
  for (const segment of nextClue.rightPrompt) {
    if (!isReferenceSegment(segment)) continue;
    for (const id of collectSubtree(draft, segment.ref)) delete draft.clues[id];
  }
  delete nextClue.rightPrompt;
  draft.selectedClueId = clueId;
  return draft;
}

export function removeClue(currentDraft: AuthorDraft, clueId: string): AuthorDraft {
  const clue = currentDraft.clues[clueId];
  const incoming = findIncomingReference(currentDraft, clueId);
  if (!clue || !incoming) throw new AuthoringError("UNKNOWN_CLUE", `Unknown clue '${clueId}'.`);
  const draft = clone(currentDraft);
  const segments = ownerSegments(draft, incoming.owner);
  segments.splice(incoming.segmentIndex, 1, clue.answer);
  const merged = mergeAdjacentText(segments);
  segments.splice(0, segments.length, ...merged);
  for (const id of collectSubtree(draft, clueId)) delete draft.clues[id];
  draft.selectedClueId = incoming.owner === "root" ? null : ownerClueId(incoming.owner);
  syncFinalText(draft);
  return draft;
}

export function definitionFromDraft(draft: AuthorDraft): PuzzleDefinition {
  const definition: PuzzleDefinition = {
    schemaVersion: 1,
    id: draft.metadata.id,
    revision: Number(draft.metadata.revision),
    locale: draft.metadata.locale,
    finalText: draft.finalText,
    root: clone(draft.root),
    clues: {}
  };
  if (draft.metadata.title) definition.title = draft.metadata.title;
  if (draft.metadata.releaseDate) definition.releaseDate = draft.metadata.releaseDate;
  if (draft.metadata.factDate) definition.factDate = draft.metadata.factDate;
  if (draft.source) definition.source = clone(draft.source);
  if (draft.scoring) definition.scoring = clone(draft.scoring);
  for (const [id, source] of Object.entries(draft.clues)) {
    const clue: ClueDefinition = { answer: source.answer, prompt: clone(source.prompt) };
    if (Array.isArray(source.rightPrompt)) clue.rightPrompt = clone(source.rightPrompt);
    const aliases = Array.isArray(source.accept) ? source.accept.filter((alias) => alias.length > 0) : [];
    if (aliases.length > 0) clue.accept = aliases;
    if (source.peek) clue.peek = source.peek;
    if (source.match) clue.match = clone(source.match);
    definition.clues[id] = clue;
  }
  return definition;
}

export function validateAuthorDraft(draft: AuthorDraft, localePack: LocalePack): ValidationResult {
  return validatePuzzle(definitionFromDraft(draft), localePack);
}

export function compileAuthorPreview(draft: AuthorDraft, localePack: LocalePack): CompiledPuzzle {
  return compilePuzzle(definitionFromDraft(draft), localePack);
}

export function serializeAuthorPuzzle(draft: AuthorDraft, localePack: LocalePack): string {
  const definition = definitionFromDraft(draft);
  const validation = validatePuzzle(definition, localePack);
  if (!validation.valid) throw new AuthoringError("INVALID_DRAFT", "Correct validation errors before export.");
  return `${JSON.stringify(definition, null, 2)}\n`;
}

export function restoreAuthorDraft(serialized: unknown, fallback: AuthorDraft = createAuthorDraft()): AuthorDraft {
  try {
    const input: unknown = typeof serialized === "string" ? JSON.parse(serialized) : serialized;
    const draft = Effect.runSync(decodeAuthorDraft("saved author draft", input));
    if (!draftIsStructurallySafe(draft)) return clone(fallback);
    return clone(draft);
  } catch {
    return clone(fallback);
  }
}

export function serializeAuthorDraft(draft: AuthorDraft): string {
  return JSON.stringify(draft);
}

export function tryAuthorMutation<A>(operation: () => A): Result.Result<A, AuthoringError> {
  try {
    return Result.succeed(operation());
  } catch (error: unknown) {
    return Result.fail(error instanceof AuthoringError
      ? error
      : new AuthoringError("UNEXPECTED_AUTHORING_ERROR", error instanceof Error ? error.message : String(error)));
  }
}
