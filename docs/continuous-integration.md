# GitHub Pages Deployment

GitHub Actions tests every pull request and push to `main`. A successful
`main` run deploys `dist-pages/` to GitHub Pages and retains the installable
WordPress bridge ZIP for 30 days.

## Repository setup

1. Push this project to a public GitHub repository.
2. Open **Settings → Pages**.
3. Set **Source** to **GitHub Actions**.
4. Push to `main`, then open the deployment URL shown by the workflow.
5. Confirm that `index.html`, `loader.js`, and `release.js` respond successfully.

The workflow uses only GitHub's automatic token. It needs `contents: read`,
`pages: write`, and `id-token: write`. Do not add WordPress credentials to
GitHub. CI does not publish or change puzzle data.

## WordPress rollout

Download `nexo-plugin-<commit>` from the workflow artifacts. Upload its ZIP in
WordPress.com under **Plugins**, activate it, and add this shortcode to a normal
Page:

```text
[bracket_city asset_base="https://OWNER.github.io/REPOSITORY"]
```

The URL must use HTTPS and must not contain credentials, a query, or a
fragment. The bridge stores puzzles and supplies same-origin REST data and
nonces. GitHub Pages supplies only JavaScript, CSS, and locale data.

## Operational credentials

GitHub CI needs no WordPress secret. For an external command-line client,
create a dedicated WordPress user with the **Nexo Puzzle Manager** role. In
that user's profile, create a site-specific Application Password. Store it in
the client credential manager, not in this repository or GitHub Actions. Revoke
it from the same profile when it is no longer needed.

## Rollback

Revert the faulty frontend commit and push the revert to `main`. GitHub Pages
will deploy the prior code. Keep the previous bridge ZIP outside the 30-day
artifact window; upload it manually if PHP bridge rollback is required. Neither
operation changes stored puzzle posts.
