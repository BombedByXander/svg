(() => {
  "use strict";

  const MODE_KEY = "vaulted-aiden-mode";
  const EVENT_NAME = "vaulted:aiden-mode";
  const APP_HOST_ID = "_jig29al";
  const APP_ROOT_SELECTOR = "#_jig29al";
  const STYLE_ID = "vaulted-aiden-mode-styles";
  const CANVAS_ID = "vaulted-aiden-rain";
  const BASE = new URL("./", document.currentScript?.src || location.href);
  const SOURCES = ["aiden-face.png", "aiden-device-green.png", "aiden-device-black.png", "aiden-device-orange.png"];
  const images = SOURCES.map((name) => { const image = new Image(); image.decoding = "async"; image.src = new URL(name, BASE).href; return image; });
  const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  let appRoot = null;
  let observer = null;
  let canvas = null;
  let context = null;
  let raf = 0;
  let lastTime = 0;
  let particles = [];
  let width = 0;
  let height = 0;
  let enabled = false;

  function isOn() { try { return localStorage.getItem(MODE_KEY) === "1"; } catch { return false; } }
  function isHome() { return Boolean(appRoot?.querySelector(".home-page")); }

  function ensureCanvas(root) {
    if (canvas?.isConnected) return;
    canvas = root.getElementById(CANVAS_ID);
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.id = CANVAS_ID;
      canvas.setAttribute("aria-hidden", "true");
      canvas.setAttribute("role", "presentation");
      root.appendChild(canvas);
    }
    context = canvas.getContext("2d", { alpha: true, desynchronized: true });
    canvas.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;height:100dvh;pointer-events:none;z-index:18;overflow:hidden";
  }

  function spawn(randomY = false) {
    const sourceIndex = Math.floor(Math.random() * SOURCES.length);
    const image = images[sourceIndex];
    const size = sourceIndex === 0 ? 36 + Math.random() * 24 : 44 + Math.random() * 26;
    const aspect = image.naturalWidth && image.naturalHeight ? image.naturalHeight / image.naturalWidth : 1;
    return {
      image, x: Math.random() * Math.max(width, 1), y: randomY ? Math.random() * Math.max(height, 1) : -120,
      w: size, h: size * aspect, speed: 1.1 + Math.random() * 1.35,
      drift: (Math.random() - .5) * .75, rotation: (Math.random() - .5) * .5,
      spin: (Math.random() - .5) * .006, alpha: .75 + Math.random() * .25,
    };
  }

  function resize() {
    if (!canvas || !context) return;
    width = window.innerWidth; height = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    const count = prefersReducedMotion?.matches ? 12 : Math.min(32, Math.max(16, Math.round(width / 60)));
    particles = Array.from({ length: count }, () => spawn(true));
  }

  function draw(now) {
    raf = 0;
    if (!enabled || !isHome() || document.hidden || !context) return;
    const scale = lastTime ? Math.min((now - lastTime) / (1000 / 60), 2.5) : 1;
    lastTime = now;
    context.clearRect(0, 0, width, height);
    for (let i = 0; i < particles.length; i += 1) {
      const p = particles[i];
      p.y += p.speed * scale; p.x += p.drift * scale; p.rotation += p.spin * scale;
      if (p.y - p.h > height + 20) { particles[i] = spawn(); continue; }
      if (!p.image.complete || !p.image.naturalWidth) continue;
      context.save(); context.globalAlpha = p.alpha; context.translate(p.x, p.y); context.rotate(p.rotation);
      context.drawImage(p.image, -p.w / 2, -p.h / 2, p.w, p.h); context.restore();
    }
    raf = requestAnimationFrame(draw);
  }

  function stop() {
    enabled = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0; lastTime = 0;
    if (context) context.clearRect(0, 0, width, height);
    canvas?.remove(); canvas = null; context = null;
  }

  function apply() {
    if (!appRoot) return;
    if (!isOn() || !isHome()) { stop(); return; }
    enabled = true; ensureCanvas(appRoot); resize();
    if (!raf && !document.hidden) raf = requestAnimationFrame(draw);
  }

  function attach(root) {
    appRoot = root;
    if (!observer) { observer = new MutationObserver(apply); observer.observe(root, { childList: true, subtree: true }); }
    apply();
  }

  const attachShadow = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function patchedAttachShadow(options) {
    const root = attachShadow.call(this, options);
    if (this.id === APP_HOST_ID) attach(root);
    return root;
  };

  window.addEventListener(EVENT_NAME, apply);
  window.addEventListener("storage", (event) => { if (event.key === MODE_KEY || event.key === null) apply(); });
  window.addEventListener("resize", () => { if (enabled) { resize(); if (!raf) raf = requestAnimationFrame(draw); } }, { passive: true });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && raf) { cancelAnimationFrame(raf); raf = 0; lastTime = 0; }
    else if (enabled && !raf) raf = requestAnimationFrame(draw);
  });
})();
