# Nexo

Nexo is a multilingual nested-clue game. The public player and puzzle editor
run on one WordPress Page. WordPress stores private puzzle posts and provides
the REST API. GitHub Pages hosts the versioned JavaScript, CSS, and locale
assets. Player progress stays in the WordPress origin's `localStorage`.

## Develop and test

Use a current Node.js release, npm, and WordPress Studio. Docker is required
only for the disposable WordPress integration test.

```sh
npm install
npm run dev              # local standalone Vite server
npm run studio:dev       # Studio mirror with live Nexo PHP and Vite assets
npm run build:pages      # create dist-pages/
npm run test:all         # unit, PHP, Pages, WordPress, and browser gates
npm run package:plugin   # create and install-test release/nexo-1.2.1.zip
npm run deploy:prepare   # build Pages and the installable bridge ZIP
```

The WordPress integration test uses disposable WordPress and MariaDB
containers. The Pages build produces stable `loader.js` and `release.js` files,
plus content-hashed application, CSS, and locale assets. It contains no puzzle
JSON.

For the Studio local-development and release workflow, see
[Local WordPress development](docs/local-wordpress.md).

## WordPress bridge

Plugin source is in `wordpress-plugin/`. The bridge registers the private
`bc_puzzle` post type, the `bracket-city/v1` REST routes, and this shortcode:

```text
[bracket_city asset_base="https://OWNER.github.io/REPOSITORY"]
```

The URL must use HTTPS. The shortcode loads the Pages `loader.js` in the
WordPress footer. Administrators and users with the **Nexo Puzzle Manager** role
can open the editor and save puzzles. Editors, Authors, and Subscribers cannot.
Public REST routes expose only puzzles released at midnight in
`Europe/Madrid`.

The plugin creates a private collaborator link when it is activated. Open the
authenticated editor and use **Proponer Nexo** to get it.
Anyone with this high-entropy link can build and submit a suggestion, with or
without a preferred date. Suggestions stay as pending WordPress posts. They do
not appear in the player or dated catalog. A Puzzle Manager can load them in
the editor, revise them, assign a date, and approve or reject them. Treat the
link as a shared secret. Valid suggestion pages send a `Referrer-Policy:
no-referrer` header so the key is not sent to other sites.

The public application loads the player code only. WordPress checks the
requested mode before the browser loads the separate authoring module. The
player, editor, and suggestion form still use the same stylesheet and responsive
breakpoints.

Authenticated editors can manage the catalog through these REST endpoints:

```text
GET    /wp-json/bracket-city/v1/admin/puzzles
GET    /wp-json/bracket-city/v1/admin/puzzles/YYYY-MM-DD
POST   /wp-json/bracket-city/v1/puzzles
PUT    /wp-json/bracket-city/v1/puzzles/YYYY-MM-DD
DELETE /wp-json/bracket-city/v1/puzzles/YYYY-MM-DD
GET    /wp-json/bracket-city/v1/admin/puzzles/trash
GET    /wp-json/bracket-city/v1/admin/puzzles/trash/YYYY-MM-DD
POST   /wp-json/bracket-city/v1/admin/puzzles/trash/YYYY-MM-DD
POST   /wp-json/bracket-city/v1/suggestions
GET    /wp-json/bracket-city/v1/admin/suggestions
GET    /wp-json/bracket-city/v1/admin/suggestions/ID
POST   /wp-json/bracket-city/v1/admin/suggestions/ID/approve
DELETE /wp-json/bracket-city/v1/admin/suggestions/ID
```

`DELETE` moves a puzzle to WordPress Trash. It disappears from the active
catalog and can be restored with the final `POST` endpoint. A trashed bundled
seed is not imported again when the plugin is reactivated.

The editor shows **Move to Trash** only after a stored puzzle is loaded. The
same screen offers an immediate undo. A daily WordPress event permanently
deletes Nexo Trash after 30 days. This uses WordPress storage APIs, so it works
with Studio's SQLite mirror and the production MySQL database.

The first release accepts at most 1,000 published and pending puzzles in total.
Trash does not consume capacity. At the limit, new admin puzzles and shared-link
suggestions return `nexo_puzzle_limit`; corrections, review, deletion, and
rejection remain available. `NEXO_MAX_PUZZLES` and
`NEXO_TRASH_RETENTION_DAYS` can override the release defaults in `wp-config.php`.
WordPress's global `EMPTY_TRASH_DAYS` setting can still remove Trash sooner.

The installable ZIP contains only the PHP bridge and bootstrap seeds:

```text
bracket-city/
  nexo.php
  includes/
  seed/YYYY-MM-DD-es.json
```

The dated files in `puzzles/` are activation seeds and regression fixtures.
Activation imports a seed only when no active or trashed puzzle has its date,
and never replaces WordPress data.
Create all future puzzles through the authenticated builder or REST API.

## Deploy

Run `npm run deploy:prepare` before release. It builds the Pages artifact and
the installable bridge ZIP without publishing either one.

Push to `main` to run all gates and deploy `dist-pages/` through GitHub Pages.
CI also uploads the bridge ZIP as a workflow artifact, but WordPress.com
Personal requires manual plugin upload. No WordPress credential is stored in
GitHub. See [GitHub Pages deployment](docs/continuous-integration.md) for setup,
credential, rollout, and rollback details.

The portable puzzle shape is described by `puzzles/schema-v1.json`. Validators
also enforce graph reachability, unique ownership, no cycles, normalized answer
uniqueness, and exact final expansion.
