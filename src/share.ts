import { DEFAULT_SCORING } from "./engine.ts";
import { BRAND_NAME } from "./brand.ts";
import type { CompiledPuzzle, LocalePack, ScoreResult } from "./types.ts";

const SHARE_BAR_LENGTH = 10;

export interface CompletionShare {
  readonly title: string;
  readonly text: string;
  readonly url: string;
}

export function formatShareDate(value: string | undefined, localeId: string): string {
  if (!value) return "";
  const [year = 0, month = 0, day = 0] = value.split("-").map(Number);
  return new Intl.DateTimeFormat(localeId, {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

export function completionBar(score: number, total: number): string {
  const ratio = total > 0 ? score / total : 0;
  const filled = Math.max(0, Math.min(SHARE_BAR_LENGTH, Math.round(ratio * SHARE_BAR_LENGTH)));
  return `⟦${"▰".repeat(filled)}${"▱".repeat(SHARE_BAR_LENGTH - filled)}⟧`;
}

export function createCompletionShare(
  puzzle: CompiledPuzzle,
  score: ScoreResult,
  locale: LocalePack,
  url: string
): CompletionShare {
  const total = puzzle.definition.scoring?.base ?? DEFAULT_SCORING.base;
  const title = puzzle.definition.title ?? locale.ui.gameLabel;
  const date = formatShareDate(puzzle.definition.releaseDate, locale.id);
  const card = [
    `${BRAND_NAME} · ${title}`,
    date,
    `${score.score}/${total} ${locale.ui.sharePoints}`,
    completionBar(score.score, total)
  ].filter(Boolean).join("\n");
  return { title: `${BRAND_NAME} · ${title}`, text: `${card}\n\n${url}`, url };
}
