// QA Studio-Pult: Kasse + Trinkgeld -> Buchhaltung/Kassenbuch, Lager, Gutschein-Restwert, Storno, Monatsabschluss-ZIP + Sperre, Rollen
const puppeteer = require('/tmp/kv/node_modules/puppeteer-core');
const fs = require('fs'); const { execSync } = require('child_process');
const BASE = process.argv[2] || 'http://127.0.0.1:8795/';
const OUT = process.argv[3] || '/workspace/brk-studio/qa/pult/';
const DL = '/tmp/pult-dl/'; fs.rmSync(DL, { recursive: true, force: true }); fs.mkdirSync(DL, { recursive: true }); fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rep = []; let fails = 0;
const ok = (c, m) => { if (!c) fails++; const l = `${c ? 'OK  ' : 'FAIL'} ${m}`; rep.push(l); console.error(l); };
(async () => {
  const headed = !!process.env.DISPLAY;
  const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: headed ? false : 'new', args: ['--no-sandbox', '--hide-scrollbars', '--window-size=1440,1000'], defaultViewport: null });
  const ctx = b.defaultBrowserContext();
  const page = await ctx.newPage(); await page.setBypassCSP(true); // Test-Helfer werten Code im Seitenkontext aus; CSP selbst prüft qa-csp.js await page.setViewport({ width: 1440, height: 900 });
  const cdp = await b.target().createCDPSession(); await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL });
  const errs = []; page.on('pageerror', (e) => errs.push('pageerror ' + e.message)); page.on('console', (m) => { if (m.type() === 'error') errs.push('console ' + m.text()); });
  page.on('dialog', (d) => d.accept());
  const mod = (fn, ...args) => page.evaluate(async (src, args) => {
    const root = document.baseURI.replace(/(buchen|konto|admin)\/.*$/, '');
    const M = { api: (await import(root + 'assets/js/app/api.js')), pult: (await import(root + 'assets/js/app/pult-api.js')).pult, L: await import(root + 'assets/js/app/ledger.js') };
    return (0, eval)(src)(M, ...args);
  }, fn.toString(), args);
  const go = async (h) => { await page.evaluate((h) => { location.hash = h; }, h); await sleep(900); };

  await page.goto(BASE + 'admin/', { waitUntil: 'networkidle0' });
  await page.evaluate(() => localStorage.clear()); await page.reload({ waitUntil: 'networkidle0' }); await sleep(400);
  // Login-Ratenbegrenzung: 5 falsche Versuche -> Sperre
  for (let i = 0; i < 6; i++) { await page.$eval('[data-form="in"] [name="email"]', (e) => { e.value = 'burak@brk-studio.demo'; }); await page.$eval('[data-form="in"] [name="password"]', (e) => { e.value = 'falsch-' + Math.random(); }); await page.click('[data-form="in"] button[type="submit"]'); await page.waitForFunction(() => !document.querySelector('[data-form="in"] button[type="submit"]').disabled && !document.querySelector('[data-form="in"]').getAttribute('aria-busy')); await sleep(300); }
  const lockMsg = await page.evaluate(() => document.body.innerText);
  ok(/Sekunden|gesperrt|später|Versuche/i.test(lockMsg), 'Login-Ratenbegrenzung greift nach 5 Fehlversuchen');
  const attemptsStored = await page.evaluate(() => !!localStorage.getItem('brk.attempts.v1'));
  ok(attemptsStored, 'Fehlversuche bleiben nach Neuladen gespeichert');
  await page.evaluate(() => localStorage.removeItem('brk.attempts.v1')); await page.reload({ waitUntil: 'networkidle0' }); await sleep(400);
  const pwPlain = await page.evaluate(() => { const raw = localStorage.getItem(Object.keys(localStorage).find((k) => k.startsWith('brk.') && localStorage.getItem(k).length > 100000) || ''); return raw ? /Burak#Demo2026|Angelo#Demo2026|Kunde#Demo2026/.test(raw) : null; });
  ok(pwPlain === false, 'Keine Klartext-Passwörter im Speicher (PBKDF2-Hashes)');

  // Mitarbeiter-Login: kein Zugriff auf Buchhaltung
  await page.click('[data-fill-demo="staff"]'); await page.click('[data-form="in"] button[type="submit"]'); await sleep(2200);
  const staff = await page.evaluate(() => ({ pult: !document.querySelector('[data-pult]').hidden, bh: [...document.querySelectorAll('[data-nav="buchhaltung"]')].every((e) => e.hidden || !e.offsetParent), hash: location.hash }));
  ok(staff.pult && staff.bh, `Mitarbeiter-Login (Angelo): Pult offen, Buchhaltung ausgeblendet, Start ${staff.hash}`);
  const staffDenied = await mod(async (M) => { try { await M.pult.closeMonth('2026-10', 'x'); return 'erlaubt'; } catch (e) { return e.message; } });
  ok(staffDenied !== 'erlaubt', `Mitarbeiter darf keinen Monatsabschluss: „${staffDenied}“`);
  const staffVoid = await mod(async (M) => { const db = await M.pult.load(); try { await M.pult.voidBon(db.transactions[db.transactions.length - 1].id, 'x'); return 'erlaubt'; } catch (e) { return e.message; } });
  ok(staffVoid !== 'erlaubt', `Mitarbeiter darf nicht stornieren: „${staffVoid}“`);
  await mod(async (M) => M.api.api.logout()); await page.reload({ waitUntil: 'networkidle0' }); await sleep(500);

  // Admin-Login
  await page.click('[data-fill-demo]:not([data-fill-demo="staff"])'); await page.click('[data-form="in"] button[type="submit"]'); await sleep(2500);
  ok(await page.$eval('[data-pult]', (e) => !e.hidden), 'Admin-Login');
  await go('uebersicht'); await page.screenshot({ path: OUT + 'desktop-kpis.png' });
  await page.evaluate(() => document.querySelector('.dash').scrollIntoView({ block: 'start' })); await sleep(300); await page.screenshot({ path: OUT + 'desktop-dashboard-diagramme.png' });

  // Kasse über die Oberfläche: Termin + Produkt + Trinkgeld bar + Barzahlung
  const before = await mod(async (M) => { const db = await M.pult.load(); return { n: db.transactions.length, stock: Object.fromEntries(db.products.map((p) => [p.id, p.stock])) }; });
  await go('kasse');
  await page.click('[data-load-appt]'); await sleep(400);
  await page.click('[data-ktab="product"]'); await sleep(300);
  const prodId = await page.$eval('[data-add^="product:"]:not([disabled])', (e) => e.dataset.add.split(':')[1]);
  await page.click(`[data-add="product:${prodId}"]`); await sleep(300);
  await page.click('[data-tip] [data-tip-amt]', { clickCount: 3 }); await page.type('[data-tip] [data-tip-amt]', '5,00'); await page.keyboard.press('Tab'); await sleep(300);
  await page.click('[data-tip] [data-tip-m="cash"]'); await sleep(300);
  await page.click('[data-pay-add="cash"]'); await sleep(300);
  const due = await page.$eval('[data-sum-total]', (e) => e.textContent);
  await page.screenshot({ path: OUT + 'desktop-kasse.png' });
  await page.evaluate(() => document.querySelector('.pos__tips').scrollIntoView({ block: 'center' })); await sleep(250);
  await page.screenshot({ path: OUT + 'desktop-trinkgeld.png' });
  await page.click('[data-checkout]'); await sleep(1500);
  const bonOpen = await page.evaluate(() => { const d = [...document.querySelectorAll('dialog')].find((x) => x.open); return d ? d.textContent : ''; });
  ok(/TSE nicht angeschlossen/.test(bonOpen) && /Trinkgeld/.test(bonOpen), `Bon nach Kassieren (${due}) mit TSE-Hinweis und Trinkgeld`);
  await page.screenshot({ path: OUT + 'desktop-bon.png' });
  await page.keyboard.press('Escape'); await sleep(300);
  const after = await mod(async (M, prodId) => {
    const db = await M.pult.load(); const t = db.transactions[db.transactions.length - 1]; const today = t.date;
    const tips = M.L.tipsReport(db.transactions.filter((x) => x.date === today));
    const cb = M.L.cashBook(db.transactions, db.cashmoves, today, today);
    return { n: db.transactions.length, t, stock: db.products.find((p) => p.id === prodId).stock, tipRow: tips.find((x) => x.staffId === t.tips[0].staffId), cbRow: cb.rows.find((r) => r.ref === t.id), cashOf: M.L.cashOf(t) };
  }, prodId);
  ok(after.n === before.n + 1, `Neuer Bon ${after.t.no} gespeichert (fortlaufend)`);
  ok(after.t.tips.length === 1 && after.t.tips[0].amount === 500 && after.t.tips[0].method === 'cash', 'Trinkgeld 5,00 € bar je Mitarbeiter am Bon');
  ok(after.tipRow && after.tipRow.cash >= 500, `Trinkgeld in der Buchhaltung (Trinkgeld-Bericht heute bar ${after.tipRow && after.tipRow.cash / 100} €)`);
  ok(after.cbRow && after.cbRow.amount === after.cashOf && after.cashOf === after.t.totals.due + 500, `Trinkgeld im Kassenbuch: Zugang ${after.cbRow && after.cbRow.amount / 100} € = Bon ${after.t.totals.due / 100} € + 5 € Trinkgeld`);
  ok(after.stock === before.stock[prodId] - 1, `Lager: ${prodId} von ${before.stock[prodId]} auf ${after.stock}`);
  ok(after.t.totals.tax > 0 && !after.t.lines.some((l) => l.kind === 'tip'), 'Trinkgeld ist keine Umsatzposition (ohne USt.)');

  // Gutschein: verkaufen 50 €, 20 € einlösen -> Rest 30 €
  const vo = await mod(async (M) => {
    const db = await M.pult.load(); const sv = db.services.find((s) => s.active !== false); const me = db.me.staffId || 'st_burak';
    const sale = await M.pult.checkout({ lines: [{ kind: 'voucher', name: 'Gutschein', unit: 5000, qty: 1, discount: 0 }], payments: [{ method: 'card', amount: 5000 }], tips: [] });
    const code = sale.lines[0].code;
    const use = await M.pult.checkout({ lines: [{ kind: 'service', refId: sv.id, name: sv.name, unit: 2000, qty: 1, discount: 0, staffId: me }], payments: [{ method: 'voucher', ref: code, amount: 2000 }], tips: [] });
    let over = 'kein Fehler'; try { await M.pult.checkout({ lines: [{ kind: 'service', refId: sv.id, name: sv.name, unit: 4000, qty: 1, discount: 0, staffId: me }], payments: [{ method: 'voucher', ref: code, amount: 4000 }], tips: [] }); } catch (e) { over = e.message; }
    const db2 = await M.pult.load(); const v = M.L.voucherState(db2.vouchers, db2.transactions, use.date).find((x) => x.code === code);
    return { code, rem: v.remaining, status: v.status, saleTax: sale.totals.tax, useTax: use.totals.tax, over };
  });
  ok(vo.rem === 3000 && vo.status === 'teilweise', `Gutschein ${vo.code}: Restwert ${vo.rem / 100} € (${vo.status})`);
  ok(vo.saleTax === 0 && vo.useTax > 0, 'Gutscheinverkauf ohne USt., USt. erst bei Einlösung');
  ok(/nur noch/.test(vo.over), `Überzug abgelehnt: „${vo.over}“`);
  await go('gutscheine'); await page.type('.check-code input', vo.code); await page.click('.check-code button'); await sleep(400);
  const chk = await page.$eval('.check-code__out', (e) => e.textContent);
  ok(/30,00/.test(chk), `Code-Prüfung in der Oberfläche zeigt Restwert: „${chk.trim()}“`);

  // Storno nur als Gegenbuchung
  const st = await mod(async (M, id) => { const r = await M.pult.voidBon(id, 'QA-Test'); const db = await M.pult.load(); const orig = db.transactions.find((t) => t.id === id); const d = await M.api.adapter(); let del = 'gelöscht'; try { await d.remove('transactions', id); } catch (e) { del = e.message; } let upd = 'geändert'; try { await d.update('transactions', id, { note: 'x' }); } catch (e) { upd = e.message; } return { rev: r.totals.due, orig: !!orig, voidOf: r.voidOf === id, del, upd }; }, after.t.id);
  ok(st.orig && st.voidOf && st.rev === -after.t.totals.due, `Storno als Gegenbon (${st.rev / 100} €), Original bleibt erhalten`);
  ok(st.del !== 'gelöscht' && st.upd !== 'geändert', `Belege sind nur anhängbar: Löschen „${st.del}“`);
  const stockBack = await mod(async (M, pid) => (await M.pult.load()).products.find((p) => p.id === pid).stock, prodId);
  ok(stockBack === before.stock[prodId], 'Storno bucht Lagerbestand zurück');

  // Monatsabschluss Oktober 2026: ZIP prüfen, dann sperren
  await go('buchhaltung/abschluss'); await sleep(400);
  const month = await page.$eval('[data-ab-month]', (e) => e.value);
  await page.screenshot({ path: OUT + 'desktop-monatsabschluss.png' });
  await page.click('[data-ab-zip]'); await sleep(2500);
  const zipName = fs.readdirSync(DL).find((f) => f.endsWith('.zip'));
  ok(!!zipName, `ZIP heruntergeladen: ${zipName}`);
  const py = execSync(`python3 /workspace/brk-studio/tools/check_zip.py ${DL}${zipName}`).toString();
  const zr = JSON.parse(py);
  ok(zr.ok_zip, `ZIP gültig (zipfile.testzip), Dateien: ${zr.files.join(', ')}`);
  ok(zr.extf_header, `DATEV-Kopf EXTF;700;21;Buchungsstapel;13 · Berater ${zr.consultant} · Mandant ${zr.client} · SKR ${zr.skr} · ${zr.cols} Spalten · CRLF ${zr.crlf} · cp1252 ${zr.cp1252}`);
  const rep2 = await mod(async (M, m) => { const db = await M.pult.load(); const r = M.L.monthReport({ txs: db.transactions, moves: db.cashmoves, month: m, staffName: (id) => id, vouchers: db.vouchers, today: m + '-28' }); return { gross: r.revenue.gross, tips: r.tipsTotal }; }, month);
  ok(zr.revenue_cents === rep2.gross, `DATEV-Erlöskonten ${zr.revenue_cents / 100} € = Monatsbericht brutto ${rep2.gross / 100} €`);
  ok(zr.tips_cents === rep2.tips, `Trinkgeld auf Durchlaufende Posten ${zr.tips_cents / 100} € = Bericht ${rep2.tips / 100} €, ohne BU-Schlüssel`);
  ok(zr.report_has_gross, 'Monatsbericht (HTML) im ZIP nennt dieselbe Bruttosumme');
  ok(zr.tx_rows > 100 && zr.tx_injection_safe, `Transaktions-CSV: ${zr.tx_rows} Zeilen, Formel-Injection neutralisiert`);
  await page.click('[data-ab-lock]'); await sleep(500); await page.click('dialog[open] [data-act="ok"]'); await sleep(1500);
  const locked = await page.$eval('.close__status', (e) => e.textContent);
  ok(/Abgeschlossen/.test(locked), `Monat ${month} abgeschlossen`);
  const lockTry = await mod(async (M, m) => { const d = await M.api.adapter(); const r = {}; for (const [t, row] of [['transactions', { date: m + '-15', month: m, lines: [], payments: [], tips: [], totals: { due: 0 } }], ['cashmoves', { date: m + '-15', kind: 'withdrawal', amount: -100 }], ['stockmoves', { date: m + '-15', productId: 'pr_balm', qty: 1, kind: 'in' }]]) { try { await d.insert(t, row); r[t] = 'erlaubt'; } catch (e) { r[t] = e.message; } } return r; }, month);
  ok(Object.values(lockTry).every((x) => x !== 'erlaubt'), `Monatssperre: Buchung in ${month} abgelehnt („${lockTry.transactions}“)`);
  await page.screenshot({ path: OUT + 'desktop-monatsabschluss-gesperrt.png' });

  // Kalender + Kundenkartei
  await go('kalender'); await sleep(500); await page.screenshot({ path: OUT + 'desktop-kalender.png' });
  await page.evaluate(() => { const b = document.querySelector('[data-mode="res"]'); if (b) b.click(); }); await sleep(600); await page.screenshot({ path: OUT + 'desktop-kalender-plaetze.png' });
  const resCols = await page.evaluate(() => document.querySelectorAll('.cal__col, [data-col]').length);
  ok(resCols >= 4, `Kalender Plätze-Ansicht: ${resCols} Spalten`);
  await page.evaluate(() => { const b = document.querySelector('[data-mode="staff"]'); if (b) b.click(); }); await sleep(300);
  await go('kunden'); await page.click('tr.is-click'); await sleep(600);
  const kd = await page.evaluate(() => document.querySelector('.client') ? document.querySelector('.client').textContent.length : 0);
  ok(kd > 200, 'Kundenkartei öffnet Detail mit Historie');
  await page.screenshot({ path: OUT + 'desktop-kundenkartei.png' });

  // Exporte: CSV mit BOM + Injection-Schutz
  const csv = await mod(async (M) => { const { toCSV } = M.L; return toCSV([['=HYPERLINK("x")', 1234], ['+1', null], ['@SUM(A1)', -5]], [{ label: 'A', get: (r) => r[0] }, { label: 'B', type: 'money', get: (r) => r[1] }]); });
  ok(/'=HYPERLINK/.test(csv) && /'\+1/.test(csv) && /'@SUM/.test(csv), 'CSV-Export setzt Apostroph vor =, +, @');

  // Mobil: Dashboard
  const m = await ctx.newPage(); await m.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  m.on('pageerror', (e) => errs.push('mobile pageerror ' + e.message));
  await m.goto(BASE + 'admin/#uebersicht', { waitUntil: 'networkidle0' }); await sleep(1500);
  await m.screenshot({ path: OUT + 'mobile-dashboard.png' });
  const ow = await m.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  ok(ow <= 0, `Mobil kein horizontales Scrollen (${ow}px)`);
  await m.evaluate(() => { location.hash = 'kasse'; }); await sleep(900); await m.screenshot({ path: OUT + 'mobile-kasse.png' });
  const ow2 = await m.evaluate(() => document.documentElement.scrollWidth - innerWidth); ok(ow2 <= 0, `Mobil Kasse ohne Überlauf (${ow2}px)`);
  const t = await ctx.newPage(); await t.setViewport({ width: 1024, height: 768, hasTouch: true });
  await t.goto(BASE + 'admin/#kasse', { waitUntil: 'networkidle0' }); await sleep(1300); await t.screenshot({ path: OUT + 'tablet-kasse.png' });
  ok(errs.length === 0, `Keine JS-Fehler${errs.length ? ': ' + errs.join(' | ') : ''}`);
  fs.writeFileSync(OUT + 'qa-pult.txt', rep.join('\n') + `\n\n${rep.length - fails}/${rep.length} OK\n`);
  console.log(`${rep.length - fails}/${rep.length} OK`);
  await b.close(); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
