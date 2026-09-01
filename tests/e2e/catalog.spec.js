import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function openFresh(page, path = "/") {
  await page.goto(path);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
}

async function submitWithVirtualKeyboard(page, answer) {
  const input = page.getByTestId("guess-input");
  await expect(input).toHaveValue("");
  const keyboard = page.getByRole("group", { name: "Teclado español" });
  if (!(await keyboard.isVisible())) {
    await input.fill(answer);
    await input.press("Enter");
    return;
  }
  for (const character of answer.toLocaleLowerCase("es-ES")) {
    const accessibleName = character === " " ? "Espacio" : character;
    await page.getByRole("button", { name: accessibleName, exact: true }).click();
  }
  await page.getByRole("button", { name: "Enviar", exact: true }).click();
}

function seriousOrCritical(results) {
  return results.violations.filter((violation) => ["serious", "critical"].includes(violation.impact));
}

test("the catalog default selects 30 August and loads today's safe puzzle content", async ({ page }) => {
  await openFresh(page);

  await expect(page.getByTestId("date-selector")).toHaveValue("2026-08-30");
  await expect(page.locator("#puzzle-title")).toHaveCount(0);
  await expect(page.getByTestId("puzzle")).toContainText("Piso en LATAM");
  await expect(page.getByTestId("puzzle")).toContainText("un extremo de algo");
  await expect(page.getByTestId("puzzle")).toContainText("Peli de Kurosawa basada en King Lear");
});

test("an explicit historical date selects the demo puzzle", async ({ page }) => {
  await openFresh(page, "/?date=2026-08-28");

  await expect(page.getByTestId("date-selector")).toHaveValue("2026-08-28");
  await expect(page.locator("#puzzle-title")).toHaveCount(0);
  await expect(page.getByTestId("puzzle")).toContainText("prefijo griego que indica distancia");
});

test("31 August completes all nested branches as one confirmed sentence", async ({ page }) => {
  await openFresh(page, "/?date=2026-08-31");

  await expect(page.getByTestId("date-selector")).toHaveValue("2026-08-31");
  await expect(page.locator("#puzzle-title")).toHaveCount(0);
  await expect(page.locator(".instruction, .source-note")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("Un solo huevo");
  await expect(page).toHaveTitle("Nexo — Pistas anidadas");
  for (const answer of ["ando", "tés", "vez", "era", "ida", "Sol"]) {
    await submitWithVirtualKeyboard(page, answer);
  }
  await expect(page.locator('[data-clue-state="available"]').filter({ hasText: "algo que imita la vida" })).toHaveText(
    "algo que imita la vida"
  );
  await submitWithVirtualKeyboard(page, "arte");

  await expect(page.getByTestId("completion")).toContainText(
    "Lewis se entera de la sartén para un solo huevo."
  );
  await expect(page.locator("body")).not.toContainText("simulación");
  await expect(page.getByTestId("puzzle")).toBeHidden();
  await expect(page.getByTestId("date-selector")).toBeVisible();
  await expect(page.getByTestId("date-selector")).toHaveValue("2026-08-31");

  await Promise.all([
    page.waitForURL(/\?date=2026-08-28$/u),
    page.getByTestId("date-selector").selectOption("2026-08-28")
  ]);
  await expect(page.getByTestId("completion")).toBeHidden();
  await expect(page.getByTestId("puzzle")).toBeVisible();
  await expect(page.getByTestId("date-selector")).toHaveValue("2026-08-28");
});

test("an unknown date shows a fatal alert without a play composer", async ({ page }) => {
  await openFresh(page, "/?date=2026-08-29");

  await expect(page.getByRole("alert")).toContainText("UNKNOWN_PUZZLE_DATE");
  await expect(page.getByTestId("guess-input")).toHaveCount(0);
  await expect(page.getByTestId("date-selector")).toHaveCount(0);
});

test("duplicate date values fail closed", async ({ page }) => {
  await openFresh(page, "/?date=2026-08-30&date=2026-08-28");

  await expect(page.getByRole("alert")).toContainText("DUPLICATE_PUZZLE_DATE");
  await expect(page.getByTestId("guess-input")).toHaveCount(0);
});

test("lado unlocks the outer tras lado bracket, whose answer is viaje", async ({ page }) => {
  await openFresh(page);
  await submitWithVirtualKeyboard(page, "lado");

  await expect(page.locator('[data-clue-state="available"]').filter({ hasText: "tras lado" })).toHaveText("tras lado");
  await submitWithVirtualKeyboard(page, "viaje");
  await expect(page.locator('[data-clue-state="solved"]').filter({ hasText: "viaje" })).toHaveText("viaje");
});

test("changing the native date selector navigates to the selected puzzle", async ({ page }) => {
  await openFresh(page);

  await Promise.all([
    page.waitForURL(/\?date=2026-08-28$/u),
    page.getByTestId("date-selector").selectOption("2026-08-28")
  ]);

  await expect(page.getByTestId("date-selector")).toHaveValue("2026-08-28");
  await expect(page.locator("#puzzle-title")).toHaveCount(0);
});

test("the date selector does not overflow a 320-pixel viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await openFresh(page);
  await expect(page.getByTestId("date-selector")).toBeVisible();

  const dimensions = await page.evaluate(() => {
    const selector = document.querySelector('[data-testid="date-selector"]');
    const bounds = selector.getBoundingClientRect();
    return {
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      selectorLeft: bounds.left,
      selectorRight: bounds.right
    };
  });
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  expect(dimensions.selectorLeft).toBeGreaterThanOrEqual(0);
  expect(dimensions.selectorRight).toBeLessThanOrEqual(dimensions.clientWidth);
});

test("mobile clue highlights stay compact within each puzzle line", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await openFresh(page, "/?date=2026-08-31");
  await expect(page.locator(".clue-button").first()).toBeVisible();

  const metrics = await page.evaluate(() => {
    const puzzleStyle = getComputedStyle(document.querySelector("[data-testid=puzzle]"));
    const clueStyle = getComputedStyle(document.querySelector(".clue-button"));
    return {
      puzzleLineHeight: Number.parseFloat(puzzleStyle.lineHeight),
      clueLineHeight: Number.parseFloat(clueStyle.lineHeight),
      paddingBlock: Number.parseFloat(clueStyle.paddingTop) + Number.parseFloat(clueStyle.paddingBottom),
      paddingInline: Number.parseFloat(clueStyle.paddingLeft) + Number.parseFloat(clueStyle.paddingRight),
      puzzleBottom: document.querySelector("[data-testid=puzzle]").getBoundingClientRect().bottom,
      composerTop: document.querySelector(".composer").getBoundingClientRect().top
    };
  });

  expect(metrics.clueLineHeight + metrics.paddingBlock).toBeLessThan(metrics.puzzleLineHeight);
  expect(metrics.paddingInline).toBeLessThanOrEqual(2);
  expect(metrics.puzzleBottom).toBeLessThanOrEqual(metrics.composerTop);
});

test("mobile game fills the viewport and inline clues wrap with surrounding text", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await openFresh(page, "/?date=2026-08-31");
  await page.locator("#app").evaluate((mount) => {
    mount.style.width = "16rem";
    mount.style.marginLeft = "2.5rem";
    window.dispatchEvent(new Event("resize"));
  });

  const metrics = await page.evaluate(() => {
    const shell = document.querySelector(".game-shell");
    const shellRect = shell.getBoundingClientRect();
    const shellStyle = getComputedStyle(shell);
    const probe = document.createElement("p");
    probe.className = "puzzle-text";
    probe.style.width = "11rem";
    const prefix = document.createTextNode("foo ");
    const clue = document.createElement("span");
    clue.className = "clue clue-button";
    clue.setAttribute("role", "button");
    clue.textContent = "bar baz quux corge";
    probe.append(prefix, clue);
    shell.append(probe);
    const prefixRange = document.createRange();
    prefixRange.selectNodeContents(prefix);
    const prefixRect = prefixRange.getBoundingClientRect();
    const clueRects = [...clue.getClientRects()];
    probe.remove();
    return {
      viewportWidth: document.documentElement.clientWidth,
      shellLeft: shellRect.left,
      shellWidth: shellRect.width,
      shellPaddingLeft: Number.parseFloat(shellStyle.paddingLeft),
      shellPaddingRight: Number.parseFloat(shellStyle.paddingRight),
      clueLineCount: clueRects.length,
      prefixTop: prefixRect.top,
      clueFirstTop: clueRects[0]?.top
    };
  });

  expect(metrics.shellLeft).toBeCloseTo(0, 0);
  expect(metrics.shellWidth).toBeCloseTo(metrics.viewportWidth, 0);
  expect(metrics.shellPaddingLeft).toBeLessThanOrEqual(8);
  expect(metrics.shellPaddingRight).toBeLessThanOrEqual(8);
  expect(metrics.clueLineCount).toBeGreaterThan(1);
  expect(Math.abs(metrics.clueFirstTop - metrics.prefixTop)).toBeLessThan(2);
});

test("the default catalog state has no serious or critical accessibility violations", async ({ page }) => {
  await openFresh(page);
  const results = await new AxeBuilder({ page }).analyze();
  expect(seriousOrCritical(results)).toEqual([]);
});

test("the unknown-date error has no serious or critical accessibility violations", async ({ page }) => {
  await openFresh(page, "/?date=2026-08-29");
  const results = await new AxeBuilder({ page }).analyze();
  expect(seriousOrCritical(results)).toEqual([]);
});
