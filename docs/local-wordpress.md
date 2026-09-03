# Local WordPress development

Use WordPress Studio as the local Mudlarker site. It includes the
production database, theme, uploads, plugins, pages, and Site Editor records.
GitHub Pages serves the released browser assets. Docker remains only in
`npm run test:wordpress`, where it supplies a disposable automated test site.

## Studio local development

The Mac site is already connected to `mudlarker.org`. Its files are in
`/Volumes/HUBSSD/code/mudlarker/wordpress`. Studio records its original path,
`/Users/lewis/Studio/mudlarker`, which is a compatibility symlink to the
HUBSSD directory. Keep that symlink in place.

Run this from the Nexo repository:

```sh
npm run studio:dev
```

It starts the Studio site, saves the pulled Nexo plugin as
`wp-content/plugins/bracket-city.studio-sync`, links the active local plugin to
this repository's `wordpress-plugin/`, and starts Vite at
`http://127.0.0.1:4176/`. Open `http://localhost:8881/puzzles/`.

PHP changes reload from the linked source. Browser changes reload from Vite.
The local-only must-use plugin sets the local environment and asset URL; it is
not part of the production plugin ZIP. The link command enables Studio's
local **All files** PHP access because the Nexo source is a separate repository.
The restore command changes it back to **Site directory**.

Other commands:

```sh
npm run studio:link             # link the local plugin without starting Vite
npm run studio:start            # link the plugin and start Studio
npm run studio:status           # show Studio status
npm run studio:restore-plugin   # restore the pulled plugin before a plugin pull
```

Use Pull to refresh the local mirror. Do not push the database to production as
part of a plugin release. A database push replaces the whole remote database.
While the local plugin link is active, exclude **Plugins** from a Studio Pull.
Otherwise Studio could replace the link or write into the Nexo source tree. Run
`npm run studio:restore-plugin` before a pull that includes plugins, then run
`npm run studio:link` again.

## Deployment

```sh
npm run deploy:prepare
```

This builds `dist-pages/` and an installable Nexo ZIP in `release/`. Commit and
push the reviewed change to `main`; GitHub Actions deploys Pages. Upload the
ZIP in WordPress.com as the single release UI step. Do not use Studio Push for
this release path.

The Studio mirror uses `/Volumes/HUBSSD/code/mudlarker/wordpress`. When it is
put under version control, that is the WordPress repository path. The Nexo
repository will later move to `/Volumes/HUBSSD/code/mudlarker/nexo`. They have
separate release paths. Studio Sync manages the WordPress mirror; the Nexo
repository keeps its plugin and frontend deployment workflow.
