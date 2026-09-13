# Entre Paréntesis

Entre Paréntesis is a multilingual nested-clue game. The public GitHub Pages
player and the Mudlarker blog embed read released puzzles from Supabase. Player
progress stays in each site's `localStorage`.

The browser brand is set in `src/brand.ts`. The stable `nexo` technical
identifiers are used by the frontend and Supabase deployment.

## Develop and test

Use a current Node.js release and npm.

```sh
npm install
npm run dev              # local standalone Vite server
npm run build:pages      # create dist-pages/
npm run test:all         # unit, Pages, and browser release gates
npm run deploy:prepare   # build the Pages artifact
```

The Pages build produces stable `loader.js` and `release.js` files, plus
content-hashed application, CSS, and locale assets. Bundled puzzle JSON is an
unconfigured local fallback only.

For clue types, nesting rules, modo paréntesis syntax, and short authoring
examples, see [Puzzle mechanism and examples](docs/puzzle-mechanism.md). This
is the authoritative guide for the clue and answer system.

## Embed on Mudlarker

Use a Custom HTML block on the WordPress page. No plugin, shortcode, REST
route, or WordPress database access is required. The publishable key is public;
database policies limit it to released puzzle reads. The embed is player-only:
omit `authorModeEnabled`.

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
See [GitHub Pages deployment](docs/continuous-integration.md) for setup,
rollout, and rollback details.

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
