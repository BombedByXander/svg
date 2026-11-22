import { proxyApiRequest } from "../_shared/api-proxy.js";
import { handleNeonProfileMedia } from "../_shared/neon-profile-media.js";
import { handleNeonAuth } from "../_shared/neon-auth.js";
import { handleNeonData } from "../_shared/neon-data.js";

export function onRequest({ request, env }) {
  const path = new URL(request.url).pathname;
  if (path.startsWith("/api/neon-auth/")) return handleNeonAuth(request);
  if (path.startsWith("/api/neon-data/")) return handleNeonData(request);
  if (path === "/api/profile-media") return handleNeonProfileMedia(request, env);
  return proxyApiRequest(request);
}
