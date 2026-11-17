/* Studio-Pult – Exporte: Transaktionen (Excel-CSV), DATEV-Buchungsstapel, Monatsbericht, ZIP für den Steuerberater */
import { P, esc, eur, dateDE, hhmm, staffName, monthDE, pct } from './kit.js';
import { toCSV, datevBookings, datevCSV, accountsFor, ACCOUNT_LABEL, monthReport, monthBounds, METHODS, KIND, lineGross, split, REVENUE_KINDS, voidedSet, MOVES } from '../ledger.js';
import { makeZip, cp1252, utf8bom, utf8 } from '../zip.js';

export function txRows(txs) {
  const v = voidedSet(P.db.transactions);
  const rows = [];
  for (const t of txs) {
    const pay = t.payments.map((p) => `${METHODS[p.method]} ${(p.amount / 100).toFixed(2).replace('.', ',')}`).join(' + ');
    const status = t.voidOf ? `Storno zu ${t.voidOfNo}` : v.has(t.id) ? 'storniert' : 'gültig';
    for (const l of t.lines) {
      const g = lineGross(l), s = split(g, REVENUE_KINDS.has(l.kind) ? l.vat || 0 : 0);
      rows.push({ date: t.date, time: t.time, no: t.no, kind: KIND[l.kind], name: l.name, qty: l.qty, unit: l.unit, discount: l.discount || 0, gross: g, vat: REVENUE_KINDS.has(l.kind) ? `${l.vat} %` : 'ohne USt.', net: s.net, tax: s.tax, staff: staffName(l.staffId || t.cashier), client: t.clientName || '', pay, status });
    }
    for (const x of t.tips) rows.push({ date: t.date, time: t.time, no: t.no, kind: 'Trinkgeld', name: `Trinkgeld ${x.method === 'cash' ? 'bar' : 'Karte'}`, qty: 1, unit: x.amount, discount: 0, gross: x.amount, vat: 'nicht steuerbar', net: x.amount, tax: 0, staff: staffName(x.staffId), client: t.clientName || '', pay, status });
  }
  return rows;
}
export const TX_COLS = [
  { label: 'Datum', get: (r) => dateDE(r.date) }, { label: 'Uhrzeit', get: (r) => hhmm(r.time) }, { label: 'Bon-Nr.', type: 'num', get: (r) => r.no },
  { label: 'Art', get: (r) => r.kind }, { label: 'Position', get: (r) => r.name }, { label: 'Menge', type: 'num', get: (r) => r.qty },
  { label: 'Einzelpreis', type: 'money', get: (r) => r.unit }, { label: 'Rabatt', type: 'money', get: (r) => r.discount }, { label: 'Brutto', type: 'money', get: (r) => r.gross },
  { label: 'Steuersatz', get: (r) => r.vat }, { label: 'Netto', type: 'money', get: (r) => r.net }, { label: 'MwSt.', type: 'money', get: (r) => r.tax },
  { label: 'Mitarbeiter', get: (r) => r.staff }, { label: 'Kunde', get: (r) => r.client }, { label: 'Zahlung', get: (r) => r.pay }, { label: 'Status', get: (r) => r.status },
];
export const txCSV = (txs) => toCSV(txRows(txs), TX_COLS);

const fyStartOf = (month, m = 1) => { const y = Number(month.slice(0, 4)); const mm = Number(month.slice(5)); const yy = mm >= m ? y : y - 1; return `${yy}-${String(m).padStart(2, '0')}-01`; };

export function datevFor(month, skr) {
  const s = P.db.settings.datev || {};
  const A = accountsFor(skr || s.skr, s.accounts);
  const { from, to } = monthBounds(month);
  const txs = P.db.transactions.filter((t) => t.month === month).sort((a, b) => a.no - b.no);
  const moves = P.db.cashmoves.filter((m) => m.date >= from && m.date <= to);
  const bookings = datevBookings(txs, moves, A, staffName);
  const locked = P.db.closings.some((c) => c.month === month);
  const csv = datevCSV(bookings, { consultant: s.consultant, client: s.client, fyStart: fyStartOf(month, s.fyStartMonth || 1), from, to, skr: skr || s.skr, label: `${(P.db.settings.business || {}).name || 'BRK'} Kasse ${month}`, locked });
  return { csv, bookings, A, txs, moves };
}

export function reportHTML(rep, { A, skr, locked }) {
  const b = P.db.settings.business || {};
  const row = (l, v, cls = '') => `<tr${cls ? ` class="${cls}"` : ''}><td>${esc(l)}</td><td class="n">${esc(v)}</td></tr>`;
  const css = `body{font:13px/1.45 -apple-system,Segoe UI,Inter,Arial,sans-serif;color:#1A1A1A;margin:32px auto;max-width:820px;padding:0 24px}h1{font-size:24px;letter-spacing:-.02em;margin:0 0 4px}h2{font-size:12px;letter-spacing:.14em;text-transform:uppercase;margin:28px 0 8px;border-bottom:1px solid #1A1A1A;padding-bottom:6px}table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}td,th{padding:5px 6px;border-bottom:1px solid #e4e4e4;text-align:left;vertical-align:top}th{font-weight:600;font-size:11px;color:#4A4A4A}.n{text-align:right;white-space:nowrap}.t td{font-weight:700;border-top:1px solid #1A1A1A}.meta{color:#4A4A4A}.note{margin-top:24px;padding:12px 14px;border-left:2px solid #C9A96E;background:#F5F5F5}@media print{body{margin:0}h2{break-after:avoid}table{break-inside:auto}tr{break-inside:avoid}}`;
  const days = rep.days.map((d) => `<tr><td>${esc(dateDE(d.date))}</td><td class="n">${esc(eur(d.net))}</td><td class="n">${esc(eur(d.tax))}</td><td class="n">${esc(eur(d.gross))}</td></tr>`).join('');
  const cash = rep.cash.rows.map((r) => `<tr><td>${esc(dateDE(r.date))}</td><td>${esc(hhmm(Math.min(r.time, 1439)))}</td><td>${esc(r.text)}</td><td class="n">${r.amount > 0 ? esc(eur(r.amount)) : ''}</td><td class="n">${r.amount < 0 ? esc(eur(-r.amount)) : ''}</td><td class="n">${esc(eur(r.balance))}</td></tr>`).join('');
  return `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><title>Monatsbericht ${esc(rep.month)}</title><style>${css}</style></head><body>
<h1>Monatsbericht ${esc(monthDE(rep.month))}</h1>
<p class="meta">${esc(b.name || 'BRK Studio')} · ${esc(b.street || '')}, ${esc(b.zip || '')} ${esc(b.city || '')} · St.-Nr. ${esc(b.taxNo || '–')}<br>Zeitraum ${esc(dateDE(rep.from))} – ${esc(dateDE(rep.to))} · Kontenrahmen SKR ${esc(skr)} · Status: ${locked ? 'abgeschlossen' : 'offen (vorläufig)'} · erstellt ${esc(new Date().toLocaleString('de-DE'))}</p>
<p class="note"><b>Demo-Export.</b> TSE nicht angeschlossen. Kontenzuordnung und steuerliche Behandlung (z. B. Gutscheine, Trinkgeld, Ausfallgebühren) bitte mit dem Steuerberater abstimmen.</p>
<h2>Umsatz</h2><table>${row('Umsatz brutto', eur(rep.revenue.gross))}${row('Umsatz netto', eur(rep.revenue.net))}${row('Umsatzsteuer', eur(rep.revenue.tax))}${row('Anzahl Bons', rep.bons.toLocaleString('de-DE'))}${row('Durchschnittsbon', eur(rep.avg))}${row('Stornobelege', String(rep.voids))}${row('Korrekturbuchungen aus Vormonaten', String(rep.corrections))}</table>
<h2>Umsatzsteuer</h2><table><tr><th>Steuersatz</th><th class="n">Netto</th><th class="n">Steuer</th><th class="n">Brutto</th><th class="n">Erlöskonto</th></tr>${rep.vat.map((v) => `<tr><td>${v.rate} %</td><td class="n">${esc(eur(v.net))}</td><td class="n">${esc(eur(v.tax))}</td><td class="n">${esc(eur(v.gross))}</td><td class="n">${v.rate === 19 ? A.rev19 : v.rate === 7 ? A.rev7 : A.rev0}</td></tr>`).join('')}<tr class="t"><td>Summe</td><td class="n">${esc(eur(rep.revenue.net))}</td><td class="n">${esc(eur(rep.revenue.tax))}</td><td class="n">${esc(eur(rep.revenue.gross))}</td><td></td></tr></table>
<h2>Zahlungsarten</h2><table><tr><th>Zahlungsart</th><th class="n">Anzahl</th><th class="n">Betrag</th><th class="n">davon Trinkgeld zusätzlich</th></tr>${rep.payments.map((p) => `<tr><td>${esc(METHODS[p.method] || p.method)}</td><td class="n">${p.n}</td><td class="n">${esc(eur(p.amount))}</td><td class="n">${esc(eur(p.tips))}</td></tr>`).join('')}</table>
<h2>Nicht umsatzwirksam</h2><table>${row('Gutscheine verkauft (Mehrzweck, ohne USt.)', eur(rep.other.voucherSold))}${row('Gutscheine eingelöst', eur(rep.other.voucherUsed))}${row('Offene Gutscheinwerte am Monatsende', eur(rep.vouchersOpen))}${row('Anzahlungen erhalten', eur(rep.other.deposits))}${row('Anzahlungen verrechnet', eur(rep.other.depositsUsed))}${row('Ratenzahlungen vereinbart', eur(rep.other.installmentsOpened))}${row('Raten eingegangen', eur(rep.other.installments))}</table>
<h2>Trinkgeld (durchlaufender Posten, Konto ${A.transitory})</h2><table><tr><th>Mitarbeiter</th><th class="n">bar</th><th class="n">Karte</th><th class="n">Summe</th></tr>${rep.tips.map((x) => `<tr><td>${esc(x.name)}</td><td class="n">${esc(eur(x.cash))}</td><td class="n">${esc(eur(x.card))}</td><td class="n">${esc(eur(x.total))}</td></tr>`).join('')}<tr class="t"><td>Summe</td><td></td><td></td><td class="n">${esc(eur(rep.tipsTotal))}</td></tr></table>
<h2>Kassenbuch</h2><table>${row('Anfangsbestand', eur(rep.cash.opening))}${row('Einnahmen bar', eur(rep.cash.cashIn))}${row('Ausgaben bar', eur(-rep.cash.cashOut))}${row('Endbestand', eur(rep.cash.closing), 't')}</table>
<table><tr><th>Datum</th><th>Zeit</th><th>Vorgang</th><th class="n">Einnahme</th><th class="n">Ausgabe</th><th class="n">Bestand</th></tr>${cash}</table>
<h2>Tagesumsätze</h2><table><tr><th>Tag</th><th class="n">Netto</th><th class="n">Steuer</th><th class="n">Brutto</th></tr>${days}</table>
<h2>Kontenzuordnung SKR ${esc(skr)}</h2><table>${Object.entries(ACCOUNT_LABEL).map(([k, l]) => row(l, String(A[k]))).join('')}</table>
</body></html>`;
}

export function readme(month, { skr, sums, files, locked }) {
  const s = P.db.settings.datev || {};
  return [
    `Monatsabschluss ${month} – ${(P.db.settings.business || {}).name || 'BRK Studio'}`,
    '='.repeat(60), '',
    `Status: ${locked ? 'abgeschlossen (gesperrt)' : 'vorläufig – Monat noch nicht abgeschlossen'}`,
    `Beraternummer: ${s.consultant || '–'} · Mandantennummer: ${s.client || '–'} · Kontenrahmen: SKR ${skr}`, '',
    'Inhalt', '------',
    `${files[0]}  DATEV-Format Buchungsstapel (EXTF, Version 700, Kategorie 21, Formatversion 13), Windows-1252, Semikolon.`,
    '   Je Bon: Zahlungsart (Kasse, Geldtransit, Gutschein/Anzahlung, Forderung) an Erlöskonto je Steuersatz.',
    '   Erlöskonten 19 %/7 % sind Automatikkonten, daher kein BU-Schlüssel.',
    '   Trinkgeld getrennt auf Durchlaufende Posten, nicht steuerpflichtig. Kassenbewegungen (Bank, Entnahme, Differenz) eigene Sätze.',
    `${files[1]}  alle Transaktionen positionsgenau, UTF-8 mit BOM, für Excel (Semikolon, Dezimalkomma).`,
    `${files[2]}  Monatsbericht zum Ausdrucken oder als PDF speichern (Umsatz, MwSt., Zahlungsarten, Kassenbuch, Trinkgeld).`, '',
    'Kontrollsummen', '--------------',
    `Umsatz brutto: ${(sums.gross / 100).toFixed(2).replace('.', ',')} EUR (Summe Erlöskonten im Buchungsstapel: ${(sums.datevRevenue / 100).toFixed(2).replace('.', ',')} EUR)`,
    `Umsatzsteuer: ${(sums.tax / 100).toFixed(2).replace('.', ',')} EUR · Trinkgeld: ${(sums.tips / 100).toFixed(2).replace('.', ',')} EUR · Buchungssätze: ${sums.lines}`, '',
    'Wichtig', '-------',
    '* DEMO: Die Kasse ist nicht an eine TSE angeschlossen. Belege sind keine KassenSichV-konformen Kassenbelege.',
    '* Kontenzuordnung und steuerliche Behandlung (Mehrzweck-Gutscheine, Trinkgeld, Ausfallgebühren, Anzahlungen) bitte mit dem Steuerberater abstimmen.',
    '* Kartenumsätze laufen über Geldtransit; der Ausgleich mit der Bankgutschrift erfolgt über den Kontoauszug.',
    '* Der Buchungsstapel ist nicht festgeschrieben (Festschreibung 0); die Festschreibung erfolgt in der Kanzlei.', '',
  ].join('\r\n');
}

/** Baut das ZIP für einen Monat. Rückgabe enthält auch Kontrollsummen (für Anzeige und QA). */
export function monthPackage(month, skr) {
  const s = P.db.settings.datev || {};
  skr = skr || s.skr || '03';
  const { csv, bookings, A } = datevFor(month, skr);
  const rep = monthReport({ txs: P.db.transactions, moves: P.db.cashmoves, month, staffName, vouchers: P.db.vouchers });
  const locked = P.db.closings.some((c) => c.month === month);
  const revAccts = new Set([A.rev19, A.rev7, A.rev0]);
  const sums = { gross: rep.revenue.gross, tax: rep.revenue.tax, tips: rep.tipsTotal, datevRevenue: bookings.filter((b) => revAccts.has(b.gegen)).reduce((x, b) => x + b.amount, 0), lines: bookings.filter((b) => b.amount).length };
  const ym = month.replace('-', '');
  const files = [`EXTF_Buchungsstapel_${ym}_SKR${skr}.csv`, `Transaktionen_${ym}.csv`, `Monatsbericht_${ym}.html`, 'LIESMICH.txt'];
  const txs = P.db.transactions.filter((t) => t.month === month).sort((a, b) => a.no - b.no);
  const zip = makeZip([
    { name: files[0], data: cp1252(csv) },
    { name: files[1], data: utf8bom(txCSV(txs)) },
    { name: files[2], data: utf8(reportHTML(rep, { A, skr, locked })) },
    { name: files[3], data: utf8(readme(month, { skr, sums, files, locked })) },
  ]);
  return { zip, sums, rep, files, A, bookings, name: `Monatsabschluss_${ym}_${((P.db.settings.business || {}).name || 'BRK').replace(/\W+/g, '')}.zip` };
}
export { pct, MOVES };
