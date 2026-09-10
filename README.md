# Entre Paréntesis

Entre Paréntesis is a multilingual nested-clue game. The public GitHub Pages player reads
released puzzles from Supabase when the Pages build has its public Supabase
configuration. The Mudlarker WordPress page embeds the same Pages bundle and
reads the same Supabase database. Player progress stays in each site's
`localStorage`.

The browser brand is set in `src/brand.ts`. The WordPress bridge uses
`NEXO_BRAND_NAME`, which a host can define before the plugin loads. The legacy
`nexo` technical identifiers remain stable for installed sites and stored data.

## Develop and test

Use a current Node.js release and npm. Docker is required only when you run the
legacy WordPress checks.

```sh
npm install
npm run dev              # local standalone Vite server
npm run build:pages      # create dist-pages/
npm run test:all         # unit, Pages, and browser release gates
npm run deploy:prepare   # build the Pages artifact
npm run test:legacy-wordpress # optional archived PHP bridge checks
```

The Pages build produces stable `loader.js` and `release.js` files, plus
content-hashed application, CSS, and locale assets. Bundled puzzle JSON is kept
only as an unconfigured local fallback.

For the Studio local-development and release workflow, see
[Local WordPress development](docs/local-wordpress.md).

## Legacy WordPress bridge

The PHP bridge is deprecated. Production play and creation use Supabase. Keep
the bridge source only for rollback, data migration, and historical tests. Do
not package or upload a new plugin during the normal release workflow.

Plugin source is in `wordpress-plugin/`. The bridge registers the private
`bc_puzzle` post type, the `bracket-city/v1` REST routes, and this shortcode:

```text
[bracket_city asset_base="https://OWNER.github.io/REPOSITORY"]
```

The URL must use HTTPS. The shortcode loads the Pages `loader.js` in the
WordPress footer. Administrators and users with the **Entre Paréntesis Puzzle Manager** role
can open the editor and save puzzles. Editors, Authors, and Subscribers cannot.
Public REST routes expose only puzzles released at midnight in
`Europe/Madrid`.

The plugin creates a private collaborator link when it is activated. Open the
authenticated editor and use **Proponer Entre Paréntesis** to get it.
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
deletes Entre Paréntesis Trash after 30 days. This uses WordPress storage APIs, so it works
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

## Embed on Mudlarker

Use a Custom HTML block on the WordPress page. The publishable key is public;
database policies limit it to released puzzle reads. Omitting
`authorModeEnabled` makes this a player-only surface.

```html
<script id="nexo-supabase-config" type="application/json">
  {"url":"https://PROJECT.supabase.co","publishableKey":"PUBLISHABLE_KEY"}
</script>
<div id="bracket-city-app"></div>
<script src="https://entre-parentesis.es/loader.js"></script>
```

## Deploy

Run `npm run deploy:prepare` before release. It builds the Pages artifact
without publishing it.

Push to `main` to run all gates and deploy `dist-pages/` through GitHub Pages.
No WordPress credential is stored in GitHub. See
[GitHub Pages deployment](docs/continuous-integration.md) for setup, credential,
rollout, and rollback details.

## Supabase puzzle migration

The migration in `supabase/migrations/` creates the public puzzle table and a
read-only policy. Anonymous clients can read only published puzzles whose
release date has started in `Europe/Madrid`. Browser clients cannot insert,
update, or delete rows.

Use the public WordPress page or REST URL to validate released puzzles without
writing them:

```sh
npm run migrate:wordpress -- https://BLOG.example/puzzles/
```

Add `--apply` to import them into the linked Supabase project. The import is
transactional and does not replace a row with an older revision. If several
WordPress dates reuse one internal puzzle ID, the importer adds the release
date to those IDs so browser progress remains separate.

The public WordPress API does not expose future or trashed puzzles. Move those
records through an authenticated export if they are needed.

The portable puzzle shape is described by `puzzles/schema-v1.json`. Validators
also enforce graph reachability, unique ownership, no cycles, normalized answer
uniqueness, and exact final expansion.

## Supabase puzzle management

Open `/?mode=author` on the dedicated domain to use the invite-only puzzle
manager. Supabase issues an access token only when the user exists in
`private.puzzle_managers`. The browser sends that token to the `puzzle-admin`
Edge Function, which checks the same table again on every request. It then runs
the full TypeScript puzzle validator and uses service-only database functions
for save, Trash, and restore operations. Anonymous and ordinary authenticated
users cannot write to the puzzle table.

Before first use, configure the hosted Supabase project:

1. In **Authentication → URL Configuration**, set the site URL to
   `https://entre-parentesis.es/` and allow redirects under
   `https://entre-parentesis.es/**`.
2. Disable new-user signup. Keep anonymous sign-in disabled.
3. In **Authentication → Users**, invite the manager by email.
4. Copy that user's UUID and add it in the SQL editor:

   ```sql
   insert into private.puzzle_managers (user_id)
   values ('USER-UUID');
   ```

Delete the allowlist row to revoke puzzle-management access. The Edge Function
checks membership on every request, so this does not depend on a cached role in
the user's token. Do not put the service-role key, a manager UUID, or an email
allowlist in the Pages build. For another Pages origin, add its exact origin to
the Edge Function secret `NEXO_ADMIN_ORIGINS` as a comma-separated value.
