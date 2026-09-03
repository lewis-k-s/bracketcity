import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Data, Effect } from "effect";
import { build } from "vite";
import type { LocalePack } from "../src/types.ts";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = resolve(projectRoot, "dist-pages");

interface PagesAssets {
  readonly appPath: string;
  readonly cssPath: string;
  readonly localePath: string;
}

interface PagesBuildResult extends PagesAssets {
  readonly outputDirectory: string;
}

interface ManifestEntry {
  readonly file?: string;
  readonly isEntry?: boolean;
}

export class PagesBuildError extends Data.TaggedError("PagesBuildError")<{
  readonly message: string;
  readonly cause: unknown;
}> {}

function errorPanelSource(messageExpression: string): string {
  return `
  var mount = document.getElementById("bracket-city-app") || document.getElementById("app");
  if (!mount) return;
  var panel = document.createElement("section");
  panel.className = "fatal-panel";
  panel.setAttribute("role", "alert");
  var title = document.createElement("h1");
  title.textContent = "Nexo";
  var body = document.createElement("p");
  body.textContent = ${messageExpression};
  panel.append(title, body);
  mount.replaceChildren(panel);`;
}

export function renderPagesLoader(): string {
  return `(function () {
  "use strict";
  if (globalThis.__NEXO_LOADER_STARTED__) return;
  globalThis.__NEXO_LOADER_STARTED__ = true;
  var loader = document.currentScript;
  if (!loader || !loader.src) {
${errorPanelSource('"No se pudo identificar el cargador de Nexo."')}
    return;
  }
  var release = document.createElement("script");
  release.src = new URL("release.js?cache=" + Date.now(), loader.src).href;
  release.async = false;
  release.onerror = function () {
${errorPanelSource('"No se pudo cargar la versión publicada de Nexo."')}
  };
  document.head.appendChild(release);
})();
`;
}

export function renderPagesRelease({ appPath, cssPath, localePath }: PagesAssets): string {
  for (const [name, value] of Object.entries({ appPath, cssPath, localePath })) {
    if (typeof value !== "string" || !value.startsWith("assets/") || value.includes("..")) {
      throw new Error(`${name} must be a safe Pages asset path.`);
    }
  }
  return `(function () {
  "use strict";
  var release = document.currentScript;
  if (!release || !release.src) {
${errorPanelSource('"No se pudo identificar la versión de Nexo."')}
    return;
  }
  var root = new URL("./", release.src);
  var style = document.createElement("link");
  style.rel = "stylesheet";
  style.href = new URL(${JSON.stringify(cssPath)}, root).href;
  style.onerror = function () {
${errorPanelSource('"No se pudieron cargar los estilos de Nexo."')}
  };
  document.head.appendChild(style);

  var locale = document.createElement("script");
  locale.src = new URL(${JSON.stringify(localePath)}, root).href;
  locale.async = false;
  locale.onerror = function () {
${errorPanelSource('"No se pudo cargar el idioma de Nexo."')}
  };
  locale.onload = function () {
    var app = document.createElement("script");
    app.type = "module";
    app.src = new URL(${JSON.stringify(appPath)}, root).href;
    app.async = false;
    app.onerror = function () {
${errorPanelSource('"No se pudo cargar la aplicación Nexo."')}
    };
    document.body.appendChild(app);
  };
  document.head.appendChild(locale);
})();
`;
}

function localeJavaScript(locale: LocalePack): string {
  return `globalThis.__NEXO_LOCALE_PACK__ = ${JSON.stringify(locale)};\n`;
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function renderPagesIndex(revision = "local"): string {
  const safeRevision = escapeHtml(revision);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Nexo asset host</title>
  </head>
  <body>
    <main>
      <h1>Nexo asset host</h1>
      <p>The game runs on its WordPress page.</p>
      <p>Release: <code>${safeRevision}</code></p>
    </main>
  </body>
</html>
`;
}

export async function buildPagesRelease({ revision = process.env.GITHUB_SHA ?? "local" }: {
  readonly revision?: string;
} = {}): Promise<PagesBuildResult> {
  await build({ configFile: resolve(projectRoot, "vite.pages.config.ts") });
  const manifestPath = resolve(outputDirectory, ".vite", "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, ManifestEntry>;
  const entry = Object.values(manifest).find((candidate) => candidate?.isEntry);
  const cssAssets = Object.values(manifest)
    .map((candidate) => candidate?.file)
    .filter((file) => typeof file === "string" && file.endsWith(".css"));
  if (!entry?.file || cssAssets.length !== 1) {
    throw new Error("The Pages build must contain one JavaScript entry and one CSS asset.");
  }

  const locale = JSON.parse(await readFile(resolve(projectRoot, "locales", "es-ES.json"), "utf8")) as LocalePack;
  const localeSource = localeJavaScript(locale);
  const localePath = `assets/es-ES-${shortHash(localeSource)}.js`;
  await mkdir(resolve(outputDirectory, "assets"), { recursive: true });
  await writeFile(resolve(outputDirectory, localePath), localeSource);
  await writeFile(resolve(outputDirectory, "loader.js"), renderPagesLoader());
  await writeFile(resolve(outputDirectory, "release.js"), renderPagesRelease({
    appPath: entry.file,
    cssPath: cssAssets[0]!,
    localePath
  }));
  await writeFile(resolve(outputDirectory, "index.html"), renderPagesIndex(revision));
  await writeFile(resolve(outputDirectory, ".nojekyll"), "");
  await rm(resolve(outputDirectory, ".vite"), { recursive: true, force: true });

  return { outputDirectory, appPath: entry.file, cssPath: cssAssets[0]!, localePath };
}

export function buildPagesReleaseEffect(options: { readonly revision?: string } = {}): Effect.Effect<PagesBuildResult, PagesBuildError> {
  return Effect.tryPromise({
    try: () => buildPagesRelease(options),
    catch: (cause) => new PagesBuildError({
      message: cause instanceof Error ? cause.message : String(cause),
      cause
    })
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  Effect.runPromise(buildPagesReleaseEffect()).then((result) => {
    console.log(`Built GitHub Pages release in ${result.outputDirectory}`);
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
