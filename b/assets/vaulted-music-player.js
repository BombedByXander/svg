(() => {
  "use strict";

  const providers = {
    ytm: "YouTube",
    soundcloud: "SoundCloud",
    tidal: "TIDAL",
  };
  const videoId = /^[\w-]{11}$/;
  const numberId = /^\d{1,18}$/;
  let youtubeReady;
  let soundCloudReady;

  function providerUrl(value) {
    try {
      const url = new URL(value);
      if (url.protocol === "https:" && !url.username && !url.password && !url.port) return url;
    } catch {}
    return null;
  }

  function trackFromLink(value) {
    const url = providerUrl(value);
    if (!url) return null;
    const host = url.hostname;
    const path = url.pathname.split("/").filter(Boolean);
    let id;
    if (host === "youtu.be") id = path[0];
    if (["youtube.com", "www.youtube.com", "music.youtube.com", "m.youtube.com"].includes(host)) {
      id = path[0] === "watch" ? url.searchParams.get("v") : ["shorts", "live", "embed"].includes(path[0]) ? path[1] : null;
    }
    if (videoId.test(id || "")) return {
      id, source: "ytm", title: "YouTube video", artist: "YouTube",
      permalinkUrl: "https://www.youtube.com/watch?v=" + id,
      artwork: "https://i.ytimg.com/vi/" + id + "/mqdefault.jpg", duration: 0,
    };
    if (["soundcloud.com", "www.soundcloud.com"].includes(host) && path.length === 2 &&
        /^[a-z0-9_-]+$/i.test(path[0]) && /^[a-z0-9_-]+$/i.test(path[1])) {
      const permalinkUrl = "https://soundcloud.com/" + path.join("/");
      const display = value => value.replace(/[-_]+/g, " ");
      return { id: permalinkUrl, source: "soundcloud", title: display(path[1]), artist: display(path[0]), permalinkUrl, duration: 0 };
    }
    if (["tidal.com", "www.tidal.com", "listen.tidal.com"].includes(host)) {
      const trackIndex = path.indexOf("track");
      if (trackIndex >= 0 && numberId.test(path[trackIndex + 1] || "")) {
        id = path[trackIndex + 1];
        return { id, source: "tidal", title: "TIDAL track", artist: "TIDAL", permalinkUrl: "https://tidal.com/browse/track/" + id, duration: 0 };
      }
    }
    return null;
  }

  function trackProvider(track) {
    const linked = trackFromLink(track?.permalinkUrl) || trackFromLink(String(track?.id || ""));
    if (linked) return linked;
    const id = String(track?.id || "");
    if (track?.source === "ytm" && videoId.test(id)) return trackFromLink("https://www.youtube.com/watch?v=" + id);
    if (track?.source === "tidal" && numberId.test(id)) return trackFromLink("https://tidal.com/browse/track/" + id);
    if (["soundcloud", "scdlp"].includes(track?.source) && numberId.test(id)) {
      return { source: "soundcloud", id, permalinkUrl: "https://api.soundcloud.com/tracks/" + id };
    }
    return null;
  }

  function addScript(src, failed) {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.addEventListener("error", () => { script.remove(); failed(); }, { once: true });
    document.head.append(script);
    return script;
  }

  function loadYouTube() {
    if (window.YT?.Player) return Promise.resolve(window.YT);
    if (!youtubeReady) youtubeReady = new Promise((resolve, reject) => {
      const previous = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        try { previous?.(); } finally { resolve(window.YT); }
      };
      addScript("https://www.youtube.com/iframe_api", () => reject(new Error("Could not load the YouTube controls.")));
    }).catch(error => { youtubeReady = null; throw error; });
    return youtubeReady;
  }

  function loadSoundCloud() {
    if (window.SC?.Widget) return Promise.resolve(window.SC.Widget);
    if (!soundCloudReady) soundCloudReady = new Promise((resolve, reject) => {
      const script = addScript("https://w.soundcloud.com/player/api.js", () => reject(new Error("Could not load the SoundCloud controls.")));
      script.addEventListener("load", () => {
        if (window.SC?.Widget) resolve(window.SC.Widget);
        else reject(new Error("SoundCloud controls are unavailable."));
      }, { once: true });
    }).catch(error => { soundCloudReady = null; throw error; });
    return soundCloudReady;
  }

  class VaultedMusicPlayer extends EventTarget {
    paused = true;
    duration = 0;
    playbackRate = 1;
    streamError = null;
    #position = 0;
    #volume = 1;
    #muted = false;
    #provider = null;
    #driver = null;
    #panel = null;
    #status = null;
    #timer;
    #readyTimer;
    #version = 0;
    #wantsPlay = false;
    #track = null;

    constructor() {
      super();
      document.addEventListener("visibilitychange", this.#onVisibility);
    }

    #onVisibility = () => {
      if (document.hidden && this.#provider === "ytm") this.pause();
    };

    get currentTime() { return this.#position; }
    set currentTime(value) {
      if (!Number.isFinite(value) || !this.#driver?.seek) return;
      this.#position = Math.max(0, Math.min(value, this.duration || value));
      this.#driver.seek(this.#position);
      this.#emit("timeupdate");
    }

    get volume() { return this.#volume; }
    set volume(value) {
      if (!Number.isFinite(value)) return;
      this.#volume = Math.max(0, Math.min(1, value));
      this.#applyVolume();
    }

    get muted() { return this.#muted; }
    set muted(value) { this.#muted = Boolean(value); this.#applyVolume(); }

    #applyVolume() { this.#driver?.volume?.(this.#muted ? 0 : this.#volume); }
    #emit(name) { this.dispatchEvent(new Event(name)); }

    #ready(duration) {
      clearTimeout(this.#readyTimer);
      if (Number.isFinite(duration) && duration > 0) this.duration = duration;
      this.#applyVolume();
      this.#emit("loadedmetadata");
      this.#emit("canplay");
    }

    #playing() {
      const wasPaused = this.paused;
      this.paused = false;
      this.streamError = null;
      this.#status.textContent = "";
      this.#emit("canplay");
      if (wasPaused) this.#emit("play");
    }

    #paused() {
      if (!this.paused) {
        this.paused = true;
        this.#emit("pause");
      }
    }

    #failed(message) {
      clearTimeout(this.#readyTimer);
      this.#wantsPlay = false;
      this.#paused();
      this.streamError = message;
      if (this.#status) this.#status.textContent = message;
      this.#emit("error");
    }

    #update(seconds) {
      if (!Number.isFinite(seconds)) return;
      this.#position = Math.max(0, seconds);
      this.#emit("timeupdate");
    }

    #mount(provider, track) {
      const panel = document.createElement("aside");
      panel.className = "vaulted-music-player";
      panel.setAttribute("aria-label", providers[provider.source] + " player");
      const header = document.createElement("div");
      header.className = "vaulted-music-player-header";
      const label = document.createElement("span");
      label.textContent = track.title || providers[provider.source];
      label.title = label.textContent;
      const link = document.createElement("a");
      link.href = provider.permalinkUrl;
      link.textContent = "Open in " + providers[provider.source];
      link.target = "_blank";
      link.rel = "noopener";
      const close = document.createElement("button");
      close.type = "button";
      close.textContent = "×";
      close.setAttribute("aria-label", "Close music player");
      close.addEventListener("click", () => this.stop(false));
      header.append(label, link, close);
      const frame = document.createElement(provider.source === "ytm" ? "div" : "iframe");
      frame.title = providers[provider.source] + " player";
      if (frame.tagName === "IFRAME") {
        frame.allow = "autoplay; encrypted-media; fullscreen; picture-in-picture";
        frame.allowFullscreen = true;
        frame.referrerPolicy = "strict-origin-when-cross-origin";
      }
      frame.className = "vaulted-music-frame vaulted-music-frame-" + provider.source;
      this.#status = document.createElement("div");
      this.#status.className = "vaulted-music-player-status";
      this.#status.setAttribute("role", "status");
      panel.append(header, frame, this.#status);
      document.body.append(panel);
      this.#panel = panel;
      return frame;
    }

    async setTrack(track) {
      this.stop();
      const version = this.#version;
      this.#track = track;
      this.#wantsPlay = true;
      const provider = trackProvider(track);
      if (!provider) return this.#failed("This result has no playable provider link. Try a YouTube or SoundCloud track link.");
      this.#provider = provider.source;
      this.duration = Number(track.duration) || 0;
      const frame = this.#mount(provider, track);
      const current = () => version === this.#version;
      const available = () => current() && this.#panel?.isConnected;
      this.#readyTimer = setTimeout(() => {
        if (available()) this.#failed("The player took too long to load. Use the provider player or open the track directly.");
      }, 14000);
      try {
        if (provider.source === "ytm") {
          const YT = await loadYouTube();
          if (!available()) return;
          const player = new YT.Player(frame, { videoId: provider.id, playerVars: { autoplay: 1, playsinline: 1, origin: location.origin }, events: {
            onReady: () => {
              if (!available()) return;
              this.#driver = { play: () => player.playVideo(), pause: () => player.pauseVideo(), seek: seconds => player.seekTo(seconds, true), volume: value => player.setVolume(value * 100), destroy: () => player.destroy() };
              this.#ready(player.getDuration());
              if (this.#wantsPlay && !document.hidden) player.playVideo();
            },
            onStateChange: event => {
              if (!available()) return;
              if (event.data === YT.PlayerState.PLAYING) {
                this.#ready(player.getDuration());
                this.#playing();
                this.#update(player.getCurrentTime());
                clearInterval(this.#timer);
                this.#timer = setInterval(() => { if (available()) this.#update(player.getCurrentTime()); }, 250);
              } else {
                clearInterval(this.#timer);
                if (event.data === YT.PlayerState.ENDED) { this.#paused(); this.#emit("ended"); }
                if (event.data === YT.PlayerState.PAUSED) { this.#update(player.getCurrentTime()); this.#paused(); }
              }
            },
            onAutoplayBlocked: () => { if (available()) this.#failed("Press Play in the YouTube player to start."); },
            onError: () => { if (available()) this.#failed("YouTube could not play this video here. Use Open in YouTube."); },
          } });
          this.#driver = { destroy: () => player.destroy() };
        } else if (provider.source === "soundcloud") {
          frame.src = "https://w.soundcloud.com/player/?" + new URLSearchParams({ url: provider.permalinkUrl, show_artwork: "true", show_comments: "false" });
          const Widget = await loadSoundCloud();
          if (!available()) return;
          const player = Widget(frame);
          const subscribed = [];
          const bind = (event, handler) => {
            if (!event) return;
            subscribed.push(event);
            player.bind(event, (...args) => { if (available()) handler(...args); });
          };
          bind(Widget.Events.READY, () => {
            this.#driver = { play: () => player.play(), pause: () => player.pause(), seek: seconds => player.seekTo(seconds * 1000), volume: value => player.setVolume(value * 100), destroy: () => subscribed.forEach(event => player.unbind(event)) };
            this.#ready();
            player.getDuration(ms => { if (available() && ms > 0) this.#ready(ms / 1000); });
            if (this.#wantsPlay) player.play();
          });
          bind(Widget.Events.PLAY, () => this.#playing());
          bind(Widget.Events.PAUSE, () => this.#paused());
          bind(Widget.Events.PLAY_PROGRESS, info => this.#update(info.currentPosition / 1000));
          bind(Widget.Events.FINISH, () => { this.#paused(); this.#emit("ended"); });
          bind(Widget.Events.ERROR, () => this.#failed("SoundCloud could not play this track here. Use Open in SoundCloud."));
        } else {
          frame.src = "https://embed.tidal.com/tracks/" + provider.id;
          frame.addEventListener("load", () => { if (available()) this.#ready(); }, { once: true });
          this.#status.textContent = "Playback is controlled by TIDAL. Full playback may require a TIDAL account; in-app time and play controls are unavailable for this embed.";
        }
      } catch (error) {
        if (current()) this.#failed(error?.message || "The provider player could not load.");
      }
    }

    async play() {
      if (!this.#panel && this.#track) return this.setTrack(this.#track);
      this.#wantsPlay = true;
      if (this.#provider === "ytm" && document.hidden) return;
      this.#driver?.play?.();
    }

    pause() {
      this.#wantsPlay = false;
      this.#driver?.pause?.();
      clearInterval(this.#timer);
      this.#paused();
    }

    stop(clearTrack = true) {
      this.#version++;
      this.pause();
      clearTimeout(this.#readyTimer);
      this.#driver?.destroy();
      this.#driver = null;
      this.#panel?.remove();
      this.#panel = null;
      this.#status = null;
      this.#provider = null;
      this.#position = 0;
      this.duration = 0;
      this.streamError = null;
      if (clearTrack) this.#track = null;
    }

    remove() {
      this.stop();
    }
  }

  window.VaultedMusicPlayer = VaultedMusicPlayer;
  window.vaultedMusicTrackFromLink = trackFromLink;
})();

