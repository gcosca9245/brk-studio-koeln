/* Studio-Pult – Kasse: aus Termin oder frei kassieren, Bar/Karte/gemischt, Trinkgeld je Mitarbeiter,
   Anzahlungen, Ausfallgebühren, Rabatte, Gutscheine verkaufen und einlösen, Pakete, Ratenzahlung. */
import { P, esc, eur, hhmm, euroIn, staffName, svcOf, clientOf, productOf, head, today, addDays, dateDE, exampleTag, int } from './kit.js';
import { computeTotals, parseEuro, METHODS, voucherState, packageState, installmentState, lineGross, REVENUE_KINDS } from '../ledger.js';
import { pult } from '../pult-api.js';
import { toast, confirmDialog } from '../ui.js';
import { fmtPrice } from '../util.js';
import { showBon } from './bon.js';

let C = fresh();
let key = 0;
function fresh() { return { lines: [], clientId: null, apptIds: [], tips: {}, payments: [], cashGiven: '', tab: 'service', q: '', installment: { count: 3, firstDue: addDays(today(), 30) }, note: '', billPct: 0 }; }
const active = () => P.db.staff.filter((s) => s.active !== false);
const myStaff = () => P.me.staffId || 'st_burak';

/* ---------- von außen: Termin, Rate, Gutschein, Gebühr in die Kasse legen ---------- */
export const kasse = {
  reset() { C = fresh(); },
  fromAppointment(id) {
    const a = P.db.appointments.find((x) => x.id === id); if (!a) return;
    C = fresh();
    const s = svcOf(a.serviceId);
    if (s) C.lines.push(line({ kind: 'service', refId: s.id, serviceId: s.id, name: s.name, unit: s.price, vat: s.vat ?? 19, staffId: a.staffId, priceMode: s.priceMode }));
    C.apptIds = [a.id];
    C.clientId = clientForAppt(a);
    if (C.clientId) usePackageIfAny(C.lines[0]);
    if (a.deposit && depositLeft(a) > 0) C.payments.push({ method: 'deposit', amount: depositLeft(a), ref: a.id, auto: true });
  },
  fee(apptId) {
    const a = P.db.appointments.find((x) => x.id === apptId);
    C = fresh();
    C.lines.push(line({ kind: 'fee', refId: 'fee', name: 'Ausfallgebühr nicht wahrgenommener Termin', unit: 1500, vat: 19, staffId: a ? a.staffId : myStaff() }));
    if (a) C.clientId = clientForAppt(a);
  },
  installment(planId) {
    const p = installmentState(P.db.installments, P.db.transactions, today()).find((x) => x.id === planId); if (!p) return;
    const next = p.schedule.find((s) => s.open > 0);
    C = fresh(); C.clientId = p.clientId;
    C.lines.push(line({ kind: 'installment', refId: p.id, planId: p.id, name: `Rate · ${p.note || 'Ratenzahlung'}`, unit: next ? next.open : p.open, vat: null, staffId: myStaff() }));
  },
  voucher(value = 5000, clientId = null) { C = fresh(); C.clientId = clientId; C.lines.push(line({ kind: 'voucher', refId: '', name: 'Gutschein', unit: value, vat: null, staffId: myStaff() })); },
  deposit(apptId) {
    const a = P.db.appointments.find((x) => x.id === apptId); if (!a) return;
    C = fresh(); C.clientId = clientForAppt(a);
    C.lines.push(line({ kind: 'deposit', refId: a.id, name: `Anzahlung ${(svcOf(a.serviceId) || {}).name || 'Termin'} am ${dateDE(a.date)}`, unit: 5000, vat: null, staffId: a.staffId }));
  },
};
function line(o) { return { key: ++key, qty: 1, discount: 0, ...o }; }
function clientForAppt(a) {
  if (a.clientId && clientOf(a.clientId)) return a.clientId;
  const byUser = a.customerId && P.db.clients.find((c) => c.userId === a.customerId); if (byUser) return byUser.id;
  const n = a.name.replace(/^Beispiel · /, '');
  const byName = P.db.clients.find((c) => c.name === n); return byName ? byName.id : null;
}
function depositLeft(a) { if (!a.deposit) return 0; const used = P.db.transactions.flatMap((t) => t.payments).filter((p) => p.method === 'deposit' && p.ref === a.id).reduce((s, p) => s + p.amount, 0); return a.deposit.amount - used; }
function cardsOf(clientId) { return packageState(P.db.packageCards.filter((c) => c.clientId === clientId), P.db.transactions).filter((c) => !c.cancelled && c.left > 0 && c.expires >= today()); }
function usePackageIfAny(l) {
  if (!l || l.kind !== 'service') return;
  const card = cardsOf(C.clientId).find((c) => c.items.some((i) => i.serviceId === l.serviceId && i.left > 0));
  if (card) Object.assign(l, { kind: 'package_use', cardId: card.id, refId: card.id, name: `${l.name} · aus Paket`, unit: 0, discount: 0 });
}

/* ---------- Rendern ---------- */
export function renderKasse(root) {
  const t = today();
  const due = P.db.appointments.filter((a) => a.date === t && a.status === 'booked' && !a.paidBonId).sort((a, b) => a.start - b.start);
  root.innerHTML = `${head('Kasse', `<span class="stamp stamp--warn" title="Technische Sicherheitseinrichtung">TSE nicht angeschlossen · Demo</span><span class="stamp">Nächster Bon ${int((P.db.transactions.reduce((m, x) => Math.max(m, x.no), 0)) + 1)}</span>`)}
  <div class="pos">
    <section class="pos__pick" aria-labelledby="pos-pick-h">
      <h2 id="pos-pick-h" class="sr-only">Auswahl</h2>
      <div class="pos__due">
        <p class="label">Heute zu kassieren <span class="label__hint">${due.length} offen</span></p>
        ${due.length ? `<ul class="due-list">${due.map((a) => { const s = svcOf(a.serviceId) || {}; return `<li><button type="button" class="due" data-load-appt="${a.id}"${C.apptIds.includes(a.id) ? ' aria-pressed="true"' : ''}><span class="due__t">${hhmm(a.start)}</span><span class="due__n">${esc(a.name.replace(/^Beispiel · /, ''))}${exampleTag(a)}</span><span class="due__s">${esc(s.name || '')} · ${esc(staffName(a.staffId))}${a.deposit ? ` · Anzahlung ${esc(eur(a.deposit.amount))}` : ''}</span></button></li>`; }).join('')}</ul>` : '<p class="empty empty--sm">Alle heutigen Termine sind kassiert.</p>'}
      </div>
      <div class="tabs tabs--sm" role="tablist" aria-label="Sortiment">${[['service', 'Leistungen'], ['product', 'Produkte'], ['voucher', 'Gutscheine'], ['package', 'Pakete'], ['more', 'Weitere']].map(([k, l]) => `<button type="button" role="tab" data-ktab="${k}" aria-selected="${C.tab === k}">${l}</button>`).join('')}</div>
      <label class="sr-only" for="pos-q">Suchen</label>
      <input class="input input--search" id="pos-q" type="search" placeholder="Suchen …" value="${esc(C.q)}" data-pos-q autocomplete="off">
      <ul class="pick-list" data-pick-list>${pickItems()}</ul>
    </section>
    <section class="pos__cart" aria-labelledby="pos-cart-h" data-cart>${cartHTML()}</section>
  </div>`;
}

function pickItems() {
  const q = C.q.trim().toLowerCase();
  const m = (s) => !q || s.toLowerCase().includes(q);
  if (C.tab === 'service') return P.db.services.filter((s) => s.active !== false && m(s.name)).map((s) => `<li><button type="button" class="pick" data-add="service:${s.id}"><span>${esc(s.name)}<small>${esc(s.cat)} · ${s.duration} Min.</small></span><b>${esc(fmtPrice(s))}</b></button></li>`).join('');
  if (C.tab === 'product') return P.db.products.filter((p) => p.active !== false && m(`${p.name} ${p.sku} ${p.cat}`)).map((p) => `<li><button type="button" class="pick" data-add="product:${p.id}" ${p.stock <= 0 ? 'disabled' : ''}><span>${esc(p.name)}<small>${esc(p.cat)} · ${p.stock > 0 ? `${p.stock} am Lager` : 'ausverkauft'}${p.vat === 7 ? ' · 7 %' : ''}</small></span><b>${esc(eur(p.price))}</b></button></li>`).join('');
  if (C.tab === 'voucher') return [2500, 5000, 7500, 10000, 15000].map((v) => `<li><button type="button" class="pick" data-add="voucher:${v}"><span>Gutschein ${esc(eur(v))}<small>Mehrzweck-Gutschein · ohne USt. beim Verkauf · 3 Jahre gültig</small></span><b>${esc(eur(v))}</b></button></li>`).join('') + '<li><button type="button" class="pick" data-add="voucher:free"><span>Freier Betrag<small>Wert im Warenkorb eintragen</small></span><b>…</b></button></li>';
  if (C.tab === 'package') {
    const cards = C.clientId ? cardsOf(C.clientId) : [];
    const uses = cards.flatMap((c) => c.items.filter((i) => i.left > 0).map((i) => `<li><button type="button" class="pick pick--use" data-add="use:${c.id}:${i.serviceId}"><span>${esc((svcOf(i.serviceId) || {}).name || '')} aus Paket<small>${esc(c.name)} · noch ${i.left} von ${i.total}</small></span><b>0,00&nbsp;€</b></button></li>`)).join('');
    return `${uses ? `<li class="pick-sep">Guthaben von ${esc(clientOf(C.clientId).name)}</li>${uses}<li class="pick-sep">Pakete verkaufen</li>` : ''}${P.db.packages.filter((p) => p.active !== false && m(p.name)).map((p) => `<li><button type="button" class="pick" data-add="package:${p.id}"><span>${esc(p.name)}<small>${p.items.map((i) => `${i.count} × ${esc((svcOf(i.serviceId) || {}).name || '')}`).join(', ')} · ${p.validMonths} Monate</small></span><b>${esc(eur(p.price))}</b></button></li>`).join('')}`;
  }
  // Weitere
  const cl = C.clientId;
  const plans = cl ? installmentState(P.db.installments.filter((p) => p.clientId === cl), P.db.transactions, today()).filter((p) => p.open > 0) : [];
  const upcoming = cl ? P.db.appointments.filter((a) => clientForAppt(a) === cl && a.status === 'booked' && a.date >= today() && !a.deposit) : [];
  return `<li><button type="button" class="pick" data-add="fee"><span>Ausfallgebühr<small>nicht wahrgenommener Termin · 19 %</small></span><b>${esc(eur(1500))}</b></button></li>
    ${plans.map((p) => `<li><button type="button" class="pick" data-add="inst:${p.id}"><span>Rate kassieren<small>${esc(p.note || '')} · offen ${esc(eur(p.open))}</small></span><b>${esc(eur((p.schedule.find((s) => s.open > 0) || {}).open || p.open))}</b></button></li>`).join('')}
    ${upcoming.map((a) => `<li><button type="button" class="pick" data-add="dep:${a.id}"><span>Anzahlung für ${esc(dateDE(a.date))} ${hhmm(a.start)}<small>${esc((svcOf(a.serviceId) || {}).name || '')} · wird beim Termin verrechnet</small></span><b>${esc(eur(5000))}</b></button></li>`).join('')}
    ${!cl ? '<li class="pick-sep">Raten und Anzahlungen erscheinen, sobald ein Kunde gewählt ist.</li>' : ''}`;
}

function totals() { return computeTotals(C.lines.map((l) => ({ ...l, discount: l.discount || 0 }))); }
const paidSum = () => C.payments.reduce((s, p) => s + (p.amount || 0), 0);
const staffInCart = () => [...new Set(C.lines.map((l) => l.staffId).filter(Boolean))];

function cartHTML() {
  const T = totals();
  const client = C.clientId ? clientOf(C.clientId) : null;
  const rest = T.due - paidSum();
  const cash = C.payments.filter((p) => p.method === 'cash').reduce((s, p) => s + p.amount, 0) + Object.values(C.tips).filter((x) => x.method === 'cash').reduce((s, x) => s + (x.amount || 0), 0);
  const given = parseEuro(C.cashGiven);
  const openPlans = client ? installmentState(P.db.installments.filter((p) => p.clientId === client.id), P.db.transactions, today()).filter((p) => p.open > 0) : [];
  const pay = P.db.settings.pay || {};
  return `<h2 id="pos-cart-h" class="pos__title">Warenkorb</h2>
    <div class="pos__client">
      <label class="label" for="pos-client">Kunde</label>
      <div class="pos__client-row">
        <input class="input" id="pos-client" list="pos-clients" placeholder="Laufkundschaft – Name suchen" value="${esc(client ? client.name : '')}" data-client autocomplete="off">
        <datalist id="pos-clients">${P.db.clients.map((c) => `<option value="${esc(c.name)}">${esc(c.phone || '')}</option>`).join('')}</datalist>
        ${client ? '<button type="button" class="link-quiet" data-client-clear>Entfernen</button>' : ''}
      </div>
      ${client ? `<p class="pos__client-info">${client.prefs ? `${esc(client.prefs)} · ` : ''}${cardsOf(client.id).length ? `Paketguthaben vorhanden · ` : ''}${openPlans.length ? `<b>offene Raten ${esc(eur(openPlans.reduce((s, p) => s + p.open, 0)))}</b>` : 'keine offenen Beträge'}</p>` : ''}
    </div>
    ${C.lines.length ? `<ul class="cart">${C.lines.map((l) => `<li class="cart__row" data-line="${l.key}">
        <div class="cart__name"><b>${esc(l.name)}</b><small>${esc(l.kind === 'product' ? `${(productOf(l.refId) || {}).stock ?? ''} am Lager` : l.kind === 'voucher' ? 'Gutschein-Verkauf · ohne USt.' : l.kind === 'deposit' ? 'Anzahlung · ohne USt.' : l.kind === 'installment' ? 'Rate · ohne USt.' : l.kind === 'package_use' ? 'aus Paketguthaben' : `${l.vat} % MwSt.`)}${l.priceMode === 'from' ? ' · Preis ab, bitte anpassen' : ''}</small></div>
        <label class="cart__staff"><span class="sr-only">Mitarbeiter</span><select class="select select--box select--sm" data-l="staffId">${active().map((s) => `<option value="${s.id}" ${s.id === l.staffId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
        <div class="stepper" role="group" aria-label="Menge"><button type="button" data-qty="-1" aria-label="weniger" ${l.qty <= 1 || ['voucher', 'deposit', 'installment', 'fee'].includes(l.kind) ? 'disabled' : ''}>−</button><span aria-live="polite">${l.qty}</span><button type="button" data-qty="1" aria-label="mehr" ${['voucher', 'deposit', 'installment', 'fee', 'package_use'].includes(l.kind) ? 'disabled' : ''}>+</button></div>
        <label class="cart__price"><span class="sr-only">Einzelpreis</span><input class="input input--sm num" inputmode="decimal" data-l="unit" value="${euroIn(l.unit)}" ${l.kind === 'package_use' ? 'disabled' : ''} aria-label="Einzelpreis ${esc(l.name)}"></label>
        <label class="cart__disc"><span class="sr-only">Rabatt</span><input class="input input--sm num" inputmode="decimal" data-l="discount" value="${l.discount ? euroIn(l.discount) : ''}" placeholder="Rabatt" ${REVENUE_KINDS.has(l.kind) && l.kind !== 'package_use' ? '' : 'disabled'} aria-label="Rabatt in Euro ${esc(l.name)}"></label>
        <b class="cart__sum num" data-line-sum>${esc(eur(lineGross(l)))}</b>
        <button type="button" class="cart__x" data-remove aria-label="${esc(l.name)} entfernen"><span aria-hidden="true"></span></button>
      </li>`).join('')}</ul>` : '<p class="empty">Termin links wählen oder Leistung, Produkt oder Gutschein hinzufügen.</p>'}
    ${C.lines.length ? `
    <div class="pos__disc"><label class="label" for="pos-bill">Rabatt auf den Bon</label><select class="select select--box select--sm" id="pos-bill" data-bill>${[0, 5, 10, 15, 20, 50].map((p) => `<option value="${p}" ${C.billPct === p ? 'selected' : ''}>${p ? `${p} %` : 'kein Rabatt'}</option>`).join('')}</select><span class="label__hint">gilt für Leistungen und Produkte</span></div>
    <dl class="pos-sum">
      ${Object.entries(T.vat).sort((a, b) => b[0] - a[0]).map(([r, s]) => `<div><dt>darin MwSt. ${r} % <small>netto ${esc(eur(s.net))}</small></dt><dd class="num">${esc(eur(s.tax))}</dd></div>`).join('')}
      ${T.other ? `<div><dt>ohne USt. (Gutschein, Anzahlung, Rate)</dt><dd class="num">${esc(eur(T.other))}</dd></div>` : ''}
      <div class="pos-sum__total"><dt>Gesamt</dt><dd class="num" data-sum-total>${esc(eur(T.due))}</dd></div>
    </dl>
    <fieldset class="pos__tips"><legend class="label">Trinkgeld <span class="label__hint">nicht steuerpflichtig, geht ans Team</span></legend>
      ${(staffInCart().length ? staffInCart() : [myStaff()]).map((id) => { const x = C.tips[id] || { amount: 0, method: 'card' }; return `<div class="tip-row" data-tip="${id}"><span>${esc(staffName(id))}</span><input class="input input--sm num" inputmode="decimal" data-tip-amt value="${x.amount ? euroIn(x.amount) : ''}" placeholder="0,00" aria-label="Trinkgeld ${esc(staffName(id))}"><div class="seg seg--sm" role="group" aria-label="Trinkgeld-Zahlart"><button type="button" data-tip-m="cash" aria-pressed="${x.method === 'cash'}">Bar</button><button type="button" data-tip-m="card" aria-pressed="${x.method === 'card'}">Karte</button></div></div>`; }).join('')}
    </fieldset>
    <fieldset class="pos__pay"><legend class="label">Zahlung</legend>
      <div class="pay-add">${[['cash', 'Bar'], ['card', 'Karte'], ['voucher', 'Gutschein'], ['installment', 'Ratenzahlung'], ['online', 'Online']].filter(([k]) => pay[k] !== false || k === 'online').map(([k, l]) => `<button type="button" class="btn btn-outline btn-sm" data-pay-add="${k}" ${k === 'online' ? 'disabled title="Stripe vorbereitet, nicht verbunden"' : ''}>${l}</button>`).join('')}</div>
      ${C.payments.map((p, i) => `<div class="pay-row" data-pay="${i}"><span class="pay-row__m">${esc(METHODS[p.method])}</span>
        ${p.method === 'voucher' ? `<input class="input input--sm" data-pay-ref value="${esc(p.ref || '')}" placeholder="Code, z. B. BRK-AB12-34" aria-label="Gutscheincode" autocomplete="off" spellcheck="false">` : p.method === 'deposit' ? '<span class="pay-row__ref">aus Termin-Anzahlung</span>' : p.method === 'installment' ? `<span class="pay-row__ref"><label>Raten <select class="select select--box select--sm" data-inst-n>${[2, 3, 4, 6, 10, 12].map((n) => `<option ${C.installment.count === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label> <label>erste am <input class="input input--sm" type="date" data-inst-first value="${C.installment.firstDue}"></label></span>` : '<span></span>'}
        <input class="input input--sm num" inputmode="decimal" data-pay-amt value="${euroIn(p.amount)}" aria-label="Betrag ${esc(METHODS[p.method])}">
        <button type="button" class="cart__x" data-pay-x aria-label="Zahlung entfernen"><span aria-hidden="true"></span></button></div>`).join('')}
      ${p0(C.payments, 'voucher') ? `<p class="fine" data-voucher-info>${voucherInfo()}</p>` : ''}
      <p class="pay-rest ${rest ? 'is-open' : 'is-done'}" data-rest>${rest > 0 ? `Noch offen: <b>${esc(eur(rest))}</b>` : rest < 0 ? `Zu viel verteilt: <b>${esc(eur(-rest))}</b>` : 'Vollständig verteilt'}</p>
      ${cash ? `<div class="pay-cash"><label class="label" for="pos-given">Gegeben bar</label><input class="input input--sm num" id="pos-given" inputmode="decimal" data-given value="${esc(C.cashGiven)}" placeholder="${euroIn(cash)}"><p class="pay-change" data-change>${given != null && given >= cash ? `Rückgeld <b>${esc(eur(given - cash))}</b>` : ''}</p></div>` : ''}
    </fieldset>
    <label class="field"><span class="label">Notiz auf dem Bon <span class="label__hint">optional</span></span><input class="input input--sm" data-note value="${esc(C.note)}" maxlength="200"></label>
    <p class="form-error" data-pos-error role="alert"></p>
    <div class="pos__go"><button type="button" class="btn btn-outline btn-sm" data-cart-clear>Leeren</button><button type="button" class="btn btn-dark" data-checkout>${esc(eur(T.due))} kassieren</button></div>
    <button type="button" class="pos-jump" data-pos-jump><span>Warenkorb · ${C.lines.length} ${C.lines.length === 1 ? 'Position' : 'Positionen'}</span><b>${esc(eur(T.due))}</b></button>` : ''}`;
}
const p0 = (arr, m) => arr.some((p) => p.method === m);
function voucherInfo() {
  const vs = voucherState(P.db.vouchers, P.db.transactions, today());
  return C.payments.filter((p) => p.method === 'voucher' && p.ref).map((p) => { const v = vs.find((x) => x.code === String(p.ref).toUpperCase().trim()); return v ? `${esc(v.code)}: Restwert ${esc(eur(v.remaining))} · ${esc(v.status)} · gültig bis ${esc(dateDE(v.expires))}` : `${esc(p.ref)}: unbekannt`; }).join('<br>') || 'Code eingeben, der Restwert erscheint hier.';
}

/* ---------- Ereignisse ---------- */
export function bindKasse(root, rerender) {
  if (root._kb) return; root._kb = true;
  const cart = () => { const c = root.querySelector('[data-cart]'); if (c) c.innerHTML = cartHTML(); };
  const findLine = (el) => C.lines.find((l) => l.key === Number(el.closest('[data-line]').dataset.line));
  const autoPay = () => { // genau eine Zahlung ohne manuelle Änderung: Betrag folgt der Summe
    const T = totals();
    if (C.payments.length === 1 && !C.payments[0].touched) C.payments[0].amount = T.due;
    else if (C.payments.length > 1) { const others = C.payments.slice(0, -1).reduce((s, p) => s + p.amount, 0); const last = C.payments[C.payments.length - 1]; if (!last.touched) last.amount = Math.max(0, T.due - others); }
  };
  const applyBill = () => { for (const l of C.lines) { if (!REVENUE_KINDS.has(l.kind) || l.kind === 'package_use') continue; if (C.billPct) { l.discount = Math.round((l.qty * l.unit * C.billPct) / 100); l.billDisc = true; } else if (l.billDisc) { l.discount = 0; l.billDisc = false; } } };
  root.addEventListener('click', async (e) => {
    const t = e.target;
    if (t.closest('[data-pos-jump]')) { const c = root.querySelector('[data-cart]'); c.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }); const f = c.querySelector('button, input, select'); if (f) f.focus({ preventScroll: true }); return; }
    const tab = t.closest('[data-ktab]'); if (tab) { C.tab = tab.dataset.ktab; rerender(); return; }
    const ap = t.closest('[data-load-appt]'); if (ap) { kasse.fromAppointment(ap.dataset.loadAppt); rerender(); return; }
    const add = t.closest('[data-add]');
    if (add) {
      const [k, id, extra] = add.dataset.add.split(':');
      if (k === 'service') { const s = svcOf(id); const l = line({ kind: 'service', refId: s.id, serviceId: s.id, name: s.name, unit: s.price, vat: s.vat ?? 19, staffId: myStaff(), priceMode: s.priceMode }); C.lines.push(l); if (C.clientId) usePackageIfAny(l); }
      if (k === 'product') { const p = productOf(id); const ex = C.lines.find((l) => l.kind === 'product' && l.refId === id); if (ex) ex.qty = Math.min(ex.qty + 1, p.stock); else C.lines.push(line({ kind: 'product', refId: p.id, name: p.name, unit: p.price, vat: p.vat, staffId: myStaff() })); }
      if (k === 'voucher') C.lines.push(line({ kind: 'voucher', refId: '', name: 'Gutschein', unit: id === 'free' ? 0 : Number(id), vat: null, staffId: myStaff() }));
      if (k === 'package') { const p = P.db.packages.find((x) => x.id === id); C.lines.push(line({ kind: 'package', refId: p.id, name: `Beauty-Paket ${p.name}`, unit: p.price, vat: 19, staffId: myStaff() })); }
      if (k === 'use') { const s = svcOf(extra); C.lines.push(line({ kind: 'package_use', refId: id, cardId: id, serviceId: extra, name: `${s.name} · aus Paket`, unit: 0, vat: 19, staffId: myStaff() })); }
      if (k === 'fee') C.lines.push(line({ kind: 'fee', refId: 'fee', name: 'Ausfallgebühr nicht wahrgenommener Termin', unit: 1500, vat: 19, staffId: myStaff() }));
      if (k === 'inst') { const save = C.clientId; kasse.installment(id); C.clientId = save; }
      if (k === 'dep') { const save = C.clientId; kasse.deposit(id); C.clientId = save; }
      applyBill(); autoPay(); cart(); return;
    }
    const row = t.closest('[data-line]');
    if (row && t.closest('[data-remove]')) { C.lines = C.lines.filter((l) => l.key !== Number(row.dataset.line)); autoPay(); cart(); return; }
    if (row && t.closest('[data-qty]')) { const l = findLine(t); const max = l.kind === 'product' ? (productOf(l.refId) || {}).stock || 1 : 99; l.qty = Math.max(1, Math.min(max, l.qty + Number(t.closest('[data-qty]').dataset.qty))); applyBill(); autoPay(); cart(); return; }
    const pa = t.closest('[data-pay-add]');
    if (pa) { const T = totals(); const rest = Math.max(0, T.due - paidSum()); C.payments.push({ method: pa.dataset.payAdd, amount: rest, ref: '' }); cart(); const inp = root.querySelector(`[data-pay="${C.payments.length - 1}"] ${pa.dataset.payAdd === 'voucher' ? '[data-pay-ref]' : '[data-pay-amt]'}`); if (inp) inp.focus(); return; }
    const px = t.closest('[data-pay-x]'); if (px) { C.payments.splice(Number(px.closest('[data-pay]').dataset.pay), 1); cart(); return; }
    const tm = t.closest('[data-tip-m]'); if (tm) { const id = tm.closest('[data-tip]').dataset.tip; C.tips[id] = { ...(C.tips[id] || { amount: 0 }), method: tm.dataset.tipM }; cart(); return; }
    if (t.closest('[data-client-clear]')) { C.clientId = null; cart(); return; }
    if (t.closest('[data-cart-clear]')) { if (C.lines.length && !(await confirmDialog('Warenkorb leeren?', 'Alle Positionen und Zahlungen werden entfernt.', 'Leeren', true))) return; C = fresh(); rerender(); return; }
    if (t.closest('[data-checkout]')) { await doCheckout(root, rerender); }
  });
  root.addEventListener('input', (e) => {
    const t = e.target;
    if (t.matches('[data-pos-q]')) { C.q = t.value; root.querySelector('[data-pick-list]').innerHTML = pickItems(); return; }
    if (t.matches('[data-pay-amt]')) { const p = C.payments[Number(t.closest('[data-pay]').dataset.pay)]; p.amount = parseEuro(t.value) || 0; p.touched = true; updateRest(root); return; }
    if (t.matches('[data-pay-ref]')) { const p = C.payments[Number(t.closest('[data-pay]').dataset.pay)]; p.ref = t.value.toUpperCase().trim(); const vi = root.querySelector('[data-voucher-info]'); if (vi) vi.innerHTML = voucherInfo(); return; }
    if (t.matches('[data-given]')) { C.cashGiven = t.value; updateRest(root); return; }
    if (t.matches('[data-tip-amt]')) { const id = t.closest('[data-tip]').dataset.tip; C.tips[id] = { method: 'card', ...(C.tips[id] || {}), amount: parseEuro(t.value) || 0 }; updateRest(root); return; }
    if (t.matches('[data-note]')) { C.note = t.value; }
  });
  root.addEventListener('change', (e) => {
    const t = e.target;
    if (t.matches('[data-l]')) {
      const l = findLine(t); const k = t.dataset.l;
      if (k === 'staffId') l.staffId = t.value;
      else { const v = parseEuro(t.value); if (v == null && t.value !== '') { toast('Bitte einen Betrag wie 12,50 eingeben.', 'is-error'); } else l[k] = v || 0; if (k === 'discount') l.billDisc = false; }
      autoPay(); cart(); return;
    }
    if (t.matches('[data-bill]')) { C.billPct = Number(t.value); applyBill(); autoPay(); cart(); return; }
    if (t.matches('[data-client]')) {
      const c = P.db.clients.find((x) => x.name.toLowerCase() === t.value.trim().toLowerCase());
      C.clientId = c ? c.id : null;
      if (!c && t.value.trim()) toast('Kein Kunde mit diesem Namen. Neue Kunden in der Kundenkartei anlegen.', 'is-error');
      if (c) C.lines.forEach(usePackageIfAny);
      autoPay(); cart(); if (C.tab === 'package' || C.tab === 'more') root.querySelector('[data-pick-list]').innerHTML = pickItems(); return;
    }
    if (t.matches('[data-inst-n]')) { C.installment.count = Number(t.value); return; }
    if (t.matches('[data-inst-first]')) { C.installment.firstDue = t.value; }
    if (t.matches('[data-pay-amt],[data-given],[data-tip-amt]')) cart();
  });
}
function updateRest(root) {
  const T = totals(); const rest = T.due - paidSum();
  const r = root.querySelector('[data-rest]');
  if (r) { r.className = `pay-rest ${rest ? 'is-open' : 'is-done'}`; r.innerHTML = rest > 0 ? `Noch offen: <b>${esc(eur(rest))}</b>` : rest < 0 ? `Zu viel verteilt: <b>${esc(eur(-rest))}</b>` : 'Vollständig verteilt'; }
  const cash = C.payments.filter((p) => p.method === 'cash').reduce((s, p) => s + p.amount, 0) + Object.values(C.tips).filter((x) => x.method === 'cash').reduce((s, x) => s + (x.amount || 0), 0);
  const ch = root.querySelector('[data-change]'); const g = parseEuro(C.cashGiven);
  if (ch) ch.innerHTML = g != null && g >= cash ? `Rückgeld <b>${esc(eur(g - cash))}</b>` : g != null ? 'Gegeben ist weniger als der Barbetrag.' : '';
}
async function doCheckout(root, rerender) {
  const err = root.querySelector('[data-pos-error]'); err.textContent = '';
  const btn = root.querySelector('[data-checkout]'); btn.disabled = true;
  try {
    const tips = Object.entries(C.tips).filter(([, x]) => x.amount).map(([staffId, x]) => ({ staffId, amount: x.amount, method: x.method || 'card' }));
    if (tips.some((x) => x.method === 'card') && !C.payments.some((p) => p.method === 'card')) throw new Error('Trinkgeld per Karte braucht eine Kartenzahlung.');
    const t = await pult.checkout({ lines: C.lines.map(({ key: _k, priceMode: _p, billDisc: _b, ...l }) => ({ ...l })), payments: C.payments.map(({ method, amount, ref }) => ({ method, amount, ref })), tips, cashGiven: C.cashGiven, clientId: C.clientId, apptIds: C.apptIds, installment: C.installment, note: C.note });
    C = fresh();
    await P.refresh();
    rerender();
    toast(`Bon ${t.no} gebucht.`);
    showBon(P.db.transactions.find((x) => x.id === t.id) || t);
  } catch (x) { err.textContent = x.message; btn.disabled = false; }
}
