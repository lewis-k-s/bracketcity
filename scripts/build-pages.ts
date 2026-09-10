import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Data, Effect } from "effect";
import { build } from "vite";
import { BRAND_NAME } from "../src/brand.ts";
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

interface PagesSupabaseConfig {
  readonly url: string;
  readonly publishableKey: string;
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
  title.textContent = ${JSON.stringify(BRAND_NAME)};
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
${errorPanelSource(JSON.stringify(`No se pudo identificar el cargador de ${BRAND_NAME}.`))}
    return;
  }
  var release = document.createElement("script");
  release.src = new URL("release.js?cache=" + Date.now(), loader.src).href;
  release.async = false;
  release.onerror = function () {
${errorPanelSource(JSON.stringify(`No se pudo cargar la versión publicada de ${BRAND_NAME}.`))}
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
${errorPanelSource(JSON.stringify(`No se pudo identificar la versión de ${BRAND_NAME}.`))}
    return;
  }
  var root = new URL("./", release.src);
  var style = document.createElement("link");
  style.rel = "stylesheet";
  style.href = new URL(${JSON.stringify(cssPath)}, root).href;
  style.onerror = function () {
${errorPanelSource(JSON.stringify(`No se pudieron cargar los estilos de ${BRAND_NAME}.`))}
  };
  document.head.appendChild(style);

  var locale = document.createElement("script");
  locale.src = new URL(${JSON.stringify(localePath)}, root).href;
  locale.async = false;
  locale.onerror = function () {
${errorPanelSource(JSON.stringify(`No se pudo cargar el idioma de ${BRAND_NAME}.`))}
  };
  locale.onload = function () {
    var app = document.createElement("script");
    app.type = "module";
    app.src = new URL(${JSON.stringify(appPath)}, root).href;
    app.async = false;
    app.onerror = function () {
${errorPanelSource(JSON.stringify(`No se pudo cargar la aplicación ${BRAND_NAME}.`))}
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

function jsonForHtml(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026");
}

export function readPagesSupabaseConfig(
  environment: Record<string, string | undefined> = process.env
): PagesSupabaseConfig | null {
  const projectRef = environment.SUPABASE_PROJECT_REF;
  const publishableKey = environment.SUPABASE_PUBLISHABLE_KEY;
  if (!projectRef && !publishableKey) return null;
  if (!projectRef || !/^[a-z0-9]{20}$/u.test(projectRef)) {
    throw new Error("SUPABASE_PROJECT_REF must be a 20-character project reference.");
  }
  if (!publishableKey?.startsWith("sb_publishable_")) {
    throw new Error("SUPABASE_PUBLISHABLE_KEY must be a publishable browser key.");
  }
  return {
    url: `https://${projectRef}.supabase.co`,
    publishableKey
  };
}

export function renderPagesIndex(
  revision = "local",
  supabaseConfig: PagesSupabaseConfig | null = null
): string {
  const safeRevision = escapeHtml(revision);
  const configElement = supabaseConfig
    ? `\n    <script id="nexo-supabase-config" type="application/json">${jsonForHtml(supabaseConfig)}</script>`
    : "";
  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta name="theme-color" content="#ffffff" />
    <meta
      name="description"
      content="Un juego multilingüe de pistas anidadas que se resuelve desde dentro hacia fuera."
    />
    <title>${BRAND_NAME} — Pistas anidadas</title>
  </head>
  <body class="nexo-standalone">
    <main id="app"></main>${configElement}
    <script src="./loader.js" data-release="${safeRevision}"></script>
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
  await Promise.all(["locales", "puzzles"].map((directory) => cp(
    resolve(projectRoot, directory),
    resolve(outputDirectory, directory),
    { recursive: true }
  )));
  await writeFile(
    resolve(outputDirectory, "index.html"),
    renderPagesIndex(revision, readPagesSupabaseConfig())
  );
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
