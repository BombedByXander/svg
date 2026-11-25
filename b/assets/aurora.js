const auroraColors = [
  [0.12, "#5c7cff"], [0.33, "#35cd76"], [0.48, "#00c8c1"],
  [0.69, "#ff6b9a"], [0.88, "#ffb35c"]
];

// Paint the light once. Each frame bends narrow slices of this curtain.
function paintCurtain() {
  const texture = document.createElement("canvas");
  texture.width = 800;
  texture.height = 200;
  const brush = texture.getContext("2d");
  const colors = brush.createLinearGradient(0, 0, 800, 0);
  for (const [offset, color] of auroraColors) colors.addColorStop(offset, color);
  brush.fillStyle = colors;
  brush.fillRect(0, 0, 800, 200);

  // A narrow luminous hem beneath tall, translucent shafts of light.
  const veil = brush.createLinearGradient(0, 0, 0, 200);
  for (const [offset, alpha] of [[0, 0], [.19, .04], [.42, .18],
    [.59, .44], [.67, .86], [.69, .98], [.73, .42], [.86, .17], [1, 0]]) {
    veil.addColorStop(offset, "rgba(255,255,255," + alpha + ")");
  }
  brush.globalCompositeOperation = "destination-in";
  brush.fillStyle = veil;
  brush.fillRect(0, 0, 800, 200);
  return texture;
}

class VaultedAurora extends HTMLElement {
  connectedCallback() {
    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 300;
    canvas.style.cssText = "display:block;width:100%;height:100%";
    this.replaceChildren(canvas);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const curtain = paintCurtain();
    const grain = Array.from({ length: 400 }, () => Math.random());
    const phase = Math.random() * 100;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const randomPush = () => (Math.random() - 0.5) * (Math.random() < 0.3 ? 1200 : 480);
    const makePatches = () => Array.from({ length: 11 }, () => ({
      height: 65 + Math.random() * 70,
      speed: (Math.random() - 0.5) * 90,
      push: randomPush(),
      nextPush: Math.random() * 600
    }));
    const front = makePatches(), back = makePatches(), lower = makePatches();
    let previous = performance.now();
    const draw = time => {
      const dt = Math.min((time - previous) / 1000, 0.05);
      previous = time;
      const advance = patches => patches.map(patch => {
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
      const frontHeights = advance(front);
      const backHeights = advance(back);
      const lowerHeights = advance(lower);
      ctx.clearRect(0, 0, 800, 300);
      const drift = phase + time * (reduced.matches ? .00022 : .00055);
      for (let x = 0; x < 800; x += 2) {
        const index = Math.floor(x / 80);
        const t = (x % 80) / 80;
        const blend = t * t * (3 - 2 * t);
        const sample = heights => heights[index] + (heights[index + 1] - heights[index]) * blend;
        const fold = sample(frontHeights);
        const ripple = Math.sin(x * .026 + drift + Math.sin(x * .014 - drift));
        // Share a broad sweep, but let each hem wander within its own strip.
        const sweep = 160 + .32 * (fold - 100);
        const crest = sweep + 5 * ripple;
        const backCrest = sweep - 13 + 7 * Math.tanh((sample(backHeights) - 100) / 35)
          + 3 * Math.cos(x * .013 - drift * .73);
        const lowerCrest = sweep + 14 + 7 * Math.tanh((sample(lowerHeights) - 100) / 35)
          + 3 * Math.sin(x * .019 + drift * 1.21);
        const reach = 105 + 25 * Math.sin(x * .018 - drift * .65) + 16 * grain[x / 2];

        // A distant veil follows its own contour behind the brighter front.
        ctx.globalAlpha = .34;
        ctx.drawImage(curtain, x, 0, 2, 200, x,
          backCrest - .69 * 105, 2, 105);
        ctx.globalAlpha = .78 + .18 * grain[x / 2];
        ctx.drawImage(curtain, x, 0, 2, 200, x, crest - .69 * reach, 2, reach);
        // Diffuse reflection below the hem keeps the horizon softly lit.
        ctx.globalAlpha = .23;
        ctx.drawImage(curtain, x, 60, 2, 140, x, lowerCrest - (138 - 60) / 140 * 195, 2, 195);
      }
      ctx.globalAlpha = 1;
    };
    draw(previous);
    this.timer = setInterval(() => {
      if (!document.hidden) draw(performance.now());
    }, 33);
  }

  disconnectedCallback() { clearInterval(this.timer); }
}

customElements.define("vaulted-aurora", VaultedAurora);
