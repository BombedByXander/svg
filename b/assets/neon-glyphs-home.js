(() => {
  const characters = "0123456789ABCDEF";
  const colors = ["#a6f3fa", "#ea6fe0", "#6fd6f7", "#d351b6", "#5aaef0"];
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let mountedHero = null;
  let cleanupCurrent = null;

  function mount() {
    const hero = document.querySelector(".home-page .home-hero");
    if (hero === mountedHero) return;
    cleanupCurrent?.();
    cleanupCurrent = null;
    mountedHero = hero;
    if (!hero) return;

    const canvas = document.createElement("canvas");
    canvas.className = "vaulted-neon-glyphs";
    canvas.setAttribute("aria-hidden", "true");
    hero.insertBefore(canvas, hero.children[1] || null);
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) {
      canvas.remove();
      return;
    }

    let width = 0;
    let height = 0;
    let dpr = 1;
    let raf = 0;
    let lastFrame = 0;
    let elapsed = 0;
    let visible = true;
    const cellSize = 16;
    const density = 0.1;

    const resize = () => {
      const bounds = hero.getBoundingClientRect();
      width = Math.max(1, bounds.width);
      height = Math.max(1, bounds.height);
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw(performance.now());
    };

    const hash = (x, y) => {
      const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
      return n - Math.floor(n);
    };

    const draw = (now) => {
      if (!width || !height) return;
      const delta = lastFrame ? Math.min(48, now - lastFrame) : 0;
      lastFrame = now;
      elapsed += delta / 1000;
      ctx.clearRect(0, 0, width, height);

      const rows = Math.ceil(height / cellSize) + 2;
      const columns = Math.ceil(width / cellSize) + 2;
      const drift = (elapsed * 2.4) % cellSize;
      const timeSlice = Math.floor(elapsed * 2.5);
      const centerX = width / 2;

      for (let row = 0; row < rows; row++) {
        const depth = Math.max(0, Math.min(1, (row * cellSize + drift) / height));
        const perspective = 0.35 + depth * 1.05;
        const y = row * cellSize + drift - cellSize;
        const fontSize = Math.max(7, cellSize * perspective * 0.72);
        ctx.font = `${fontSize}px ui-monospace, SFMono-Regular, Menlo, monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        for (let column = 0; column < columns; column++) {
          const seed = hash(column, row);
          if (seed > density) continue;
          const worldX = (column * cellSize - width / 2) * perspective;
          const x = centerX + worldX;
          if (x < -cellSize || x > width + cellSize) continue;

          const flicker = hash(column + timeSlice * 3, row + timeSlice * 7);
          const charIndex = Math.floor(flicker * characters.length);
          const color = colors[Math.floor(hash(column, row * 3) * colors.length)];
          const edgeFade = Math.min(1, depth * 2.6, (1 - depth) * 2.2 + 0.2);
          const alpha = Math.max(0, Math.min(0.62, (0.14 + flicker * 0.34) * edgeFade));
          ctx.shadowColor = color;
          ctx.shadowBlur = 2 + depth * 8;
          ctx.fillStyle = color;
          ctx.globalAlpha = alpha;
          ctx.fillText(characters[charIndex], x, y);
        }
      }
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
    };

    const frame = (now) => {
      raf = 0;
      if (!visible || document.hidden) return;
      draw(now);
      raf = requestAnimationFrame(frame);
    };
    const start = () => {
      if (reduceMotion.matches || document.hidden || raf) return;
      raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };
    const observer = new ResizeObserver(resize);
    observer.observe(hero);
    const visibility = () => (document.hidden ? stop() : start());
    const motion = () => {
      if (reduceMotion.matches) {
        stop();
        draw(performance.now());
      } else start();
    };
    document.addEventListener("visibilitychange", visibility);
    reduceMotion.addEventListener?.("change", motion);
    resize();
    start();

    cleanupCurrent = () => {
      stop();
      observer.disconnect();
      document.removeEventListener("visibilitychange", visibility);
      reduceMotion.removeEventListener?.("change", motion);
      canvas.remove();
    };
  }

  const observer = new MutationObserver(mount);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  mount();
})();
