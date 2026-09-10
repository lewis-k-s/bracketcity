import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

import type { PuzzleDefinition } from "../src/types.ts";
import { branchPuzzle, esLocale } from "./fixtures.ts";
import { installDomWindow } from "./test-dom.ts";

globalThis.__NEXO_DISABLE_AUTO_START__ = true;
installAppDom();
const { INSTRUCTIONS_STORAGE_KEY, readApplicationMode, startApp, startDatedApp } = await import("../src/app.ts");

function definitionFor(date: string): PuzzleDefinition {
  return { ...structuredClone(branchPuzzle), id: `puzzle-${date}`, releaseDate: date };
}

function installAppDom(): {
  readonly dom: JSDOM;
  readonly added: string[];
  readonly removed: string[];
} {
  const dom = new JSDOM("<!doctype html><html><body><main id='app'></main></body></html>", {
    url: "https://example.test/?date=2026-08-28"
  });
  installDomWindow(dom.window);
  Object.defineProperty(globalThis, "location", { configurable: true, value: dom.window.location });
  Object.defineProperty(globalThis, "history", { configurable: true, value: dom.window.history });
  const added: string[] = [];
  const removed: string[] = [];
  globalThis.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject) => {
    added.push(type);
    dom.window.addEventListener(type, listener as EventListener);
  }) as typeof globalThis.addEventListener;
  globalThis.removeEventListener = ((type: string, listener: EventListenerOrEventListenerObject) => {
    removed.push(type);
    dom.window.removeEventListener(type, listener as EventListener);
  }) as typeof globalThis.removeEventListener;
  globalThis.requestAnimationFrame = (callback) => {
    callback(0);
    return 0;
  };
  return { dom, added, removed };
}

async function waitUntil(predicate: () => boolean, timeout = 1_000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeout) throw new Error("Timed out waiting for application state.");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test("Supabase invite callbacks open author mode without a query parameter", () => {
  const invite = new URL(
    "https://entre-parentesis.es/#access_token=session&refresh_token=refresh&type=invite"
  );
  const magicLink = new URL(
    "https://entre-parentesis.es/#access_token=session&refresh_token=refresh&type=magiclink"
  );

  assert.equal(readApplicationMode(invite, true), "author");
  assert.equal(readApplicationMode(magicLink, true), "author");
  assert.equal(readApplicationMode(invite, false), null);
  assert.equal(readApplicationMode(new URL("https://entre-parentesis.es/#type=invite"), true), null);
  assert.equal(readApplicationMode(new URL(
    "https://entre-parentesis.es/?mode=suggest#access_token=session&refresh_token=refresh&type=invite"
  ), true), "suggest");
});

test("destroying a dated application removes navigation and child resources", async () => {
  const { added, removed } = installAppDom();
  const definition = definitionFor("2026-08-28");
  const app = await startDatedApp({
    mount: document.querySelector<HTMLElement>("#app")!,
    entries: [{ date: definition.releaseDate!, definition }],
    initialDate: definition.releaseDate!,
    defaultDate: definition.releaseDate!,
    canAuthor: false,
    locale: esLocale,
    loadDefinition: async () => definition
  });

  assert.ok(app);
  assert.ok(added.includes("popstate"));
  app.destroy();
  assert.ok(removed.includes("popstate"));
  assert.ok(removed.includes("resize"));
});

test("instructions open once and persist their dismissal in browser storage", async () => {
  installAppDom();
  const values = new Map<string, string>();
  const storage = {
    getItem(key: string) { return values.get(key) ?? null; },
    setItem(key: string, value: string) { values.set(key, value); }
  };
  const first = await startApp({
    mount: document.querySelector<HTMLElement>("#app")!,
    definition: branchPuzzle,
    localePack: esLocale,
    storage
  });
  assert.ok(first);
  assert.equal(first.view.instructionsDialog.hasAttribute("open"), true);
  first.view.instructionsDialog.querySelector<HTMLButtonElement>('[data-testid="instructions-start"]')!.click();
  assert.equal(values.get(INSTRUCTIONS_STORAGE_KEY), "seen");

  const second = await startApp({
    mount: document.querySelector<HTMLElement>("#app")!,
    definition: branchPuzzle,
    localePack: esLocale,
    storage
  });
  assert.ok(second);
  assert.equal(second.view.instructionsDialog.hasAttribute("open"), false);
});

test("a newer date load interrupts a stale request before it can replace the puzzle", async () => {
  const { dom } = installAppDom();
  const first = definitionFor("2026-08-28");
  const slow = definitionFor("2026-08-29");
  const newest = definitionFor("2026-08-30");
  let slowAborted = false;
  let markSlowStarted: (() => void) | undefined;
  const slowStarted = new Promise<void>((resolve) => { markSlowStarted = resolve; });
  const app = await startDatedApp({
    mount: document.querySelector<HTMLElement>("#app")!,
    entries: [first, slow, newest].map((definition) => ({ date: definition.releaseDate!, definition })),
    initialDate: first.releaseDate!,
    defaultDate: first.releaseDate!,
    canAuthor: false,
    locale: esLocale,
    loadDefinition: (date, entry, signal) => {
      if (date !== slow.releaseDate) return Promise.resolve(entry.definition!);
      markSlowStarted?.();
      return new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => {
          slowAborted = true;
          reject(signal.reason);
        }, { once: true });
      });
    }
  });
  assert.ok(app);

  const initialSelector = document.querySelector<HTMLSelectElement>('[data-testid="date-selector"]')!;
  initialSelector.value = slow.releaseDate!;
  initialSelector.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  await slowStarted;
  initialSelector.value = newest.releaseDate!;
  initialSelector.dispatchEvent(new dom.window.Event("change", { bubbles: true }));

  await waitUntil(() => {
    const selector = document.querySelector<HTMLSelectElement>('[data-testid="date-selector"]');
    return selector !== initialSelector && selector?.value === newest.releaseDate;
  });
  assert.equal(slowAborted, true);
  assert.equal(new URL(location.href).searchParams.get("date"), newest.releaseDate);
  app.destroy();
});

test("a completed puzzle uses native sharing when it is available", async () => {
  const { dom } = installAppDom();
  const shared: ShareData[] = [];
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { share: async (value: ShareData) => { shared.push(value); } }
  });
  try {
    const app = await startApp({ mount: document.querySelector<HTMLElement>("#app")!, definition: branchPuzzle, localePack: esLocale });
    assert.ok(app);
    for (const answer of ["lib", "libro", "cielo", "azul", "libro azul"]) {
      app.view.input.value = answer;
      app.view.form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    }
    app.view.shareButton.click();
    await Promise.resolve();

    assert.equal(shared.length, 1);
    assert.match(shared[0]!.text ?? "", /100\/100 puntos/u);
    assert.match(shared[0]!.text ?? "", /\?date=2026-08-28/u);
    assert.doesNotMatch(shared[0]!.text ?? "", /El libro azul/u);
  } finally {
    if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
    else delete (globalThis as { navigator?: Navigator }).navigator;
  }
});

test("a completed puzzle copies the share card when native sharing is unavailable", async () => {
  const { dom } = installAppDom();
  const copied: string[] = [];
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { clipboard: { writeText: async (value: string) => { copied.push(value); } } }
  });
  try {
    const app = await startApp({ mount: document.querySelector<HTMLElement>("#app")!, definition: branchPuzzle, localePack: esLocale });
    assert.ok(app);
    for (const answer of ["lib", "libro", "cielo", "azul", "libro azul"]) {
      app.view.input.value = answer;
      app.view.form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    }
    app.view.shareButton.click();
    await Promise.resolve();

    assert.equal(copied.length, 1);
    assert.equal(app.view.shareStatus.textContent, esLocale.ui.shareCopied);
  } finally {
    if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
    else delete (globalThis as { navigator?: Navigator }).navigator;
  }
});

test("a cancelled native share does not show an error", async () => {
  const { dom } = installAppDom();
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { share: async () => { throw new DOMException("Cancelled", "AbortError"); } }
  });
  try {
    const app = await startApp({ mount: document.querySelector<HTMLElement>("#app")!, definition: branchPuzzle, localePack: esLocale });
    assert.ok(app);
    for (const answer of ["lib", "libro", "cielo", "azul", "libro azul"]) {
      app.view.input.value = answer;
      app.view.form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    }
    app.view.shareButton.click();
    await Promise.resolve();

    assert.equal(app.view.shareStatus.textContent, "");
  } finally {
    if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
    else delete (globalThis as { navigator?: Navigator }).navigator;
  }
});

test("a clipboard failure gives accessible share feedback", async () => {
  const { dom } = installAppDom();
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { clipboard: { writeText: async () => { throw new Error("Denied"); } } }
  });
  try {
    const app = await startApp({ mount: document.querySelector<HTMLElement>("#app")!, definition: branchPuzzle, localePack: esLocale });
    assert.ok(app);
    for (const answer of ["lib", "libro", "cielo", "azul", "libro azul"]) {
      app.view.input.value = answer;
      app.view.form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    }
    app.view.shareButton.click();
    await Promise.resolve();

    assert.equal(app.view.shareStatus.textContent, esLocale.ui.shareCopyFailed);
  } finally {
    if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
    else delete (globalThis as { navigator?: Navigator }).navigator;
  }
});
