import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function freshPage(page: Page): Promise<void> {
  await page.goto("/?date=2026-08-28");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId("guess-input")).toBeVisible();
}

async function enterWithVirtualKeyboard(page: Page, answer: string): Promise<void> {
  const input = page.getByTestId("guess-input");
  await expect(input).toHaveValue("");
  const keyboard = page.getByRole("group", { name: "Teclado español" });
  if (!(await keyboard.isVisible())) {
    await input.fill(answer);
    return;
  }
  for (const character of answer.toLocaleLowerCase("es-ES")) {
    const accessibleName = character === " " ? "Espacio" : character;
    await page.getByRole("button", { name: accessibleName, exact: true }).click();
  }
}

async function submit(page: Page, answer: string): Promise<void> {
  await enterWithVirtualKeyboard(page, answer);
  await page.getByRole("button", { name: "Enviar", exact: true }).click();
}

const canonicalLeafAnswer = "tele";

function canonicalLeaf(page: Page): Locator {
  return page.locator('[data-clue-state="available"]').first();
}

async function expectAnswerAbsentFromRenderedClue(page: Page, answer: string): Promise<void> {
  const puzzle = page.getByTestId("puzzle");
  const visibleText = await puzzle.innerText();
  expect(visibleText.toLocaleLowerCase("es-ES")).not.toContain(answer.toLocaleLowerCase("es-ES"));

  const exposedValues = await puzzle.locator("*").evaluateAll((nodes) =>
    nodes.flatMap((node) => node.getAttributeNames().map((name) => node.getAttribute(name)))
  );
  expect(exposedValues.join("\n").toLocaleLowerCase("es-ES")).not.toContain(answer.toLocaleLowerCase("es-ES"));
}

test.beforeEach(async ({ page }) => {
  await freshPage(page);
});

test("leaf-first global guesses unlock all branches and complete the sentence", async ({ page }) => {
  await expect(page.locator('[data-clue-state="available"]')).toHaveCount(5);
  for (const step of [
    { answer: "tele", canonical: "tele" },
    { answer: "web", canonical: "web" },
    { answer: "enviar", canonical: "enviar" },
    { answer: "imagen", canonical: "imagen" },
    { answer: "saber", canonical: "saber" },
    { answer: "telescopio", canonical: "telescopio" },
    { answer: "Webb", canonical: "Webb" },
    { answer: "envio", canonical: "envió" },
    { answer: "ciencia", canonical: "ciencia" },
    { answer: "James Webb", canonical: "James Webb" },
    { answer: "imagen científica", canonical: "imagen científica" },
    { answer: "telescopio James Webb", canonical: "telescopio James Webb" }
  ]) {
    await expectAnswerAbsentFromRenderedClue(page, step.canonical);
    await submit(page, step.answer);
  }
  await expect(page.getByTestId("completion")).toBeVisible();
  await expect(page.getByTestId("completion")).toContainText("El telescopio James Webb envió su primera imagen científica en 2022.");
  await expect(page.getByTestId("score")).toHaveText("100");
});

test("locked answers are wrong and the input stays selected for correction", async ({ page }) => {
  await submit(page, "telescopio James Webb");
  await expect(page.getByTestId("score")).toHaveText("98");
  await expect(page.getByTestId("guess-input")).toBeFocused();
  const selected = await page.getByTestId("guess-input").evaluate((input) => {
    const field = input as HTMLInputElement;
    return field.selectionStart === 0 && field.selectionEnd === field.value.length;
  });
  expect(selected).toBe(true);
});

test("a first-letter peek does not expose the canonical answer", async ({ page }) => {
  const clue = canonicalLeaf(page);
  await expectAnswerAbsentFromRenderedClue(page, canonicalLeafAnswer);

  await clue.click();

  await expect(clue).toContainText("t…");
  await expectAnswerAbsentFromRenderedClue(page, canonicalLeafAnswer);
});

test("repeated clue taps never expose an untyped canonical answer", async ({ page }) => {
  const clue = canonicalLeaf(page);
  await clue.click();
  await clue.click();

  await expectAnswerAbsentFromRenderedClue(page, canonicalLeafAnswer);
  await expect(page.locator('[data-clue-state="solved"]').filter({ hasText: canonicalLeafAnswer })).toHaveCount(0);
});

test("reload does not expose an answer after clue taps", async ({ page }) => {
  const clue = canonicalLeaf(page);
  await clue.click();
  await clue.click();
  await page.reload();

  await expectAnswerAbsentFromRenderedClue(page, canonicalLeafAnswer);
  await expect(page.locator('[data-clue-state="solved"]').filter({ hasText: canonicalLeafAnswer })).toHaveCount(0);
});

test("canonical answers are not embedded in the puzzle DOM before typed submission", async ({ page }) => {
  const html = await page.getByTestId("puzzle").evaluate((node) => node.outerHTML);
  expect(html).not.toContain(canonicalLeafAnswer);
});

test("a correct global answer resolves its bracket without clue selection", async ({ page }) => {
  await submit(page, canonicalLeafAnswer);

  const submitButton = page.getByTestId("submit-button");
  await expect(submitButton).toHaveAttribute("data-submit-feedback", "correct");
  await expect.poll(() => submitButton.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe("rgb(33, 101, 59)");
  await expect(page.locator('[data-clue-state="solved"]').filter({ hasText: canonicalLeafAnswer })).toHaveText(canonicalLeafAnswer);
  await expect(page.locator('[data-clue-state="available"]').filter({ hasText: "instrumento óptico" })).toBeVisible();
  await expectAnswerAbsentFromRenderedClue(page, "telescopio");
  await expect(submitButton).toHaveAttribute("data-submit-feedback", "idle", { timeout: 1000 });
});

test("submit feedback distinguishes wrong answers and ignores empty submissions", async ({ page }) => {
  const submitButton = page.getByTestId("submit-button");
  await expect(submitButton).toHaveAttribute("data-submit-feedback", "idle");
  await submitButton.click();
  await expect(submitButton).toHaveAttribute("data-submit-feedback", "idle");
  await submit(page, "incorrecto");
  await expect(submitButton).toHaveAttribute("data-submit-feedback", "wrong");
  await expect.poll(() => submitButton.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe("rgb(155, 47, 39)");
  await expect(submitButton).toHaveAttribute("data-submit-feedback", "idle", { timeout: 1000 });
});

test("tapping every available clue twice cannot solve or unlock the puzzle", async ({ page }) => {
  const initiallyAvailable = page.locator('[data-clue-state="available"]');
  await expect(initiallyAvailable).toHaveCount(5);
  for (let index = 0; index < 5; index += 1) {
    await initiallyAvailable.nth(index).click();
    await initiallyAvailable.nth(index).click();
  }
  await expect(page.locator('[data-clue-state="solved"]')).toHaveCount(0);
  await expect(page.locator('[data-clue-state="available"]')).toHaveCount(5);
  await expect(page.getByTestId("completion")).toBeHidden();
  await expect(page.getByTestId("guess-input")).toBeVisible();
});

test("desktop hides the virtual keyboard and accepts normal keyboard input", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  const input = page.getByTestId("guess-input");
  await expect(page.getByRole("group", { name: "Teclado español" })).toBeHidden();
  await expect(input).not.toHaveAttribute("readonly", "");
  await expect(input).not.toHaveAttribute("inputmode", "none");
  await input.pressSequentially(canonicalLeafAnswer);
  await input.press("Enter");
  await expect(page.locator('[data-clue-state="solved"]').filter({ hasText: canonicalLeafAnswer })).toHaveText(canonicalLeafAnswer);
});

test("desktop puzzle and answer row share a wide centered content column", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.locator("#app").evaluate((mount) => {
    mount.style.width = "30rem";
    mount.style.marginLeft = "18rem";
    window.dispatchEvent(new Event("resize"));
  });

  const readDimensions = () => page.evaluate(() => {
    const shell = document.querySelector(".game-shell")!;
    const form = document.querySelector(".guess-form")!;
    const shellRect = shell.getBoundingClientRect();
    const formRect = form.getBoundingClientRect();
    const shellStyle = getComputedStyle(shell);
    return {
      viewportCenter: document.documentElement.clientWidth / 2,
      shellWidth: shellRect.width,
      shellCenter: shellRect.left + (shellRect.width / 2),
      formLeft: formRect.left,
      formRight: formRect.right,
      contentLeft: shellRect.left + Number.parseFloat(shellStyle.paddingLeft),
      contentRight: shellRect.right - Number.parseFloat(shellStyle.paddingRight)
    };
  });
  await expect.poll(readDimensions).toMatchObject({ shellWidth: 736 });
  const dimensions = await readDimensions();

  expect(dimensions.shellCenter).toBeCloseTo(dimensions.viewportCenter, 0);
  expect(dimensions.formLeft).toBeCloseTo(dimensions.contentLeft, 0);
  expect(dimensions.formRight).toBeCloseTo(dimensions.contentRight, 0);
});

test("the visible virtual keyboard is the only input method and preserves selection", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const input = page.getByTestId("guess-input");
  await expect(page.getByRole("group", { name: "Teclado español" })).toBeVisible();
  await expect(page.locator(".keyboard-toggle")).toHaveCount(0);
  await expect(input).toHaveAttribute("readonly", "");
  await expect(input).toHaveAttribute("inputmode", "none");
  await expect(input).toHaveAttribute("virtualkeyboardpolicy", "manual");
  await page.getByRole("button", { name: "a", exact: true }).click();
  await page.getByRole("button", { name: "o", exact: true }).click();
  await input.evaluate((node) => (node as HTMLInputElement).setSelectionRange(1, 1));
  await page.locator('[data-key="ñ"]').click();
  await expect(input).toHaveValue("año");
  await page.locator('[data-key="Backspace"]').click();
  await expect(input).toHaveValue("ao");
  await expect.poll(() => page.evaluate(() => {
    const shell = document.querySelector(".game-shell")!;
    const composer = document.querySelector(".composer")!;
    return {
      paddingBottom: Number.parseFloat(getComputedStyle(shell).paddingBottom),
      composerHeight: composer.getBoundingClientRect().height
    };
  })).toMatchObject({
    paddingBottom: expect.any(Number),
    composerHeight: expect.any(Number)
  });
  const inset = await page.evaluate(() => ({
    paddingBottom: Number.parseFloat(getComputedStyle(document.querySelector(".game-shell")!).paddingBottom),
    composerHeight: document.querySelector(".composer")!.getBoundingClientRect().height
  }));
  expect(inset.paddingBottom).toBeGreaterThanOrEqual(inset.composerHeight + 16);
});

test("rapid virtual-key taps disable double-tap zoom without disabling page zoom", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const input = page.getByTestId("guess-input");
  const key = page.locator('[data-key="a"]');
  const touchPolicies = await page.locator(".keyboard-key").evaluateAll((keys) =>
    keys.map((node) => getComputedStyle(node).touchAction)
  );
  expect(touchPolicies.every((policy) => policy === "manipulation")).toBe(true);

  const viewportPolicy = await page.locator('meta[name="viewport"]').getAttribute("content");
  expect(viewportPolicy ?? "").not.toMatch(/user-scalable\s*=\s*no/iu);
  expect(viewportPolicy ?? "").not.toMatch(/maximum-scale\s*=\s*1(?:\.0+)?(?:,|$)/iu);

  await key.click();
  await key.click();
  await expect(input).toHaveValue("aa");
  await expect(input).toBeFocused();
});

test("320-pixel layout has no overflow and keeps readable text and primary controls", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    inputSize: Number.parseFloat(getComputedStyle(document.querySelector("#guess")!).fontSize),
    puzzleSize: Number.parseFloat(getComputedStyle(document.querySelector("[data-testid=puzzle]")!).fontSize)
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  expect(dimensions.inputSize).toBeGreaterThanOrEqual(16);
  expect(dimensions.puzzleSize).toBeGreaterThanOrEqual(16);
  // Inline clue controls stay compact; their line geometry is checked in catalog.spec.ts.
  const targets = await page.locator(".guess-input, .submit-button, .date-select, .mode-link, .keyboard-key").evaluateAll((nodes) =>
    nodes.map((node) => ({ className: node.className, height: node.getBoundingClientRect().height }))
  );
  expect(targets.every((target) => target.height >= 43), JSON.stringify(targets)).toBe(true);
});

test("fresh game has no serious or critical automated accessibility violations", async ({ page }) => {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""));
  expect(serious).toEqual([]);
});
