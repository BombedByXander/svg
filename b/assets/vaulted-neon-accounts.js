(() => {
  "use strict";

  const AUTH_URL = "https://ep-round-sun-bcjqrx2v.neonauth.c-16.us-east-1.aws.neon.tech/neondb/auth";
  const DATA_API_URL = "https://ep-round-sun-bcjqrx2v.apirest.c-16.us-east-1.aws.neon.tech/neondb/rest/v1";
  const sdkUrl = new URL("./neon-sdk.mjs", document.currentScript.src).href;
  const appOrigin = "https://vaultedd.pages.dev";
  const servedByVaulted = location.origin === appOrigin || location.hostname === "vaulted.xjc-notgalaxy.workers.dev" || ["google.maplewoodpublicschools.org", "studygeometry.cfd", "xanderis.online"].includes(location.hostname);
  const nativeFetch = window.fetch.bind(window);
  const LEGACY_TOKEN_KEY = "session_token";
  const FAVORITES_KEY = "cherri_favorites";
  const NEON_SESSION_KEY = "vaulted_neon_session";
  let clientPromise;

  // Legacy UI code passes its session value to unrelated services. Give it
  // a local user marker and let the Neon SDK own the real credentials.
  function sessionMarker(user) {
    return user ? "vaulted." + btoa(JSON.stringify({ sub: user.id })) + ".local" : null;
  }

  function setSession(session) {
    setSessionMarker(sessionMarker(session?.user));
  }

  function setSessionMarker(marker) {
    try {
      for (const key of [NEON_SESSION_KEY, LEGACY_TOKEN_KEY]) {
        if (marker?.startsWith("vaulted.")) localStorage.setItem(key, marker);
        else localStorage.removeItem(key);
      }
    } catch {}
  }

  try { setSessionMarker(localStorage.getItem(NEON_SESSION_KEY)); } catch {}

  function loadClient() {
    if (!clientPromise) {
      clientPromise = import(sdkUrl).then(({ createClient, SupabaseAuthAdapter }) => {
        const db = createClient({
          auth: { url: servedByVaulted ? new URL("/api/neon-auth", location.origin).href : AUTH_URL, allowAnonymous: true, adapter: SupabaseAuthAdapter() },
          dataApi: { url: servedByVaulted ? new URL("/api/neon-data", location.origin).href : DATA_API_URL },
        });
        db.auth.onAuthStateChange((event, session) => {
          if (event !== "INITIAL_SESSION" || session) setSession(session);
          if (event === "SIGNED_OUT") window.dispatchEvent(new Event("cherri:session"));
        });
        return db;
      }).catch((error) => {
        clientPromise = null;
        throw error;
      });
    }
    return clientPromise;
  }

  function response(value, status = 200) {
    return new Response(JSON.stringify(value), {
      status,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  async function requestBody(init) {
    if (!init?.body) return {};
    if (typeof init.body === "string") return JSON.parse(init.body || "{}");
    return {};
  }

  function normalizedUsername(value) {
    return String(value || "").trim().toLowerCase();
  }

  function authEmail(username) {
    const encoded = Array.from(username, (character) => character.charCodeAt(0).toString(16)).join("");
    return "u" + encoded + "@accounts.vaultedd.pages.dev";
  }

  function mapProfile(row, tags = [], recoveryEmail = null, plusUntil = null) {
    const gradient = row.card_gradient ?? null;
    return {
      ...row,
      display: row.display_name || row.username,
      pfp: row.avatar_url || null,
      banner: row.banner_url || null,
      primaryColor: row.primary_color,
      secondaryColor: row.secondary_color,
      avatarCrop: row.avatar_crop,
      bannerCrop: row.banner_crop,
      cardGradient: gradient ? JSON.stringify(gradient) : null,
      usernameStyle: row.username_style || null,
      badges: tags.map((item) => ({
        id: item.tag,
        title: item.tag,
        label: item.tag,
        icon: item.icon || null,
        color: item.color || null,
      })),
      createdAt: row.created_at,
      email: recoveryEmail,
      plusUntil: plusUntil || null,
    };
  }

  async function profileForUser(db, user, includePrivate = false) {
    const { data: row, error } = await db.from("profiles").select("*").eq("id", user.id).maybeSingle();
    if (error) throw error;
    if (!row) return null;
    const [{ data: tags }, privateResult, plusResult] = await Promise.all([
      db.from("profile_tags").select("tag,icon,color").eq("user_id", user.id),
      includePrivate
        ? db.from("private_account_data").select("recovery_email").eq("user_id", user.id).maybeSingle()
        : Promise.resolve({ data: null }),
      db.rpc("vaulted_public_plus", { p_usernames: [row.username] }),
    ]);
    return mapProfile(row, tags || [], privateResult?.data?.recovery_email || null, plusResult?.data?.[row.username] || null);
  }

  async function mapMany(db, rows) {
    if (!rows?.length) return [];
    const groups = [];
    for (let offset = 0; offset < rows.length; offset += 100) groups.push(rows.slice(offset, offset + 100));
    const details = await Promise.all(groups.map((group) => Promise.all([
      db.from("profile_tags").select("user_id,tag,icon,color").in("user_id", group.map((row) => row.id)),
      db.rpc("vaulted_public_plus", { p_usernames: group.map((row) => row.username) }),
    ])));
    const byUser = new Map();
    const plusByUsername = Object.assign(Object.create(null), ...details.map(([, plus]) => plus.data));
    for (const [tags] of details) {
      for (const tag of tags.data || []) {
        if (!byUser.has(tag.user_id)) byUser.set(tag.user_id, []);
        byUser.get(tag.user_id).push(tag);
      }
    }
    return rows.map((row) => mapProfile(row, byUser.get(row.id) || [], null, plusByUsername[row.username] || null));
  }

  function localFavorites() {
    try {
      const saved = JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]");
      return Array.isArray(saved) ? saved : [];
    } catch { return []; }
  }

  async function syncFavorites(db, user) {
    if (!user) return;
    const { data: remote, error } = await db.from("favorite_games").select("game_url,sort_order").eq("user_id", user.id).order("sort_order");
    if (error) return;
    const local = localFavorites();
    if (remote?.length) {
      try { localStorage.setItem(FAVORITES_KEY, JSON.stringify((remote || []).map((item) => item.game_url))); } catch {}
      window.dispatchEvent(new Event("berri:favorites"));
      return;
    }
    const urls = [...new Set(local.map((item) => typeof item === "string" ? item : item?.launch).filter((value) => typeof value === "string"))].slice(0, 6);
    if (urls.length) { const { error: saveError } = await db.from("favorite_games").upsert(urls.map((game_url, sort_order) => ({ user_id: user.id, game_url, sort_order })), { onConflict: "user_id,game_url" }); if (saveError) return; }
    window.dispatchEvent(new Event("berri:favorites"));
  }

  let favoriteSyncTimer;
  function scheduleFavoriteSync() {
    clearTimeout(favoriteSyncTimer);
    favoriteSyncTimer = setTimeout(async () => {
      try {
        const db = await loadClient();
        const { data } = await db.auth.getSession();
        const user = data.session?.user;
        if (!user) return;
        const urls = [...new Set(localFavorites().map((item) => typeof item === "string" ? item : item?.launch).filter((value) => typeof value === "string"))].slice(0, 6);
        const { error } = await db.from("favorite_games").delete().eq("user_id", user.id);
        if (error) return;
        if (urls.length) await db.from("favorite_games").insert(urls.map((game_url, sort_order) => ({ user_id: user.id, game_url, sort_order })));
      } catch (error) { console.warn("Could not sync Berri favorites:", error); }
    }, 150);
  }

  async function getUser(db) {
    const result = await db.auth.getUser();
    return result.error ? null : result.data.user || null;
  }

  async function handleAuth(path, init) {
    const db = await loadClient();
    const body = await requestBody(init);
    if (!servedByVaulted && !["localhost", "127.0.0.1"].includes(location.hostname)) {
      return response({ error: "Open https://vaultedd.pages.dev to sign in to Vaulted." }, 403);
    }
    const registering = path === "/api/auth/register";
    const loggingIn = path === "/api/auth/login";
    if ((registering || loggingIn) && init?.method === "POST") {
      const username = normalizedUsername(body.username);
      if (!/^[a-z0-9_.-]{3,24}$/.test(username)) return response({ error: "Username must be 3–24 letters, numbers, dots, dashes, or underscores." }, 400);
      if (registering && (typeof body.password !== "string" || body.password.length < 8)) {
        return response({ error: "Password must be at least 8 characters." }, 400);
      }
      const alias = await Promise.resolve().then(() =>
        db.rpc("vaulted_login_alias", { p_username: username })
      ).catch(() => null);
      const email = typeof alias?.data === "string" ? alias.data : authEmail(username);
      const password = body.password || "";
      const reservedUsername = registering && typeof alias?.data === "string";
      let { data, error } = registering && !reservedUsername
        ? await db.auth.signUp({ email, password, options: { data: { displayName: username } } })
        : await db.auth.signInWithPassword({ email, password });
      const duplicateSignup = registering && !reservedUsername && (
        /^USER_ALREADY_EXISTS(?:_|$)/i.test(String(error?.code || "")) ||
        /user already exists|email is already registered/i.test(String(error?.message || ""))
      );
      if (duplicateSignup) {
        ({ data, error } = await db.auth.signInWithPassword({ email, password }));
      }
      if (error || !data?.session || !data?.user) {
        if (duplicateSignup || reservedUsername) {
          return response({ error: "That username already has an account. Sign in with its original password or choose a different username." }, 409);
        }
        return response({ error: registering ? error?.message || "Neon Auth did not start a session." : "Incorrect username or password." }, registering ? 400 : 401);
      }
      try {
        const resumingSignup = duplicateSignup || reservedUsername;
        const existingProfile = resumingSignup ? await profileForUser(db, data.user, true) : null;
        const initialized = await db.rpc("vaulted_initialize_account", {
          p_username: username,
          p_display_name: username,
          p_login_email: data.user.email,
        });
        if (initialized.error) throw initialized.error;
        const recoveryEmail = registering && !existingProfile && String(body.email || "").trim();
        if (recoveryEmail) {
          const saved = await db.from("private_account_data").update({ recovery_email: recoveryEmail }).eq("user_id", data.user.id);
          if (saved.error) throw saved.error;
        }
        const profile = await profileForUser(db, data.user, true);
        setSession(data.session);
        void syncFavorites(db, data.user).catch(console.warn);
        return response({ token: sessionMarker(data.session.user), user: profile });
      } catch (error) {
        await db.auth.signOut();
        setSession(null);
        return response({ error: error?.message || "Could not initialize your profile. Try signing in again." }, 400);
      }
    }
    if (path === "/api/auth/logout" && init?.method === "POST") {
      const { error } = await db.auth.signOut();
      if (!error) setSession(null);
      return error ? response({ error: error.message }, 400) : response({ ok: true });
    }
    if (path === "/api/auth/me") {
      const { data, error } = await db.auth.getSession();
      if (error || !data.session?.user) { setSession(null); return response({ user: null, token: null }, 401); }
      setSession(data.session);
      return response({ user: await profileForUser(db, data.session.user, true), token: sessionMarker(data.session.user) });
    }
    if (path === "/api/auth/delete" && init?.method === "POST") {
      if (!(await getUser(db))) return response({ error: "Sign in to delete your account." }, 401);
      if (typeof body.password !== "string" || !body.password) return response({ error: "Enter your password." }, 400);
      const { error } = await db.auth.getBetterAuthInstance().deleteUser({ password: body.password });
      if (error) return response({ error: error.message }, 400);
      setSession(null);
      window.dispatchEvent(new Event("cherri:session"));
      return response({ ok: true });
    }
    if (path === "/api/auth/email" && init?.method === "POST") {
      const user = await getUser(db);
      if (!user) return response({ error: "Sign in again to update your recovery email." }, 401);
      const { error: verifyError } = await db.auth.signInWithPassword({ email: user.email, password: body.password || "" });
      if (verifyError) return response({ error: "Your current password is incorrect." }, 401);
      const email = String(body.email || "").trim().toLowerCase() || null;
      const { error } = await db.from("private_account_data").update({ recovery_email: email }).eq("user_id", user.id);
      return error ? response({ error: error.message }, 400) : response({ email });
    }
    return null;
  }

  async function handleAdminAccess(path, init) {
    if (path !== "/api/mod/access" || (init?.method || "GET").toUpperCase() !== "GET") return null;
    const db = await loadClient();
    const user = await getUser(db);
    if (!user) return response({ riskTier: "none" }, 401);
    const { data, error } = await db.rpc("vaulted_admin_access");
    if (error) {
      console.error("Could not check Berri admin access:", error);
      return response({ riskTier: "none", error: "Owner access is unavailable." }, 503);
    }
    return response({ riskTier: data?.owner === true ? "owner" : "none" });
  }

  async function handleVaultedAdmin(path, url, init) {
    const method = (init?.method || "GET").toUpperCase();
    const db = await loadClient();
    const user = await getUser(db);
    if (!user) return response({ error: "Sign in to open the owner panel." }, 401);
    const body = method === "POST" ? await requestBody(init) : {};
    let name;
    let args = {};
    if (path === "/api/admin/access" && method === "GET") name = "vaulted_admin_access";
    else if (path === "/api/admin/overview" && method === "GET") name = "vaulted_admin_overview";
    else if (path === "/api/admin/users" && method === "GET") {
      name = "vaulted_admin_search_users";
      args = { p_query: String(url.searchParams.get("q") || "").slice(0, 80) };
    } else if (path === "/api/admin/credits" && method === "POST") {
      const username = String(body.username || "").trim();
      const amount = String(body.amount || "");
      const note = String(body.note || "").slice(0, 200);
      if (!/^[a-z0-9_.-]{3,24}$/i.test(username)) return response({ error: "Enter a valid username." }, 400);
      if (!/^-?[0-9]{1,1000}$/.test(amount)) return response({ error: "Enter a whole number with up to 1,000 digits." }, 400);
      name = "vaulted_admin_adjust_credits";
      args = { p_username: username, p_amount: amount, p_note: note };
    } else if (path === "/api/admin/announcements" && method === "GET") name = "vaulted_admin_list_announcements";
    else if (path === "/api/admin/activity" && method === "GET") name = "vaulted_admin_activity";
    else if (path === "/api/admin/announcements" && method === "POST") {
      name = "vaulted_admin_create_announcement";
      args = {
        p_title: String(body.title || "").slice(0, 100),
        p_message: String(body.message || "").slice(0, 2000),
        p_kind: String(body.kind || "info"),
        p_dismissible: body.dismissible !== false,
        p_ends_at: body.endsAt ? String(body.endsAt) : null,
      };
    } else if (path.startsWith("/api/admin/announcements/") && method === "DELETE") {
      const id = path.slice("/api/admin/announcements/".length);
      if (!/^[0-9a-f-]{36}$/i.test(id)) return response({ error: "Invalid announcement." }, 400);
      name = "vaulted_admin_remove_announcement";
      args = { p_id: id };
    } else return response({ error: "This owner-panel action is not available." }, 404);

    const { data, error } = await db.rpc(name, args);
    if (error) {
      const message = String(error.message || "Owner action failed.");
      const forbidden = /owner access required/i.test(message) || error.code === "42501";
      return response({ error: forbidden ? "This panel is only available to the xander owner account." : message }, forbidden ? 403 : 400);
    }
    return response(data);
  }

  async function handleAnnouncements() {
    const db = await loadClient();
    const { data, error } = await db.rpc("vaulted_active_announcements");
    if (error) throw error;
    return response(Array.isArray(data) ? data : []);
  }

  function mountAnnouncementPopup(items) {
    if (!Array.isArray(items) || !items.length || !document.body) return;
    const visible = items.filter(item => {
      try { return !item.dismissible || localStorage.getItem(`vaulted-announcement-dismissed:${item.id}`) !== "1"; }
      catch { return true; }
    });
    if (!visible.length || document.getElementById("vaulted-announcement-overlay")) return;
    const item = visible[0];
    const accent = ({ info: "#60a5fa", success: "#34d399", warning: "#fbbf24", critical: "#fb7185" })[item.kind] || "#60a5fa";
    const overlay = document.createElement("div");
    overlay.id = "vaulted-announcement-overlay";
    overlay.setAttribute("role", "presentation");
    overlay.style.cssText = "position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;padding:20px;background:#05070bcc;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)";
    const card = document.createElement("section");
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    card.setAttribute("aria-labelledby", "vaulted-announcement-title");
    card.style.cssText = `position:relative;width:min(100%,520px);padding:28px;border:1px solid color-mix(in srgb,${accent} 40%,var(--border-4,#ffffff1a));border-radius:22px;background:var(--bg-1,#111318);color:var(--bright-text,#f7f8fc);box-shadow:0 28px 90px #0009;font:500 14px/1.55 system-ui,sans-serif`;
    const label = document.createElement("div");
    label.textContent = "VAULTED ANNOUNCEMENT";
    label.style.cssText = `margin-bottom:12px;color:${accent};font-size:10px;font-weight:800;letter-spacing:.15em`;
    const title = document.createElement("h2");
    title.id = "vaulted-announcement-title";
    title.textContent = String(item.title || "Announcement");
    title.style.cssText = "margin:0 32px 10px 0;font-size:23px;line-height:1.2;letter-spacing:-.03em";
    const message = document.createElement("p");
    message.textContent = String(item.message || "");
    message.style.cssText = "margin:0;color:var(--text,#d7d9df);white-space:pre-wrap;overflow-wrap:anywhere";
    card.append(label, title, message);
    if (item.dismissible) {
      const close = document.createElement("button");
      close.type = "button";
      close.textContent = "Got it";
      close.style.cssText = `display:block;margin:22px 0 0 auto;padding:9px 16px;border:0;border-radius:11px;background:${accent};color:#071018;font:700 12px system-ui,sans-serif;cursor:pointer`;
      close.addEventListener("click", () => {
        try { localStorage.setItem(`vaulted-announcement-dismissed:${item.id}`, "1"); } catch {}
        overlay.remove();
      });
      card.append(close);
    }
    overlay.append(card);
    document.body.append(overlay);
  }

  async function refreshAnnouncements() {
    try {
      const result = await handleAnnouncements();
      mountAnnouncementPopup(await result.json());
    } catch (error) { console.debug("Vaulted announcements unavailable:", error?.message); }
  }
  setTimeout(refreshAnnouncements, 1200);
  setInterval(() => { if (document.visibilityState === "visible") refreshAnnouncements(); }, 60_000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refreshAnnouncements(); });

  // All shop requests terminate here, never at the original site's API.
  function shopFailure(error) {
    const missing = ['42P01', '42883', 'PGRST202', 'PGRST205'].includes(error?.code);
    return response({ error: missing
      ? 'Refresh the Neon Data API schema cache to load the shop.'
      : error?.message || 'The shop could not complete that request.' }, missing ? 503 : 400);
  }

  async function shopRpc(db, name, args = {}) {
    const { data, error } = await db.rpc(name, args);
    if (error) throw error;
    return data;
  }

  async function handleShop(path, init) {
    const db = await loadClient();
    const method = (init?.method || 'GET').toUpperCase();
    const body = method === 'POST' ? await requestBody(init) : {};
    if (path === '/api/users/equipped' && method === 'POST') {
      const names = Array.isArray(body.usernames) ? body.usernames.filter(n => typeof n === 'string').slice(0, 100) : [];
      return response(await shopRpc(db, 'vaulted_public_cosmetics', { p_usernames: names }));
    }
    if (path === '/api/shop' && method === 'GET') {
      const { data, error } = await db.from('shop_catalog').select('*').order('sort_order');
      if (error) throw error;
      return response((data || []).map(item => ({
        id: item.id, kind: item.kind, name: item.name, sub: item.description,
        payload: item.payload, priceCoins: item.price, effectivePriceCoins: item.price,
        giftPriceCoins: Math.round(item.price * 1.1), onSale: item.active, collection: null,
      })));
    }
    const { data: authData, error: authError } = await db.auth.getUser();
    if (authError || !authData?.user) return response({ error: 'Sign in to use the shop.' }, 401);
    const user = authData.user;
    if (path === '/api/me/wallet' && method === 'GET') return response(await shopRpc(db, 'vaulted_wallet'));
    if (path === '/api/me/inventory' && method === 'GET') {
      const [inventory, equipped] = await Promise.all([
        db.from('shop_inventory').select('item_id').eq('user_id', user.id),
        db.from('shop_equipped').select('item_id,slot').eq('user_id', user.id),
      ]);
      if (inventory.error || equipped.error) throw inventory.error || equipped.error;
      const slots = {};
      for (const row of equipped.data || []) (slots[row.slot] ||= []).push(row.item_id);
      return response({ owned: (inventory.data || []).map(row => row.item_id), equipped: slots, maxNameTags: 2 });
    }
    let result;
    if (path === '/api/shop/buy' && method === 'POST') result = await shopRpc(db, 'vaulted_buy', { p_item: body.itemId });
    else if (path === '/api/shop/equip' && method === 'POST') result = await shopRpc(db, 'vaulted_equip', {
      p_item: body.itemId ?? null, p_slot: body.slot ?? null, p_unequip: body.unequip === true,
    });
    else if (path === '/api/shop/reward' && method === 'POST') result = await shopRpc(db, 'vaulted_reward', {
      p_action: body.action, p_target: String(body.target || '').slice(0, 4096),
    });
    else if (['/api/shop/gift', '/api/wallet/gift'].includes(path) && method === 'POST') result = await shopRpc(db, 'vaulted_gift', {
      p_username: body.toUsername, p_request: body.requestId || crypto.randomUUID(),
      p_item: path === '/api/shop/gift' ? body.itemId : null,
      p_amount: path === '/api/wallet/gift' ? body.amount : null,
    });
    else return response({ error: 'This shop operation is not available.' }, 404);
    window.dispatchEvent(new CustomEvent('vaulted:wallet', { detail: result }));
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel('vaulted-shop');
      channel.postMessage({ updated: true });
      channel.close();
    }
    return response(result);
  }

  window.vaultedEarn = async (action, target = '') => {
    try {
      const db = await loadClient();
      const { data } = await db.auth.getSession();
      if (!data.session || document.visibilityState === 'hidden') return;
      const result = await shopRpc(db, 'vaulted_reward', { p_action: action, p_target: String(target).slice(0, 4096) });
      if (result.awarded > 0) window.dispatchEvent(new CustomEvent('vaulted:wallet', { detail: result }));
    } catch (error) { console.debug('Vaulted credit reward unavailable:', error?.message); }
  };
  window.addEventListener('cherri:session', () => window.vaultedEarn('daily'));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') window.vaultedEarn('daily');
  });
  setInterval(() => window.vaultedEarn('daily'), 15 * 60 * 1000);

  async function handleProfile(path, url, init) {
    const db = await loadClient();
    const method = (init?.method || (init?.body ? "POST" : "GET")).toUpperCase();
    const needsCurrentUser = method === "PATCH" || path === "/api/users/card-gradient" || path === "/api/users/username-style" || path === "/api/users/upload-pfp" || path === "/api/users/upload-banner";
    const current = needsCurrentUser ? await getUser(db) : null;

    if (path.startsWith("/api/users/profile/") && method === "GET") {
      const username = decodeURIComponent(path.slice("/api/users/profile/".length)).replace(/^@/, "").toLowerCase();
      const { data: row, error } = await db.from("profiles").select("*").eq("username", username).maybeSingle();
      if (error) return response({ error: error.message }, 500);
      if (!row) return response({ error: "User not found" }, 404);
      const [{ data: tags }, { data: favorites }, { data: stats }, plusResult] = await Promise.all([
        db.from("profile_tags").select("tag,icon,color").eq("user_id", row.id),
        db.from("favorite_games").select("game_url,sort_order").eq("user_id", row.id).order("sort_order"),
        db.from("game_stats").select("game_url,play_seconds").eq("user_id", row.id),
        db.rpc("vaulted_public_plus", { p_usernames: [row.username] }),
      ]);
      const user = mapProfile(row, tags || [], current?.id === row.id ? null : null, plusResult?.data?.[row.username] || null);
      user.favoriteGames = (favorites || []).map((item) => item.game_url);
      user.gameStats = stats || [];
      user.gamesPlayed = (stats || []).length;
      user.playtimeSeconds = (stats || []).reduce((sum, item) => sum + Number(item.play_seconds || 0), 0);
      return response({ user });
    }

    if (path === "/api/members" && method === "GET") {
      const { data, error } = await db.from("profiles").select("*").order("created_at", { ascending: false }).limit(1000);
      if (error) return response({ error: error.message }, 500);
      return response(await mapMany(db, data || []));
    }

    if (path === "/api/members/brief" && method === "GET") {
      const ids = (url.searchParams.get("ids") || "").split(",").filter(Boolean).slice(0, 200);
      if (!ids.length) return response({ users: [] });
      const { data, error } = await db.from("profiles").select("*").in("id", ids);
      if (error) return response({ error: error.message }, 500);
      return response({ users: await mapMany(db, data || []) });
    }

    if (path === "/api/users/list" && method === "GET") {
      let query = db.from("profiles").select("*", { count: "exact" }).order("created_at", { ascending: false });
      const rawSearch = (url.searchParams.get("q") || "").trim();
      const search = rawSearch.replace(/[,%()]/g, " ");
      if (search && /^[a-z0-9_. -]{1,40}$/i.test(search)) query = query.or(`username.ilike.%${search}%,display_name.ilike.%${search}%`);
      const pageSize = Math.min(50, Math.max(2, Math.trunc(Number(url.searchParams.get("limit"))) || 50));
      const offset = (Math.max(1, Math.trunc(Number(url.searchParams.get("page"))) || 1) - 1) * pageSize;
      let featured = null;
      if (url.searchParams.get("directory") === "1" && !rawSearch) {
        const result = await db.from("profiles").select("*").eq("username", "xander").maybeSingle();
        if (result.error) return response({ error: result.error.message }, 500);
        featured = result.data;
        if (featured) query = query.neq("id", featured.id);
      }
      const start = featured && offset > 0 ? offset - 1 : offset;
      const limit = featured && offset === 0 ? pageSize - 1 : pageSize;
      const { data, error, count } = await query.range(start, start + limit - 1);
      if (error) return response({ error: error.message }, 500);
      const rows = data || [];
      const users = await mapMany(db, featured && offset === 0 ? [featured, ...rows] : rows);
      const total = (count || 0) + Number(Boolean(featured));
      return response(url.searchParams.get("ids") === "1" ? { ids: users.map((user) => user.id), total } : { users, total, unknown: [] });
    }

    if (path === "/api/users/settings" && method === "PATCH") {
      if (!current) return response({ error: "Sign in to update your profile." }, 401);
      const body = await requestBody(init);
      const patch = {};
      if (typeof body.display === "string") patch.display_name = body.display.slice(0, 40);
      if (typeof body.bio === "string") patch.bio = body.bio.slice(0, 450);
      if (typeof body.pronouns === "string") patch.pronouns = body.pronouns.slice(0, 32);
      if (typeof body.banner === "string" || body.banner === null) patch.banner_url = body.banner;
      if (typeof body.primaryColor === "string" && /^#[0-9a-f]{6}$/i.test(body.primaryColor)) patch.primary_color = body.primaryColor;
      if (typeof body.secondaryColor === "string" && /^#[0-9a-f]{6}$/i.test(body.secondaryColor)) patch.secondary_color = body.secondaryColor;
      if (body.avatarCrop && typeof body.avatarCrop === "object") patch.avatar_crop = body.avatarCrop;
      if (body.bannerCrop && typeof body.bannerCrop === "object") patch.banner_crop = body.bannerCrop;
      if (body.username_style !== undefined) patch.username_style = body.username_style;
      if (typeof body.username === "string") {
        const aliasCheck = await db.rpc("vaulted_login_alias", { p_username: "" });
        if (aliasCheck.error) return response({ error: "Username changes are temporarily unavailable." }, 503);
        const username = normalizedUsername(body.username);
        if (!/^[a-z0-9_.-]{3,24}$/.test(username)) return response({ error: "Invalid username." }, 400);
        const { data: profile } = await db.from("profiles").select("last_username_change,username").eq("id", current.id).maybeSingle();
        if (profile?.username !== username && profile?.last_username_change && Date.now() - Date.parse(profile.last_username_change) < 14 * 86400000) {
          return response({ error: "You can change your username once every 14 days." }, 400);
        }
        patch.username = username;
        patch.last_username_change = new Date().toISOString();
      }
      if (typeof body.password === "string" && body.password) {
        if (body.password.length < 8) return response({ error: "Password must be at least 8 characters." }, 400);
        const { error: authError } = await db.auth.getBetterAuthInstance().changePassword({ currentPassword: body.currentPassword || "", newPassword: body.password });
        if (authError) return response({ error: authError.message }, 400);
      }
      if (Object.keys(patch).length) {
        const { error } = await db.from("profiles").update(patch).eq("id", current.id);
        if (error) return response({ error: error.message }, 400);
      }
      return response({ ok: true });
    }

    if (path === "/api/users/card-gradient" && method === "POST") {
      if (!current) return response({ error: "Sign in to customize your profile." }, 401);
      const body = await requestBody(init);
      const colors = Array.isArray(body.colors) && body.colors.length === 2 ? body.colors : null;
      if (colors && colors.some((value) => !/^#[0-9a-f]{6}$/i.test(value))) return response({ error: "Choose two valid colors." }, 400);
      const { error } = await db.from("profiles").update({ card_gradient: colors }).eq("id", current.id);
      return error ? response({ error: error.message }, 400) : response({ ok: true });
    }

    if (path === "/api/users/username-style" && method === "POST") {
      if (!current) return response({ error: "Sign in to customize your profile." }, 401);
      const body = await requestBody(init);
      const { error } = await db.from("profiles").update({ username_style: body.style ?? null }).eq("id", current.id);
      return error ? response({ error: error.message }, 400) : response({ ok: true });
    }

    const roleMatch = path.match(/^\/api\/users\/([^/]+)\/roles$/);
    if (roleMatch && method === "GET") {
      const { data, error } = await db.from("profile_tags").select("tag,icon,color,assigned_at").eq("user_id", decodeURIComponent(roleMatch[1]));
      if (error) return response({ error: error.message }, 500);
      return response((data || []).map((item) => ({ id: item.tag, name: item.tag, title: item.tag, icon: item.icon, color: item.color, assignedAt: item.assigned_at })));
    }

    if ((path === "/api/users/upload-pfp" || path === "/api/users/upload-banner") && method === "POST") {
      if (!current) return response({ error: "Sign in to upload profile media." }, 401);
      const form = init?.body instanceof FormData ? init.body : null;
      const file = form?.get("file");
      if (!(file instanceof File) || !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type)) return response({ error: "Choose a PNG, JPG, WEBP, or GIF image." }, 400);
      if (file.size > 3 * 1024 * 1024) return response({ error: "Image must be 3 MB or smaller." }, 400);
      const isAvatar = path.endsWith("upload-pfp");
      const cropValue = (key, fallback) => {
        const value = Number(form.get(key));
        return Number.isFinite(value) ? value : fallback;
      };
      const crop = { focusX: cropValue("focusX", 50), focusY: cropValue("focusY", 50), zoom: cropValue("zoom", 1) };
      const upload = await nativeFetch(new URL("/api/profile-media", location.origin), {
        method: "POST",
        headers: { Authorization: "Bearer " + (await db.auth.getSession()).data.session?.access_token },
        body: file,
      });
      const { url: publicUrl, error: uploadError } = await upload.json();
      if (!upload.ok) return response({ error: uploadError }, upload.status);
      const update = isAvatar
        ? { avatar_url: publicUrl, avatar_crop: crop }
        : { banner_url: publicUrl, banner_crop: crop };
      const { error: saveError } = await db.from("profiles").update(update).eq("id", current.id);
      if (saveError) return response({ error: saveError.message }, 400);
      return response(isAvatar ? { pfpUrl: publicUrl } : { bannerUrl: publicUrl });
    }

    return null;
  }

  async function handleLeaderboard(url) {
    const db = await loadClient();
    const requestedPage = Math.max(1, Number.parseInt(url.searchParams.get("page") || "1", 10) || 1);
    const pageSize = 50;
    const { data, error } = await db.rpc("vaulted_leaderboard", { p_limit: pageSize + 1, p_offset: (requestedPage - 1) * pageSize });
    if (error) return response({ error: error.message }, 500);
    const rows = Array.isArray(data) ? data : [];
    return response({ entries: rows.slice(0, pageSize), page: requestedPage, hasMore: rows.length > pageSize, pageSize });
  }

  function saveStorage(values) {
    return Object.fromEntries(Object.entries(values || {}).filter(([key]) =>
      key !== LEGACY_TOKEN_KEY && key !== NEON_SESSION_KEY && !/^sb-.*-auth-token$/.test(key)
    ));
  }

  async function handleCloudSave(url, init) {
    const db = await loadClient();
    const user = await getUser(db);
    if (!user) return response({ error: "Sign in to sync your saves." }, 401);
    const key = { user_id: user.id, origin: location.origin };
    if (init?.method === "PUT") {
      if (typeof init.body !== "string" || new TextEncoder().encode(init.body).length > 1024 * 1024) {
        return response({ error: "Cloud save is larger than 1 MB." }, 413);
      }
      const { ls, idb, hash } = await requestBody(init);
      const { data, error } = await db.from("vaulted_cloud_saves")
        .upsert({ ...key, snapshot: { ls: saveStorage(ls), idb, hash } }, { onConflict: "user_id,origin" })
        .select("updated_at").single();
      if (error) return response({ error: error.message }, 503);
      return response({ updatedAt: data.updated_at });
    }
    if (init?.method && init.method !== "GET") return response({ error: "Method not allowed." }, 405);
    const meta = url.searchParams.has("meta");
    const { data, error } = await db.from("vaulted_cloud_saves").select(meta ? "updated_at" : "snapshot,updated_at")
      .eq("user_id", key.user_id).eq("origin", key.origin).maybeSingle();
    if (error) return response({ error: error.message }, 503);
    if (!data) return response({ error: "No cloud save yet." }, 404);
    if (meta) return response({ updatedAt: data.updated_at });
    return response({ ...data.snapshot, ls: saveStorage(data.snapshot?.ls), updatedAt: data.updated_at });
  }

  window.fetch = async (input, init) => {
    const rawUrl = typeof input === "string" ? input : input?.url || String(input);
    const url = new URL(rawUrl, location.href);
    if (url.origin !== location.origin && url.origin !== appOrigin) return nativeFetch(input, init);
    if (!url.pathname.startsWith("/api/")) return nativeFetch(input, init);
    if (url.pathname === "/api/announcements" && (!init?.method || init.method.toUpperCase() === "GET")) {
      try { return await handleAnnouncements(); }
      catch (error) { return response({ error: error?.message || "Announcements are unavailable." }, 500); }
    }
    if (url.pathname.startsWith("/api/admin/")) {
      try { return await handleVaultedAdmin(url.pathname, url, init); }
      catch (error) { return response({ error: error?.message || "Owner action failed." }, 500); }
    }
    if (url.pathname === "/api/leaderboard" && (!init?.method || init.method.toUpperCase() === "GET")) {
      try { return await handleLeaderboard(url); }
      catch (error) { return response({ error: error?.message || "Could not load leaderboard." }, 500); }
    }
    if (url.pathname.startsWith('/api/shop') || ['/api/me/wallet', '/api/me/inventory', '/api/wallet/gift', '/api/users/equipped'].includes(url.pathname)) {
      try { return await handleShop(url.pathname, init); }
      catch (error) { return shopFailure(error); }
    }
    if (url.pathname === "/api/presence" || url.pathname === "/api/presence/scope" || url.pathname === "/api/presence/heartbeat") {
      try {
        const db = await loadClient();
        if (!(await getUser(db))) return response({ online: [], idle: [] });
        const scope = url.pathname.endsWith("/scope") && init?.method === "POST" ? (await requestBody(init)).scope : null;
        const { data, error } = await db.rpc("vaulted_presence_account", {
          p_heartbeat: url.pathname.endsWith("/heartbeat"),
          p_scope: scope,
        });
        if (error) return response({ error: "Neon presence is unavailable." }, 503);
        return response(data);
      } catch { return response({ error: "Neon presence is unavailable." }, 503); }
    }
    if (url.pathname === "/api/saves") {
      try { return await handleCloudSave(url, init); }
      catch { return response({ error: "Cloud saves are unavailable." }, 503); }
    }
    if (url.pathname.startsWith("/api/auth/")) {
      try {
        return await handleAuth(url.pathname, init) || response({ error: "Unsupported Vaulted authentication route." }, 404);
      } catch (error) {
        const message = error?.message;
        return response({ error: !message || /failed to fetch|networkerror|load failed/i.test(message)
          ? "Vaulted could not connect to the account service. Reload and try again."
          : message }, 503);
      }
    }
    if (url.pathname === "/api/mod/access") {
      const accessResponse = await handleAdminAccess(url.pathname, init);
      if (accessResponse) return accessResponse;
    }
    const path = url.pathname;
    const isProfilePath = path.startsWith("/api/users/") || path.startsWith("/api/members");
    if (isProfilePath) {
      try {
        return await handleProfile(path, url, init) || response({ error: "Unsupported Vaulted profile route." }, 404);
      } catch (error) { return response({ error: error?.message || "Could not load your profile." }, 503); }
    }
    return nativeFetch(input, init);
  };

  window.addEventListener("berri:favorites", scheduleFavoriteSync);
  window.addEventListener("storage", (event) => { if (event.key === FAVORITES_KEY) scheduleFavoriteSync(); });

  loadClient().then(async (db) => {
    const { data } = await db.auth.getSession();
    setSession(data.session);
    if (data.session?.access_token) {
      window.dispatchEvent(new Event("cherri:session"));
      await syncFavorites(db, data.session.user);
    }
  }).catch((error) => console.error("Vaulted Neon account bridge did not initialize:", error));
})();
