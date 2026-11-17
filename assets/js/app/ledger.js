/* BRK Studio Studio-Pult – Kassen- und Buchhaltungslogik (rein, ohne DOM und Speicher)
   Beträge immer in Cent (Integer), Preise brutto. Belege werden nie gelöscht oder geändert:
   ein Storno ist ein eigener Gegenbeleg mit negativen Beträgen (voidOf = Originalbeleg). */

export const KIND = { service: 'Dienstleistung', product: 'Produkt', voucher: 'Gutschein-Verkauf', package: 'Beauty-Paket', package_use: 'Paket-Einlösung', fee: 'Ausfallgebühr', deposit: 'Anzahlung', installment: 'Rate' };
export const REVENUE_KINDS = new Set(['service', 'product', 'package', 'package_use', 'fee']);
export const METHODS = { cash: 'Bar', card: 'Karte', voucher: 'Gutschein', deposit: 'Anzahlung', installment: 'Ratenzahlung', online: 'Online (Stripe)' };
export const VAT_RATES = [19, 7, 0];

/* ---------- Geld ---------- */
const NF = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const eur = (c) => `${NF.format((c || 0) / 100)}\u00a0€`;
export const num2 = (c) => NF.format((c || 0) / 100);
export const pct = (x, d = 1) => `${(x * 100).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d })}\u00a0%`;
/** „12,50“, „12.50“, „1.234,5“ -> Cent; null bei ungültig */
export function parseEuro(v) {
  let s = String(v == null ? '' : v).trim().replace(/\s|€/g, '');
  if (!s) return null;
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(parseFloat(s) * 100);
}

export const lineGross = (l) => l.qty * l.unit - (l.discount || 0);
/** Brutto -> Netto/Steuer (Steuer wird aus dem Brutto herausgerechnet) */
export function split(gross, rate) {
  if (!rate) return { gross, net: gross, tax: 0 };
  const net = Math.round((gross * 100) / (100 + rate));
  return { gross, net, tax: gross - net };
}

/** Summen eines Belegs. Steuer je Steuersatz auf der Summe (wie auf dem Bon ausgewiesen). */
export function computeTotals(lines) {
  const byRate = {};
  let due = 0, other = 0;
  for (const l of lines) {
    const g = lineGross(l);
    due += g;
    if (REVENUE_KINDS.has(l.kind)) { const r = l.vat || 0; byRate[r] = (byRate[r] || 0) + g; } else other += g;
  }
  const vat = {};
  let net = 0, tax = 0, revenue = 0;
  for (const [r, g] of Object.entries(byRate)) { const s = split(g, Number(r)); vat[r] = s; net += s.net; tax += s.tax; revenue += g; }
  return { due, revenue, net, tax, other, vat };
}

/* ---------- Beleg bauen und prüfen ---------- */
export function buildBon({ lines, payments, tips = [], cashGiven = null, clientId = null, clientName = '', apptIds = [], cashier, date, time, note = '' }) {
  if (!Array.isArray(lines) || !lines.length) throw new Error('Der Warenkorb ist leer.');
  for (const l of lines) {
    if (!KIND[l.kind]) throw new Error('Unbekannte Position.');
    if (!(Number.isInteger(l.qty) && l.qty > 0 && l.qty <= 99)) throw new Error(`Menge bei „${l.name}“ prüfen.`);
    if (!(Number.isInteger(l.unit) && l.unit >= 0)) throw new Error(`Preis bei „${l.name}“ prüfen.`);
    if (!(Number.isInteger(l.discount || 0) && (l.discount || 0) >= 0 && (l.discount || 0) <= l.qty * l.unit)) throw new Error(`Rabatt bei „${l.name}“ ist höher als der Preis.`);
    if (REVENUE_KINDS.has(l.kind) && !VAT_RATES.includes(l.vat)) throw new Error('Steuersatz fehlt.');
  }
  const totals = computeTotals(lines);
  const pay = (payments || []).filter((p) => p.amount);
  for (const p of pay) {
    if (!METHODS[p.method]) throw new Error('Unbekannte Zahlungsart.');
    if (!(Number.isInteger(p.amount) && p.amount > 0)) throw new Error('Zahlbetrag prüfen.');
    if (p.method === 'voucher' && !p.ref) throw new Error('Gutscheincode fehlt.');
  }
  const paid = pay.reduce((s, p) => s + p.amount, 0);
  if (paid !== totals.due) throw new Error(paid < totals.due ? `Es fehlen noch ${eur(totals.due - paid)}.` : `Es sind ${eur(paid - totals.due)} zu viel verteilt.`);
  if (lines.some((l) => l.kind === 'voucher') && pay.some((p) => p.method === 'voucher')) throw new Error('Gutscheine können nicht mit Gutscheinen bezahlt werden.');
  if (lines.some((l) => l.kind === 'deposit') && pay.some((p) => p.method === 'deposit')) throw new Error('Anzahlung und Einlösung einer Anzahlung bitte getrennt kassieren.');
  const cash = pay.filter((p) => p.method === 'cash').reduce((s, p) => s + p.amount, 0);
  const t = tips.filter((x) => x.amount);
  for (const x of t) if (!(Number.isInteger(x.amount) && x.amount > 0 && x.amount <= 50000) || !['cash', 'card'].includes(x.method)) throw new Error('Trinkgeld prüfen.');
  const cashTips = t.filter((x) => x.method === 'cash').reduce((s, x) => s + x.amount, 0);
  let change = 0;
  if (cashGiven != null) {
    if (cashGiven < cash + cashTips) throw new Error('Gegebener Betrag ist kleiner als der Barbetrag.');
    change = cashGiven - cash - cashTips;
  }
  return { date, time, at: new Date().toISOString(), cashier, clientId, clientName, apptIds, lines: lines.map((l) => ({ ...l, discount: l.discount || 0 })), payments: pay, tips: t, cashGiven, change, totals, note: String(note || '').slice(0, 200), month: date.slice(0, 7), tse: { state: 'not_connected' } };
}

/** Gegenbeleg (Storno): alle Beträge negativ, verweist auf das Original. */
export function reverseBon(bon, { date, time, cashier, reason }) {
  const lines = bon.lines.map((l) => ({ ...l, qty: -l.qty, discount: -(l.discount || 0) }));
  return {
    date, time, at: new Date().toISOString(), cashier, clientId: bon.clientId, clientName: bon.clientName, apptIds: [],
    lines, payments: bon.payments.map((p) => ({ ...p, amount: -p.amount })), tips: bon.tips.map((x) => ({ ...x, amount: -x.amount })),
    cashGiven: null, change: 0, totals: computeTotals(lines), voidOf: bon.id, voidOfNo: bon.no, note: `Storno zu Bon ${bon.no}${reason ? `: ${String(reason).slice(0, 120)}` : ''}`,
    month: date.slice(0, 7), correction: bon.month !== date.slice(0, 7), tse: { state: 'not_connected' },
  };
}
export const voidedSet = (txs) => new Set(txs.filter((t) => t.voidOf).map((t) => t.voidOf));
export const inRange = (from, to) => (x) => (!from || x.date >= from) && (!to || x.date <= to);
/** „echte“ Belege (ohne stornierte Originale und ohne Gegenbelege) – für Anzahl und Durchschnitt */
export function liveBons(txs) { const v = voidedSet(txs); return txs.filter((t) => !t.voidOf && !v.has(t.id)); }

/* ---------- Auswertungen ---------- */
/** Umsatzzeilen (nur erlöswirksame Positionen), inkl. Gegenbelege mit negativen Werten. */
export function revenueFacts(txs) {
  const out = [];
  for (const t of txs) for (const l of t.lines) {
    if (!REVENUE_KINDS.has(l.kind)) continue;
    const s = split(lineGross(l), l.vat || 0);
    out.push({ ...s, qty: l.qty, kind: l.kind, refId: l.refId, serviceId: l.serviceId || (l.kind === 'service' ? l.refId : null), name: l.name, vat: l.vat || 0, staffId: l.staffId || t.cashier, date: t.date, time: t.time, bonId: t.id, clientId: t.clientId });
  }
  return out;
}
export function sumBons(txs) {
  let gross = 0, net = 0, tax = 0;
  for (const t of txs) { gross += t.totals.revenue; net += t.totals.net; tax += t.totals.tax; }
  return { gross, net, tax };
}
export function groupSum(rows, keyFn, init = () => ({ gross: 0, net: 0, tax: 0, qty: 0, n: 0 })) {
  const m = new Map();
  for (const r of rows) {
    const k = keyFn(r); if (k == null) continue;
    if (!m.has(k)) m.set(k, init());
    const o = m.get(k); o.gross += r.gross || 0; o.net += r.net || 0; o.tax += r.tax || 0; o.qty += r.qty || 0; o.n += 1;
  }
  return m;
}
export function vatReport(txs) {
  const m = {};
  for (const t of txs) for (const [r, s] of Object.entries(t.totals.vat)) { m[r] = m[r] || { rate: Number(r), gross: 0, net: 0, tax: 0 }; m[r].gross += s.gross; m[r].net += s.net; m[r].tax += s.tax; }
  return Object.values(m).sort((a, b) => b.rate - a.rate);
}
export function paymentReport(txs) {
  const m = {};
  for (const t of txs) {
    for (const p of t.payments) { m[p.method] = m[p.method] || { method: p.method, amount: 0, n: 0, tips: 0 }; m[p.method].amount += p.amount; m[p.method].n += Math.sign(p.amount); }
    for (const x of t.tips) { m[x.method] = m[x.method] || { method: x.method, amount: 0, n: 0, tips: 0 }; m[x.method].tips += x.amount; }
  }
  return Object.values(m);
}
export function tipsReport(txs) {
  const m = new Map();
  for (const t of txs) for (const x of t.tips) {
    if (!m.has(x.staffId)) m.set(x.staffId, { staffId: x.staffId, cash: 0, card: 0, n: 0 });
    const o = m.get(x.staffId); o[x.method] += x.amount; o.n += Math.sign(x.amount);
  }
  return [...m.values()].map((o) => ({ ...o, total: o.cash + o.card }));
}

/** Gutscheine: Restwert aus Verkauf minus Einlösungen (Gegenbelege heben auf). */
export function voucherState(vouchers, txs, today) {
  const used = new Map();
  for (const t of txs) for (const p of t.payments) if (p.method === 'voucher') used.set(p.ref, (used.get(p.ref) || 0) + p.amount);
  const v = voidedSet(txs);
  return vouchers.map((vo) => {
    const cancelled = !!(vo.soldBonId && v.has(vo.soldBonId));
    const u = used.get(vo.code) || 0;
    const remaining = cancelled ? 0 : Math.max(0, vo.value - u);
    const status = cancelled ? 'storniert' : remaining === 0 ? 'eingelöst' : vo.expires < today ? 'abgelaufen' : remaining < vo.value ? 'teilweise' : 'aktiv';
    return { ...vo, used: u, remaining, status };
  });
}
export function packageState(cards, txs) {
  const usedBy = new Map();
  for (const t of txs) for (const l of t.lines) if (l.kind === 'package_use') { const k = `${l.cardId}|${l.serviceId}`; usedBy.set(k, (usedBy.get(k) || 0) + l.qty); }
  const v = voidedSet(txs);
  return cards.map((c) => {
    const items = c.items.map((it) => ({ ...it, used: usedBy.get(`${c.id}|${it.serviceId}`) || 0 })).map((it) => ({ ...it, left: it.total - it.used }));
    return { ...c, items, left: items.reduce((s, i) => s + i.left, 0), cancelled: v.has(c.bonId) };
  });
}
export function installmentState(plans, txs, today) {
  const paid = new Map();
  for (const t of txs) for (const l of t.lines) if (l.kind === 'installment') paid.set(l.planId, (paid.get(l.planId) || 0) + lineGross(l));
  const v = voidedSet(txs);
  return plans.map((p) => {
    let rest = paid.get(p.id) || 0;
    const schedule = p.schedule.map((s) => { const covered = Math.min(rest, s.amount); rest -= covered; return { ...s, paid: covered, open: s.amount - covered, overdue: s.amount - covered > 0 && s.due < today }; });
    const paidSum = paid.get(p.id) || 0;
    return { ...p, schedule, paid: paidSum, open: v.has(p.bonId) ? 0 : p.total - paidSum, cancelled: v.has(p.bonId) };
  });
}

/** Barwirkung eines Belegs (Barzahlung + Bar-Trinkgeld) */
export const cashOf = (t) => t.payments.filter((p) => p.method === 'cash').reduce((s, p) => s + p.amount, 0) + t.tips.filter((x) => x.method === 'cash').reduce((s, x) => s + x.amount, 0);
export const MOVES = { opening: 'Anfangsbestand', deposit_in: 'Einlage', withdrawal: 'Entnahme', bank: 'Einzahlung Bank', tip_payout: 'Trinkgeld-Auszahlung', diff: 'Kassendifferenz' };
/** Kassenbuch: alle Barbewegungen mit laufendem Bestand. moves.amount ist vorzeichenbehaftet (Zugang +, Abgang –). */
export function cashBook(txs, moves, from, to) {
  const ev = [];
  for (const t of txs) { const c = cashOf(t); if (c) ev.push({ date: t.date, time: t.time, kind: t.voidOf ? 'void' : 'sale', text: t.voidOf ? `Storno Bon ${t.voidOfNo}` : `Bon ${t.no}`, amount: c, ref: t.id }); }
  for (const m of moves) ev.push({ date: m.date, time: m.time ?? 1439, kind: m.kind, text: `${MOVES[m.kind] || m.kind}${m.text ? ` · ${m.text}` : ''}`, amount: m.amount, ref: m.id });
  ev.sort((a, b) => (a.date === b.date ? a.time - b.time : a.date < b.date ? -1 : 1));
  let bal = 0, opening = 0; const rows = [];
  for (const e of ev) {
    if (from && e.date < from) { bal += e.amount; opening = bal; continue; }
    if (to && e.date > to) break;
    bal += e.amount; rows.push({ ...e, balance: bal });
  }
  const sum = (k) => rows.filter(k).reduce((s, r) => s + r.amount, 0);
  return { opening, closing: bal, rows, cashIn: sum((r) => r.amount > 0), cashOut: sum((r) => r.amount < 0) };
}

/* ---------- DATEV ---------- */
export const SKR = {
  '03': { cash: 1000, bank: 1200, transit: 1360, rev19: 8400, rev7: 8300, rev0: 8200, voucher: 1710, deposit: 1710, receivable: 1400, transitory: 1590, privateIn: 1890, privateOut: 1800, diffExp: 4900, diffInc: 2700 },
  '04': { cash: 1600, bank: 1800, transit: 1460, rev19: 4400, rev7: 4300, rev0: 4200, voucher: 3250, deposit: 3250, receivable: 1200, transitory: 1370, privateIn: 2180, privateOut: 2100, diffExp: 6300, diffInc: 4830 },
};
export const ACCOUNT_LABEL = { cash: 'Kasse', bank: 'Bank', transit: 'Geldtransit (Kartenzahlungen)', rev19: 'Erlöse 19 % USt', rev7: 'Erlöse 7 % USt', rev0: 'Erlöse steuerfrei', voucher: 'Erhaltene Anzahlungen (Gutscheine)', deposit: 'Erhaltene Anzahlungen (Termine)', receivable: 'Forderungen (Raten)', transitory: 'Durchlaufende Posten (Trinkgeld)', privateIn: 'Privateinlagen', privateOut: 'Privatentnahmen', diffExp: 'Kassenfehlbetrag', diffInc: 'Kassenüberschuss' };
export const accountsFor = (skr = '03', overrides = {}) => ({ ...SKR[skr === '04' ? '04' : '03'], ...(overrides || {}) });

const payAcct = (A, m) => ({ cash: A.cash, card: A.transit, online: A.transit, voucher: A.voucher, deposit: A.deposit, installment: A.receivable }[m]);
const revAcct = (A, r) => (Number(r) === 19 ? A.rev19 : Number(r) === 7 ? A.rev7 : A.rev0);

/** Buchungssätze (Soll an Haben) für Belege und Kassenbewegungen. amount vorzeichenbehaftet. */
export function datevBookings(txs, moves, A, staffName = (id) => id) {
  const out = [];
  for (const t of txs) {
    const beleg = `BON-${String(t.no).padStart(6, '0')}`;
    const debit = t.payments.map((p) => ({ acct: payAcct(A, p.method), amount: p.amount, label: METHODS[p.method] }));
    const credit = [];
    for (const [r, s] of Object.entries(t.totals.vat)) credit.push({ acct: revAcct(A, r), amount: s.gross, label: `Erlöse ${r} %` });
    for (const l of t.lines) {
      if (REVENUE_KINDS.has(l.kind)) continue;
      credit.push({ acct: l.kind === 'voucher' ? A.voucher : l.kind === 'deposit' ? A.deposit : A.receivable, amount: lineGross(l), label: KIND[l.kind] });
    }
    // Soll und Haben paarweise verrechnen (Summen je Konto bleiben exakt erhalten)
    let i = 0, j = 0, di = debit[0] ? Math.abs(debit[0].amount) : 0, cj = credit[0] ? Math.abs(credit[0].amount) : 0;
    const sign = t.totals.due < 0 ? -1 : 1;
    while (i < debit.length && j < credit.length) {
      if (!di) { i++; di = debit[i] ? Math.abs(debit[i].amount) : 0; continue; }
      if (!cj) { j++; cj = credit[j] ? Math.abs(credit[j].amount) : 0; continue; }
      const m = Math.min(di, cj);
      out.push({ amount: sign * m, konto: debit[i].acct, gegen: credit[j].acct, date: t.date, beleg, text: `${t.voidOf ? 'Storno ' : ''}${credit[j].label} ${debit[i].label}`, bon: t.no });
      di -= m; cj -= m;
    }
    for (const x of t.tips) out.push({ amount: x.amount, konto: x.method === 'cash' ? A.cash : A.transit, gegen: A.transitory, date: t.date, beleg, text: `${x.amount < 0 ? 'Storno ' : ''}Trinkgeld ${staffName(x.staffId)} ${x.method === 'cash' ? 'bar' : 'Karte'}`, bon: t.no, tip: true });
  }
  for (const m of moves) {
    const beleg = `KB-${m.date.replace(/-/g, '')}-${String(m.id).slice(-4)}`;
    const a = Math.abs(m.amount), text = `${MOVES[m.kind]}${m.text ? ` ${m.text}` : ''}`;
    if (m.kind === 'opening' || !a) continue; // Anfangsbestand kommt aus der Eröffnungsbilanz
    if (m.kind === 'deposit_in') out.push({ amount: a, konto: A.cash, gegen: A.privateIn, date: m.date, beleg, text });
    else if (m.kind === 'withdrawal') out.push({ amount: a, konto: A.privateOut, gegen: A.cash, date: m.date, beleg, text });
    else if (m.kind === 'bank') out.push({ amount: a, konto: A.transit, gegen: A.cash, date: m.date, beleg, text });
    else if (m.kind === 'tip_payout') out.push({ amount: a, konto: A.transitory, gegen: A.cash, date: m.date, beleg, text });
    else if (m.kind === 'diff') out.push(m.amount < 0 ? { amount: a, konto: A.diffExp, gegen: A.cash, date: m.date, beleg, text } : { amount: a, konto: A.cash, gegen: A.diffInc, date: m.date, beleg, text });
  }
  return out;
}

/** Text für DATEV-Felder: ohne Trenner, Anführungszeichen, Zeilenumbrüche; keine Formel-Präfixe. */
export const datevText = (s, max = 60) => String(s || '').replace(/[;"\r\n\t]/g, ' ').replace(/^[=+\-@]+/, '').trim().slice(0, max);
const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
const pad2 = (n) => String(n).padStart(2, '0');
export const DATEV_COLUMNS = ['Umsatz (ohne Soll/Haben-Kz)', 'Soll/Haben-Kennzeichen', 'WKZ Umsatz', 'Kurs', 'Basis-Umsatz', 'WKZ Basis-Umsatz', 'Konto', 'Gegenkonto (ohne BU-Schlüssel)', 'BU-Schlüssel', 'Belegdatum', 'Belegfeld 1', 'Belegfeld 2', 'Skonto', 'Buchungstext'];

/** DATEV-Format „Buchungsstapel“ (EXTF, Version 700, Kategorie 21, Formatversion 13). */
export function datevCSV(bookings, { consultant, client, fyStart, from, to, skr = '03', label = 'Kasse', created = new Date(), locked = false }) {
  const d = created;
  const stamp = `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}000`;
  const ymd = (iso) => iso.replace(/-/g, '');
  const header = ['"EXTF"', 700, 21, '"Buchungsstapel"', 13, stamp, '', '"RE"', '""', '""', Number(consultant) || 0, Number(client) || 0, ymd(fyStart), 4, ymd(from), ymd(to), q(datevText(label, 30)), '""', 1, 0, locked ? 1 : 0, '"EUR"', '', '""', '', '', q(skr === '04' ? '04' : '03'), '', '', '""', '""'];
  const lines = [header.join(';'), DATEV_COLUMNS.map(q).join(';')];
  for (const b of bookings) {
    if (!b.amount) continue;
    const [y, m, dd] = b.date.split('-');
    lines.push([num2(Math.abs(b.amount)).replace(/\./g, ''), q(b.amount < 0 ? 'H' : 'S'), q('EUR'), '', '', '""', b.konto, b.gegen, '""', `${dd}${m}`, q(datevText(b.beleg, 36)), '""', '', q(datevText(b.text, 60))].join(';'));
    void y;
  }
  return `${lines.join('\r\n')}\r\n`;
}

/* ---------- CSV für Excel (Schutz gegen Formel-Injection) ---------- */
export const safeCell = (v) => { const s = String(v == null ? '' : v); return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; };
/** cols: [{ label, get(row), type: 'text'|'money'|'num'|'pct' }] -> CSV mit ; und CRLF */
export function toCSV(rows, cols) {
  const cell = (c, r) => {
    const v = c.get(r);
    if (c.type === 'money') return v == null ? '' : num2(v).replace(/\./g, '');
    if (c.type === 'num') return String(v ?? '').replace('.', ',');
    if (c.type === 'pct') return v == null || v === '' ? '' : (v * 100).toFixed(1).replace('.', ',');
    return q(safeCell(v));
  };
  return `${[cols.map((c) => q(safeCell(c.label))).join(';'), ...rows.map((r) => cols.map((c) => cell(c, r)).join(';'))].join('\r\n')}\r\n`;
}

/* ---------- Monatsbericht ---------- */
export function monthBounds(month) {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${pad2(last)}` };
}
export function monthReport({ txs, moves, month, staffName, vouchers = [], today }) {
  const { from, to } = monthBounds(month);
  const T = txs.filter((t) => t.month === month);
  const M = moves.filter((m) => m.date >= from && m.date <= to);
  const live = liveBons(T);
  const rev = sumBons(T);
  const tips = tipsReport(T).map((x) => ({ ...x, name: staffName(x.staffId) }));
  const book = cashBook(txs, moves, from, to);
  const other = { voucherSold: 0, voucherUsed: 0, deposits: 0, depositsUsed: 0, installments: 0, installmentsOpened: 0 };
  for (const t of T) {
    for (const l of t.lines) { if (l.kind === 'voucher') other.voucherSold += lineGross(l); if (l.kind === 'deposit') other.deposits += lineGross(l); if (l.kind === 'installment') other.installments += lineGross(l); }
    for (const p of t.payments) { if (p.method === 'voucher') other.voucherUsed += p.amount; if (p.method === 'deposit') other.depositsUsed += p.amount; if (p.method === 'installment') other.installmentsOpened += p.amount; }
  }
  const days = [...groupSum(T.map((t) => ({ date: t.date, gross: t.totals.revenue, net: t.totals.net, tax: t.totals.tax })), (r) => r.date).entries()].sort().map(([date, s]) => ({ date, ...s }));
  return {
    month, from, to, revenue: rev, vat: vatReport(T), payments: paymentReport(T), tips, tipsTotal: tips.reduce((s, x) => s + x.total, 0),
    bons: live.length, voids: T.filter((t) => t.voidOf).length, corrections: T.filter((t) => t.correction).length, avg: live.length ? Math.round(rev.gross / live.length) : 0,
    cash: { opening: book.opening, closing: book.closing, cashIn: book.cashIn, cashOut: book.cashOut, rows: book.rows }, moves: M, other, days,
    vouchersOpen: voucherState(vouchers, txs, today || to).filter((v) => v.remaining > 0).reduce((s, v) => s + v.remaining, 0),
  };
}
