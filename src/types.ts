export type Direction = "left" | "right";

export interface ReferenceSegment {
  ref: string;
  direction?: Direction;
}

export type Segment = string | ReferenceSegment;

export interface MatchPolicy {
  readonly locale: string;
  readonly foldCase: boolean;
  readonly trim: boolean;
  readonly collapseWhitespace: boolean;
  readonly canonicalizeQuotes: boolean;
  readonly canonicalizeHyphens: boolean;
  readonly optionalAcuteVowels: boolean;
  readonly ignorePunctuation: boolean;
}

export interface ScoreRank {
  readonly minScore: number;
  readonly labelKey: string;
}

export interface Scoring {
  readonly base?: number;
  readonly wrongGuess?: number;
  readonly peek?: number;
  readonly ranks?: readonly ScoreRank[];
}

export interface PuzzleSource {
  label: string;
  url?: string;
}

export interface ClueDefinition {
  answer: string;
  prompt: Segment[];
  rightPrompt?: Segment[];
  accept?: string[];
  peek?: string;
  match?: Partial<MatchPolicy>;
}

export interface PuzzleDefinition {
  schemaVersion: 1;
  id: string;
  revision?: number;
  locale: string;
  title?: string;
  releaseDate?: string;
  factDate?: string;
  finalText: string;
  root: Segment[];
  clues: Record<string, ClueDefinition>;
  source?: PuzzleSource;
  scoring?: Scoring;
}

export interface LocaleKeyboard {
  readonly mode: string;
  readonly rows: readonly (readonly string[])[];
  readonly extras: readonly string[];
}

export interface LocalePack {
  readonly id: string;
  readonly dir: "ltr" | "rtl";
  readonly ui: Record<string, string>;
  readonly matching?: Partial<MatchPolicy>;
  readonly keyboard: LocaleKeyboard;
}

export interface ValidationIssue {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: ValidationIssue[];
  readonly warnings: ValidationIssue[];
}

export interface CompiledClue extends Omit<ClueDefinition, "accept" | "match"> {
  readonly id: string;
  readonly children: string[];
  readonly parent: string | null;
  readonly accepted: Set<string>;
  readonly peek: string;
  readonly match: MatchPolicy;
}

export interface CompiledPuzzle {
  readonly definition: PuzzleDefinition;
  readonly nodes: Map<string, CompiledClue>;
  readonly rootChildren: string[];
  readonly order: string[];
  readonly localePack: LocalePack | null;
  readonly validation: ValidationResult;
}

export interface Progress {
  readonly version: 3;
  readonly puzzleId: string;
  readonly puzzleRevision: number;
  solved: Record<string, "guess">;
  peeked: string[];
  wrongGuesses: number;
  keystrokes: number;
  startedAt?: string;
  completedAt?: string;
}

export type TransitionType = "correct" | "wrong" | "peek" | "empty" | "noop";

export interface Transition {
  readonly type: TransitionType;
  readonly progress: Progress;
  readonly newlyAvailable: string[];
  readonly completed: boolean;
  readonly becameComplete: boolean;
  readonly clueId?: string;
  readonly peek?: string;
}

export interface ScoreResult {
  readonly score: number;
  readonly rawScore: number;
  readonly rank: ScoreRank | null;
  readonly breakdown: {
    readonly base: number;
    readonly wrongGuesses: number;
    readonly peeked: number;
  };
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export interface CatalogEntry {
  readonly date: string;
  readonly file?: string;
  readonly definition?: PuzzleDefinition;
  readonly id?: string;
  readonly revision?: number;
  readonly title?: string;
}

export interface PuzzleCatalog {
  readonly schemaVersion: 1;
  readonly defaultDate: string;
  readonly puzzles: CatalogEntry[];
}

export interface PublishedPuzzleStore {
  readonly version: 1;
  readonly puzzles: Record<string, PuzzleDefinition>;
}

export interface WordPressConfig {
  readonly restBase: string;
  readonly assetBase?: string;
  readonly nonce?: string;
  readonly canAuthor: boolean;
  readonly pageUrl?: string;
  readonly localeUrl?: string;
  readonly currentDate?: string;
  readonly timeZone?: string;
}

export interface PuzzleListing {
  readonly entries: CatalogEntry[];
  readonly currentDate?: string;
  readonly timeZone?: string;
}

export interface AuthorMetadata {
  id: string;
  revision: number;
  locale: string;
  title: string;
  releaseDate: string;
  factDate?: string;
}

export interface AuthorDraft {
  readonly version: 1;
  metadata: AuthorMetadata;
  finalText: string;
  root: Segment[];
  clues: Record<string, ClueDefinition>;
  selectedClueId: string | null;
  source?: PuzzleSource;
  scoring?: Scoring;
}

export interface ExistingPuzzle {
  readonly date: string;
  definition: PuzzleDefinition;
}

export interface ImportResult {
  readonly date: string;
  readonly ok: boolean;
  readonly skipped?: boolean;
  readonly result?: unknown;
  readonly error?: unknown;
}
