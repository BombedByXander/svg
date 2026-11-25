(() => {
  "use strict";

  const MODE_KEY = "vaulted-aiden-mode";
  const EVENT_NAME = "vaulted:aiden-mode";
  const APP_HOST_ID = "_jig29al";
  const STYLE_ID = "vaulted-aiden-mode-styles";
  const CANVAS_ID = "vaulted-aiden-rain";
  const FOG_ID = "vaulted-aiden-fog";
  const scriptUrl = document.currentScript?.src || location.href;
  const assetBase = new URL("./", scriptUrl);
  const SOURCES = ["aiden-face.png", "aiden-device-green.png", "aiden-device-black.png", "aiden-device-orange.png"];
  const images = SOURCES.map((name) => {
    const image = new Image(); image.decoding = "async"; image.src = new URL(name, assetBase).href; return image;
  });
  const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  let appRoot = null, observer = null, canvas = null, context = null, raf = 0, lastTime = 0;
  let particles = [], width = 1, height = 1, enabled = false, pixelRatio = 1, fog = null;

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
      if (canvas.parentNode !== root) root.appendChild(canvas);
      context = canvas.getContext("2d", { alpha: true, desynchronized: true });
    }
    if (!root.getElementById(STYLE_ID)) {
      const style = document.createElement("style");
      style.id = STYLE_ID;
      const fog1 = new URL("aiden-fog-1.png", assetBase).href;
      const fog2 = new URL("aiden-fog-2.png", assetBase).href;
      style.textContent = `
        #${FOG_ID}{position:fixed;pointer-events:none;overflow:hidden;z-index:0;opacity:.58;filter:blur(1px) grayscale(.2) saturate(1.2) sepia(.2)}
        #${CANVAS_ID}{position:fixed;display:block;pointer-events:none;z-index:2;max-width:none}
        #${FOG_ID} .fog{position:absolute;left:0;top:0;width:200%;height:100%}
        #${FOG_ID} .fog .image01,#${FOG_ID} .fog .image02{float:left;width:50%;height:100%;background-position:center;background-size:cover;background-repeat:no-repeat}
        #foglayer_01 .image01,#foglayer_01 .image02{background-image:url("${fog1}")}
        #foglayer_02 .image01,#foglayer_02 .image02,#foglayer_03 .image01,#foglayer_03 .image02{background-image:url("${fog2}")}
        #foglayer_01{animation:aiden-fog-opacity-1 10s linear infinite,aiden-fog-move 15s linear infinite}
        #foglayer_02{animation:aiden-fog-opacity-2 21s linear infinite,aiden-fog-move 13s linear infinite}
        #foglayer_03{animation:aiden-fog-opacity-3 17s linear infinite,aiden-fog-move 18s linear infinite}
        @keyframes aiden-fog-opacity-1{0%,100%{opacity:.1}22%{opacity:.5}40%{opacity:.28}58%{opacity:.4}80%{opacity:.16}}
        @keyframes aiden-fog-opacity-2{0%,100%{opacity:.5}25%{opacity:.2}50%{opacity:.1}80%{opacity:.3}}
        @keyframes aiden-fog-opacity-3{0%,100%{opacity:.8}27%{opacity:.2}52%{opacity:.6}68%{opacity:.3}}
        @keyframes aiden-fog-move{0%{left:0}100%{left:-100%}}
        @media(prefers-reduced-motion:reduce){#${FOG_ID} .fog{animation:none!important;opacity:.22}}
      `;
      root.appendChild(style);
    }
    if (!fog?.isConnected) {
      fog = root.getElementById(FOG_ID);
      if (!fog) {
        fog = document.createElement("div");
        fog.id = FOG_ID;
        fog.className = "fogwrapper";
        fog.setAttribute("aria-hidden", "true");
        for (let layer = 1; layer <= 3; layer += 1) {
          const group = document.createElement("div");
          group.id = `foglayer_0${layer}`;
          group.className = "fog";
          for (const imageClass of ["image01", "image02"]) {
            const image = document.createElement("div");
            image.className = imageClass;
            group.appendChild(image);
          }
          fog.appendChild(group);
        }
        root.appendChild(fog);
      }
    }
    if (fog.parentNode !== root) root.appendChild(fog);
    updateBounds(home);
  }

  function spawn(randomY = false) {
    const index = Math.floor(Math.random() * images.length), image = images[index];
    const aspect = image.naturalWidth && image.naturalHeight ? image.naturalHeight / image.naturalWidth : 1;
    const requestedSize = index === 0 ? 82 + Math.random() * 38 : 48 + Math.random() * 28;
    const size = Math.min(requestedSize, Math.max(1, width - 24), Math.max(1, (height - 24) / aspect));
    const w = size, h = size * aspect, inset = 12;
    const x = w / 2 + inset + Math.random() * Math.max(0, width - w - inset * 2);
    const y = randomY
      ? h / 2 + inset + Math.random() * Math.max(0, height - h - inset * 2)
      : h / 2 + inset;
    return { image, x, y,
      w, h, speed: 1.15 + Math.random() * 1.45,
      drift: (Math.random() - .5) * .9, rotation: (Math.random() - .5) * .5,
      spin: (Math.random() - .5) * .006, alpha: .58 + Math.random() * .24 };
  }

  function updateBounds(home) {
    if (!canvas || !context || !home?.isConnected) return;
    const rect = home.getBoundingClientRect();
    const nextWidth = Math.max(1, Math.round(rect.width), Math.round(window.innerWidth - rect.left));
    const nextHeight = Math.max(1, Math.round(rect.height), Math.round(window.innerHeight - rect.top));
    for (const layer of [canvas, fog]) {
      if (!layer) continue;
      layer.style.left = `${Math.round(rect.left)}px`;
      layer.style.top = `${Math.round(rect.top)}px`;
      layer.style.width = `${nextWidth}px`;
      layer.style.height = `${nextHeight}px`;
    }
    if (nextWidth === width && nextHeight === height && pixelRatio === Math.min(window.devicePixelRatio || 1, 1.5)) return;
    width = nextWidth; height = nextHeight; pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(width * pixelRatio); canvas.height = Math.round(height * pixelRatio);
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    const count = prefersReducedMotion?.matches ? 24 : Math.min(72, Math.max(36, Math.round(width / 48) * 2));
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
      const p = particles[i];
      if (p.y + p.speed * scale + p.h / 2 > height - 12) { particles[i] = spawn(); continue; }
      p.y += p.speed * scale;
      p.x = Math.max(p.w / 2 + 12, Math.min(width - p.w / 2 - 12, p.x + p.drift * scale));
      p.rotation += p.spin * scale;
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
    fog?.remove(); fog = null;
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

