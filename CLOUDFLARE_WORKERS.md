# Deploy Vaulted to Cloudflare Workers

This repository is configured to serve the app in `b/` from the root of a Cloudflare Worker. The Wrangler configuration is in [`wrangler.toml`](wrangler.toml); the Worker name is `vaulted`.

## Deploy from GitHub (recommended)

1. Sign in to the [Cloudflare dashboard](https://dash.cloudflare.com/) and open **Workers & Pages**.
2. Select **Create application**, then **GitHub**, authorize Cloudflare, and select `BombedByXander/svg`.
3. Set the production branch to `main` and the root directory to `/` (the repository root).
4. Leave the build command empty. Set the deploy command to `npx wrangler deploy` if Cloudflare asks for one.
5. Save and deploy. The Worker name must remain `vaulted` to match `wrangler.toml`.

Cloudflare will show the resulting `https://vaulted.<your-account-subdomain>.workers.dev` address. Future pushes to `main` deploy automatically through Workers Builds.

## Deploy with Wrangler instead

From a clone of this repository, run:

```sh
npx wrangler login
npx wrangler deploy
```

Wrangler reads `wrangler.toml` and uploads `b/` as static assets. No site build step is needed.

## Wisp routing

The Worker handles `/wisp/*` before static assets and forwards WebSocket upgrades to Xander's Arcade's working Wisp endpoint at `lunaar.org/wisp/`. It validates the browser Origin against Vaulted's known entry points, then forwards the allowed Origin upstream. Vaulted's proxy client connects to its Cloudflare hostname, so browsers do not connect directly to the upstream Wisp host. The same handler is available as a Pages Function in `functions/wisp/[[path]].js` for a Pages deployment serving `b/`.

See [`WISP_ROUTING.md`](WISP_ROUTING.md) for the route, origin allowlist, and client URL behavior.

## After the first deploy

The app still uses external services for accounts, presence, and some proxy/API features. If any of those reject requests from the new origin, add the exact `workers.dev` origin to the relevant service's allowed origins. For Supabase Auth, add it to the project's **Authentication → URL Configuration → Redirect URLs** as well. The Worker hosts the frontend and relays Wisp WebSocket connections; it does not replace Supabase or operate the Wisp server itself.
