/* =========================================================
   BRK Studio – Effekte
   1 Intro: Schere schneidet das Bild, das Video öffnet sich an der Schnittlinie
   2 Scheren-Cursor (nur feine Zeiger)
   3 Abschnittswechsel als horizontaler Schnitt
   4 Burak als Linienfigur, eine kleine Geschichte bis zum Spiel
   5 „Wohnzimmer“ mit echten Salonfotos in den Buchstaben
   Nur transform und opacity werden animiert. Bei reduzierter Bewegung: nichts davon.
   ========================================================= */
(() => {
  'use strict';
  const root = document.documentElement;
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.__brkFx = true;

  const SCISSORS = '<svg viewBox="0 0 40 24" aria-hidden="true" focusable="false"><g class="sc__b sc__b--1"><circle cx="6" cy="6" r="4.2"/><path d="M9.6 8.2 L38 13.4"/></g><g class="sc__b sc__b--2"><circle cx="6" cy="18" r="4.2"/><path d="M9.6 15.8 L38 10.6"/></g><circle class="sc__pin" cx="20" cy="12" r="1"/></svg>';

  /* ---------- 1 Intro ---------- */
  const introEl = $('[data-intro]');
  function introDone() {
    root.classList.remove('intro-on', 'intro-run');
    try { sessionStorage.setItem('brk.intro', '1'); } catch (_) { /* privat */ }
    window.dispatchEvent(new CustomEvent('brk:intro-done'));
  }
  if (introEl && root.classList.contains('intro-on')) {
    if (reduce) introDone();
    else {
      const mobile = window.matchMedia('(max-width: 767px), (orientation: portrait) and (max-width: 1023px)').matches;
      if (mobile) introEl.classList.add('intro--mobile');
      let ended = false;
      const end = () => { if (ended) return; ended = true; introEl.classList.add('is-out'); setTimeout(introDone, 300); off(); };
      const skip = () => { if (!ended) { ended = true; introEl.classList.add('is-skip'); setTimeout(introDone, 260); off(); } };
      const evs = ['pointerdown', 'keydown', 'wheel', 'touchstart'];
      const off = () => evs.forEach((t) => window.removeEventListener(t, skip, true));
      evs.forEach((t) => window.addEventListener(t, skip, { capture: true, passive: true }));
      requestAnimationFrame(() => { root.classList.add('intro-run'); });
      setTimeout(end, 1050);
    }
  } else {
    window.__brkIntroDone = true;
  }

  /* Bilder für „Wohnzimmer“ erst kurz vor Sichtbarkeit und nur für die sichtbare Variante laden */
  const wzEl = $('[data-wz]');
  if (wzEl) {
    const load = () => $$('.wz__svg', wzEl).filter((sv) => getComputedStyle(sv).display !== 'none').forEach((sv) => $$('[data-href]', sv).forEach((im) => { im.setAttribute('href', im.dataset.href); im.removeAttribute('data-href'); }));
    if ('IntersectionObserver' in window) new IntersectionObserver(([en], io) => { if (en.isIntersecting) { load(); io.disconnect(); } }, { rootMargin: '900px 0px' }).observe(wzEl);
    else load();
    window.addEventListener('resize', () => { if (!$('[data-wz-img]:not([data-href])', wzEl)) return; load(); }, { passive: true });
  }

  if (reduce) return;
  const gsap = window.gsap, ST = window.ScrollTrigger;
  if (gsap && ST) gsap.registerPlugin(ST);

  /* ---------- 2 Scheren-Cursor ---------- */
  if (window.matchMedia('(pointer: fine) and (hover: hover)').matches) {
    const cur = document.createElement('div');
    cur.className = 'cursor';
    cur.setAttribute('aria-hidden', 'true');
    cur.innerHTML = `<span class="cursor__sc">${SCISSORS}</span><span class="cursor__label">Ansehen</span>`;
    document.body.appendChild(cur);
    root.classList.add('has-cursor');
    let x = -100, y = -100, tx = -100, ty = -100, raf = 0, shown = false;
    const tick = () => {
      raf = 0;
      x += (tx - x) * 0.32; y += (ty - y) * 0.32;
      if (Math.abs(tx - x) < 0.1 && Math.abs(ty - y) < 0.1) { x = tx; y = ty; }
      cur.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      if (x !== tx || y !== ty) raf = requestAnimationFrame(tick);
    };
    const IMG = 'img, video, picture, .frame, [data-cursor="open"]';
    const VIEW = '[data-gallery] .shot, [data-cursor="view"]';
    const LINK = 'a, button, label, summary, [role="button"], select';
    const NATIVE = 'input, textarea, [contenteditable], .mirror, iframe, [data-cursor="native"]';
    let state = '';
    const setState = (s) => { if (s !== state) { cur.dataset.state = s; state = s; } };
    const classify = (t) => {
      if (!t) return;
      if (t.closest(NATIVE)) setState('native');
      else if (t.closest(VIEW)) setState('view');
      else if (t.closest(LINK)) setState('link');
      else if (t.closest(IMG)) setState('open');
      else setState('');
    };
    window.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      tx = e.clientX; ty = e.clientY;
      if (!shown) { shown = true; x = tx; y = ty; cur.classList.add('is-on'); }
      classify(e.target instanceof Element ? e.target : null);
      if (!raf) raf = requestAnimationFrame(tick);
    }, { passive: true });
    // beim Scrollen wandert der Inhalt unter dem Zeiger: Zustand neu bestimmen
    let sRaf = 0;
    window.addEventListener('scroll', () => { if (!shown || sRaf) return; sRaf = requestAnimationFrame(() => { sRaf = 0; classify(document.elementFromPoint(tx, ty)); }); }, { passive: true });
    document.addEventListener('pointerleave', () => { cur.classList.remove('is-on'); shown = false; });
    window.addEventListener('blur', () => { cur.classList.remove('is-on'); shown = false; });
    window.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse') { cur.classList.remove('is-snip'); void cur.offsetWidth; cur.classList.add('is-snip'); } }, { passive: true });
    cur.addEventListener('animationend', () => cur.classList.remove('is-snip'));
  }

  /* ---------- 3 Abschnittswechsel als horizontaler Schnitt ---------- */
  const solid = (el) => { const c = getComputedStyle(el).backgroundColor; return c && c !== 'transparent' && !/rgba\(0, 0, 0, 0\)/.test(c) ? c : null; };
  const sections = $$('main > section');
  if (gsap && ST && sections.length) {
    sections.forEach((sec, i) => {
      if (i === 0) return;
      const prev = sections[i - 1];
      const a = solid(prev) || 'rgb(10, 10, 10)', b = solid(sec);
      if (!b || a === b) return;
      const dark = (c) => { const m = c.match(/\d+/g); return m && (Number(m[0]) + Number(m[1]) + Number(m[2])) / 3 < 100; };
      const cut = document.createElement('div');
      cut.className = `cut${dark(a) ? ' cut--from-dark' : ''}`;
      cut.setAttribute('aria-hidden', 'true');
      cut.innerHTML = `<span class="cut__band" style="background:${a}"></span><span class="cut__edge"><span class="cut__line"></span><span class="cut__sc">${SCISSORS}</span></span>`;
      sec.classList.add('has-cut');
      sec.prepend(cut);
      const band = $('.cut__band', cut), edge = $('.cut__edge', cut), line = $('.cut__line', cut), sc = $('.cut__sc', cut);
      const tl = gsap.timeline({ scrollTrigger: { trigger: sec, start: 'top bottom', end: 'top 30%', scrub: 0.5 } });
      tl.fromTo(band, { scaleY: 1 }, { scaleY: 0, ease: 'none', duration: 1 }, 0)
        .fromTo(edge, { yPercent: 0 }, { yPercent: -100, ease: 'none', duration: 1 }, 0)
        .fromTo(line, { scaleX: 0 }, { scaleX: 1, ease: 'none', duration: 0.9 }, 0)
        .fromTo(sc, { x: 0 }, { x: () => sec.clientWidth, ease: 'none', duration: 0.9 }, 0)
        .to([line, sc], { opacity: 0, duration: 0.1 }, 0.9);
    });
  }

  /* ---------- 5 „Wohnzimmer“ ---------- */
  const wz = $('[data-wz]');
  if (wz && gsap && ST) {
    const svgD = $('.wz__svg:not(.wz__svg--m)', wz), svgM = $('.wz__svg--m', wz);
    const imgsOf = (sv) => $$('[data-wz-img]', sv);
    const desk = window.matchMedia('(min-width: 1024px)');
    const mm = gsap.matchMedia();
    mm.add('(min-width: 1024px)', () => {
      const svg = svgD, imgs = imgsOf(svgD);
      const tl = gsap.timeline({ scrollTrigger: { trigger: wz, start: 'top top', end: '+=120%', pin: true, scrub: 0.6, anticipatePin: 1 } });
      tl.fromTo(svg, { scale: 2.6, xPercent: 34 }, { scale: 1, xPercent: 0, ease: 'power2.out', duration: 1 }, 0)
        .fromTo(imgs, { y: -70 }, { y: 70, ease: 'none', duration: 1.2 }, 0)
        .fromTo(imgs[1], { opacity: 0 }, { opacity: 1, duration: 0.18, ease: 'none' }, 0.45)
        .fromTo(imgs[2], { opacity: 0 }, { opacity: 1, duration: 0.18, ease: 'none' }, 0.8)
        .fromTo('.wz__foot', { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.3 }, 0.85);
      return () => tl.kill();
    });
    mm.add('(max-width: 1023px)', () => {
      const svg = window.matchMedia('(max-width: 767px)').matches ? svgM : svgD, imgs = imgsOf(svg);
      const tl = gsap.timeline({ scrollTrigger: { trigger: wz, start: 'top bottom', end: 'bottom top', scrub: 0.6 } });
      tl.fromTo(svg, { xPercent: 5 }, { xPercent: -5, ease: 'none', duration: 1 }, 0)
        .fromTo(imgs, { y: -50 }, { y: 50, ease: 'none', duration: 1 }, 0)
        .fromTo(imgs[1], { opacity: 0 }, { opacity: 1, duration: 0.15, ease: 'none' }, 0.4)
        .fromTo(imgs[2], { opacity: 0 }, { opacity: 1, duration: 0.15, ease: 'none' }, 0.65);
      return () => tl.kill();
    });
    void desk;
  }

  // Pins (Galerie aus main.js, Wohnzimmer hier) verschieben spätere Trigger: nach Seitenposition sortieren
  if (gsap && ST) { ST.sort(); ST.refresh(); window.addEventListener('load', () => { ST.sort(); ST.refresh(); }); }

  /* ---------- 4 Burak als Linienfigur ---------- */
  const BODY = '<ellipse cx="20" cy="7.6" rx="4.6" ry="5.2"/><path class="fig__beard" d="M15.5 8.6 Q16.2 14.8 20 15.2 Q23.8 14.8 24.5 8.6 Q22.4 11.2 20 11.2 Q17.6 11.2 15.5 8.6 Z"/><path d="M18.5 14.6 L18.7 17.4 M21.5 14.6 L21.3 17.4"/><path d="M12.6 21 Q13.2 17.7 20 17.4 Q26.8 17.7 27.4 21 M12.6 21 L13.6 44 M27.4 21 L26.4 44"/><path d="M15.4 25 H24.6 L25.4 56 H14.6 Z M15.4 25 L17.4 17.9 M24.6 25 L22.6 17.9 M13.6 34.4 H26.4"/><path d="M16.6 44 L16 76 L12.4 76.7 M23.4 44 L24 76 L27.6 76.7"/>';
  const ARM_L = '<path d="M12.6 21 Q10.4 32 11.2 43"/>', ARM_R = '<path d="M27.4 21 Q29.6 32 28.8 43"/>';
  const sc = (x, y, r = 0, s = 0.3) => `<g transform="translate(${x} ${y}) rotate(${r}) scale(${s})" class="fig__sc"><circle cx="6" cy="6" r="4.2"/><path d="M9.6 8.2 L38 13.4"/><circle cx="6" cy="18" r="4.2"/><path d="M9.6 15.8 L38 10.6"/></g>`;
  const POSES = {
    hallo: `${ARM_L}<path d="M27.4 21 L32.6 13 L34 4.4"/>${sc(31.4, 0.6, -78)}`,
    zeigen: `${ARM_L}<path d="M27.4 21 L35.6 26.4 L45 25.4"/>`,
    kaffee: `${ARM_L}<path d="M27.4 21 L29.4 33.6 L35.2 29.2"/><path d="M34.4 23.8 H40.4 V29.4 Q37.4 31.4 34.4 29.4 Z M40.4 25.2 Q42.8 26 40.4 28.2"/><path d="M36.4 21.8 Q35.4 19.8 36.6 18 M38.8 21.8 Q37.8 19.8 39 18"/>`,
    team: '<path d="M12.6 21 L8.6 31.4 L13.6 37"/><path d="M27.4 21 L31.4 31.4 L26.4 37"/>',
    schauen: `${ARM_L}<path d="M27.4 21 L32.6 18 L25.2 7.6"/>`,
    offen: '<path d="M12.6 21 L5.6 29.6 L3.4 27"/><path d="M27.4 21 L34.4 29.6 L36.6 27"/>',
    brust: `${ARM_L}<path d="M27.4 21 L29.4 31 L22.4 28.2"/>`,
    tschuess: `<path d="M12.6 21 L7.2 11.6 L6 4.2"/>${ARM_R}`,
    anbieten: `${ARM_L}<path d="M27.4 21 L32.4 31.6 L40.4 32.8"/>${sc(38.6, 28.4, -4)}`,
  };
  const figSvg = (pose) => `<svg viewBox="0 0 48 80" class="fig" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-width="1.15" stroke-linecap="round" stroke-linejoin="round">${BODY}${POSES[pose]}</g></svg>`;
  const STORY = {
    top: ['hallo', 'Hi, ich bin Burak.'],
    leistungen: ['zeigen', 'Such dir was aus.'],
    studio: ['kaffee', 'Kaffee oder Bier?'],
    wohnzimmer: ['offen', 'Mein Wohnzimmer.'],
    team: ['team', 'Das ist mein Team.'],
    galerie: ['schauen', 'Schau dich um.'],
    buchen: ['offen', 'Ich hab Zeit für dich.'],
    bewertungen: ['brust', 'Sagen die Gäste, nicht ich.'],
    spiel: [null, ''],
    kontakt: ['tschuess', 'Bis gleich am Neumarkt.'],
  };
  const inline = $('[data-burak-inline]');
  if (inline) inline.insertAdjacentHTML('afterbegin', figSvg('anbieten'));
  if (inline && 'IntersectionObserver' in window) {
    new IntersectionObserver(([en], io) => { if (en.isIntersecting) { inline.classList.add('is-in'); io.disconnect(); } }, { threshold: 0.6 }).observe(inline);
  }
  const mqC = window.matchMedia('(min-width: 1200px)');
  if (mqC.matches && 'IntersectionObserver' in window) {
    const comp = document.createElement('div');
    comp.className = 'companion';
    comp.setAttribute('aria-hidden', 'true');
    comp.innerHTML = `<span class="companion__say"></span><span class="companion__figs">${Object.keys(POSES).filter((p) => p !== 'anbieten').map((p) => `<span class="companion__fig" data-pose="${p}">${figSvg(p)}</span>`).join('')}</span>`;
    document.body.appendChild(comp);
    const say = $('.companion__say', comp);
    let cur = '', hideT = 0;
    const show = (id) => {
      const s = STORY[id];
      if (!s || id === cur) return;
      cur = id;
      const [pose, text] = s;
      comp.classList.toggle('is-away', !pose);
      if (!pose) return;
      $$('.companion__fig', comp).forEach((f) => f.classList.toggle('is-on', f.dataset.pose === pose));
      say.classList.remove('is-on');
      clearTimeout(hideT);
      setTimeout(() => { say.textContent = text; say.classList.add('is-on'); }, 160);
      hideT = setTimeout(() => say.classList.remove('is-on'), 4200);
    };
    const wait = () => {
      comp.classList.add('is-ready');
      const mid = innerHeight / 2;
      const here = Object.keys(STORY).find((id) => { const el = document.getElementById(id); if (!el) return false; const r = el.getBoundingClientRect(); return r.top <= mid && r.bottom >= mid; });
      show(here || 'top');
    };
    if (root.classList.contains('intro-on')) window.addEventListener('brk:intro-done', () => setTimeout(wait, 500), { once: true }); else setTimeout(wait, 900);
    const io = new IntersectionObserver((entries) => entries.forEach((en) => { if (en.isIntersecting && comp.classList.contains('is-ready')) show(en.target.id); }), { rootMargin: '-50% 0px -50% 0px' });
    Object.keys(STORY).forEach((id) => { const el = document.getElementById(id); if (el) io.observe(el); });
    const foot = $('.footer');
    if (foot) new IntersectionObserver(([en]) => comp.classList.toggle('is-foot', en.isIntersecting), { threshold: 0.2 }).observe(foot);
  }
})();
