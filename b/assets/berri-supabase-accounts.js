(() => {
  "use strict";

  const SUPABASE_URL = "https://hulovfywovcxwprxdnoa.supabase.co";
  const SUPABASE_KEY = "sb_publishable_bu5a4_y67XUXuQiiayz3pQ_CpaI_ni2";
  const PROJECT_REF = new URL(SUPABASE_URL).hostname.split(".")[0];
  const AUTH_STORAGE_KEY = `sb-${PROJECT_REF}-auth-token`;
  const LEGACY_TOKEN_KEY = "session_token";
  const FAVORITES_KEY = "cherri_favorites";
  const MEDIA_BUCKET = "berri-profile-media";
  const API_PREFIX = "/api/";
  const nativeFetch = window.fetch.bind(window);
  let clientPromise;
  let client;

  // Bridge a saved Supabase session to the token slot the existing UI expects.
  try {
    const saved = JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) || "null");
    if (saved?.access_token) localStorage.setItem(LEGACY_TOKEN_KEY, saved.access_token);
  } catch {}

  function loadClient() {
    if (client) return Promise.resolve(client);
    if (!clientPromise) {
      clientPromise = new Promise((resolve, reject) => {
        const initialize = () => {
          if (!window.supabase?.createClient) return reject(new Error("Supabase client did not load."));
          client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
            auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
          });
          client.auth.onAuthStateChange((_event, session) => {
            try {
              if (session?.access_token) localStorage.setItem(LEGACY_TOKEN_KEY, session.access_token);
              else localStorage.removeItem(LEGACY_TOKEN_KEY);
            } catch {}
            if (session?.user) setTimeout(() => syncFavorites(client, session.user), 0);
          });
          resolve(client);
        };
        if (window.supabase?.createClient) return initialize();
        const script = document.createElement("script");
        script.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
        script.async = true;
        script.onload = initialize;
        script.onerror = () => reject(new Error("Could not load Supabase Auth."));
        document.head.appendChild(script);
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
    const encoded = Array.from(normalizedUsername(username), (character) => character.charCodeAt(0).toString(16).padStart(2, "0")).join("");
    return `u${encoded}@users.${PROJECT_REF}.supabase.co`;
  }

  async function signupConfigurationError() {
    let settingsResponse;
    try {
      settingsResponse = await nativeFetch(`${SUPABASE_URL}/auth/v1/settings`, {
        headers: { apikey: SUPABASE_KEY },
        cache: "no-store",
      });
    } catch {
      return "Could not check Supabase signup settings. Please try again.";
    }
    if (!settingsResponse.ok) return "Could not check Supabase signup settings. Please try again.";
    let settings;
    try { settings = await settingsResponse.json(); } catch {
      return "Could not check Supabase signup settings. Please try again.";
    }
    if (!settings.external?.email) return "Enable the Email provider in Supabase Authentication settings.";
    if (settings.mailer_autoconfirm !== true) {
      return "Turn off Confirm email in Supabase Authentication settings before creating accounts. No account was created.";
    }
    return null;
  }

  function mapProfile(row, tags = [], recoveryEmail = null) {
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
    };
  }

  async function profileForUser(db, user, includePrivate = false) {
    const { data: row, error } = await db.from("profiles").select("*").eq("id", user.id).maybeSingle();
    if (error) throw error;
    if (!row) return null;
    const [{ data: tags }, privateResult] = await Promise.all([
      db.from("profile_tags").select("tag,icon,color").eq("user_id", user.id),
      includePrivate
        ? db.from("private_account_data").select("recovery_email").eq("user_id", user.id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    return mapProfile(row, tags || [], privateResult?.data?.recovery_email || null);
  }

  async function mapMany(db, rows) {
    if (!rows?.length) return [];
    const { data: tags } = await db.from("profile_tags").select("user_id,tag,icon,color").in("user_id", rows.map((row) => row.id));
    const byUser = new Map();
    for (const item of tags || []) byUser.set(item.user_id, [...(byUser.get(item.user_id) || []), item]);
    return rows.map((row) => mapProfile(row, byUser.get(row.id) || []));
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
    if (urls.length) await db.from("favorite_games").upsert(urls.map((game_url, sort_order) => ({ user_id: user.id, game_url, sort_order })), { onConflict: "user_id,game_url" });
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

  async function getUser(db, token) {
    const result = token ? await db.auth.getUser(token) : await db.auth.getUser();
    if (result.error) return null;
    return result.data.user || null;
  }

  async function handleAuth(path, init) {
    const db = await loadClient();
    const body = await requestBody(init);
    if (path === "/api/auth/register" && init?.method === "POST") {
      const username = normalizedUsername(body.username);
      if (!/^[a-z0-9_.-]{3,24}$/.test(username)) return response({ error: "Username must be 3–24 letters, numbers, dots, dashes, or underscores." }, 400);
      if (typeof body.password !== "string" || body.password.length < 6) return response({ error: "Password must be at least 6 characters." }, 400);
      const configurationError = await signupConfigurationError();
      if (configurationError) return response({ error: configurationError }, 503);
      const { data, error } = await db.auth.signUp({
        email: authEmail(username),
        password: body.password,
        options: { data: { username, display_name: username, recovery_email: String(body.email || "").trim() || null } },
      });
      if (error) {
        const message = String(error.message || "");
        // Supabase Auth can surface database-trigger failures during sign-up.
        // Those are not proof that the username/email exists, so only map the
        // Auth-specific duplicate-email response to the username conflict UI.
        if (/user already registered|email.*already registered|already been registered/i.test(message)) {
          return response({ error: "That username is already registered in Supabase Auth. Check Authentication → Users for a pending account, or choose another username." }, 409);
        }
        return response({ error: `Supabase signup failed: ${message || "unknown error"}${error.code ? ` (${error.code})` : ""}` }, 400);
      }
      if (!data.session) return response({ error: "Supabase did not create a login session. Check Authentication → Users before trying again." }, 400);
      const profile = await profileForUser(db, data.user, true);
      return response({ token: data.session.access_token, user: profile || { id: data.user.id, username, display: username, email: body.email || null } });
    }
    if (path === "/api/auth/login" && init?.method === "POST") {
      const username = normalizedUsername(body.username);
      const { data: mappedEmail, error: lookupError } = await db.rpc("auth_email_for_username", { p_username: username });
      const email = !lookupError && typeof mappedEmail === "string" ? mappedEmail : authEmail(username);
      const { data, error } = await db.auth.signInWithPassword({ email, password: body.password || "" });
      if (error) return response({ error: "Incorrect username or password." }, 401);
      const profile = await profileForUser(db, data.user, true);
      return response({ token: data.session.access_token, user: profile || { id: data.user.id, username, display: username } });
    }
    if (path === "/api/auth/logout" && init?.method === "POST") {
      const { error } = await db.auth.signOut();
      return error ? response({ error: error.message }, 400) : response({ ok: true });
    }
    if (path === "/api/auth/me") {
      const token = new Headers(init?.headers).get("Authorization")?.replace(/^Bearer\s+/i, "");
      const user = await getUser(db, token);
      if (!user) return response({ user: null, token: null }, 401);
      const profile = await profileForUser(db, user, true);
      return response({ user: profile || { id: user.id, username: user.user_metadata?.username || "", display: user.user_metadata?.username || "" }, token: user.aud ? token : token });
    }
    if (path === "/api/auth/email" && init?.method === "POST") {
      const token = new Headers(init?.headers).get("Authorization")?.replace(/^Bearer\s+/i, "");
      const user = await getUser(db, token);
      if (!user) return response({ error: "Sign in again to update your recovery email." }, 401);
      const { error: verifyError } = await db.auth.signInWithPassword({ email: user.email, password: body.password || "" });
      if (verifyError) return response({ error: "Your current password is incorrect." }, 401);
      const email = String(body.email || "").trim().toLowerCase() || null;
      const { error } = await db.from("private_account_data").upsert({ user_id: user.id, recovery_email: email }, { onConflict: "user_id" });
      return error ? response({ error: error.message }, 400) : response({ email });
    }
    return null;
  }

  async function handleAdminAccess(path, init) {
    if (path !== "/api/mod/access" || (init?.method || "GET").toUpperCase() !== "GET") return null;
    const db = await loadClient();
    const token = new Headers(init?.headers).get("Authorization")?.replace(/^Bearer\s+/i, "");
    const user = await getUser(db, token);
    if (!user) return response({ riskTier: "none" }, 401);
    const { data, error } = await db.rpc("berri_my_admin_tier");
    if (error) {
      console.error("Could not check Berri admin access:", error);
      return response({ riskTier: "none", error: "Admin access is not configured in Supabase yet." }, 503);
    }
    return response({ riskTier: typeof data === "string" ? data : "none" });
  }

  async function handleProfile(path, url, init) {
    const db = await loadClient();
    const method = (init?.method || (init?.body ? "POST" : "GET")).toUpperCase();
    const token = new Headers(init?.headers).get("Authorization")?.replace(/^Bearer\s+/i, "");
    const needsCurrentUser = method === "PATCH" || path === "/api/users/card-gradient" || path === "/api/users/username-style" || path === "/api/users/upload-pfp" || path === "/api/users/upload-banner";
    const current = needsCurrentUser ? await getUser(db, token) : null;

    if (path.startsWith("/api/users/profile/") && method === "GET") {
      const username = decodeURIComponent(path.slice("/api/users/profile/".length)).replace(/^@/, "").toLowerCase();
      const { data: row, error } = await db.from("profiles").select("*").eq("username", username).maybeSingle();
      if (error) return response({ error: error.message }, 500);
      if (!row) return response({ error: "User not found" }, 404);
      const [{ data: tags }, { data: favorites }, { data: stats }] = await Promise.all([
        db.from("profile_tags").select("tag,icon,color").eq("user_id", row.id),
        db.from("favorite_games").select("game_url,sort_order").eq("user_id", row.id).order("sort_order"),
        db.from("game_stats").select("game_url,play_seconds").eq("user_id", row.id),
      ]);
      const user = mapProfile(row, tags || [], current?.id === row.id ? null : null);
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
      const search = (url.searchParams.get("q") || "").trim().replace(/[,%()]/g, " ");
      if (search && /^[a-z0-9_. -]{1,40}$/i.test(search)) query = query.or(`username.ilike.%${search}%,display_name.ilike.%${search}%`);
      const { data, error, count } = await query.range((Math.max(1, Number(url.searchParams.get("page")) || 1) - 1) * 50, (Math.max(1, Number(url.searchParams.get("page")) || 1) * 50) - 1);
      if (error) return response({ error: error.message }, 500);
      const users = await mapMany(db, data || []);
      return response(url.searchParams.get("ids") === "1" ? { ids: users.map((user) => user.id), total: count || 0 } : { users, total: count || 0, unknown: [] });
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
        const username = normalizedUsername(body.username);
        if (!/^[a-z0-9_.-]{3,24}$/.test(username)) return response({ error: "Invalid username." }, 400);
        const { data: profile } = await db.from("profiles").select("last_username_change,username").eq("id", current.id).maybeSingle();
        if (profile?.username !== username && profile?.last_username_change && Date.now() - Date.parse(profile.last_username_change) < 14 * 86400000) {
          return response({ error: "You can change your username once every 14 days." }, 400);
        }
        const { error: authError } = await db.auth.updateUser({ data: { username } });
        if (authError) return response({ error: authError.message }, 400);
        patch.username = username;
        patch.last_username_change = new Date().toISOString();
      }
      if (typeof body.password === "string" && body.password.length >= 6) {
        const { error: verifyError } = await db.auth.signInWithPassword({ email: current.email, password: body.currentPassword || "" });
        if (verifyError) return response({ error: "Your current password is incorrect." }, 401);
        const { error: authError } = await db.auth.updateUser({ password: body.password });
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
      const extension = file.type === "image/jpeg" ? "jpg" : file.type.split("/")[1];
      const objectPath = `${current.id}/${isAvatar ? "avatar" : "banner"}-${crypto.randomUUID()}.${extension}`;
      const { error: uploadError } = await db.storage.from(MEDIA_BUCKET).upload(objectPath, file, { upsert: true, contentType: file.type });
      if (uploadError) return response({ error: uploadError.message }, 400);
      const { data: publicData } = db.storage.from(MEDIA_BUCKET).getPublicUrl(objectPath);
      const publicUrl = publicData.publicUrl;
      const update = isAvatar
        ? { avatar_url: publicUrl, avatar_crop: crop }
        : { banner_url: publicUrl, banner_crop: crop };
      const { error: saveError } = await db.from("profiles").update(update).eq("id", current.id);
      if (saveError) return response({ error: saveError.message }, 400);
      return response(isAvatar ? { pfpUrl: publicUrl } : { bannerUrl: publicUrl });
    }

    return null;
  }

  window.fetch = async (input, init) => {
    const rawUrl = typeof input === "string" ? input : input?.url || String(input);
    const url = new URL(rawUrl, location.href);
    if (!url.pathname.startsWith(API_PREFIX)) return nativeFetch(input, init);
    if (url.pathname.startsWith("/api/auth/")) {
      const authResponse = await handleAuth(url.pathname, init);
      return authResponse || response({ error: "Unsupported Supabase authentication route." }, 404);
    }
    if (url.pathname === "/api/mod/access") {
      const accessResponse = await handleAdminAccess(url.pathname, init);
      if (accessResponse) return accessResponse;
    }
    const path = url.pathname;
    const isProfilePath = path.startsWith("/api/users/") || path.startsWith("/api/members");
    if (isProfilePath) {
      const profileResponse = await handleProfile(path, url, init);
      return profileResponse || response({ error: "Unsupported Supabase profile route." }, 404);
    }
    return nativeFetch(input, init);
  };

  window.addEventListener("berri:favorites", scheduleFavoriteSync);
  window.addEventListener("storage", (event) => { if (event.key === FAVORITES_KEY) scheduleFavoriteSync(); });

  loadClient().then(async (db) => {
    const { data } = await db.auth.getSession();
    if (data.session?.access_token) {
      try { localStorage.setItem(LEGACY_TOKEN_KEY, data.session.access_token); } catch {}
      window.dispatchEvent(new Event("cherri:session"));
      await syncFavorites(db, data.session.user);
    }
  }).catch((error) => console.error("Berri Supabase account bridge did not initialize:", error));
})();
