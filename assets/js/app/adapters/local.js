/* BRK Studio Plattform – Datenschicht „local“ (Demo)
   Speichert alles als JSON in localStorage dieses Browsers. Gleiche Schnittstelle wie adapters/supabase.js.
   Hinweis: Ohne Server sind alle Prüfungen clientseitig und damit nicht manipulationssicher. */
import { buildSeed, STAFF_USER } from '../seed.js';
import { buildPultSeed } from '../seed-pult.js';
import { nowCologne, uid, normEmail, hashPassword, verifyPassword, weekday, addDays } from '../util.js';

const KEY = 'brk.platform.v1';
const SKEY = 'brk.session.v1';
const SESSION_HOURS = 8;
const TEAM_SESSION_HOURS = 4; // Team-Konten: kürzere absolute Sitzung, dazu Auto-Logout bei Inaktivität im Pult
const AKEY = 'brk.attempts.v1';
const PULT_TABLES = ['clients', 'products', 'packages', 'packageCards', 'resources', 'transactions', 'cashmoves', 'stockmoves', 'vouchers', 'installments', 'attendance', 'closings', 'audit', 'stats'];
const TABLES = ['staff', 'services', 'users', 'appointments', 'blockers', 'reviews', ...PULT_TABLES];
// Nur anhängen (GoBD): Belege, Kassenbuch, Lagerbewegungen, Abschlüsse und Protokoll werden nie geändert oder gelöscht.
const APPEND_ONLY = new Set(['transactions', 'cashmoves', 'stockmoves', 'closings', 'audit']);
const PULT_VERSION = 2;

/** Kasse, Kunden, Lager usw. ergänzen – auch für Browser, die schon Daten der Plattform v1 haben. */
function migrate(d) {
  if (d.pult === PULT_VERSION) return false;
  const n = nowCologne();
  const p = buildPultSeed(n.date, d, n.minutes);
  for (const t of PULT_TABLES) d[t] = p[t];
  d.appointments = [...d.appointments, ...p.appointments.filter((a) => !d.appointments.some((x) => x.id === a.id))];
  d.staff.forEach((st) => { if (!st.breaks && p.breaks[st.id]) st.breaks = { all: p.breaks[st.id] }; if (!st.resourceId && p.resFor[st.id]) st.resourceId = p.resFor[st.id]; if (!st.color) st.color = st.id === 'st_burak' ? 'ink' : 'ash'; });
  d.services.forEach((s) => { if (s.vat == null) s.vat = 19; if (!s.resourceType) s.resourceType = ['sv_bal', 'sv_str'].includes(s.id) ? 'color' : 'chair'; });
  if (!d.users.some((u) => u.id === STAFF_USER.id)) d.users.push(STAFF_USER);
  d.counters = { bon: p.counters.bon };
  d.settings = {
    ...d.settings,
    business: { name: 'BRK Studio', owner: '[Vollständiger Name des Inhabers]', street: 'Fleischmengergasse 29', zip: '50676', city: 'Köln', phone: '', email: '', taxNo: '[Steuernummer]', vatId: '', register: 'Kasse 1 · Demo', footer: 'Danke für deinen Besuch. Bis zum nächsten Mal.' },
    datev: { consultant: '1001', client: '10101', skr: '03', fyStartMonth: 1, accounts: {} },
    pay: { cash: true, card: true, voucher: true, deposit: true, installment: true, online: false },
    stripe: { enabled: false, publishableKey: '' },
    vouchers: { onlineSale: false, validityYears: 3 },
    security: { idleMinutes: 20 },
    ...(d.settings || {}),
  };
  d.pult = PULT_VERSION;
  return true;
}
function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) { const d = JSON.parse(raw); if (d && d.version === 1) { if (migrate(d)) save(d, true); return d; } }
  } catch (_) { /* defekt -> neu */ }
  const d = buildSeed(nowCologne().date);
  migrate(d);
  save(d, true);
  return d;
}
function save(d, quiet) {
  try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) { throw new Error('Der Speicher dieses Browsers ist voll. Bitte „Demo zurücksetzen“.'); }
  if (!quiet) window.dispatchEvent(new CustomEvent('brk:data'));
}
const clone = (x) => JSON.parse(JSON.stringify(x));
const publicUser = (u) => u && { id: u.id, role: u.role, staffId: u.staffId || null, name: u.name, email: u.email, phone: u.phone, example: !!u.example };

// Fehlversuche pro E-Mail, überlebt Neuladen: 5 Fehlversuche -> 30 s, 10 -> 5 min Sperre.
// Nur ein Bremsklotz in der Demo; echte Ratenbegrenzung macht Supabase Auth serverseitig.
const attempts = {
  all() { try { return JSON.parse(localStorage.getItem(AKEY) || '{}'); } catch (_) { return {}; } },
  get(k) { return this.all()[k]; },
  set(k, v) { const a = this.all(); a[k] = v; localStorage.setItem(AKEY, JSON.stringify(a)); },
  delete(k) { const a = this.all(); delete a[k]; localStorage.setItem(AKEY, JSON.stringify(a)); },
};

export function createLocalAdapter() {
  let data = load();
  // Änderungen aus anderen Tabs übernehmen (z. B. Website offen, Admin bucht)
  window.addEventListener('storage', (e) => { if (e.key === KEY) { data = load(); window.dispatchEvent(new CustomEvent('brk:data')); } });
  let batching = false;
  const commit = () => { if (!batching) save(data); };

  return {
    name: 'local',
    /* ---------- Auth ---------- */
    async signUp({ name, email, phone, password }) {
      email = normEmail(email);
      if (data.users.some((u) => u.email === email)) throw new Error('Zu dieser E-Mail gibt es schon ein Konto.');
      const user = { id: uid('us'), role: 'customer', name: name.trim(), email, phone: phone.trim(), createdAt: new Date().toISOString(), pass: await hashPassword(password) };
      data.users.push(user); commit();
      this._setSession(user);
      return publicUser(user);
    },
    async signIn(email, password) {
      email = normEmail(email);
      const a = attempts.get(email) || { n: 0, total: 0, until: 0 };
      if (a.until > Date.now()) { const sec = Math.ceil((a.until - Date.now()) / 1000); throw new Error(`Zu viele Versuche. Bitte in ${sec > 90 ? `${Math.ceil(sec / 60)} Minuten` : `${sec} Sekunden`} erneut.`); }
      const user = data.users.find((u) => u.email === email);
      const ok = user ? await verifyPassword(password, user.pass) : (await hashPassword(password), false);
      if (!ok) {
        a.n += 1; a.total = (a.total || 0) + 1;
        if (a.n >= 5) { a.until = Date.now() + (a.total >= 10 ? 300000 : 30000); a.n = 0; }
        attempts.set(email, a);
        throw new Error('E-Mail oder Passwort stimmt nicht.');
      }
      attempts.delete(email);
      this._setSession(user);
      return publicUser(user);
    },
    async signOut() { localStorage.removeItem(SKEY); window.dispatchEvent(new CustomEvent('brk:auth')); },
    async getUser() {
      try {
        const s = JSON.parse(localStorage.getItem(SKEY) || 'null');
        if (!s || s.exp < Date.now()) return null;
        return publicUser(data.users.find((u) => u.id === s.uid)) || null;
      } catch (_) { return null; }
    },
    _setSession(user) { localStorage.setItem(SKEY, JSON.stringify({ uid: user.id, exp: Date.now() + (user.role === 'customer' ? SESSION_HOURS : TEAM_SESSION_HOURS) * 3600000 })); window.dispatchEvent(new CustomEvent('brk:auth')); },
    async updateProfile(id, patch) {
      const u = data.users.find((x) => x.id === id); if (!u) throw new Error('Konto nicht gefunden.');
      if (patch.name != null) u.name = patch.name.trim();
      if (patch.phone != null) u.phone = patch.phone.trim();
      if (patch.password) u.pass = await hashPassword(patch.password);
      commit(); return publicUser(u);
    },
    async deleteUser(id) {
      data.users = data.users.filter((u) => u.id !== id);
      data.appointments.forEach((a) => { if (a.customerId === id) { a.customerId = null; a.name = 'Gelöschtes Konto'; a.phone = ''; } });
      data.reviews.forEach((r) => { if (r.customerId === id) r.customerId = null; });
      commit();
    },

    /* ---------- Tabellen ---------- */
    async list(table, filter = {}) {
      if (!TABLES.includes(table)) throw new Error('Unbekannte Tabelle');
      let rows = data[table];
      if (table === 'users') rows = rows.map(publicUser);
      return clone(rows.filter((r) => Object.entries(filter).every(([k, v]) => r[k] === v)));
    },
    async get(table, id) { const r = data[table].find((x) => x.id === id); return r ? clone(table === 'users' ? publicUser(r) : r) : null; },
    /** Mehrere Tabellen in einem Rutsch (Studio-Pult). */
    async dump(tables) { const o = {}; for (const t of tables) { if (!TABLES.includes(t)) throw new Error('Unbekannte Tabelle'); o[t] = clone(t === 'users' ? data[t].map(publicUser) : data[t]); } return o; },
    async insert(table, row) {
      if (!TABLES.includes(table)) throw new Error('Unbekannte Tabelle');
      // wie Trigger in supabase/schema.sql: abgeschlossene Monate sind gesperrt, Bonnummer fortlaufend
      if (['transactions', 'cashmoves', 'stockmoves'].includes(table) && data.closings.some((c) => c.month === String(row.date).slice(0, 7))) throw new Error(`Der Monat ${String(row.date).slice(0, 7)} ist abgeschlossen. Nur Korrekturbuchungen im laufenden Monat sind möglich.`);
      if (table === 'closings' && data.closings.some((c) => c.month === row.month)) throw new Error('Dieser Monat ist bereits abgeschlossen.');
      const r = { id: row.id || uid(table.slice(0, 2)), createdAt: new Date().toISOString(), ...row };
      if (table === 'transactions') { data.counters = data.counters || { bon: 0 }; r.no = ++data.counters.bon; }
      data[table].push(r); commit(); return clone(r);
    },
    /** Mehrere Schritte als eine Buchung: alles oder nichts (wie eine DB-Transaktion / RPC). */
    async atomic(fn) {
      const before = JSON.stringify(data);
      batching = true;
      try { const r = await fn(this); batching = false; save(data); return r; } catch (e) { batching = false; data = JSON.parse(before); throw e; }
    },
    async update(table, id, patch) {
      if (APPEND_ONLY.has(table)) throw new Error('Belege und Buchungen sind unveränderlich. Bitte Storno oder Korrektur buchen.');
      const r = data[table].find((x) => x.id === id); if (!r) throw new Error('Nicht gefunden.'); Object.assign(r, patch); commit(); return clone(r);
    },
    async remove(table, id) {
      if (APPEND_ONLY.has(table)) throw new Error('Belege und Buchungen können nicht gelöscht werden.');
      data[table] = data[table].filter((x) => x.id !== id); commit();
    },
    async getSettings() { return clone(data.settings); },
    async saveSettings(s) { data.settings = { ...data.settings, ...s }; commit(); return clone(data.settings); },

    /** Öffentliche Belegung ohne personenbezogene Daten (wie die RPC busy_slots in Supabase). */
    async busy(fromDate, toDate) {
      const out = [];
      for (const a of data.appointments) if (a.status === 'booked' && a.date >= fromDate && a.date <= toDate) out.push({ id: a.id, staffId: a.staffId, date: a.date, start: a.start, end: a.start + a.duration });
      for (const b of data.blockers) if (b.date >= fromDate && b.date <= toDate) out.push({ id: b.id, staffId: b.staffId || null, date: b.date, start: b.start, end: b.end });
      // tägliche Pausen der Mitarbeiter
      for (let d = fromDate; d <= toDate; d = addDays(d, 1)) for (const st of data.staff) {
        const br = st.breaks && (st.breaks[weekday(d)] || st.breaks.all);
        if (br && data.settings.hours[weekday(d)]) out.push({ id: `br_${st.id}_${d}`, staffId: st.id, date: d, start: br[0], end: br[1], kind: 'pause' });
      }
      return out;
    },
    async reset() { localStorage.removeItem(KEY); localStorage.removeItem(SKEY); data = load(); window.dispatchEvent(new CustomEvent('brk:auth')); },
  };
}
