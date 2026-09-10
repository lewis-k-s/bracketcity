import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import {
  renderPagesIndex,
  renderPagesLoader,
  renderPagesRelease,
  readPagesSupabaseConfig
} from "../../scripts/build-pages.ts";
import { renderWordPressDevLoader } from "../../scripts/local-wordpress-loader.ts";

const projectRoot = resolve(import.meta.dirname, "../..");
const pagesDirectory = resolve(projectRoot, "dist-pages");

function browserDocument(currentScriptUrl: string): JSDOM {
  const dom = new JSDOM('<!doctype html><div id="bracket-city-app"></div>', {
    runScripts: "outside-only",
    url: "https://example.wordpress.com/nexo/"
  });
  Object.defineProperty(dom.window.document, "currentScript", {
    configurable: true,
    value: { src: currentScriptUrl }
  });
  return dom;
}

async function listFiles(directory: string, prefix = ""): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await listFiles(resolve(directory, entry.name), name));
    else files.push(name);
  }
  return files.sort();
}

test("loader resolves release.js from its own URL and reports a failure", () => {
  const dom = browserDocument("https://owner.github.io/bracketcity/loader.js");
  dom.window.eval(renderPagesLoader());
  const release = dom.window.document.head.querySelector<HTMLScriptElement>('script[src*="release.js"]');
  assert.ok(release);
  assert.match(release.src, /^https:\/\/owner\.github\.io\/bracketcity\/release\.js\?cache=\d+$/);
  assert.equal(release.async, false);

  release.dispatchEvent(new dom.window.Event("error"));
  assert.match(dom.window.document.getElementById("bracket-city-app")!.textContent, /versión publicada/);
});

test("local WordPress loader starts the Vite module from its own origin", () => {
  const dom = browserDocument("http://127.0.0.1:4176/loader.js");
  dom.window.eval(renderWordPressDevLoader({ id: "es-ES" }));
  const application = dom.window.document.head.querySelector<HTMLScriptElement>('script[type="module"]');
  assert.ok(application);
  assert.equal(application.src, "http://127.0.0.1:4176/src/pages-entry.ts");
  assert.equal(JSON.stringify(dom.window.__NEXO_LOCALE_PACK__), '{"id":"es-ES"}');
});

test("release injects hashed CSS, locale, and module application scripts", () => {
  const dom = browserDocument("https://owner.github.io/bracketcity/release.js?cache=1");
  dom.window.eval(renderPagesRelease({
    appPath: "assets/nexo-abc123.js",
    cssPath: "assets/nexo-def456.css",
    localePath: "assets/es-ES-ghi789.js"
  }));

  assert.equal(
    dom.window.document.head.querySelector<HTMLLinkElement>("link[rel=stylesheet]")!.href,
    "https://owner.github.io/bracketcity/assets/nexo-def456.css"
  );
  const locale = dom.window.document.head.querySelector<HTMLScriptElement>('script[src*="es-ES-"]')!;
  assert.equal(locale.src, "https://owner.github.io/bracketcity/assets/es-ES-ghi789.js");
  locale.dispatchEvent(new dom.window.Event("load"));
  const app = dom.window.document.body.querySelector<HTMLScriptElement>('script[src*="nexo-abc123.js"]');
  assert.ok(app);
  assert.equal(app.type, "module");
  assert.equal(app.async, false);
  app.dispatchEvent(new dom.window.Event("error"));
  assert.match(dom.window.document.getElementById("bracket-city-app")!.textContent, /aplicación Entre Paréntesis/);
});

test("release rejects unsafe generated asset paths", () => {
  assert.throws(() => renderPagesRelease({
    appPath: "../puzzle.json",
    cssPath: "assets/nexo.css",
    localePath: "assets/es-ES.js"
  }), /safe Pages asset path/);
});

test("standalone page mounts the game and escapes its revision", () => {
  const html = renderPagesIndex('<script>alert("x")</script>');
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
  assert.match(html, /<main id="app"><\/main>/);
  assert.match(html, /<script src="\.\/loader\.js"/);
});

test("standalone page embeds only a validated Supabase browser configuration", () => {
  const config = readPagesSupabaseConfig({
    SUPABASE_PROJECT_REF: "abcdefghijklmnopqrst",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_public-key"
  });
  const html = renderPagesIndex("revision", config);
  assert.match(html, /id="nexo-supabase-config"/u);
  assert.match(html, /https:\/\/abcdefghijklmnopqrst\.supabase\.co/u);
  assert.match(html, /sb_publishable_public-key/u);
  assert.throws(() => readPagesSupabaseConfig({
    SUPABASE_PROJECT_REF: "abcdefghijklmnopqrst",
    SUPABASE_PUBLISHABLE_KEY: "sb_secret_private-key"
  }), /publishable browser key/u);
});

test("Pages artifact contains a standalone game and stable WordPress loader assets", async () => {
  const files = await listFiles(pagesDirectory);
  assert.ok(files.includes(".nojekyll"));
  assert.ok(files.includes("index.html"));
  assert.ok(files.includes("loader.js"));
  assert.ok(files.includes("release.js"));
  assert.equal(files.filter((name) => /^assets\/nexo-[\w-]+\.js$/.test(name)).length, 1);
  assert.equal(files.filter((name) => /^assets\/author-view-[\w-]+\.js$/.test(name)).length, 1);
  assert.equal(files.filter((name) => /^assets\/nexo-[\w-]+\.css$/.test(name)).length, 1);
  assert.equal(files.filter((name) => /^assets\/es-ES-[a-f0-9]+\.js$/.test(name)).length, 1);
  assert.ok(files.includes("locales/es-ES.json"));
  assert.ok(files.includes("puzzles/manifest.json"));
  assert.ok(files.includes("puzzles/schema-v1.json"));
  assert.ok(files.includes("puzzles/2026-08-30-es.json"));

  const appName = files.find((name) => /^assets\/nexo-[\w-]+\.js$/.test(name));
  const app = await readFile(resolve(pagesDirectory, appName!), "utf8");
  assert.match(app, /\bimport\s*\(/);
  assert.doesNotMatch(app, /author-publish/u);
  const authorName = files.find((name) => /^assets\/author-view-[\w-]+\.js$/.test(name));
  const author = await readFile(resolve(pagesDirectory, authorName!), "utf8");
  assert.match(author, /author-publish/u);
});
