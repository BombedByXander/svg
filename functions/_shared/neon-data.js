const DATA_URL = "https://ep-round-sun-bcjqrx2v.apirest.c-16.us-east-1.aws.neon.tech/neondb/rest/v1";
const resources = new Map([
  ["profiles", ["GET", "HEAD", "PATCH"]],
  ["private_account_data", ["GET", "PATCH"]],
  ["profile_tags", ["GET"]],
  ["favorite_games", ["GET", "POST", "DELETE"]],
  ["game_stats", ["GET"]],
  ["shop_catalog", ["GET"]],
  ["shop_equipped", ["GET"]],
  ["shop_inventory", ["GET"]],
  ["vaulted_cloud_saves", ["GET", "POST"]],
]);
const routines = new Set([
  "vaulted_initialize_account", "vaulted_login_alias", "vaulted_public_plus",
  "vaulted_public_cosmetics", "vaulted_active_announcements", "vaulted_leaderboard",
  "vaulted_presence_account", "vaulted_wallet", "vaulted_buy", "vaulted_equip",
  "vaulted_reward", "vaulted_gift", "vaulted_admin_access", "vaulted_admin_overview",
  "vaulted_admin_search_users", "vaulted_admin_adjust_credits", "vaulted_admin_list_announcements",
  "vaulted_admin_activity", "vaulted_admin_create_announcement", "vaulted_admin_remove_announcement",
]);

export async function handleNeonData(request) {
  const url = new URL(request.url);
  const route = url.pathname.slice("/api/neon-data/".length);
  const safe = request.method === "GET" || request.method === "HEAD";
  const origin = request.headers.get("Origin");
  if ((origin && origin !== url.origin) || (!safe && origin !== url.origin)) {
    return Response.json({ message: "Invalid account request origin." }, { status: 403 });
  }
  const allowed = resources.get(route)?.includes(request.method) ||
    (request.method === "POST" && route.startsWith("rpc/") && routines.has(route.slice(4)));
  if (!allowed) return Response.json({ message: "Unsupported account action." }, { status: 404 });
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return Response.json({ message: "Neon session is missing." }, { status: 401 });
  }
  const headers = new Headers({ Authorization: authorization });
  for (const name of ["Accept", "Content-Type", "Prefer", "Range", "Range-Unit", "X-Neon-Client-Info"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  try {
    const result = await fetch(DATA_URL + "/" + route + url.search, {
      method: request.method,
      headers,
      body: safe ? undefined : request.body,
      redirect: "manual",
    });
    if (result.status >= 300 && result.status < 400) {
      return Response.json({ message: "The account database redirected unexpectedly." }, { status: 502 });
    }
    const output = new Headers({ "Cache-Control": "no-store" });
    for (const name of ["Content-Type", "Content-Range", "Range-Unit", "Preference-Applied", "Retry-After"]) {
      const value = result.headers.get(name);
      if (value) output.set(name, value);
    }
    return new Response(result.body, { status: result.status, headers: output });
  } catch (error) {
    console.warn("Neon Data API request failed", error?.name, error?.message);
    return Response.json({ message: "Vaulted could not reach its account database. Try again shortly." }, { status: 502 });
  }
}
