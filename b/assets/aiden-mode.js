(() => {
  "use strict";

  const MODE_KEY = "vaulted-aiden-mode";
  const EVENT_NAME = "vaulted:aiden-mode";
  const APP_HOST_ID = "_jig29al";
  const STYLE_ID = "vaulted-aiden-mode-styles";
  const CANVAS_ID = "vaulted-aiden-rain";
  const scriptUrl = document.currentScript?.src || location.href;
  const assetBase = new URL("./", scriptUrl);
  const SOURCES = ["aiden-face.png", "aiden-device-green.png", "aiden-device-black.png", "aiden-device-orange.png"];
  const images = SOURCES.map((name) => {
    const image = new Image(); image.decoding = "async"; image.src = new URL(name, assetBase).href; return image;
  });
  const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  let appRoot = null, observer = null, canvas = null, context = null, raf = 0, lastTime = 0;
  let particles = [], width = 1, height = 1, enabled = false, pixelRatio = 1;

  function isOn() { try { return localStorage.getItem(MODE_KEY) === "1"; } catch { return false; } }
  function getHomePage() { return appRoot?.querySelector(".home-page") || null; }

  function ensureCanvas(root, home) {
    if (!canvas?.isConnected) {
      canvas = root.getElementById(CANVAS_ID);
      if (!canvas) {
        canvas = document.createElement("canvas");
        canvas.id = CANVAS_ID;
        canvas.setAttribute("aria-hidden", "true");
        canvas.setAttribute("role", "presentation");
        root.appendChild(canvas);
      }
      context = canvas.getContext("2d", { alpha: true, desynchronized: true });
    }
    if (!root.getElementById(STYLE_ID)) {
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = `#${CANVAS_ID}{position:fixed;pointer-events:none;z-index:20;overflow:hidden}`;
      root.appendChild(style);
    }
    updateBounds(home);
  }

  function spawn(randomY = false) {
    const index = Math.floor(Math.random() * images.length), image = images[index];
    const size = index === 0 ? 82 + Math.random() * 38 : 48 + Math.random() * 28;
    const aspect = image.naturalWidth && image.naturalHeight ? image.naturalHeight / image.naturalWidth : 1;
    return { image, x: Math.random() * width, y: randomY ? Math.random() * height : -Math.max(80, size * aspect),
      w: size, h: size * aspect, speed: 1.15 + Math.random() * 1.45,
      drift: (Math.random() - .5) * .9, rotation: (Math.random() - .5) * .5,
      spin: (Math.random() - .5) * .006, alpha: .76 + Math.random() * .24 };
  }

  function updateBounds(home) {
    if (!canvas || !context || !home?.isConnected) return;
    const rect = home.getBoundingClientRect();
    const nextWidth = Math.max(1, Math.round(rect.width));
    const nextHeight = Math.max(1, Math.round(rect.height));
    canvas.style.left = `${Math.round(rect.left)}px`;
    canvas.style.top = `${Math.round(rect.top)}px`;
    canvas.style.width = `${nextWidth}px`;
    canvas.style.height = `${nextHeight}px`;
    if (nextWidth === width && nextHeight === height && pixelRatio === Math.min(window.devicePixelRatio || 1, 1.5)) return;
    width = nextWidth; height = nextHeight; pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(width * pixelRatio); canvas.height = Math.round(height * pixelRatio);
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    const count = prefersReducedMotion?.matches ? 12 : Math.min(36, Math.max(18, Math.round(width / 48)));
    particles = Array.from({ length: count }, () => spawn(true));
  }

  function draw(now) {
    raf = 0;
    const home = getHomePage();
    if (!enabled || !home || document.hidden || !context) return;
    updateBounds(home);
    const scale = lastTime ? Math.min((now - lastTime) / (1000 / 60), 2.5) : 1;
    lastTime = now;
    context.clearRect(0, 0, width, height);
    for (let i = 0; i < particles.length; i += 1) {
      const p = particles[i]; p.y += p.speed * scale; p.x += p.drift * scale; p.rotation += p.spin * scale;
      if (p.y - p.h > height + 24) { particles[i] = spawn(); continue; }
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
    canvas?.remove(); canvas = null; context = null; particles = [];
  }

  function apply() {
    if (!appRoot) return;
    const home = getHomePage();
    if (!isOn() || !home) { stop(); return; }
    enabled = true; ensureCanvas(appRoot, home);
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
  window.addEventListener("resize", apply, { passive: true });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && raf) { cancelAnimationFrame(raf); raf = 0; lastTime = 0; }
    else if (enabled && !raf) raf = requestAnimationFrame(draw);
  });
})();

