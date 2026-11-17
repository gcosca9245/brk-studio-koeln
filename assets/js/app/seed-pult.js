/* BRK Studio Studio-Pult – Beispieldaten für Kasse, Kunden, Lager, Gutscheine und Buchhaltung (Demo)
   Deterministisch (fester Zufallsstartwert), alles mit example: true markiert.
   Zeitraum: Erster des Monats vor einem Jahr bis heute, damit Vorjahresvergleiche funktionieren. */
import { addDays, weekday } from './util.js';
import { buildBon, reverseBon, lineGross } from './ledger.js';

const H = (h, m = 0) => h * 60 + m;
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export const PRODUCTS = [
  ['pr_paste', 'Matte Paste 100 ml', 'Styling', 2200, 19, 980, 14, 4],
  ['pr_pomade', 'Pomade Strong Hold 113 g', 'Styling', 1990, 19, 850, 12, 4],
  ['pr_wax', 'Haarwachs Matt 75 ml', 'Styling', 1790, 19, 720, 10, 3],
  ['pr_salt', 'Sea Salt Spray 200 ml', 'Styling', 1890, 19, 790, 9, 3],
  ['pr_oil', 'Bartöl Zeder 30 ml', 'Bart', 2400, 19, 1050, 12, 4],
  ['pr_balm', 'Bartbalsam 50 ml', 'Bart', 2100, 19, 890, 8, 3],
  ['pr_brush', 'Bartbürste Wildschwein', 'Bart', 2900, 19, 1300, 6, 2],
  ['pr_after', 'Aftershave Lotion 100 ml', 'Bart', 2600, 19, 1100, 7, 2],
  ['pr_shampoo', 'Shampoo Daily 250 ml', 'Pflege', 1800, 19, 690, 14, 5],
  ['pr_cond', 'Conditioner 250 ml', 'Pflege', 1900, 19, 740, 10, 4],
  ['pr_mask', 'Haarkur Repair 150 ml', 'Pflege', 2900, 19, 1240, 6, 3],
  ['pr_heat', 'Hitzeschutz-Spray 150 ml', 'Pflege', 2100, 19, 860, 6, 3],
  ['pr_comb', 'Taschenkamm Holz', 'Zubehör', 900, 19, 280, 15, 5],
  ['pr_coffee', 'Espressobohnen 250 g', 'Feinkost', 1250, 7, 640, 10, 4],
];
const FIRST_M = ['Kemal', 'Jonas', 'Luca', 'Tim', 'Deniz', 'Paul', 'Emre', 'Max', 'Can', 'Felix', 'Noah', 'Ali', 'Leon', 'Murat', 'Ben', 'Elias', 'Yusuf', 'David', 'Julian', 'Arda', 'Moritz', 'Serkan', 'Niklas', 'Omar', 'Lukas', 'Tobias', 'Hakan', 'Marco', 'Finn', 'Burak S.'];
const FIRST_F = ['Sarah', 'Lea', 'Mira', 'Anna', 'Elif', 'Laura', 'Selin', 'Julia', 'Lena', 'Zeynep', 'Hannah', 'Nina', 'Sophie', 'Ayse', 'Clara', 'Marie', 'Melis', 'Johanna', 'Emma', 'Lina'];
const LAST = 'ABCDEFGHKLMNPRSTWYZ';

export function buildPultSeed(today, base, nowMinutes = H(23, 59)) {
  const R = rng(20260117);
  const pick = (arr) => arr[Math.floor(R() * arr.length)];
  const chance = (p) => R() < p;
  const svc = Object.fromEntries(base.services.map((s) => [s.id, s]));
  const settings = base.settings;
  const [ty, tm] = today.split('-').map(Number);
  const start = `${tm === 12 ? ty : ty - 1}-${String(tm === 12 ? 1 : tm + 1).padStart(2, '0')}-01`.replace(/^(\d+)-(\d+)-01$/, (m0, y, mo) => (tm === 12 ? `${ty}-01-01` : `${ty - 1}-${String(tm).padStart(2, '0')}-01`));
  const ex = { example: true };

  /* ---------- Stammdaten ---------- */
  const products = PRODUCTS.map(([id, name, cat, price, vat, cost, target, min], i) => ({ id, name, cat, price, vat, cost, stock: 0, minStock: min, target, sku: `BRK-${String(1001 + i)}`, active: true, order: i + 1, ...ex }));
  const P = Object.fromEntries(products.map((p) => [p.id, p]));
  const packages = [
    { id: 'pk_bart5', name: '5 × Haarschnitt + Bart', items: [{ serviceId: 'sv_bart', count: 5 }], price: 19900, vat: 19, validMonths: 12, active: true, ...ex },
    { id: 'pk_fast10', name: '10 × Fast Cut', items: [{ serviceId: 'sv_fast', count: 10 }], price: 21900, vat: 19, validMonths: 12, active: true, ...ex },
    { id: 'pk_glow', name: 'Balayage + 2 × Schneiden & Föhnen', items: [{ serviceId: 'sv_bal', count: 1 }, { serviceId: 'sv_sf', count: 2 }], price: 34900, vat: 19, validMonths: 9, active: true, ...ex },
  ];
  const resources = [
    { id: 'rs_1', name: 'Stuhl 1 · Fenster', type: 'chair', order: 1, ...ex },
    { id: 'rs_2', name: 'Stuhl 2', type: 'chair', order: 2, ...ex },
    { id: 'rs_3', name: 'Farbplatz', type: 'color', order: 3, ...ex },
    { id: 'rs_4', name: 'Waschplatz', type: 'wash', order: 4, ...ex },
  ];
  const staffChair = { st_burak: 'rs_1', st_angelo: 'rs_2' };
  const resFor = (serviceId, staffId) => (['sv_bal', 'sv_str'].includes(serviceId) ? 'rs_3' : staffChair[staffId] || 'rs_2');
  const breaks = { st_burak: [H(15), H(15, 30)], st_angelo: [H(14, 30), H(15)] };

  /* ---------- Kundenkartei ---------- */
  const clients = [];
  const addClient = (name, g, extra = {}) => { const c = { id: `cl_s${clients.length + 1}`, name, g, phone: `0171 ${String(1000000 + Math.floor(R() * 8999999))}`, email: '', userId: null, prefs: '', notes: '', tags: [], birthday: '', createdAt: `${start}T10:00:00.000Z`, consent: { email: chance(0.7), sms: chance(0.4) }, ...ex, ...extra }; clients.push(c); return c; };
  const known = { 'Kemal A.': 'm', 'Jonas W.': 'm', 'Luca R.': 'm', 'Tim S.': 'm', 'Deniz Y.': 'm', 'Paul F.': 'm', 'Sarah M.': 'f', 'Lea K.': 'f', 'Mira H.': 'f' };
  for (const [n, g] of Object.entries(known)) addClient(n, g);
  const demoUser = base.users.find((u) => u.id === 'us_kunde');
  const demoClient = addClient('Demo Kunde', 'm', { userId: 'us_kunde', email: demoUser ? demoUser.email : '', phone: demoUser ? demoUser.phone : '', prefs: 'Fade 2 mm an den Seiten, oben Schere. Espresso ohne Zucker.', tags: ['Stammkunde'] });
  const used = new Set(Object.keys(known));
  while (clients.length < 72) {
    const g = clients.length % 3 === 0 ? 'f' : 'm';
    const n = `${pick(g === 'f' ? FIRST_F : FIRST_M)} ${pick(LAST.split(''))}.`;
    if (used.has(n)) continue; used.add(n); addClient(n, g);
  }
  const PREFS = ['Seiten 3 mm, Übergang weich.', 'Bart kurz halten, Kontur scharf.', 'Kein Haarspray, eher matt.', 'Mag es ruhig, wenig Smalltalk.', 'Allergie: keine Duftstoffe.', 'Pony etwas länger lassen.', 'Kaffee mit Hafermilch.', 'Föhnen mit Rundbürste, Volumen am Ansatz.'];
  clients.forEach((c, i) => { if (!c.prefs && i % 3 === 0) c.prefs = PREFS[i % PREFS.length]; if (i % 5 === 0) c.tags = ['Stammkunde']; if (i % 11 === 0) c.notes = 'Beispielnotiz: bevorzugt Termine am Samstag.'; if (i % 7 === 0) c.birthday = `19${80 + (i % 20)}-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 27) + 1).padStart(2, '0')}`; });
  const men = clients.filter((c) => c.g === 'm'), women = clients.filter((c) => c.g === 'f');
  // Stammkunden kommen öfter: gewichtete Auswahl
  const weighted = (pool) => pool[Math.floor(Math.pow(R(), 1.8) * pool.length)];
  const byName = Object.fromEntries(clients.map((c) => [c.name, c]));

  /* ---------- Simulation ---------- */
  const tx = [];             // Belege ohne Nummer
  const stockmoves = [], cashmoves = [], vouchers = [], packageCards = [], installments = [], appointments = [], attendance = [];
  let tid = 0, mid = 0, aid = 0;
  const T = (o) => { const t = { id: `tx_s${++tid}`, ...o, ...ex }; tx.push(t); return t; };
  const mv = (o) => { const m = { id: `mv_s${++mid}`, ...o, ...ex }; return m; };
  products.forEach((p) => { p.stock = p.target + 6; stockmoves.push(mv({ productId: p.id, date: start, qty: p.stock, kind: 'count', note: 'Anfangsinventur', cost: p.cost })); });
  cashmoves.push(mv({ date: start, time: 0, kind: 'opening', amount: 20000, text: 'Wechselgeld' }));

  const priceOf = (s) => (s.priceMode === 'range' ? s.price + Math.floor(R() * ((s.priceTo - s.price) / 500 + 1)) * 500 : s.priceMode === 'from' ? s.price + Math.floor(R() * 9) * 1000 : s.price);
  const MIX = {
    st_burak: [['sv_wss', 40], ['sv_bart', 32], ['sv_fast', 24], ['sv_sf', 4]],
    st_angelo: [['sv_sf', 28], ['sv_wss', 20], ['sv_bal', 11], ['sv_str', 12], ['sv_bart', 12], ['sv_fast', 17]],
  };
  const pickSvc = (st) => { const m = MIX[st] || MIX.st_angelo; let r = R() * m.reduce((s, x) => s + x[1], 0); for (const [id, w] of m) { r -= w; if (r <= 0) return id; } return m[0][0]; };
  const activeVouchers = [];
  const cardsDue = [];
  let cashBal = 20000;
  const existing = base.appointments.filter((a) => a.status === 'booked');
  const blockersOf = (date, st) => base.blockers.filter((b) => b.date === date && (!b.staffId || b.staffId === st)).map((b) => [b.start, b.end]);
  const lastFutureDay = addDays(today, 10);
  const monthSeen = new Set();

  for (let date = start; date <= lastFutureDay; date = addDays(date, 1)) {
    const wd = weekday(date), hrs = settings.hours[wd];
    if (!hrs) continue;
    const past = date < today, isToday = date === today, future = date > today;
    const month = date.slice(0, 7);
    let dayTips = 0;
    const dayBons = [];
    for (const st of ['st_burak', 'st_angelo']) {
      const taken = [...blockersOf(date, st), breaks[st]];
      for (const a of existing.filter((x) => x.date === date && x.staffId === st)) taken.push([a.start, a.start + a.duration]);
      const free = (s0, d) => !taken.some(([a, b]) => s0 < b && a < s0 + d) && s0 + d <= hrs[1];
      // bestehende Beispieltermine (aus seed.js) in der Vergangenheit ebenfalls kassieren
      const plan = existing.filter((x) => x.date === date && x.staffId === st && (past || (isToday && x.start + x.duration <= nowMinutes))).map((a) => ({ a, serviceId: a.serviceId, start: a.start, client: a.customerId === 'us_kunde' ? demoClient : byName[a.name.replace(/^Beispiel · /, '')] || weighted(men) }));
      const occ = future ? 0.42 : wd === 6 ? 0.86 : 0.7;
      for (let t = hrs[0] + (chance(0.5) ? 0 : 15); t < hrs[1];) {
        const serviceId = pickSvc(st), s = svc[serviceId];
        if (!s || !free(t, s.duration)) { t += 15; continue; }
        if (!chance(occ)) { t += 15 * (1 + Math.floor(R() * 3)); continue; }
        const female = ['sv_sf', 'sv_bal', 'sv_str'].includes(serviceId) || (st === 'st_angelo' && chance(0.3));
        // fällige Paketkarte bevorzugen
        let card = null;
        const due = cardsDue.find((c) => c.next <= date && c.left[serviceId] > 0 && c.staffId === st);
        if (due && past) card = due;
        plan.push({ serviceId, start: t, client: card ? card.client : weighted(female ? women : men), card });
        taken.push([t, t + s.duration]);
        t += s.duration + (chance(0.6) ? 0 : 15);
      }
      plan.sort((a, b) => a.start - b.start);
      for (const p of plan) {
        const s = svc[p.serviceId];
        const end = p.start + s.duration;
        const recent = date >= addDays(today, -60);
        let apptId = p.a ? p.a.id : null;
        let deposit = null;
        if (!p.a && (recent || !past)) {
          const isOnline = chance(0.45);
          const a = { id: `ap_p${++aid}`, date, start: p.start, duration: s.duration, serviceId: p.serviceId, staffId: st, clientId: p.client.id, customerId: p.client.userId, name: p.client.userId ? p.client.name : `Beispiel · ${p.client.name}`, phone: p.client.phone, note: '', status: 'booked', source: isOnline ? 'customer' : 'admin', resourceId: resFor(p.serviceId, st), createdAt: `${addDays(date, -7)}T09:00:00.000Z`, history: [], ...ex };
          appointments.push(a); apptId = a.id;
          if (['sv_bal', 'sv_str'].includes(p.serviceId) && chance(0.6) && date > addDays(start, 8)) deposit = a;
        }
        // Anzahlung eine Woche vorher (Karte), bei Balayage/Strähnen
        if (deposit && (past || isToday || future)) {
          const dd = addDays(date, -6);
          if (dd <= today) {
            const db = T(buildBon({ lines: [{ kind: 'deposit', refId: deposit.id, name: `Anzahlung ${s.name} am ${date.split('-').reverse().join('.')}`, qty: 1, unit: 5000, vat: null, staffId: st }], payments: [{ method: 'card', amount: 5000 }], clientId: p.client.id, clientName: p.client.name, cashier: 'st_burak', date: dd, time: H(13, 10) }));
            deposit.deposit = { amount: 5000, bonId: db.id, paidAt: dd };
          }
        }
        if (future || (isToday && end > nowMinutes - 25)) continue; // noch nicht kassiert
        // ---- Beleg bauen ----
        const lines = [];
        if (p.card) {
          lines.push({ kind: 'package_use', refId: p.card.id, cardId: p.card.id, serviceId: p.serviceId, name: `${s.name} · aus Paket`, qty: 1, unit: 0, vat: 19, staffId: st });
          p.card.left[p.serviceId] -= 1; p.card.next = addDays(date, 18 + Math.floor(R() * 14));
        } else {
          const price = priceOf(s);
          const disc = chance(0.06) ? Math.round(price * 0.1 / 50) * 50 : 0;
          lines.push({ kind: 'service', refId: s.id, serviceId: s.id, name: s.name, qty: 1, unit: price, discount: disc, vat: 19, staffId: st, ...(disc ? { discountNote: '10 % Stammkunde' } : {}) });
        }
        if (chance(0.22)) {
          const pr = pick(products.filter((x) => x.stock > 0));
          if (pr) lines.push({ kind: 'product', refId: pr.id, name: pr.name, qty: chance(0.12) ? 2 : 1, unit: pr.price, vat: pr.vat, staffId: st });
        }
        if (chance(0.03)) { const pr = P.pr_coffee; if (pr.stock > 0) lines.push({ kind: 'product', refId: pr.id, name: pr.name, qty: 1, unit: pr.price, vat: 7, staffId: st }); }
        let voucherSale = null;
        if (chance(date.slice(5, 7) === '12' ? 0.06 : 0.018)) {
          const value = pick([3000, 5000, 5000, 10000]);
          voucherSale = { code: `BRK-${String.fromCharCode(65 + Math.floor(R() * 26))}${Math.floor(1000 + R() * 8999)}-${Math.floor(10 + R() * 89)}`, value };
          lines.push({ kind: 'voucher', refId: voucherSale.code, code: voucherSale.code, name: `Gutschein ${voucherSale.code}`, qty: 1, unit: value, vat: null, staffId: st });
        }
        let pkgSale = null;
        if (!p.card && past && chance(0.005)) {
          const pk = st === 'st_burak' ? pick(packages.slice(0, 2)) : pick(packages);
          pkgSale = pk;
          lines.push({ kind: 'package', refId: pk.id, name: `Beauty-Paket ${pk.name}`, qty: 1, unit: pk.price, vat: 19, staffId: st });
        }
        if (p.a && p.a.fee) lines.push(p.a.fee);
        const dueAmt = lines.reduce((x, l) => x + lineGross(l), 0);
        const payments = [];
        let rest = dueAmt;
        if (deposit && deposit.deposit && rest > 0) { const d = Math.min(rest, deposit.deposit.amount); payments.push({ method: 'deposit', amount: d, ref: deposit.id }); rest -= d; }
        const v = !voucherSale && activeVouchers.find((x) => x.remaining > 0 && x.soldDate < addDays(date, -5) && chance(0.04));
        if (v && rest > 0) { const d = Math.min(rest, v.remaining); payments.push({ method: 'voucher', amount: d, ref: v.code }); v.remaining -= d; rest -= d; }
        let plan = null;
        if (['sv_bal', 'sv_str'].includes(p.serviceId) && rest > 15000 && installments.length < 5 && chance(0.18) && date < addDays(today, -40)) {
          const part = Math.round((rest * 2) / 3 / 100) * 100; payments.push({ method: 'installment', amount: part }); rest -= part; plan = part;
        }
        const m = R();
        if (rest > 0) {
          if (m < 0.6) payments.push({ method: 'card', amount: rest });
          else if (m < 0.96) payments.push({ method: 'cash', amount: rest });
          else { const c = Math.min(rest, 2000); payments.push({ method: 'cash', amount: c }); if (rest - c) payments.push({ method: 'card', amount: rest - c }); }
        }
        const tips = [];
        if (chance(0.52)) { const amt = pick([200, 300, 300, 500, 500, 500, 700, 1000]); tips.push({ staffId: st, amount: amt, method: payments.some((x) => x.method === 'card') && chance(0.7) ? 'card' : 'cash' }); dayTips += amt; }
        const time = end + Math.floor(R() * 6);
        const cash = payments.find((x) => x.method === 'cash');
        const bon = T(buildBon({ lines, payments, tips, cashGiven: cash ? Math.ceil((cash.amount + tips.filter((x) => x.method === 'cash').reduce((a2, x) => a2 + x.amount, 0)) / 1000) * 1000 : null, clientId: p.client.id, clientName: p.client.name, apptIds: apptId ? [apptId] : [], cashier: st, date, time: Math.min(time, hrs[1] + 15) }));
        bon.at = `${date}T${String(Math.floor(bon.time / 60) - 1).padStart(2, '0')}:${String(bon.time % 60).padStart(2, '0')}:00.000Z`;
        dayBons.push(bon);
        cashBal += payments.filter((x) => x.method === 'cash').reduce((a2, x) => a2 + x.amount, 0) + tips.filter((x) => x.method === 'cash').reduce((a2, x) => a2 + x.amount, 0);
        for (const l of lines) if (l.kind === 'product') { P[l.refId].stock -= l.qty; stockmoves.push(mv({ productId: l.refId, date, qty: -l.qty, kind: 'sale', bonId: bon.id, note: '', cost: P[l.refId].cost })); }
        if (voucherSale) { const vo = { id: `vo_s${vouchers.length + 1}`, code: voucherSale.code, value: voucherSale.value, issuedAt: date, soldDate: date, expires: `${Number(date.slice(0, 4)) + 3}-12-31`, buyer: p.client.name, clientId: p.client.id, soldBonId: bon.id, channel: 'kasse', note: '', ...ex }; vouchers.push(vo); activeVouchers.push({ ...vo, remaining: vo.value }); }
        if (pkgSale) { const c = { id: `pc_s${packageCards.length + 1}`, packageId: pkgSale.id, name: pkgSale.name, clientId: p.client.id, bonId: bon.id, date, expires: addDays(date, pkgSale.validMonths * 30), items: pkgSale.items.map((it) => ({ serviceId: it.serviceId, total: it.count })), ...ex }; packageCards.push(c); cardsDue.push({ id: c.id, client: p.client, staffId: st, next: addDays(date, 21), left: Object.fromEntries(pkgSale.items.map((it) => [it.serviceId, it.count])) }); }
        if (plan) {
          const n = 3, rate = Math.round(plan / n / 100) * 100;
          const schedule = Array.from({ length: n }, (_, i) => ({ due: addDays(date, 30 * (i + 1)), amount: i === n - 1 ? plan - rate * (n - 1) : rate }));
          installments.push({ id: `ip_s${installments.length + 1}`, clientId: p.client.id, clientName: p.client.name, bonId: bon.id, total: plan, createdAt: date, schedule, note: `Rest aus ${s.name}`, ...ex });
        }
      }
      // Anwesenheit der letzten drei Wochen
      if ((past || isToday) && date >= addDays(today, -21)) attendance.push({ id: `at_s${attendance.length + 1}`, staffId: st, date, in: hrs[0] - 10 + Math.floor(R() * 12), out: isToday ? null : hrs[1] + Math.floor(R() * 20), ...ex });
    }
    if (future) continue;
    // Raten einziehen, die heute fällig sind (eine bleibt offen = überfällig)
    for (const ip of installments) for (const [i, sc] of ip.schedule.entries()) {
      if (sc.due !== date || (ip === installments[1] && i === ip.schedule.length - 1) || (isToday)) continue;
      const cl = clients.find((c) => c.id === ip.clientId);
      const b = T(buildBon({ lines: [{ kind: 'installment', refId: ip.id, planId: ip.id, name: `Rate ${i + 1}/${ip.schedule.length} · ${ip.note}`, qty: 1, unit: sc.amount, vat: null, staffId: 'st_angelo' }], payments: [{ method: chance(0.5) ? 'cash' : 'card', amount: sc.amount }], clientId: cl.id, clientName: cl.name, cashier: 'st_burak', date, time: H(12, 20) }));
      if (b.payments[0].method === 'cash') cashBal += sc.amount;
    }
    // Ausfallgebühr (No-Show) ca. einmal im Monat
    if (past && !monthSeen.has(month) && Number(date.slice(8)) > 10) {
      monthSeen.add(month);
      const cl = weighted(men);
      T(buildBon({ lines: [{ kind: 'fee', refId: 'fee', name: 'Ausfallgebühr nicht wahrgenommener Termin', qty: 1, unit: 1500, vat: 19, staffId: 'st_burak' }], payments: [{ method: 'card', amount: 1500 }], clientId: cl.id, clientName: cl.name, cashier: 'st_burak', date, time: H(18, 40) }));
      // Privatentnahme einmal im Monat
      if (cashBal > 50000) { cashmoves.push(mv({ date, time: H(19, 50), kind: 'withdrawal', amount: -30000, text: 'Inhaber' })); cashBal -= 30000; }
    }
    if (isToday) continue;
    // Tagesabschluss: Trinkgeld auszahlen, Überschuss zur Bank, ab und zu kleine Zähldifferenz
    if (dayTips) { cashmoves.push(mv({ date, time: hrs[1] + 30, kind: 'tip_payout', amount: -dayTips, text: 'an Team' })); cashBal -= dayTips; }
    if (chance(0.05)) { const d = pick([-50, -100, 50, -20, 100, -200]); cashmoves.push(mv({ date, time: hrs[1] + 32, kind: 'diff', amount: d, text: 'Zählprotokoll' })); cashBal += d; }
    if (cashBal > 80000) { const b = Math.floor((cashBal - 20000) / 5000) * 5000; cashmoves.push(mv({ date, time: hrs[1] + 35, kind: 'bank', amount: -b, text: 'Sparkasse KölnBonn' })); cashBal -= b; }
    // Wareneingang alle vier Wochen (zwei Artikel bewusst knapp, damit Warnungen sichtbar sind)
    if (wd === 2 && Number(date.slice(8)) <= 7) for (const pr of products) {
      if (date > addDays(today, -35) && ['pr_balm', 'pr_mask', 'pr_heat'].includes(pr.id)) continue;
      const n = pr.target - pr.stock; if (n > 0) { pr.stock += n; stockmoves.push(mv({ productId: pr.id, date, qty: n, kind: 'in', note: 'Lieferung Großhandel', cost: pr.cost })); }
    }
    void dayBons;
  }

  /* ---------- Bonnummern chronologisch vergeben, zwei Stornos einstreuen ---------- */
  tx.sort((a, b) => (a.date === b.date ? a.time - b.time : a.date < b.date ? -1 : 1));
  let no = 0; tx.forEach((t) => { t.no = ++no; });
  const voidTargets = tx.filter((t) => t.date < addDays(today, -3) && t.lines.every((l) => l.kind === 'service' || l.kind === 'product') && !t.payments.some((p) => p.method !== 'card' && p.method !== 'cash')).filter((_, i) => i % 900 === 450).slice(0, 3);
  for (const o of voidTargets) {
    const r = reverseBon(o, { date: o.date, time: o.time + 3, cashier: 'st_burak', reason: 'Falsche Leistung gewählt' });
    const rt = { id: `tx_s${++tid}`, ...r, at: o.at, ...ex };
    tx.push(rt);
    for (const l of o.lines) if (l.kind === 'product') { P[l.refId].stock += l.qty; stockmoves.push(mv({ productId: l.refId, date: o.date, qty: l.qty, kind: 'void', bonId: rt.id, note: `Storno Bon ${o.no}`, cost: P[l.refId].cost })); }
    // korrekt neu kassiert
    const fixed = buildBon({ lines: o.lines, payments: o.payments, tips: o.tips, cashGiven: o.cashGiven, clientId: o.clientId, clientName: o.clientName, apptIds: o.apptIds, cashier: 'st_burak', date: o.date, time: o.time + 4 });
    tx.push({ id: `tx_s${++tid}`, ...fixed, at: o.at, note: `Ersatz für Bon ${o.no}`, ...ex });
    for (const l of o.lines) if (l.kind === 'product') { P[l.refId].stock -= l.qty; stockmoves.push(mv({ productId: l.refId, date: o.date, qty: -l.qty, kind: 'sale', bonId: `tx_s${tid}`, note: '', cost: P[l.refId].cost })); }
  }
  tx.sort((a, b) => (a.date === b.date ? a.time - b.time : a.date < b.date ? -1 : 1));
  tx.forEach((t) => { if (!t.no) t.no = ++no; });
  // Monate bis vorletzten Monat abgeschlossen; Vormonat offen für den Monatsabschluss in der Demo
  const closings = [];
  for (let d = start; d.slice(0, 7) < addMonth(today.slice(0, 7), -1); d = `${addMonth(d.slice(0, 7), 1)}-01`) closings.push({ id: `mc_${d.slice(0, 7)}`, month: d.slice(0, 7), lockedAt: `${addMonth(d.slice(0, 7), 1)}-05T18:00:00.000Z`, by: 'us_admin', ...ex });

  clients.forEach((c) => { delete c.g; });
  return {
    products, packages, packageCards, resources, clients, transactions: tx, cashmoves, stockmoves, vouchers, installments, attendance, closings,
    audit: [{ id: 'au_s1', at: new Date().toISOString(), by: 'system', action: 'seed', entity: 'demo', entityId: '', detail: 'Beispieldaten angelegt', ...ex }],
    stats: [
      { id: 'cs_s1', name: 'Umsatz je Mitarbeiter und Monat', metric: 'revenue', group: 'month', split: 'staff', period: 'year', view: 'chart', ...ex },
      { id: 'cs_s2', name: 'Top-Produkte im Quartal', metric: 'qty', group: 'product', period: 'quarter', view: 'table', ...ex },
    ],
    appointments, breaks, resFor: staffChair, counters: { bon: no },
  };
}
export function addMonth(ym, n) { let [y, m] = ym.split('-').map(Number); m += n; while (m > 12) { m -= 12; y++; } while (m < 1) { m += 12; y--; } return `${y}-${String(m).padStart(2, '0')}`; }
