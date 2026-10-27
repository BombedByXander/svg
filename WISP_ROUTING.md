# Vaulted Wisp routing

Vaulted's proxy connects to its own `/wisp/` route. Cloudflare forwards the WebSocket upgrade to Xander's Arcade's working Wisp endpoint at `lunaar.org/wisp/`. The relay validates the browser Origin against known Vaulted entry points and forwards it to that endpoint. This keeps the browser connected to Vaulted's Cloudflare URL while reusing the Wisp service already used by Xander's Arcade.

The Cloudflare Workers entry point is `worker.js`; `wrangler.toml` runs it first only for `/wisp/*`. For a Cloudflare Pages deployment, `functions/wisp/[[path]].js` handles the same route. The client uses the current host's `/wisp/` URL, except when loaded from jsDelivr, where it uses `vaultedd.pages.dev/wisp/`.

The upstream is `https://lunaar.org/wisp/`. It was checked to accept WebSocket handshakes from both `https://lunaar.org` and `https://cdn.jsdelivr.net`. The endpoint can be changed in `worker.js` and `functions/wisp/[[path]].js` if the upstream changes.

Deploy the repository through the Cloudflare Workers or Pages project that serves Vaulted. The existing Workers configuration is set up for `npx wrangler deploy`; Pages builds must include the repository-root `functions/` directory along with `b/` as the output directory. After deployment, the app's Wisp default will use the Cloudflare route.

## Connection repair (October 26, 2026)

The client now uses the same-origin relay by default and migrates previously saved built-in endpoints, including the old direct lunaar.org default. Literal fallback URLs are no longer passed through the legacy Base64 decoder. Explicit custom endpoints remain supported. The relay also accepts its own request origin, so custom Vaulted hostnames work without a hard-coded hostname change.

Before initializing the transport, the client attempts an eight-second WebSocket handshake. Startup is limited to three attempts and reports connection failure rather than endlessly loading. A handshake confirms connectivity at that moment, not game availability or a lasting connection. This does not override managed-device or network policies blocking WebSockets.
