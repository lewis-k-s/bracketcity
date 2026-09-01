import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function freshAuthorPage(page) {
  await page.goto("/?mode=author");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
}

async function selectTextareaRange(textarea, start, end) {
  await textarea.evaluate((node, range) => {
    node.focus();
    node.setSelectionRange(range.start, range.end);
  }, { start, end });
}

async function selectPreviewText(page, owner, segmentIndex, selectedText) {
  const literal = page.getByTestId("author-preview-literal").filter({ hasText: selectedText });
  await expect(literal, `Selection '${selectedText}' must identify one preview literal for ${owner}:${segmentIndex}.`).toHaveCount(1);
  await literal.evaluate((node, text) => {
    const start = node.textContent.indexOf(text);
    if (start < 0) throw new Error(`Preview text '${text}' was not found.`);
    const range = document.createRange();
    range.setStart(node.firstChild, start);
    range.setEnd(node.firstChild, start + text.length);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  }, selectedText);
  await expect(page.getByTestId("author-convert-selection")).toBeEnabled();
}

async function convertPreviewText(page, owner, segmentIndex, selectedText) {
  await selectPreviewText(page, owner, segmentIndex, selectedText);
  await page.getByTestId("author-convert-selection").click();
}

async function createNestedDraft(page) {
  const finalText = page.getByTestId("author-final-text");
  await finalText.fill("AX");
  await page.getByRole("button", { name: "Aplicar texto final", exact: true }).click();

  await convertPreviewText(page, "root", 0, "AX");

  const parentPrompt = page.getByTestId("c01-literal-0");
  await parentPrompt.fill("AX");
  await page.getByTestId("clue-inspector").getByTestId("author-save-text").click();
  await convertPreviewText(page, "c01", 0, "X");

  const leafPrompt = page.getByTestId("c02-literal-0");
  await leafPrompt.fill("última letra");
  await page.getByTestId("clue-inspector").getByRole("button", { name: "Guardar texto", exact: true }).click();
}

async function createPublishableDraft(page) {
  const finalText = page.getByTestId("author-final-text");
  await finalText.fill("La gata.");
  await page.getByRole("button", { name: "Aplicar texto final", exact: true }).click();

  await convertPreviewText(page, "root", 0, "gata");
  await page.getByTestId("c01-literal-0").fill("animal doméstico");
  await page.getByTestId("clue-inspector").getByRole("button", { name: "Guardar texto", exact: true }).click();

  await page.getByTestId("author-puzzle-id").fill("gata-local-es");
  await page.locator("#author-title-input").fill("La gata");
  await page.locator("#author-release-date").fill("2026-09-01");
}

async function submitWithVirtualKeyboard(page, answer) {
  const input = page.getByTestId("guess-input");
  const keyboard = page.getByRole("group", { name: "Teclado español" });
  if (!(await keyboard.isVisible())) {
    await input.fill(answer);
    await input.press("Enter");
    return;
  }
  for (const character of answer.toLocaleLowerCase("es-ES")) {
    await page.getByRole("button", { name: character, exact: true }).click();
  }
  await page.getByRole("button", { name: "Enviar", exact: true }).click();
}

test.beforeEach(async ({ page }) => {
  await freshAuthorPage(page);
});

test("creates a playable nested draft with an internal answer slot and direction-preserving JSON", async ({ page }) => {
  await createNestedDraft(page);
  await page.getByTestId("author-direction").selectOption("right");

  await expect(page.getByTestId("author-validation-state")).toContainText("válido");
  await expect(page.getByTestId("author-download")).toBeEnabled();

  const preview = page.getByTestId("author-structure-preview");
  const leaf = preview.locator('[data-author-bracket]').last();
  await expect(leaf).toBeVisible();
  const marker = leaf.locator('[data-author-direction="right"]');
  await expect(marker).toHaveAttribute("data-author-direction", "right");
  await expect(marker).toHaveText("→");
  await expect(leaf.locator("[data-answer-slot]")).toHaveText("___");

  await expect(preview).not.toContainText("AX");
  await expect(preview).not.toContainText("X");
  const exposed = await preview.locator("*").evaluateAll((nodes) => nodes.flatMap((node) =>
    ["aria-label", "title", "value", "data-answer", "data-solution"]
      .map((name) => node.getAttribute(name))
      .filter((value) => value !== null)
  ));
  expect(exposed.join("\n")).not.toContain("AX");
  expect(exposed.join("\n")).not.toContain("X");

  const definition = JSON.parse(await page.getByTestId("author-json").inputValue());
  expect(definition.clues.c01.prompt).toEqual([
    "A",
    { ref: "c02", direction: "right" }
  ]);
});

test("allows a directed hint to contain a nested clue", async ({ page }) => {
  await createNestedDraft(page);
  await page.getByTestId("author-direction").selectOption("right");

  await convertPreviewText(page, "c02", 0, "última");
  await expect(page.locator('[data-clue-id="c03"]')).toBeVisible();
  await expect(page.locator('[data-clue-id="c03"]')).toHaveAttribute("aria-current", "true");
  await expect(page.getByTestId("author-answer")).toHaveValue("última");
  const draft = await page.evaluate(() => JSON.parse(localStorage.getItem("nested-clue:author:v1")));
  expect(draft.clues.c01.prompt.at(-1)).toEqual({ ref: "c02", direction: "right" });
});

test("authors two independent hints and nests from the right-side preview", async ({ page }) => {
  await page.getByTestId("author-final-text").fill("light");
  await page.getByRole("button", { name: "Aplicar texto final", exact: true }).click();
  await convertPreviewText(page, "root", 0, "light");

  await page.getByTestId("c01-literal-0").fill("sun");
  await page.getByTestId("clue-inspector").getByTestId("author-save-text").click();
  await page.getByTestId("author-right-prompt-toggle").click();
  await page.getByTestId("c01:right-literal-0").fill("house");
  await page.getByTestId("clue-inspector").getByTestId("author-save-text").last().click();

  await expect(page.getByTestId("author-direction")).toHaveCount(0);
  await expect(page.getByTestId("author-structure-preview")).toHaveText("[sun→___←house]");
  const definition = JSON.parse(await page.getByTestId("author-json").inputValue());
  expect(definition.clues.c01.rightPrompt).toEqual(["house"]);

  await convertPreviewText(page, "c01:right", 0, "house");
  const draft = await page.evaluate(() => JSON.parse(localStorage.getItem("nested-clue:author:v1")));
  expect(draft.clues.c01.rightPrompt).toEqual([{ ref: "c02" }]);
  expect(draft.clues.c02.answer).toBe("house");
});

test("the preview is the only surface that creates exact partial-word bracket layers", async ({ page }) => {
  const finalText = page.getByTestId("author-final-text");
  await finalText.fill("La sartén.");
  await page.getByRole("button", { name: "Aplicar texto final", exact: true }).click();

  const finalPanel = finalText.locator("xpath=ancestor::section[contains(@class, 'author-panel')]");
  await expect(finalPanel.getByTestId("author-structure-preview")).toBeVisible();
  await expect(page.getByTestId("author-convert-selection")).toHaveCount(1);
  await expect(page.getByText("Texto antes", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Texto después", { exact: true })).toHaveCount(0);

  await convertPreviewText(page, "root", 0, "arté");
  const draftAfterRoot = await page.evaluate(() => JSON.parse(localStorage.getItem("nested-clue:author:v1")));
  expect(draftAfterRoot.root).toEqual(["La s", { ref: "c01" }, "n."]);
  await expect(page.getByTestId("root-literal-0")).toHaveCount(0);

  const prompt = page.getByTestId("c01-literal-0");
  await prompt.fill("algo que imita la vida");
  await selectTextareaRange(prompt, 19, 23);
  await expect(page.getByTestId("author-convert-selection")).toBeDisabled();
  await page.getByTestId("clue-inspector").getByTestId("author-save-text").click();
  await convertPreviewText(page, "c01", 0, "ida");

  const draft = await page.evaluate(() => JSON.parse(localStorage.getItem("nested-clue:author:v1")));
  expect(draft.root).toEqual(["La s", { ref: "c01" }, "n."]);
  expect(draft.clues.c01.prompt).toEqual(["algo que imita la v", { ref: "c02" }]);
  expect(draft.clues.c02.answer).toBe("ida");
});

test("enables only selections that stay within one preview literal", async ({ page }) => {
  await page.getByTestId("author-final-text").fill("Empieza el viaje.");
  await page.getByRole("button", { name: "Aplicar texto final", exact: true }).click();

  await page.getByTestId("author-structure-preview").evaluate((preview) => {
    const range = document.createRange();
    range.setStart(preview, 0);
    range.setEnd(preview, 1);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
  await expect(page.getByTestId("author-convert-selection")).toBeEnabled();
  await page.getByTestId("author-structure-preview").evaluate(() => {
    window.getSelection().removeAllRanges();
    document.dispatchEvent(new Event("selectionchange"));
  });
  await expect(page.getByTestId("author-convert-selection")).toBeDisabled();

  await freshAuthorPage(page);
  await page.getByTestId("author-final-text").fill("Empieza el viaje.");
  await page.getByRole("button", { name: "Aplicar texto final", exact: true }).click();
  await convertPreviewText(page, "root", 0, "viaje");
  await page.getByTestId("c01-literal-0").fill("desplazamiento");
  await page.getByTestId("clue-inspector").getByTestId("author-save-text").click();
  await page.getByTestId("author-structure-preview").evaluate((preview) => {
    const [before, nested] = preview.querySelectorAll('[data-testid="author-preview-literal"]');
    const range = document.createRange();
    range.setStart(before.firstChild, 2);
    range.setEnd(nested.firstChild, 5);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
  await expect(page.getByTestId("author-convert-selection")).toBeDisabled();
});

test("loads an existing dated puzzle for direct editing", async ({ page }) => {
  page.on("dialog", (dialog) => dialog.accept());
  const select = page.getByTestId("author-existing-puzzle");
  await expect(select).toBeVisible();
  await select.selectOption({ label: "2026-08-31 · Un solo huevo" });
  await page.getByTestId("author-load-existing").click();

  await expect(page.getByTestId("author-final-text")).toHaveValue(
    "Lewis se entera de la sartén para un solo huevo."
  );
  await expect(page.getByTestId("author-puzzle-id")).toHaveValue("simulacion-huevo-es");
  const definition = JSON.parse(await page.getByTestId("author-json").inputValue());
  expect(definition.finalText).toBe("Lewis se entera de la sartén para un solo huevo.");
  expect(definition.clues.c03.answer).toBe("arté");
  expect(definition.scoring).toBeDefined();

  await page.locator('button.author-tree-button[data-clue-id="c03"]').click();
  await expect(page.getByTestId("author-aliases-disclosure")).not.toHaveAttribute("open", "");
  await expect(page.getByTestId("author-aliases")).toHaveValue("arte");
  await expect(page.locator("#author-peek")).toHaveCount(0);
  await expect(page.getByTestId("author-convert-selection")).toHaveCount(1);
});

test("publishes a dated creator puzzle and opens it in play mode", async ({ page }) => {
  await createPublishableDraft(page);
  const publish = page.getByTestId("author-publish");
  await expect(publish).toBeEnabled();
  await publish.click();
  await expect(page.getByTestId("author-live")).toContainText("2026-09-01");

  await Promise.all([
    page.waitForURL(/\?date=2026-09-01$/u),
    page.getByRole("link", { name: "Jugar", exact: true }).click()
  ]);

  const selector = page.getByTestId("date-selector");
  await expect(selector).toHaveValue("2026-09-01");
  await expect(selector.locator("option")).toHaveCount(4);
  await expect(page.getByTestId("puzzle")).toContainText("animal doméstico");
  await expect(page.getByTestId("puzzle")).not.toContainText("gata");
  await submitWithVirtualKeyboard(page, "gata");
  await expect(page.getByTestId("completion")).toContainText("La gata.");
  await page.reload();
  await expect(page.getByTestId("date-selector")).toHaveValue("2026-09-01");
  await expect(page.getByTestId("completion")).toContainText("La gata.");
});

test("does not publish an invalid creator draft", async ({ page }) => {
  await page.locator("#author-release-date").fill("2026-09-01");
  await expect(page.getByTestId("author-publish")).toBeDisabled();
  await expect.poll(async () => page.evaluate(() => localStorage.getItem("nested-clue:published:v1"))).toBeNull();
});

test("author mode has no horizontal overflow at 320 pixels", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
});

test("author mode has no serious or critical automated accessibility violations", async ({ page }) => {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter((violation) => ["serious", "critical"].includes(violation.impact));
  expect(serious).toEqual([]);
});
