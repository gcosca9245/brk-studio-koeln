/* BRK Studio Studio-Pult – Fachlogik für Kasse, Kunden, Lager, Gutscheine, Team und Buchhaltung.
   Läuft über denselben Adapter wie die Buchung (local = Demo, supabase = vorbereitet).
   Jede Buchung ist atomar (alles oder nichts); Belege werden nie geändert, nur storniert. */
import { adapter, requireUser } from './api.js';
import { nowCologne, addDays, weekday } from './util.js';
import { buildBon, reverseBon, voucherState, packageState, installmentState, cashBook, voidedSet, monthReport, lineGross } from './ledger.js';
import { V } from './validate.js';
import { addMonth } from './seed-pult.js';

const TEAM = ['admin', 'staff'];
const ADMIN = 'admin';
export const PULT_TABLES = ['staff', 'services', 'users', 'appointments', 'blockers', 'reviews', 'clients', 'products', 'packages', 'packageCards', 'resources', 'transactions', 'cashmoves', 'stockmoves', 'vouchers', 'installments', 'attendance', 'closings', 'audit', 'stats'];
const cashierOf = (u) => u.staffId || 'st_burak';
const randCode = () => { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; const r = crypto.getRandomValues(new Uint8Array(6)); const s = [...r].map((x) => A[x % A.length]).join(''); return `BRK-${s.slice(0, 4)}-${s.slice(4)}`; };
async function sha256(text) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)); return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join(''); }
/* Supabase-Betrieb: Geldbuchungen laufen über geprüfte Datenbankfunktionen (create_bon, void_bon, close_month),
   Bestand über Lagerbewegungen per Trigger, das Audit-Log schreiben Trigger. Der Client prüft nur vor. */
const server = (d) => d.name === 'supabase';
const CLIENT_EVENTS = new Set(['anmeldung', 'export', 'kassensturz', 'statistik', 'einstellungen', 'no-show']);
async function audit(d, u, action, entity, entityId, detail = '') {
  if (server(d)) return CLIENT_EVENTS.has(action) ? d.rpc('log_event', { p_action: action, p_entity: entity, p_entity_id: entityId || '', p_detail: String(detail).slice(0, 300) }) : null;
  return d.insert('audit', { at: new Date().toISOString(), by: u ? u.id : 'system', byName: u ? u.name : 'System', action, entity, entityId: entityId || '', detail: String(detail).slice(0, 300) }); }
const isLocked = (closings, date) => closings.some((c) => c.month === String(date).slice(0, 7));

export const pult = {
  async me() { return requireUser(TEAM); },
  async load() {
    const u = await requireUser(TEAM);
    const d = await adapter();
    const all = d.dump ? await d.dump(PULT_TABLES) : Object.fromEntries(await Promise.all(PULT_TABLES.map(async (t) => [t, await d.list(t)])));
    all.settings = await d.getSettings();
    all.me = u;
    return all;
  },

  /* ---------- Kasse ---------- */
  nextVoucherCode: randCode,
  async checkout(cart) {
    const u = await requireUser(TEAM);
    const d = await adapter();
    const db = await d.dump(['products', 'vouchers', 'transactions', 'appointments', 'closings', 'installments', 'packageCards', 'packages', 'clients', 'services']);
    const now = nowCologne();
    if (isLocked(db.closings, now.date)) throw new Error('Der laufende Monat ist abgeschlossen.');
    const client = cart.clientId ? db.clients.find((c) => c.id === cart.clientId) : null;
    if (cart.clientId && !client) throw new Error('Kunde nicht gefunden.');
    // Positionen prüfen
    const need = {};
    for (const l of cart.lines) {
      l.qty = V.int(l.qty, { min: 1, max: 99, label: 'Menge' });
      l.unit = V.money(l.unit, { label: `Preis ${l.name}` });
      l.discount = V.money(l.discount || 0, { label: 'Rabatt' });
      l.name = V.text(l.name, { min: 1, max: 120, label: 'Bezeichnung' });
      if (l.kind === 'product') { const p = db.products.find((x) => x.id === l.refId); if (!p) throw new Error('Produkt nicht gefunden.'); need[p.id] = (need[p.id] || 0) + l.qty; if (need[p.id] > p.stock) throw new Error(`Nicht genug Bestand: ${p.name} (noch ${p.stock}).`); l.vat = p.vat; l.cost = p.cost; }
      if (l.kind === 'service') { const s = db.services.find((x) => x.id === l.refId); if (!s) throw new Error('Leistung nicht gefunden.'); l.vat = s.vat ?? 19; l.serviceId = s.id; }
      if (l.kind === 'voucher') { if (l.unit < 500) throw new Error('Gutscheine ab 5 €.'); l.code = l.code && !db.vouchers.some((v) => v.code === l.code) ? V.code(l.code) : randCode(); l.refId = l.code; l.name = `Gutschein ${l.code}`; l.vat = null; if (l.discount) throw new Error('Auf Gutscheine gibt es keinen Rabatt.'); }
      if (l.kind === 'package') { const p = db.packages.find((x) => x.id === l.refId); if (!p) throw new Error('Paket nicht gefunden.'); if (!client) throw new Error('Beauty-Pakete bitte einem Kunden zuordnen.'); l.vat = p.vat || 19; }
      if (l.kind === 'package_use') {
        const card = packageState(db.packageCards, db.transactions).find((c) => c.id === l.cardId);
        const it = card && card.items.find((i) => i.serviceId === l.serviceId);
        if (!card || card.cancelled || !it || it.left < l.qty) throw new Error('Im Paket ist dafür nichts mehr offen.');
        l.unit = 0; l.discount = 0; l.vat = 19;
      }
      if (l.kind === 'installment') {
        const plan = installmentState(db.installments, db.transactions, now.date).find((p) => p.id === l.planId);
        if (!plan || lineGross(l) > plan.open) throw new Error('Rate ist höher als der offene Betrag.');
        l.vat = null; l.refId = plan.id;
      }
      if (l.kind === 'deposit') { const a = db.appointments.find((x) => x.id === l.refId); if (!a) throw new Error('Termin zur Anzahlung nicht gefunden.'); l.vat = null; if (a.deposit) throw new Error('Für diesen Termin gibt es schon eine Anzahlung.'); }
      if (l.kind === 'fee') l.vat = 19;
    }
    // Zahlungen prüfen
    const vs = voucherState(db.vouchers, db.transactions, now.date);
    for (const p of cart.payments) {
      p.amount = V.money(p.amount, { label: 'Zahlbetrag' });
      if (p.method === 'voucher') {
        p.ref = V.code(p.ref || '');
        const v = vs.find((x) => x.code === p.ref);
        if (!v) throw new Error(`Gutschein ${p.ref} ist unbekannt.`);
        if (v.status === 'abgelaufen' || v.status === 'storniert') throw new Error(`Gutschein ${p.ref} ist ${v.status}.`);
        if (p.amount > v.remaining) throw new Error(`Gutschein ${p.ref} hat nur noch ${(v.remaining / 100).toFixed(2).replace('.', ',')} €.`);
      }
      if (p.method === 'deposit') {
        const a = db.appointments.find((x) => x.id === p.ref);
        const usedDep = db.transactions.flatMap((t) => t.payments).filter((x) => x.method === 'deposit' && x.ref === p.ref).reduce((s, x) => s + x.amount, 0);
        if (!a || !a.deposit || p.amount > a.deposit.amount - usedDep) throw new Error('Anzahlung ist nicht (mehr) vorhanden.');
      }
      if (p.method === 'installment' && !client) throw new Error('Ratenzahlung nur mit Kunde.');
      if (p.method === 'online') throw new Error('Onlinezahlung ist vorbereitet, aber nicht angeschlossen.');
    }
    const tips = (cart.tips || []).filter((x) => x.amount).map((x) => ({ staffId: x.staffId, method: x.method, amount: V.money(x.amount, { label: 'Trinkgeld', max: 50000 }) }));
    const bon = buildBon({ lines: cart.lines, payments: cart.payments, tips, cashGiven: cart.cashGiven == null || cart.cashGiven === '' ? null : V.money(cart.cashGiven, { label: 'Gegeben' }), clientId: client ? client.id : null, clientName: client ? client.name : 'Laufkundschaft', apptIds: cart.apptIds || [], cashier: cashierOf(u), date: now.date, time: now.minutes, note: cart.note ? V.text(cart.note, { max: 200 }) : '' });
    const inst = bon.payments.find((p) => p.method === 'installment');
    let plan = null;
    if (inst) {
      const n = V.int(cart.installment && cart.installment.count, { min: 2, max: 12, label: 'Anzahl Raten' });
      const first = V.date((cart.installment && cart.installment.firstDue) || addDays(now.date, 30), { label: 'Erste Rate' });
      const rate = Math.floor(inst.amount / n / 100) * 100;
      plan = { schedule: Array.from({ length: n }, (_, i) => ({ due: i ? addMonthDate(first, i) : first, amount: i === n - 1 ? inst.amount - rate * (n - 1) : rate })), total: inst.amount };
    }
    if (server(d)) return d.rpc('create_bon', { p_cart: { lines: cart.lines, payments: bon.payments, tips: bon.tips, clientId: client ? client.id : null, apptIds: cart.apptIds || [], cashGiven: bon.cashGiven, note: bon.note, installment: cart.installment || null } });
    return d.atomic(async (tx) => {
      const t = await tx.insert('transactions', bon);
      for (const l of t.lines) {
        if (l.kind === 'product') {
          const p = db.products.find((x) => x.id === l.refId);
          await tx.insert('stockmoves', { productId: p.id, date: t.date, qty: -l.qty, kind: 'sale', bonId: t.id, note: `Bon ${t.no}`, cost: p.cost });
          await tx.update('products', p.id, { stock: p.stock - l.qty }); p.stock -= l.qty;
        }
        if (l.kind === 'voucher') await tx.insert('vouchers', { code: l.code, value: lineGross(l), issuedAt: t.date, soldDate: t.date, expires: `${Number(t.date.slice(0, 4)) + 3}-12-31`, buyer: client ? client.name : '', clientId: client ? client.id : null, soldBonId: t.id, channel: 'kasse', note: '' });
        if (l.kind === 'package') { const pk = db.packages.find((x) => x.id === l.refId); for (let i = 0; i < l.qty; i++) await tx.insert('packageCards', { packageId: pk.id, name: pk.name, clientId: client.id, bonId: t.id, date: t.date, expires: addDays(t.date, (pk.validMonths || 12) * 30), items: pk.items.map((it) => ({ serviceId: it.serviceId, total: it.count })) }); }
        if (l.kind === 'deposit') await tx.update('appointments', l.refId, { deposit: { amount: lineGross(l), bonId: t.id, paidAt: t.date } });
      }
      if (plan) await tx.insert('installments', { clientId: client.id, clientName: client.name, bonId: t.id, total: plan.total, createdAt: t.date, schedule: plan.schedule, note: `Bon ${t.no}` });
      for (const id of t.apptIds) await tx.update('appointments', id, { paidBonId: t.id, status: 'booked' });
      await audit(tx, u, 'kassiert', 'bon', t.id, `Bon ${t.no} · ${(t.totals.due / 100).toFixed(2)} €`);
      return t;
    });
  },
  async voidBon(id, reason) {
    const u = await requireUser(ADMIN);
    const d = await adapter();
    const db = await d.dump(['transactions', 'products', 'closings', 'appointments']);
    const o = db.transactions.find((t) => t.id === id);
    if (!o) throw new Error('Bon nicht gefunden.');
    if (o.voidOf) throw new Error('Ein Stornobeleg kann nicht storniert werden.');
    if (voidedSet(db.transactions).has(id)) throw new Error('Dieser Bon ist bereits storniert.');
    reason = V.text(reason, { min: 3, max: 120, label: 'Grund' });
    const now = nowCologne();
    if (isLocked(db.closings, now.date)) throw new Error('Der laufende Monat ist abgeschlossen.');
    if (server(d)) return d.rpc('void_bon', { p_id: id, p_reason: reason });
    const r = reverseBon(o, { date: now.date, time: now.minutes, cashier: cashierOf(u), reason });
    return d.atomic(async (tx) => {
      const t = await tx.insert('transactions', r);
      for (const l of o.lines) if (l.kind === 'product') { const p = db.products.find((x) => x.id === l.refId); if (!p) continue; await tx.insert('stockmoves', { productId: p.id, date: t.date, qty: l.qty, kind: 'void', bonId: t.id, note: `Storno Bon ${o.no}`, cost: p.cost }); await tx.update('products', p.id, { stock: p.stock + l.qty }); p.stock += l.qty; }
      for (const aid of o.apptIds || []) if (db.appointments.some((a) => a.id === aid)) await tx.update('appointments', aid, { paidBonId: null });
      for (const l of o.lines) if (l.kind === 'deposit' && db.appointments.some((a) => a.id === l.refId)) await tx.update('appointments', l.refId, { deposit: null });
      await audit(tx, u, 'storniert', 'bon', o.id, `Bon ${o.no} storniert mit Bon ${t.no}: ${reason}`);
      return t;
    });
  },

  /* ---------- Bargeld ---------- */
  async cashMove({ kind, amount, text }) {
    const u = await requireUser(kind === 'withdrawal' || kind === 'deposit_in' ? ADMIN : TEAM);
    const d = await adapter();
    kind = V.oneOf(kind, ['deposit_in', 'withdrawal', 'bank', 'tip_payout'], 'Art');
    const c = V.money(amount, { min: 1, label: 'Betrag' });
    const signed = kind === 'deposit_in' ? c : -c;
    const db = await d.dump(['transactions', 'cashmoves']);
    const bal = cashBook(db.transactions, db.cashmoves).closing;
    if (bal + signed < 0) throw new Error(`So viel Bargeld ist nicht in der Kasse (Bestand ${(bal / 100).toFixed(2).replace('.', ',')} €).`);
    const now = nowCologne();
    return d.atomic(async (tx) => { const m = await tx.insert('cashmoves', { date: now.date, time: now.minutes, kind, amount: signed, text: V.text(text, { max: 80 }), by: u.id }); await audit(tx, u, 'kassenbuch', 'cashmove', m.id, `${kind} ${(signed / 100).toFixed(2)} €`); return m; });
  },
  /** Kassensturz: gezählter Bestand gegen Soll; Differenz wird als Kassendifferenz gebucht. */
  async countCash(counted, note) {
    const u = await requireUser(TEAM);
    const d = await adapter();
    const c = V.money(counted, { label: 'Gezählter Betrag' });
    const db = await d.dump(['transactions', 'cashmoves']);
    const bal = cashBook(db.transactions, db.cashmoves).closing;
    const diff = c - bal;
    const now = nowCologne();
    await d.atomic(async (tx) => { if (diff) await tx.insert('cashmoves', { date: now.date, time: now.minutes, kind: 'diff', amount: diff, text: V.text(note || 'Zählprotokoll', { max: 80 }), by: u.id }); await audit(tx, u, 'kassensturz', 'cash', '', `Soll ${(bal / 100).toFixed(2)} €, Ist ${(c / 100).toFixed(2)} €`); });
    return { expected: bal, counted: c, diff };
  },

  /* ---------- Lager ---------- */
  async stockMove({ productId, qty, kind, note, cost }) {
    const u = await requireUser(ADMIN);
    const d = await adapter();
    const p = await d.get('products', productId); if (!p) throw new Error('Produkt nicht gefunden.');
    kind = V.oneOf(kind, ['in', 'out'], 'Art');
    const n = V.int(qty, { min: 1, max: 9999, label: 'Menge' });
    if (kind === 'out' && n > p.stock) throw new Error(`Nur ${p.stock} Stück am Lager.`);
    const ek = cost == null || cost === '' ? p.cost : V.money(cost, { label: 'Einkaufspreis' });
    const now = nowCologne();
    if (server(d)) return d.insert('stockmoves', { productId, qty: kind === 'in' ? n : -n, kind, note: V.text(note, { max: 80 }), cost: ek });
    return d.atomic(async (tx) => {
      await tx.insert('stockmoves', { productId, date: now.date, qty: kind === 'in' ? n : -n, kind, note: V.text(note, { max: 80 }), cost: ek });
      await tx.update('products', productId, { stock: p.stock + (kind === 'in' ? n : -n), ...(kind === 'in' ? { cost: ek } : {}) });
      await audit(tx, u, kind === 'in' ? 'wareneingang' : 'warenausgang', 'product', productId, `${n} × ${p.name}`);
    });
  },
  async inventory(counts) {
    const u = await requireUser(ADMIN);
    const d = await adapter();
    const prods = await d.list('products');
    const now = nowCologne();
    let changed = 0;
    await d.atomic(async (tx) => {
      for (const p of prods) {
        if (counts[p.id] == null || counts[p.id] === '') continue;
        const n = V.int(counts[p.id], { min: 0, max: 99999, label: `Bestand ${p.name}` });
        if (n === p.stock) continue;
        await tx.insert('stockmoves', { productId: p.id, date: now.date, qty: n - p.stock, kind: 'count', note: 'Inventur', cost: p.cost });
        if (!server(tx)) await tx.update('products', p.id, { stock: n });
        changed++;
      }
      await audit(tx, u, 'inventur', 'products', '', `${changed} Artikel korrigiert`);
    });
    return changed;
  },
  async saveProduct(p) {
    const u = await requireUser(ADMIN);
    const d = await adapter();
    const row = { name: V.text(p.name, { min: 2, max: 80, label: 'Name' }), cat: V.text(p.cat || 'Sonstiges', { max: 40 }), sku: V.text(p.sku, { max: 24 }), price: V.money(p.price, { label: 'Verkaufspreis' }), cost: V.money(p.cost, { label: 'Einkaufspreis' }), vat: Number(V.oneOf(String(p.vat), ['19', '7'], 'Steuersatz')), minStock: V.int(p.minStock, { min: 0, max: 9999, label: 'Mindestbestand' }), active: p.active !== false };
    const r = p.id ? await d.update('products', p.id, row) : await d.insert('products', { ...row, stock: 0, target: row.minStock * 3, order: 99 });
    await audit(d, u, p.id ? 'geändert' : 'angelegt', 'product', r.id, row.name);
    return r;
  },
  async savePackage(p) {
    const u = await requireUser(ADMIN);
    const d = await adapter();
    const items = (p.items || []).filter((i) => i.count > 0).map((i) => ({ serviceId: i.serviceId, count: V.int(i.count, { min: 1, max: 50, label: 'Anzahl' }) }));
    if (!items.length) throw new Error('Mindestens eine Leistung ins Paket.');
    const row = { name: V.text(p.name, { min: 2, max: 80, label: 'Name' }), price: V.money(p.price, { min: 100, label: 'Paketpreis' }), vat: 19, validMonths: V.int(p.validMonths, { min: 1, max: 36, label: 'Gültigkeit' }), items, active: p.active !== false };
    const r = p.id ? await d.update('packages', p.id, row) : await d.insert('packages', row);
    await audit(d, u, p.id ? 'geändert' : 'angelegt', 'package', r.id, row.name);
    return r;
  },

  /* ---------- Kunden ---------- */
  async saveClient(c) {
    const u = await requireUser(TEAM);
    const d = await adapter();
    const row = { name: V.name(c.name), phone: V.phone(c.phone), email: V.email(c.email), birthday: c.birthday ? V.date(c.birthday, { label: 'Geburtstag' }) : '', prefs: V.text(c.prefs, { max: 500, multiline: true, label: 'Vorlieben' }), notes: V.text(c.notes, { max: 1000, multiline: true, label: 'Notizen' }), tags: (c.tags || []).map((t) => V.text(t, { max: 24 })).filter(Boolean).slice(0, 6), consent: { email: !!(c.consent && c.consent.email), sms: !!(c.consent && c.consent.sms) } };
    const r = c.id ? await d.update('clients', c.id, row) : await d.insert('clients', { ...row, userId: null });
    await audit(d, u, c.id ? 'geändert' : 'angelegt', 'client', r.id, row.name);
    return r;
  },
  /** Registrierte Online-Kunden ohne Karteikarte bekommen eine (Website-Konten -> Kartei). */
  async syncClients() {
    const d = await adapter();
    const [users, clients] = await Promise.all([d.list('users'), d.list('clients')]);
    for (const x of users.filter((x) => x.role === 'customer' && !clients.some((c) => c.userId === x.id))) await d.insert('clients', { name: x.name, phone: x.phone || '', email: x.email, userId: x.id, prefs: '', notes: '', tags: ['Online-Konto'], birthday: '', consent: { email: true, sms: false } });
  },

  /* ---------- Team ---------- */
  async clock(staffId) {
    const u = await requireUser(TEAM);
    if (u.role === 'staff' && u.staffId !== staffId) throw new Error('Nur für dich selbst stempeln.');
    const d = await adapter();
    const now = nowCologne();
    const open = (await d.list('attendance', { staffId, date: now.date })).find((a) => a.out == null);
    if (open) return d.update('attendance', open.id, { out: now.minutes });
    return d.insert('attendance', { staffId, date: now.date, in: now.minutes, out: null });
  },
  async addAbsence({ staffId, from, to, type, note }) {
    const u = await requireUser(ADMIN);
    const d = await adapter();
    from = V.date(from, { label: 'Von' }); to = V.date(to, { label: 'Bis' });
    if (to < from) throw new Error('„Bis“ liegt vor „Von“.');
    type = V.oneOf(type, ['Urlaub', 'Krank', 'Fortbildung', 'Sonstiges'], 'Art');
    const settings = await d.getSettings();
    const group = `ab_${Date.now().toString(36)}`;
    let n = 0;
    await d.atomic(async (tx) => {
      for (let x = from; x <= to; x = addDays(x, 1)) { const h = settings.hours[weekday(x)]; if (!h) continue; await tx.insert('blockers', { staffId, date: x, start: h[0], end: h[1], reason: `${type}${note ? ` · ${V.text(note, { max: 60 })}` : ''}`, kind: 'absence', absenceType: type, group }); n++; }
      await audit(tx, u, 'abwesenheit', 'staff', staffId, `${type} ${from} – ${to}`);
    });
    return n;
  },
  async removeAbsence(group) {
    await requireUser(ADMIN);
    const d = await adapter();
    const bl = (await d.list('blockers')).filter((b) => b.group === group);
    await d.atomic(async (tx) => { for (const b of bl) await tx.remove('blockers', b.id); });
  },
  async saveBreak(staffId, br) {
    await requireUser(ADMIN);
    const d = await adapter();
    if (br && !(br[1] > br[0])) throw new Error('Pausenende muss nach dem Beginn liegen.');
    return d.update('staff', staffId, { breaks: br ? { all: br } : null });
  },

  /* ---------- Buchhaltung ---------- */
  async closeMonth(month, staffName) {
    const u = await requireUser(ADMIN);
    const d = await adapter();
    month = V.month(month);
    const now = nowCologne();
    if (month >= now.date.slice(0, 7)) throw new Error('Abschließen geht erst nach Monatsende.');
    const db = await d.dump(['transactions', 'cashmoves', 'closings', 'vouchers']);
    if (db.closings.some((c) => c.month === month)) throw new Error('Dieser Monat ist bereits abgeschlossen.');
    const prev = addMonth(month, -1);
    if (db.transactions.some((t) => t.month === prev) && !db.closings.some((c) => c.month === prev)) throw new Error(`Bitte zuerst ${prev.split('-').reverse().join('/')} abschließen.`);
    const rep = monthReport({ txs: db.transactions, moves: db.cashmoves, month, staffName, vouchers: db.vouchers, today: now.date });
    const ids = db.transactions.filter((t) => t.month === month).map((t) => `${t.no}:${t.totals.due}`).join('|');
    if (server(d)) return d.rpc('close_month', { p_month: month });
    const hash = await sha256(ids);
    return d.atomic(async (tx) => {
      const c = await tx.insert('closings', { month, lockedAt: new Date().toISOString(), by: u.id, byName: u.name, totals: { gross: rep.revenue.gross, net: rep.revenue.net, tax: rep.revenue.tax, tips: rep.tipsTotal, bons: rep.bons, cashClosing: rep.cash.closing }, hash });
      await audit(tx, u, 'monatsabschluss', 'closing', c.id, `${month} gesperrt · Prüfsumme ${hash.slice(0, 12)}`);
      return c;
    });
  },
  async logExport(month, what) { const u = await requireUser(ADMIN); await audit(await adapter(), u, 'export', 'month', month, what); },
  async saveBizSettings(patch) {
    const u = await requireUser(ADMIN);
    const d = await adapter();
    const cur = await d.getSettings();
    const out = {};
    if (patch.business) { const b = patch.business; out.business = { ...cur.business, name: V.text(b.name, { min: 2, max: 60, label: 'Firmenname' }), owner: V.text(b.owner, { max: 80 }), street: V.text(b.street, { min: 3, max: 80, label: 'Straße' }), zip: V.digits(b.zip, { min: 5, max: 5, label: 'PLZ', optional: false }), city: V.text(b.city, { min: 2, max: 60, label: 'Ort' }), phone: V.phone(b.phone), email: V.email(b.email), taxNo: V.text(b.taxNo, { max: 30 }), vatId: V.text(b.vatId, { max: 20 }), register: V.text(b.register, { max: 40 }), footer: V.text(b.footer, { max: 120 }) }; }
    if (patch.datev) { const x = patch.datev; out.datev = { ...cur.datev, consultant: V.digits(x.consultant, { min: 4, max: 7, label: 'Beraternummer' }), client: V.digits(x.client, { min: 1, max: 5, label: 'Mandantennummer' }), skr: V.oneOf(x.skr, ['03', '04'], 'Kontenrahmen'), fyStartMonth: V.int(x.fyStartMonth || 1, { min: 1, max: 12, label: 'WJ-Beginn' }), accounts: Object.fromEntries(Object.entries(x.accounts || {}).filter(([, v]) => v !== '' && v != null).map(([k, v]) => [k, Number(V.digits(String(v), { min: 4, max: 8, label: `Konto ${k}` }))])) }; }
    if (patch.pay) out.pay = { ...cur.pay, ...Object.fromEntries(Object.entries(patch.pay).map(([k, v]) => [k, !!v])), online: false };
    if (patch.security) out.security = { idleMinutes: V.int(patch.security.idleMinutes, { min: 5, max: 120, label: 'Auto-Logout' }) };
    if (patch.vouchers) out.vouchers = { ...cur.vouchers, onlineSale: false, validityYears: 3 };
    const r = await d.saveSettings(out);
    await audit(d, u, 'einstellungen', 'settings', '', Object.keys(out).join(', '));
    return r;
  },
  async saveStat(s) { const u = await requireUser(ADMIN); const d = await adapter(); const row = { name: V.text(s.name, { min: 2, max: 60, label: 'Name' }), metric: s.metric, group: s.group, split: s.split || '', period: s.period, view: V.oneOf(s.view, ['table', 'chart'], 'Darstellung') }; const r = s.id ? await d.update('stats', s.id, row) : await d.insert('stats', row); await audit(d, u, 'statistik', 'stats', r.id, row.name); return r; },
  async removeStat(id) { await requireUser(ADMIN); return (await adapter()).remove('stats', id); },
  async markNoShow(apptId) { const u = await requireUser(TEAM); const d = await adapter(); const a = await d.update('appointments', apptId, { status: 'noshow', history: [...((await d.get('appointments', apptId)).history || []), { at: new Date().toISOString(), by: 'admin', what: 'nicht erschienen' }] }); await audit(d, u, 'no-show', 'appointment', apptId, a.name); return a; },
  async logLogin() { const u = await requireUser(TEAM); await audit(await adapter(), u, 'anmeldung', 'session', '', u.role); },
};

function addMonthDate(iso, n) { const ym = addMonth(iso.slice(0, 7), n); const [y, m] = ym.split('-').map(Number); const last = new Date(Date.UTC(y, m, 0)).getUTCDate(); return `${ym}-${String(Math.min(Number(iso.slice(8)), last)).padStart(2, '0')}`; }
