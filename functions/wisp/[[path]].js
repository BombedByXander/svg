const WISP_UPSTREAM = "https://lunaar.org/wisp/";
const APP_ORIGINS = new Set([
  "https://vaultedd.pages.dev",
  "https://vaulted.xjc-notgalaxy.workers.dev",
  "https://cdn.jsdelivr.net",
]);

export async function onRequest({ request }) {
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    return new Response("WebSocket upgrade required", {
      status: 426,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const origin = request.headers.get("Origin");
  if (origin !== new URL(request.url).origin && !APP_ORIGINS.has(origin)) {
    return new Response("Forbidden", {
      status: 403,
      headers: { "Cache-Control": "no-store" },
    });
  }

  // This is the same Wisp endpoint used by Xander's Arcade. It accepts
  // Vaulted's allowed origins, so preserve the validated browser Origin.
  const headers = new Headers({ Upgrade: "websocket", Origin: origin });
  const protocol = request.headers.get("Sec-WebSocket-Protocol");
  if (protocol) headers.set("Sec-WebSocket-Protocol", protocol);

  try {
    const response = await fetch(WISP_UPSTREAM, { method: "GET", headers });
    if (response.status !== 101 || !response.webSocket) {
      return new Response("Wisp upstream refused the WebSocket upgrade", {
        status: 502,
        headers: { "Cache-Control": "no-store" },
      });
    }
    return response;
  } catch {
    return new Response("Wisp upstream is unavailable", {
      status: 502,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
