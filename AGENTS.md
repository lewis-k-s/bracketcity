# Repository Guidelines

## Project Structure & Module Organization

The browser game is in `src/`: `engine.ts` validates and evaluates puzzles,
while `view.ts`, `app.ts`, and the author modules render the public and creator
interfaces. Static runtime data is in `puzzles/` and `locales/`; keep puzzle
definitions valid against `puzzles/schema-v1.json`.

The WordPress bridge is in `wordpress-plugin/`. Its PHP entry point is
`nexo.php`, with shortcode, capability, REST, storage, and validation classes
in `wordpress-plugin/includes/`. The Pages build writes external frontend
assets to `dist-pages/`. The plugin ZIP contains only PHP and bootstrap seeds.
Do not edit generated `dist/`, `dist-pages/`, or `release/` files.

Tests live in `tests/`. Unit tests use `tests/*.test.ts`, end-to-end browser
tests use `tests/e2e/*.spec.ts`, and PHP/WordPress checks live in `tests/php/`.

## Build, Test, and Development Commands

```sh
npm install                 # install Node dependencies
npm run dev                 # start Vite locally
npm run test:unit           # run Node unit tests
npm run test:php            # lint and run PHP contract tests
npm run test:wordpress      # run disposable WordPress + MariaDB integration tests
npm run test:e2e            # run Playwright browser and accessibility tests
npm run build:pages         # create the GitHub Pages frontend artifact
npm run package:plugin      # run release gates and create release/nexo-<version>.zip
```

Run `npm run test:all` before a release. The WordPress test uses Docker and
removes its containers and volumes after completion.

## Coding Style & Naming Conventions

Use ES modules, two-space indentation, semicolons, double-quoted JavaScript
strings, and `camelCase` for functions and variables. Name Node tests
`*.test.ts` and Playwright tests `*.spec.ts`. Use `Nexo_`-prefixed PHP classes,
WordPress coding style (tabs for indentation), and snake_case for WordPress
hooks and data keys. Keep puzzle filenames date-based, for example
`puzzles/2026-08-31-es.json`.

Preserve security boundaries: validate untrusted puzzle JSON, do not render raw
HTML from puzzle content, require `manage_nexo_puzzles` for writes, and retain
the `Europe/Madrid` release rule. Do not add WordPress secrets or puzzle
publishing to GitHub CI.

## Commit & Pull Request Guidelines

Write short, imperative commit subjects that describe one change, such as
`Add puzzle creator and dated catalog`. Keep commits focused and do not include
generated build or ZIP outputs. In pull requests, state the user-visible
effect, list validation commands run, link the issue when applicable, and add
screenshots for interface changes. Call out any puzzle-data migration, REST
contract, or WordPress release-gating change explicitly.
