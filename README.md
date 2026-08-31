# Nexo

Nexo is a multilingual nested-clue word game. The public game is a Vite application packaged as a WordPress plugin. WordPress stores one private puzzle post per release date. Player progress stays in the browser.

## Front-end development

Requirements: a current Node.js release and npm.

```sh
npm install
npm run dev
```

Vite continues to serve the local puzzle and locale files, so the existing game and browser tests work without WordPress. Opening `index.html` through `file://` is not supported.

Use these checks before release:

```sh
npm run test:unit
npm run test:php
npm run test:wordpress
npm run test:e2e
npm run build
```

The PHP gate uses a local `php` executable when one is available. Otherwise, it uses the pinned `php:8.3-cli` Docker image with the repository mounted read-only. The WordPress integration gate starts disposable WordPress and MariaDB containers. Packaging fails if the required PHP and WordPress checks cannot run.

The production build uses content-hashed JavaScript and CSS filenames. Vite writes its asset map to `dist/.vite/manifest.json`.

## WordPress development

The plugin source is in `wordpress-plugin/`. It registers the `[bracket_city]` shortcode and the private `bc_puzzle` post type. The shortcode loads the built application only on pages that contain it.

Use a disposable local WordPress installation to test activation, REST permissions, puzzle creation, correction, release gating, and rendering. WordPress.com Personal does not provide a staging environment, SFTP, SSH, or direct database access. Do not use a production WordPress.com site as the first activation test.

The canonical puzzle timezone is `Europe/Madrid`. A puzzle becomes public at 00:00 on its release date in that timezone. Future puzzles remain available only through authenticated creator routes.

## Build the upload ZIP

```sh
npm run package:plugin
```

This command runs the unit and PHP tests, builds the Vite application, stages the WordPress plugin, verifies required files, and writes `release/nexo-<version>.zip`. It then installs that exact ZIP in a clean disposable WordPress environment and runs the REST, role, revision, seed, and shortcode integration tests. The version comes from `package.json`.

The ZIP contains one installable `bracket-city/` directory:

```text
bracket-city/
  nexo.php
  includes/
  build/
    .vite/manifest.json
    assets/
    locales/
  seed/
    YYYY-MM-DD-es.json
```

Only dated production puzzles become activation seeds. Demo, schema, and static manifest files are not included as seeds. Activation inserts a missing date but never replaces a puzzle that is already stored in WordPress.

To check a previously built staging layout without running tests or writing a ZIP:

```sh
npm run build
npm run package:verify
```

## WordPress.com deployment

1. Keep the previous working ZIP as the rollback package.
2. In WordPress.com, open **Plugins**, upload the new versioned ZIP, and activate it.
3. Create or edit the Nexo page and add `[bracket_city]`.
4. Test the current puzzle, the date selector, and an authenticated creator save.
5. Test the page on an actual iPhone before announcing the release.

No separate CDN is configured. WordPress.com manages its own asset delivery and caching. Puzzle posts and browser progress are not deleted when the plugin is deactivated or upgraded. To roll back application code, upload and activate the retained previous ZIP; do not delete puzzle posts.

## Game data and state

The existing `PuzzleDefinition` JSON is the transport and storage format. Canonical answers remain in puzzle data because solved answers must be inserted into parent clues. Public REST routes expose only released puzzles. Editors and administrators can save and preview future puzzles.

Player progress uses `nested-clue:v3:<puzzle-id>:<revision>` in `localStorage`. Creator drafts also remain local until they are saved through authenticated WordPress REST routes. Clearing browser site data removes local progress, but it does not remove WordPress puzzle posts.

The `puzzles/schema-v1.json` file describes the portable data shape. The validators also enforce graph invariants that JSON Schema cannot express, including valid references, one parent per clue, no cycles, complete reachability, normalized-answer uniqueness, and exact final expansion.
