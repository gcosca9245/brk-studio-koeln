/* Studio-Pult – Transaktionen, Kundenkartei, Gutscheine, Produkte & Lager, Beauty-Pakete, Team-Ergänzungen, Einstellungen */
import { P, esc, eur, pct, int, hhmm, dateDE, staffName, svcOf, clientOf, productOf, head, toolbar, bindToolbar, table, tiles, ensureRange, today, addDays, download, demoNote, euroIn, exampleTag, isAdmin } from './kit.js';
import { inRange, voidedSet, METHODS, voucherState, packageState, installmentState, lineGross, ACCOUNT_LABEL, accountsFor } from '../ledger.js';
import { pult } from '../pult-api.js';
import { toast, openDialog, confirmDialog } from '../ui.js';
import { parseHHMM } from '../util.js';
import { showBon } from './bon.js';
import { kasse } from './kasse.js';
import { txCSV } from './exports.js';
import { staffTable, voucherTable } from './finanzen.js';

const clean = (n) => String(n || '').replace(/^Beispiel · /, '');

/* ---------- Transaktionen ---------- */
const TF = { q: '', method: '', staff: '', only: '' };
export function renderBelege(root) {
  const r = ensureRange();
  const voided = voidedSet(P.db.transactions);
  let rows = P.db.transactions.filter(inRange(r.from, r.to));
  if (P.me.role === 'staff') rows = rows.filter((t) => t.cashier === P.me.staffId || t.lines.some((l) => l.staffId === P.me.staffId));
  const q = TF.q.trim().toLowerCase();
  if (q) rows = rows.filter((t) => String(t.no).includes(q) || (t.clientName || '').toLowerCase().includes(q) || t.lines.some((l) => l.name.toLowerCase().includes(q)));
  if (TF.method) rows = rows.filter((t) => t.payments.some((p) => p.method === TF.method));
  if (TF.staff) rows = rows.filter((t) => t.lines.some((l) => l.staffId === TF.staff));
  if (TF.only === 'void') rows = rows.filter((t) => t.voidOf || voided.has(t.id));
  rows = rows.sort((a, b) => b.no - a.no);
  const shown = rows.slice(0, 400);
  root.innerHTML = `${head('Transaktionen', '', 'Alle Bons. Stornos sind eigene Gegenbelege, nichts wird gelöscht.')}
    ${toolbar({ csv: 'belege', vat: false, extra: '<button type="button" class="btn btn-outline btn-sm" data-tx-csv>CSV aller Positionen</button>' })}
    <div class="filters">
      <label class="sr-only" for="tf-q">Suche</label><input class="input input--search input--sm" id="tf-q" type="search" placeholder="Bon-Nr., Kunde, Position" value="${esc(TF.q)}" data-tf="q">
      <label class="sr-only" for="tf-m">Zahlungsart</label><select class="select select--box select--sm" id="tf-m" data-tf="method"><option value="">Alle Zahlungsarten</option>${Object.entries(METHODS).map(([k, l]) => `<option value="${k}" ${TF.method === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <label class="sr-only" for="tf-s">Mitarbeiter</label><select class="select select--box select--sm" id="tf-s" data-tf="staff"><option value="">Ganzes Team</option>${P.db.staff.map((s) => `<option value="${s.id}" ${TF.staff === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
      <label class="check"><input type="checkbox" data-tf="only" ${TF.only ? 'checked' : ''}> nur Stornos</label>
      <span class="filters__n">${int(rows.length)} Bons${rows.length > shown.length ? ` · die neuesten ${shown.length} angezeigt` : ''}</span>
    </div>
    ${table({ id: 'belege', title: 'Transaktionen', rowAttr: (t) => `data-bon="${t.id}" tabindex="0" class="is-click${t.voidOf || voided.has(t.id) ? ' is-void' : ''}"`, cols: [
      { label: 'Bon', type: 'int', get: (t) => t.no }, { label: 'Datum', type: 'date', get: (t) => t.date }, { label: 'Zeit', type: 'time', get: (t) => t.time },
      { label: 'Kunde', get: (t) => t.clientName }, { label: 'Positionen', get: (t) => t.lines.map((l) => `${l.qty} × ${l.name}`).join(', '), cls: 'cell-clip' },
      { label: 'Mitarbeiter', get: (t) => [...new Set(t.lines.map((l) => staffName(l.staffId)))].join(', ') }, { label: 'Zahlung', get: (t) => t.payments.map((p) => METHODS[p.method]).join(' + ') },
      { label: 'Betrag', type: 'money', get: (t) => t.totals.due, footVal: (f) => f.due }, { label: 'Trinkgeld', type: 'money', get: (t) => t.tips.reduce((s, x) => s + x.amount, 0), footVal: (f) => f.tips },
      { label: 'Status', get: (t) => (t.voidOf ? `Storno zu ${t.voidOfNo}` : voided.has(t.id) ? 'storniert' : 'gültig'), html: (t) => `<span class="status status--${t.voidOf ? 'pending' : voided.has(t.id) ? 'rejected' : 'approved'}">${t.voidOf ? `Storno zu ${esc(t.voidOfNo)}` : voided.has(t.id) ? 'storniert' : 'gültig'}</span>` },
    ], rows: shown, foot: { label: `Summe ${int(rows.length)} Bons`, due: rows.reduce((s, t) => s + t.totals.due, 0), tips: rows.reduce((s, t) => s + t.tips.reduce((a, x) => a + x.amount, 0), 0) } })}`;
  bindToolbar(root, () => renderBelege(root));
  if (!root._bb) {
    root._bb = true;
    const open = (el) => { const t = P.db.transactions.find((x) => x.id === el.dataset.bon); if (t) showBon(t, { onVoid: (b) => voidDialog(b, () => renderBelege(root)) }); };
    root.addEventListener('click', (e) => { const tr = e.target.closest('[data-bon]'); if (tr) open(tr); if (e.target.closest('[data-tx-csv]')) { const rr = ensureRange(); download(`transaktionen_${rr.from}_${rr.to}.csv`, new Blob(['\uFEFF', txCSV(P.db.transactions.filter(inRange(rr.from, rr.to)).sort((a, b) => a.no - b.no))], { type: 'text/csv;charset=utf-8' })); } });
    root.addEventListener('keydown', (e) => { const tr = e.target.closest('[data-bon]'); if (tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(tr); } });
    root.addEventListener('input', (e) => { if (e.target.dataset.tf === 'q') { TF.q = e.target.value; clearTimeout(root._t); root._t = setTimeout(() => { renderBelege(root); const i = root.querySelector('#tf-q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250); } });
    root.addEventListener('change', (e) => { const k = e.target.dataset.tf; if (k && k !== 'q') { TF[k] = k === 'only' ? (e.target.checked ? 'void' : '') : e.target.value; renderBelege(root); } });
  }
}
export function voidDialog(t, after) {
  const d = openDialog({ title: `Bon ${t.no} stornieren`, body: `<p class="dlg__text">Es entsteht ein Gegenbeleg über ${esc(eur(-t.totals.due))} mit heutigem Datum. Produkte gehen zurück ins Lager, Gutscheine und Pakete aus diesem Bon werden ungültig.</p><div class="field"><label class="label" for="vd-r">Grund</label><input class="input" id="vd-r" name="reason" maxlength="120" placeholder="z. B. falsche Leistung gewählt"></div>`, actions: [{ label: 'Abbrechen', value: 'cancel' }, { label: 'Storno buchen', value: 'ok', kind: 'btn-danger' }] });
  d.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]'); if (!b || b.dataset.act !== 'ok') return; e.preventDefault();
    try { const r = await pult.voidBon(t.id, d.querySelector('form').elements.reason.value); d.close(); await P.refresh(); toast(`Storno gebucht: Bon ${r.no}.`); after(); } catch (x) { d.error(x.message); }
  });
}

/* ---------- Kundenkartei ---------- */
const KF = { q: '', sort: 'last', open: null, tab: 'termine' };
function clientStats() {
  const m = new Map();
  for (const c of P.db.clients) m.set(c.id, { visits: 0, revenue: 0, last: '', first: '' });
  const v = voidedSet(P.db.transactions);
  for (const t of P.db.transactions) { if (!t.clientId || !m.has(t.clientId) || t.voidOf || v.has(t.id)) continue; const o = m.get(t.clientId); o.visits += t.lines.some((l) => l.kind === 'service' || l.kind === 'package_use') ? 1 : 0; o.revenue += t.totals.revenue; if (t.date > o.last) o.last = t.date; if (!o.first || t.date < o.first) o.first = t.date; }
  const plans = installmentState(P.db.installments, P.db.transactions, today());
  for (const p of plans) if (m.has(p.clientId)) m.get(p.clientId).open = (m.get(p.clientId).open || 0) + p.open;
  return m;
}
export function renderKunden(root) {
  if (KF.open) { renderKunde(root, KF.open); return; }
  const st = clientStats();
  const q = KF.q.trim().toLowerCase();
  let rows = P.db.clients.filter((c) => !q || `${c.name} ${c.phone} ${c.email}`.toLowerCase().includes(q)).map((c) => ({ ...c, ...st.get(c.id) }));
  rows.sort(KF.sort === 'name' ? (a, b) => a.name.localeCompare(b.name, 'de') : KF.sort === 'revenue' ? (a, b) => b.revenue - a.revenue : (a, b) => (a.last < b.last ? 1 : -1));
  root.innerHTML = `${head('Kundenkartei', '<button type="button" class="btn btn-dark btn-sm" data-new-client>Kunde anlegen</button>', `${int(P.db.clients.length)} Kunden · Online-Konten werden automatisch übernommen`)}
    <div class="filters">
      <label class="sr-only" for="kf-q">Suche</label><input class="input input--search input--sm" id="kf-q" type="search" placeholder="Name, Telefon oder E-Mail" value="${esc(KF.q)}" data-kf-q autocomplete="off">
      <label class="sr-only" for="kf-s">Sortierung</label><select class="select select--box select--sm" id="kf-s" data-kf-sort>${[['last', 'Letzter Besuch'], ['name', 'Name'], ['revenue', 'Umsatz']].map(([k, l]) => `<option value="${k}" ${KF.sort === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <button type="button" class="btn btn-outline btn-sm" data-csv="kunden">CSV</button>
    </div>
    ${table({ id: 'kunden', title: 'Kunden', rowAttr: (c) => `data-client="${c.id}" tabindex="0" class="is-click"`, cols: [
      { label: 'Name', get: (c) => c.name, html: (c) => `<b>${esc(c.name)}</b>${exampleTag(c)}${c.userId ? '<span class="tag tag--line">Online-Konto</span>' : ''}${(c.tags || []).filter((t) => t !== 'Online-Konto').map((t) => `<span class="tag tag--line">${esc(t)}</span>`).join('')}` },
      { label: 'Telefon', get: (c) => c.phone }, { label: 'E-Mail', get: (c) => c.email },
      { label: 'Letzter Besuch', type: 'date', get: (c) => c.last || null }, { label: 'Besuche', type: 'int', get: (c) => c.visits }, { label: 'Umsatz', type: 'money', get: (c) => c.revenue },
      { label: 'Offen', type: 'money', get: (c) => c.open || 0, html: (c) => (c.open ? `<b class="is-due">${esc(eur(c.open))}</b>` : '–') },
    ], rows, empty: 'Keine Kunden gefunden.' })}`;
  if (!root._kb) {
    root._kb = true;
    root.addEventListener('click', (e) => {
      const tr = e.target.closest('[data-client]'); if (tr && !KF.open) { KF.open = tr.dataset.client; KF.tab = 'termine'; renderKunden(root); root.querySelector('h1').focus(); return; }
      if (e.target.closest('[data-new-client]')) clientDialog({}, root);
      if (e.target.closest('[data-csv="kunden"]')) import('./kit.js').then((k) => k.exportCSV('kunden'));
    });
    root.addEventListener('keydown', (e) => { const tr = e.target.closest('[data-client]'); if (tr && e.key === 'Enter' && !KF.open) { KF.open = tr.dataset.client; renderKunden(root); } });
    root.addEventListener('input', (e) => { if (e.target.matches('[data-kf-q]')) { KF.q = e.target.value; clearTimeout(root._t); root._t = setTimeout(() => { renderKunden(root); const i = root.querySelector('#kf-q'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 200); } });
    root.addEventListener('change', (e) => { if (e.target.matches('[data-kf-sort]')) { KF.sort = e.target.value; renderKunden(root); } });
  }
}
function renderKunde(root, id) {
  const c = clientOf(id); if (!c) { KF.open = null; renderKunden(root); return; }
  const st = clientStats().get(id);
  const appts = P.db.appointments.filter((a) => a.clientId === id || (c.userId && a.customerId === c.userId) || clean(a.name) === c.name).sort((a, b) => (a.date === b.date ? b.start - a.start : a.date < b.date ? 1 : -1));
  const txs = P.db.transactions.filter((t) => t.clientId === id).sort((a, b) => b.no - a.no);
  const prods = txs.flatMap((t) => t.lines.filter((l) => l.kind === 'product').map((l) => ({ ...l, date: t.date, no: t.no, void: !!t.voidOf })));
  const vs = voucherState(P.db.vouchers.filter((v) => v.clientId === id), P.db.transactions, today());
  const cards = packageState(P.db.packageCards.filter((p) => p.clientId === id), P.db.transactions);
  const plans = installmentState(P.db.installments.filter((p) => p.clientId === id), P.db.transactions, today());
  const open = plans.reduce((s, p) => s + p.open, 0);
  const T = [['termine', `Termine (${appts.length})`], ['kaeufe', `Käufe (${txs.length})`], ['produkte', `Produkte (${prods.length})`], ['guthaben', 'Guthaben & Raten']];
  let pane = '';
  if (KF.tab === 'termine') pane = table({ id: 'k-termine', title: `Termine ${c.name}`, cols: [{ label: 'Datum', type: 'date', get: (a) => a.date }, { label: 'Zeit', type: 'time', get: (a) => a.start }, { label: 'Leistung', get: (a) => (svcOf(a.serviceId) || {}).name }, { label: 'Bei', get: (a) => staffName(a.staffId) }, { label: 'Quelle', get: (a) => (a.source === 'customer' ? 'online' : 'Studio') }, { label: 'Status', get: (a) => (a.status === 'cancelled' ? 'storniert' : a.status === 'noshow' ? 'nicht erschienen' : a.paidBonId ? 'bezahlt' : a.date >= today() ? 'geplant' : 'offen') }], rows: appts, empty: 'Keine Termine.' });
  if (KF.tab === 'kaeufe') pane = table({ id: 'k-kaeufe', title: `Käufe ${c.name}`, rowAttr: (t) => `data-bon="${t.id}" tabindex="0" class="is-click"`, cols: [{ label: 'Bon', type: 'int', get: (t) => t.no }, { label: 'Datum', type: 'date', get: (t) => t.date }, { label: 'Positionen', get: (t) => t.lines.map((l) => l.name).join(', '), cls: 'cell-clip' }, { label: 'Zahlung', get: (t) => t.payments.map((p) => METHODS[p.method]).join(' + ') }, { label: 'Betrag', type: 'money', get: (t) => t.totals.due }], rows: txs, empty: 'Noch keine Käufe.' });
  if (KF.tab === 'produkte') pane = table({ id: 'k-prod', title: `Produkte ${c.name}`, cols: [{ label: 'Datum', type: 'date', get: (l) => l.date }, { label: 'Produkt', get: (l) => l.name }, { label: 'Menge', type: 'int', get: (l) => l.qty }, { label: 'Betrag', type: 'money', get: (l) => lineGross(l) }, { label: 'Bon', type: 'int', get: (l) => l.no }], rows: prods, empty: 'Noch keine Produkte gekauft.' });
  if (KF.tab === 'guthaben') pane = `<h2 class="h-sub">Ratenzahlungen</h2>${plans.length ? plans.map((p) => `<div class="plan"><p><b>${esc(p.note || 'Ratenzahlung')}</b> · gesamt ${esc(eur(p.total))} · offen <b>${esc(eur(p.open))}</b>${p.open ? ` <button type="button" class="btn btn-outline btn-sm" data-rate="${p.id}">Rate kassieren</button>` : ''}</p><ul class="rates">${p.schedule.map((s) => `<li class="${s.open === 0 ? 'is-paid' : s.overdue ? 'is-overdue' : ''}"><span>${esc(dateDE(s.due))}</span><span class="num">${esc(eur(s.amount))}</span><span>${s.open === 0 ? 'bezahlt' : s.overdue ? 'überfällig' : 'offen'}</span></li>`).join('')}</ul></div>`).join('') : '<p class="empty empty--sm">Keine Ratenzahlungen.</p>'}
    <h2 class="h-sub">Beauty-Pakete</h2>${cards.length ? `<ul class="mini-list">${cards.map((k) => `<li><span>${esc(dateDE(k.date))}</span><span>${esc(k.name)}<small>${k.items.map((i) => `${esc((svcOf(i.serviceId) || {}).name || '')}: noch ${i.left} von ${i.total}`).join(' · ')} · gültig bis ${esc(dateDE(k.expires))}</small></span>${k.cancelled ? '<span class="status status--rejected">storniert</span>' : ''}</li>`).join('')}</ul>` : '<p class="empty empty--sm">Keine Pakete.</p>'}
    <h2 class="h-sub">Gekaufte Gutscheine</h2>${vs.length ? voucherTable(vs, 'k-vouch') : '<p class="empty empty--sm">Keine Gutscheine.</p>'}`;
  root.innerHTML = `<header class="panel-head"><div><button type="button" class="back" data-back>Alle Kunden</button><h1 class="panel-title" tabindex="-1">${esc(c.name)}</h1><p class="panel-sub">${exampleTag(c)}${c.userId ? '<span class="tag tag--line">Online-Konto</span> ' : ''}Kunde seit ${esc(dateDE((st.first || c.createdAt || '').slice(0, 10)))}</p></div>
    <div class="panel-head__tools"><button type="button" class="btn btn-outline btn-sm" data-edit-client>Bearbeiten</button><button type="button" class="btn btn-dark btn-sm" data-sell-voucher>Gutschein verkaufen</button></div></header>
    <div class="client">
      <aside class="client__card">
        <dl class="facts facts--stack">
          <div><dt>Telefon</dt><dd>${c.phone ? `<a href="tel:${esc(c.phone.replace(/[^\d+]/g, ''))}">${esc(c.phone)}</a>` : '–'}</dd></div>
          <div><dt>E-Mail</dt><dd>${c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : '–'}</dd></div>
          <div><dt>Geburtstag</dt><dd>${c.birthday ? esc(dateDE(c.birthday)) : '–'}</dd></div>
          <div><dt>Vorlieben</dt><dd class="pre">${esc(c.prefs || '–')}</dd></div>
          <div><dt>Notizen</dt><dd class="pre">${esc(c.notes || '–')}</dd></div>
          <div><dt>Einwilligung</dt><dd>E-Mail ${c.consent && c.consent.email ? 'ja' : 'nein'} · SMS ${c.consent && c.consent.sms ? 'ja' : 'nein'}</dd></div>
        </dl>
      </aside>
      <section class="client__main">
        ${tiles([{ label: 'Besuche', value: int(st.visits) }, { label: 'Umsatz gesamt', value: esc(eur(st.revenue)) }, { label: 'Letzter Besuch', value: st.last ? esc(dateDE(st.last)) : '–' }, { label: 'Offene Beträge', value: esc(eur(open)), trend: open ? -1 : 0, sub: open ? 'aus Ratenzahlung' : 'nichts offen', accent: !!open }])}
        <div class="tabs" role="tablist" aria-label="Kundendetails">${T.map(([k, l]) => `<button type="button" role="tab" data-ctab="${k}" aria-selected="${KF.tab === k}">${l}</button>`).join('')}</div>
        ${pane}
      </section>
    </div>`;
  root.querySelector('[data-back]').onclick = () => { KF.open = null; renderKunden(root); };
  root.querySelector('[data-edit-client]').onclick = () => clientDialog(c, root);
  root.querySelector('[data-sell-voucher]').onclick = () => { kasse.voucher(5000, c.id); P.nav('kasse'); };
  root.querySelectorAll('[data-ctab]').forEach((b) => { b.onclick = () => { KF.tab = b.dataset.ctab; renderKunde(root, id); }; });
  root.querySelectorAll('[data-rate]').forEach((b) => { b.onclick = () => { kasse.installment(b.dataset.rate); P.nav('kasse'); }; });
  root.querySelectorAll('tr[data-bon]').forEach((tr) => { tr.onclick = () => showBon(P.db.transactions.find((x) => x.id === tr.dataset.bon)); });
}
function clientDialog(c, root) {
  const d = openDialog({ title: c.id ? c.name : 'Neuer Kunde', wide: true, body: `<div class="grid2">
    <div class="field span2"><label class="label" for="cl-n">Name</label><input class="input" id="cl-n" name="name" value="${esc(c.name || '')}" autocomplete="off" maxlength="80"></div>
    <div class="field"><label class="label" for="cl-p">Telefon</label><input class="input" id="cl-p" name="phone" type="tel" value="${esc(c.phone || '')}" autocomplete="off"></div>
    <div class="field"><label class="label" for="cl-e">E-Mail</label><input class="input" id="cl-e" name="email" type="email" value="${esc(c.email || '')}" autocomplete="off" spellcheck="false"></div>
    <div class="field"><label class="label" for="cl-b">Geburtstag <span class="label__hint">optional</span></label><input class="input" id="cl-b" name="birthday" type="date" value="${esc(c.birthday || '')}"></div>
    <div class="field"><label class="label" for="cl-t">Merkmale <span class="label__hint">mit Komma</span></label><input class="input" id="cl-t" name="tags" value="${esc((c.tags || []).join(', '))}" maxlength="120"></div>
    <div class="field span2"><label class="label" for="cl-pr">Vorlieben</label><textarea class="input" id="cl-pr" name="prefs" rows="2" maxlength="500">${esc(c.prefs || '')}</textarea></div>
    <div class="field span2"><label class="label" for="cl-no">Notizen <span class="label__hint">nur intern</span></label><textarea class="input" id="cl-no" name="notes" rows="3" maxlength="1000">${esc(c.notes || '')}</textarea></div>
    <label class="check"><input type="checkbox" name="cemail" ${c.consent && c.consent.email ? 'checked' : ''}> E-Mail-Erinnerungen erlaubt</label>
    <label class="check"><input type="checkbox" name="csms" ${c.consent && c.consent.sms ? 'checked' : ''}> SMS erlaubt</label>
  </div>`, actions: [{ label: 'Abbrechen', value: 'cancel' }, { label: 'Speichern', value: 'ok', kind: 'btn-dark' }] });
  d.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]'); if (!b || b.dataset.act !== 'ok') return; e.preventDefault();
    const f = d.querySelector('form').elements;
    try { const r = await pult.saveClient({ id: c.id, name: f.name.value, phone: f.phone.value, email: f.email.value, birthday: f.birthday.value, prefs: f.prefs.value, notes: f.notes.value, tags: f.tags.value.split(','), consent: { email: f.cemail.checked, sms: f.csms.checked } }); d.close(); await P.refresh(); KF.open = r.id; toast('Gespeichert.'); renderKunden(root); } catch (x) { d.error(x.message); }
  });
}

/* ---------- Gutscheine ---------- */
let GF = 'offen';
export function renderGutscheine(root) {
  const vs = voucherState(P.db.vouchers, P.db.transactions, today()).sort((a, b) => (a.issuedAt < b.issuedAt ? 1 : -1));
  const rows = vs.filter((v) => (GF === 'offen' ? v.remaining > 0 && v.status !== 'abgelaufen' : GF === 'eingeloest' ? v.status === 'eingelöst' : GF === 'abgelaufen' ? v.status === 'abgelaufen' || v.status === 'storniert' : true));
  const open = vs.filter((v) => v.remaining > 0 && v.status !== 'abgelaufen');
  root.innerHTML = `${head('Gutscheine', '<button type="button" class="btn btn-dark btn-sm" data-sell>Gutschein verkaufen</button>', 'Verkauf an der Kasse, Einlösung per Code mit Restwert.')}
    ${tiles([{ label: 'Offene Gutscheine', value: int(open.length) }, { label: 'Offener Wert', value: esc(eur(open.reduce((s, v) => s + v.remaining, 0))), accent: true, sub: 'Verbindlichkeit' }, { label: 'Verkauft gesamt', value: esc(eur(vs.filter((v) => v.status !== 'storniert').reduce((s, v) => s + v.value, 0))) }, { label: 'Eingelöst gesamt', value: esc(eur(vs.reduce((s, v) => s + v.used, 0))) }])}
    <div class="check-code"><label class="label" for="gc">Code prüfen</label><div class="check-code__row"><input class="input input--sm" id="gc" data-code placeholder="BRK-XXXX-XX" autocomplete="off" spellcheck="false"><button type="button" class="btn btn-outline btn-sm" data-check>Prüfen</button></div><p class="check-code__out" data-code-out aria-live="polite"></p></div>
    <div class="filters">${[['offen', 'Offen'], ['eingeloest', 'Eingelöst'], ['abgelaufen', 'Abgelaufen / storniert'], ['alle', 'Alle']].map(([k, l]) => `<button type="button" class="chip" data-gf="${k}" aria-pressed="${GF === k}">${l}</button>`).join('')}<button type="button" class="btn btn-outline btn-sm" data-csv="vouch">CSV</button></div>
    ${voucherTable(rows, 'vouch')}
    <section class="card card--flat"><h2 class="h-sub">Online-Verkauf <span class="stamp">vorbereitet · inaktiv</span></h2><p class="fine">Gutscheine sollen später auf der Website per Stripe Checkout verkauft werden: Die Edge Function erzeugt den Code serverseitig und verschickt ihn nach erfolgreicher Zahlung. In der Demo ist das abgeschaltet.</p></section>`;
  root.querySelector('[data-sell]').onclick = () => { kasse.voucher(5000); P.nav('kasse'); };
  root.querySelectorAll('[data-gf]').forEach((b) => { b.onclick = () => { GF = b.dataset.gf; renderGutscheine(root); }; });
  root.querySelector('[data-csv="vouch"]').onclick = () => import('./kit.js').then((k) => k.exportCSV('vouch'));
  const check = () => { const code = root.querySelector('[data-code]').value.toUpperCase().trim(); const v = vs.find((x) => x.code === code); root.querySelector('[data-code-out]').textContent = !code ? '' : v ? `${v.code}: Restwert ${eur(v.remaining)} von ${eur(v.value)} · ${v.status} · gültig bis ${dateDE(v.expires)}` : 'Dieser Code ist unbekannt.'; };
  root.querySelector('[data-check]').onclick = check;
  root.querySelector('[data-code]').onkeydown = (e) => { if (e.key === 'Enter') check(); };
}

/* ---------- Produkte & Lager ---------- */
let PT = 'bestand';
export function renderProdukte(root) {
  const prods = [...P.db.products].sort((a, b) => a.order - b.order);
  const value = prods.reduce((s, p) => s + Math.max(0, p.stock) * p.cost, 0);
  const low = prods.filter((p) => p.active !== false && p.stock <= p.minStock);
  let body = '';
  if (PT === 'bestand') body = `${table({ id: 'lager', title: 'Lagerbestand', rowAttr: (p) => `data-prod="${p.id}" class="is-click${p.stock <= p.minStock ? ' is-warn' : ''}" tabindex="0"`, cols: [
    { label: 'Produkt', get: (p) => p.name, html: (p) => `<b>${esc(p.name)}</b>${exampleTag(p)}<small class="cell-sub">${esc(p.sku || '')} · ${esc(p.cat)}${p.active === false ? ' · inaktiv' : ''}</small>` },
    { label: 'VK brutto', type: 'money', get: (p) => p.price, footVal: () => null }, { label: 'MwSt.', get: (p) => `${p.vat} %`, footVal: () => null }, { label: 'EK netto', type: 'money', get: (p) => p.cost, footVal: () => null },
    { label: 'Marge', type: 'pct', get: (p) => { const net = Math.round((p.price * 100) / (100 + p.vat)); return net ? (net - p.cost) / net : 0; }, footVal: () => null },
    { label: 'Bestand', type: 'int', get: (p) => p.stock, html: (p) => `<b class="${p.stock <= p.minStock ? 'is-due' : ''}">${int(p.stock)}</b>`, footVal: (f) => f.stock }, { label: 'Mindestbestand', type: 'int', get: (p) => p.minStock, footVal: () => null },
    { label: 'Warenwert (EK)', type: 'money', get: (p) => Math.max(0, p.stock) * p.cost, footVal: (f) => f.value },
    { label: 'Status', get: (p) => (p.stock <= 0 ? 'ausverkauft' : p.stock <= p.minStock ? 'nachbestellen' : 'ok'), html: (p) => `<span class="status status--${p.stock <= 0 ? 'rejected' : p.stock <= p.minStock ? 'pending' : 'approved'}">${p.stock <= 0 ? 'ausverkauft' : p.stock <= p.minStock ? 'nachbestellen' : 'ok'}</span>` },
  ], rows: prods, foot: { label: 'Summe', stock: prods.reduce((s, p) => s + Math.max(0, p.stock), 0), value } })}`;
  if (PT === 'bewegungen') {
    const r = ensureRange();
    const mv = P.db.stockmoves.filter(inRange(r.from, r.to)).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 500);
    const K = { in: 'Wareneingang', out: 'Warenausgang', sale: 'Verkauf', void: 'Storno', count: 'Inventur' };
    body = `${toolbar({ csv: 'moves', vat: false })}${table({ id: 'moves', title: 'Lagerbewegungen', cols: [{ label: 'Datum', type: 'date', get: (m) => m.date }, { label: 'Produkt', get: (m) => (productOf(m.productId) || {}).name }, { label: 'Art', get: (m) => K[m.kind] || m.kind }, { label: 'Menge', type: 'int', get: (m) => m.qty, html: (m) => `<span class="num">${m.qty > 0 ? '+' : ''}${int(m.qty)}</span>` }, { label: 'EK netto', type: 'money', get: (m) => m.cost }, { label: 'Vermerk', get: (m) => m.note }], rows: mv })}`;
  }
  if (PT === 'inventur') body = `<form data-inv class="inv"><p class="fine">Gezählte Mengen eintragen. Leere Felder bleiben unverändert, Abweichungen werden als Inventurbuchung gespeichert.</p>
    ${table({ id: 'inv', title: 'Inventur', cols: [{ label: 'Produkt', get: (p) => p.name }, { label: 'Soll', type: 'int', get: (p) => p.stock }, { label: 'Gezählt', noExport: true, get: () => '', html: (p) => `<input class="input input--sm num" type="number" min="0" name="c_${p.id}" aria-label="Gezählt ${esc(p.name)}" placeholder="${p.stock}">` }], rows: prods })}
    <div class="row-actions"><button type="submit" class="btn btn-dark btn-sm">Inventur buchen</button></div></form>`;
  root.innerHTML = `${head('Produkte & Lager', `<button type="button" class="btn btn-outline btn-sm" data-move="in">Wareneingang</button><button type="button" class="btn btn-outline btn-sm" data-move="out">Warenausgang</button><button type="button" class="btn btn-dark btn-sm" data-new-prod>Produkt anlegen</button>`)}
    ${tiles([{ label: 'Artikel', value: int(prods.length) }, { label: 'Warenwert (EK netto)', value: esc(eur(value)), accent: true }, { label: 'Unter Mindestbestand', value: int(low.length), trend: low.length ? -1 : 0, sub: low.length ? esc(low.map((p) => p.name).join(', ')) : 'alles ausreichend' }, { label: 'Verkaufswert (VK)', value: esc(eur(prods.reduce((s, p) => s + Math.max(0, p.stock) * p.price, 0))) }])}
    ${low.length ? `<p class="warn-line" role="status"><b>Nachbestellen:</b> ${low.map((p) => `${esc(p.name)} (${p.stock}/${p.minStock})`).join(' · ')}</p>` : ''}
    <div class="tabs" role="tablist" aria-label="Lager">${[['bestand', 'Bestand'], ['bewegungen', 'Bewegungen'], ['inventur', 'Inventur']].map(([k, l]) => `<button type="button" role="tab" data-pt="${k}" aria-selected="${PT === k}">${l}</button>`).join('')}</div>
    ${body}`;
  if (PT === 'bewegungen') bindToolbar(root, () => renderProdukte(root));
  root.querySelectorAll('[data-pt]').forEach((b) => { b.onclick = () => { PT = b.dataset.pt; renderProdukte(root); }; });
  root.querySelector('[data-new-prod]').onclick = () => productDialog({ vat: 19, minStock: 3, cat: 'Styling', active: true }, root);
  root.querySelectorAll('[data-move]').forEach((b) => { b.onclick = () => moveDialog(b.dataset.move, root); });
  root.querySelectorAll('tr[data-prod]').forEach((tr) => { tr.onclick = () => productDialog(productOf(tr.dataset.prod), root); });
  const inv = root.querySelector('[data-inv]');
  if (inv) inv.onsubmit = async (e) => { e.preventDefault(); const counts = {}; for (const p of prods) counts[p.id] = inv.elements[`c_${p.id}`].value; try { const n = await pult.inventory(counts); await P.refresh(); toast(n ? `${n} Bestände korrigiert.` : 'Alles stimmt.'); PT = 'bestand'; renderProdukte(root); } catch (x) { toast(x.message, 'is-error'); } };
}
function productDialog(p, root) {
  const d = openDialog({ title: p.id ? p.name : 'Neues Produkt', wide: true, body: `<div class="grid2">
    <div class="field span2"><label class="label" for="pd-n">Name</label><input class="input" id="pd-n" name="name" value="${esc(p.name || '')}" maxlength="80"></div>
    <div class="field"><label class="label" for="pd-c">Kategorie</label><input class="input" id="pd-c" name="cat" value="${esc(p.cat || '')}" list="pd-cats" maxlength="40"><datalist id="pd-cats">${[...new Set(P.db.products.map((x) => x.cat))].map((c) => `<option value="${esc(c)}">`).join('')}</datalist></div>
    <div class="field"><label class="label" for="pd-s">Artikelnummer</label><input class="input" id="pd-s" name="sku" value="${esc(p.sku || '')}" maxlength="24"></div>
    <div class="field"><label class="label" for="pd-p">Verkaufspreis brutto €</label><input class="input num" id="pd-p" name="price" inputmode="decimal" value="${euroIn(p.price)}"></div>
    <div class="field"><label class="label" for="pd-v">MwSt.</label><select class="input select" id="pd-v" name="vat"><option value="19" ${p.vat !== 7 ? 'selected' : ''}>19 %</option><option value="7" ${p.vat === 7 ? 'selected' : ''}>7 %</option></select></div>
    <div class="field"><label class="label" for="pd-e">Einkaufspreis netto €</label><input class="input num" id="pd-e" name="cost" inputmode="decimal" value="${euroIn(p.cost)}"></div>
    <div class="field"><label class="label" for="pd-m">Mindestbestand</label><input class="input num" id="pd-m" name="minStock" type="number" min="0" value="${p.minStock ?? 3}"></div>
    <label class="check span2"><input type="checkbox" name="active" ${p.active !== false ? 'checked' : ''}> Im Verkauf (an der Kasse sichtbar)</label>
    ${p.id ? `<p class="fine span2">Bestand ${int(p.stock)} · Änderungen am Bestand nur über Wareneingang, Warenausgang oder Inventur.</p>` : ''}
  </div>`, actions: [{ label: 'Abbrechen', value: 'cancel' }, { label: 'Speichern', value: 'ok', kind: 'btn-dark' }] });
  d.addEventListener('click', async (e) => { const b = e.target.closest('[data-act]'); if (!b || b.dataset.act !== 'ok') return; e.preventDefault(); const f = d.querySelector('form').elements; try { await pult.saveProduct({ id: p.id, name: f.name.value, cat: f.cat.value, sku: f.sku.value, price: f.price.value, cost: f.cost.value, vat: f.vat.value, minStock: f.minStock.value, active: f.active.checked }); d.close(); await P.refresh(); toast('Gespeichert.'); renderProdukte(root); } catch (x) { d.error(x.message); } });
}
function moveDialog(kind, root) {
  const d = openDialog({ title: kind === 'in' ? 'Wareneingang' : 'Warenausgang', body: `<div class="grid2">
    <div class="field span2"><label class="label" for="mv-p">Produkt</label><select class="input select" id="mv-p" name="productId">${P.db.products.map((p) => `<option value="${p.id}">${esc(p.name)} · Bestand ${p.stock}</option>`).join('')}</select></div>
    <div class="field"><label class="label" for="mv-q">Menge</label><input class="input num" id="mv-q" name="qty" type="number" min="1" value="${kind === 'in' ? 6 : 1}"></div>
    ${kind === 'in' ? '<div class="field"><label class="label" for="mv-c">EK netto € <span class="label__hint">leer = bisher</span></label><input class="input num" id="mv-c" name="cost" inputmode="decimal"></div>' : '<div class="field"><label class="label" for="mv-r">Grund</label><select class="input select" id="mv-r" name="reason"><option>Eigenverbrauch Salon</option><option>Bruch / beschädigt</option><option>Abgelaufen</option><option>Rückgabe an Lieferant</option></select></div>'}
    <div class="field span2"><label class="label" for="mv-n">Vermerk</label><input class="input" id="mv-n" name="note" maxlength="80" value="${kind === 'in' ? 'Lieferung' : ''}"></div></div>`, actions: [{ label: 'Abbrechen', value: 'cancel' }, { label: 'Buchen', value: 'ok', kind: 'btn-dark' }] });
  d.addEventListener('click', async (e) => { const b = e.target.closest('[data-act]'); if (!b || b.dataset.act !== 'ok') return; e.preventDefault(); const f = d.querySelector('form').elements; try { await pult.stockMove({ productId: f.productId.value, qty: f.qty.value, kind, cost: f.cost ? f.cost.value : null, note: kind === 'out' ? `${f.reason.value}${f.note.value ? ` · ${f.note.value}` : ''}` : f.note.value }); d.close(); await P.refresh(); toast('Gebucht.'); renderProdukte(root); } catch (x) { d.error(x.message); } });
}

/* ---------- Beauty-Pakete ---------- */
export function renderPakete(root) {
  const cards = packageState(P.db.packageCards, P.db.transactions);
  root.innerHTML = `${head('Beauty-Pakete', '<button type="button" class="btn btn-dark btn-sm" data-new-pkg>Paket anlegen</button>', 'Mehrere Leistungen zum Paketpreis. Verkauf und Einlösung an der Kasse.')}
    ${table({ id: 'pakete', title: 'Beauty-Pakete', rowAttr: (p) => `data-pkg="${p.id}" class="is-click" tabindex="0"`, cols: [
      { label: 'Paket', get: (p) => p.name, html: (p) => `<b>${esc(p.name)}</b>${exampleTag(p)}<small class="cell-sub">${p.items.map((i) => `${i.count} × ${esc((svcOf(i.serviceId) || {}).name || '')}`).join(', ')}</small>` },
      { label: 'Einzelpreis', type: 'money', get: (p) => p.items.reduce((s, i) => s + i.count * ((svcOf(i.serviceId) || {}).price || 0), 0) }, { label: 'Paketpreis', type: 'money', get: (p) => p.price },
      { label: 'Ersparnis', type: 'pct', get: (p) => { const e = p.items.reduce((s, i) => s + i.count * ((svcOf(i.serviceId) || {}).price || 0), 0); return e ? (e - p.price) / e : 0; } },
      { label: 'Gültig', get: (p) => `${p.validMonths} Monate` }, { label: 'Verkauft', type: 'int', get: (p) => cards.filter((c) => c.packageId === p.id && !c.cancelled).length },
      { label: 'Offene Einheiten', type: 'int', get: (p) => cards.filter((c) => c.packageId === p.id && !c.cancelled).reduce((s, c) => s + c.left, 0) },
      { label: 'Status', get: (p) => (p.active !== false ? 'aktiv' : 'inaktiv') },
    ], rows: P.db.packages, empty: 'Noch keine Pakete.' })}`;
  root.querySelector('[data-new-pkg]').onclick = () => packageDialog({ items: [], validMonths: 12, active: true }, root);
  root.querySelectorAll('tr[data-pkg]').forEach((tr) => { tr.onclick = () => packageDialog(P.db.packages.find((p) => p.id === tr.dataset.pkg), root); });
}
function packageDialog(p, root) {
  const cnt = (id) => (p.items.find((i) => i.serviceId === id) || {}).count || 0;
  const d = openDialog({ title: p.id ? p.name : 'Neues Paket', wide: true, body: `<div class="grid2">
    <div class="field span2"><label class="label" for="pk-n">Name</label><input class="input" id="pk-n" name="name" value="${esc(p.name || '')}" maxlength="80"></div>
    <div class="field"><label class="label" for="pk-p">Paketpreis brutto €</label><input class="input num" id="pk-p" name="price" inputmode="decimal" value="${euroIn(p.price)}"></div>
    <div class="field"><label class="label" for="pk-v">Gültig (Monate)</label><input class="input num" id="pk-v" name="validMonths" type="number" min="1" max="36" value="${p.validMonths}"></div></div>
    <p class="label dlg__sub">Enthaltene Leistungen</p>
    <div class="pkg-items">${P.db.services.map((s) => `<label><span>${esc(s.name)}</span><input class="input input--sm num" type="number" min="0" max="50" name="it_${s.id}" value="${cnt(s.id)}" aria-label="Anzahl ${esc(s.name)}"></label>`).join('')}</div>
    <label class="check"><input type="checkbox" name="active" ${p.active !== false ? 'checked' : ''}> An der Kasse verkaufbar</label>`, actions: [{ label: 'Abbrechen', value: 'cancel' }, { label: 'Speichern', value: 'ok', kind: 'btn-dark' }] });
  d.addEventListener('click', async (e) => { const b = e.target.closest('[data-act]'); if (!b || b.dataset.act !== 'ok') return; e.preventDefault(); const f = d.querySelector('form').elements; try { await pult.savePackage({ id: p.id, name: f.name.value, price: f.price.value, validMonths: f.validMonths.value, active: f.active.checked, items: P.db.services.map((s) => ({ serviceId: s.id, count: Number(f[`it_${s.id}`].value) || 0 })) }); d.close(); await P.refresh(); toast('Gespeichert.'); renderPakete(root); } catch (x) { d.error(x.message); } });
}

/* ---------- Team: Anwesenheit, Abwesenheiten & Pausen, Leistung ---------- */
export function renderTeamPane(pane, which, rerender) {
  const t = today();
  const team = P.db.staff.filter((s) => s.active !== false);
  if (which === 'anwesenheit') {
    const rows = P.db.attendance.filter((a) => a.date >= addDays(t, -21)).sort((a, b) => (a.date === b.date ? a.in - b.in : a.date < b.date ? 1 : -1));
    const mine = P.me.role === 'staff' ? team.filter((s) => s.id === P.me.staffId) : team;
    pane.innerHTML = `<div class="clock">${mine.map((s) => { const open = P.db.attendance.find((a) => a.staffId === s.id && a.date === t && a.out == null); return `<div class="clock__card"><p><b>${esc(s.name)}</b><small>${open ? `anwesend seit ${hhmm(open.in)} Uhr` : 'nicht eingestempelt'}</small></p><button type="button" class="btn ${open ? 'btn-outline' : 'btn-dark'} btn-sm" data-clock="${s.id}">${open ? 'Gehen' : 'Kommen'}</button></div>`; }).join('')}</div>
      ${table({ id: 'attend', title: 'Anwesenheit', cols: [{ label: 'Datum', type: 'date', get: (a) => a.date }, { label: 'Mitarbeiter', get: (a) => staffName(a.staffId) }, { label: 'Kommen', type: 'time', get: (a) => a.in }, { label: 'Gehen', type: 'time', get: (a) => a.out }, { label: 'Stunden', num: true, get: (a) => (a.out == null ? 'läuft' : ((a.out - a.in) / 60).toLocaleString('de-DE', { maximumFractionDigits: 2 })) }], rows })}`;
    pane.querySelectorAll('[data-clock]').forEach((b) => { b.onclick = async () => { try { await pult.clock(b.dataset.clock); await P.refresh(); rerender(); } catch (x) { toast(x.message, 'is-error'); } }; });
  }
  if (which === 'abwesenheit') {
    const groups = new Map();
    for (const b of P.db.blockers.filter((x) => x.kind === 'absence')) { const k = b.group || b.id; const g = groups.get(k) || { group: k, staffId: b.staffId, type: b.absenceType || b.reason, from: b.date, to: b.date, days: 0, example: b.example }; g.from = b.date < g.from ? b.date : g.from; g.to = b.date > g.to ? b.date : g.to; g.days++; groups.set(k, g); }
    const rows = [...groups.values()].sort((a, b) => (a.from < b.from ? 1 : -1));
    pane.innerHTML = `<div class="grid-2col">
      <section><h2 class="h-sub">Abwesenheiten</h2>
        ${isAdmin() ? `<form class="inline-form" data-abs><select class="select select--box select--sm" name="staffId" aria-label="Mitarbeiter">${team.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select><select class="select select--box select--sm" name="type" aria-label="Art">${['Urlaub', 'Krank', 'Fortbildung', 'Sonstiges'].map((x) => `<option>${x}</option>`).join('')}</select><label><span class="sr-only">Von</span><input class="input input--sm" type="date" name="from" value="${addDays(t, 7)}"></label><label><span class="sr-only">Bis</span><input class="input input--sm" type="date" name="to" value="${addDays(t, 9)}"></label><button class="btn btn-dark btn-sm" type="submit">Eintragen</button></form>` : ''}
        ${table({ id: 'abs', title: 'Abwesenheiten', cols: [{ label: 'Mitarbeiter', get: (g) => staffName(g.staffId) }, { label: 'Art', get: (g) => g.type }, { label: 'Von', type: 'date', get: (g) => g.from }, { label: 'Bis', type: 'date', get: (g) => g.to }, { label: 'Arbeitstage', type: 'int', get: (g) => g.days }, { label: '', noExport: true, get: () => '', html: (g) => (isAdmin() ? `<button type="button" class="link-quiet" data-abs-del="${esc(g.group)}">Entfernen</button>` : '') }], rows, empty: 'Keine Abwesenheiten eingetragen.' })}
        <p class="fine">Abwesenheiten sperren den Kalender und die Online-Buchung für diese Tage.</p>
      </section>
      <section><h2 class="h-sub">Tägliche Pause</h2>
        ${team.map((s) => { const br = s.breaks && s.breaks.all; return `<form class="inline-form" data-break="${s.id}"><b class="inline-form__l">${esc(s.name)}</b><label><span class="sr-only">Beginn</span><input class="input input--sm" type="time" name="from" value="${br ? hhmm(br[0]) : ''}" step="900" ${isAdmin() ? '' : 'disabled'}></label><span aria-hidden="true">–</span><label><span class="sr-only">Ende</span><input class="input input--sm" type="time" name="to" value="${br ? hhmm(br[1]) : ''}" step="900" ${isAdmin() ? '' : 'disabled'}></label>${isAdmin() ? '<button class="btn btn-outline btn-sm" type="submit">Speichern</button>' : ''}</form>`; }).join('')}
        <p class="fine">Pausen erscheinen schraffiert im Kalender und sind online nicht buchbar. Felder leeren = keine Pause.</p>
      </section></div>`;
    const f = pane.querySelector('[data-abs]');
    if (f) f.onsubmit = async (e) => { e.preventDefault(); try { const n = await pult.addAbsence({ staffId: f.staffId.value, type: f.type.value, from: f.from.value, to: f.to.value }); await P.refresh(); toast(`${n} Arbeitstage gesperrt.`); rerender(); } catch (x) { toast(x.message, 'is-error'); } };
    pane.querySelectorAll('[data-abs-del]').forEach((b) => { b.onclick = async () => { if (!(await confirmDialog('Abwesenheit entfernen?', 'Die Tage werden wieder buchbar.', 'Entfernen', true))) return; await pult.removeAbsence(b.dataset.absDel); await P.refresh(); rerender(); }; });
    pane.querySelectorAll('[data-break]').forEach((fm) => { fm.onsubmit = async (e) => { e.preventDefault(); const a = fm.from.value, b = fm.to.value; try { await pult.saveBreak(fm.dataset.break, a && b ? [parseHHMM(a), parseHHMM(b)] : null); await P.refresh(); toast('Pause gespeichert.'); rerender(); } catch (x) { toast(x.message, 'is-error'); } }; });
  }
  if (which === 'leistung') {
    pane.innerHTML = `${toolbar({ csv: 'team-perf' })}${staffTable(ensureRange(), 'team-perf')}`;
    bindToolbar(pane, rerender);
  }
}

/* ---------- Einstellungen: Firma, DATEV, Sicherheit, Protokoll ---------- */
export function renderBizSettings(box) {
  const s = P.db.settings, b = s.business || {}, dv = s.datev || {}, sec = s.security || {};
  const A = accountsFor(dv.skr || '03', {});
  box.innerHTML = `<form class="settings" data-biz novalidate>
    <fieldset class="set-block"><legend class="label">Firmendaten für den Kassenbon</legend><div class="grid3">
      <div class="field"><label class="label" for="bz-n">Firmenname</label><input class="input" id="bz-n" name="name" value="${esc(b.name || '')}" maxlength="60"></div>
      <div class="field"><label class="label" for="bz-o">Inhaber</label><input class="input" id="bz-o" name="owner" value="${esc(b.owner || '')}" maxlength="80"></div>
      <div class="field"><label class="label" for="bz-st">Straße</label><input class="input" id="bz-st" name="street" value="${esc(b.street || '')}" maxlength="80"></div>
      <div class="field"><label class="label" for="bz-z">PLZ</label><input class="input" id="bz-z" name="zip" value="${esc(b.zip || '')}" inputmode="numeric" maxlength="5"></div>
      <div class="field"><label class="label" for="bz-c">Ort</label><input class="input" id="bz-c" name="city" value="${esc(b.city || '')}" maxlength="60"></div>
      <div class="field"><label class="label" for="bz-p">Telefon</label><input class="input" id="bz-p" name="phone" value="${esc(b.phone || '')}"></div>
      <div class="field"><label class="label" for="bz-tx">Steuernummer</label><input class="input" id="bz-tx" name="taxNo" value="${esc(b.taxNo || '')}" maxlength="30"></div>
      <div class="field"><label class="label" for="bz-v">USt-IdNr. <span class="label__hint">falls vorhanden</span></label><input class="input" id="bz-v" name="vatId" value="${esc(b.vatId || '')}" maxlength="20"></div>
      <div class="field"><label class="label" for="bz-r">Kassenbezeichnung</label><input class="input" id="bz-r" name="register" value="${esc(b.register || '')}" maxlength="40"></div>
      <div class="field span3"><label class="label" for="bz-f">Fußzeile auf dem Bon</label><input class="input" id="bz-f" name="footer" value="${esc(b.footer || '')}" maxlength="120"></div>
    </div></fieldset>
    <fieldset class="set-block"><legend class="label">DATEV-Export</legend><div class="grid3">
      <div class="field"><label class="label" for="dv-b">Beraternummer</label><input class="input" id="dv-b" name="consultant" value="${esc(dv.consultant || '')}" inputmode="numeric" maxlength="7"></div>
      <div class="field"><label class="label" for="dv-m">Mandantennummer</label><input class="input" id="dv-m" name="client" value="${esc(dv.client || '')}" inputmode="numeric" maxlength="5"></div>
      <div class="field"><label class="label" for="dv-s">Kontenrahmen</label><select class="input select" id="dv-s" name="skr"><option value="03" ${dv.skr !== '04' ? 'selected' : ''}>SKR03</option><option value="04" ${dv.skr === '04' ? 'selected' : ''}>SKR04</option></select></div>
      <div class="field"><label class="label" for="dv-w">Wirtschaftsjahr beginnt im Monat</label><input class="input" id="dv-w" name="fyStartMonth" type="number" min="1" max="12" value="${dv.fyStartMonth || 1}"></div>
    </div>
    <details class="hist"><summary>Konten anpassen (leer = Standard SKR${esc(dv.skr || '03')})</summary><div class="grid3">${Object.entries(ACCOUNT_LABEL).map(([k, l]) => `<div class="field"><label class="label" for="ac-${k}">${esc(l)}</label><input class="input num" id="ac-${k}" name="ac_${k}" inputmode="numeric" maxlength="8" placeholder="${A[k]}" value="${esc((dv.accounts || {})[k] || '')}"></div>`).join('')}</div></details>
    <p class="note-tax">Kontenzuordnung bitte mit dem Steuerberater abstimmen.</p></fieldset>
    <fieldset class="set-block"><legend class="label">Sicherheit</legend><div class="grid3">
      <div class="field"><label class="label" for="se-idle">Automatisch abmelden nach (Minuten ohne Aktivität)</label><input class="input" id="se-idle" name="idleMinutes" type="number" min="5" max="120" value="${sec.idleMinutes || 20}"></div>
    </div>
    <p class="fine">Kasse: <b>TSE nicht angeschlossen (Demo)</b>. Für den Betrieb ist eine zertifizierte Cloud-TSE (z. B. über eine Kassen-Schnittstelle) und die Meldung an das Finanzamt nötig.</p></fieldset>
    <div class="row-actions"><button class="btn btn-dark btn-sm" type="submit">Firmen- und Exportdaten speichern</button></div>
  </form>
  <section class="set-block"><h2 class="label">Protokoll <span class="label__hint">nur anhängen, nicht änderbar</span></h2>
    ${table({ id: 'audit', title: 'Protokoll', cols: [{ label: 'Zeit', get: (a) => new Date(a.at).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) }, { label: 'Wer', get: (a) => a.byName || a.by }, { label: 'Aktion', get: (a) => a.action }, { label: 'Details', get: (a) => a.detail }], rows: [...P.db.audit].sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 60) })}
  </section>`;
  const f = box.querySelector('[data-biz]');
  f.onsubmit = async (e) => {
    e.preventDefault(); const el = f.elements;
    try {
      await pult.saveBizSettings({ business: { name: el.name.value, owner: el.owner.value, street: el.street.value, zip: el.zip.value, city: el.city.value, phone: el.phone.value, email: b.email || '', taxNo: el.taxNo.value, vatId: el.vatId.value, register: el.register.value, footer: el.footer.value }, datev: { consultant: el.consultant.value, client: el.client.value, skr: el.skr.value, fyStartMonth: el.fyStartMonth.value, accounts: Object.fromEntries(Object.keys(ACCOUNT_LABEL).map((k) => [k, el[`ac_${k}`].value.trim()])) }, security: { idleMinutes: el.idleMinutes.value } });
      await P.refresh(); toast('Gespeichert.');
    } catch (x) { toast(x.message, 'is-error'); }
  };
}
void pct; void demoNote; void clientOf;
