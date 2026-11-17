/* Studio-Pult – Kassenbon (Ansicht, Druck, vorbereiteter Versand per E-Mail/SMS) */
import { P, esc, eur, hhmm, dateDE, staffName, clientOf, printOnly } from './kit.js';
import { METHODS, KIND, voidedSet } from '../ledger.js';
import { openDialog } from '../ui.js';

const TSE_NOTE = 'TSE nicht angeschlossen – Demo. Kein gültiger Kassenbeleg nach KassenSichV.';

export function bonHTML(t) {
  const b = P.db.settings.business || {};
  const voided = voidedSet(P.db.transactions).has(t.id);
  const rows = t.lines.map((l) => `<tr><td>${l.qty}&nbsp;×</td><td>${esc(l.name)}${l.discount ? `<small>Rabatt −${esc(eur(Math.abs(l.discount)))}</small>` : ''}<small>${esc(KIND[l.kind])}${l.vat ? ` · ${l.vat}&nbsp;% · ${esc(l.vat === 19 ? 'A' : 'B')}` : ' · ohne USt.'}${l.staffId ? ` · ${esc(staffName(l.staffId))}` : ''}</small></td><td class="num">${esc(eur(l.qty * l.unit - (l.discount || 0)))}</td></tr>`).join('');
  const vat = Object.entries(t.totals.vat).sort((a, c) => c[0] - a[0]).map(([r, s]) => `<tr><td>${r === '19' ? 'A' : r === '7' ? 'B' : 'C'} ${r}&nbsp;%</td><td class="num">${esc(eur(s.net))}</td><td class="num">${esc(eur(s.tax))}</td><td class="num">${esc(eur(s.gross))}</td></tr>`).join('');
  const pays = t.payments.map((p) => `<tr><td>${esc(METHODS[p.method])}${p.ref && p.method === 'voucher' ? ` ${esc(p.ref)}` : ''}</td><td class="num">${esc(eur(p.amount))}</td></tr>`).join('');
  const tips = t.tips.map((x) => `<tr><td>Trinkgeld ${esc(staffName(x.staffId))} (${x.method === 'cash' ? 'bar' : 'Karte'})</td><td class="num">${esc(eur(x.amount))}</td></tr>`).join('');
  const client = t.clientId ? clientOf(t.clientId) : null;
  return `<article class="bon" aria-label="Kassenbon ${t.no}">
    <header class="bon__head">
      <p class="bon__brand">${esc(b.name || 'BRK Studio')}</p>
      <p>${esc(b.street || '')}<br>${esc(b.zip || '')} ${esc(b.city || '')}${b.phone ? `<br>Tel. ${esc(b.phone)}` : ''}</p>
      <p>${b.taxNo ? `St.-Nr. ${esc(b.taxNo)}` : ''}${b.vatId ? `<br>USt-IdNr. ${esc(b.vatId)}` : ''}</p>
    </header>
    ${t.voidOf ? `<p class="bon__flag">STORNO zu Bon ${esc(t.voidOfNo)}</p>` : voided ? '<p class="bon__flag">Dieser Bon wurde storniert</p>' : ''}
    <dl class="bon__meta"><div><dt>Bon-Nr.</dt><dd>${esc(t.no)}</dd></div><div><dt>Datum</dt><dd>${esc(dateDE(t.date))}, ${esc(hhmm(t.time))} Uhr</dd></div><div><dt>Kasse</dt><dd>${esc(b.register || 'Kasse 1')}</dd></div><div><dt>Bedient von</dt><dd>${esc(staffName(t.cashier))}</dd></div>${client ? `<div><dt>Kunde</dt><dd>${esc(client.name)}</dd></div>` : ''}</dl>
    <table class="bon__lines"><tbody>${rows}</tbody></table>
    <p class="bon__total"><span>Summe</span><b>${esc(eur(t.totals.due))}</b></p>
    ${vat ? `<table class="bon__vat"><thead><tr><th>MwSt.</th><th class="num">Netto</th><th class="num">Steuer</th><th class="num">Brutto</th></tr></thead><tbody>${vat}</tbody></table>` : ''}
    <table class="bon__pay"><tbody>${pays}${t.cashGiven ? `<tr><td>Gegeben bar</td><td class="num">${esc(eur(t.cashGiven))}</td></tr><tr><td>Rückgeld</td><td class="num">${esc(eur(t.change))}</td></tr>` : ''}${tips}</tbody></table>
    ${t.tips.length ? '<p class="bon__fine">Trinkgeld geht vollständig an das Team und ist nicht Teil des Umsatzes.</p>' : ''}
    ${t.note ? `<p class="bon__fine">${esc(t.note)}</p>` : ''}
    <dl class="bon__tse"><div><dt>TSE</dt><dd>${TSE_NOTE}</dd></div><div><dt>Transaktion</dt><dd>– (Start ${esc(hhmm(t.time))} · Ende ${esc(hhmm(t.time))})</dd></div><div><dt>Signaturzähler / Prüfwert</dt><dd>–</dd></div></dl>
    <p class="bon__foot">${esc(b.footer || '')}</p>
  </article>`;
}

/** Klartext für E-Mail/SMS – wird nur vorbereitet, der Versand passiert im eigenen Mailprogramm. */
export function bonText(t) {
  const b = P.db.settings.business || {};
  const L = [`${b.name || 'BRK Studio'} · Bon ${t.no} · ${dateDE(t.date)} ${hhmm(t.time)} Uhr`, ''];
  for (const l of t.lines) L.push(`${l.qty} × ${l.name}  ${eur(l.qty * l.unit - (l.discount || 0))}`);
  L.push('', `Summe ${eur(t.totals.due)}`);
  for (const [r, s] of Object.entries(t.totals.vat)) L.push(`MwSt. ${r} %: ${eur(s.tax)} (netto ${eur(s.net)})`);
  for (const p of t.payments) L.push(`${METHODS[p.method]} ${eur(p.amount)}`);
  L.push('', TSE_NOTE);
  return L.join('\n').replace(/\u00a0/g, ' ');
}

export function showBon(t, { onVoid } = {}) {
  const client = t.clientId ? clientOf(t.clientId) : null;
  const text = encodeURIComponent(bonText(t));
  const mail = `mailto:${client && client.email ? encodeURIComponent(client.email) : ''}?subject=${encodeURIComponent(`Dein Beleg ${t.no} – ${(P.db.settings.business || {}).name || 'BRK Studio'}`)}&body=${text}`;
  const sms = `sms:${client && client.phone ? client.phone.replace(/[^\d+]/g, '') : ''}?&body=${text}`;
  const canVoid = onVoid && !t.voidOf && !voidedSet(P.db.transactions).has(t.id) && P.me.role === 'admin';
  const d = openDialog({
    title: `Bon ${t.no}`, wide: true,
    body: `${bonHTML(t)}<p class="fine">E-Mail und SMS öffnen nur dein Mail- bzw. SMS-Programm mit vorbereitetem Text. Es wird nichts automatisch verschickt.</p>`,
    actions: [...(canVoid ? [{ label: 'Stornieren', value: 'void', kind: 'btn-danger' }] : []), { label: 'E-Mail vorbereiten', value: 'mail' }, { label: 'SMS vorbereiten', value: 'sms' }, { label: 'Drucken', value: 'print', kind: 'btn-dark' }],
  });
  d.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    if (b.dataset.act === 'print') { e.preventDefault(); printOnly(bonHTML(t)); }
    if (b.dataset.act === 'mail') { e.preventDefault(); location.href = mail; }
    if (b.dataset.act === 'sms') { e.preventDefault(); location.href = sms; }
    if (b.dataset.act === 'void') { e.preventDefault(); d.close(); onVoid(t); }
  });
  return d;
}
