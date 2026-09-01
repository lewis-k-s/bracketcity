import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const fixtureUrl = "/tests/e2e/fixtures/wordpress-page.html";
const puzzle = JSON.parse(await readFile(resolve(import.meta.dirname, "../../puzzles/2026-08-31-es.json"), "utf8"));

function json(route, body, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body)
  });
}

async function selectPreviewText(page, selectedText) {
  const literal = page.getByTestId("author-preview-literal").filter({ hasText: selectedText });
  await expect(literal).toHaveCount(1);
  await literal.evaluate((node, text) => {
    const start = node.textContent.indexOf(text);
    const range = document.createRange();
    range.setStart(node.firstChild, start);
    range.setEnd(node.firstChild, start + text.length);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  }, selectedText);
  await page.getByTestId("author-convert-selection").click();
}

test("classic Pages bundle runs on the WordPress origin and keeps progress there", async ({ page }) => {
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
  await expect(page.getByTestId("date-selector")).toHaveValue(puzzle.releaseDate);
  await expect(page.locator("iframe")).toHaveCount(0);
  await expect(page.locator('script[src^="http://127.0.0.1:4175/assets/nexo-"]')).toHaveCount(1);
  const backgrounds = await page.evaluate(() => ({
    mount: getComputedStyle(document.querySelector("#bracket-city-app")).backgroundColor,
    shell: getComputedStyle(document.querySelector(".game-shell")).backgroundColor
  }));
  expect(backgrounds.mount).toBe("rgba(0, 0, 0, 0)");
  expect(backgrounds.shell).toBe("rgb(255, 255, 255)");
  const desktopTitleLayout = await page.evaluate(() => {
    const title = document.querySelector(".wp-block-post-title");
    const spacer = document.querySelector(".wp-block-spacer");
    const content = document.querySelector('[data-testid="wordpress-content-row"]');
    return {
      titleSize: parseFloat(getComputedStyle(title).fontSize),
      spacerHeight: parseFloat(getComputedStyle(spacer).height),
      contentPadding: parseFloat(getComputedStyle(content).paddingTop),
      titleBottom: title.getBoundingClientRect().bottom,
      contentTop: content.getBoundingClientRect().top
    };
  });
  expect(desktopTitleLayout.titleSize).toBeLessThanOrEqual(36);
  expect(desktopTitleLayout.spacerHeight).toBeLessThanOrEqual(8);
  expect(desktopTitleLayout.contentPadding).toBeLessThanOrEqual(20);
  expect(desktopTitleLayout.contentTop - desktopTitleLayout.titleBottom).toBeLessThanOrEqual(20);

  await page.setViewportSize({ width: 375, height: 812 });
  const mobileTitleLayout = await page.evaluate(() => {
    const title = document.querySelector(".wp-block-post-title");
    const content = document.querySelector('[data-testid="wordpress-content-row"]');
    return {
      titleSize: parseFloat(getComputedStyle(title).fontSize),
      contentPadding: parseFloat(getComputedStyle(content).paddingTop),
      titleBottom: title.getBoundingClientRect().bottom,
      contentTop: content.getBoundingClientRect().top
    };
  });
  expect(mobileTitleLayout.titleSize).toBeLessThanOrEqual(28);
  expect(mobileTitleLayout.contentPadding).toBeLessThanOrEqual(8);
  expect(mobileTitleLayout.contentTop - mobileTitleLayout.titleBottom).toBeLessThanOrEqual(8);

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

test("WordPress author publication sends the page nonce", async ({ page }) => {
  let publishedRequest = null;
  await page.route("**/wp-json/bracket-city/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === "GET" && path.endsWith("/admin/puzzles")) {
      return json(route, { currentDate: "2026-09-01", timeZone: "Europe/Madrid", puzzles: [] });
    }
    if (request.method() === "POST" && path.endsWith("/puzzles")) {
      publishedRequest = {
        nonce: request.headers()["x-wp-nonce"],
        body: request.postDataJSON()
      };
      return json(route, { date: publishedRequest.body.releaseDate }, 201);
    }
    return json(route, { message: "Not found" }, 404);
  });

  await page.goto(`${fixtureUrl}?mode=author`);
  await expect(page.getByTestId("author-final-text")).toBeVisible();
  await page.getByTestId("author-final-text").fill("La gata.");
  await page.getByRole("button", { name: "Aplicar texto final", exact: true }).click();
  await selectPreviewText(page, "gata");
  await page.getByTestId("c01-literal-0").fill("animal doméstico");
  await page.getByTestId("clue-inspector").getByRole("button", { name: "Guardar texto", exact: true }).click();
  await page.getByTestId("author-puzzle-id").fill("gata-pages-es");
  await page.locator("#author-title-input").fill("La gata");
  await page.locator("#author-release-date").fill("2026-09-01");
  await page.getByTestId("author-publish").click();

  await expect.poll(() => publishedRequest).not.toBeNull();
  expect(publishedRequest.nonce).toBe("rest-nonce");
  expect(publishedRequest.body.id).toBe("gata-pages-es");
  await expect(page.getByTestId("author-publish-status")).toContainText("2026-09-01");
});
