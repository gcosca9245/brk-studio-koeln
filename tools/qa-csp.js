// Prüft alle Seiten auf CSP-Verstöße und JS-Fehler
const puppeteer = require('/tmp/kv/node_modules/puppeteer-core');
const BASE = process.argv[2] || 'http://127.0.0.1:8795/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
  const pages = ['', 'impressum.html', 'datenschutz.html', 'buchen/', 'konto/', 'admin/'];
  let bad = 0;
  for (const p of pages) {
    const pg = await b.newPage(); await pg.setViewport({ width: 1440, height: 900 });
    const msgs = [];
    pg.on('console', (m) => { const t = m.text(); if (m.type() === 'error' || /Content Security Policy|Refused/.test(t)) msgs.push(t); });
    pg.on('pageerror', (e) => msgs.push('pageerror ' + e.message));
    await pg.goto(BASE + p, { waitUntil: 'networkidle0' }); await sleep(1500);
    if (p === '') { await pg.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2)); await sleep(800); await pg.evaluate(() => { const b = document.querySelector('[data-map-load], .map button, [data-map] button'); if (b) b.click(); }); await sleep(1500); }
    if (p === 'admin/') { await pg.click('[data-fill-demo]:not([data-fill-demo="staff"])'); await pg.click('[data-form="in"] button[type="submit"]'); await sleep(2500); for (const h of ['kasse', 'buchhaltung/abschluss', 'statistiken', 'kunden', 'kalender']) { await pg.evaluate((h) => { location.hash = h; }, h); await sleep(700); } }
    const meta = await pg.evaluate(() => !!document.querySelector('meta[http-equiv="Content-Security-Policy"]') && !!document.querySelector('meta[name="referrer"]'));
    console.log(`${msgs.length || !meta ? 'FAIL' : 'OK  '} /${p} csp-meta=${meta} ${msgs.slice(0, 4).join(' | ')}`); if (msgs.length || !meta) bad++;
    await pg.close();
  }
  await b.close(); process.exit(bad ? 1 : 0);
})();
