// QA Plattform: Registrieren, Buchen, Slot verschwindet, Blocker, Storno, Bewertung bis Freigabe + Screenshots
const puppeteer = require('/tmp/kv/node_modules/puppeteer-core');
const BASE = process.argv[2] || 'http://127.0.0.1:8795/';
const OUT = process.argv[3] || '/workspace/brk-studio/qa/platform/';
require('fs').mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rep = [];
const ok = (cond, msg) => { const l = `${cond ? 'OK  ' : 'FAIL'} ${msg}`; rep.push(l); console.error(l); };
(async () => {
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--hide-scrollbars'] });
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage(); await page.setBypassCSP(true); // Test-Helfer werten Code im Seitenkontext aus; CSP selbst prüft qa-csp.js
  await page.setViewport({ width: 1440, height: 900 });
  page.setDefaultTimeout(10000); page.setDefaultNavigationTimeout(40000); await page.setCacheEnabled(false);
  const errs = [];
  page.on('pageerror', (e) => errs.push(`pageerror ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(`console ${m.text()}`); });
  page.on('dialog', (d) => d.accept());
  const api = (fn, ...args) => page.evaluate(async (src, args) => { const { api } = await import(new URL('assets/js/app/api.js', document.baseURI.replace(/(buchen|konto|admin)\/.*$/, '')).href); return (0, eval)(src)(api, ...args); }, fn.toString(), args);
  const clickText = async (sel, text) => { const h = await page.evaluateHandle((sel, text) => [...document.querySelectorAll(sel)].find((e) => e.textContent.trim().includes(text) && e.offsetParent), sel, text); await h.asElement().click(); };

  // 1) Website: Bewertungen + Live-Slots
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await sleep(800);
  const avg0 = await page.$eval('[data-score-count]', (e) => e.textContent);
  ok(/7|6/.test(avg0), `Website Bewertungen geladen: ${avg0} · Ø ${await page.$eval('[data-score-avg]', (e) => e.textContent)}`);
  await page.evaluate(() => document.querySelector('#buchen').scrollIntoView());
  await sleep(1200);
  await page.click('[data-site-services] input[value="sv_wss"] + span');
  await sleep(500);
  await page.click('[data-site-staff] input[value="st_burak"] + span');
  await sleep(500);
  // mindestens 2 Tage im Voraus, damit Storno/Verschieben (12-h-Frist) möglich sind
  const dayVal = await page.evaluate(() => { const ins = [...document.querySelectorAll('[data-site-days] input')].filter((i) => !i.disabled); return ins[2] && ins[2].value; });
  await page.click(`[data-site-days] input[value="${dayVal}"] + span`); await sleep(500);
  const pick = await page.evaluate(() => { const d = document.querySelector('[data-site-days] input:checked'); const t = document.querySelector('[data-site-slots] input[name="time"]'); return { d: d && d.value, t: t && Number(t.value), n: document.querySelectorAll('[data-site-slots] input[name="time"]').length }; });
  ok(pick.d && pick.t != null, `Website zeigt echte Slots: ${pick.n} am ${pick.d}, erster ${pick.t}`);
  await page.click(`[data-site-slots] input[value="${pick.t}"] + span`);
  await sleep(300);
  await page.evaluate(() => document.querySelector('[data-site-booking]').scrollIntoView({ block: 'center' }));
  await sleep(600);
  await page.screenshot({ path: OUT + 'desktop-website-buchung.png' });
  await page.evaluate(() => document.querySelector('#bewertungen').scrollIntoView()); await sleep(1400);
  await page.screenshot({ path: OUT + 'desktop-website-bewertungen.png' });

  // 2) Weiter zur Buchung -> Registrieren -> Buchen
  const href = await page.$eval('[data-site-continue]', (a) => a.href);
  ok(/s=sv_wss/.test(href) && /t=/.test(href), `Weiter-Link übergibt Auswahl: ${href.replace(BASE, '/')}`);
  await page.goto(href, { waitUntil: 'networkidle0' }); await sleep(700);
  const pre = await page.evaluate(() => ({ s: (document.querySelector('input[name="service"]:checked') || {}).value, t: (document.querySelector('input[name="time"]:checked') || {}).value }));
  ok(pre.s === 'sv_wss' && Number(pre.t) === pick.t, `Buchungsseite übernimmt Auswahl ${JSON.stringify(pre)}`);
  await page.screenshot({ path: OUT + 'desktop-buchen.png', fullPage: false });
  await page.click('[data-tab="up"]');
  await page.type('#bk-name', 'Test Kundin');
  await page.type('#bk-remail', 'test.kundin@example.com');
  await page.type('#bk-phone', '0171 1234567');
  await page.type('#bk-rpw', 'kurz');
  await page.click('[data-form="up"] button[type="submit"]'); await sleep(300);
  const pwErr = await page.$eval('[data-form="up"] [data-f="password"]', (e) => e.textContent);
  ok(!!pwErr, `Schwaches Passwort abgelehnt: „${pwErr}“`);
  await page.click('#bk-rpw', { clickCount: 3 }); await page.type('#bk-rpw', 'SicheresPasswort26');
  await page.click('[data-form="up"] button[type="submit"]'); await sleep(1500);
  const users = await api((a) => a.user());
  ok(users && users.email === 'test.kundin@example.com', 'Registrierung + Anmeldung');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('brk.platform.v1')).users.find((u) => u.email === 'test.kundin@example.com').pass);
  ok(stored && stored.hash && !JSON.stringify(stored).includes('SicheresPasswort26'), `Passwort nur als ${stored.alg}-Hash gespeichert (${stored.iter} Iterationen)`);
  await page.click('[data-book-submit]'); await sleep(1200);
  ok(await page.$eval('[data-bk-done]', (e) => !e.hidden), `Gebucht: ${await page.$eval('[data-done-text]', (e) => e.textContent)}`);
  await page.screenshot({ path: OUT + 'desktop-buchen-bestaetigt.png' });

  // 3) Slot verschwindet (Website-Logik)
  let slots = await api((a, d) => a.slots({ serviceId: 'sv_wss', staffId: 'st_burak', date: d }), pick.d);
  ok(!slots.some((s) => s.start === pick.t), `Gebuchter Slot ${pick.t} am ${pick.d} ist bei Burak nicht mehr frei`);
  await page.goto(BASE, { waitUntil: 'networkidle0' }); await sleep(600);
  await page.evaluate(() => document.querySelector('#buchen').scrollIntoView()); await sleep(900);
  await page.click('[data-site-services] input[value="sv_wss"] + span'); await sleep(400);
  await page.click('[data-site-staff] input[value="st_burak"] + span'); await sleep(400);
  await page.evaluate((d) => { const i = document.querySelector(`[data-site-days] input[value="${d}"]`); if (i) i.click(); }, pick.d); await sleep(500);
  ok(!(await page.$(`[data-site-slots] input[value="${pick.t}"]`)), 'Auch auf der Website verschwunden');

  // 4) Admin: Login, Termin im Kalender, Blocker
  await page.goto(BASE + 'admin/', { waitUntil: 'networkidle0' }); await sleep(500);
  ok(await page.$eval('[data-adm-auth]', (e) => !e.hidden), 'Kundin hat keinen Admin-Zugang (Login-Seite)');
  await page.click('[data-fill-demo]'); await page.click('[data-form="in"] button[type="submit"]'); await sleep(1500);
  await sleep(1000);
  ok(await page.$eval('[data-pult]', (e) => !e.hidden), 'Admin-Login');
  // Seit dem Studio-Pult startet der Admin auf der Übersicht; Kalender gezielt öffnen
  await page.evaluate(() => { location.hash = 'kalender'; }); await sleep(800);
  await page.screenshot({ path: OUT + 'desktop-admin-tag.png' });
  // zum Buchungstag navigieren
  for (let i = 0; i < 20; i++) { const has = await page.$(`.cal__col[data-date="${pick.d}"]`); if (has) break; await page.click('[data-cal-next]'); await sleep(120); }
  const evName = await page.evaluate((d) => [...document.querySelectorAll(`.cal__col[data-date="${d}"][data-staff="st_burak"] .ev__n`)].map((e) => e.textContent).join(' | '), pick.d);
  ok(/Test Kundin/.test(evName), `Termin im Admin-Kalender: ${evName}`);
  await page.screenshot({ path: OUT + 'desktop-admin-buchungstag.png' });
  await page.click('[data-view="week"]'); await sleep(500);
  await page.screenshot({ path: OUT + 'desktop-admin-woche.png' });
  await page.click('[data-view="day"]'); await sleep(300);
  // Blocker über Dialog: Burak, Buchungstag, 15:00–16:00
  await page.click('[data-new-block]'); await sleep(300);
  await page.select('#bl-staff', 'st_burak');
  await page.$eval('#bl-date', (e, d) => { e.value = d; }, pick.d);
  await page.select('#bl-from', String(15 * 60)); await page.select('#bl-to', String(16 * 60));
  await page.type('#bl-reason', 'QA-Blocker');
  await page.screenshot({ path: OUT + 'desktop-admin-blocker-dialog.png' });
  await page.click('.dlg [data-act="ok"]'); await sleep(700);
  slots = await api((a, d) => a.slots({ serviceId: 'sv_fast', staffId: 'st_burak', date: d }), pick.d);
  const inBlock = slots.filter((s) => s.start >= 900 && s.start < 960);
  ok(inBlock.length === 0, `Blocker 15–16 Uhr: keine Burak-Slots in dem Fenster (${slots.length} andere frei)`);
  // manueller Termin + Verschieben im Admin
  await page.click('[data-new-appt]'); await sleep(300);
  await page.select('#na-svc', 'sv_fast'); await page.select('#na-staff', 'st_angelo');
  await page.$eval('#na-date', (e, d) => { e.value = d; }, pick.d);
  // freie Zeit bei Angelo wählen (Beispieltermine der Demo belegen schon einiges)
  const freeA = (await api((a, d) => a.slots({ serviceId: 'sv_fast', staffId: 'st_angelo', date: d }), pick.d)).map((x) => x.start).filter((t) => t >= 15 * 60);
  const naT = freeA[freeA.length - 1];
  await page.select('#na-time', String(naT));
  await page.type('#na-name', 'Walk-in Herr B.');
  await page.click('.dlg [data-act="ok"]'); await sleep(700);
  let ad = await api((a) => a.admin.data());
  const walk = ad.appointments.find((x) => x.name === 'Walk-in Herr B.');
  ok(walk && walk.staffId === 'st_angelo' && walk.start === naT, `Admin legt Termin manuell an (${naT / 60} Uhr)`);
  const mv = await api(async (a, id, d) => { try { await a.admin.moveAppointment(id, { date: d, start: 18 * 60, staffId: 'st_burak' }); return 'ok'; } catch (e) { return e.message; } }, walk.id, pick.d);
  ok(mv === 'ok', `Admin verschiebt Termin zu Burak 18:00 (${mv})`);
  const clash = await api(async (a, id, d, t) => { try { await a.admin.moveAppointment(id, { date: d, start: t, staffId: 'st_burak' }); return 'ok'; } catch (e) { return e.message; } }, walk.id, pick.d, pick.t);
  ok(clash !== 'ok', `Verschieben auf belegte Zeit wird abgelehnt: „${clash}“`);
  await page.reload({ waitUntil: 'load' }); await sleep(1500);
  for (let i = 0; i < 20; i++) { const has = await page.$(`.cal__col[data-date="${pick.d}"]`); if (has) break; await page.click('[data-cal-next]'); await sleep(100); }
  await page.screenshot({ path: OUT + 'desktop-admin-kalender.png' });

  // 5) Kundin storniert -> Slot wieder frei
  await page.evaluate(() => document.querySelector('[data-logout]').click()); await sleep(400);
  await page.goto(BASE + 'konto/', { waitUntil: 'networkidle0' }); await sleep(500);
  await page.type('#acc-email', 'test.kundin@example.com'); await page.type('#acc-pw', 'SicheresPasswort26');
  await page.click('[data-form="in"] button[type="submit"]'); await sleep(1500);
  await page.screenshot({ path: OUT + 'desktop-konto.png' });
  console.error('konto: Termine', await page.$$eval('[data-cancel],[data-move]', (b) => b.length));
  await page.click('[data-cancel]'); await sleep(300);
  console.error('dialog', await page.$$eval('dialog[open] [data-act]', (b) => b.map((x) => x.dataset.act + ':' + x.textContent)));
  await page.click('.dlg [data-act="ok"]'); await sleep(800);
  slots = await api((a, d) => a.slots({ serviceId: 'sv_wss', staffId: 'st_burak', date: d }), pick.d);
  ok(slots.some((s) => s.start === pick.t), 'Storno: Slot ist wieder frei');

  // 6) Bewertung: Demo-Kunde bewertet vergangenen Termin -> wartet -> Admin gibt frei -> Website
  await page.click('[data-view-link="profil"]'); await sleep(200);
  await page.evaluate(() => document.querySelector('[data-logout]').click()); await sleep(500);
  await page.click('[data-fill-demo]'); await page.click('[data-form="in"] button[type="submit"]'); await sleep(1500);
  await page.evaluate(() => { location.hash = '#termine'; }); await sleep(500);
  console.error('review buttons', await page.$$eval('[data-review]', (b) => b.map((x) => !!x.offsetParent)));
  await page.evaluate(() => [...document.querySelectorAll('[data-review]')].find((x) => x.offsetParent).scrollIntoView({ block: 'center' })); await sleep(200);
  await page.evaluate(() => [...document.querySelectorAll('[data-review]')].find((x) => x.offsetParent).click()); await sleep(400);
  await page.click('.star-input label:has(input[value="5"])');
  await page.type('#rv-text', 'QA: Sehr entspannt, Schnitt sitzt, gerne wieder.');
  await page.screenshot({ path: OUT + 'desktop-konto-bewerten.png' });
  await page.click('.dlg [data-act="ok"]'); await sleep(800);
  let pub = await api((a) => a.publicReviews());
  ok(!pub.list.some((r) => r.text.startsWith('QA:')), `Neue Bewertung noch nicht öffentlich (${pub.count} sichtbar)`);
  await page.goto(BASE + 'konto/#termine', { waitUntil: 'networkidle0' }); await sleep(800);
  await page.screenshot({ path: OUT + 'desktop-konto-termine.png' });
  await api((a) => a.logout());
  await page.goto(BASE + 'admin/#bewertungen', { waitUntil: 'networkidle0' }); await sleep(400);
  await page.click('[data-fill-demo]'); await page.click('[data-form="in"] button[type="submit"]'); await sleep(1500);
  await page.evaluate(() => document.querySelector('[data-nav="bewertungen"]').click()); await sleep(400);
  await page.screenshot({ path: OUT + 'desktop-admin-bewertungen.png' });
  const qaBtn = await page.evaluateHandle(() => [...document.querySelectorAll('.mod')].find((m) => m.textContent.includes('QA:')).querySelector('[data-approve]'));
  await qaBtn.asElement().click(); await sleep(700);
  pub = await api((a) => a.publicReviews());
  ok(pub.list.some((r) => r.text.startsWith('QA:')), `Nach Freigabe öffentlich (${pub.count}, Ø ${pub.avg.toFixed(2)})`);
  await page.goto(BASE + '#bewertungen', { waitUntil: 'networkidle0' }); await sleep(800);
  const onSite = await page.$$eval('.quote__text', (q) => q.some((x) => x.textContent.startsWith('QA:')));
  ok(onSite, `Website zeigt freigegebene Bewertung (${await page.$eval('[data-score-count]', (e) => e.textContent)}, Ø ${await page.$eval('[data-score-avg]', (e) => e.textContent)})`);
  // Preisänderung im Admin -> Website
  await api((a) => a.catalog().then((c) => a.admin.saveService({ ...c.services.find((s) => s.id === 'sv_fast'), price: 2700 })));
  await page.reload({ waitUntil: 'load' }); await sleep(1500);
  ok((await page.$eval('[data-svc="sv_fast"] .svc__price', (e) => e.textContent)).includes('27'), 'Preisänderung im Admin erscheint in „Leistungen“');
  await api((a) => a.catalog().then((c) => a.admin.saveService({ ...c.services.find((s) => s.id === 'sv_fast'), price: 2500 })));

  // 7) Mobile Screenshots
  const m = await ctx.newPage();
  m.on('pageerror', (e) => errs.push(`mobile pageerror ${e.message}`));
  m.setDefaultNavigationTimeout(40000); await m.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await m.goto(BASE, { waitUntil: 'networkidle0' }); await sleep(600);
  for (let y = 0; y < 30000; y += 700) { await m.evaluate((y) => window.scrollTo(0, y), y); await sleep(30); }
  await m.evaluate(() => document.querySelector('#buchen').scrollIntoView()); await sleep(1200);
  await m.click('[data-site-services] input[value="sv_bart"] + span'); await sleep(500);
  await m.evaluate(() => document.querySelector('[data-site-days]').scrollIntoView({ block: 'start' })); await m.evaluate(() => window.scrollBy(0, -120)); await sleep(700);
  await m.screenshot({ path: OUT + 'mobile-website-buchung.png' });
  await m.evaluate(() => document.querySelector('#bewertungen').scrollIntoView()); await sleep(1200);
  await m.screenshot({ path: OUT + 'mobile-website-bewertungen.png' });
  rep.push(`mobile overflow home: ${await m.evaluate(() => document.documentElement.scrollWidth - innerWidth)}`);
  await m.goto(BASE + 'buchen/?s=sv_bart', { waitUntil: 'networkidle0' }); await sleep(700);
  await m.screenshot({ path: OUT + 'mobile-buchen.png' });
  await m.evaluate(() => document.querySelector('[data-step="time"]').scrollIntoView()); await sleep(400);
  await m.screenshot({ path: OUT + 'mobile-buchen-termin.png' });
  rep.push(`mobile overflow buchen: ${await m.evaluate(() => document.documentElement.scrollWidth - innerWidth)}`);
  await m.goto(BASE + 'konto/', { waitUntil: 'networkidle0' }); await m.evaluate(() => localStorage.removeItem('brk.session.v1'));
  await m.goto(BASE + 'konto/', { waitUntil: 'networkidle0' }); await sleep(700);
  await m.screenshot({ path: OUT + 'mobile-konto-login.png' });
  await m.click('[data-fill-demo]'); await m.click('[data-form="in"] button[type="submit"]'); await sleep(1800);
  await m.screenshot({ path: OUT + 'mobile-konto.png' });
  rep.push(`mobile overflow konto: ${await m.evaluate(() => document.documentElement.scrollWidth - innerWidth)}`);
  await m.evaluate(() => localStorage.removeItem('brk.session.v1'));
  await m.goto(BASE + 'admin/', { waitUntil: 'networkidle0' }); await sleep(700);
  await m.click('[data-fill-demo]'); await m.click('[data-form="in"] button[type="submit"]'); await sleep(1800);
  await m.screenshot({ path: OUT + 'mobile-admin.png' });
  rep.push(`mobile overflow admin: ${await m.evaluate(() => document.documentElement.scrollWidth - innerWidth)}`);
  rep.push(errs.length ? `Fehler: ${errs.join(' / ')}` : 'Keine Konsolenfehler');
  await browser.close();
  console.log(rep.join('\n'));
})().catch((e) => { console.log(rep.join('\n')); console.error('ABBRUCH', e); process.exit(1); });
