import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260913130000_add_puzzle_analytics.sql", import.meta.url),
  "utf8"
);

test("analytics rows are append-only for browser roles", () => {
  assert.match(migration, /alter table public\.puzzle_analytics enable row level security/u);
  assert.match(migration, /revoke all on table public\.puzzle_analytics from public, anon, authenticated/u);
  assert.match(migration, /grant insert \([\s\S]+\) on table public\.puzzle_analytics to anon, authenticated/u);
  assert.doesNotMatch(migration, /grant (?:select|update|delete)[\s\S]+puzzle_analytics to anon/u);
  assert.match(migration, /for insert[\s\S]+to anon, authenticated[\s\S]+with check/u);
});

test("analytics accepts only released puzzle revisions and constrained events", () => {
  assert.match(migration, /puzzles\.puzzle_id = puzzle_analytics\.puzzle_id/u);
  assert.match(migration, /puzzles\.revision = puzzle_analytics\.puzzle_revision/u);
  assert.match(migration, /puzzles\.status = 'published'/u);
  assert.match(migration, /unique \(run_id, event_type\)/u);
  assert.match(migration, /event_type = 'load'[\s\S]+score is null/u);
  assert.match(migration, /event_type = 'completion'[\s\S]+score is not null/u);
  assert.match(migration, /score <= max_score/u);
});

test("analytics summary views stay private", () => {
  assert.match(migration, /create view private\.puzzle_usage_analytics/u);
  assert.match(migration, /create view private\.puzzle_difficulty_analytics/u);
  assert.match(migration, /percentile_cont\(0\.5\)/u);
  assert.match(migration, /revoke all on private\.puzzle_usage_analytics from public, anon, authenticated/u);
  assert.match(migration, /revoke all on private\.puzzle_difficulty_analytics from public, anon, authenticated/u);
});

test("the dashboard receives aggregates through a service-role-only function", () => {
  assert.match(migration, /create or replace function public\.get_puzzle_analytics\(p_days integer default 30\)/u);
  assert.match(migration, /'meanScore', summary\.mean_score/u);
  assert.match(migration, /'puzzles', coalesce/u);
  assert.match(migration, /'difficulties', coalesce/u);
  assert.match(migration, /revoke all on function public\.get_puzzle_analytics\(integer\) from public, anon, authenticated/u);
  assert.match(migration, /grant execute on function public\.get_puzzle_analytics\(integer\) to service_role/u);
});
