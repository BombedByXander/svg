(() => {
  "use strict";

  const MODE_KEY = "vaulted-diaz-mode";
  const EVENT_NAME = "vaulted:diaz-mode";
  const APP_HOST_ID = "_jig29al";
  const IMAGE_URL = "/assets/diaz.webp";
  const STYLE_ID = "vaulted-diaz-mode-styles";
  const CANVAS_ID = "vaulted-diaz-particles";
  const motionPreference = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  let appRoot = null;
  let observer = null;
  let canvas = null;
  let context = null;
  let animationFrame = 0;
  let particles = [];
  let image = null;
  let enabled = false;
  let lastWidth = 0;
  let lastHeight = 0;

  function isEnabled() {
    try {
      return localStorage.getItem(MODE_KEY) === "1";
    } catch {
      return false;
    }
  }

  function ensureStyles(root) {
    if (root.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${CANVAS_ID} { position: fixed; inset: 0; width: 100vw; height: 100vh; pointer-events: none; z-index: 1; }
      .home-title.diaz-wordmark { display: inline-flex; align-items: center; justify-content: center; gap: .12em; }
      .diaz-wordmark .diaz-logo-image { display: block; flex: 0 0 auto; width: .82em; height: .82em; object-fit: contain; filter: drop-shadow(0 2px 12px color-mix(in srgb, var(--accent) 45%, transparent)); }
      @media (max-width: 520px) { .diaz-wordmark .diaz-logo-image { width: .72em; height: .72em; } }
    `;
    root.appendChild(style);
  }

  function getParticleCanvas(root) {
    if (canvas?.isConnected) return canvas;
    canvas = root.getElementById(CANVAS_ID);
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.id = CANVAS_ID;
      canvas.setAttribute("aria-hidden", "true");
      canvas.setAttribute("role", "presentation");
      root.appendChild(canvas);
    }
    context = canvas.getContext("2d", { alpha: true, desynchronized: true });
    lastWidth = 0;
    lastHeight = 0;
    return canvas;
  }

  function resizeCanvas() {
    if (!canvas || !context) return;
    const width = window.innerWidth;
    const height = window.innerHeight;
    if (width === lastWidth && height === lastHeight) return;
    lastWidth = width;
    lastHeight = height;
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    particles = Array.from({ length: motionPreference?.matches ? 10 : 24 }, () => makeParticle(true));
  }

  function makeParticle(randomY = false) {
    const width = 28 + Math.random() * 44;
    return {
      x: Math.random() * Math.max(window.innerWidth, 1),
      y: randomY ? Math.random() * Math.max(window.innerHeight, 1) : -90,
      width,
      height: width * (1359 / 1157),
      speed: 0.65 + Math.random() * 1.65,
      drift: (Math.random() - 0.5) * 0.75,
      rotation: (Math.random() - 0.5) * 0.5,
      spin: (Math.random() - 0.5) * 0.004,
      opacity: 0.45 + Math.random() * 0.4,
    };
  }

  function drawFrame() {
    animationFrame = 0;
    if (!enabled || document.hidden || !context || !image?.complete || !image.naturalWidth) return;
    resizeCanvas();
    context.clearRect(0, 0, window.innerWidth, window.innerHeight);
    for (let index = 0; index < particles.length; index += 1) {
      const particle = particles[index];
      particle.y += particle.speed;
      particle.x += particle.drift;
      particle.rotation += particle.spin;
      if (particle.y - particle.height > window.innerHeight + 20) {
        particles[index] = makeParticle();
        continue;
      }
      context.save();
      context.globalAlpha = particle.opacity;
      context.translate(particle.x, particle.y);
      context.rotate(particle.rotation);
      context.drawImage(image, -particle.width / 2, -particle.height / 2, particle.width, particle.height);
      context.restore();
    }
    animationFrame = requestAnimationFrame(drawFrame);
  }

  function startParticles(root) {
    if (!image) {
      image = new Image();
      image.decoding = "async";
      image.src = IMAGE_URL;
      image.addEventListener("load", () => {
        if (enabled && !animationFrame) animationFrame = requestAnimationFrame(drawFrame);
      });
    }
    getParticleCanvas(root);
    resizeCanvas();
    if (!animationFrame && !document.hidden) animationFrame = requestAnimationFrame(drawFrame);
  }

  function applyMode() {
    if (!appRoot) return;
    const title = appRoot.querySelector(".home-title");
    const wordmark = title?.querySelector(".home-title-text");
    const active = isEnabled() && Boolean(title && wordmark);
    if (active) {
      ensureStyles(appRoot);
      if (!wordmark.hasAttribute("data-diaz-original")) wordmark.setAttribute("data-diaz-original", wordmark.textContent || "vаultеd");
      if (wordmark.textContent !== "diaz'ed") wordmark.textContent = "diaz'ed";
      if (!title.querySelector(".diaz-logo-image")) {
        const logo = document.createElement("img");
        logo.className = "diaz-logo-image";
        logo.src = IMAGE_URL;
        logo.alt = "";
        logo.setAttribute("aria-hidden", "true");
        title.insertBefore(logo, wordmark);
      }
      title.classList.add("diaz-wordmark");
      enabled = true;
      startParticles(appRoot);
      return;
    }

    if (title) {
      const currentWordmark = title.querySelector(".home-title-text");
      if (currentWordmark?.hasAttribute("data-diaz-original")) {
        currentWordmark.textContent = currentWordmark.getAttribute("data-diaz-original");
        currentWordmark.removeAttribute("data-diaz-original");
      }
      title.querySelector(".diaz-logo-image")?.remove();
      title.classList.remove("diaz-wordmark");
    }
    enabled = false;
    if (animationFrame) cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    if (context && canvas) context.clearRect(0, 0, canvas.width, canvas.height);
    canvas?.remove();
    canvas = null;
    context = null;
  }

  function attachToAppRoot(root) {
    appRoot = root;
    if (!observer) {
      observer = new MutationObserver(() => {
        applyMode();
      });
      observer.observe(root, { childList: true, subtree: true });
    }
    applyMode();
  }

  const originalAttachShadow = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function attachShadowAndCapture(options) {
    const root = originalAttachShadow.call(this, options);
    if (this.id === APP_HOST_ID) attachToAppRoot(root);
    return root;
  };

  window.addEventListener(EVENT_NAME, applyMode);
  window.addEventListener("storage", (event) => {
    if (event.key === MODE_KEY || event.key === null) applyMode();
  });
  window.addEventListener("resize", resizeCanvas, { passive: true });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && animationFrame) {
      cancelAnimationFrame(animationFrame);
      animationFrame = 0;
    } else if (enabled && !animationFrame) {
      animationFrame = requestAnimationFrame(drawFrame);
    }
  });
})();
