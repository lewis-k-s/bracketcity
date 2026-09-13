import assert from "node:assert/strict";
import test from "node:test";

import {
  createSupabaseAnalyticsRecorder,
  startPuzzleAnalyticsSession
} from "../src/analytics.ts";
import type { PuzzleAnalyticsEvent } from "../src/analytics.ts";
import type { Progress, PuzzleDefinition, ScoreResult, SupabaseConfig } from "../src/types.ts";
import { branchPuzzle } from "./fixtures.ts";

const config: SupabaseConfig = {
  url: "https://project-ref.supabase.co",
  publishableKey: "sb_publishable_public-key",
  authorModeEnabled: true,
  canAuthor: false
};

test("Supabase analytics sends an insert-only row without visitor data", async () => {
  const calls: Array<{ url: string; options: RequestInit }> = [];
  const recorder = createSupabaseAnalyticsRecorder(config, async (input, options) => {
    calls.push({ url: String(input), options: options ?? {} });
    return new Response(null, { status: 201 });
  });

  await recorder({
    runId: "11111111-1111-4111-8111-111111111111",
    puzzleId: "branch-es",
    puzzleRevision: 3,
    eventType: "load",
    difficulty: 2,
    difficultyLabel: "medium",
    score: null,
    maxScore: null,
    elapsedSeconds: null,
    mistakes: null,
    hintsUsed: null
  });

  assert.equal(calls[0]!.url, "https://project-ref.supabase.co/rest/v1/puzzle_analytics");
  assert.equal(calls[0]!.options.method, "POST");
  assert.equal(calls[0]!.options.keepalive, true);
  assert.deepEqual(calls[0]!.options.headers, {
    Accept: "application/json",
    apikey: "sb_publishable_public-key",
    "Content-Type": "application/json",
    Prefer: "return=minimal"
  });
  const body = JSON.parse(String(calls[0]!.options.body)) as Record<string, unknown>;
  assert.deepEqual(body, {
    run_id: "11111111-1111-4111-8111-111111111111",
    puzzle_id: "branch-es",
    puzzle_revision: 3,
    event_type: "load",
    difficulty: 2,
    difficulty_label: "medium",
    score: null,
    max_score: null,
    elapsed_seconds: null,
    mistakes: null,
    hints_used: null
  });
  assert.equal(Object.keys(body).some((key) => /user|visitor|device|ip|agent/u.test(key)), false);
});

test("one analytics session pairs a load with one completion", async () => {
  const events: PuzzleAnalyticsEvent[] = [];
  const definition: PuzzleDefinition = { ...branchPuzzle, difficulty: "medium" };
  const times = [1_000, 62_400];
  const session = startPuzzleAnalyticsSession(
    definition,
    async (event) => { events.push(event); },
    {
      createRunId: () => "22222222-2222-4222-8222-222222222222",
      now: () => times.shift() ?? 62_400
    }
  );
  assert.ok(session);
  await Promise.resolve();

  const progress: Progress = {
    version: 4,
    puzzleId: definition.id,
    puzzleRevision: definition.revision ?? 1,
    solved: {},
    peeked: ["book"],
    wrongGuesses: 2,
    keystrokes: 10
  };
  const score: ScoreResult = {
    score: 94,
    rawScore: 94,
    rank: null,
    breakdown: { base: 100, wrongGuesses: 2, peeked: 1 }
  };
  session.recordCompletion(progress, score);
  session.recordCompletion(progress, score);
  await Promise.resolve();

  assert.equal(events.length, 2);
  assert.equal(events[0]!.eventType, "load");
  assert.equal(events[1]!.eventType, "completion");
  assert.equal(events[0]!.runId, events[1]!.runId);
  assert.equal(events[1]!.puzzleRevision, 3);
  assert.equal(events[1]!.difficulty, 2);
  assert.equal(events[1]!.difficultyLabel, "medium");
  assert.equal(events[1]!.score, 94);
  assert.equal(events[1]!.maxScore, 100);
  assert.equal(events[1]!.elapsedSeconds, 61);
  assert.equal(events[1]!.mistakes, 2);
  assert.equal(events[1]!.hintsUsed, 1);
});

test("analytics setup and delivery failures do not escape into gameplay", async () => {
  assert.equal(startPuzzleAnalyticsSession(
    branchPuzzle,
    async () => { throw new Error("unavailable"); },
    { createRunId: () => { throw new Error("UUID unavailable"); } }
  ), null);

  const session = startPuzzleAnalyticsSession(
    branchPuzzle,
    async () => { throw new Error("unavailable"); },
    { createRunId: () => "33333333-3333-4333-8333-333333333333" }
  );
  assert.ok(session);
  assert.doesNotThrow(() => session.recordCompletion({
    version: 4,
    puzzleId: branchPuzzle.id,
    puzzleRevision: branchPuzzle.revision ?? 1,
    solved: {},
    peeked: [],
    wrongGuesses: 0,
    keystrokes: 0
  }, {
    score: 100,
    rawScore: 100,
    rank: null,
    breakdown: { base: 100, wrongGuesses: 0, peeked: 0 }
  }));
  await Promise.resolve();
  await Promise.resolve();
});
