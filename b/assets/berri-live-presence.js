(() => {
  const supabaseUrl = "https://hulovfywovcxwprxdnoa.supabase.co";
  const publishableKey = "sb_publishable_bu5a4_y67XUXuQiiayz3pQ_CpaI_ni2";
  const eventName = "berri:presence-count";
  const peakEventName = "berri:presence-peak";
  let lastPeakCount = null;
  let lastPeakReportAt = 0;
  const channelName = "berri-live-active-users-v1";
  let client = null;
  let channel = null;
  let tracked = false;
  let disposed = false;
  let lastActivityAt = Date.now();
  const idleTimeoutMs = 5 * 60 * 1000;

  function publishCount(count) {
    if (!Number.isFinite(count)) return;
    window.__berriPresenceCount = count;
    window.dispatchEvent(new CustomEvent(eventName, { detail: { count } }));
  }

  function publishPeak(value) {
    const peak = value !== null && value !== undefined && Number.isFinite(Number(value)) ? Number(value) : null;
    window.__berriPresencePeak = peak;
    window.dispatchEvent(new CustomEvent(peakEventName, { detail: { peak } }));
  }

  async function reportPeak(count) {
    const now = Date.now();
    if (!client || !Number.isFinite(count) || (count === lastPeakCount && now - lastPeakReportAt < 5 * 60 * 1000)) return;
    lastPeakCount = count;
    lastPeakReportAt = now;
    try {
      const { data, error } = await client.rpc("record_vaulted_presence_peak", { p_active_count: count });
      if (error) throw error;
      publishPeak(data);
    } catch (error) {
      publishPeak(null);
      console.warn("Berri 24-hour presence peak could not update:", error);
    }
  }

  function publishUnavailable() {
    window.__berriPresenceCount = null;
    window.dispatchEvent(new CustomEvent(eventName, { detail: { count: null } }));
  }

  function presenceKey() {
    const keyName = "berri-active-presence-id-v1";
    try {
      let key = localStorage.getItem(keyName);
      if (!key) {
        key = crypto.randomUUID();
        localStorage.setItem(keyName, key);
      }
      return `browser:${key}`;
    } catch {
      return `session:${crypto.randomUUID()}`;
    }
  }

  function loadSupabase() {
    if (window.supabase?.createClient) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
      script.async = true;
      script.onload = () => window.supabase?.createClient ? resolve() : reject(new Error("Supabase client did not initialize"));
      script.onerror = () => reject(new Error("Could not load Supabase Realtime"));
      document.head.appendChild(script);
    });
  }

  function countPresence() {
    if (!channel) return;
    const count = Object.keys(channel.presenceState()).length;
    publishCount(count);
    reportPeak(count);
  }

  async function syncPresence() {
    if (!channel || disposed) return;
    const shouldTrack = document.visibilityState === "visible" && Date.now() - lastActivityAt < idleTimeoutMs;
    if (shouldTrack === tracked) return;
    tracked = shouldTrack;
    try {
      if (shouldTrack) await channel.track({ active: true, seen_at: new Date().toISOString() });
      else await channel.untrack();
      countPresence();
    } catch (error) {
      tracked = !shouldTrack;
      console.warn("Berri online count could not update presence:", error);
    }
  }

  async function start() {
    try {
      await loadSupabase();
      if (disposed) return;
      client = window.supabase.createClient(supabaseUrl, publishableKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      channel = client.channel(channelName, { config: { presence: { key: presenceKey() } } });
      channel.on("presence", { event: "sync" }, countPresence);
      channel.subscribe(async (status) => {
        if (disposed) return;
        if (status === "SUBSCRIBED") {
          await syncPresence();
          countPresence();
        } else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) {
          publishUnavailable();
        }
      });
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) lastActivityAt = Date.now();
        syncPresence();
      });
      const noteActivity = () => {
        lastActivityAt = Date.now();
        syncPresence();
      };
      ["pointerdown", "keydown", "touchstart", "scroll"].forEach((name) => window.addEventListener(name, noteActivity, { passive: true }));
      window.setInterval(syncPresence, 10000);
      window.setInterval(countPresence, 60 * 1000);
      window.addEventListener("pagehide", () => {
        disposed = true;
        if (client && channel) client.removeChannel(channel);
      }, { once: true });
    } catch (error) {
      publishUnavailable();
      console.warn("Berri online count is unavailable:", error);
    }
  }

  start();
})();
