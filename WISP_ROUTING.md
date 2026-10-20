# Vaulted Wisp routing

Vaulted's proxy now connects to its own `/wisp/` route. Cloudflare forwards the WebSocket upgrade to MercuryWorkshop's public Wisp endpoint, while the rest of the site remains static. This follows Xander's Arcade's same-origin Wisp routing pattern without running a Wisp daemon inside the static site.

The Cloudflare Workers entry point is `worker.js`; `wrangler.toml` runs it first only for `/wisp/*`. For a Cloudflare Pages deployment, `functions/wisp/[[path]].js` handles the same route. The client uses the current host's `/wisp/` URL, except when loaded from jsDelivr, where it uses `vaultedd.pages.dev/wisp/`.

The upstream is `https://wisp.mercurywork.shop/`. MercuryWorkshop documents this as a demo endpoint with throttling, so it can be slower or rate-limited at busy times. The endpoint can be changed in `worker.js` and `functions/wisp/[[path]].js` if the upstream changes.

Deploy the repository through the Cloudflare Workers or Pages project that serves Vaulted. The existing Workers configuration is set up for `npx wrangler deploy`; Pages builds must include the repository-root `functions/` directory along with `b/` as the output directory. After deployment, the app's Wisp default will use the Cloudflare route.
