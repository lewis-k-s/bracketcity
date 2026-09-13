import type {
  Progress,
  PuzzleDefinition,
  PuzzleDifficulty,
  ScoreResult,
  SupabaseConfig
} from "./types.ts";

export interface PuzzleAnalyticsEvent {
  readonly runId: string;
  readonly puzzleId: string;
  readonly puzzleRevision: number;
  readonly eventType: "load" | "completion";
  readonly difficulty: number | null;
  readonly difficultyLabel: PuzzleDifficulty | null;
  readonly score: number | null;
  readonly maxScore: number | null;
  readonly elapsedSeconds: number | null;
  readonly mistakes: number | null;
  readonly hintsUsed: number | null;
}

export type PuzzleAnalyticsRecorder = (event: PuzzleAnalyticsEvent) => Promise<void>;

export interface PuzzleAnalyticsSession {
  readonly runId: string;
  readonly recordCompletion: (progress: Progress, score: ScoreResult) => void;
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const difficultyNumbers: Record<PuzzleDifficulty, number> = {
  easy: 1,
  medium: 2,
  hard: 3
};

function scheduleRecord(recorder: PuzzleAnalyticsRecorder, event: PuzzleAnalyticsEvent): void {
  void Promise.resolve()
    .then(() => recorder(event))
    .catch(() => undefined);
}

function eventBase(definition: PuzzleDefinition, runId: string) {
  const difficultyLabel = definition.difficulty ?? null;
  return {
    runId,
    puzzleId: definition.id,
    puzzleRevision: definition.revision ?? 1,
    difficulty: difficultyLabel ? difficultyNumbers[difficultyLabel] : null,
    difficultyLabel
  };
}

export function createSupabaseAnalyticsRecorder(
  config: SupabaseConfig,
  fetchImpl: FetchLike = globalThis.fetch
): PuzzleAnalyticsRecorder {
  const endpoint = new URL("/rest/v1/puzzle_analytics", config.url);
  return async (event) => {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        apikey: config.publishableKey,
        "Content-Type": "application/json",
        Prefer: "return=minimal"
      },
      body: JSON.stringify({
        run_id: event.runId,
        puzzle_id: event.puzzleId,
        puzzle_revision: event.puzzleRevision,
        event_type: event.eventType,
        difficulty: event.difficulty,
        difficulty_label: event.difficultyLabel,
        score: event.score,
        max_score: event.maxScore,
        elapsed_seconds: event.elapsedSeconds,
        mistakes: event.mistakes,
        hints_used: event.hintsUsed
      }),
      keepalive: true
    });
    if (!response.ok) throw new Error(`Analytics request failed (${response.status}).`);
  };
}

export function startPuzzleAnalyticsSession(
  definition: PuzzleDefinition,
  recorder: PuzzleAnalyticsRecorder | null | undefined,
  {
    createRunId = () => globalThis.crypto.randomUUID(),
    now = () => Date.now()
  }: {
    readonly createRunId?: () => string;
    readonly now?: () => number;
  } = {}
): PuzzleAnalyticsSession | null {
  if (!recorder) return null;
  try {
    const runId = createRunId();
    const startedAt = now();
    const base = eventBase(definition, runId);
    scheduleRecord(recorder, {
      ...base,
      eventType: "load",
      score: null,
      maxScore: null,
      elapsedSeconds: null,
      mistakes: null,
      hintsUsed: null
    });
    let completed = false;
    return {
      runId,
      recordCompletion(progress, score) {
        if (completed) return;
        completed = true;
        scheduleRecord(recorder, {
          ...base,
          eventType: "completion",
          score: score.score,
          maxScore: score.breakdown.base,
          elapsedSeconds: Math.max(0, Math.round((now() - startedAt) / 1_000)),
          mistakes: progress.wrongGuesses,
          hintsUsed: score.breakdown.peeked
        });
      }
    };
  } catch {
    return null;
  }
}
