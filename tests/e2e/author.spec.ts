import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function freshAuthorPage(page: Page): Promise<void> {
  await page.goto("/?mode=author");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
}

async function selectTextareaRange(textarea: Locator, start: number, end: number): Promise<void> {
  await textarea.evaluate((node, range) => {
    const field = node as HTMLTextAreaElement;
    field.focus();
    field.setSelectionRange(range.start, range.end);
  }, { start, end });
}

async function selectPreviewText(page: Page, owner: string, segmentIndex: number, selectedText: string): Promise<void> {
  const literal = page.getByTestId("author-preview-literal").filter({ hasText: selectedText });
  await expect(literal, `Selection '${selectedText}' must identify one preview literal for ${owner}:${segmentIndex}.`).toHaveCount(1);
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
  await expect(page.getByTestId("author-convert-selection")).toBeEnabled();
}

async function convertPreviewText(page: Page, owner: string, segmentIndex: number, selectedText: string): Promise<void> {
  await selectPreviewText(page, owner, segmentIndex, selectedText);
  await page.getByTestId("author-convert-selection").click();
}

async function createNestedDraft(page: Page): Promise<void> {
  const finalText = page.getByTestId("author-final-text");
  await finalText.fill("AX");

  await convertPreviewText(page, "root", 0, "AX");

  const parentPrompt = page.getByTestId("c01-literal-0");
  await parentPrompt.fill("AX");
  await convertPreviewText(page, "c01", 0, "X");

  const leafPrompt = page.getByTestId("c02-literal-0");
  await leafPrompt.fill("última letra");
}

async function createPublishableDraft(page: Page): Promise<void> {
  const finalText = page.getByTestId("author-final-text");
  await finalText.fill("La gata.");

  await convertPreviewText(page, "root", 0, "gata");
  await page.getByTestId("c01-literal-0").fill("animal doméstico");

  await page.getByTestId("author-puzzle-id").fill("gata-local-es");
  await page.locator("#author-title-input").fill("La gata");
  await page.locator("#author-release-date").fill("2026-09-01");
}

async function submitWithVirtualKeyboard(page: Page, answer: string): Promise<void> {
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

test("classic skin uses the blue Agrupar accent", async ({ page }) => {
  await page.goto("/?mode=author&flow=inline&skin=plain");

  const groupButton = page.getByTestId("author-inline-key-wrap");
  await expect(groupButton).toHaveCSS("background-color", "rgb(82, 104, 174)");
  await expect(groupButton).toHaveCSS("border-color", "rgb(63, 82, 143)");
  await expect(groupButton).toHaveCSS("border-radius", "4px");
});

test("the direct flow parses bracket syntax, exposes direction keys, and undoes groups", async ({ page }) => {
  await page.goto("/?mode=author&flow=inline");
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  const source = page.getByTestId("author-inline-source");
  await source.fill("La [animal [de casa→doméstico]=gata].");
  await expect(page.getByTestId("author-inline-group")).toHaveCount(2);
  await expect(page.getByTestId("author-inline-group-count")).toHaveText("2");
  await expect(page.getByTestId("author-inline-group-depth")).toHaveText("2");
  await expect(page.getByTestId("author-inline-answer-slot")).toHaveCount(1);
  await expect(page.locator(".author-inline-group-contents").nth(1)).toHaveText("de casa→___");
  await expect(source).toHaveValue("La [animal [de casa→doméstico]=gata].");
  await expect(page.getByRole("group", { name: "Teclado de estructura" })).toContainText("←");
  await expect(page.getByRole("group", { name: "Teclado de estructura" })).toContainText("→");
  await expect(page.getByRole("group", { name: "Teclado de estructura" })).toContainText("=");
  await expect(page.getByTestId("author-answer")).toHaveCount(0);

  await page.locator('[data-clue-id="c02"] > .author-inline-group-contents').click();
  await expect(page.getByTestId("author-inline-inspector")).toContainText("doméstico");
  await expect(page.getByTestId("author-validation-state")).toContainText("válido");

  await page.getByTestId("author-style-toggle").click();
  await page.getByRole("button", { name: "Plano", exact: true }).click();
  await expect(page.getByTestId("author-inline-map")).toHaveClass(/author-inline-map--blueprint/u);
  await expect(page.getByTestId("author-inline-group").first()).toHaveCSS("border-style", "solid");
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""))).toEqual([]);
  await page.getByRole("button", { name: "Quitar grupo 1", exact: true }).click();
  await expect(source).toHaveValue("La gata.");
  await expect(page.getByTestId("author-inline-group")).toHaveCount(0);
});

test("desktop keeps support panels in a compact rail and applies skins independently", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?mode=author&flow=inline");

  const shell = page.locator(".author-shell");
  const composer = page.locator(".author-inline-composer");
  const utilities = page.getByTestId("author-utilities");
  await expect(shell).toHaveAttribute("data-panel-skin", "lab");
  const styleOptions = page.getByTestId("author-style-options");
  await expect(styleOptions).not.toHaveAttribute("open", "");
  const composerBeforeStyleChange = await composer.boundingBox();
  await styleOptions.getByTestId("author-style-toggle").click();
  await expect(page.getByRole("group", { name: "Apariencia" })).toBeVisible();
  await expect(utilities.getByTestId("author-style-options")).toBeVisible();
  const composerAfterStyleChange = await composer.boundingBox();
  expect(composerBeforeStyleChange).not.toBeNull();
  expect(composerAfterStyleChange).not.toBeNull();
  expect(composerAfterStyleChange!.y).toBeCloseTo(composerBeforeStyleChange!.y, 1);
  await expect(page.getByTestId("author-load-panel").getByTestId("author-existing-puzzle")).toBeVisible();
  await expect(utilities.getByTestId("author-existing-puzzle")).toHaveCount(0);
  await expect(utilities.getByTestId("author-puzzle-id")).toBeVisible();
  await expect(utilities.locator(".author-output")).toBeVisible();
  await expect(page.getByTestId("author-json-details")).not.toHaveAttribute("open", "");

  const [composerBox, utilityBox] = await Promise.all([composer.boundingBox(), utilities.boundingBox()]);
  expect(composerBox).not.toBeNull();
  expect(utilityBox).not.toBeNull();
  expect(Math.abs(composerBox!.y - utilityBox!.y)).toBeLessThan(40);
  expect(composerBox!.width).toBeGreaterThan(utilityBox!.width);

  await Promise.all([
    page.waitForURL(/skin=blueprint/u),
    page.getByRole("link", { name: "Plano técnico", exact: true }).click()
  ]);
  await expect(shell).toHaveAttribute("data-panel-skin", "blueprint");
  await expect(styleOptions).toHaveAttribute("open", "");
  await expect(page.locator(".author-flow-mode a")).toHaveCount(2);
  await expect(page.locator(".author-flow-mode a").nth(0)).toHaveAttribute("href", /skin=blueprint/u);
  await expect(page.locator(".author-flow-mode a").nth(1)).toHaveAttribute("href", /skin=blueprint/u);
});

test("creates a playable nested draft with an internal answer slot and direction-preserving JSON", async ({ page }) => {
  await createNestedDraft(page);
  await page.getByTestId("author-bracket-format-right").click();

  await expect(page.locator('.author-tree-button[data-clue-id="c02"]')).toHaveText("[última letra→X]");
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

test("guided mode pairs the syntax tree with a compact direction editor", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await createNestedDraft(page);
  await page.getByTestId("author-bracket-format-right").click();

  const workspace = page.getByTestId("author-guided-workspace");
  const tree = page.getByTestId("author-tree-panel");
  const inspector = page.getByTestId("clue-inspector");
  await expect(workspace).toBeVisible();
  await expect(tree).toContainText("[AX=AX]");
  await expect(tree).toContainText("[última letra→X]");
  await expect(inspector.getByTestId("author-bracket-format-right")).toHaveAttribute("aria-pressed", "true");
  await expect(inspector.getByTestId("author-bracket-format-right").locator(".author-syntax-answer")).toHaveText("respuesta");

  const [treeBox, inspectorBox] = await Promise.all([tree.boundingBox(), inspector.boundingBox()]);
  expect(treeBox).not.toBeNull();
  expect(inspectorBox).not.toBeNull();
  expect(Math.abs(treeBox!.y - inspectorBox!.y)).toBeLessThan(8);
  expect(treeBox!.x).toBeLessThan(inspectorBox!.x);
});

test("allows a directed hint to contain a nested clue", async ({ page }) => {
  await createNestedDraft(page);
  await page.getByTestId("author-bracket-format-right").click();

  await convertPreviewText(page, "c02", 0, "última");
  await expect(page.locator('[data-clue-id="c03"]')).toBeVisible();
  await expect(page.locator('[data-clue-id="c03"]')).toHaveAttribute("aria-current", "true");
  await expect(page.getByTestId("author-answer")).toHaveValue("última");
  const draft = await page.evaluate(() => JSON.parse(localStorage.getItem("nested-clue:author:v1") ?? "null"));
  expect(draft.clues.c01.prompt.at(-1)).toEqual({ ref: "c02", direction: "right" });
});

test("authors two independent hints and nests from the right-side preview", async ({ page }) => {
  await page.getByTestId("author-final-text").fill("light");
  await convertPreviewText(page, "root", 0, "light");

  await page.getByTestId("c01-literal-0").fill("sun");
  await page.getByTestId("author-bracket-format-both").click();
  await page.getByTestId("c01:right-literal-0").fill("house");

  await expect(page.getByTestId("author-bracket-format-both")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("author-structure-preview")).toHaveText("[sun→___←house]");
  const definition = JSON.parse(await page.getByTestId("author-json").inputValue());
  expect(definition.clues.c01.rightPrompt).toEqual(["house"]);

  await convertPreviewText(page, "c01:right", 0, "house");
  const draft = await page.evaluate(() => JSON.parse(localStorage.getItem("nested-clue:author:v1") ?? "null"));
  expect(draft.clues.c01.rightPrompt).toEqual([{ ref: "c02" }]);
  expect(draft.clues.c02.answer).toBe("house");
});

test("the preview is the only surface that creates exact partial-word bracket layers", async ({ page }) => {
  const finalText = page.getByTestId("author-final-text");
  await finalText.fill("La sartén.");

  const finalPanel = finalText.locator("xpath=ancestor::section[contains(@class, 'author-panel')]");
  await expect(finalPanel.getByTestId("author-structure-preview")).toBeVisible();
  await expect(page.getByTestId("author-convert-selection")).toHaveCount(1);
  await expect(page.getByText("Texto antes", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Texto después", { exact: true })).toHaveCount(0);

  await convertPreviewText(page, "root", 0, "arté");
  const draftAfterRoot = await page.evaluate(() => JSON.parse(localStorage.getItem("nested-clue:author:v1") ?? "null"));
  expect(draftAfterRoot.root).toEqual(["La s", { ref: "c01" }, "n."]);
  await expect(page.getByTestId("root-literal-0")).toHaveCount(0);

  const prompt = page.getByTestId("c01-literal-0");
  await prompt.fill("algo que imita la vida");
  await selectTextareaRange(prompt, 19, 23);
  await expect(page.getByTestId("author-convert-selection")).toBeDisabled();
  await convertPreviewText(page, "c01", 0, "ida");

  const draft = await page.evaluate(() => JSON.parse(localStorage.getItem("nested-clue:author:v1") ?? "null"));
  expect(draft.root).toEqual(["La s", { ref: "c01" }, "n."]);
  expect(draft.clues.c01.prompt).toEqual(["algo que imita la v", { ref: "c02" }]);
  expect(draft.clues.c02.answer).toBe("ida");
});

test("enables only selections that stay within one preview literal", async ({ page }) => {
  await page.getByTestId("author-final-text").fill("Empieza el viaje.");

  await page.getByTestId("author-structure-preview").evaluate((preview) => {
    const range = document.createRange();
    range.setStart(preview, 0);
    range.setEnd(preview, 1);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
  await expect(page.getByTestId("author-convert-selection")).toBeEnabled();
  await page.getByTestId("author-structure-preview").evaluate(() => {
    window.getSelection()!.removeAllRanges();
    document.dispatchEvent(new Event("selectionchange"));
  });
  await expect(page.getByTestId("author-convert-selection")).toBeDisabled();

  await freshAuthorPage(page);
  await page.getByTestId("author-final-text").fill("Empieza el viaje.");
  await convertPreviewText(page, "root", 0, "viaje");
  await page.getByTestId("c01-literal-0").fill("desplazamiento");
  await page.getByTestId("author-structure-preview").evaluate((preview) => {
    const [before, nested] = preview.querySelectorAll('[data-testid="author-preview-literal"]');
    const range = document.createRange();
    range.setStart(before!.firstChild!, 2);
    range.setEnd(nested!.firstChild!, 5);
    const selection = window.getSelection()!;
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
  await select.selectOption("0");
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
  await expect(page.getByTestId("author-aliases-disclosure")).toHaveCount(0);
  await expect(page.getByTestId("author-aliases")).toHaveCount(0);
  expect(JSON.parse(await page.getByTestId("author-json").inputValue()).clues.c03.accept).toEqual(["arte"]);
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

test("author mode has no horizontal overflow at 320 pixels and grows the source field", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const source = page.getByTestId("author-inline-source");
  await page.goto("/?mode=author&flow=inline");
  const initialHeight = await source.evaluate((node) => node.clientHeight);
  await source.fill(Array.from(
    { length: 24 },
    (_, index) => `Línea ${index + 1}: una pista que ocupa espacio.`
  ).join("\n"));
  await expect.poll(() => source.evaluate((node) => node.scrollHeight <= node.clientHeight)).toBe(true);
  expect(await source.evaluate((node) => node.clientHeight)).toBeGreaterThan(initialHeight);
  await expect(source).toHaveCSS("overflow-y", "hidden");
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
});

test("author mode has no serious or critical automated accessibility violations", async ({ page }) => {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""));
  expect(serious).toEqual([]);
});
