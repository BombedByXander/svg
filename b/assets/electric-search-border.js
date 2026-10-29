(function () {
  "use strict";
  var MARGIN = 18;
  var PIXEL_BUDGET = 1800000;
  var reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  var observed = new WeakSet();

  function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
  function roundedRectSamples(x, y, w, h, radius, count) {
    var r = Math.min(radius, w / 2, h / 2), straightX = Math.max(0, w - r * 2), straightY = Math.max(0, h - r * 2);
    var pieces = [
      [straightX, function (t) { return [x + r + straightX * t, y, 1, 0]; }],
      [Math.PI * r / 2, function (t) { var a = -Math.PI / 2 + Math.PI / 2 * t; return [x + w - r + Math.cos(a) * r, y + r + Math.sin(a) * r, -Math.sin(a), Math.cos(a)]; }],
      [straightY, function (t) { return [x + w, y + r + straightY * t, 0, 1]; }],
      [Math.PI * r / 2, function (t) { var a = Math.PI / 2 * t; return [x + w - r + Math.cos(a) * r, y + h - r + Math.sin(a) * r, -Math.sin(a), Math.cos(a)]; }],
      [straightX, function (t) { return [x + w - r - straightX * t, y + h, -1, 0]; }],
      [Math.PI * r / 2, function (t) { var a = Math.PI / 2 + Math.PI / 2 * t; return [x + r + Math.cos(a) * r, y + h - r + Math.sin(a) * r, -Math.sin(a), Math.cos(a)]; }],
      [straightY, function (t) { return [x, y + h - r - straightY * t, 0, -1]; }],
      [Math.PI * r / 2, function (t) { var a = Math.PI + Math.PI / 2 * t; return [x + r + Math.cos(a) * r, y + r + Math.sin(a) * r, -Math.sin(a), Math.cos(a)]; }]
    ];
    var perimeter = pieces.reduce(function (sum, p) { return sum + p[0]; }, 0), points = [];
    for (var i = 0; i <= count; i++) {
      var d = perimeter * i / count, segment = 0;
      while (segment < pieces.length - 1 && d > pieces[segment][0]) { d -= pieces[segment][0]; segment++; }
      var piece = pieces[segment], t = piece[0] ? clamp(d / piece[0], 0, 1) : 0;
      var v = piece[1](t); points.push({ x: v[0], y: v[1], nx: v[3], ny: -v[2], p: i / count });
    }
    return points;
  }
  function install(form) {
    if (observed.has(form)) return;
    observed.add(form);
    form.classList.add("electric-search-border");
    var canvas = document.createElement("canvas");
    canvas.className = "electric-search-canvas";
    canvas.setAttribute("aria-hidden", "true");
    canvas.tabIndex = -1;
    form.appendChild(canvas);
    var ctx = canvas.getContext("2d", { alpha: true, desynchronized: true });
    if (!ctx) return;
    var size = { w: 1, h: 1, ratio: 1 }, pointer = { x: 0, y: 0, over: false }, pulseUntil = 0;
    var start = performance.now(), last = 0, frame = 0, visible = true, pageVisible = document.visibilityState !== "hidden";
    function resize() {
      var rect = form.getBoundingClientRect(), w = Math.max(1, rect.width), h = Math.max(1, rect.height);
      var cw = w + MARGIN * 2, ch = h + MARGIN * 2;
      var ratio = Math.min(devicePixelRatio || 1, 2, Math.sqrt(PIXEL_BUDGET / (cw * ch)));
      canvas.width = Math.max(1, Math.round(cw * ratio)); canvas.height = Math.max(1, Math.round(ch * ratio));
      canvas.style.width = cw + "px"; canvas.style.height = ch + "px";
      size = { w: w, h: h, ratio: ratio };
      draw(performance.now(), true);
    }
    function draw(now, isStatic) {
      var w = size.w, h = size.h, ratio = size.ratio, t = (now - start) / 1000;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, w + MARGIN * 2, h + MARGIN * 2);
      var styles = getComputedStyle(form), accent = styles.getPropertyValue("--accent").trim() || "#7df9ff";
      var radius = Math.min(h / 2, parseFloat(styles.borderTopLeftRadius) || 24), pts = roundedRectSamples(MARGIN, MARGIN, w, h, radius, Math.max(120, Math.round((w * 2 + h * 2) / 3)));
      var influence = 0;
      if (pointer.over) {
        var nearest = null, best = Infinity;
        for (var q = 0; q < pts.length; q += 2) { var dd = Math.hypot(pts[q].x - MARGIN - pointer.x, pts[q].y - MARGIN - pointer.y); if (dd < best) { best = dd; nearest = pts[q]; } }
        influence = Math.max(0, 1 - best / 100);
      }
      var pulse = pulseUntil > now ? (pulseUntil - now) / 420 : 0;
      var energy = 0.7 + influence * 0.75 + pulse * 1.2;
      ctx.globalCompositeOperation = "lighter"; ctx.lineJoin = "round"; ctx.lineCap = "round";
      for (var strand = 0; strand < 4; strand++) {
        ctx.beginPath();
        for (var j = 0; j < pts.length; j++) {
          var a = pts[j], phase = a.p * Math.PI * 2 * (34 + strand * 5) - t * (5.5 + strand * .4),
            jag = (Math.sin(phase) * .62 + Math.sin(phase * 2.17 + strand * 4) * .27 + Math.sin(a.p * 97 + t * 8 + strand) * .11),
            wave = jag * (1.15 + strand * .23 + influence * 2.1 + pulse * 2.4),
            x = a.x + a.nx * wave, y = a.y + a.ny * wave;
          if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        var opacity = (0.3 - strand * .047) * energy;
        ctx.globalAlpha = clamp(opacity, .08, .9); ctx.strokeStyle = strand === 0 ? "#ffffff" : accent;
        ctx.lineWidth = strand === 0 ? 1.1 : 1.35 + (strand % 2) * .3;
        ctx.shadowColor = accent; ctx.shadowBlur = 8 + influence * 10 + pulse * 8; ctx.stroke();
      }
      ctx.shadowBlur = 0;
      if (!isStatic && (influence > .05 || pulse > 0)) {
        var point = null, bestD = Infinity;
        for (var k = 0; k < pts.length; k += 2) { var d = Math.hypot(pts[k].x - MARGIN - pointer.x, pts[k].y - MARGIN - pointer.y); if (d < bestD) { bestD = d; point = pts[k]; } }
        if (point) {
          var spark = (influence + pulse) * 2.5;
          for (var aidx = 0; aidx < 3; aidx++) {
            ctx.beginPath(); ctx.moveTo(point.x, point.y);
            var sx = point.x, sy = point.y;
            for (var seg = 0; seg < 4; seg++) { sx += (Math.random() - .5) * 12 * spark; sy += (Math.random() - .5) * 10 * spark; ctx.lineTo(sx, sy); }
            ctx.globalAlpha = clamp(.55 * influence + pulse, 0, .95); ctx.lineWidth = 1.2; ctx.strokeStyle = "#fff"; ctx.shadowColor = accent; ctx.shadowBlur = 12; ctx.stroke();
          }
        }
      }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
      if (!isStatic && !reducedMotion.matches && (visible && pageVisible)) frame = requestAnimationFrame(loop);
    }
    function loop(now) { frame = 0; if (now - last < 24) { frame = requestAnimationFrame(loop); return; } last = now; draw(now, false); }
    function wake() { if (!frame && !reducedMotion.matches && visible && pageVisible) frame = requestAnimationFrame(loop); }
    form.addEventListener("pointermove", function (e) { var r = form.getBoundingClientRect(); pointer.x = e.clientX - r.left; pointer.y = e.clientY - r.top; pointer.over = true; wake(); });
    form.addEventListener("pointerleave", function () { pointer.over = false; wake(); });
    form.addEventListener("pointerdown", function () { if (!reducedMotion.matches) { pulseUntil = performance.now() + 420; wake(); } });
    var ro = new ResizeObserver(resize); ro.observe(form);
    var io = new IntersectionObserver(function (entries) { visible = entries.some(function (entry) { return entry.isIntersecting; }); wake(); }); io.observe(form);
    document.addEventListener("visibilitychange", function () { pageVisible = document.visibilityState !== "hidden"; wake(); });
    new MutationObserver(function () { draw(performance.now(), true); wake(); }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class", "style"] });
    resize(); wake();
  }
  function scan(root) { root.querySelectorAll(".home-page .home-search").forEach(install); }
  function observeRoot(root) {
    scan(root);
    new MutationObserver(function (records) {
      records.forEach(function (record) {
        record.addedNodes.forEach(function (node) {
          if (node.nodeType === 1) {
            if (node.matches && node.matches(".home-page .home-search")) install(node);
            scan(node);
          }
        });
      });
    }).observe(root, { childList: true, subtree: true });
  }
  var attachShadow = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (options) {
    var root = attachShadow.call(this, options);
    if (this.id === "_jig29al") observeRoot(root);
    return root;
  };
  var host = document.getElementById("_jig29al");
  if (host && host.shadowRoot) observeRoot(host.shadowRoot);
})();
