const API_UPSTREAMS = [
  "https://kristenblackburnvolleyballcamps.com",
  "https://southpadreislandkiteboarding.com",
  "https://bananadogstore.com",
  "https://aplusmartialarts-templehills.com",
  "https://actingoutdoor.com",
  "https://restorecounselingcenter.org",
];

const APP_ORIGINS = new Set([
  "https://vaultedd.pages.dev",
  "https://google.maplewoodpublicschools.org",
  "https://studygeometry.cfd",
  "https://xanderis.online",
  "https://vaulted.xjc-notgalaxy.workers.dev",
  "https://cdn.jsdelivr.net",
]);

export async function proxyApiRequest(request) {
  const url = new URL(request.url);
  const origin = request.headers.get("Origin");
  if (origin && origin !== url.origin && !APP_ORIGINS.has(origin)) {
    return new Response("Forbidden", {
      status: 403,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const isWebSocket = request.headers.get("Upgrade")?.toLowerCase() === "websocket";
  const canRetry = isWebSocket || ["GET", "HEAD"].includes(request.method);
  const candidates = canRetry ? API_UPSTREAMS : API_UPSTREAMS.slice(0, 1);

  for (const upstream of candidates) {
    const target = `${upstream}${url.pathname}${url.search}`;
    try {
      const headers = new Headers(request.headers);
      headers.delete("Host");
      headers.delete("Origin");
      headers.delete("Referer");
      if (isWebSocket) headers.set("Origin", "https://cdn.jsdelivr.net");

      const init = isWebSocket
        ? { method: "GET", headers }
        : new Request(target, {
            method: request.method,
            headers,
            body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
            redirect: request.redirect,
          });
      const response = await fetch(target, init);
      if ([502, 503, 504].includes(response.status) && candidates.length > 1) continue;
      if (isWebSocket && (response.status !== 101 || !response.webSocket) && candidates.length > 1) continue;
      return response;
    } catch {
      if (upstream === candidates[candidates.length - 1]) {
        return new Response("Vaulted API is temporarily unavailable", {
          status: 502,
          headers: { "Cache-Control": "no-store" },
        });
      }
    }
  }

  return new Response("Vaulted API is temporarily unavailable", {
    status: 502,
    headers: { "Cache-Control": "no-store" },
  });
}
