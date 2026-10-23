const WISP_UPSTREAM = "https://wisp.mercurywork.shop/";
const APP_ORIGINS = new Set([
  "https://vaultedd.pages.dev",
  "https://vaulted.xjc-notgalaxy.workers.dev",
  "https://cdn.jsdelivr.net",
]);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/wisp/" || url.pathname.startsWith("/wisp/")) {
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
        return new Response("WebSocket upgrade required", {
          status: 426,
          headers: { "Cache-Control": "no-store" },
        });
      }

      // Accept known Vaulted entry points. Browser scripts cannot forge Origin.
      const origin = request.headers.get("Origin");
      if (!APP_ORIGINS.has(origin)) {
        return new Response("Forbidden", {
          status: 403,
          headers: { "Cache-Control": "no-store" },
        });
      }

      const headers = new Headers({ Upgrade: "websocket" });
      const protocol = request.headers.get("Sec-WebSocket-Protocol");
      // The shared Mercury endpoint rejects browser Origin headers from
      // unrelated sites. The request was already checked against APP_ORIGINS.
      if (protocol) headers.set("Sec-WebSocket-Protocol", protocol);

      // Cloudflare establishes the upstream WebSocket and passes the upgraded
      // response back to the browser. The Wisp data stays end-to-end framed.
      try {
        return await fetch(WISP_UPSTREAM, { method: "GET", headers });
      } catch {
        return new Response("Wisp upstream is unavailable", {
          status: 502,
          headers: { "Cache-Control": "no-store" },
        });
      }
    }

    return env.ASSETS.fetch(request);
  },
};
