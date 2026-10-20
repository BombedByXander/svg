# vaulted (work in progress)

Static site files for vaulted. The app and its bundled scripts, styles, fonts, and images are in `b/`.

## Deploy the site

The repository includes a Cloudflare Workers configuration. Follow [`CLOUDFLARE_WORKERS.md`](CLOUDFLARE_WORKERS.md) to publish the app at a stable `workers.dev` URL and enable deployment from GitHub pushes.

The app files are served from `b/` at the Worker root. `wrangler.toml` configures this as a static-assets Single Page Application; no build command is required.

The previous jsDelivr SVG entry point remains available:

https://cdn.jsdelivr.net/gh/BombedByXander/svg@main/index.svg

The SVG entry starts the signed loader and app. The app uses external network services for some features.

## Supabase accounts

Run [`supabase/berri-accounts.sql`](supabase/berri-accounts.sql) in the new project SQL Editor. Keep the Email provider enabled and turn **Confirm email** off so username/password registration can create a session without sending mail. The account UI maps usernames to private synthetic Auth emails; an optional real email is stored privately as the recovery contact.


GitHub pushes to `main` can deploy the Worker automatically once Workers Builds is connected as described in the deployment guide. The repository's existing jsDelivr release automation is separate from Cloudflare deployment.
