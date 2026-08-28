import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function freshPage(page) {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
}

async function submit(page, answer, method = "enter") {
  const input = page.getByTestId("guess-input");
  await input.fill(answer);
  if (method === "button") await page.getByRole("button", { name: "Enviar", exact: true }).click();
  else await input.press("Enter");
}

const canonicalLeafAnswer = "tele";
const canonicalLeafId = "c03";

async function expectAnswerAbsentFromRenderedClue(page, answer) {
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
  for (const [index, step] of [
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
  ].entries()) {
    await expectAnswerAbsentFromRenderedClue(page, step.canonical);
    await submit(page, step.answer, index % 2 === 0 ? "enter" : "button");
  }
  await expect(page.getByTestId("completion")).toBeVisible();
  await expect(page.getByTestId("completion")).toContainText("El telescopio James Webb envió su primera imagen científica en 2022.");
  await expect(page.getByTestId("score")).toHaveText("100");
});

test("locked answers are wrong and the input stays selected for correction", async ({ page }) => {
  await submit(page, "telescopio James Webb");
  await expect(page.getByTestId("score")).toHaveText("98");
  await expect(page.getByTestId("guess-input")).toBeFocused();
  const selected = await page.getByTestId("guess-input").evaluate((input) => input.selectionStart === 0 && input.selectionEnd === input.value.length);
  expect(selected).toBe(true);
});

test("a first-letter peek does not expose the canonical answer", async ({ page }) => {
  const clue = page.locator(`[data-clue-id="${canonicalLeafId}"][data-clue-state="available"]`);
  await expectAnswerAbsentFromRenderedClue(page, canonicalLeafAnswer);

  await clue.click();

  await expect(clue).toContainText("t…");
  await expectAnswerAbsentFromRenderedClue(page, canonicalLeafAnswer);
});

test("repeated clue taps never expose an untyped canonical answer", async ({ page }) => {
  const clue = page.locator(`[data-clue-id="${canonicalLeafId}"][data-clue-state="available"]`);
  await clue.click();
  await clue.click();

  await expectAnswerAbsentFromRenderedClue(page, canonicalLeafAnswer);
  await expect(page.locator(`[data-clue-id="${canonicalLeafId}"][data-clue-state="solved"]`)).toHaveCount(0);
});

test("reload does not expose an answer after clue taps", async ({ page }) => {
  const clue = page.locator(`[data-clue-id="${canonicalLeafId}"][data-clue-state="available"]`);
  await clue.click();
  await clue.click();
  await page.reload();

  await expectAnswerAbsentFromRenderedClue(page, canonicalLeafAnswer);
  await expect(page.locator(`[data-clue-id="${canonicalLeafId}"][data-clue-state="solved"]`)).toHaveCount(0);
});

test("canonical answers are not embedded in the puzzle DOM before typed submission", async ({ page }) => {
  const html = await page.getByTestId("puzzle").evaluate((node) => node.outerHTML);
  expect(html).not.toContain(canonicalLeafAnswer);
});

test("a correct typed submission may render the canonical answer", async ({ page }) => {
  await submit(page, canonicalLeafAnswer);

  await expect(page.locator(`[data-clue-id="${canonicalLeafId}"][data-clue-state="solved"]`)).toHaveText(canonicalLeafAnswer);
  await expect(page.locator('[data-clue-id="c02"][data-clue-state="available"]')).toBeVisible();
  await expectAnswerAbsentFromRenderedClue(page, "telescopio");
});

test("tapping every available clue twice cannot solve or unlock the puzzle", async ({ page }) => {
  const initiallyAvailable = ["c03", "c06", "c08", "c10", "c12"];
  for (const clueId of initiallyAvailable) {
    await page.locator(`[data-clue-id="${clueId}"][data-clue-state="available"]`).click();
    await page.locator(`[data-clue-id="${clueId}"][data-clue-state="available"]`).click();
  }
  await expect(page.locator('[data-clue-state="solved"]')).toHaveCount(0);
  await expect(page.locator('[data-clue-state="available"]')).toHaveCount(5);
  await expect(page.getByTestId("completion")).toBeHidden();
  await expect(page.getByTestId("guess-input")).toBeVisible();
});

test("optional virtual keyboard edits the same input selection", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.getByRole("button", { name: "Mostrar teclado español" }).click();
  const input = page.getByTestId("guess-input");
  await input.fill("ao");
  await input.evaluate((node) => node.setSelectionRange(1, 1));
  await page.locator('[data-key="ñ"]').click();
  await expect(input).toHaveValue("año");
  await page.locator('[data-key="Backspace"]').click();
  await expect(input).toHaveValue("ao");
  await expect.poll(() => page.evaluate(() => {
    const shell = document.querySelector(".game-shell");
    const composer = document.querySelector(".composer");
    return {
      paddingBottom: Number.parseFloat(getComputedStyle(shell).paddingBottom),
      composerHeight: composer.getBoundingClientRect().height
    };
  })).toMatchObject({
    paddingBottom: expect.any(Number),
    composerHeight: expect.any(Number)
  });
  const inset = await page.evaluate(() => ({
    paddingBottom: Number.parseFloat(getComputedStyle(document.querySelector(".game-shell")).paddingBottom),
    composerHeight: document.querySelector(".composer").getBoundingClientRect().height
  }));
  expect(inset.paddingBottom).toBeGreaterThanOrEqual(inset.composerHeight + 16);
});

test("320-pixel layout has no page overflow and keeps readable input", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    inputSize: Number.parseFloat(getComputedStyle(document.querySelector("#guess")).fontSize),
    puzzleSize: Number.parseFloat(getComputedStyle(document.querySelector("[data-testid=puzzle]")).fontSize)
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  expect(dimensions.inputSize).toBeGreaterThanOrEqual(16);
  expect(dimensions.puzzleSize).toBeGreaterThanOrEqual(16);
  const targetHeights = await page.locator('[data-clue-state="available"]').evaluateAll((nodes) =>
    nodes.map((node) => node.getBoundingClientRect().height)
  );
  expect(targetHeights.every((height) => height >= 43)).toBe(true);
});

test("fresh game has no serious or critical automated accessibility violations", async ({ page }) => {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter((violation) => ["serious", "critical"].includes(violation.impact));
  expect(serious).toEqual([]);
});
