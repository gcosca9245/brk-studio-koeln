/* =========================================================
   BRK Studio – Mini-Spiel „Einmal Burak sein“
   Canvas 2D, ohne externe Bibliotheken.
   Szene in festen Einheiten (1000 × 900), skaliert auf Elementgröße × devicePixelRatio.
   Statische Linienzeichnung wird einmal pro Größe vorgerendert; pro Frame
   kommen nur Haare, Buraks Arm mit Schere und fallende Strähnen dazu.
   Die Schleife läuft nur, solange das Spielfeld sichtbar ist.
   ========================================================= */
(() => {
  'use strict';

  const game = document.querySelector('[data-game]');
  if (!game) return;
  const stage = game.querySelector('[data-game-stage]');
  const canvas = game.querySelector('[data-game-canvas]');
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const W = 1000, H = 900, FLOOR = 832, TOP = 90;   // TOP: oberer Rand der sichtbaren Szene
  const INK = '#1A1A1A', NIGHT = '#0A0A0A', COAL = '#2A2A2A', IRON = '#4A4A4A', ASH = '#B0B0B0', PAPER = '#F5F5F5', GOLD = '#C9A96E';

  const pctEl = game.querySelector('[data-game-pct]');
  const barEl = game.querySelector('[data-game-bar]');
  const liveEl = game.querySelector('[data-game-live]');
  const doneEl = game.querySelector('[data-game-done]');
  const doneTitle = game.querySelector('[data-game-done-title]');
  const actionsEl = game.querySelector('[data-game-actions]');
  const bookBtn = game.querySelector('[data-game-book]');

  /* ---------- Szene: Kopf des Gastes, Buraks Schulter ---------- */
  const HEAD = { x: 585, y: 345, r: 60 };
  const SHOULDER = { x: 312, y: 296 };
  const UPPER = 150, FORE = 150, SCISSOR = 46;
  const REACH = UPPER + FORE + SCISSOR - 10;
  const REST = { x: 488, y: 262 };

  // Haaransatz: u = 0 Stirn, u = 1 Nacken (Winkel in Grad, Canvas-Koordinaten)
  const angleAt = (u) => ((-30 - u * 210) * Math.PI) / 180;

  // Ziel-Länge außerhalb der Kopfhaut je Stil (Szene-Einheiten)
  const STYLES = {
    fade: (u) => (u < 0.08 ? 36 : u < 0.4 ? 44 : u < 0.62 ? 44 - (u - 0.4) / 0.22 * 34 : u < 0.8 ? 10 - (u - 0.62) / 0.18 * 6 : 3),
    classic: (u) => (u < 0.08 ? 38 : u < 0.45 ? 46 : 46 - (u - 0.45) / 0.55 * 26),
    buzz: () => 6,
  };
  const BOOK = { fade: 'Waschen · Schneiden · Stylen', classic: 'Waschen · Schneiden · Stylen', buzz: 'Fast Cut' };

  // Deterministischer Zufall, damit der Gast immer gleich „verwuschelt“ ankommt
  let seed = 20260117;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

  const SEG = 14;
  const strands = [];
  function buildHair() {
    seed = 20260117;
    strands.length = 0;
    const N = 380;
    for (let i = 0; i < N; i++) {
      const u = Math.min(1, Math.max(0, (i + rnd() * 0.9) / N));
      const a = angleAt(u) + (rnd() - 0.5) * 0.05;
      const depth = HEAD.r * (0.74 + rnd() * 0.24);
      const exit = HEAD.r - depth;
      const nx = Math.cos(a), ny = Math.sin(a);
      const len = exit + (u < 0.12 ? 92 : 104 + (1 - u) * 40) + rnd() * 48;
      const step = len / SEG;
      const grav = 0.15 + rnd() * 0.09;
      const curl = (rnd() - 0.5) * 0.09;
      const pts = new Float32Array((SEG + 1) * 2);
      // Wuchsrichtung: nach hinten gekämmt (Tangente Richtung Nacken), Pony leicht nach vorn
      const comb = u < 0.1 ? -0.35 : 0.75 + rnd() * 0.25;
      let dx = nx * 0.7 + Math.sin(a) * comb, dy = ny * 0.7 - Math.cos(a) * comb;
      { const m = Math.hypot(dx, dy); dx /= m; dy /= m; }
      let x = HEAD.x + nx * depth, y = HEAD.y + ny * depth;
      pts[0] = x; pts[1] = y;
      for (let k = 1; k <= SEG; k++) {
        if (k * step > exit + 8) {           // erst außerhalb der Kopfhaut zieht die Schwerkraft
          dx += -dy * curl; dy += dx * curl;
          dy += grav;
          const m = Math.hypot(dx, dy); dx /= m; dy /= m;
        }
        x += dx * step; y += dy * step;
        pts[k * 2] = x; pts[k * 2 + 1] = y;
      }
      strands.push({ u, pts, step, L0: len, L: len, exit, T: 0, phase: rnd() * 6.28, from: len, tone: rnd() < 0.22 });
    }
    applyStyle();
  }

  let style = 'fade';
  function applyStyle() {
    const f = STYLES[style];
    for (const s of strands) s.T = Math.min(s.L0 - 4, s.exit + f(s.u));
    if (bookBtn) bookBtn.dataset.book = BOOK[style];
  }

  /* ---------- Fortschritt ---------- */
  let progress = 0, announced = 0, done = false;
  function computeProgress() {
    let a = 0, b = 0;
    for (const s of strands) { const need = s.L0 - s.T; b += need; a += Math.min(need, s.L0 - s.L); }
    return b > 0 ? a / b : 0;
  }
  function renderProgress() {
    progress = computeProgress();
    const p = done ? 100 : Math.min(99, Math.floor(progress * 100));
    pctEl.textContent = `${p}\u00a0%`;
    barEl.style.transform = `scaleX(${p / 100})`;
    const step = Math.floor(p / 25) * 25;
    if (step > announced && !done) { announced = step; liveEl.textContent = `Schnitt ${p} Prozent`; }
    if (!done && progress >= 0.93) finish();
  }

  /* ---------- Fallende und liegende Strähnen ---------- */
  const falling = [];
  const settled = [];
  function spawnPiece(s, fromL, vx) {
    // Punkte des abgeschnittenen Stücks (fromL .. s.L)
    const out = [];
    const i0 = fromL / s.step, i1 = s.L / s.step;
    const push = (t) => {
      const k = Math.min(SEG - 1, Math.floor(t)), f = t - k;
      out.push(s.pts[k * 2] + (s.pts[k * 2 + 2] - s.pts[k * 2]) * f, s.pts[k * 2 + 1] + (s.pts[k * 2 + 3] - s.pts[k * 2 + 1]) * f);
    };
    push(i0);
    for (let k = Math.ceil(i0 + 0.001); k < i1; k++) push(k);
    push(i1);
    if (out.length < 4) return;
    let cx = 0, cy = 0; const n = out.length / 2;
    for (let k = 0; k < out.length; k += 2) { cx += out[k]; cy += out[k + 1]; }
    cx /= n; cy /= n;
    for (let k = 0; k < out.length; k += 2) { out[k] -= cx; out[k + 1] -= cy; }
    const piece = { pts: out, x: cx, y: cy, vx: (vx || 0) * 0.15 + (Math.random() - 0.5) * 70, vy: -20 - Math.random() * 60, a: 0, va: (Math.random() - 0.5) * 3, tone: s.tone };
    if (reduce || falling.length > 260) settle(piece); else falling.push(piece);
  }
  function settle(p) {
    p.y = FLOOR - 2 - Math.random() * 5;
    p.x = Math.max(380, Math.min(900, p.x + (reduce ? 0 : (Math.random() - 0.5) * 30)));
    settled.push(p);
    if (settled.length > 900) settled.splice(0, settled.length - 900);
    drawSettled(p);
  }

  /* ---------- Schneiden ---------- */
  function cutAlong(ax, ay, bx, by, radius, vx) {
    const dx = bx - ax, dy = by - ay, dd = dx * dx + dy * dy || 1;
    const r2 = radius * radius;
    let any = false;
    for (const s of strands) {
      if (s.L <= s.T + 0.5) continue;
      const kMax = Math.min(SEG, Math.floor(s.L / s.step));
      for (let k = 1; k <= kMax; k++) {
        const px = s.pts[k * 2], py = s.pts[k * 2 + 1];
        let t = ((px - ax) * dx + (py - ay) * dy) / dd; t = t < 0 ? 0 : t > 1 ? 1 : t;
        const qx = ax + dx * t - px, qy = ay + dy * t - py;
        if (qx * qx + qy * qy < r2) {
          const newL = Math.max(s.T, (k - 0.5) * s.step);
          if (newL < s.L - 1.5) { spawnPiece(s, newL, vx); s.L = newL; any = true; }
          break;
        }
      }
    }
    if (any) { snipUntil = now() + 140; renderProgress(); dirty = true; }
    return any;
  }
  function cutStrandToTarget(s) { if (s.L > s.T + 0.5) { spawnPiece(s, s.T, 0); s.L = s.T; } }

  /* ---------- Zustand Schere/Arm ---------- */
  const now = () => performance.now();
  const tip = { x: REST.x, y: REST.y };          // tatsächliche Schneidspitze (geglättet)
  const aim = { x: REST.x, y: REST.y };          // Ziel (Zeiger oder Ruhe)
  let pointerIn = false, snipUntil = 0, dirty = true, started = false;
  let auto = null;                               // automatischer Schnittdurchgang (Tastatur/Button)
  let regrow = null;                             // Nachwachsen

  function clampReach(p) {
    const dx = p.x - SHOULDER.x, dy = p.y - SHOULDER.y, d = Math.hypot(dx, dy);
    if (d > REACH) { p.x = SHOULDER.x + dx / d * REACH; p.y = SHOULDER.y + dy / d * REACH; }
    if (p.y > FLOOR - 20) p.y = FLOOR - 20;
    return p;
  }

  /* ---------- Größe & Pixeldichte ---------- */
  let scale = 1, dpr = 1, cssW = 0, cssH = 0;
  const bg = document.createElement('canvas');
  const floorC = document.createElement('canvas');
  function resize() {
    const r = stage.getBoundingClientRect();
    if (!r.width) return;
    cssW = r.width; cssH = r.height;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    scale = Math.min(cssW / W, cssH / (H - TOP));
    for (const c of [canvas, bg, floorC]) { c.width = Math.round(cssW * dpr); c.height = Math.round(cssH * dpr); }
    drawStatic();
    floorC.getContext('2d').clearRect(0, 0, floorC.width, floorC.height);
    for (const p of settled) drawSettled(p);
    dirty = true;
  }
  // Szene zentriert in die Bühne setzen
  function sceneTransform(c) {
    const ox = (cssW - W * scale) / 2, oy = (cssH - H * scale);
    c.setTransform(dpr * scale, 0, 0, dpr * scale, ox * dpr, oy * dpr);
  }
  function toScene(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    const ox = (cssW - W * scale) / 2, oy = (cssH - H * scale);
    return { x: (clientX - r.left - ox) / scale, y: (clientY - r.top - oy) / scale };
  }
  const lw = (v) => Math.max(v, 0.9 / scale);

  /* ---------- Statische Zeichnung (Stuhl, Gast, Burak) ---------- */
  function drawStatic() {
    const c = bg.getContext('2d');
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, bg.width, bg.height);
    sceneTransform(c);
    c.lineCap = 'round'; c.lineJoin = 'round';

    // Boden
    c.strokeStyle = ASH; c.lineWidth = lw(1);
    c.beginPath(); c.moveTo(0, FLOOR); c.lineTo(W, FLOOR); c.stroke();
    c.globalAlpha = 0.5;
    c.beginPath();
    for (let x = 60; x < W; x += 120) { c.moveTo(x, FLOOR + 1); c.lineTo(x - 50, H); }
    c.stroke();
    c.globalAlpha = 1;

    // Beistelltisch mit Kaffee (Kaffee oder Bier inklusive)
    c.strokeStyle = INK; c.lineWidth = lw(2);
    c.beginPath(); c.moveTo(872, 650); c.lineTo(952, 650); c.moveTo(912, 650); c.lineTo(912, FLOOR - 2); c.moveTo(886, FLOOR - 1); c.lineTo(938, FLOOR - 1); c.stroke();
    c.lineWidth = lw(1.5);
    c.beginPath(); c.moveTo(892, 646); c.lineTo(932, 646); c.stroke();
    c.fillStyle = '#fff';
    c.beginPath(); c.moveTo(898, 616); c.lineTo(926, 616); c.lineTo(923, 644); c.lineTo(901, 644); c.closePath(); c.fill(); c.stroke();
    c.beginPath(); c.arc(928, 628, 6, -Math.PI / 2, Math.PI / 2); c.stroke();

    // Stuhl: Fuß, Säule, Sitz, Lehne, Kopfstütze, Armlehne, Fußstütze
    c.fillStyle = INK;
    c.beginPath(); c.ellipse(650, FLOOR - 6, 112, 9, 0, 0, Math.PI * 2); c.fill();
    c.fillRect(638, 680, 26, FLOOR - 686);
    c.beginPath(); c.moveTo(616, 690); c.lineTo(686, 690); c.lineTo(674, 712); c.lineTo(628, 712); c.closePath(); c.fill();
    c.strokeStyle = '#fff'; c.lineWidth = lw(1); c.globalAlpha = 0.35;
    c.beginPath(); c.moveTo(645, 720); c.lineTo(645, FLOOR - 14); c.stroke(); c.globalAlpha = 1;
    c.fillStyle = INK;
    roundRect(c, 488, 646, 292, 36, 14); c.fill();                                 // Sitz
    c.beginPath(); c.moveTo(500, 660); c.lineTo(468, 446); c.quadraticCurveTo(466, 424, 490, 422); c.lineTo(530, 420); c.quadraticCurveTo(552, 420, 552, 442); c.lineTo(566, 656); c.closePath(); c.fill(); // Lehne
    roundRect(c, 488, 386, 46, 34, 12); c.fill();                                  // Kopfstütze
    c.strokeStyle = INK; c.lineWidth = lw(6);
    c.beginPath(); c.moveTo(508, 416); c.lineTo(506, 426); c.stroke();
    c.lineWidth = lw(16);
    c.beginPath(); c.moveTo(540, 588); c.lineTo(772, 588); c.stroke();            // Armlehne
    c.lineWidth = lw(7);
    c.beginPath(); c.moveTo(752, 592); c.lineTo(752, 648); c.stroke();
    c.lineWidth = lw(6);
    c.beginPath(); c.moveTo(726, 680); c.lineTo(804, 790); c.stroke();
    c.lineWidth = lw(8);
    c.beginPath(); c.moveTo(784, 794); c.lineTo(866, 794); c.stroke();            // Fußstütze

    // Gast: Beine, Schuhe
    c.strokeStyle = COAL; c.lineWidth = lw(30);
    c.beginPath(); c.moveTo(700, 662); c.lineTo(770, 668); c.lineTo(820, 772); c.stroke();
    c.fillStyle = NIGHT;
    c.beginPath(); c.ellipse(842, 782, 30, 11, -0.08, 0, Math.PI * 2); c.fill();

    // Umhang (weiß, Haarlinie, feine Falten)
    c.fillStyle = '#fff'; c.strokeStyle = INK; c.lineWidth = lw(1.6);
    c.beginPath();
    c.moveTo(560, 424);
    c.quadraticCurveTo(590, 436, 622, 426);
    c.bezierCurveTo(690, 440, 756, 520, 790, 640);
    c.quadraticCurveTo(800, 672, 806, 698);
    c.quadraticCurveTo(700, 716, 600, 708);
    c.quadraticCurveTo(530, 704, 482, 692);
    c.bezierCurveTo(474, 600, 482, 500, 520, 448);
    c.quadraticCurveTo(536, 430, 560, 424);
    c.closePath(); c.fill(); c.stroke();
    c.strokeStyle = ASH; c.lineWidth = lw(1);
    c.beginPath();
    c.moveTo(540, 470); c.quadraticCurveTo(522, 590, 530, 700);
    c.moveTo(600, 470); c.quadraticCurveTo(596, 600, 612, 706);
    c.moveTo(668, 480); c.quadraticCurveTo(690, 600, 700, 708);
    c.moveTo(730, 540); c.quadraticCurveTo(752, 620, 760, 702);
    c.stroke();
    c.strokeStyle = INK; c.lineWidth = lw(1.6);
    c.beginPath(); c.moveTo(560, 424); c.quadraticCurveTo(590, 440, 622, 426); c.stroke();  // Kragen

    // Hals und Kopf im Profil (nach rechts), Ohr, geschlossenes Auge
    c.fillStyle = '#fff'; c.strokeStyle = INK; c.lineWidth = lw(1.6);
    c.beginPath();
    const a0 = (110 * Math.PI) / 180, a1 = (350 * Math.PI) / 180;
    c.arc(HEAD.x, HEAD.y, HEAD.r, a0, a1);
    c.quadraticCurveTo(648, 344, 650, 352);
    c.quadraticCurveTo(658, 362, 662, 368);
    c.quadraticCurveTo(656, 373, 648, 373);
    c.quadraticCurveTo(652, 381, 649, 386);
    c.quadraticCurveTo(646, 392, 646, 396);
    c.quadraticCurveTo(644, 406, 632, 408);
    c.quadraticCurveTo(616, 410, 612, 418);
    c.lineTo(612, 428);
    c.lineTo(566, 428);
    c.lineTo(566, 404);
    c.closePath(); c.fill(); c.stroke();
    c.lineWidth = lw(1.3);
    c.beginPath(); c.arc(586, 360, 10, -1.3, 2.1); c.stroke();
    c.beginPath(); c.moveTo(626, 350); c.quadraticCurveTo(632, 354, 639, 351); c.stroke();

    // Burak: stilisierte Silhouette im Profil, ohne Gesicht
    c.fillStyle = COAL;
    c.beginPath(); c.moveTo(222, 300); c.quadraticCurveTo(204, 390, 208, 470); c.lineTo(226, 472); c.quadraticCurveTo(232, 390, 246, 318); c.closePath(); c.fill(); // hinterer Arm
    c.fillStyle = IRON; c.fillRect(200, 470, 34, 6);                               // Kamm
    c.fillStyle = NIGHT;
    c.beginPath();                                                                // Beine
    c.moveTo(232, 540); c.lineTo(214, FLOOR - 8); c.lineTo(252, FLOOR - 8); c.lineTo(268, 600);
    c.lineTo(284, FLOOR - 8); c.lineTo(322, FLOOR - 8); c.lineTo(306, 540); c.closePath(); c.fill();
    c.beginPath(); c.ellipse(240, FLOOR - 7, 32, 8, 0, 0, Math.PI * 2); c.ellipse(310, FLOOR - 7, 32, 8, 0, 0, Math.PI * 2); c.fill();
    c.beginPath();                                                                // Oberkörper
    c.moveTo(254, 252); c.lineTo(288, 252);
    c.quadraticCurveTo(334, 262, 340, 296);
    c.quadraticCurveTo(330, 420, 312, 548);
    c.lineTo(226, 548);
    c.quadraticCurveTo(206, 420, 210, 300);
    c.quadraticCurveTo(220, 262, 254, 252);
    c.closePath(); c.fill();
    c.beginPath(); c.moveTo(254, 230); c.lineTo(290, 230); c.lineTo(286, 262); c.lineTo(256, 262); c.closePath(); c.fill(); // Hals
    c.beginPath(); c.ellipse(272, 206, 37, 42, 0.08, 0, Math.PI * 2); c.fill();    // Kopf
    c.beginPath(); c.moveTo(304, 196); c.lineTo(316, 214); c.lineTo(304, 218); c.closePath(); c.fill();   // Nase
    c.beginPath(); c.moveTo(250, 226); c.quadraticCurveTo(276, 262, 306, 232); c.lineTo(300, 222); c.closePath(); c.fill(); // Bart
    // Schürze (eine Stufe heller) mit Band und kleiner Brustschrift
    c.fillStyle = COAL;
    c.beginPath(); c.moveTo(262, 330); c.lineTo(322, 330); c.lineTo(326, 680); c.lineTo(250, 680); c.closePath(); c.fill();
    c.strokeStyle = IRON; c.lineWidth = lw(1.2);
    c.beginPath(); c.moveTo(262, 332); c.lineTo(276, 262); c.moveTo(322, 332); c.lineTo(296, 262); c.moveTo(214, 470); c.lineTo(326, 470); c.stroke();
    c.fillStyle = ASH; c.font = '700 13px Inter, system-ui, sans-serif'; c.textAlign = 'center';
    if ('letterSpacing' in c) c.letterSpacing = '3px';
    c.fillText('BRK', 292, 372);
    if ('letterSpacing' in c) c.letterSpacing = '0px';
  }
  function roundRect(c, x, y, w, h, r) {
    c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }

  function piecePath(c, p) {
    c.beginPath();
    c.moveTo(p.pts[0], p.pts[1]);
    for (let k = 2; k < p.pts.length; k += 2) c.lineTo(p.pts[k], p.pts[k + 1]);
  }
  function drawSettled(p) {
    const c = floorC.getContext('2d');
    sceneTransform(c);
    c.save();
    c.translate(p.x, p.y); c.scale(1, 0.22); c.rotate(p.a);
    c.strokeStyle = p.tone ? COAL : INK; c.lineWidth = lw(1.3); c.lineCap = 'round';
    piecePath(c, p); c.stroke();
    c.restore();
  }

  /* ---------- Frame ---------- */
  let t0 = now(), last = t0;
  function frame(tms) {
    raf = 0;
    if (!visible) return;
    const dt = Math.min(0.05, (tms - last) / 1000); last = tms;
    const t = (tms - t0) / 1000;
    let active = false;

    // Automatischer Durchgang: Schere läuft am Kopf entlang
    if (auto) {
      const p = auto.dur ? Math.min(1, (tms - auto.start) / auto.dur) : 1;
      const u = auto.u0 + (auto.u1 - auto.u0) * p;
      const a = angleAt(u);
      const rr = HEAD.r + 22;
      aim.x = HEAD.x + Math.cos(a) * rr; aim.y = HEAD.y + Math.sin(a) * rr;
      for (const s of strands) if (s.u >= auto.u0 && s.u <= u) cutStrandToTarget(s);
      snipUntil = tms + 120;
      renderProgress();
      if (p >= 1) { const next = auto.next; auto = null; if (next) next(); }
      active = true;
    } else if (!pointerIn) { aim.x = REST.x; aim.y = REST.y; }

    // Nachwachsen
    if (regrow) {
      const p = regrow.dur ? Math.min(1, (tms - regrow.start) / regrow.dur) : 1;
      const e = 1 - Math.pow(1 - p, 3);
      for (const s of strands) s.L = s.from + (s.L0 - s.from) * e;
      if (p >= 1) { regrow = null; renderProgress(); }
      active = true;
    }

    // Schere folgt (gefedert); bei reduzierter Bewegung direkt
    const k = reduce ? 1 : 1 - Math.pow(0.0008, dt);
    const tx = tip.x + (aim.x - tip.x) * k, ty = tip.y + (aim.y - tip.y) * k;
    if (Math.abs(tx - tip.x) + Math.abs(ty - tip.y) > 0.05) active = true;
    tip.x = tx; tip.y = ty; clampReach(tip);

    // Fallende Strähnen
    if (falling.length) {
      active = true;
      for (let i = falling.length - 1; i >= 0; i--) {
        const p = falling[i];
        p.vy += 900 * dt; p.vx *= 0.985; p.vy *= 0.992;
        p.x += p.vx * dt; p.y += p.vy * dt; p.a += p.va * dt;
        if (p.y >= FLOOR - 4) { falling.splice(i, 1); settle(p); }
      }
    }

    if (active || dirty || !reduce) draw(t, tms);
    dirty = false;
    if (!reduce || active) schedule();
  }

  function draw(t, tms) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bg, 0, 0);
    ctx.drawImage(floorC, 0, 0);
    sceneTransform(ctx);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';

    // Haare: zwei Tonstufen, je ein Pfad
    const sway = reduce ? 0 : 1;
    for (const tone of [true, false]) {
      ctx.beginPath();
      for (const s of strands) {
        if (s.tone !== tone) continue;
        const n = s.L / s.step;
        const kMax = Math.min(SEG, Math.floor(n));
        const sw = sway * Math.sin(t * 1.3 + s.phase) * 0.9;
        ctx.moveTo(s.pts[0], s.pts[1]);
        for (let k = 1; k <= kMax; k++) {
          const off = sw * (k * s.step / 60) * (k * s.step / 60);
          ctx.lineTo(s.pts[k * 2] + off, s.pts[k * 2 + 1]);
        }
        if (kMax < SEG && n > kMax) {
          const f = n - kMax, i = kMax * 2;
          const off = sw * (n * s.step / 60) * (n * s.step / 60);
          ctx.lineTo(s.pts[i] + (s.pts[i + 2] - s.pts[i]) * f + off, s.pts[i + 1] + (s.pts[i + 3] - s.pts[i + 1]) * f);
        }
      }
      ctx.strokeStyle = tone ? COAL : INK;
      ctx.lineWidth = lw(tone ? 1.1 : 1.4);
      ctx.stroke();
    }

    // Fallende Strähnen
    if (falling.length) {
      ctx.strokeStyle = INK; ctx.lineWidth = lw(1.3);
      for (const p of falling) {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); piecePath(ctx, p); ctx.stroke(); ctx.restore();
      }
    }

    // Dampf über dem Kaffee
    if (!reduce) {
      ctx.strokeStyle = ASH; ctx.lineWidth = lw(1);
      ctx.globalAlpha = 0.55 + Math.sin(t * 1.7) * 0.25;
      ctx.beginPath();
      for (const x0 of [906, 917]) {
        const ph = x0 * 0.1;
        ctx.moveTo(x0, 608);
        ctx.bezierCurveTo(x0 + 6 * Math.sin(t * 1.6 + ph), 596, x0 - 6 * Math.sin(t * 1.6 + ph), 586, x0 + 3 * Math.sin(t + ph), 574);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    drawArm(t, tms);
  }

  // Buraks Arm (2-Gelenk-IK, Ellbogen nach unten) und goldene Schere
  function drawArm(t, tms) {
    let dx = tip.x - SHOULDER.x, dy = tip.y - SHOULDER.y;
    const dTip = Math.hypot(dx, dy) || 1;
    const ux = dx / dTip, uy = dy / dTip;
    const hx = tip.x - ux * SCISSOR, hy = tip.y - uy * SCISSOR;
    dx = hx - SHOULDER.x; dy = hy - SHOULDER.y;
    const D = Math.max(30, Math.min(UPPER + FORE - 1, Math.hypot(dx, dy)));
    const base = Math.atan2(dy, dx);
    const off = Math.acos(Math.max(-1, Math.min(1, (UPPER * UPPER + D * D - FORE * FORE) / (2 * UPPER * D))));
    const ex = SHOULDER.x + Math.cos(base + off) * UPPER, ey = SHOULDER.y + Math.sin(base + off) * UPPER;

    ctx.strokeStyle = NIGHT;
    ctx.lineWidth = 30;
    ctx.beginPath(); ctx.moveTo(SHOULDER.x, SHOULDER.y); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.lineWidth = 23;
    ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(hx, hy); ctx.stroke();
    ctx.fillStyle = NIGHT;
    ctx.beginPath(); ctx.arc(hx, hy, 14, 0, Math.PI * 2); ctx.fill();

    // Öffnung: schnippt beim Schneiden, sonst ruhig leicht offen; im Leerlauf ab und zu ein Schnipp
    let open = 0.22;
    if (!reduce) {
      if (tms < snipUntil) open = 0.06 + Math.abs(Math.sin(tms / 38)) * 0.32;
      else if (!pointerIn && !auto) { const c = (t % 3.2); if (c < 0.36) open = 0.06 + Math.abs(Math.sin(c * 17.5)) * 0.24; }
    }
    const px = -uy, py = ux;                      // Senkrechte
    const pvx = hx + ux * 18, pvy = hy + uy * 18; // Drehpunkt
    const len = SCISSOR - 18 + 4;
    ctx.fillStyle = GOLD; ctx.strokeStyle = GOLD; ctx.lineWidth = lw(2);
    for (const sgn of [1, -1]) {
      const ang = Math.atan2(uy, ux) + sgn * open;
      const bx = pvx + Math.cos(ang) * len, by = pvy + Math.sin(ang) * len;
      const nx = -Math.sin(ang) * 2.6, ny = Math.cos(ang) * 2.6;
      ctx.beginPath(); ctx.moveTo(pvx + nx, pvy + ny); ctx.lineTo(bx, by); ctx.lineTo(pvx - nx, pvy - ny); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.arc(hx - ux * 2 + px * sgn * 8, hy - uy * 2 + py * sgn * 8, 6.5, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.fillStyle = NIGHT; ctx.beginPath(); ctx.arc(pvx, pvy, 2.2, 0, Math.PI * 2); ctx.fill();
  }

  /* ---------- Schleife nur bei Sichtbarkeit ---------- */
  let raf = 0, visible = false;
  function schedule() { if (!raf && visible) raf = requestAnimationFrame(frame); }
  function kick() { dirty = true; last = now(); schedule(); }

  /* ---------- Eingabe: Pointer Events ---------- */
  let lastP = null, lastT = 0, activeId = null;
  function markStarted() { if (!started) { started = true; stage.classList.add('is-playing'); } }
  stage.addEventListener('pointerdown', (e) => {
    if (done || regrow) return;
    activeId = e.pointerId;
    if (e.pointerType !== 'mouse') { try { stage.setPointerCapture(e.pointerId); } catch (_) { /* egal */ } }
    pointerIn = true;
    const p = clampReach(toScene(e.clientX, e.clientY));
    aim.x = p.x; aim.y = p.y; lastP = p; lastT = e.timeStamp;
    if (e.pointerType !== 'mouse') e.preventDefault();
    kick();
  });
  stage.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' && e.pointerId !== activeId) return;
    pointerIn = true;
    const p = clampReach(toScene(e.clientX, e.clientY));
    aim.x = p.x; aim.y = p.y;
    if (!done && !regrow && !auto && lastP) {
      const dtv = Math.max(1, e.timeStamp - lastT);
      const vx = (p.x - lastP.x) / dtv * 1000;
      if (cutAlong(lastP.x, lastP.y, p.x, p.y, e.pointerType === 'mouse' ? 24 : 34, vx)) markStarted();
    }
    lastP = p; lastT = e.timeStamp;
    kick();
  });
  const leave = (e) => {
    if (e.pointerType !== 'mouse' && e.pointerId !== activeId) return;
    if (e.pointerType !== 'mouse' || e.type === 'pointerleave') { pointerIn = false; lastP = null; activeId = null; }
    kick();
  };
  stage.addEventListener('pointerup', leave);
  stage.addEventListener('pointercancel', leave);
  stage.addEventListener('pointerleave', leave);

  /* ---------- Tastatur & Buttons ---------- */
  const PASSES = 7;
  function cutPass() {
    if (done || regrow || auto) return;
    markStarted();
    // nächsten Abschnitt mit ungeschnittenen Strähnen suchen
    for (let i = 0; i < PASSES; i++) {
      const u0 = i / PASSES, u1 = (i + 1) / PASSES;
      if (strands.some((s) => s.u >= u0 && s.u <= u1 && s.L > s.T + 0.5)) {
        auto = { u0, u1, start: now(), dur: reduce ? 0 : 650 };
        kick();
        return;
      }
    }
  }
  stage.addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); keyboardUsed = true; cutPass(); }
  });
  let keyboardUsed = false;
  game.querySelector('[data-game-cut]').addEventListener('click', (e) => { keyboardUsed = e.detail === 0; cutPass(); });
  game.querySelector('[data-game-reset]').addEventListener('click', () => reset());
  game.querySelector('[data-game-again]').addEventListener('click', () => { reset(); stage.focus({ preventScroll: true }); });
  game.querySelectorAll('input[name="game-style"]').forEach((r) => r.addEventListener('change', () => {
    if (!r.checked) return;
    style = r.value;
    const cut = strands.some((s) => s.L < s.L0 - 0.5);
    if (cut || done) reset(); else { applyStyle(); renderProgress(); }
  }));

  function finish() {
    if (done) return;
    done = true;
    // Feinschliff: Rest sauber auf Ziellänge
    const run = () => {
      for (const s of strands) cutStrandToTarget(s);
      snipUntil = now() + 300;
      renderProgress();
      liveEl.textContent = 'Schnitt 100 Prozent. Sitzt. Jetzt das Original buchen.';
      actionsEl.hidden = true;
      doneEl.hidden = false;
      if (keyboardUsed) doneTitle.focus({ preventScroll: true });
      kick();
    };
    if (auto) { const a = auto; a.next = run; } else run();
  }

  function reset() {
    done = false; announced = 0; auto = null;
    for (const s of strands) s.from = s.L;
    applyStyle();
    falling.length = 0; settled.length = 0;
    floorC.getContext('2d').clearRect(0, 0, floorC.width, floorC.height);
    regrow = { start: now(), dur: reduce ? 0 : 1100 };
    doneEl.hidden = true; actionsEl.hidden = false;
    liveEl.textContent = 'Die Haare sind nachgewachsen. Schnitt 0 Prozent.';
    pctEl.textContent = '0\u00a0%'; barEl.style.transform = 'scaleX(0)';
    kick();
  }

  /* ---------- Start ---------- */
  buildHair();
  let firstView = true;
  const io = new IntersectionObserver((entries) => {
    visible = entries[0].isIntersecting && !document.hidden;
    if (visible) {
      if (firstView) {
        firstView = false;
        // Auftritt: die Haare „wachsen“ einmal kurz heran
        if (!reduce) { for (const s of strands) s.from = s.exit; regrow = { start: now(), dur: 1400 }; }
      }
      kick();
    }
  }, { rootMargin: '120px 0px' });
  io.observe(stage);
  document.addEventListener('visibilitychange', () => { visible = !document.hidden && stage.getBoundingClientRect().bottom > 0 && stage.getBoundingClientRect().top < window.innerHeight; if (visible) kick(); });
  if ('ResizeObserver' in window) new ResizeObserver(() => { resize(); kick(); }).observe(stage);
  else window.addEventListener('resize', () => { resize(); kick(); });
  resize();
  renderProgress();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { drawStatic(); kick(); });

  // Für QA/Tests: aktueller Stand
  window.__brkGame = { get progress() { return progress; }, get done() { return done; } };
})();
