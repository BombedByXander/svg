# Vaulted Wisp routing

Vaulted's proxy connects to its own `/wisp/` route. Cloudflare forwards the WebSocket upgrade to Xander's Arcade's working Wisp endpoint at `lunaar.org/wisp/`. The relay validates the browser Origin against known Vaulted entry points and forwards it to that endpoint. This keeps the browser connected to Vaulted's Cloudflare URL while reusing the Wisp service already used by Xander's Arcade.

The Cloudflare Workers entry point is `worker.js`; `wrangler.toml` runs it first only for `/wisp/*`. For a Cloudflare Pages deployment, `functions/wisp/[[path]].js` handles the same route. The client uses the current host's `/wisp/` URL, except when loaded from jsDelivr, where it uses `vaultedd.pages.dev/wisp/`.

The upstream is `https://lunaar.org/wisp/`. It was checked to accept WebSocket handshakes from both `https://lunaar.org` and `https://cdn.jsdelivr.net`. The endpoint can be changed in `worker.js` and `functions/wisp/[[path]].js` if the upstream changes.

Deploy the repository through the Cloudflare Workers or Pages project that serves Vaulted. The existing Workers configuration is set up for `npx wrangler deploy`; Pages builds must include the repository-root `functions/` directory along with `b/` as the output directory. After deployment, the app's Wisp default will use the Cloudflare route.
