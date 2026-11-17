/* Studio-Pult – Buchhaltung (alle Unterpunkte), Monatsabschluss, Zahlungen, Statistiken */
import { P, esc, eur, pct, int, hhmm, dateDE, monthDE, staffName, svcOf, productOf, clientOf, head, toolbar, bindToolbar, table, tiles, trend, trend as trendFn, bars, hbars, ensureRange, lastYear, today, addDays, addMonth, download, demoNote, isAdmin, euroIn, exampleTag } from './kit.js';
import { inRange, revenueFacts, sumBons, liveBons, vatReport, paymentReport, tipsReport, groupSum, cashBook, voucherState, packageState, installmentState, METHODS, KIND, ACCOUNT_LABEL, accountsFor, MOVES, lineGross, parseEuro, monthBounds } from '../ledger.js';
import { pult } from '../pult-api.js';
import { toast, openDialog, confirmDialog, $ } from '../ui.js';
import { mondayOf, weekday } from '../util.js';
import { dayHours } from '../core.js';
import { monthPackage, reportHTML } from './exports.js';
import { kasse } from './kasse.js';

const amt = (o) => (o ? (P.gross ? o.gross : o.net) : 0);
const A = (gross, net) => ({ gross, net });
const T_in = (r) => P.db.transactions.filter(inRange(r.from, r.to));
const days = (r) => { const out = []; for (let d = r.from; d <= r.to; d = addDays(d, 1)) out.push(d); return out; };
const spanDays = (r) => days(r).length;
const vatLabel = () => (P.gross ? 'brutto' : 'netto');

/* ---------- Kennzahlen (gemeinsam für Übersicht und Buchhaltung) ---------- */
export function kpis(r) {
  const T = T_in(r);
  const live = liveBons(T);
  const rev = sumBons(T);
  const f = revenueFacts(T);
  const svc = f.filter((x) => x.kind === 'service' || x.kind === 'package_use').reduce((s, x) => A(s.gross + x.gross, s.net + x.net), A(0, 0));
  const prod = f.filter((x) => x.kind === 'product').reduce((s, x) => A(s.gross + x.gross, s.net + x.net), A(0, 0));
  const tips = T.reduce((s, t) => s + t.tips.reduce((a, x) => a + x.amount, 0), 0);
  const vouchers = T.reduce((s, t) => s + t.lines.filter((l) => l.kind === 'voucher').reduce((a, l) => a + lineGross(l), 0), 0);
  const discounts = T.reduce((s, t) => s + t.lines.reduce((a, l) => a + (l.discount || 0), 0), 0);
  return { T, live, rev, svc, prod, tips, vouchers, discounts, bons: live.length, avg: live.length ? A(Math.round(rev.gross / live.length), Math.round(rev.net / live.length)) : A(0, 0), voids: T.filter((t) => t.voidOf).length, services: f.filter((x) => x.kind === 'service' || x.kind === 'package_use').reduce((s, x) => s + x.qty, 0) };
}

/** Auslastung: gebuchte Minuten / verfügbare Minuten (Öffnungszeiten minus Pausen und Abwesenheiten) */
export function occupancy(r, staffIds) {
  const st = P.db.staff.filter((s) => s.active !== false && (!staffIds || staffIds.includes(s.id)));
  let cap = 0, used = 0;
  for (const d of days(r)) for (const s of st) {
    const h = dayHours(P.db.settings, s, d); if (!h) continue;
    let c = h[1] - h[0];
    const br = s.breaks && (s.breaks[weekday(d)] || s.breaks.all); if (br) c -= br[1] - br[0];
    for (const b of P.db.blockers.filter((x) => x.date === d && x.kind === 'absence' && x.staffId === s.id)) c -= b.end - b.start;
    cap += Math.max(0, c);
    used += P.db.appointments.filter((a) => a.date === d && a.staffId === s.id && a.status === 'booked').reduce((x, a) => x + a.duration, 0);
  }
  return cap ? used / cap : 0;
}
export function heatmap(r) {
  const hours = []; for (let h = 12; h < 20; h++) hours.push(h);
  const wds = [1, 2, 3, 4, 5, 6];
  const cell = {};
  for (const d of days(r)) {
    const wd = weekday(d); if (!wds.includes(wd)) continue;
    for (const s of P.db.staff.filter((x) => x.active !== false)) {
      const h = dayHours(P.db.settings, s, d); if (!h) continue;
      for (const hr of hours) {
        const a0 = Math.max(hr * 60, h[0]), a1 = Math.min(hr * 60 + 60, h[1]); if (a1 <= a0) continue;
        const k = `${wd}-${hr}`; cell[k] = cell[k] || { cap: 0, used: 0 };
        cell[k].cap += a1 - a0;
        for (const a of P.db.appointments) if (a.date === d && a.staffId === s.id && a.status === 'booked') cell[k].used += Math.max(0, Math.min(a1, a.start + a.duration) - Math.max(a0, a.start));
      }
    }
  }
  const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  return `<div class="heat" role="table" aria-label="Auslastung nach Wochentag und Uhrzeit">
    <div class="heat__row heat__row--h" role="row"><span role="columnheader"></span>${hours.map((h) => `<span role="columnheader">${h}</span>`).join('')}</div>
    ${wds.map((wd) => `<div class="heat__row" role="row"><span role="rowheader">${WD[wd]}</span>${hours.map((h) => { const c = cell[`${wd}-${h}`]; const v = c && c.cap ? c.used / c.cap : null; return `<span role="cell" class="heat__c" data-l="${v == null ? 0 : Math.min(5, Math.ceil(v * 5))}" title="${WD[wd]} ${h}–${h + 1} Uhr: ${v == null ? 'geschlossen' : pct(v, 0)}">${v == null ? '' : Math.round(v * 100)}</span>`; }).join('')}</div>`).join('')}
    <p class="heat__legend"><span>leer</span><i data-l="1"></i><i data-l="2"></i><i data-l="3"></i><i data-l="4"></i><i data-l="5"></i><span>voll</span></p>
  </div>`;
}
function revenueSeries(r) {
  const long = spanDays(r) > 62;
  const map = new Map();
  const ly = new Map();
  const key = (d) => (long ? d.slice(0, 7) : d);
  for (const t of T_in(r)) map.set(key(t.date), (map.get(key(t.date)) || 0) + amt({ gross: t.totals.revenue, net: t.totals.net }));
  const L = lastYear(r);
  for (const t of T_in(L)) { const k = key(`${Number(t.date.slice(0, 4)) + 1}${t.date.slice(4)}`); ly.set(k, (ly.get(k) || 0) + amt({ gross: t.totals.revenue, net: t.totals.net })); }
  const keys = long ? (() => { const o = []; for (let m = r.from.slice(0, 7); m <= r.to.slice(0, 7); m = addMonth(m, 1)) o.push(m); return o; })() : days(r);
  return { series: keys.map((k) => ({ label: long ? monthDE(k) : dateDE(k), short: long ? monthDE(k).slice(0, 3) : String(Number(k.slice(8))), value: map.get(k) || 0, hi: k === today() || k === today().slice(0, 7) })), compare: keys.map((k) => ({ value: ly.get(k) || 0 })), long };
}

/* ---------- Übersicht (Dashboard) ---------- */
export function renderUebersicht(root) {
  const t = today();
  const K = (r) => kpis(r);
  const rng = { today: { from: t, to: t }, yesterday: { from: addDays(t, -1), to: addDays(t, -1) }, month: { from: `${t.slice(0, 7)}-01`, to: t }, year: { from: `${t.slice(0, 4)}-01-01`, to: t } };
  const cur = Object.fromEntries(Object.entries(rng).map(([k, r]) => [k, K(r)]));
  const prev = Object.fromEntries(Object.entries(rng).map(([k, r]) => [k, K(lastYear(r))]));
  const apptsToday = P.db.appointments.filter((a) => a.date === t && a.status === 'booked');
  const plans = installmentState(P.db.installments, P.db.transactions, t).filter((p) => p.open > 0);
  const overdue = plans.filter((p) => p.schedule.some((s) => s.overdue));
  const low = P.db.products.filter((p) => p.active !== false && p.stock <= p.minStock);
  const m = { from: `${t.slice(0, 7)}-01`, to: t };
  const f = revenueFacts(T_in(m));
  const topS = [...groupSum(f.filter((x) => x.kind === 'service'), (x) => x.name).entries()].map(([label, s]) => ({ label, value: amt(s) })).sort((a, b) => b.value - a.value).slice(0, 5);
  const topP = [...groupSum(f.filter((x) => x.kind === 'product'), (x) => x.name).entries()].map(([label, s]) => ({ label, value: s.qty })).sort((a, b) => b.value - a.value).slice(0, 5);
  const yr = { from: `${addMonth(t.slice(0, 7), -11)}-01`, to: t };
  const rs = revenueSeries(yr);
  // Vergleich nur, wenn der Vorjahreszeitraum vollständig in den Daten liegt
  const first = P.db.transactions.reduce((m, x) => (x.date < m ? x.date : m), t);
  const k = (key, label) => ({ label, value: esc(eur(amt(cur[key].rev))), ...(lastYear(rng[key]).from < first ? { sub: 'Vorjahr unvollständig', trend: 0 } : trend(amt(cur[key].rev), amt(prev[key].rev))) });
  root.innerHTML = `${head('Übersicht', `${toolbar({ range: false, csv: '', print: true })}`, `${esc(new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${t}T12:00:00Z`)))} · Umsätze ${vatLabel()}`)}
    ${tiles([k('today', 'Umsatz heute'), k('yesterday', 'Umsatz gestern'), k('month', 'Umsatz Monat'), k('year', 'Umsatz Jahr')], 'kpis--hero')}
    ${tiles([
      { label: 'Termine heute', value: int(apptsToday.length), sub: `${apptsToday.filter((a) => a.source === 'customer').length} online gebucht` },
      { label: 'Auslastung heute', value: esc(pct(occupancy(rng.today), 0)), sub: `Woche ${esc(pct(occupancy({ from: mondayOf(t), to: addDays(mondayOf(t), 6) }), 0))}` },
      { label: 'Ø Bon Monat', value: esc(eur(amt(cur.month.avg))), sub: `${int(cur.month.bons)} Bons` },
      { label: 'Trinkgeld Monat', value: esc(eur(cur.month.tips)), sub: 'nicht steuerpflichtig' },
      { label: 'Offene Raten', value: esc(eur(plans.reduce((s, p) => s + p.open, 0))), sub: overdue.length ? `${overdue.length} überfällig` : 'nichts überfällig', trend: overdue.length ? -1 : 0 },
      { label: 'Lager', value: low.length ? `${low.length} knapp` : 'ok', sub: low.length ? esc(low.map((p) => p.name).slice(0, 2).join(', ')) : 'alle über Mindestbestand', trend: low.length ? -1 : 0 },
    ])}
    <div class="dash">
      <section class="card card--wide" aria-labelledby="d-rev"><header class="card__h"><h2 id="d-rev">Umsatz der letzten 12 Monate</h2><span class="card__meta">${vatLabel()} · Linie = Vorjahr</span></header>${bars(rs.series, { compare: rs.compare, label: 'Umsatz je Monat' })}</section>
      <section class="card" aria-labelledby="d-top"><header class="card__h"><h2 id="d-top">Top-Leistungen im Monat</h2></header>${topS.length ? hbars(topS) : '<p class="empty">Noch keine Umsätze.</p>'}</section>
      <section class="card" aria-labelledby="d-topp"><header class="card__h"><h2 id="d-topp">Top-Produkte im Monat</h2><span class="card__meta">Stück</span></header>${topP.length ? hbars(topP, { fmt: (v) => `${int(v)} Stk.` }) : '<p class="empty">Noch keine Produktverkäufe.</p>'}</section>
      <section class="card card--wide" aria-labelledby="d-heat"><header class="card__h"><h2 id="d-heat">Auslastung nach Tag und Uhrzeit</h2><span class="card__meta">letzte 8 Wochen, in %</span></header>${heatmap({ from: addDays(t, -56), to: addDays(t, -1) })}</section>
      <section class="card" aria-labelledby="d-next"><header class="card__h"><h2 id="d-next">Heute im Studio</h2><a class="card__link" href="#kalender">Kalender</a></header>
        ${apptsToday.length ? `<ul class="mini-list">${apptsToday.sort((a, b) => a.start - b.start).map((a) => `<li><span class="num">${hhmm(a.start)}</span><span>${esc(a.name.replace(/^Beispiel · /, ''))}<small>${esc((svcOf(a.serviceId) || {}).name || '')} · ${esc(staffName(a.staffId))}</small></span>${a.paidBonId ? '<span class="status status--approved">bezahlt</span>' : `<button type="button" class="link-quiet" data-cash-appt="${a.id}">Kassieren</button>`}</li>`).join('')}</ul>` : '<p class="empty">Heute keine Termine.</p>'}
      </section>
    </div>`;
  bindToolbar(root, () => renderUebersicht(root));
  root.onclick = (e) => { const b = e.target.closest('[data-cash-appt]'); if (b) { kasse.fromAppointment(b.dataset.cashAppt); P.nav('kasse'); } };
}

/* ---------- Buchhaltung ---------- */
const SUBS = [['kennzahlen', 'Kennzahlen'], ['weitere', 'Weitere Kennzahlen'], ['umsatz', 'Umsatz'], ['mitarbeiter', 'Mitarbeiter'], ['dienstleistungen', 'Dienstleistungen'], ['produkte', 'Produkte'], ['mwst', 'MwSt.'], ['zahlungsarten', 'Zahlungsmethoden'], ['bargeld', 'Bargeldverwaltung'], ['gutscheine', 'Gutscheine'], ['pakete', 'Beauty-Pakete'], ['trinkgeld', 'Trinkgeld'], ['abschluss', 'Monatsabschluss']];
let SUB = 'kennzahlen', UMS_GROUP = 'day', ABS_MONTH = null, ABS_SKR = null;
export function renderBuchhaltung(root, sub) {
  if (sub && SUBS.some(([k]) => k === sub)) SUB = sub;
  const r = ensureRange();
  const body = { kennzahlen: bhKennzahlen, weitere: bhWeitere, umsatz: bhUmsatz, mitarbeiter: bhMitarbeiter, dienstleistungen: bhDL, produkte: bhProdukte, mwst: bhMwst, zahlungsarten: bhZahlung, bargeld: bhBargeld, gutscheine: bhGutscheine, pakete: bhPakete, trinkgeld: bhTrinkgeld, abschluss: bhAbschluss }[SUB](r);
  const title = SUBS.find(([k]) => k === SUB)[1];
  root.innerHTML = `${head('Buchhaltung', '', `${esc(title)}${SUB !== 'abschluss' ? ` · ${esc(dateDE(r.from))} – ${esc(dateDE(r.to))}` : ''}`)}
    <nav class="subnav" aria-label="Buchhaltung">${SUBS.map(([k, l]) => `<a href="#buchhaltung/${k}" ${k === SUB ? 'aria-current="page"' : ''}>${l}</a>`).join('')}</nav>
    ${SUB === 'abschluss' ? '' : toolbar({ csv: body.csv || '', vat: body.vat !== false })}
    <div class="bh">${body.html}</div>`;
  bindToolbar(root, () => renderBuchhaltung(root));
  if (body.bind) body.bind(root, () => renderBuchhaltung(root));
}

function bhKennzahlen(r) {
  const k = kpis(r), p = kpis(lastYear(r));
  const rs = revenueSeries(r);
  const first = P.db.transactions.reduce((m, x) => (x.date < m ? x.date : m), today());
  const trend = lastYear(r).from < first ? () => ({ sub: 'Vorjahr unvollständig', trend: 0 }) : trendFn;
  return { csv: 'bh-kpi', html: `${tiles([
    { label: `Umsatz ${vatLabel()}`, value: esc(eur(amt(k.rev))), ...trend(amt(k.rev), amt(p.rev)), accent: true },
    { label: 'Dienstleistungen', value: esc(eur(amt(k.svc))), ...trend(amt(k.svc), amt(p.svc)) },
    { label: 'Produkte', value: esc(eur(amt(k.prod))), ...trend(amt(k.prod), amt(p.prod)) },
    { label: 'Bons', value: int(k.bons), ...trend(k.bons, p.bons) },
    { label: 'Ø Bon', value: esc(eur(amt(k.avg))), ...trend(amt(k.avg), amt(p.avg)) },
    { label: 'Trinkgeld', value: esc(eur(k.tips)), sub: 'nicht steuerpflichtig' },
    { label: 'Gutscheine verkauft', value: esc(eur(k.vouchers)), sub: 'ohne USt., kein Umsatz' },
    { label: 'Umsatzsteuer', value: esc(eur(k.rev.tax)), sub: `${k.voids} Storno${k.voids === 1 ? '' : 's'}` },
  ])}
  <section class="card card--flat"><header class="card__h"><h2>Umsatz im Zeitraum</h2><span class="card__meta">${vatLabel()} · Linie = Vorjahr</span></header>${bars(rs.series, { compare: rs.compare, label: rs.long ? 'Umsatz je Monat' : 'Umsatz je Tag' })}</section>
  ${table({ id: 'bh-kpi', title: 'Kennzahlen', cols: [{ label: 'Kennzahl', get: (x) => x.l }, { label: 'Zeitraum', type: 'money', get: (x) => x.a }, { label: 'Vorjahr', type: 'money', get: (x) => x.b }, { label: 'Veränderung', type: 'pct', get: (x) => (x.b ? (x.a - x.b) / Math.abs(x.b) : null) }], rows: [
    { l: `Umsatz ${vatLabel()}`, a: amt(k.rev), b: amt(p.rev) }, { l: 'Dienstleistungen', a: amt(k.svc), b: amt(p.svc) }, { l: 'Produkte', a: amt(k.prod), b: amt(p.prod) }, { l: 'Ø Bon', a: amt(k.avg), b: amt(p.avg) }, { l: 'Trinkgeld', a: k.tips, b: p.tips }, { l: 'Rabatte', a: k.discounts, b: p.discounts }, { l: 'Umsatzsteuer', a: k.rev.tax, b: p.rev.tax },
  ] })}` };
}
function bhWeitere(r) {
  const k = kpis(r);
  const T = k.live;
  const clients = new Set(T.map((t) => t.clientId).filter(Boolean));
  const firstSeen = new Map();
  for (const t of [...P.db.transactions].sort((a, b) => (a.date < b.date ? -1 : 1))) if (t.clientId && !firstSeen.has(t.clientId)) firstSeen.set(t.clientId, t.date);
  const newC = [...clients].filter((c) => firstSeen.get(c) >= r.from).length;
  const withProd = T.filter((t) => t.lines.some((l) => l.kind === 'product')).length;
  const ap = P.db.appointments.filter(inRange(r.from, r.to));
  const hours = P.db.attendance.filter(inRange(r.from, r.to)).reduce((s, a) => s + Math.max(0, (a.out ?? a.in) - a.in), 0) / 60;
  const rows = [
    ['Kunden mit Besuch', int(clients.size), 'eindeutige Kunden mit Bon'],
    ['Neukunden', int(newC), 'erster Bon im Zeitraum'],
    ['Wiederkehrende Kunden', pct(clients.size ? (clients.size - newC) / clients.size : 0), 'Anteil der Kunden mit früherem Besuch'],
    ['Ø Besuche je Kunde', (clients.size ? T.filter((t) => t.clientId).length / clients.size : 0).toLocaleString('de-DE', { maximumFractionDigits: 2 }), ''],
    ['Produkt-Quote', pct(T.length ? withProd / T.length : 0), 'Bons mit mindestens einem Produkt'],
    ['Leistungen je Bon', (T.length ? k.services / T.length : 0).toLocaleString('de-DE', { maximumFractionDigits: 2 }), ''],
    ['Umsatz je Anwesenheitsstunde', hours ? eur(Math.round(amt(k.rev) / hours)) : '–', hours ? `${Math.round(hours).toLocaleString('de-DE')} Std. gestempelt` : 'keine Stempelzeiten im Zeitraum'],
    ['Auslastung', pct(occupancy(r)), 'gebuchte Zeit / verfügbare Zeit'],
    ['Online gebucht', pct(ap.length ? ap.filter((a) => a.source === 'customer').length / ap.length : 0), `${int(ap.length)} Termine im Zeitraum`],
    ['Nicht erschienen', pct(ap.length ? ap.filter((a) => a.status === 'noshow').length / ap.length : 0), ''],
    ['Storniert (Termine)', pct(ap.length ? ap.filter((a) => a.status === 'cancelled').length / ap.length : 0), ''],
    ['Rabatte gesamt', eur(k.discounts), ''],
    ['Ø Trinkgeld je Bon', eur(T.length ? Math.round(k.tips / T.length) : 0), ''],
  ];
  return { csv: 'bh-weitere', vat: true, html: table({ id: 'bh-weitere', title: 'Weitere Kennzahlen', cols: [{ label: 'Kennzahl', get: (x) => x[0] }, { label: 'Wert', num: true, get: (x) => x[1] }, { label: 'Erläuterung', get: (x) => x[2] }], rows }) };
}
function bhUmsatz(r) {
  const f = revenueFacts(T_in(r));
  const kf = (d) => (UMS_GROUP === 'day' ? d : UMS_GROUP === 'week' ? mondayOf(d) : d.slice(0, 7));
  const m = new Map();
  const add = (k, field, g, n) => { if (!m.has(k)) m.set(k, { k, svc: A(0, 0), prod: A(0, 0), pkg: A(0, 0), fee: A(0, 0), tot: A(0, 0), bons: new Set() }); const o = m.get(k); o[field] = A(o[field].gross + g, o[field].net + n); o.tot = A(o.tot.gross + g, o.tot.net + n); };
  for (const x of f) add(kf(x.date), x.kind === 'service' || x.kind === 'package_use' ? 'svc' : x.kind === 'product' ? 'prod' : x.kind === 'package' ? 'pkg' : 'fee', x.gross, x.net);
  for (const t of liveBons(T_in(r))) { const k = kf(t.date); if (m.has(k)) m.get(k).bons.add(t.id); }
  const rows = [...m.values()].sort((a, b) => (a.k < b.k ? -1 : 1)).map((o) => ({ ...o, n: o.bons.size, avg: o.bons.size ? A(Math.round(o.tot.gross / o.bons.size), Math.round(o.tot.net / o.bons.size)) : A(0, 0) }));
  const sum = (fd) => rows.reduce((s, x) => A(s.gross + x[fd].gross, s.net + x[fd].net), A(0, 0));
  const lbl = (k) => (UMS_GROUP === 'day' ? `${dateDE(k)}` : UMS_GROUP === 'week' ? `KW ab ${dateDE(k)}` : monthDE(k));
  const n = rows.reduce((s, x) => s + x.n, 0);
  return { csv: 'bh-umsatz', html: `<div class="seg seg--sm seg--inline" role="group" aria-label="Gruppierung">${[['day', 'Tag'], ['week', 'Woche'], ['month', 'Monat']].map(([k, l]) => `<button type="button" data-ug="${k}" aria-pressed="${UMS_GROUP === k}">${l}</button>`).join('')}</div>
    ${table({ id: 'bh-umsatz', title: 'Umsatz', cols: [{ label: 'Zeitraum', get: (x) => lbl(x.k), csv: (x) => lbl(x.k) }, { label: 'Dienstleistungen', type: 'amount', get: (x) => x.svc }, { label: 'Produkte', type: 'amount', get: (x) => x.prod }, { label: 'Pakete', type: 'amount', get: (x) => x.pkg }, { label: 'Gebühren', type: 'amount', get: (x) => x.fee }, { label: 'Gesamt', type: 'amount', get: (x) => x.tot }, { label: 'Bons', type: 'int', get: (x) => x.n }, { label: 'Ø Bon', type: 'amount', get: (x) => x.avg }], rows, foot: { label: 'Summe', svc: sum('svc'), prod: sum('prod'), pkg: sum('pkg'), fee: sum('fee'), tot: sum('tot'), n, avg: n ? A(Math.round(sum('tot').gross / n), Math.round(sum('tot').net / n)) : A(0, 0), k: '' } })}`,
  bind: (root, re) => root.querySelectorAll('[data-ug]').forEach((b) => b.addEventListener('click', () => { UMS_GROUP = b.dataset.ug; re(); })) };
}
function staffRows(r) {
  const T = T_in(r); const f = revenueFacts(T);
  const tips = tipsReport(T);
  const live = liveBons(T);
  return P.db.staff.map((s) => {
    const mine = f.filter((x) => x.staffId === s.id);
    const sv = mine.filter((x) => x.kind === 'service' || x.kind === 'package_use' || x.kind === 'fee' || x.kind === 'package').reduce((a, x) => A(a.gross + x.gross, a.net + x.net), A(0, 0));
    const pr = mine.filter((x) => x.kind === 'product').reduce((a, x) => A(a.gross + x.gross, a.net + x.net), A(0, 0));
    const bons = live.filter((t) => t.lines.some((l) => l.staffId === s.id)).length;
    const tp = tips.find((x) => x.staffId === s.id) || { cash: 0, card: 0, total: 0 };
    const hrs = P.db.attendance.filter((a) => a.staffId === s.id && a.date >= r.from && a.date <= r.to).reduce((x, a) => x + Math.max(0, (a.out ?? a.in) - a.in), 0) / 60;
    const tot = A(sv.gross + pr.gross, sv.net + pr.net);
    return { s, name: s.name, sv, pr, tot, n: mine.filter((x) => x.kind === 'service' || x.kind === 'package_use').reduce((a, x) => a + x.qty, 0), bons, avg: bons ? A(Math.round(tot.gross / bons), Math.round(tot.net / bons)) : A(0, 0), tips: tp.total, tipsCash: tp.cash, tipsCard: tp.card, hrs, perH: hrs ? A(Math.round(tot.gross / hrs), Math.round(tot.net / hrs)) : null, occ: occupancy(r, [s.id]) };
  });
}
export function staffTable(r, id = 'bh-staff') {
  const rows = staffRows(r);
  return table({ id, title: 'Mitarbeiter', cols: [{ label: 'Mitarbeiter', get: (x) => x.name }, { label: 'Dienstleistungen', type: 'amount', get: (x) => x.sv }, { label: 'Produkte', type: 'amount', get: (x) => x.pr }, { label: 'Gesamt', type: 'amount', get: (x) => x.tot }, { label: 'Leistungen', type: 'int', get: (x) => x.n }, { label: 'Bons', type: 'int', get: (x) => x.bons }, { label: 'Ø Bon', type: 'amount', get: (x) => x.avg }, { label: 'Auslastung', type: 'pct', get: (x) => x.occ }, { label: 'Std. anwesend', num: true, get: (x) => (x.hrs ? x.hrs.toLocaleString('de-DE', { maximumFractionDigits: 1 }) : '–') }, { label: 'Umsatz/Std.', type: 'amount', get: (x) => x.perH }, { label: 'Trinkgeld', type: 'money', get: (x) => x.tips }], rows,
    foot: { label: 'Summe', sv: rows.reduce((s, x) => A(s.gross + x.sv.gross, s.net + x.sv.net), A(0, 0)), pr: rows.reduce((s, x) => A(s.gross + x.pr.gross, s.net + x.pr.net), A(0, 0)), tot: rows.reduce((s, x) => A(s.gross + x.tot.gross, s.net + x.tot.net), A(0, 0)), n: rows.reduce((s, x) => s + x.n, 0), bons: null, avg: null, occ: null, hrs: null, perH: null, tips: rows.reduce((s, x) => s + x.tips, 0) } });
}
function bhMitarbeiter(r) { return { csv: 'bh-staff', html: staffTable(r) }; }
function bhDL(r) {
  const f = revenueFacts(T_in(r)).filter((x) => x.kind === 'service' || x.kind === 'package_use');
  const g = [...groupSum(f, (x) => x.serviceId || x.name).entries()].map(([k, s]) => ({ name: (svcOf(k) || { name: k }).name, ...s, amt: A(s.gross, s.net) }));
  const tot = g.reduce((s, x) => s + amt(x.amt), 0);
  const rows = g.map((x) => ({ ...x, share: tot ? amt(x.amt) / tot : 0, avg: x.qty ? A(Math.round(x.gross / x.qty), Math.round(x.net / x.qty)) : A(0, 0) })).sort((a, b) => amt(b.amt) - amt(a.amt));
  return { csv: 'bh-dl', html: `${hbars(rows.slice(0, 8).map((x) => ({ label: x.name, value: amt(x.amt) })))}${table({ id: 'bh-dl', title: 'Dienstleistungen', cols: [{ label: 'Leistung', get: (x) => x.name }, { label: 'Anzahl', type: 'int', get: (x) => x.qty }, { label: 'Umsatz', type: 'amount', get: (x) => x.amt }, { label: 'Ø Preis', type: 'amount', get: (x) => x.avg }, { label: 'Anteil', type: 'pct', get: (x) => x.share }], rows, foot: { label: 'Summe', qty: rows.reduce((s, x) => s + x.qty, 0), amt: rows.reduce((s, x) => A(s.gross + x.amt.gross, s.net + x.amt.net), A(0, 0)), avg: null, share: 1 } })}` };
}
function bhProdukte(r) {
  const f = revenueFacts(T_in(r)).filter((x) => x.kind === 'product');
  const rows = [...groupSum(f, (x) => x.refId).entries()].map(([id, s]) => { const p = productOf(id) || { name: id, cost: 0 }; const cost = s.qty * p.cost; return { name: p.name, cat: p.cat, qty: s.qty, amt: A(s.gross, s.net), cost, margin: s.net - cost, mpct: s.net ? (s.net - cost) / s.net : 0 }; }).sort((a, b) => b.qty - a.qty);
  const sum = (k) => rows.reduce((s, x) => s + x[k], 0);
  return { csv: 'bh-prod', html: table({ id: 'bh-prod', title: 'Produkte', cols: [{ label: 'Produkt', get: (x) => x.name }, { label: 'Kategorie', get: (x) => x.cat }, { label: 'Menge', type: 'int', get: (x) => x.qty }, { label: 'Umsatz', type: 'amount', get: (x) => x.amt }, { label: 'Wareneinsatz (EK netto)', type: 'money', get: (x) => x.cost }, { label: 'Rohertrag netto', type: 'money', get: (x) => x.margin }, { label: 'Marge', type: 'pct', get: (x) => x.mpct }], rows, foot: { label: 'Summe', cat: '', qty: sum('qty'), amt: rows.reduce((s, x) => A(s.gross + x.amt.gross, s.net + x.amt.net), A(0, 0)), cost: sum('cost'), margin: sum('margin'), mpct: null } }) };
}
function bhMwst(r) {
  const T = T_in(r);
  const v = vatReport(T);
  const non = [['Gutscheine verkauft (Mehrzweck)', 'voucher'], ['Anzahlungen', 'deposit'], ['Raten eingegangen', 'installment']].map(([l, k]) => ({ l, v: T.reduce((s, t) => s + t.lines.filter((x) => x.kind === k).reduce((a, x) => a + lineGross(x), 0), 0) }));
  non.push({ l: 'Trinkgeld', v: T.reduce((s, t) => s + t.tips.reduce((a, x) => a + x.amount, 0), 0) });
  return { csv: 'bh-mwst', vat: false, html: `${table({ id: 'bh-mwst', title: 'Umsatzsteuer', cols: [{ label: 'Steuersatz', get: (x) => `${x.rate} %` }, { label: 'Netto', type: 'money', get: (x) => x.net }, { label: 'Steuer', type: 'money', get: (x) => x.tax }, { label: 'Brutto', type: 'money', get: (x) => x.gross }], rows: v, foot: { label: 'Summe', rate: '', net: v.reduce((s, x) => s + x.net, 0), tax: v.reduce((s, x) => s + x.tax, 0), gross: v.reduce((s, x) => s + x.gross, 0) } })}
    <h2 class="h-sub">Nicht umsatzsteuerbar im Zeitraum</h2>${table({ id: 'bh-mwst-non', title: 'Nicht steuerbar', cols: [{ label: 'Vorgang', get: (x) => x.l }, { label: 'Betrag', type: 'money', get: (x) => x.v }], rows: non })}
    <p class="fine">Gutscheine werden als Mehrzweck-Gutscheine behandelt: Umsatzsteuer entsteht erst bei der Einlösung. Bitte mit dem Steuerberater abstimmen.</p>` };
}
function bhZahlung(r) {
  const rows = paymentReport(T_in(r)).sort((a, b) => b.amount - a.amount);
  return { csv: 'bh-pay', vat: false, html: `${hbars(rows.map((x) => ({ label: METHODS[x.method], value: x.amount })))}${table({ id: 'bh-pay', title: 'Zahlungsmethoden', cols: [{ label: 'Zahlungsart', get: (x) => METHODS[x.method] }, { label: 'Anzahl', type: 'int', get: (x) => x.n }, { label: 'Betrag', type: 'money', get: (x) => x.amount }, { label: 'Trinkgeld zusätzlich', type: 'money', get: (x) => x.tips }, { label: 'Anteil', type: 'pct', get: (x) => x.amount / Math.max(1, rows.reduce((s, y) => s + y.amount, 0)) }], rows, foot: { label: 'Summe', n: rows.reduce((s, x) => s + x.n, 0), amount: rows.reduce((s, x) => s + x.amount, 0), tips: rows.reduce((s, x) => s + x.tips, 0), method: '', share: null } })}` };
}
function bhBargeld(r) {
  const b = cashBook(P.db.transactions, P.db.cashmoves, r.from, r.to);
  const now = cashBook(P.db.transactions, P.db.cashmoves).closing;
  const rows = [...b.rows].reverse();
  return { csv: 'bh-cash', vat: false, html: `${tiles([{ label: 'Kassenbestand jetzt', value: esc(eur(now)), accent: true }, { label: 'Anfangsbestand', value: esc(eur(b.opening)) }, { label: 'Einnahmen bar', value: esc(eur(b.cashIn)) }, { label: 'Ausgaben bar', value: esc(eur(-b.cashOut)) }, { label: 'Endbestand Zeitraum', value: esc(eur(b.closing)) }])}
    <div class="row-actions row-actions--start">
      <button type="button" class="btn btn-dark btn-sm" data-cash="count">Kassensturz</button>
      <button type="button" class="btn btn-outline btn-sm" data-cash="bank">Einzahlung Bank</button>
      <button type="button" class="btn btn-outline btn-sm" data-cash="tip_payout">Trinkgeld auszahlen</button>
      <button type="button" class="btn btn-outline btn-sm" data-cash="deposit_in">Einlage</button>
      <button type="button" class="btn btn-outline btn-sm" data-cash="withdrawal">Entnahme</button>
    </div>
    ${table({ id: 'bh-cash', title: 'Kassenbuch', cols: [{ label: 'Datum', type: 'date', get: (x) => x.date }, { label: 'Zeit', type: 'time', get: (x) => Math.min(x.time, 1439) }, { label: 'Vorgang', get: (x) => x.text }, { label: 'Einnahme', type: 'money', get: (x) => (x.amount > 0 ? x.amount : null), html: (x) => (x.amount > 0 ? esc(eur(x.amount)) : '') }, { label: 'Ausgabe', type: 'money', get: (x) => (x.amount < 0 ? -x.amount : null), html: (x) => (x.amount < 0 ? esc(eur(-x.amount)) : '') }, { label: 'Bestand', type: 'money', get: (x) => x.balance }], rows })}`,
  bind: (root, re) => root.querySelectorAll('[data-cash]').forEach((btn) => btn.addEventListener('click', () => cashDialog(btn.dataset.cash, now, re))) };
}
function cashDialog(kind, balance, re) {
  const count = kind === 'count';
  const L = { count: 'Kassensturz', bank: 'Einzahlung auf das Bankkonto', tip_payout: 'Trinkgeld an das Team auszahlen', deposit_in: 'Privateinlage in die Kasse', withdrawal: 'Privatentnahme aus der Kasse' };
  const T = P.db.transactions.filter((t) => t.date === today());
  const tipsToday = T.reduce((s, t) => s + t.tips.reduce((a, x) => a + x.amount, 0), 0) - P.db.cashmoves.filter((m) => m.date === today() && m.kind === 'tip_payout').reduce((s, m) => s - m.amount, 0);
  const d = openDialog({
    title: L[kind],
    body: `<p class="dlg__text">Soll-Bestand laut Kassenbuch: <b>${esc(eur(balance))}</b>${kind === 'tip_payout' ? ` · heute offen: <b>${esc(eur(Math.max(0, tipsToday)))}</b>` : ''}</p>
      ${count ? `<div class="count-grid">${[50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50, 20, 10, 5, 2, 1].map((c) => `<label><span>${c >= 100 ? `${c / 100} €` : `${c} ct`}</span><input class="input input--sm num" type="number" min="0" step="1" inputmode="numeric" data-denom="${c}" placeholder="0"></label>`).join('')}</div><p class="count-sum">Gezählt: <b data-counted>0,00 €</b> · Differenz: <b data-diff>${esc(eur(-balance))}</b></p>` : `<div class="field"><label class="label" for="cm-amt">Betrag in €</label><input class="input num" id="cm-amt" name="amount" inputmode="decimal" value="${kind === 'tip_payout' && tipsToday > 0 ? euroIn(tipsToday) : ''}"></div>`}
      <div class="field"><label class="label" for="cm-text">Vermerk <span class="label__hint">optional</span></label><input class="input" id="cm-text" name="text" maxlength="80" value="${count ? 'Zählprotokoll' : ''}"></div>`,
    actions: [{ label: 'Abbrechen', value: 'cancel' }, { label: count ? 'Zählung buchen' : 'Buchen', value: 'ok', kind: 'btn-dark' }],
  });
  const sumC = () => [...d.querySelectorAll('[data-denom]')].reduce((s, i) => s + Number(i.dataset.denom) * (Number(i.value) || 0), 0);
  d.addEventListener('input', () => { if (!count) return; const c = sumC(); d.querySelector('[data-counted]').textContent = eur(c); d.querySelector('[data-diff]').textContent = eur(c - balance); });
  d.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]'); if (!b || b.dataset.act !== 'ok') return;
    e.preventDefault();
    const f = d.querySelector('form').elements;
    try {
      if (count) { const r = await pult.countCash(sumC(), f.text.value); d.close(); toast(r.diff ? `Differenz ${eur(r.diff)} als Kassendifferenz gebucht.` : 'Kasse stimmt auf den Cent.'); }
      else { await pult.cashMove({ kind, amount: f.amount.value, text: f.text.value }); d.close(); toast('Im Kassenbuch gebucht.'); }
      await P.refresh(); re();
    } catch (x) { d.error(x.message); }
  });
}
function bhGutscheine(r) {
  const vs = voucherState(P.db.vouchers, P.db.transactions, today());
  const T = T_in(r);
  const sold = T.reduce((s, t) => s + t.lines.filter((l) => l.kind === 'voucher').reduce((a, l) => a + lineGross(l), 0), 0);
  const used = T.reduce((s, t) => s + t.payments.filter((p) => p.method === 'voucher').reduce((a, p) => a + p.amount, 0), 0);
  const open = vs.filter((v) => v.remaining > 0 && v.status !== 'abgelaufen').reduce((s, v) => s + v.remaining, 0);
  const rows = vs.filter((v) => (v.issuedAt >= r.from && v.issuedAt <= r.to) || T.some((t) => t.payments.some((p) => p.method === 'voucher' && p.ref === v.code))).sort((a, b) => (a.issuedAt < b.issuedAt ? 1 : -1));
  return { csv: 'bh-vouch', vat: false, html: `${tiles([{ label: 'Verkauft im Zeitraum', value: esc(eur(sold)) }, { label: 'Eingelöst im Zeitraum', value: esc(eur(used)) }, { label: 'Offene Gutscheinwerte', value: esc(eur(open)), sub: 'Verbindlichkeit gegenüber Kunden', accent: true }])}${voucherTable(rows, 'bh-vouch')}` };
}
export function voucherTable(rows, id) {
  return table({ id, title: 'Gutscheine', cols: [{ label: 'Code', get: (v) => v.code, html: (v) => `<code>${esc(v.code)}</code>${exampleTag(v)}` }, { label: 'Verkauft', type: 'date', get: (v) => v.issuedAt }, { label: 'Käufer', get: (v) => v.buyer }, { label: 'Wert', type: 'money', get: (v) => v.value }, { label: 'Eingelöst', type: 'money', get: (v) => v.used }, { label: 'Restwert', type: 'money', get: (v) => v.remaining }, { label: 'Gültig bis', type: 'date', get: (v) => v.expires }, { label: 'Status', get: (v) => v.status, html: (v) => `<span class="status status--${v.status === 'aktiv' || v.status === 'teilweise' ? 'approved' : v.status === 'abgelaufen' ? 'pending' : 'rejected'}">${esc(v.status)}</span>` }], rows, empty: 'Keine Gutscheine im Zeitraum.' });
}
function bhPakete(r) {
  const cards = packageState(P.db.packageCards, P.db.transactions);
  const T = T_in(r);
  const rows = P.db.packages.map((p) => {
    const sold = T.reduce((s, t) => s + t.lines.filter((l) => l.kind === 'package' && l.refId === p.id).reduce((a, l) => a + l.qty, 0), 0);
    const rev = T.reduce((s, t) => s + t.lines.filter((l) => l.kind === 'package' && l.refId === p.id).reduce((a, l) => a + lineGross(l), 0), 0);
    const mine = cards.filter((c) => c.packageId === p.id && !c.cancelled);
    const usedR = T.reduce((s, t) => s + t.lines.filter((l) => l.kind === 'package_use' && mine.some((c) => c.id === l.cardId)).reduce((a, l) => a + l.qty, 0), 0);
    return { name: p.name, sold, rev: A(rev, Math.round(rev / 1.19)), usedR, open: mine.reduce((s, c) => s + c.left, 0), active: mine.filter((c) => c.left > 0).length };
  });
  return { csv: 'bh-pkg', html: `${table({ id: 'bh-pkg', title: 'Beauty-Pakete', cols: [{ label: 'Paket', get: (x) => x.name }, { label: 'Verkauft', type: 'int', get: (x) => x.sold }, { label: 'Umsatz', type: 'amount', get: (x) => x.rev }, { label: 'Einlösungen im Zeitraum', type: 'int', get: (x) => x.usedR }, { label: 'Aktive Karten', type: 'int', get: (x) => x.active }, { label: 'Offene Einheiten', type: 'int', get: (x) => x.open }], rows })}<p class="fine">Pakete werden beim Verkauf als Umsatz (19 %) gebucht; Einlösungen erscheinen mit 0 € im Bon und in der Leistungsstatistik.</p>` };
}
function bhTrinkgeld(r) {
  const T = T_in(r);
  const rows = tipsReport(T).map((x) => ({ ...x, name: staffName(x.staffId) }));
  const paid = -P.db.cashmoves.filter((m) => m.kind === 'tip_payout' && m.date >= r.from && m.date <= r.to).reduce((s, m) => s + m.amount, 0);
  const total = rows.reduce((s, x) => s + x.total, 0);
  const byDay = [...groupSum(T.flatMap((t) => t.tips.map((x) => ({ date: t.date, gross: x.amount }))), (x) => x.date).entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 31).map(([date, s]) => ({ date, v: s.gross }));
  return { csv: 'bh-tips', vat: false, html: `${tiles([{ label: 'Trinkgeld gesamt', value: esc(eur(total)), accent: true, sub: 'durchlaufender Posten' }, { label: 'davon bar', value: esc(eur(rows.reduce((s, x) => s + x.cash, 0))) }, { label: 'davon Karte', value: esc(eur(rows.reduce((s, x) => s + x.card, 0))) }, { label: 'ausgezahlt', value: esc(eur(paid)), sub: total - paid > 0 ? `${eur(total - paid)} noch offen` : 'alles ausgezahlt' }])}
    ${table({ id: 'bh-tips', title: 'Trinkgeld', cols: [{ label: 'Mitarbeiter', get: (x) => x.name }, { label: 'Anzahl', type: 'int', get: (x) => x.n }, { label: 'bar', type: 'money', get: (x) => x.cash }, { label: 'Karte', type: 'money', get: (x) => x.card }, { label: 'Summe', type: 'money', get: (x) => x.total }], rows, foot: { label: 'Summe', n: rows.reduce((s, x) => s + x.n, 0), cash: rows.reduce((s, x) => s + x.cash, 0), card: rows.reduce((s, x) => s + x.card, 0), total } })}
    <h2 class="h-sub">Je Tag</h2>${table({ id: 'bh-tips-day', title: 'Trinkgeld je Tag', cols: [{ label: 'Tag', type: 'date', get: (x) => x.date }, { label: 'Trinkgeld', type: 'money', get: (x) => x.v }], rows: byDay })}
    <p class="fine">Trinkgeld ist für Angestellte nach § 3 Nr. 51 EStG steuerfrei und gehört nicht zum Umsatz. Im DATEV-Export steht es auf „Durchlaufende Posten“.</p>` };
}
function bhAbschluss() {
  const t = today();
  const months = [...new Set(P.db.transactions.map((x) => x.month))].sort().reverse().filter((m) => m < t.slice(0, 7));
  if (!ABS_MONTH || !months.includes(ABS_MONTH)) ABS_MONTH = months.find((m) => !P.db.closings.some((c) => c.month === m)) || months[0];
  const s = P.db.settings.datev || {};
  const skr = ABS_SKR || s.skr || '03';
  const pkg = ABS_MONTH ? monthPackage(ABS_MONTH, skr) : null;
  const closing = P.db.closings.find((c) => c.month === ABS_MONTH);
  const prevOpen = ABS_MONTH && months.filter((m) => m < ABS_MONTH && !P.db.closings.some((c) => c.month === m)).length;
  const Acc = accountsFor(skr, s.accounts);
  if (!pkg) return { html: '<p class="empty">Noch kein abgelaufener Monat mit Umsätzen.</p>' };
  const rep = pkg.rep;
  return { vat: false, html: `
    <div class="close">
      <section class="close__main">
        <div class="close__pick">
          <label class="label" for="ab-month">Monat</label>
          <select class="select select--box" id="ab-month" data-ab-month>${months.map((m) => `<option value="${m}" ${m === ABS_MONTH ? 'selected' : ''}>${esc(monthDE(m))}${P.db.closings.some((c) => c.month === m) ? ' · abgeschlossen' : ''}</option>`).join('')}</select>
          <div class="seg seg--sm" role="group" aria-label="Kontenrahmen"><button type="button" data-skr="03" aria-pressed="${skr === '03'}">SKR03</button><button type="button" data-skr="04" aria-pressed="${skr === '04'}">SKR04</button></div>
        </div>
        <p class="close__status ${closing ? 'is-locked' : ''}">${closing ? `<b>Abgeschlossen</b> am ${esc(new Date(closing.lockedAt).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' }))}${closing.byName ? ` von ${esc(closing.byName)}` : ''}. Änderungen nur noch als Korrekturbuchung im laufenden Monat.${closing.hash ? ` <span class="mono">Prüfsumme ${esc(closing.hash.slice(0, 16))}…</span>` : ''}` : `<b>Offen.</b> Nach dem Abschluss sind Belege, Kassenbuch und Lagerbewegungen dieses Monats gesperrt.`}</p>
        ${tiles([{ label: 'Umsatz brutto', value: esc(eur(rep.revenue.gross)), accent: true }, { label: 'Netto', value: esc(eur(rep.revenue.net)) }, { label: 'Umsatzsteuer', value: esc(eur(rep.revenue.tax)) }, { label: 'Trinkgeld', value: esc(eur(rep.tipsTotal)) }, { label: 'Bons', value: int(rep.bons), sub: `${rep.voids} Stornos` }, { label: 'Kasse Monatsende', value: esc(eur(rep.cash.closing)) }])}
        <dl class="checks-list">
          <div><dt>Erlöse im DATEV-Stapel</dt><dd class="num">${esc(eur(pkg.sums.datevRevenue))} ${pkg.sums.datevRevenue === pkg.sums.gross ? '<span class="ok">stimmt mit Bericht überein</span>' : '<span class="bad">Abweichung</span>'}</dd></div>
          <div><dt>Buchungssätze</dt><dd class="num">${int(pkg.sums.lines)}</dd></div>
          <div><dt>Berater-Nr. / Mandanten-Nr.</dt><dd>${esc(s.consultant || '–')} / ${esc(s.client || '–')} <a href="#einstellungen" class="link-quiet">ändern</a></dd></div>
        </dl>
        <div class="row-actions row-actions--start">
          <button type="button" class="btn btn-dark" data-ab-zip>Export für Steuerberater (ZIP)</button>
          ${closing ? '' : `<button type="button" class="btn btn-outline" data-ab-lock ${prevOpen ? 'disabled' : ''}>Monat abschließen</button>`}
          <button type="button" class="btn btn-outline btn-sm" data-ab-report>Monatsbericht (HTML)</button>
        </div>
        ${prevOpen ? '<p class="fine">Vorherige Monate sind noch offen. Bitte der Reihe nach abschließen.</p>' : ''}
        <p class="note-tax">Bitte mit dem Steuerberater abstimmen: Kontenzuordnung, Behandlung von Gutscheinen, Trinkgeld, Anzahlungen und Ausfallgebühren. Demo ohne TSE – keine KassenSichV-Konformität.</p>
      </section>
      <aside class="close__side">
        <h2 class="h-sub">Inhalt des ZIP</h2>
        <ul class="file-list">${pkg.files.map((f) => `<li><code>${esc(f)}</code></li>`).join('')}</ul>
        <h2 class="h-sub">Konten SKR ${esc(skr)}</h2>
        <table class="dt dt--compact"><tbody>${Object.entries(ACCOUNT_LABEL).map(([k, l]) => `<tr><th scope="row">${esc(l)}</th><td class="num">${esc(Acc[k])}</td></tr>`).join('')}</tbody></table>
      </aside>
    </div>`,
  bind: (root, re) => {
    root.querySelector('[data-ab-month]').addEventListener('change', (e) => { ABS_MONTH = e.target.value; re(); });
    root.querySelectorAll('[data-skr]').forEach((b) => b.addEventListener('click', () => { ABS_SKR = b.dataset.skr; re(); }));
    root.querySelector('[data-ab-zip]').addEventListener('click', async () => {
      const p = monthPackage(ABS_MONTH, ABS_SKR || s.skr || '03');
      download(p.name, new Blob([p.zip], { type: 'application/zip' }));
      try { await pult.logExport(ABS_MONTH, `ZIP SKR${ABS_SKR || s.skr}`); } catch (_) { /* Protokoll optional */ }
      toast('ZIP erstellt.');
    });
    root.querySelector('[data-ab-report]').addEventListener('click', () => {
      const sk = ABS_SKR || s.skr || '03';
      const p = monthPackage(ABS_MONTH, sk);
      download(p.files[2], new Blob([reportHTML(p.rep, { A: p.A, skr: sk, locked: !!closing })], { type: 'text/html;charset=utf-8' }));
    });
    const lock = root.querySelector('[data-ab-lock]');
    if (lock) lock.addEventListener('click', async () => {
      if (!(await confirmDialog(`${monthDE(ABS_MONTH)} abschließen?`, 'Danach lassen sich Belege, Kassenbuch und Lager dieses Monats nicht mehr ändern. Korrekturen laufen als Gegenbuchung im laufenden Monat.', 'Abschließen', true))) return;
      try { await pult.closeMonth(ABS_MONTH, staffName); await P.refresh(); toast('Monat abgeschlossen.'); re(); } catch (x) { toast(x.message, 'is-error'); }
    });
  } };
}
/* ---------- Zahlungen ---------- */
let PAY_TAB = 'raten';
export function renderZahlungen(root) {
  const t = today();
  const pay = P.db.settings.pay || {};
  const plans = installmentState(P.db.installments, P.db.transactions, t).sort((a, b) => b.open - a.open);
  const open = plans.filter((p) => p.open > 0);
  const nextDue = (p) => p.schedule.find((s) => s.open > 0);
  let body = '';
  if (PAY_TAB === 'raten') body = `${tiles([{ label: 'Offene Raten gesamt', value: esc(eur(open.reduce((s, p) => s + p.open, 0))), accent: true }, { label: 'Laufende Pläne', value: int(open.length) }, { label: 'Überfällig', value: esc(eur(open.reduce((s, p) => s + p.schedule.filter((x) => x.overdue).reduce((a, x) => a + x.open, 0), 0))), trend: open.some((p) => p.schedule.some((x) => x.overdue)) ? -1 : 0, sub: 'fällige, nicht bezahlte Raten' }])}
    ${table({ id: 'pay-plans', title: 'Ratenzahlungen', cols: [{ label: 'Kunde', get: (p) => p.clientName, html: (p) => `<b>${esc(p.clientName)}</b>${exampleTag(p)}<small class="cell-sub">${esc(p.note || '')}</small>` }, { label: 'Vereinbart', type: 'date', get: (p) => p.createdAt }, { label: 'Gesamt', type: 'money', get: (p) => p.total }, { label: 'Bezahlt', type: 'money', get: (p) => p.paid }, { label: 'Offen', type: 'money', get: (p) => p.open }, { label: 'Raten', get: (p) => p.schedule.map((s) => `${dateDE(s.due)} ${eur(s.amount)}${s.open === 0 ? ' ✓' : s.overdue ? ' überfällig' : ''}`).join(' · '), html: (p) => `<ul class="rates">${p.schedule.map((s) => `<li class="${s.open === 0 ? 'is-paid' : s.overdue ? 'is-overdue' : ''}"><span>${esc(dateDE(s.due))}</span><span class="num">${esc(eur(s.amount))}</span><span>${s.open === 0 ? 'bezahlt' : s.overdue ? 'überfällig' : 'offen'}</span></li>`).join('')}</ul>` }, { label: '', noExport: true, get: () => '', html: (p) => (p.open > 0 ? `<button type="button" class="btn btn-outline btn-sm" data-rate="${p.id}">Rate ${esc(eur((nextDue(p) || {}).open || p.open))} kassieren</button>` : '<span class="status status--approved">erledigt</span>') }], rows: plans, empty: 'Keine Ratenzahlungen vereinbart.' })}`;
  if (PAY_TAB === 'arten') body = `<form class="settings" data-payforms>
      <fieldset class="set-block"><legend class="label">Zahlungsarten an der Kasse</legend>
      ${[['cash', 'Bar', 'Mit Rückgeldrechner und Kassenbuch'], ['card', 'Karte (EC, Kredit, Wallet)', 'Betrag am Terminal eingeben; Buchung auf Geldtransit'], ['voucher', 'Gutschein', 'Einlösen per Code mit Restwert'], ['deposit', 'Anzahlung', 'Bei Terminen mit Vorauszahlung'], ['installment', 'Ratenzahlung', 'Offener Betrag als Raten mit Fälligkeiten']].map(([k, l, h]) => `<label class="check check--row"><input type="checkbox" name="${k}" ${pay[k] !== false ? 'checked' : ''}> <span><b>${l}</b><small>${h}</small></span></label>`).join('')}
      <label class="check check--row is-disabled"><input type="checkbox" disabled> <span><b>Online (Stripe)</b><small>vorbereitet, nicht verbunden</small></span></label>
      </fieldset><div class="row-actions"><button class="btn btn-dark btn-sm" type="submit">Speichern</button></div></form>`;
  if (PAY_TAB === 'online') body = `<section class="card card--flat prose-pult">
      <h2 class="h-sub">Onlinezahlung mit Stripe <span class="stamp">vorbereitet · inaktiv</span></h2>
      <p>Für Anzahlungen bei der Online-Buchung und den Online-Verkauf von Gutscheinen ist Stripe Checkout vorgesehen. In der Demo ist nichts verbunden, es fließt kein Geld.</p>
      <ol class="steps"><li>Stripe-Konto anlegen und verifizieren.</li><li>Den geheimen Schlüssel <b>nur</b> als Secret in einer Supabase Edge Function hinterlegen – nie im Frontend.</li><li>Edge Function <code>create-checkout</code> erstellt die Checkout-Session; der Webhook <code>stripe-webhook</code> bucht die Anzahlung serverseitig (Signatur prüfen).</li><li>Im Frontend steht nur der öffentliche Schlüssel (pk_live_…).</li></ol>
      <div class="grid2"><div class="field"><label class="label" for="st-pk">Öffentlicher Schlüssel</label><input class="input" id="st-pk" disabled placeholder="pk_live_… (nicht verbunden)"></div><div class="field"><label class="label" for="st-dep">Anzahlung ab Leistungsdauer</label><input class="input" id="st-dep" disabled value="ab 120 Minuten: 50,00 €"></div></div>
      ${demoNote('Stripe ist nicht angeschlossen. Der Button „Online“ an der Kasse bleibt deaktiviert.')}
    </section>`;
  root.innerHTML = `${head('Zahlungen')}
    <div class="tabs" role="tablist" aria-label="Zahlungen">${[['raten', 'Ratenzahlungen'], ['arten', 'Zahlungsarten'], ['online', 'Onlinezahlung']].map(([k, l]) => `<button type="button" role="tab" data-ptab="${k}" aria-selected="${PAY_TAB === k}">${l}</button>`).join('')}</div>
    ${body}`;
  root.querySelectorAll('[data-ptab]').forEach((b) => b.addEventListener('click', () => { PAY_TAB = b.dataset.ptab; renderZahlungen(root); }));
  root.querySelectorAll('[data-rate]').forEach((b) => b.addEventListener('click', () => { kasse.installment(b.dataset.rate); P.nav('kasse'); }));
  const f = root.querySelector('[data-payforms]');
  if (f) f.addEventListener('submit', async (e) => { e.preventDefault(); const el = f.elements; try { await pult.saveBizSettings({ pay: { cash: el.cash.checked, card: el.card.checked, voucher: el.voucher.checked, deposit: el.deposit.checked, installment: el.installment.checked } }); await P.refresh(); toast('Gespeichert.'); } catch (x) { toast(x.message, 'is-error'); } });
}

/* ---------- Statistiken (eigene Auswertungen) ---------- */
const METRICS = { revenue: ['Umsatz', 'amount'], services: ['Anzahl Leistungen', 'int'], qty: ['Verkaufte Produkte (Stück)', 'int'], bons: ['Anzahl Bons', 'int'], avg: ['Ø Bon', 'amount'], tips: ['Trinkgeld', 'money'], clients: ['Kunden', 'int'], appts: ['Termine', 'int'] };
const GROUPS = { day: 'Tag', week: 'Woche', month: 'Monat', weekday: 'Wochentag', hour: 'Uhrzeit', staff: 'Mitarbeiter', service: 'Dienstleistung', product: 'Produkt', method: 'Zahlungsart', category: 'Kategorie' };
const PERIODS = { month: 'Dieser Monat', lastmonth: 'Letzter Monat', quarter: 'Quartal', year: 'Dieses Jahr', range: 'Zeitraum der Leiste' };
let STAT = { name: '', metric: 'revenue', group: 'month', period: 'year', view: 'chart', id: null };
const WDN = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
function presetFor(p) { const t = today(); const m = t.slice(0, 7); const end = (x) => monthBounds(x).to; if (p === 'month') return { from: `${m}-01`, to: end(m) }; if (p === 'lastmonth') { const l = addMonth(m, -1); return { from: `${l}-01`, to: end(l) }; } if (p === 'quarter') { const q = Math.floor((Number(m.slice(5)) - 1) / 3) * 3 + 1; const s = `${m.slice(0, 4)}-${String(q).padStart(2, '0')}`; return { from: `${s}-01`, to: end(addMonth(s, 2)) }; } return { from: `${t.slice(0, 4)}-01-01`, to: `${t.slice(0, 4)}-12-31` }; }
export function computeStat({ metric, group }, r) {
  const T = T_in(r);
  const keyOf = (date, time, extra) => ({ day: date, week: mondayOf(date), month: date.slice(0, 7), weekday: String(weekday(date)), hour: String(Math.floor((time || 0) / 60)), ...extra })[group];
  const labelOf = (k) => ({ day: () => dateDE(k), week: () => `KW ab ${dateDE(k)}`, month: () => monthDE(k), weekday: () => WDN[Number(k)], hour: () => `${k}:00–${Number(k) + 1}:00`, staff: () => staffName(k), service: () => (svcOf(k) || { name: k }).name, product: () => (productOf(k) || { name: k }).name, method: () => METHODS[k] || k, category: () => k })[group]();
  const m = new Map();
  const add = (k, g, n = g) => { if (k == null) return; const o = m.get(k) || { gross: 0, net: 0, n: 0, set: new Set() }; o.gross += g; o.net += n; o.n += 1; m.set(k, o); return o; };
  if (metric === 'revenue' || metric === 'services' || metric === 'qty') {
    for (const x of revenueFacts(T)) {
      if (metric === 'services' && !(x.kind === 'service' || x.kind === 'package_use')) continue;
      if (metric === 'qty' && x.kind !== 'product') continue;
      if (group === 'method') continue;
      const p = x.kind === 'product' ? productOf(x.refId) : null;
      const k = keyOf(x.date, x.time, { staff: x.staffId, service: x.serviceId || (x.kind === 'service' ? x.refId : null), product: x.kind === 'product' ? x.refId : null, category: p ? p.cat : (svcOf(x.serviceId) || {}).cat || KIND[x.kind] });
      if (metric === 'revenue') add(k, x.gross, x.net); else add(k, x.qty, x.qty);
    }
    if (metric === 'revenue' && group === 'method') for (const t of T) for (const p of t.payments) add(p.method, p.amount, p.amount);
  } else if (metric === 'bons' || metric === 'avg' || metric === 'clients') {
    for (const t of liveBons(T)) {
      const ks = group === 'staff' ? [...new Set(t.lines.map((l) => l.staffId))] : group === 'method' ? [...new Set(t.payments.map((p) => p.method))] : group === 'service' ? [...new Set(t.lines.filter((l) => l.serviceId).map((l) => l.serviceId))] : group === 'product' ? [...new Set(t.lines.filter((l) => l.kind === 'product').map((l) => l.refId))] : group === 'category' ? [...new Set(t.lines.map((l) => KIND[l.kind]))] : [keyOf(t.date, t.time, {})];
      for (const k of ks) { const o = add(k, t.totals.revenue, t.totals.net); if (o && t.clientId) o.set.add(t.clientId); }
    }
  } else if (metric === 'tips') {
    for (const t of T) for (const x of t.tips) add(keyOf(t.date, t.time, { staff: x.staffId, method: x.method, service: null, product: null, category: 'Trinkgeld' }), x.amount, x.amount);
  } else if (metric === 'appts') {
    for (const a of P.db.appointments.filter((x) => x.status === 'booked' && x.date >= r.from && x.date <= r.to)) add(keyOf(a.date, a.start, { staff: a.staffId, service: a.serviceId, product: null, method: a.source === 'customer' ? 'online' : 'studio', category: (svcOf(a.serviceId) || {}).cat }), 1, 1);
  }
  const rows = [...m.entries()].map(([k, o]) => {
    const v = metric === 'revenue' ? A(o.gross, o.net) : metric === 'avg' ? A(o.n ? Math.round(o.gross / o.n) : 0, o.n ? Math.round(o.net / o.n) : 0) : metric === 'bons' || metric === 'appts' ? o.n : metric === 'clients' ? o.set.size : o.gross;
    return { k, label: labelOf(k), v };
  });
  const ordered = ['day', 'week', 'month', 'weekday', 'hour'].includes(group);
  rows.sort(ordered ? (a, b) => (group === 'weekday' ? ((Number(a.k) + 6) % 7) - ((Number(b.k) + 6) % 7) : group === 'hour' ? Number(a.k) - Number(b.k) : a.k < b.k ? -1 : 1) : (a, b) => (typeof b.v === 'object' ? amt(b.v) - amt(a.v) : b.v - a.v));
  return rows;
}
export function renderStatistiken(root) {
  const r = STAT.period === 'range' ? ensureRange() : presetFor(STAT.period);
  const rows = computeStat(STAT, r);
  const [mLabel, mType] = METRICS[STAT.metric];
  const val = (x) => (typeof x.v === 'object' ? amt(x.v) : x.v);
  const fmt = mType === 'int' ? (v) => int(v) : (v) => eur(v);
  root.innerHTML = `${head('Statistiken', '', 'Eigene Auswertungen speichern, als Tabelle oder Diagramm.')}
    <div class="stat">
      <aside class="stat__saved" aria-labelledby="st-saved"><h2 id="st-saved" class="h-sub">Gespeichert</h2>
        <ul class="saved-list">${P.db.stats.map((s) => `<li><button type="button" data-stat-open="${s.id}" ${STAT.id === s.id ? 'aria-current="true"' : ''}>${esc(s.name)}${exampleTag(s)}</button><button type="button" class="cart__x" data-stat-del="${s.id}" aria-label="${esc(s.name)} löschen"><span aria-hidden="true"></span></button></li>`).join('') || '<li class="empty empty--sm">Noch keine.</li>'}</ul>
        <button type="button" class="link-quiet" data-stat-new>Neue Auswertung</button>
      </aside>
      <section class="stat__main">
        <form class="stat__form" data-stat-form>
          <div class="field"><label class="label" for="st-m">Kennzahl</label><select class="select select--box" id="st-m" name="metric">${Object.entries(METRICS).map(([k, [l]]) => `<option value="${k}" ${STAT.metric === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
          <div class="field"><label class="label" for="st-g">Gruppiert nach</label><select class="select select--box" id="st-g" name="group">${Object.entries(GROUPS).map(([k, l]) => `<option value="${k}" ${STAT.group === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
          <div class="field"><label class="label" for="st-p">Zeitraum</label><select class="select select--box" id="st-p" name="period">${Object.entries(PERIODS).map(([k, l]) => `<option value="${k}" ${STAT.period === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
          <div class="field"><span class="label">Darstellung</span><div class="seg seg--sm" role="group" aria-label="Darstellung"><button type="button" data-sv="table" aria-pressed="${STAT.view === 'table'}">Tabelle</button><button type="button" data-sv="chart" aria-pressed="${STAT.view === 'chart'}">Diagramm</button></div></div>
          <div class="field field--grow"><label class="label" for="st-n">Name</label><input class="input" id="st-n" name="name" value="${esc(STAT.name)}" maxlength="60" placeholder="z. B. Umsatz je Wochentag"></div>
          <button type="submit" class="btn btn-dark btn-sm">Speichern</button>
        </form>
        ${toolbar({ range: STAT.period === 'range', csv: 'stat', vat: mType === 'amount' })}
        <p class="stat__meta">${esc(mLabel)} nach ${esc(GROUPS[STAT.group])} · ${esc(dateDE(r.from))} – ${esc(dateDE(r.to))}${mType === 'amount' ? ` · ${vatLabel()}` : ''}</p>
        ${STAT.view === 'chart' ? (['day', 'week', 'month', 'weekday', 'hour'].includes(STAT.group) ? bars(rows.map((x) => ({ label: x.label, short: x.label.slice(0, 6), value: val(x) })), { fmt, label: mLabel }) : hbars(rows.slice(0, 15).map((x) => ({ label: x.label, value: val(x) })), { fmt })) : ''}
        ${table({ id: 'stat', title: STAT.name || `${mLabel} nach ${GROUPS[STAT.group]}`, cols: [{ label: GROUPS[STAT.group], get: (x) => x.label }, { label: mLabel, type: mType, get: (x) => x.v }], rows, foot: mType === 'amount' && STAT.metric === 'avg' ? null : { label: 'Summe', v: mType === 'amount' ? rows.reduce((s, x) => A(s.gross + x.v.gross, s.net + x.v.net), A(0, 0)) : rows.reduce((s, x) => s + x.v, 0) } })}
      </section>
    </div>`;
  bindToolbar(root, () => renderStatistiken(root));
  const f = root.querySelector('[data-stat-form]');
  f.addEventListener('change', (e) => { if (e.target.name && e.target.name !== 'name') { STAT[e.target.name] = e.target.value; renderStatistiken(root); } });
  f.addEventListener('input', (e) => { if (e.target.name === 'name') STAT.name = e.target.value; });
  f.addEventListener('submit', async (e) => { e.preventDefault(); try { const s = await pult.saveStat({ ...STAT, name: STAT.name || `${mLabel} nach ${GROUPS[STAT.group]}` }); STAT.id = s.id; STAT.name = s.name; await P.refresh(); toast('Auswertung gespeichert.'); renderStatistiken(root); } catch (x) { toast(x.message, 'is-error'); } });
  root.querySelectorAll('[data-sv]').forEach((b) => b.addEventListener('click', () => { STAT.view = b.dataset.sv; renderStatistiken(root); }));
  root.querySelectorAll('[data-stat-open]').forEach((b) => b.addEventListener('click', () => { const s = P.db.stats.find((x) => x.id === b.dataset.statOpen); STAT = { id: s.id, name: s.name, metric: s.metric, group: s.group, period: s.period, view: s.view }; renderStatistiken(root); }));
  root.querySelectorAll('[data-stat-del]').forEach((b) => b.addEventListener('click', async () => { if (!(await confirmDialog('Auswertung löschen?', 'Nur die gespeicherte Ansicht wird entfernt, keine Daten.', 'Löschen', true))) return; await pult.removeStat(b.dataset.statDel); if (STAT.id === b.dataset.statDel) STAT.id = null; await P.refresh(); renderStatistiken(root); }));
  root.querySelector('[data-stat-new]').addEventListener('click', () => { STAT = { name: '', metric: 'revenue', group: 'weekday', period: 'year', view: 'chart', id: null }; renderStatistiken(root); });
}
void $; void clientOf; void isAdmin; void parseEuro; void MOVES;
