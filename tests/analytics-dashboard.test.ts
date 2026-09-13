import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";

import {
  createSupabaseAnalyticsDashboardLoader,
  decodePuzzleAnalyticsReport,
  startAnalyticsDashboard
} from "../src/analytics-dashboard.ts";
import type { LocalePack, SupabaseConfig } from "../src/types.ts";
import { installDomWindow, q } from "./test-dom.ts";

const locale = JSON.parse(readFileSync(new URL("../locales/es-ES.json", import.meta.url), "utf8")) as LocalePack;
const config: SupabaseConfig = {
  url: "https://project-ref.supabase.co",
  publishableKey: "sb_publishable_test-key",
  authorModeEnabled: true,
  canAuthor: false
};

const analytics = {
  generatedAt: "2026-09-13T14:30:00Z",
  periodDays: 30,
  periodStart: "2026-08-14T14:30:00Z",
  summary: {
    loads: 20,
    completions: 12,
    completionRate: 0.6,
    meanScore: 91.5,
    meanMaxScore: 100,
    meanNormalizedScore: 0.915,
    medianNormalizedScore: 0.93,
    meanCompletionSeconds: 75,
    meanMistakes: 1.2,
    meanHints: 0.5
  },
  puzzles: [{
    puzzleId: "sample-es",
    puzzleRevision: 2,
    title: "Muestra",
    releaseDate: "2026-09-12",
    difficulty: 2,
    difficultyLabel: "medium",
    loads: 20,
    completions: 12,
    completionRate: 0.6,
    meanScore: 91.5,
    meanMaxScore: 100,
    meanNormalizedScore: 0.915,
    medianNormalizedScore: 0.93,
    meanCompletionSeconds: 75,
    meanMistakes: 1.2,
    meanHints: 0.5
  }],
  difficulties: [{
    difficulty: 2,
    difficultyLabel: "medium",
    loads: 20,
    completions: 12,
    completionRate: 0.6,
    meanScore: 91.5,
    meanMaxScore: 100,
    meanNormalizedScore: 0.915,
    medianNormalizedScore: 0.93,
    meanCompletionSeconds: 75,
    meanMistakes: 1.2,
    meanHints: 0.5
  }]
};

function installDom(): void {
  const dom = new JSDOM("<!doctype html><html><body><main id='app'></main></body></html>", {
    url: "https://entre-parentesis.es/?mode=analytics"
  });
  installDomWindow(dom.window);
}

test("the authenticated loader requests aggregate analytics with the current token", async () => {
  const requests: Array<{ readonly url: string; readonly init: RequestInit | undefined }> = [];
  const loader = createSupabaseAnalyticsDashboardLoader(config, async () => "fresh-token", async (input, init) => {
    requests.push({ url: String(input), init });
    return new Response(JSON.stringify({ analytics }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  });

  const report = await loader(30);
  const request = requests[0];
  assert.ok(request);
  assert.equal(report.summary.loads, 20);
  assert.equal(report.puzzles[0]?.medianNormalizedScore, 0.93);
  assert.equal(request.url, "https://project-ref.supabase.co/functions/v1/puzzle-admin");
  assert.equal(request.init?.headers && (request.init.headers as Record<string, string>).Authorization, "Bearer fresh-token");
  assert.deepEqual(JSON.parse(String(request.init?.body)), { action: "analytics", days: 30 });
});

test("the dashboard shows all core metrics and reloads for a selected period", async () => {
  installDom();
  const requestedPeriods: Array<number | null> = [];
  const dashboard = startAnalyticsDashboard({
    mount: q("#app"),
    locale,
    pageUrl: "https://entre-parentesis.es/",
    async loadReport(days) {
      requestedPeriods.push(days);
      return decodePuzzleAnalyticsReport({ ...analytics, periodDays: days });
    }
  });
  await dashboard.refresh();

  assert.equal(q('[data-testid="analytics-loads"]').textContent.includes("20"), true);
  assert.equal(q('[data-testid="analytics-completion-rate"]').textContent.includes("60"), true);
  assert.match(q('[data-testid="analytics-mean-score"]').textContent, /91,5 \/ 100 · 91,5\s?%/u);
  assert.match(q('[data-testid="analytics-mean-time"]').textContent, /1 min 15 s/u);
  assert.match(q('[data-testid="analytics-puzzle-table"]').textContent, /Muestra · r2/u);
  assert.match(q('[data-testid="analytics-difficulty-table"]').textContent, /2 · Media/u);
  assert.equal(document.querySelector('[data-testid="analytics-link"]'), null);
  assert.equal(document.querySelector('a[aria-current="page"]')?.textContent, "Analítica");

  const select = q('[data-testid="analytics-period"]');
  select.value = "all";
  select.dispatchEvent(new window.Event("change", { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(requestedPeriods.includes(null), true);
  dashboard.destroy();
});

test("invalid aggregate responses fail closed", () => {
  const { generatedAt: _generatedAt, ...invalid } = analytics;
  assert.throws(() => decodePuzzleAnalyticsReport(invalid), /generatedAt/u);
});
