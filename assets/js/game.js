/* =========================================================
   BRK Studio – Mini-Spiel „Einmal Burak sein“ (Version 2)
   Canvas 2D, ohne Bibliotheken.
   Haarmodell: rund 520 Strähnen wachsen aus der Kopfhaut (Kappe über Stirn,
   Scheitel, Seite und Nacken), liegen nach hinten gekämmt am Kopf an und fallen
   hinter dem Kopf weich nach unten. Jede Strähne ist eine Polylinie.
   Schneiden: nur bei gedrückter Maus bzw. aufgesetztem Finger. Für jede Bewegung
   wird der Schnittpunkt zwischen Scherenweg (Liniensegment) und Strähne exakt
   berechnet; die Strähne endet genau dort, das abgetrennte Stück fällt als eigenes Teil.
   Fortschritt = Nähe zur Zielkontur (Fade, Classic, Buzz); zu kurz kostet wenig.
   Statische Zeichnung und Haarebene werden gecacht, pro Frame nur Komposition,
   Arm, Schere und fallende Stücke. Schleife nur bei Sichtbarkeit.
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
  const mqMobile = window.matchMedia('(max-width: 639px)');
  const W = 1000, H = 900, FLOOR = 832;
  const INK = '#1A1A1A', NIGHT = '#0A0A0A', COAL = '#2A2A2A', IRON = '#4A4A4A', ASH = '#B0B0B0', GOLD = '#C9A96E';

  const pctEl = game.querySelector('[data-game-pct]');
  const barEl = game.querySelector('[data-game-bar]');
  const liveEl = game.querySelector('[data-game-live]');
  const doneEl = game.querySelector('[data-game-done]');
  const doneTitle = game.querySelector('[data-game-done-title]');
  const doneText = game.querySelector('[data-game-done-text]');
  const actionsEl = game.querySelector('[data-game-actions]');
  const bookBtn = game.querySelector('[data-game-book]');

  /* ---------- Szene ---------- */
  const HEAD = { x: 585, y: 345, r: 60 };
  const SHOULDER = { x: 312, y: 296 };
  const UPPER = 165, FORE = 165, SCISSOR = 46;
  const REACH = UPPER + FORE + SCISSOR - 8;
  const REST = { x: 470, y: 250 };
  const TOL = 3;          // Toleranz an der Zielkontur (Szene-Einheiten)
  const MINL = 1.5;       // kürzer geht es nicht (Kopfhaut)
  const STEP = 5;         // Punktabstand einer Strähne

  const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  // Zielfrisuren: Länge je Strähne aus der Höhe des Haaransatzes (t = 1 Scheitel, 0 Nacken/Seite)
  const STYLES = {
    fade: (t) => 3 + 40 * smooth(0.45, 0.86, t),
    classic: (t) => 6 + 26 * smooth(0, 0.78, t),
    buzz: () => 4,
  };
  const BOOK = { fade: 'sv_wss', classic: 'sv_wss', buzz: 'sv_fast' };   // IDs der Leistungen (Plattform)
  const LABEL = { fade: 'Fade', classic: 'Classic', buzz: 'Buzz' };

  let seed = 1;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

  /* Haarkappe: innerhalb des Schädels, über Haaransatz, Koteletten und Nacken, ohne Gesicht und Ohr */
  function inCap(x, y) {
    const dx = x - HEAD.x, dy = y - HEAD.y;
    if (dx * dx + dy * dy > (HEAD.r - 1.2) ** 2) return false;
    if (y > 296 && x > 602 + 34 * Math.max(0, 1 - (y - 296) / 48) ** 1.7) return false;   // Haaransatz: Stirn, Schläfe, Koteletten
    if (x > 598 && y > 370) return false;                            // unter der Koteletten
    if ((x - 586) ** 2 + (y - 360) ** 2 < 14 * 14) return false;     // Ohr
    if (x > 572 && y > 376) return false;                            // Kiefer
    return y < 401;                                                  // Nacken
  }

  const strands = [];
  /* Kämmrichtung: Kreisbahnen um einen Punkt vor dem Gesicht. Dadurch läuft das Haar
     oben nach hinten, am Hinterkopf nach unten und an der Seite schräg nach hinten unten,
     ohne Wirbel innerhalb der Haarkappe. */
  const FLOW = { x: 655, y: 372 };
  function flowDir(x, y) {
    const rx = x - FLOW.x, ry = y - FLOW.y, m = Math.hypot(rx, ry) || 1;
    return [ry / m, -rx / m];
  }
  function buildHair() {
    seed = 7;
    strands.length = 0;
    const roots = [];
    // dichtes, leicht gestreutes Raster in der Kappe
    for (let y = HEAD.y - HEAD.r; y < HEAD.y + HEAD.r; y += 3.6) {
      for (let x = HEAD.x - HEAD.r; x < HEAD.x + HEAD.r; x += 3.6) {
        const jx = x + (rnd() - 0.5) * 3, jy = y + (rnd() - 0.5) * 3;
        if (inCap(jx, jy)) roots.push([jx, jy]);
      }
    }
    // Haaransatz entlang der Kontur doppelt besetzt: saubere Silhouette
    for (let a = -0.5; a > -4.05; a -= 0.016) {
      for (const d of [2, 5]) {
        const x = HEAD.x + Math.cos(a) * (HEAD.r - d), y = HEAD.y + Math.sin(a) * (HEAD.r - d);
        if (inCap(x, y)) roots.push([x, y]);
      }
    }
    // hinten liegende Wurzeln zuerst zeichnen, die Außenkontur obenauf
    roots.sort((p, q) => Math.hypot(p[0] - HEAD.x, p[1] - HEAD.y) - Math.hypot(q[0] - HEAD.x, q[1] - HEAD.y));
    for (const [x0, y0] of roots) {
      const rho0 = Math.hypot(x0 - HEAD.x, y0 - HEAD.y);
      const t = Math.min(1, Math.max(0, (HEAD.y + 18 - y0) / (HEAD.r + 18)));   // 1 Scheitel, 0 Nacken
      const front = x0 > 592 && y0 > HEAD.y - 20;          // Koteletten bleiben kürzer
      const L0 = (36 + 46 * t + rnd() * 12) * (front ? 0.55 : 1);
      const vol = 3 + 9 * t + rnd() * 3;                 // wie weit das Haar über dem Kopf liegt
      const nx0 = (x0 - HEAD.x) / (rho0 || 1), ny0 = (y0 - HEAD.y) / (rho0 || 1);
      const ph = rnd() * 6.28, wav = 0.012 + rnd() * 0.02, bias = (rnd() - 0.5) * 0.16;
      const n = Math.ceil(L0 / STEP);
      const pts = new Float32Array((n + 1) * 2);
      let x = x0, y = y0, dx = 0, dy = 0, fall = false;
      pts[0] = x; pts[1] = y;
      for (let k = 1; k <= n; k++) {
        const sl = k * STEP;
        if (!fall) {
          let [fx, fy] = flowDir(x, y);
          // anfangs aus der Kopfhaut heraus, dann angelegt
          const lift = rho0 > HEAD.r - 7 ? Math.max(0, 1 - sl / 10) * 0.5 : 0;
          const c = Math.cos(bias + Math.sin(sl * wav * 6 + ph) * 0.08), sn = Math.sin(bias + Math.sin(sl * wav * 6 + ph) * 0.08);
          { const tx = fx * c - fy * sn; fy = fx * sn + fy * c; fx = tx; }
          dx = fx + nx0 * lift; dy = fy + ny0 * lift;
          const m = Math.hypot(dx, dy) || 1; dx /= m; dy /= m;
          x += dx * STEP; y += dy * STEP;
          // nicht weiter abstehen als das Volumen erlaubt: sanft an die Hülle legen
          const r = Math.hypot(x - HEAD.x, y - HEAD.y), lim = HEAD.r + vol;
          if (r > lim) { x = HEAD.x + ((x - HEAD.x) / r) * lim; y = HEAD.y + ((y - HEAD.y) / r) * lim; }
          // unterhalb der Kopfmitte und hinter dem Ohr fällt es frei
          if (y > HEAD.y + 22 && (r > HEAD.r - 4 || y > 392)) fall = true;
        } else {
          dy += 0.3; dx = dx * 0.86 - 0.06;
          const m = Math.hypot(dx, dy); dx /= m; dy /= m;
          x += dx * STEP; y += dy * STEP;
          if (x > 560 && y > 404) x = 560 - (y - 404) * 0.05;   // hinter dem Hals bleiben
        }
        pts[k * 2] = x; pts[k * 2 + 1] = y;
      }
      strands.push({ pts, n, L0, L: L0, T: 0, t, from: L0, hi: rnd() < 0.16, edge: rho0 > HEAD.r - 7 });
    }
    buildCap();
    applyStyle();
  }

  /* Kopfhaut mit Stoppeln: Form der Haarkappe einmal rastern */
  let capImg = null;
  function buildCap() {
    const R = 4, x0 = HEAD.x - HEAD.r, y0 = HEAD.y - HEAD.r, n = HEAD.r * 2 * R;
    const cv = document.createElement('canvas'); cv.width = n; cv.height = n;
    const c = cv.getContext('2d'), img = c.createImageData(n, n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      // weiche Kante über 4 Unterproben
      let a = 0;
      for (const [u, v] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) if (inCap(x0 + (i + u) / R, y0 + (j + v) / R)) a++;
      if (!a) continue;
      const o = (j * n + i) * 4; img.data[o] = 0x2a; img.data[o + 1] = 0x2a; img.data[o + 2] = 0x2a; img.data[o + 3] = a * 60;
    }
    c.putImageData(img, 0, 0);
    capImg = { cv, x: x0, y: y0, s: 1 / R };
  }

  let style = 'fade';
  let contour = null;
  function applyStyle() {
    const f = STYLES[style];
    for (const s of strands) s.T = Math.min(s.L0 - 2, f(s.t));
    if (bookBtn) bookBtn.dataset.book = BOOK[style];
    contour = buildContour();
    hairDirty = true;
  }

  /* Zielkontur: äußere Hülle aller Strähnen auf Ziellänge (Polarkoordinaten um den Kopf) */
  function buildContour() {
    const BINS = 120, maxR = new Float32Array(BINS);
    const bin = (x, y) => { let a = Math.atan2(y - HEAD.y, x - HEAD.x); if (a < 0) a += Math.PI * 2; return Math.floor((a / (Math.PI * 2)) * BINS) % BINS; };
    for (const s of strands) {
      const kMax = Math.min(s.n, Math.floor(s.T / STEP));
      for (let k = 0; k <= kMax; k++) {
        const x = s.pts[k * 2], y = s.pts[k * 2 + 1];
        const r = Math.hypot(x - HEAD.x, y - HEAD.y), b = bin(x, y);
        if (r > maxR[b]) maxR[b] = r;
      }
      const e = pointAt(s, s.T), b = bin(e[0], e[1]), r = Math.hypot(e[0] - HEAD.x, e[1] - HEAD.y);
      if (r > maxR[b]) maxR[b] = r;
    }
    const pts = [];
    for (let i = 0; i < BINS; i++) {
      if (maxR[i] < HEAD.r - 6) { pts.push(null); continue; }
      const r = (maxR[(i + BINS - 1) % BINS] + 2 * maxR[i] + maxR[(i + 1) % BINS]) / 4 + 2.5;
      const a = ((i + 0.5) / BINS) * Math.PI * 2;
      pts.push([HEAD.x + Math.cos(a) * Math.max(r, HEAD.r + 2), HEAD.y + Math.sin(a) * Math.max(r, HEAD.r + 2)]);
    }
    return pts;
  }

  function pointAt(s, len) {
    const f = Math.min(s.n, len / STEP), k = Math.min(s.n - 1, Math.floor(f)), u = f - k;
    return [s.pts[k * 2] + (s.pts[k * 2 + 2] - s.pts[k * 2]) * u, s.pts[k * 2 + 1] + (s.pts[k * 2 + 3] - s.pts[k * 2 + 1]) * u];
  }

  /* ---------- Fortschritt: Nähe zur Zielkontur ---------- */
  let progress = 0, remain = 1, announced = 0, done = false;
  function measure() {
    let wsum = 0, acc = 0, rem = 0;
    for (const s of strands) {
      const w = Math.max(1, s.L0 - s.T);
      wsum += w;
      let c;
      if (s.L > s.T + TOL) { const r = (s.L - s.T - TOL) / Math.max(1, s.L0 - s.T - TOL); c = 1 - r; rem += w * r; }
      else if (s.L >= s.T - TOL) c = 1;
      else c = 1 - 0.3 * Math.min(1, (s.T - TOL - s.L) / Math.max(8, s.T));   // zu kurz: kleiner Abzug
      acc += w * c;
    }
    return { acc: acc / wsum, remain: rem / wsum };
  }
  function renderProgress() {
    const m = measure();
    progress = m.acc; remain = m.remain;
    const p = Math.max(0, Math.min(100, Math.round(progress * 100)));
    pctEl.textContent = `${p}\u00a0%`;
    barEl.style.transform = `scaleX(${p / 100})`;
    const step = Math.floor(p / 25) * 25;
    if (step > announced && !done) { announced = step; liveEl.textContent = `Schnitt ${p} Prozent an der Zielkontur`; }
    if (!done && remain <= 0.07) finish();
  }

  /* ---------- Fallende und liegende Stücke ---------- */
  const falling = [];
  const settled = [];
  function spawnPiece(s, fromL, toL, vx) {
    const out = [];
    const a = pointAt(s, fromL); out.push(a[0], a[1]);
    for (let k = Math.floor(fromL / STEP) + 1; k * STEP < toL && k <= s.n; k++) out.push(s.pts[k * 2], s.pts[k * 2 + 1]);
    const b = pointAt(s, toL); out.push(b[0], b[1]);
    if (out.length < 4 || toL - fromL < 0.8) return;
    let cx = 0, cy = 0; const n = out.length / 2;
    for (let k = 0; k < out.length; k += 2) { cx += out[k]; cy += out[k + 1]; }
    cx /= n; cy /= n;
    for (let k = 0; k < out.length; k += 2) { out[k] -= cx; out[k + 1] -= cy; }
    const p = { pts: out, x: cx, y: cy, vx: (vx || 0) * 0.08 + (Math.random() - 0.5) * 50, vy: -10 - Math.random() * 40, a: 0, va: (Math.random() - 0.5) * 2.4, hi: s.hi, len: toL - fromL };
    if (reduce || falling.length > 320) settle(p); else falling.push(p);
  }
  function settle(p) {
    p.y = FLOOR - 2 - Math.random() * 4;
    p.x = Math.max(380, Math.min(900, p.x + (reduce ? 0 : (Math.random() - 0.5) * 24)));
    settled.push(p);
    if (settled.length > 1400) settled.splice(0, settled.length - 1400);
    drawSettled(p);
  }

  /* ---------- Exakter Schnitt: Segment (Scherenweg) gegen Segmente der Strähne ---------- */
  function segHit(ax, ay, bx, by, cx, cy, dx, dy) {
    const rx = bx - ax, ry = by - ay, sx = dx - cx, sy = dy - cy;
    const den = rx * sy - ry * sx;
    if (Math.abs(den) < 1e-9) return -1;
    const qx = cx - ax, qy = cy - ay;
    const t = (qx * sy - qy * sx) / den;     // auf dem Scherenweg
    const u = (qx * ry - qy * rx) / den;     // auf der Strähne
    return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? u : -1;
  }
  let cutCount = 0;
  function cutLine(ax, ay, bx, by, vx) {
    if (Math.hypot(bx - ax, by - ay) < 0.3) return false;
    let any = false;
    for (const s of strands) {
      if (s.L <= MINL + 0.5) continue;
      const segs = Math.min(s.n, Math.ceil(s.L / STEP));
      for (let k = 0; k < segs; k++) {
        const segLen = Math.min(STEP, s.L - k * STEP);
        if (segLen <= 0) break;
        const x1 = s.pts[k * 2], y1 = s.pts[k * 2 + 1];
        let x2 = s.pts[k * 2 + 2], y2 = s.pts[k * 2 + 3];
        if (segLen < STEP) { x2 = x1 + (x2 - x1) * (segLen / STEP); y2 = y1 + (y2 - y1) * (segLen / STEP); }
        const u = segHit(ax, ay, bx, by, x1, y1, x2, y2);
        if (u >= 0) {
          const at = Math.max(MINL, k * STEP + u * segLen);
          if (at < s.L - 0.6) { spawnPiece(s, at, s.L, vx); s.L = at; any = true; cutCount++; }
          break;                           // nur der erste Treffer ab der Wurzel zählt
        }
      }
    }
    if (any) { snipAt = now(); hairDirty = true; renderProgress(); }
    return any;
  }
  function cutStrandTo(s, len) { if (s.L > len + 0.5) { spawnPiece(s, len, s.L, 0); s.L = len; hairDirty = true; } }

  /* ---------- Zustand Schere/Arm ---------- */
  const now = () => performance.now();
  const tip = { x: REST.x, y: REST.y };
  const aim = { x: REST.x, y: REST.y };
  let pointerIn = false, pressing = false, snipAt = -1e9, hairDirty = true, dirty = true, started = false;
  let auto = null, regrow = null;

  function clampReach(p) {
    const dx = p.x - SHOULDER.x, dy = p.y - SHOULDER.y, d = Math.hypot(dx, dy);
    if (d > REACH) { p.x = SHOULDER.x + (dx / d) * REACH; p.y = SHOULDER.y + (dy / d) * REACH; }
    if (p.y > FLOOR - 20) p.y = FLOOR - 20;
    return p;
  }

  /* ---------- Ausschnitt, Größe, Pixeldichte ---------- */
  // Mobil: näher an Kopf und Schere heran, damit man mit dem Finger präzise schneiden kann
  const VIEW_DESK = { x: 0, y: 90, w: 1000, h: 810 };
  const VIEW_MOB = { x: 150, y: 58, w: 688, h: 796 };
  let view = VIEW_DESK, scale = 1, dpr = 1, cssW = 0, cssH = 0, ox = 0, oy = 0;
  const bg = document.createElement('canvas');
  const hairC = document.createElement('canvas');
  const floorC = document.createElement('canvas');
  function resize() {
    const r = stage.getBoundingClientRect();
    if (!r.width) return;
    view = mqMobile.matches ? VIEW_MOB : VIEW_DESK;
    cssW = r.width; cssH = r.height;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    scale = Math.min(cssW / view.w, cssH / view.h);
    ox = (cssW - view.w * scale) / 2 - view.x * scale;
    oy = cssH - view.h * scale - view.y * scale;
    for (const c of [canvas, bg, hairC, floorC]) { c.width = Math.round(cssW * dpr); c.height = Math.round(cssH * dpr); }
    drawStatic();
    floorC.getContext('2d').clearRect(0, 0, floorC.width, floorC.height);
    for (const p of settled) drawSettled(p);
    hairDirty = true; dirty = true;
  }
  function sceneTransform(c) { c.setTransform(dpr * scale, 0, 0, dpr * scale, ox * dpr, oy * dpr); }
  function toScene(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
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


  /* ---------- Haarebene (gecacht, nur nach einem Schnitt neu) ---------- */
  function strandPath(c, s) {
    const n = s.L / STEP, kMax = Math.min(s.n, Math.floor(n));
    c.moveTo(s.pts[0], s.pts[1]);
    for (let k = 1; k <= kMax; k++) c.lineTo(s.pts[k * 2], s.pts[k * 2 + 1]);
    if (kMax < s.n && n > kMax) { const p = pointAt(s, s.L); c.lineTo(p[0], p[1]); }
  }
  function drawHair() {
    const c = hairC.getContext('2d');
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, hairC.width, hairC.height);
    sceneTransform(c);
    c.lineCap = 'round'; c.lineJoin = 'round';
    // 0) Kopfhaut mit Stoppeln
    if (capImg) { c.imageSmoothingEnabled = true; c.drawImage(capImg.cv, capImg.x, capImg.y, HEAD.r * 2, HEAD.r * 2); }
    // 1) Volumen: kurze Haare fein, lange voll
    c.strokeStyle = INK;
    for (const [lo, hi, w] of [[0, 6, 1.3], [6, 14, 2.3], [14, 1e9, 3.4]]) {
      c.lineWidth = w; c.beginPath();
      for (const s of strands) if (s.L > lo && s.L <= hi) strandPath(c, s);
      c.stroke();
    }
    // 2) Strähnenzeichnung
    c.strokeStyle = NIGHT; c.lineWidth = lw(0.7);
    c.beginPath(); for (const s of strands) if (s.L > 6) strandPath(c, s); c.stroke();
    // 3) Glanzlinien
    c.strokeStyle = IRON; c.lineWidth = lw(0.6);
    c.beginPath(); for (const s of strands) if (s.hi && s.L > 14) strandPath(c, s); c.stroke();
    // Zielkontur, dezent gestrichelt
    if (!done && contour) {
      c.strokeStyle = 'rgba(74,74,74,.65)'; c.lineWidth = lw(1); c.setLineDash([3, 4]);
      c.beginPath();
      let pen = false;
      for (const p of contour) { if (!p) { pen = false; continue; } if (!pen) { c.moveTo(p[0], p[1]); pen = true; } else c.lineTo(p[0], p[1]); }
      c.stroke(); c.setLineDash([]);
    }
    hairDirty = false;
  }
  function piecePath(c, p) { c.beginPath(); c.moveTo(p.pts[0], p.pts[1]); for (let k = 2; k < p.pts.length; k += 2) c.lineTo(p.pts[k], p.pts[k + 1]); }
  function strokePiece(c, p) {
    c.strokeStyle = INK; c.lineWidth = 3.4; piecePath(c, p); c.stroke();
    c.strokeStyle = p.hi ? IRON : NIGHT; c.lineWidth = lw(0.9); piecePath(c, p); c.stroke();
  }
  function drawSettled(p) {
    const c = floorC.getContext('2d');
    sceneTransform(c);
    c.save(); c.lineCap = 'round'; c.translate(p.x, p.y); c.scale(1, 0.2); c.rotate(p.a);
    strokePiece(c, p); c.restore();
  }

  /* ---------- Frame ---------- */
  let last = now(), t0 = last;
  function frame(tms) {
    raf = 0;
    if (!visible) return;
    const dt = Math.min(0.05, (tms - last) / 1000); last = tms;
    let active = false;

    if (auto) {
      const p = auto.dur ? Math.min(1, (tms - auto.start) / auto.dur) : 1;
      const e = p * p * (3 - 2 * p);
      const idx = Math.floor(e * (auto.list.length - 1));
      for (let i = auto.done; i <= idx; i++) cutStrandTo(auto.list[i], auto.list[i].T);
      auto.done = idx + 1;
      const cur = auto.list[Math.min(idx, auto.list.length - 1)];
      if (cur) { const q = pointAt(cur, cur.T); aim.x = q[0]; aim.y = q[1]; }
      snipAt = tms;
      renderProgress();
      if (p >= 1) { const next = auto.next; auto = null; if (next) next(); }
      active = true;
    } else if (!pointerIn) { aim.x = REST.x; aim.y = REST.y; }

    if (regrow) {
      const p = regrow.dur ? Math.min(1, (tms - regrow.start) / regrow.dur) : 1;
      const e = 1 - Math.pow(1 - p, 3);
      for (const s of strands) s.L = s.from + (s.L0 - s.from) * e;
      hairDirty = true;
      if (p >= 1) { regrow = null; renderProgress(); }
      active = true;
    }

    // Beim Schneiden sitzt die Schere exakt am Zeiger, sonst gefedert
    if (pressing) { tip.x = aim.x; tip.y = aim.y; }
    else {
      const k = reduce ? 1 : 1 - Math.pow(0.0006, dt);
      const nx = tip.x + (aim.x - tip.x) * k, ny = tip.y + (aim.y - tip.y) * k;
      if (Math.abs(nx - tip.x) + Math.abs(ny - tip.y) > 0.05) active = true;
      tip.x = nx; tip.y = ny;
    }

    if (falling.length) {
      active = true;
      for (let i = falling.length - 1; i >= 0; i--) {
        const p = falling[i];
        p.vy += 820 * dt; p.vx *= 0.985; p.vy *= 0.993;
        p.x += p.vx * dt; p.y += p.vy * dt; p.a += p.va * dt;
        if (p.y >= FLOOR - 4) { falling.splice(i, 1); settle(p); }
      }
    }
    const snipping = tms - snipAt < 160;
    const idleSnip = !reduce && !pointerIn && !auto && ((tms - t0) / 1000) % 3.4 < 0.4;
    if (snipping || idleSnip) active = true;

    if (hairDirty) drawHair();
    if (active || dirty) draw(tms);
    dirty = false;
    if (active || !reduce) schedule();
  }

  function draw(tms) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bg, 0, 0);
    ctx.drawImage(floorC, 0, 0);
    ctx.drawImage(hairC, 0, 0);
    sceneTransform(ctx);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const p of falling) { ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); strokePiece(ctx, p); ctx.restore(); }
    if (!reduce) {
      const t = (tms - t0) / 1000;
      ctx.strokeStyle = ASH; ctx.lineWidth = lw(1); ctx.globalAlpha = 0.55 + Math.sin(t * 1.7) * 0.25;
      ctx.beginPath();
      for (const x0 of [906, 917]) { const ph = x0 * 0.1; ctx.moveTo(x0, 608); ctx.bezierCurveTo(x0 + 6 * Math.sin(t * 1.6 + ph), 596, x0 - 6 * Math.sin(t * 1.6 + ph), 586, x0 + 3 * Math.sin(t + ph), 574); }
      ctx.stroke(); ctx.globalAlpha = 1;
    }
    drawArm(tms);
  }

  // Buraks Arm (2-Gelenk-IK, Ellbogen unten) und goldene Schere; Spitze = Schneidpunkt
  function drawArm(tms) {
    let dx = tip.x - SHOULDER.x, dy = tip.y - SHOULDER.y;
    const dTip = Math.hypot(dx, dy) || 1;
    const ux = dx / dTip, uy = dy / dTip;
    const hx = tip.x - ux * SCISSOR, hy = tip.y - uy * SCISSOR;
    dx = hx - SHOULDER.x; dy = hy - SHOULDER.y;
    const D = Math.max(30, Math.min(UPPER + FORE - 1, Math.hypot(dx, dy)));
    const base = Math.atan2(dy, dx);
    const off = Math.acos(Math.max(-1, Math.min(1, (UPPER * UPPER + D * D - FORE * FORE) / (2 * UPPER * D))));
    const ex = SHOULDER.x + Math.cos(base + off) * UPPER, ey = SHOULDER.y + Math.sin(base + off) * UPPER;
    const ax = SHOULDER.x + Math.cos(base) * D, ay = SHOULDER.y + Math.sin(base) * D; // Hand (falls außer Reichweite)
    ctx.strokeStyle = NIGHT;
    ctx.lineWidth = 30; ctx.beginPath(); ctx.moveTo(SHOULDER.x, SHOULDER.y); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.lineWidth = 23; ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(ax, ay); ctx.stroke();
    ctx.fillStyle = NIGHT; ctx.beginPath(); ctx.arc(ax, ay, 14, 0, Math.PI * 2); ctx.fill();

    // Öffnung: offen beim Zielen, schließt bei jedem Schnitt kurz („Schnipp“)
    let open = pressing ? 0.3 : 0.2;
    const since = tms - snipAt;
    if (since < 160) open = reduce ? 0.04 : 0.04 + (since / 160) * 0.26;
    else if (!reduce && !pointerIn && !auto) { const c = ((tms - t0) / 1000) % 3.4; if (c < 0.4) open = 0.05 + Math.abs(Math.sin(c * 15.7)) * 0.2; }
    const px = -uy, py = ux;
    const pvx = tip.x - ux * (SCISSOR - 18), pvy = tip.y - uy * (SCISSOR - 18);
    const len = SCISSOR - 18;
    ctx.fillStyle = GOLD; ctx.strokeStyle = GOLD; ctx.lineWidth = lw(2);
    for (const sgn of [1, -1]) {
      const ang = Math.atan2(uy, ux) + sgn * open;
      const bx = pvx + Math.cos(ang) * len, by = pvy + Math.sin(ang) * len;
      const nx = -Math.sin(ang) * 2.6, ny = Math.cos(ang) * 2.6;
      ctx.beginPath(); ctx.moveTo(pvx + nx, pvy + ny); ctx.lineTo(bx, by); ctx.lineTo(pvx - nx, pvy - ny); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.arc(hx - ux * 2 + px * sgn * 8, hy - uy * 2 + py * sgn * 8, 6.5, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.fillStyle = NIGHT; ctx.beginPath(); ctx.arc(pvx, pvy, 2.2, 0, Math.PI * 2); ctx.fill();
    // feines Fadenkreuz am Schneidpunkt, solange gezielt wird
    if (pointerIn && !auto) {
      ctx.strokeStyle = pressing ? NIGHT : IRON; ctx.lineWidth = lw(1); ctx.globalAlpha = 0.8;
      ctx.beginPath(); ctx.arc(tip.x, tip.y, 4, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
    }
  }

  /* ---------- Schleife nur bei Sichtbarkeit ---------- */
  let raf = 0, visible = false;
  function schedule() { if (!raf && visible) raf = requestAnimationFrame(frame); }
  function kick() { dirty = true; last = now(); schedule(); }

  /* ---------- Eingabe: Pointer Events (schneidet nur gedrückt) ---------- */
  let lastP = null, lastT = 0, activeId = null;
  function markStarted() { if (!started) { started = true; stage.classList.add('is-playing'); } }
  function scenePoint(e) { return toScene(e.clientX, e.clientY); }
  stage.addEventListener('pointerdown', (e) => {
    if (e.button !== undefined && e.button > 0) return;
    if (done || regrow || auto) return;
    activeId = e.pointerId; pressing = true; pointerIn = true;
    try { stage.setPointerCapture(e.pointerId); } catch (_) { /* egal */ }
    const p = scenePoint(e);
    aim.x = p.x; aim.y = p.y; tip.x = p.x; tip.y = p.y;
    lastP = p; lastT = e.timeStamp; snipAt = now();
    markStarted();
    e.preventDefault();
    kick();
  });
  stage.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' && e.pointerId !== activeId) return;
    pointerIn = true;
    // zusammengefasste Events nutzen, damit schnelle Bewegungen lückenlos schneiden
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
    const list = evs.length ? evs : [e];
    for (const ce of list) {
      const p = scenePoint(ce);
      if (pressing && !done && !regrow && !auto && lastP) {
        const dtv = Math.max(1, ce.timeStamp - lastT);
        cutLine(lastP.x, lastP.y, p.x, p.y, ((p.x - lastP.x) / dtv) * 1000);
      }
      lastP = p; lastT = ce.timeStamp;
      aim.x = p.x; aim.y = p.y;
    }
    kick();
  });
  const release = (e) => {
    if (e.pointerId !== activeId && e.type !== 'pointerleave') return;
    if (e.type === 'pointerleave' && pressing && e.pointerType === 'mouse') return; // Capture hält den Schnitt
    pressing = false;
    if (e.pointerType !== 'mouse' || e.type === 'pointerleave') { pointerIn = false; lastP = null; }
    if (e.type !== 'pointerleave') activeId = null;
    kick();
  };
  stage.addEventListener('pointerup', release);
  stage.addEventListener('pointercancel', release);
  stage.addEventListener('pointerleave', (e) => { if (!pressing) { pointerIn = false; lastP = null; kick(); } });
  stage.addEventListener('contextmenu', (e) => e.preventDefault());

  /* ---------- Tastatur & Buttons: Burak schneidet abschnittsweise exakt auf Kontur ---------- */
  const PASSES = 6;
  let keyboardUsed = false;
  function cutPass() {
    if (done || regrow || auto) return;
    markStarted();
    for (let i = 0; i < PASSES; i++) {
      const lo = 1 - (i + 1) / PASSES, hi = 1 - i / PASSES;   // von oben nach unten
      const list = strands.filter((s) => s.t >= lo - 1e-6 && s.t <= hi + 1e-6 && s.L > s.T + 0.5).sort((a, b) => a.pts[0] - b.pts[0]);
      if (list.length) { auto = { list, done: 0, start: now(), dur: reduce ? 0 : 700 }; kick(); return; }
    }
  }
  stage.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); keyboardUsed = true; cutPass(); } });
  game.querySelector('[data-game-cut]').addEventListener('click', (e) => { keyboardUsed = e.detail === 0; cutPass(); });
  game.querySelector('[data-game-reset]').addEventListener('click', () => reset());
  game.querySelector('[data-game-again]').addEventListener('click', () => { reset(); stage.focus({ preventScroll: true }); });
  game.querySelectorAll('input[name="game-style"]').forEach((r) => r.addEventListener('change', () => {
    if (!r.checked) return;
    style = r.value;
    if (done || strands.some((s) => s.L < s.L0 - 0.5)) reset(); else { applyStyle(); renderProgress(); kick(); }
  }));

  function finish() {
    if (done) return;
    done = true;
    const run = () => {
      const acc = Math.round(measure().acc * 100);
      for (const s of strands) if (s.L > s.T + TOL) cutStrandTo(s, s.T);   // Burak macht den Feinschliff
      snipAt = now();
      hairDirty = true;
      renderProgress();
      pctEl.textContent = `${acc}\u00a0%`; barEl.style.transform = `scaleX(${acc / 100})`;
      if (doneText) doneText.textContent = `${LABEL[style]} sitzt, ${acc} % an der Zielkontur. Jetzt das Original buchen.`;
      liveEl.textContent = `Fertig. ${LABEL[style]} sitzt, ${acc} Prozent an der Zielkontur. Jetzt das Original buchen.`;
      actionsEl.hidden = true; doneEl.hidden = false;
      if (keyboardUsed) doneTitle.focus({ preventScroll: true });
      kick();
    };
    if (auto) auto.next = run; else run();
  }

  function reset() {
    done = false; announced = 0; auto = null; cutCount = 0;
    for (const s of strands) s.from = s.L;
    applyStyle();
    falling.length = 0; settled.length = 0;
    floorC.getContext('2d').clearRect(0, 0, floorC.width, floorC.height);
    regrow = { start: now(), dur: reduce ? 0 : 1100 };
    doneEl.hidden = true; actionsEl.hidden = false;
    liveEl.textContent = `Die Haare sind nachgewachsen. Ziel: ${LABEL[style]}.`;
    kick();
  }

  /* ---------- Start ---------- */
  buildHair();
  let firstView = true;
  const io = new IntersectionObserver((entries) => {
    visible = entries[0].isIntersecting && !document.hidden;
    if (visible) {
      if (firstView) { firstView = false; if (!reduce) { for (const s of strands) s.from = Math.min(s.L0, 6); regrow = { start: now(), dur: 1300 }; } }
      kick();
    }
  }, { rootMargin: '120px 0px' });
  io.observe(stage);
  document.addEventListener('visibilitychange', () => { const r = stage.getBoundingClientRect(); visible = !document.hidden && r.bottom > 0 && r.top < window.innerHeight; if (visible) kick(); });
  if ('ResizeObserver' in window) new ResizeObserver(() => { resize(); kick(); }).observe(stage);
  else window.addEventListener('resize', () => { resize(); kick(); });
  resize();
  renderProgress();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { drawStatic(); kick(); });

  // Für QA: Zustand und Szene-Umrechnung
  window.__brkGame = {
    get progress() { return progress; }, get remain() { return remain; }, get done() { return done; }, get cuts() { return cutCount; },
    toClient(x, y) { const r = canvas.getBoundingClientRect(); return { x: r.left + ox + x * scale, y: r.top + oy + y * scale }; },
    strands: () => strands.map((s) => ({ L: s.L, T: s.T, L0: s.L0 })),
    endpoints: () => strands.filter((s) => s.L < s.L0 - 0.5).map((s) => [...pointAt(s, s.L), s.L]),
  };
})();
