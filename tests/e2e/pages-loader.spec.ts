import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";

const blogFixtureUrl = "/tests/e2e/fixtures/blog-embed-page.html";
const locale = JSON.parse(await readFile(resolve(import.meta.dirname, "../../locales/es-ES.json"), "utf8"));
const puzzle = JSON.parse(await readFile(resolve(import.meta.dirname, "../../puzzles/2026-08-31-es.json"), "utf8"));
const earlierPuzzle = JSON.parse(await readFile(resolve(import.meta.dirname, "../../puzzles/2026-08-30-es.json"), "utf8"));

function json(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body)
  });
}

const managerUser = {
  id: "00000000-0000-4000-8000-000000000001",
  aud: "authenticated",
  role: "authenticated",
  email: "manager@example.test",
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: {},
  identities: [],
  created_at: "2026-09-10T13:29:34Z",
  updated_at: "2026-09-10T13:31:26Z"
};

function authenticatedAuthorUrl(): string {
  const callback = new URLSearchParams({
    access_token: "session-token",
    expires_at: String(Math.floor(Date.now() / 1000) + 3600),
    expires_in: "3600",
    refresh_token: "refresh-token",
    token_type: "bearer",
    type: "invite"
  });
  return `/tests/e2e/fixtures/supabase-page.html#${callback}`;
}

async function routeManagerSession(page: Page): Promise<void> {
  await page.route("**/tests/e2e/fixtures/locales/es-ES.json", (route) => json(route, locale));
  await page.route("**/auth/v1/user", (route) => json(route, managerUser));
}

async function selectPreviewText(page: Page, selectedText: string): Promise<void> {
  const literal = page.getByTestId("author-preview-literal").filter({ hasText: selectedText });
  await expect(literal).toHaveCount(1);
  await literal.evaluate((node, text) => {
    const start = (node.textContent ?? "").indexOf(text);
    if (start < 0) throw new Error(`Preview text '${text}' was not found.`);
    const range = document.createRange();
    range.setStart(node.firstChild!, start);
    range.setEnd(node.firstChild!, start + text.length);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  }, selectedText);
  await page.getByTestId("author-convert-selection").click();
}

async function routePublishedPuzzles(route: Route): Promise<void> {
  const select = new URL(route.request().url()).searchParams.get("select");
  if (select === "definition") {
    const date = new URL(route.request().url()).searchParams.get("release_date")?.replace(/^eq\./u, "");
    const definition = date === puzzle.releaseDate ? puzzle : earlierPuzzle;
    return json(route, [{ definition }]);
  }
  return json(route, [puzzle, earlierPuzzle].map((definition) => ({
    release_date: definition.releaseDate,
    puzzle_id: definition.id,
    revision: definition.revision ?? 1
  })));
}

test("Pages root runs the standalone game", async ({ page }) => {
  await page.route("**/*.supabase.co/rest/v1/puzzles*", routePublishedPuzzles);
  await page.goto("http://127.0.0.1:4175/");

  await expect(page.getByTestId("puzzle")).toBeVisible();
  const configuredForSupabase = await page.locator("#nexo-supabase-config").count() === 1;
  await expect(page.getByTestId("date-selector")).toHaveValue(
    configuredForSupabase ? puzzle.releaseDate : earlierPuzzle.releaseDate
  );
  await expect(page.locator('script[src*="/loader.js"]')).toHaveCount(1);
  await expect(page.locator('script[src*="/assets/nexo-"]')).toHaveCount(1);
});

test("standalone author mode shows invite-only login before loading the editor", async ({ page }) => {
  await page.goto("/tests/e2e/fixtures/supabase-page.html?mode=author");

  await expect(page.getByRole("heading", { name: "Administrar Entre Paréntesis" })).toBeVisible();
  await expect(page.getByTestId("manager-email")).toHaveAttribute("type", "email");
  await expect(page.getByTestId("manager-sign-in")).toBeVisible();
  await expect(page.getByTestId("author-final-text")).toHaveCount(0);
});

test("a Supabase invitation callback opens authenticated author mode", async ({ page }) => {
  await routeManagerSession(page);
  await page.route("**/functions/v1/puzzle-admin", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as { action?: string };
    return body.action === "list"
      ? json(route, { puzzles: [], currentDate: "2026-09-10", timeZone: "Europe/Madrid" })
      : json(route, { code: "UNKNOWN_ACTION", message: "Unexpected action" }, 400);
  });
  await page.goto(authenticatedAuthorUrl());

  await expect(page.getByRole("heading", { name: "Crear Entre Paréntesis" })).toBeVisible();
  await expect(page.getByTestId("manager-sign-out")).toBeVisible();
  await expect.poll(() => {
    const currentUrl = new URL(page.url());
    return {
      mode: currentUrl.searchParams.get("mode"),
      hasAccessToken: currentUrl.hash.includes("access_token="),
      hasRefreshToken: currentUrl.hash.includes("refresh_token=")
    };
  }).toEqual({ mode: "author", hasAccessToken: false, hasRefreshToken: false });
});

test("an authenticated Supabase manager creates a puzzle", async ({ page }) => {
  await routeManagerSession(page);
  const requests: Array<{
    body: Record<string, unknown>;
    authorization: string | undefined;
    apikey: string | undefined;
  }> = [];
  await page.route("**/functions/v1/puzzle-admin", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    requests.push({
      body,
      authorization: route.request().headers().authorization,
      apikey: route.request().headers().apikey
    });
    if (body.action === "list") {
      return json(route, { puzzles: [], currentDate: "2026-09-10", timeZone: "Europe/Madrid" });
    }
    if (body.action === "save") return json(route, { date: "2026-09-11", revision: 1 }, 201);
    return json(route, { code: "UNKNOWN_ACTION", message: "Unexpected action" }, 400);
  });

  await page.goto(authenticatedAuthorUrl());
  await expect(page.getByRole("heading", { name: "Crear Entre Paréntesis" })).toBeVisible();
  await page.getByTestId("author-final-text").fill("La gata.");
  await selectPreviewText(page, "gata");
  await page.getByTestId("c01-literal-0").fill("animal doméstico");
  await page.getByTestId("author-puzzle-id").fill("gata-supabase-es");
  await page.locator("#author-title-input").fill("La gata");
  await page.locator("#author-release-date").fill("2026-09-11");
  await page.getByTestId("author-publish").click();

  await expect.poll(() => requests.filter(({ body }) => body.action === "save").length).toBe(1);
  const save = requests.find(({ body }) => body.action === "save")!;
  expect(save.authorization).toBe("Bearer session-token");
  expect(save.apikey).toBe("sb_publishable_test-key");
  expect(save.body.overwrite).toBe(false);
  expect(save.body.expectedRevision).toBeUndefined();
  expect((save.body.definition as Record<string, unknown>).releaseDate).toBe("2026-09-11");
  await expect(page.getByTestId("author-publish-status")).toContainText("2026-09-11");
});

test("a Supabase manager corrects, trashes, and restores a puzzle", async ({ page }) => {
  await routeManagerSession(page);
  page.on("dialog", (dialog) => dialog.accept());
  const requests: Array<Record<string, unknown>> = [];
  await page.route("**/functions/v1/puzzle-admin", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    requests.push(body);
    if (body.action === "list") {
      return json(route, {
        puzzles: [{
          release_date: puzzle.releaseDate,
          puzzle_id: puzzle.id,
          revision: puzzle.revision ?? 1
        }],
        currentDate: "2026-09-10",
        timeZone: "Europe/Madrid"
      });
    }
    if (body.action === "load") return json(route, { definition: puzzle });
    if (body.action === "save") return json(route, { date: puzzle.releaseDate, revision: (puzzle.revision ?? 1) + 1 });
    if (body.action === "trash") return json(route, { date: puzzle.releaseDate, status: "trash" });
    if (body.action === "restore") return json(route, { date: puzzle.releaseDate, status: "published" });
    return json(route, { code: "UNKNOWN_ACTION", message: "Unexpected action" }, 400);
  });

  await page.goto(authenticatedAuthorUrl());
  await page.getByTestId("author-existing-puzzle").selectOption("0");
  await page.getByTestId("author-load-existing").click();
  await page.locator("#author-title-input").fill(`${puzzle.title} corregido`);
  await page.getByTestId("author-publish").click();

  await expect.poll(() => requests.filter(({ action }) => action === "save").length).toBe(1);
  const save = requests.find(({ action }) => action === "save")!;
  expect(save.overwrite).toBe(true);
  expect(save.expectedRevision).toBe(puzzle.revision ?? 1);
  expect((save.definition as Record<string, unknown>).revision).toBe((puzzle.revision ?? 1) + 1);

  await page.getByTestId("author-delete-puzzle").click();
  await expect(page.getByTestId("author-undo-delete")).toBeVisible();
  await page.getByTestId("author-undo-delete").click();
  await expect(page.getByTestId("author-delete-puzzle")).toBeVisible();
  expect(requests.map(({ action }) => action)).toEqual(["list", "load", "save", "trash", "restore"]);
});

test("the blog embed is player-only and reads the Supabase catalog", async ({ page }) => {
  await page.route("**/*.supabase.co/rest/v1/puzzles*", routePublishedPuzzles);
  await page.goto(`${blogFixtureUrl}?mode=author`);

  await expect(page.getByTestId("puzzle")).toBeVisible();
  await expect(page.getByTestId("date-selector")).toHaveValue(puzzle.releaseDate);
  await expect(page.getByTestId("manager-email")).toHaveCount(0);
  await expect(page.getByTestId("author-final-text")).toHaveCount(0);
});

test("the bundle runs in the blog page without reloading its host", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.route("**/*.supabase.co/rest/v1/puzzles*", routePublishedPuzzles);
  await page.goto(blogFixtureUrl);

  await expect(page.getByTestId("puzzle")).toBeVisible();
  await expect(page.locator("iframe")).toHaveCount(0);
  await expect(page.locator('script[src^="http://127.0.0.1:4175/assets/nexo-"]')).toHaveCount(1);
  const desktopLayout = await page.evaluate(() => {
    const title = document.querySelector(".wp-block-post-title")!;
    const content = document.querySelector('[data-testid="blog-content-row"]')!;
    const mount = document.querySelector("#bracket-city-app")!;
    return {
      titleSize: parseFloat(getComputedStyle(title).fontSize),
      contentPadding: parseFloat(getComputedStyle(content).paddingTop),
      mountWidth: mount.getBoundingClientRect().width,
      containerWidth: mount.parentElement!.getBoundingClientRect().width,
      mountMaxWidth: getComputedStyle(mount).maxWidth
    };
  });
  expect(desktopLayout.titleSize).toBeLessThanOrEqual(36);
  expect(desktopLayout.contentPadding).toBeLessThanOrEqual(20);
  expect(desktopLayout.mountWidth).toBeCloseTo(desktopLayout.containerWidth, 1);
  expect(desktopLayout.mountMaxWidth).toBe("none");

  await page.evaluate(() => { window.__nexoHostPageSentinel = true; });
  await Promise.all([
    page.waitForURL(new RegExp(`\\?date=${earlierPuzzle.releaseDate}$`, "u")),
    page.getByTestId("date-selector").selectOption(earlierPuzzle.releaseDate)
  ]);
  expect(await page.evaluate(() => window.__nexoHostPageSentinel === true)).toBe(true);
  await expect(page.getByTestId("puzzle")).toContainText("Piso en LATAM");

  await page.getByTestId("instructions-start").click();
  await page.getByTestId("guess-input").fill("a");
  const storage = await page.evaluate(() => ({ origin: location.origin, keys: Object.keys(localStorage) }));
  expect(storage.origin).toBe("http://127.0.0.1:4174");
  expect(storage.keys.some((key) => key.startsWith("nested-clue:v4:"))).toBe(true);
});

test("the blog embed stays compact on a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.route("**/*.supabase.co/rest/v1/puzzles*", routePublishedPuzzles);
  await page.goto(blogFixtureUrl);
  await expect(page.getByTestId("puzzle")).toBeVisible();

  const layout = await page.evaluate(() => {
    const title = document.querySelector(".wp-block-post-title")!;
    const content = document.querySelector('[data-testid="blog-content-row"]')!;
    const game = document.querySelector(".game-shell")!;
    return {
      titleSize: parseFloat(getComputedStyle(title).fontSize),
      contentPadding: parseFloat(getComputedStyle(content).paddingTop),
      contentGap: parseFloat(getComputedStyle(content).gap),
      titleBottom: title.getBoundingClientRect().bottom,
      gameTop: game.getBoundingClientRect().top,
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth
    };
  });
  expect(layout.titleSize).toBeLessThanOrEqual(28);
  expect(layout.contentPadding).toBeLessThanOrEqual(8);
  expect(layout.contentGap).toBe(0);
  expect(layout.gameTop - layout.titleBottom).toBeLessThanOrEqual(32);
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
});
