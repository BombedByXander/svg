const auroraColors = [
  [0.12, "#5c7cff"], [0.33, "#35cd76"], [0.48, "#00c8c1"],
  [0.69, "#ff6b9a"], [0.88, "#ffb35c"]
];

class VaultedAurora extends HTMLElement {
  connectedCallback() {
    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 300;
    canvas.style.cssText = "display:block;width:100%;height:100%";
    this.replaceChildren(canvas);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const gradient = ctx.createLinearGradient(0, 0, canvas.width, 0);
    for (const [offset, color] of auroraColors) gradient.addColorStop(offset, color);

    // Each patch picks its next height and duration independently.
    const target = () => 42 + Math.random() * 104;
    const duration = () => 1900 + Math.random() * 5400;
    const now = performance.now();
    const patches = Array.from({ length: 11 }, () => ({
      from: target(), to: target(), start: now - Math.random() * 1000, duration: duration()
    }));
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const draw = time => {
      const heights = patches.map(patch => {
        if (time >= patch.start + patch.duration) {
          patch.from = patch.to;
          patch.to = target();
          patch.start = time;
          patch.duration = duration();
        }
        const t = Math.max(0, Math.min(1, (time - patch.start) / patch.duration));
        return patch.from + (patch.to - patch.from) * t * t * (3 - 2 * t);
      });
      ctx.clearRect(0, 0, 800, 300);
      ctx.beginPath();
      ctx.moveTo(0, heights[0]);
      for (let i = 1; i < heights.length; i++) {
        const x = i * 80;
        ctx.quadraticCurveTo(x - 80, heights[i - 1], x - 40, (heights[i - 1] + heights[i]) / 2);
      }
      ctx.lineTo(800, heights[10]);
      ctx.lineTo(800, 300);
      ctx.lineTo(0, 300);
      ctx.closePath();
      ctx.fillStyle = gradient;
      ctx.fill();
    };
    draw(now);
    this.timer = setInterval(() => {
      if (!document.hidden && !reduced.matches) draw(performance.now());
    }, 50);
  }

  disconnectedCallback() { clearInterval(this.timer); }
}

customElements.define("vaulted-aurora", VaultedAurora);
