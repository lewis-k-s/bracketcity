# Repository Guidelines

## Project Structure & Module Organization

The browser game is in `src/`: `engine.ts` validates and evaluates puzzles,
while `view.ts`, `app.ts`, and the author modules render the public and creator
interfaces. Static runtime data is in `puzzles/` and `locales/`; keep puzzle
definitions valid against `puzzles/schema-v1.json`.

The deprecated WordPress bridge is in `wordpress-plugin/`. Keep it only for
rollback, migration, and historical tests. Production and the Mudlarker embed
use the GitHub Pages bundle with Supabase. The Pages build writes frontend
assets to `dist-pages/`. Do not edit generated `dist/`, `dist-pages/`, or
`release/` files.

Tests live in `tests/`. Unit tests use `tests/*.test.ts`, end-to-end browser
tests use `tests/e2e/*.spec.ts`, and PHP/WordPress checks live in `tests/php/`.

## Build, Test, and Development Commands

```sh
npm install                 # install Node dependencies
npm run dev                 # start Vite locally
npm run test:unit           # run Node unit tests
npm run test:e2e            # run Playwright browser and accessibility tests
npm run build:pages         # create the GitHub Pages frontend artifact
npm run test:legacy-wordpress # optional archived PHP and WordPress checks
```

Run `npm run test:all` before a release.

## Coding Style & Naming Conventions

Use ES modules, two-space indentation, semicolons, double-quoted JavaScript
strings, and `camelCase` for functions and variables. Name Node tests
`*.test.ts` and Playwright tests `*.spec.ts`. Use `Nexo_`-prefixed PHP classes,
WordPress coding style (tabs for indentation), and snake_case for WordPress
hooks and data keys. Keep puzzle filenames date-based, for example
`puzzles/2026-08-31-es.json`.

Preserve security boundaries: validate untrusted puzzle JSON, do not render raw
HTML from puzzle content, require the Supabase manager allowlist for writes,
keep the Mudlarker embed player-only, and retain the `Europe/Madrid` release
rule. Do not add service-role or WordPress secrets to frontend builds.

## Commit & Pull Request Guidelines

Write short, imperative commit subjects that describe one change, such as
`Add puzzle creator and dated catalog`. Keep commits focused and do not include
generated build or ZIP outputs. In pull requests, state the user-visible
effect, list validation commands run, link the issue when applicable, and add
screenshots for interface changes. Call out any puzzle-data migration, REST
contract, or WordPress release-gating change explicitly.
