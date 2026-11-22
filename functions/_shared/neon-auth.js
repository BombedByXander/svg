const AUTH_URL = "https://ep-round-sun-bcjqrx2v.neonauth.c-16.us-east-1.aws.neon.tech/neondb/auth";
const methods = {
  "sign-in/email": "POST",
  "sign-up/email": "POST",
  "sign-out": "POST",
  "get-session": "GET",
  "token": "GET",
  "token/anonymous": "GET",
  "change-password": "POST",
  "delete-user": "POST",
};

export async function handleNeonAuth(request) {
  const url = new URL(request.url);
  const route = url.pathname.slice("/api/neon-auth/".length);
  if (!Object.hasOwn(methods, route) || methods[route] !== request.method) {
    return Response.json({ message: "Unsupported account action." }, { status: 404 });
  }
  const origin = request.headers.get("Origin");
  if ((origin && origin !== url.origin) ||
      (request.method === "POST" && origin !== url.origin)) {
    return Response.json({ message: "Invalid account request origin." }, { status: 403 });
  }
  // After same-origin validation, use Vaulted's canonical origin so auth
  // requests from the configured alternative domains share Neon allowlisting.
  const headers = new Headers({ Origin: "https://vaultedd.pages.dev" });
  for (const name of ["Content-Type", "X-Neon-Client-Info"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const cookies = (request.headers.get("Cookie") || "").split(";").map((part) => part.trim())
    .filter((cookie) => /^(?:__Secure-|__Host-)?(?:neon-auth|better-auth)\./.test(cookie));
  if (cookies.length) headers.set("Cookie", cookies.join("; "));

  const result = await fetch(AUTH_URL + "/" + route + url.search, {
    method: request.method,
    headers,
    body: request.method === "POST" ? request.body : undefined,
    redirect: "manual",
  });
  const output = new Headers({ "Cache-Control": "no-store" });
  for (const name of ["Content-Type", "Set-Auth-JWT", "Retry-After"]) {
    const value = result.headers.get(name);
    if (value) output.set(name, value);
  }
  const setCookies = result.headers.getSetCookie?.() ?? result.headers.getAll?.("Set-Cookie") ?? [];
  for (const cookie of setCookies) {
    if (!/^(?:__Secure-)?neon-auth\./.test(cookie)) continue;
    output.append("Set-Cookie", cookie.replace(/;\s*Domain=[^;]*/gi, "").replace(/;\s*Path=[^;]*/gi, "") + "; Path=/api/neon-auth");
  }
  return new Response(result.body, { status: result.status, headers: output });
}
