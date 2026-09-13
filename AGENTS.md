# Repository Guidelines

## Project Structure & Module Organization

The browser game is in `src/`: `engine.ts` validates and evaluates puzzles,
while `view.ts`, `app.ts`, and the author modules render the public and creator
interfaces. Static runtime data is in `puzzles/` and `locales/`; keep puzzle
definitions valid against `puzzles/schema-v1.json`.

`docs/puzzle-mechanism.md` is the authoritative guide for clue and answer
semantics, modo paréntesis syntax, direction rules, composition patterns, and
authoring examples. Keep detailed puzzle-authoring guidance in that file. Link
to it from other documentation instead of repeating it.

Production and the Mudlarker embed use the GitHub Pages bundle with Supabase.
The WordPress page uses a Custom HTML embed and does not use a plugin or the
WordPress database. The Pages build writes frontend assets to `dist-pages/`.
Do not edit generated `dist/` or `dist-pages/` files.

Tests live in `tests/`. Unit tests use `tests/*.test.ts`, and end-to-end browser
tests use `tests/e2e/*.spec.ts`.

## Build, Test, and Development Commands

```sh
npm install                 # install Node dependencies
npm run dev                 # start Vite locally
npm run test:unit           # run Node unit tests
npm run test:e2e            # run Playwright browser and accessibility tests
npm run build:pages         # create the GitHub Pages frontend artifact
```

Run `npm run test:all` before a release.

## Coding Style & Naming Conventions

Use ES modules, two-space indentation, semicolons, double-quoted JavaScript
strings, and `camelCase` for functions and variables. Name Node tests
`*.test.ts` and Playwright tests `*.spec.ts`. Keep puzzle filenames date-based, for example
`puzzles/2026-08-31-es.json`.

Preserve security boundaries: validate untrusted puzzle JSON, do not render raw
HTML from puzzle content, require the Supabase manager allowlist for writes,
keep the Mudlarker embed player-only, and retain the `Europe/Madrid` release
rule. Do not add service-role secrets to frontend builds.

## Commit & Pull Request Guidelines

Write short, imperative commit subjects that describe one change, such as
`Add puzzle creator and dated catalog`. Keep commits focused and do not include
generated build or ZIP outputs. In pull requests, state the user-visible
effect, list validation commands run, link the issue when applicable, and add
screenshots for interface changes. Call out any puzzle-data migration or
Supabase contract change explicitly.
