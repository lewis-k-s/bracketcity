import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

import type { PuzzleDefinition } from "../src/types.ts";
import { branchPuzzle, esLocale } from "./fixtures.ts";
import { installDomWindow } from "./test-dom.ts";

globalThis.__NEXO_DISABLE_AUTO_START__ = true;
installAppDom();
const { startDatedApp } = await import("../src/app.ts");

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
