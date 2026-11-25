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

    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const randomPush = () => (Math.random() - 0.5) * (Math.random() < 0.3 ? 1200 : 480);
    const patches = Array.from({ length: 11 }, () => ({
      height: 65 + Math.random() * 70,
      speed: (Math.random() - 0.5) * 90,
      push: randomPush(),
      nextPush: Math.random() * 600
    }));
    let previous = performance.now();
    const draw = time => {
      const dt = Math.min((time - previous) / 1000, 0.05);
      previous = time;
      const heights = patches.map(patch => {
        patch.nextPush -= dt * 1000;
        if (patch.nextPush <= 0) {
          patch.push = randomPush();
          patch.nextPush = 180 + Math.random() * 760;
        }
        // Local gusts change direction while each fold still has momentum.
        patch.speed += (patch.push + 7 * (100 - patch.height) - 2.3 * patch.speed) * dt;
        patch.height += patch.speed * dt;
        const displacement = 90 * Math.tanh((patch.height - 100) / 90);
        return 100 + displacement * (reduced.matches ? 0.55 : 1);
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
    draw(previous);
    this.timer = setInterval(() => {
      if (!document.hidden) draw(performance.now());
    }, 33);
  }

  disconnectedCallback() { clearInterval(this.timer); }
}

customElements.define("vaulted-aurora", VaultedAurora);
