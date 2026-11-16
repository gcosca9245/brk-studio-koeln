/* =========================================================
   BRK Studio – Interaktion & Scroll-Choreografie
   Lenis (weiches Scrollen) + GSAP/ScrollTrigger (Reveals, Parallaxe, Galerie)
   Alle Bewegungen nutzen nur transform und opacity.
   ========================================================= */
(() => {
  'use strict';

  const root = document.documentElement;
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hasGsap = typeof window.gsap !== 'undefined' && typeof window.ScrollTrigger !== 'undefined';
  const motion = !reduceMotion && hasGsap;
  if (!motion) root.classList.remove('motion');
  window.__brkReady = true;

  /* ---------- Öffnungszeiten (eine Quelle für Status, Tabelle und Buchung) ---------- */
  // Wochentag (0 = So) -> [öffnet, schließt] in Stunden; null = geschlossen
  const HOURS = { 0: null, 1: [12, 19], 2: [12, 18], 3: [12, 18], 4: [12, 19], 5: [12, 19], 6: [12, 20] };
  const DAY_NAMES = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];

  // Aktuelle Zeit in Köln, unabhängig von der Zeitzone des Geräts
  function nowInCologne() {
    const parts = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(new Date());
    const get = (t) => (parts.find((p) => p.type === t) || {}).value;
    const map = { So: 0, Mo: 1, Di: 2, Mi: 3, Do: 4, Fr: 5, Sa: 6 };
    return { day: map[get('weekday').replace('.', '')], minutes: Number(get('hour')) * 60 + Number(get('minute')), y: Number(get('year')), m: Number(get('month')), d: Number(get('day')) };
  }

  function renderOpenStatus() {
    const n = nowInCologne();
    const label = $('[data-open-status]');
    const dot = $('[data-open-dot]');
    const today = HOURS[n.day];
    let text;
    let open = false;
    if (today && n.minutes >= today[0] * 60 && n.minutes < today[1] * 60) {
      text = `Jetzt geöffnet · bis ${today[1]} Uhr`; open = true;
    } else if (today && n.minutes < today[0] * 60) {
      text = `Heute ab ${today[0]} Uhr geöffnet`;
    } else {
      let i = 1; while (!HOURS[(n.day + i) % 7]) i++;
      const nd = (n.day + i) % 7;
      text = `${i === 1 ? 'Morgen' : DAY_NAMES[nd]} ab ${HOURS[nd][0]} Uhr geöffnet`;
    }
    if (label) label.textContent = text;
    if (dot) dot.classList.toggle('is-open', open);
    const row = $(`[data-hours] [data-day="${n.day}"]`);
    if (row) row.classList.add('is-today');
  }
  renderOpenStatus();
  $$('[data-year]').forEach((el) => { el.textContent = String(new Date().getFullYear()); });

  /* ---------- Weiches Scrollen ---------- */
  let lenis = null;
  if (motion && typeof window.Lenis !== 'undefined') {
    lenis = new window.Lenis({ duration: 1.15, easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)), smoothWheel: true });
    lenis.on('scroll', window.ScrollTrigger.update);
    window.gsap.ticker.add((time) => lenis.raf(time * 1000));
    window.gsap.ticker.lagSmoothing(0);
  }
  function scrollToTarget(target) {
    const el = typeof target === 'string' ? $(target) : target;
    if (!el) return;
    if (lenis) lenis.scrollTo(el, { offset: 0, duration: 1.3 });
    else el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
  }
  // Interne Anker über Lenis, damit der Sprung zur Bewegung passt
  $$('a[href^="#"]').forEach((a) => {
    a.addEventListener('click', (e) => {
      const id = a.getAttribute('href');
      if (id.length < 2) return;
      const el = $(id);
      if (!el) return;
      e.preventDefault();
      closeMenu(false);
      scrollToTarget(id === '#top' ? document.body : el);
      history.replaceState(null, '', id);
      // Fokus für Tastaturnutzer an den Abschnitt übergeben
      if (id !== '#top') { el.setAttribute('tabindex', '-1'); el.focus({ preventScroll: true }); }
    });
  });

  /* ---------- Kopfzeile ---------- */
  const header = $('[data-header]');
  let lastY = window.scrollY;
  function onScrollHeader() {
    const y = window.scrollY;
    header.classList.toggle('is-solid', y > 40);
    const heroH = $('[data-hero]').offsetHeight;
    const menuOpen = header.classList.contains('menu-open');
    if (!menuOpen) header.classList.toggle('is-hidden', y > heroH * 0.8 && y > lastY + 2);
    if (y < lastY - 2) header.classList.remove('is-hidden');
    lastY = y;
  }
  window.addEventListener('scroll', onScrollHeader, { passive: true });
  onScrollHeader();

  // Aktiver Navigationspunkt
  const navLinks = $$('.nav-list a');
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        navLinks.forEach((l) => l.classList.toggle('is-active', l.getAttribute('href') === `#${en.target.id}`));
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    ['leistungen', 'studio', 'team', 'galerie', 'kontakt'].forEach((id) => { const s = document.getElementById(id); if (s) io.observe(s); });
  }

  /* ---------- Mobiles Menü (Fokusfalle, Esc) ---------- */
  const toggle = $('[data-menu-toggle]');
  const menu = $('[data-menu]');
  function openMenu() {
    menu.hidden = false;
    requestAnimationFrame(() => menu.classList.add('is-open'));
    toggle.setAttribute('aria-expanded', 'true');
    toggle.querySelector('.sr-only').textContent = 'Menü schließen';
    header.classList.add('menu-open', 'is-solid');
    header.classList.remove('is-hidden');
    if (lenis) lenis.stop();
    document.body.style.overflow = 'hidden';
    const first = menu.querySelector('a'); if (first) first.focus();
  }
  function closeMenu(returnFocus = true) {
    if (toggle.getAttribute('aria-expanded') !== 'true') return;
    menu.classList.remove('is-open');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.querySelector('.sr-only').textContent = 'Menü öffnen';
    header.classList.remove('menu-open');
    document.body.style.overflow = '';
    if (lenis) lenis.start();
    setTimeout(() => { menu.hidden = true; }, 300);
    if (returnFocus) toggle.focus();
  }
  toggle.addEventListener('click', () => (toggle.getAttribute('aria-expanded') === 'true' ? closeMenu() : openMenu()));
  document.addEventListener('keydown', (e) => {
    if (toggle.getAttribute('aria-expanded') !== 'true') return;
    if (e.key === 'Escape') { closeMenu(); return; }
    if (e.key === 'Tab') {
      const items = [toggle, ...$$('a', menu)];
      const i = items.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); items[items.length - 1].focus(); }
      else if (!e.shiftKey && i === items.length - 1) { e.preventDefault(); items[0].focus(); }
    }
  });
  window.addEventListener('resize', () => { if (window.innerWidth >= 1024) closeMenu(false); });

  /* ---------- Hero-Video ---------- */
  const video = $('[data-hero-video]');
  const vToggle = $('[data-video-toggle]');
  const vLabel = $('[data-video-label]');
  const isMobileFrame = () => window.matchMedia('(max-width: 767px), (orientation: portrait) and (max-width: 1023px)').matches;
  let userPaused = reduceMotion; // reduzierte Bewegung: Video startet nicht automatisch
  function setVideoUi(paused) {
    vToggle.setAttribute('aria-pressed', String(paused));
    vLabel.textContent = paused ? 'Video abspielen' : 'Video pausieren';
  }
  function loadVideo() {
    const mobile = isMobileFrame();
    if (mobile) video.poster = video.dataset.posterMobile;
    if (!video.src) video.src = mobile ? video.dataset.srcMobile : video.dataset.srcDesktop;
  }
  function playVideo() { loadVideo(); const p = video.play(); if (p && p.catch) p.catch(() => setVideoUi(true)); }
  if (reduceMotion) { if (isMobileFrame()) video.poster = video.dataset.posterMobile; setVideoUi(true); }
  else { playVideo(); setVideoUi(false); }
  vToggle.addEventListener('click', () => {
    if (video.paused) { userPaused = false; playVideo(); setVideoUi(false); }
    else { userPaused = true; video.pause(); setVideoUi(true); }
  });
  // Außerhalb des Sichtbereichs pausieren (spart Akku und CPU)
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([en]) => {
      if (!en.isIntersecting) video.pause();
      else if (!userPaused) playVideo();
    }, { threshold: 0.05 }).observe($('[data-hero]'));
  }

  /* ---------- Headline in Zeichen zerlegen (Masken-Reveal) ---------- */
  const title = $('[data-split]');
  if (title && motion) {
    const text = title.textContent.trim();
    title.setAttribute('aria-label', text);
    title.innerHTML = text.split(' ').map((w) => `<span class="line" aria-hidden="true">${w.split('').map((c) => `<span class="char">${c}</span>`).join('')}</span>`).join('');
  }
  if (title) title.classList.add('is-split');

  /* ---------- Leistungen -> Buchung vorbelegen ---------- */
  $$('[data-book]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = $$('input[name="service"]').find((i) => i.value === btn.dataset.book);
      if (input) { input.checked = true; input.dispatchEvent(new Event('change', { bubbles: true })); }
    });
  });

  /* ---------- Buchung (simulierte Verfügbarkeit) ---------- */
  const form = $('[data-booking]');
  const daysEl = $('[data-days]');
  const slotsEl = $('[data-slots]');
  const slotHint = $('[data-slot-hint]');
  const summary = $('[data-summary]');
  const done = $('[data-booking-done]');
  const dfDay = new Intl.DateTimeFormat('de-DE', { weekday: 'short' });
  const dfMonth = new Intl.DateTimeFormat('de-DE', { month: 'short' });
  const dfLong = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
  let dirty = false;

  // Deterministischer Pseudo-Zufall: gleiche Tage zeigen immer dieselben belegten Zeiten
  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    // Murmur-Finalizer für gleichmäßigere Verteilung
    h ^= h >>> 16; h = Math.imul(h, 2246822507); h ^= h >>> 13; h = Math.imul(h, 3266489909); h ^= h >>> 16;
    return (h >>> 0) / 4294967295;
  }
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const fmtTime = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

  function buildDays() {
    const n = nowInCologne();
    const start = new Date(n.y, n.m - 1, n.d);
    let html = '';
    for (let i = 0; i < 14; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i);
      const closed = !HOURS[d.getDay()];
      const label = i === 0 ? 'Heute' : dfDay.format(d).replace('.', '');
      html += `<label class="day"><input type="radio" name="date" value="${iso(d)}" ${closed ? 'disabled' : ''} aria-label="${dfLong.format(d)}${closed ? ', geschlossen' : ''}"><span><small>${label}</small><b>${d.getDate()}</b><small>${closed ? 'zu' : dfMonth.format(d).replace('.', '')}</small></span></label>`;
    }
    daysEl.innerHTML = html;
  }

  function selectedService() { return $('input[name="service"]:checked', form); }

  function buildSlots() {
    const dateInput = $('input[name="date"]:checked', form);
    const prev = ($('input[name="time"]:checked', form) || {}).value;
    if (!dateInput) { slotsEl.innerHTML = ''; slotHint.textContent = 'Bitte zuerst einen Tag wählen'; return; }
    const [y, m, d] = dateInput.value.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const hours = HOURS[date.getDay()];
    const svc = selectedService();
    const duration = svc ? Number(svc.dataset.duration) : 30;
    const n = nowInCologne();
    const isToday = iso(date) === iso(new Date(n.y, n.m - 1, n.d));
    let html = '';
    let free = 0;
    for (let t = hours[0] * 60; t + duration <= hours[1] * 60; t += 30) {
      const past = isToday && t < n.minutes + 30;
      if (past) continue;
      const taken = hash(`${dateInput.value}-${t}`) < 0.32;
      if (!taken) free++;
      html += `<label class="slot"><input type="radio" name="time" value="${fmtTime(t)}" ${taken ? 'disabled' : ''} ${!taken && prev === fmtTime(t) ? 'checked' : ''} aria-label="${fmtTime(t)} Uhr${taken ? ', belegt' : ''}"><span>${fmtTime(t)}</span></label>`;
    }
    if (!free) html = '<p class="slots__empty">An diesem Tag ist leider nichts mehr frei. Bitte wähle einen anderen Tag.</p>';
    slotsEl.innerHTML = html;
    slotHint.textContent = free ? `${free} freie Zeiten${svc ? '' : ' (Dauer je nach Leistung)'}` : '';
  }

  function updateSummary() {
    const s = selectedService();
    const dI = $('input[name="date"]:checked', form);
    const tI = $('input[name="time"]:checked', form);
    const parts = [];
    if (s) parts.push(s.value);
    if (dI) { const [y, m, d] = dI.value.split('-').map(Number); parts.push(dfLong.format(new Date(y, m - 1, d))); }
    if (tI) parts.push(`${tI.value} Uhr`);
    summary.textContent = parts.join(' · ');
  }

  function setError(name, msg) {
    const el = $(`[data-error="${name}"]`, form);
    if (el) el.textContent = msg || '';
    const input = form.elements[name];
    if (input && input.tagName) input.setAttribute('aria-invalid', msg ? 'true' : 'false');
  }

  function validate() {
    const errors = {};
    if (!selectedService()) errors.service = 'Bitte wähle eine Leistung.';
    if (!$('input[name="date"]:checked', form)) errors.date = 'Bitte wähle einen Tag.';
    if (!$('input[name="time"]:checked', form)) errors.time = 'Bitte wähle eine freie Uhrzeit.';
    const name = form.elements.name.value.trim();
    if (name.length < 2) errors.name = 'Bitte gib deinen Namen an.';
    const phone = form.elements.phone.value.replace(/[\s()/-]/g, '');
    if (!/^\+?\d{6,15}$/.test(phone)) errors.phone = 'Bitte gib eine Telefonnummer an, z. B. 0171 2345678.';
    ['service', 'date', 'time', 'name', 'phone'].forEach((k) => setError(k, errors[k]));
    return errors;
  }

  if (form) {
    buildDays();
    buildSlots();
    form.addEventListener('change', (e) => {
      dirty = true;
      if (e.target.name === 'date' || e.target.name === 'service') buildSlots();
      if (['service', 'date', 'time'].includes(e.target.name)) setError(e.target.name, '');
      updateSummary();
    });
    form.addEventListener('input', (e) => { dirty = true; if (e.target.name === 'name' || e.target.name === 'phone') setError(e.target.name, ''); });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const errors = validate();
      const order = ['service', 'date', 'time', 'name', 'phone'];
      const first = order.find((k) => errors[k]);
      if (first) {
        const target = first === 'service' ? $('input[name="service"]', form) : first === 'date' ? $('input[name="date"]:not(:disabled)', form) : first === 'time' ? ($('input[name="time"]:not(:disabled)', form) || $('input[name="date"]:checked', form)) : form.elements[first];
        if (target) target.focus();
        return;
      }
      // Demo: nichts wird gesendet. Bestätigung lokal anzeigen.
      const s = selectedService().value;
      const [y, m, d] = $('input[name="date"]:checked', form).value.split('-').map(Number);
      const t = $('input[name="time"]:checked', form).value;
      const firstName = form.elements.name.value.trim().split(' ')[0];
      $('[data-done-title]').textContent = `Danke, ${firstName}.`;
      $('[data-done-text]').textContent = `Deine Anfrage: ${s} am ${dfLong.format(new Date(y, m - 1, d))} um ${t} Uhr.`;
      form.hidden = true;
      done.hidden = false;
      done.focus();
      dirty = false;
    });
    $('[data-booking-reset]').addEventListener('click', () => {
      form.reset(); buildSlots(); updateSummary();
      done.hidden = true; form.hidden = false;
      $('input[name="service"]', form).focus();
    });
    window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
  }

  /* ---------- Karte erst nach Klick laden (Datenschutz) ---------- */
  const mapBtn = $('[data-map-load]');
  if (mapBtn) {
    mapBtn.addEventListener('click', () => {
      const wrap = $('[data-map]');
      const iframe = document.createElement('iframe');
      iframe.src = 'https://www.google.com/maps?q=Fleischmengergasse+29,+50676+K%C3%B6ln&z=16&output=embed';
      iframe.title = 'Karte: BRK Studio, Fleischmengergasse 29, Köln';
      iframe.loading = 'lazy';
      iframe.referrerPolicy = 'no-referrer-when-downgrade';
      wrap.innerHTML = '';
      wrap.appendChild(iframe);
      iframe.focus();
    });
  }

  /* ---------- Galerie-Fortschritt (natives Scrollen, mobil) ---------- */
  const gViewport = $('[data-gallery-viewport]');
  const gTrack = $('[data-gallery-track]');
  const gBar = $('[data-gallery-bar]');
  function nativeGalleryProgress() {
    const max = gViewport.scrollWidth - gViewport.clientWidth;
    const p = max > 0 ? gViewport.scrollLeft / max : 0;
    gBar.style.transform = `scaleX(${0.12 + p * 0.88})`;
  }
  gViewport.addEventListener('scroll', nativeGalleryProgress, { passive: true });

  /* ---------- Ohne Bewegung: hier endet es ---------- */
  if (!motion) { root.classList.add('is-loaded'); return; }

  const { gsap, ScrollTrigger } = window;
  gsap.registerPlugin(ScrollTrigger);
  const EASE = 'expo.out';

  /* Hero-Intro: Ken-Burns-Auszoomen des Videos (CSS), Zeichen steigen aus der Maske */
  requestAnimationFrame(() => root.classList.add('is-loaded'));
  const intro = gsap.timeline({ delay: 0.15 });
  intro.fromTo('.hero__title .char', { y: 0, yPercent: 105 }, { yPercent: 0, duration: 1.25, ease: EASE, stagger: 0.045 }, 0)
    .to('[data-hero-fade]', { opacity: 1, y: 0, duration: 1, ease: 'power3.out', stagger: 0.08 }, 0.45);

  /* Hero beim Scrollen: Bild wandert langsamer (Parallaxe), Text löst sich nach oben auf */
  gsap.to('[data-hero-media]', { yPercent: 10, ease: 'none', scrollTrigger: { trigger: '[data-hero]', start: 'top top', end: 'bottom top', scrub: true } });
  gsap.to('.hero__inner', { y: -60, opacity: 0.15, ease: 'none', scrollTrigger: { trigger: '[data-hero]', start: 'top top', end: 'bottom top', scrub: true } });

  /* Allgemeine Reveals */
  ScrollTrigger.batch('[data-reveal]', {
    start: 'top 88%', once: true,
    onEnter: (els) => gsap.to(els, { opacity: 1, y: 0, duration: 1.1, ease: EASE, stagger: 0.07, overwrite: true }),
  });
  $$('[data-reveal-group]').forEach((group) => {
    gsap.to($$('[data-reveal-item]', group), { opacity: 1, y: 0, duration: 1, ease: EASE, stagger: 0.08, scrollTrigger: { trigger: group, start: 'top 80%', once: true } });
  });

  /* Studio: der Satz wird Wort für Wort beim Scrollen hell */
  const quote = $('[data-words]');
  if (quote) {
    quote.innerHTML = quote.textContent.trim().split(/\s+/).map((w) => `<span class="word">${w}</span> `).join('');
    gsap.fromTo($$('.word', quote), { opacity: 0.16 }, { opacity: 1, ease: 'none', stagger: 0.1, scrollTrigger: { trigger: '#studio', start: 'top 70%', end: 'center 45%', scrub: 0.6 } });
  }

  /* Dezente Bild-Parallaxe in Rahmen */
  $$('[data-parallax-frame]').forEach((frame) => {
    const img = $('[data-parallax]', frame);
    gsap.fromTo(img, { yPercent: -5 }, { yPercent: 5, ease: 'none', scrollTrigger: { trigger: frame, start: 'top bottom', end: 'bottom top', scrub: true } });
    gsap.fromTo(frame, { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 1.2, ease: EASE, scrollTrigger: { trigger: frame, start: 'top 90%', once: true } });
  });

  /* Galerie: ab Desktop horizontal mitlaufend und angeheftet */
  const mm = gsap.matchMedia();
  mm.add('(min-width: 1024px)', () => {
    const section = $('[data-gallery]');
    section.classList.add('is-pinned');
    const distance = () => Math.max(0, gTrack.scrollWidth - window.innerWidth);
    const tween = gsap.to(gTrack, {
      x: () => -distance(), ease: 'none',
      scrollTrigger: {
        trigger: section, start: 'top top', end: () => `+=${distance()}`, pin: true, scrub: 0.8, invalidateOnRefresh: true,
        onUpdate: (st) => { gBar.style.transform = `scaleX(${0.12 + st.progress * 0.88})`; },
      },
    });
    return () => { section.classList.remove('is-pinned'); tween.kill(); gsap.set(gTrack, { clearProps: 'transform' }); };
  });
  mm.add('(max-width: 1023px)', () => {
    gsap.from($$('.shot', gTrack), { opacity: 0, x: 40, duration: 1, ease: EASE, stagger: 0.06, scrollTrigger: { trigger: gTrack, start: 'top 85%', once: true } });
  });

  // Nach dem Laden von Schrift und Bildern Positionen neu berechnen
  window.addEventListener('load', () => ScrollTrigger.refresh());
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => ScrollTrigger.refresh());
})();
