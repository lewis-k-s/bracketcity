import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";

const fixtureUrl = "/tests/e2e/fixtures/wordpress-page.html";
const puzzle = JSON.parse(await readFile(resolve(import.meta.dirname, "../../puzzles/2026-08-31-es.json"), "utf8"));
const earlierPuzzle = JSON.parse(await readFile(resolve(import.meta.dirname, "../../puzzles/2026-08-30-es.json"), "utf8"));

function json(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body)
  });
}

async function selectPreviewText(page: Page, selectedText: string): Promise<void> {
  const literal = page.getByTestId("author-preview-literal").filter({ hasText: selectedText });
  await expect(literal).toHaveCount(1);
  await literal.evaluate((node, text) => {
    const start = (node.textContent ?? "").indexOf(text);
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

test("classic Pages bundle runs on the WordPress origin and keeps progress there", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.route("**/wp-json/bracket-city/v1/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/puzzles")) {
      return json(route, {
        currentDate: "2026-09-01",
        timeZone: "Europe/Madrid",
        puzzles: [{ date: puzzle.releaseDate, id: puzzle.id, revision: puzzle.revision }]
      });
    }
    if (path.endsWith(`/puzzles/${puzzle.releaseDate}`)) return json(route, puzzle);
    return json(route, { message: "Not found" }, 404);
  });

  await page.goto(fixtureUrl);
  await expect(page.getByTestId("puzzle")).toBeVisible();
  expect(await page.evaluate(() => performance.getEntriesByType("resource")
    .map((entry) => entry.name)
    .filter((name) => name.includes("/assets/author-view-")))).toEqual([]);
  await expect(page.getByTestId("date-selector")).toHaveValue(puzzle.releaseDate);
  await expect(page.locator("iframe")).toHaveCount(0);
  await expect(page.locator('script[src^="http://127.0.0.1:4175/assets/nexo-"]')).toHaveCount(1);
  const backgrounds = await page.evaluate(() => ({
    mount: getComputedStyle(document.querySelector("#bracket-city-app")!).backgroundColor,
    shell: getComputedStyle(document.querySelector(".game-shell")!).backgroundColor
  }));
  expect(backgrounds.mount).toBe("rgba(0, 0, 0, 0)");
  expect(backgrounds.shell).toBe("rgb(255, 255, 255)");
  const mountLayout = await page.evaluate(() => {
    const mount = document.querySelector("#bracket-city-app")!;
    const container = mount.parentElement!;
    return {
      mountWidth: mount.getBoundingClientRect().width,
      containerWidth: container.getBoundingClientRect().width,
      maxWidth: getComputedStyle(mount).maxWidth,
      marginLeft: getComputedStyle(mount).marginLeft,
      marginRight: getComputedStyle(mount).marginRight
    };
  });
  expect(mountLayout.mountWidth).toBeCloseTo(mountLayout.containerWidth, 1);
  expect(mountLayout.maxWidth).toBe("none");
  expect(mountLayout.marginLeft).toBe("0px");
  expect(mountLayout.marginRight).toBe("0px");
  const desktopTitleLayout = await page.evaluate(() => {
    const title = document.querySelector(".wp-block-post-title")!;
    const spacer = document.querySelector(".wp-block-spacer")!;
    const content = document.querySelector('[data-testid="wordpress-content-row"]')!;
    return {
      titleSize: parseFloat(getComputedStyle(title).fontSize),
      spacerHeight: parseFloat(getComputedStyle(spacer).height),
      contentPadding: parseFloat(getComputedStyle(content).paddingTop),
      titleBottom: title.getBoundingClientRect().bottom,
      contentTop: content.getBoundingClientRect().top,
      gameTop: document.querySelector(".game-shell")!.getBoundingClientRect().top
    };
  });
  expect(desktopTitleLayout.titleSize).toBeLessThanOrEqual(36);
  expect(desktopTitleLayout.spacerHeight).toBeLessThanOrEqual(8);
  expect(desktopTitleLayout.contentPadding).toBeLessThanOrEqual(20);
  expect(desktopTitleLayout.contentTop - desktopTitleLayout.titleBottom).toBeLessThanOrEqual(20);
  expect(desktopTitleLayout.gameTop - desktopTitleLayout.titleBottom).toBeLessThanOrEqual(20);

  await page.setViewportSize({ width: 375, height: 812 });
  const mobileTitleLayout = await page.evaluate(() => {
    const title = document.querySelector(".wp-block-post-title")!;
    const content = document.querySelector('[data-testid="wordpress-content-row"]')!;
    return {
      titleSize: parseFloat(getComputedStyle(title).fontSize),
      contentPadding: parseFloat(getComputedStyle(content).paddingTop),
      contentGap: parseFloat(getComputedStyle(content).gap),
      titleBottom: title.getBoundingClientRect().bottom,
      contentTop: content.getBoundingClientRect().top,
      gameTop: document.querySelector(".game-shell")!.getBoundingClientRect().top
    };
  });
  expect(mobileTitleLayout.titleSize).toBeLessThanOrEqual(28);
  expect(mobileTitleLayout.contentPadding).toBeLessThanOrEqual(8);
  expect(mobileTitleLayout.contentGap).toBe(0);
  expect(mobileTitleLayout.contentTop - mobileTitleLayout.titleBottom).toBeLessThanOrEqual(24);
  expect(mobileTitleLayout.gameTop - mobileTitleLayout.titleBottom).toBeLessThanOrEqual(32);

  const input = page.getByTestId("guess-input");
  const keyboard = page.getByRole("group", { name: "Teclado español" });
  if (await keyboard.isVisible()) await page.getByRole("button", { name: "a", exact: true }).click();
  else await input.fill("a");

  const storage = await page.evaluate(() => ({
    origin: location.origin,
    keys: Object.keys(localStorage)
  }));
  expect(storage.origin).toBe("http://127.0.0.1:4174");
  expect(storage.keys.some((key) => key.startsWith("nested-clue:v3:"))).toBe(true);
});

test("WordPress puzzle dates load through REST without reloading the host page", async ({ page }) => {
  await page.route("**/wp-json/bracket-city/v1/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/puzzles")) {
      return json(route, {
        currentDate: "2026-09-01",
        timeZone: "Europe/Madrid",
        puzzles: [puzzle, earlierPuzzle].map((definition) => ({
          date: definition.releaseDate,
          id: definition.id,
          revision: definition.revision
        }))
      });
    }
    if (path.endsWith(`/puzzles/${puzzle.releaseDate}`)) return json(route, puzzle);
    if (path.endsWith(`/puzzles/${earlierPuzzle.releaseDate}`)) return json(route, earlierPuzzle);
    return json(route, { message: "Not found" }, 404);
  });

  await page.goto(fixtureUrl);
  await expect(page.getByTestId("date-selector")).toHaveValue(puzzle.releaseDate);
  await page.evaluate(() => { window.__nexoHostPageSentinel = true; });

  await Promise.all([
    page.waitForURL(new RegExp(`\\?date=${earlierPuzzle.releaseDate}$`, "u")),
    page.getByTestId("date-selector").selectOption(earlierPuzzle.releaseDate)
  ]);

  expect(await page.evaluate(() => window.__nexoHostPageSentinel === true)).toBe(true);
  await expect(page.getByTestId("date-selector")).toHaveValue(earlierPuzzle.releaseDate);
  await expect(page.getByTestId("puzzle")).toContainText("Piso en LATAM");

  await page.evaluate(() => history.back());
  await expect(page.getByTestId("date-selector")).toHaveValue(puzzle.releaseDate);
  await expect(page.getByTestId("puzzle")).toContainText("Lewis se ent");
  await expect(page.getByTestId("puzzle")).not.toContainText("Piso en LATAM");
  expect(await page.evaluate(() => window.__nexoHostPageSentinel === true)).toBe(true);
});

test("WordPress author adapts to a narrow desktop content column", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.route("**/wp-json/bracket-city/v1/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/admin/puzzles")) {
      return json(route, { currentDate: "2026-09-01", timeZone: "Europe/Madrid", puzzles: [] });
    }
    if (path.endsWith("/admin/suggestions")) return json(route, { suggestions: [] });
    return json(route, { message: "Not found" }, 404);
  });

  await page.goto(`${fixtureUrl}?mode=author`);
  await page.getByTestId("author-final-text").fill("La gata.");
  await selectPreviewText(page, "gata");
  await expect(page.getByTestId("clue-inspector")).toBeVisible();

  const layout = await page.evaluate(() => {
    const content = document.querySelector('[data-testid="wordpress-content-row"]')!;
    const hostColumn = document.querySelector("#bracket-city-app")!.parentElement!;
    const shell = document.querySelector(".author-shell")!;
    const authorLayout = document.querySelector(".author-layout")!;
    const editor = document.querySelector(".author-editor")!;
    const utilities = document.querySelector(".author-utilities")!;
    const workspace = document.querySelector(".author-guided-workspace")!;
    const tracks = (element: Element) => getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/u);
    return {
      contentWidth: content.getBoundingClientRect().width,
      hostColumnWidth: hostColumn.getBoundingClientRect().width,
      shellWidth: shell.getBoundingClientRect().width,
      authorTracks: tracks(authorLayout),
      workspaceTracks: tracks(workspace),
      editor: editor.getBoundingClientRect().toJSON(),
      utilities: utilities.getBoundingClientRect().toJSON(),
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth
    };
  });

  expect(layout.contentWidth).toBeCloseTo(1280, 1);
  expect(layout.hostColumnWidth).toBeCloseTo(768, 1);
  expect(layout.shellWidth).toBeCloseTo(768, 1);
  expect(layout.authorTracks).toHaveLength(1);
  expect(layout.workspaceTracks).toHaveLength(1);
  expect(layout.utilities.x).toBeCloseTo(layout.editor.x, 1);
  expect(layout.utilities.y).toBeGreaterThanOrEqual(layout.editor.y + layout.editor.height - 1);
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
});

test("WordPress author publication sends the page nonce", async ({ page }) => {
  let publishedRequest: { nonce: string | undefined; body: Record<string, unknown> } | null = null;
  await page.route("**/wp-json/bracket-city/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === "GET" && path.endsWith("/admin/puzzles")) {
      return json(route, { currentDate: "2026-09-01", timeZone: "Europe/Madrid", puzzles: [] });
    }
    if (request.method() === "GET" && path.endsWith("/admin/suggestions")) {
      return json(route, { suggestions: [] });
    }
    if (request.method() === "POST" && path.endsWith("/puzzles")) {
      publishedRequest = {
        nonce: request.headers()["x-wp-nonce"],
        body: request.postDataJSON() as Record<string, unknown>
      };
      return json(route, { date: publishedRequest.body.releaseDate }, 201);
    }
    return json(route, { message: "Not found" }, 404);
  });

  await page.goto(`${fixtureUrl}?mode=author`);
  await expect(page.getByTestId("author-final-text")).toBeVisible();
  expect(await page.evaluate(() => performance.getEntriesByType("resource")
    .some((entry) => entry.name.includes("/assets/author-view-")))).toBe(true);
  await expect(page.getByTestId("suggestion-page-link")).toHaveAttribute("href", /mode=suggest/u);
  await expect(page.getByTestId("suggestion-page-link")).toHaveText("Abrir");
  await expect(page.getByTestId("suggestion-page-link")).not.toHaveAttribute("target", "_blank");
  await expect(page.getByTestId("suggestion-copy-link")).toBeVisible();
  await page.getByTestId("suggestion-info-open").click();
  await expect(page.getByRole("dialog", { name: "Modo de propuestas" })).toContainText("sin iniciar sesión en WordPress");
  await page.getByTestId("suggestion-info-close").click();
  await page.getByTestId("author-final-text").fill("La gata.");
  await selectPreviewText(page, "gata");
  await page.getByTestId("c01-literal-0").fill("animal doméstico");
  await page.getByTestId("author-puzzle-id").fill("gata-pages-es");
  await page.locator("#author-title-input").fill("La gata");
  await page.locator("#author-release-date").fill("2026-09-01");
  await page.getByTestId("author-publish").click();

  await expect.poll(() => publishedRequest).not.toBeNull();
  expect(publishedRequest!.nonce).toBe("rest-nonce");
  expect(publishedRequest!.body.id).toBe("gata-pages-es");
  await expect(page.getByTestId("author-publish-status")).toContainText("2026-09-01");
});

test("shared suggestion link submits an undated pending puzzle", async ({ page }) => {
  let submittedRequest: { key: string | undefined; body: Record<string, unknown> } | null = null;
  await page.route("**/wp-json/bracket-city/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === "POST" && path.endsWith("/suggestions")) {
      submittedRequest = {
        key: request.headers()["x-nexo-suggestion-key"],
        body: request.postDataJSON() as Record<string, unknown>
      };
      return json(route, { suggestionId: 17, status: "pending" }, 201);
    }
    return json(route, { message: "Not found" }, 404);
  });

  await page.goto(`${fixtureUrl}?mode=suggest&suggestion_key=fixture-suggestion-key`);
  await expect(page.getByRole("heading", { name: "Proponer un Nexo" })).toBeVisible();
  expect(await page.evaluate(() => performance.getEntriesByType("resource")
    .some((entry) => entry.name.includes("/assets/author-view-")))).toBe(true);
  await page.getByTestId("author-final-text").fill("La gata.");
  await selectPreviewText(page, "gata");
  await page.getByTestId("c01-literal-0").fill("animal doméstico");
  await page.locator("#author-title-input").fill("La gata sugerida");
  await page.getByTestId("suggestion-submit").click();

  await expect.poll(() => submittedRequest).not.toBeNull();
  expect(submittedRequest!.key).toBe("fixture-suggestion-key");
  expect(submittedRequest!.body.id).toMatch(/^sugerencia-[a-z0-9]+$/u);
  expect(submittedRequest!.body.releaseDate).toBeUndefined();
  await expect(page.getByTestId("suggestion-submit-status")).toContainText("#17");
});

test("WordPress author review approves a pending suggestion in place", async ({ page }) => {
  const suggestion = structuredClone(puzzle);
  delete suggestion.releaseDate;
  suggestion.revision = 1;
  let approvedRequest: { nonce: string | undefined; body: Record<string, unknown> } | null = null;
  page.on("dialog", (dialog) => dialog.accept());
  await page.route("**/wp-json/bracket-city/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === "GET" && path.endsWith("/admin/puzzles")) {
      return json(route, { currentDate: "2026-09-01", timeZone: "Europe/Madrid", puzzles: [] });
    }
    if (request.method() === "GET" && path.endsWith("/admin/suggestions")) {
      return json(route, { suggestions: [{
        suggestionId: 17,
        id: suggestion.id,
        title: suggestion.title,
        submittedAt: "2026-09-02T08:00:00Z"
      }] });
    }
    if (request.method() === "GET" && path.endsWith("/admin/suggestions/17")) return json(route, suggestion);
    if (request.method() === "POST" && path.endsWith("/admin/suggestions/17/approve")) {
      approvedRequest = {
        nonce: request.headers()["x-wp-nonce"],
        body: request.postDataJSON() as Record<string, unknown>
      };
      return json(route, { date: approvedRequest.body.releaseDate, revision: 1 });
    }
    return json(route, { message: "Not found" }, 404);
  });

  await page.goto(`${fixtureUrl}?mode=author`);
  await page.getByTestId("author-existing-suggestion").selectOption("0");
  await page.getByTestId("suggestion-load").click();
  await page.locator("#author-release-date").fill("2026-09-04");
  await page.getByTestId("author-publish").click();

  await expect.poll(() => approvedRequest).not.toBeNull();
  expect(approvedRequest!.nonce).toBe("rest-nonce");
  expect(approvedRequest!.body.releaseDate).toBe("2026-09-04");
  expect(approvedRequest!.body.revision).toBe(1);
  await expect(page.getByTestId("suggestion-review")).toHaveCount(0);
});

test("WordPress correction increments its hidden revision and publishes without a second confirmation", async ({ page }) => {
  let correctionRequest: { method: string; body: Record<string, unknown> } | null = null;
  let dialogCount = 0;
  page.on("dialog", async (dialog) => {
    dialogCount += 1;
    await dialog.accept();
  });
  await page.route("**/wp-json/bracket-city/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === "GET" && path.endsWith("/admin/puzzles")) {
      return json(route, {
        currentDate: "2026-09-01",
        timeZone: "Europe/Madrid",
        puzzles: [{ date: puzzle.releaseDate, id: puzzle.id, revision: puzzle.revision }]
      });
    }
    if (request.method() === "GET" && path.endsWith("/admin/suggestions")) {
      return json(route, { suggestions: [] });
    }
    if (request.method() === "GET" && path.endsWith(`/admin/puzzles/${puzzle.releaseDate}`)) {
      return json(route, puzzle);
    }
    if (request.method() === "PUT" && path.endsWith(`/puzzles/${puzzle.releaseDate}`)) {
      correctionRequest = { method: request.method(), body: request.postDataJSON() as Record<string, unknown> };
      return json(route, { date: puzzle.releaseDate });
    }
    return json(route, { message: "Not found" }, 404);
  });

  await page.goto(`${fixtureUrl}?mode=author`);
  await page.getByTestId("author-existing-puzzle").selectOption("0");
  await page.getByTestId("author-load-existing").click();
  await expect(page.locator("#author-revision")).toHaveCount(0);
  await page.locator("#author-title-input").fill(`${puzzle.title} corregido`);
  await page.getByTestId("author-publish").click();

  await expect.poll(() => correctionRequest).not.toBeNull();
  expect(correctionRequest!.method).toBe("PUT");
  expect(correctionRequest!.body.revision).toBe((puzzle.revision ?? 1) + 1);
  expect(dialogCount).toBe(1);
});

test("a loaded WordPress puzzle moves to Trash and can be restored", async ({ page }) => {
  const writeRequests: Array<{ method: string; path: string; nonce: string | undefined }> = [];
  page.on("dialog", (dialog) => dialog.accept());
  await page.route("**/wp-json/bracket-city/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === "GET" && path.endsWith("/admin/puzzles")) {
      return json(route, {
        currentDate: "2026-09-01",
        timeZone: "Europe/Madrid",
        puzzles: [{ date: puzzle.releaseDate, id: puzzle.id, revision: puzzle.revision }]
      });
    }
    if (request.method() === "GET" && path.endsWith("/admin/suggestions")) {
      return json(route, { suggestions: [] });
    }
    if (request.method() === "GET" && path.endsWith(`/admin/puzzles/${puzzle.releaseDate}`)) {
      return json(route, puzzle);
    }
    if (request.method() === "DELETE" && path.endsWith(`/puzzles/${puzzle.releaseDate}`)) {
      writeRequests.push({ method: request.method(), path, nonce: request.headers()["x-wp-nonce"] });
      return json(route, { date: puzzle.releaseDate, status: "trashed" });
    }
    if (request.method() === "POST" && path.endsWith(`/admin/puzzles/trash/${puzzle.releaseDate}`)) {
      writeRequests.push({ method: request.method(), path, nonce: request.headers()["x-wp-nonce"] });
      return json(route, { date: puzzle.releaseDate, status: "restored" });
    }
    return json(route, { message: "Not found" }, 404);
  });

  await page.goto(`${fixtureUrl}?mode=author`);
  await page.getByTestId("author-existing-puzzle").selectOption("0");
  await page.getByTestId("author-load-existing").click();
  await page.getByTestId("author-delete-puzzle").click();

  await expect(page.getByTestId("author-undo-delete")).toBeVisible();
  await expect(page.getByTestId("author-delete-puzzle")).toHaveCount(0);
  await page.getByTestId("author-undo-delete").click();
  await expect(page.getByTestId("author-delete-puzzle")).toBeVisible();
  await expect(page.getByTestId("author-puzzle-id")).toHaveValue(puzzle.id);
  expect(writeRequests).toEqual([
    { method: "DELETE", path: `/wp-json/bracket-city/v1/puzzles/${puzzle.releaseDate}`, nonce: "rest-nonce" },
    { method: "POST", path: `/wp-json/bracket-city/v1/admin/puzzles/trash/${puzzle.releaseDate}`, nonce: "rest-nonce" }
  ]);
});
