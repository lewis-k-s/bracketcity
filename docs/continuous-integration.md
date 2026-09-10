# GitHub Pages Deployment

GitHub Actions tests every pull request and push to `main`. A successful
`main` run deploys `dist-pages/` to GitHub Pages.

Before you push a release, run `npm run deploy:prepare`. It builds the same
Pages files locally, but does not publish.

## Repository setup

1. Push this project to a public GitHub repository.
2. Open **Settings → Pages**.
3. Set **Source** to **GitHub Actions**.
4. Push to `main`, then open the deployment URL shown by the workflow.
5. Confirm that `index.html`, `loader.js`, and `release.js` respond successfully.

The Pages job uses GitHub's automatic token. It needs `contents: read`,
`pages: write`, and `id-token: write`. Configure these repository variables:

- `SUPABASE_PROJECT_REF`: the 20-character project reference.
- `SUPABASE_PUBLISHABLE_KEY`: the public `sb_publishable_` browser key.

The publishable key is not a database administrator secret. Row-level security
limits it to released puzzle reads. Do not put a Supabase secret key in a
repository variable or frontend build.

The Supabase migration workflow also uses `SUPABASE_ACCESS_TOKEN` and
`SUPABASE_DB_PASSWORD` as repository secrets. It applies checked-in database
migrations and the checked-in project configuration. Do not add WordPress
credentials to GitHub.

The same workflow deploys checked-in Edge Functions. Supabase provides the
function with its runtime URL, publishable key, and service-role key. The Pages
artifact receives only `SUPABASE_PUBLISHABLE_KEY`. Authentication URL settings,
user invitations and entries in `private.puzzle_managers` are deliberate
production operations.

## WordPress embed

The Mudlarker page embeds the public Pages bundle with a Custom HTML block:

```html
<script id="nexo-supabase-config" type="application/json">
  {"url":"https://PROJECT.supabase.co","publishableKey":"PUBLISHABLE_KEY"}
</script>
<div id="bracket-city-app"></div>
<script src="https://entre-parentesis.es/loader.js"></script>
```

The publishable key is safe to include in page source. The embed reads released
puzzles from Supabase. It does not enable creator sign-in. The legacy PHP
plugin remains in the repository only for rollback and migration work.

## Rollback

Revert the faulty frontend commit and push the revert to `main`. GitHub Pages
will deploy the prior code. This does not change stored Supabase puzzles.
