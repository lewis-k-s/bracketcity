# GitHub Pages Deployment

GitHub Actions tests every pull request and push to `main`. A successful
`main` run deploys `dist-pages/` to GitHub Pages and retains the installable
WordPress bridge ZIP for 30 days.

Before you push a release, run `npm run deploy:prepare`. It builds the same
Pages files and creates a checked bridge ZIP locally, but does not publish.

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
migrations only. Do not add WordPress credentials to GitHub.

The same workflow deploys checked-in Edge Functions. Supabase provides the
function with its runtime URL, publishable key, and service-role key. The Pages
artifact receives only `SUPABASE_PUBLISHABLE_KEY`. Authentication URL settings,
signup disabling, user invitations, and entries in `private.puzzle_managers`
are deliberate production operations; `supabase db push` does not perform them.

## WordPress rollout

Download `nexo-plugin-<commit>` from the workflow artifacts. Upload its ZIP in
WordPress.com under **Plugins**, activate it, and add this shortcode to a normal
Page:

```text
[bracket_city asset_base="https://OWNER.github.io/REPOSITORY"]
```

The URL must use HTTPS and must not contain credentials, a query, or a
fragment. The bridge stores puzzles and supplies same-origin REST data and
nonces to the WordPress page. The standalone GitHub Pages site reads its
public puzzle catalog from Supabase.

## Operational credentials

GitHub CI needs no WordPress secret. For an external command-line client,
create a dedicated WordPress user with the **Entre Paréntesis Puzzle Manager** role. In
that user's profile, create a site-specific Application Password. Store it in
the client credential manager, not in this repository or GitHub Actions. Revoke
it from the same profile when it is no longer needed.

## Rollback

Revert the faulty frontend commit and push the revert to `main`. GitHub Pages
will deploy the prior code. Keep the previous bridge ZIP outside the 30-day
artifact window; upload it manually if PHP bridge rollback is required. Neither
operation changes stored puzzle posts.
