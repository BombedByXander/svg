import { proxyApiRequest } from "../_shared/api-proxy.js";

export function onRequest({ request }) {
  return proxyApiRequest(request);
}
