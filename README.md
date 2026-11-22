# vaulted (work in progress)

Static site files for vaulted. The app and its bundled scripts, styles, fonts, and images are in `b/`.

## Deploy the site

The repository includes a Cloudflare Workers configuration. Follow [`CLOUDFLARE_WORKERS.md`](CLOUDFLARE_WORKERS.md) to publish the app at a stable `workers.dev` URL and enable deployment from GitHub pushes.

The app files are served from `b/` at the Worker root. `wrangler.toml` configures this as a static-assets Single Page Application; no build command is required.

The previous jsDelivr SVG entry point remains available:

https://cdn.jsdelivr.net/gh/BombedByXander/svg@main/index.svg

The SVG entry starts the signed loader and app. The app uses external network services for some features.

## Neon accounts

Vaulted uses Managed Better Auth and the Data API on the Neon production branch. The sign-in origin is `https://vaultedd.pages.dev`. Keep email/password enabled and email verification optional for the synthetic sign-in addresses used by username/password accounts.

After installing the base Vaulted schema, run [`neon/vaulted-account-cutover.sql`](neon/vaulted-account-cutover.sql) and refresh the Data API schema cache. The migration adds username aliases, upload authorization, and member presence.

For profile pictures and banners, set `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` as server secrets in the Cloudflare deployment. Set `AWS_ENDPOINT_URL_S3`, `AWS_REGION`, and `S3_BUCKET` to the Neon Object Storage settings. The profile media bucket must allow public reads.

After the owner creates their Neon account, verify its user ID in Neon Auth and insert that ID into `public.site_admins(user_id)` to enable the owner panel for `xander`.


GitHub pushes to `main` can deploy the Worker automatically once Workers Builds is connected as described in the deployment guide. The repository's existing jsDelivr release automation is separate from Cloudflare deployment.
