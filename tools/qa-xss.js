// XSS-Probe: schreibt HTML-Nutzlasten direkt in die Demo-Daten (als kämen sie manipuliert vom Server)
// und prüft auf allen Seiten und Pult-Bereichen, dass daraus kein Element entsteht.
const puppeteer = require('/tmp/kv/node_modules/puppeteer-core');
const BASE = process.argv[2] || 'http://127.0.0.1:8795/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const X = '<img data-xss src=x><b data-xss>X</b>';
(async () => {
  const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
  const page = await b.newPage(); await page.setViewport({ width: 1440, height: 900 });
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(BASE + 'admin/', { waitUntil: 'networkidle0' }); await page.evaluate(() => localStorage.clear()); await page.reload({ waitUntil: 'networkidle0' }); await sleep(500);
  await page.click('[data-fill-demo]:not([data-fill-demo="staff"])'); await page.click('[data-form="in"] button[type="submit"]'); await sleep(2500);
  await page.evaluate((X) => {
    const d = JSON.parse(localStorage.getItem('brk.platform.v1'));
    const set = (o, ...k) => { for (const x of k) if (o) o[x] = `${X}${o[x] || ''}`; };
    d.clients.slice(0, 3).forEach((c) => set(c, 'name', 'notes', 'prefs', 'email', 'phone'));
    d.products.slice(0, 3).forEach((p) => set(p, 'name', 'cat', 'sku'));
    d.packages.forEach((p) => set(p, 'name'));
    d.services.slice(0, 2).forEach((s) => set(s, 'name', 'cat'));
    d.staff.forEach((s) => set(s, 'role', 'bio'));
    d.resources.forEach((r) => set(r, 'name'));
    d.appointments.slice(-40).forEach((a) => set(a, 'name', 'note', 'phone'));
    d.vouchers.forEach((v) => set(v, 'buyer', 'note'));
    d.transactions.slice(-60).forEach((t) => { set(t, 'clientName', 'note'); t.lines.forEach((l) => set(l, 'name')); });
    d.installments.forEach((p) => set(p, 'note', 'clientName'));
    d.cashmoves.slice(-20).forEach((m) => set(m, 'text'));
    d.stockmoves.slice(-20).forEach((m) => set(m, 'note'));
    d.reviews.forEach((r) => set(r, 'name', 'text'));
    d.blockers.forEach((x) => set(x, 'reason'));
    d.audit.forEach((x) => set(x, 'detail', 'byName'));
    d.stats.forEach((x) => set(x, 'name'));
    d.settings.business = { ...(d.settings.business || {}), footer: X, name: `${X}BRK`, street: X };
    localStorage.setItem('brk.platform.v1', JSON.stringify(d));
  }, X);
  await page.reload({ waitUntil: 'networkidle0' }); await sleep(2000);
  const hits = []; let shown = 0;
  const check = async (where) => { const [n, t] = await page.evaluate(() => [document.querySelectorAll('[data-xss]').length, document.body.innerText.includes('<img data-xss')]); if (t) shown++; if (n) hits.push(`${where}: ${n}`); };
  const panels = ['uebersicht', 'kalender', 'kasse', 'belege', 'kunden', 'gutscheine', 'bewertungen', 'team', 'leistungen', 'produkte', 'pakete', 'buchhaltung', 'zahlungen', 'statistiken', 'einstellungen'];
  for (const p of panels) { await page.evaluate((p) => { location.hash = p; }, p); await sleep(700); await check(p); }
  for (const s of ['kennzahlen', 'weitere', 'umsatz', 'mitarbeiter', 'dienstleistungen', 'produkte', 'mwst', 'zahlungsarten', 'bargeld', 'gutscheine', 'pakete', 'trinkgeld', 'abschluss']) { await page.evaluate((s) => { location.hash = 'buchhaltung/' + s; }, s); await sleep(500); await check('buchhaltung/' + s); }
  await page.evaluate(() => { location.hash = 'kunden'; }); await sleep(600);
  await page.evaluate(() => { const r = document.querySelector('tr.is-click'); if (r) r.click(); }); await sleep(500); await check('kundendetail');
  for (const t of ['termine', 'kaeufe', 'produkte', 'guthaben']) { await page.evaluate((t) => { const b = document.querySelector(`[data-ctab="${t}"]`); if (b) b.click(); }, t); await sleep(300); await check('kunde/' + t); }
  await page.evaluate(() => { location.hash = 'belege'; }); await sleep(600); await page.evaluate(() => { const r = document.querySelector('tr.is-click'); if (r) r.click(); }); await sleep(600); await check('bon-dialog');
  await page.keyboard.press('Escape');
  for (const tab of ['service', 'product', 'voucher', 'package', 'more']) { await page.evaluate(() => { location.hash = 'kasse'; }); await sleep(300); await page.evaluate((t) => { const b = document.querySelector(`[data-ktab="${t}"]`); if (b) b.click(); }, tab); await sleep(300); await check('kasse/' + tab); }
  await page.evaluate(() => { location.hash = 'kasse'; }); await sleep(400); await page.click('[data-load-appt]').catch(() => {}); await sleep(400); await check('kasse/warenkorb');
  await page.evaluate(() => { location.hash = 'kalender'; }); await sleep(600); await page.evaluate(() => { const e = document.querySelector('.ev'); if (e) e.click(); }); await sleep(500); await check('termin-detail');
  for (const p of ['', 'buchen/', 'konto/']) { await page.goto(BASE + p, { waitUntil: 'networkidle0' }); await sleep(1500); await check('/' + p); }
  console.log(hits.length ? `FAIL XSS: ${hits.join(', ')}` : 'OK   Keine eingeschleusten Elemente in ' + (panels.length + 13 + 13) + ' Ansichten (Nutzlast sichtbar als Text in ' + shown + ')');
  console.log(errs.length ? `JS-Fehler: ${errs.slice(0, 5).join(' | ')}` : 'OK   Keine JS-Fehler');
  await b.close(); process.exit(hits.length ? 1 : 0);
})();
