/* BRK Studio Plattform – Datenschicht „local“ (Demo)
   Speichert alles als JSON in localStorage dieses Browsers. Gleiche Schnittstelle wie adapters/supabase.js.
   Hinweis: Ohne Server sind alle Prüfungen clientseitig und damit nicht manipulationssicher. */
import { buildSeed } from '../seed.js';
import { nowCologne, uid, normEmail, hashPassword, verifyPassword } from '../util.js';

const KEY = 'brk.platform.v1';
const SKEY = 'brk.session.v1';
const SESSION_HOURS = 8;
const TABLES = ['staff', 'services', 'users', 'appointments', 'blockers', 'reviews'];

function load() {
  try { const raw = localStorage.getItem(KEY); if (raw) { const d = JSON.parse(raw); if (d && d.version === 1) return d; } } catch (_) { /* defekt -> neu */ }
  const d = buildSeed(nowCologne().date);
  save(d);
  return d;
}
function save(d) { localStorage.setItem(KEY, JSON.stringify(d)); window.dispatchEvent(new CustomEvent('brk:data')); }
const clone = (x) => JSON.parse(JSON.stringify(x));
const publicUser = (u) => u && { id: u.id, role: u.role, name: u.name, email: u.email, phone: u.phone, example: !!u.example };

// Fehlversuche pro E-Mail (einfacher Schutz gegen Durchprobieren)
const attempts = new Map();

export function createLocalAdapter() {
  let data = load();
  // Änderungen aus anderen Tabs übernehmen (z. B. Website offen, Admin bucht)
  window.addEventListener('storage', (e) => { if (e.key === KEY) { data = load(); window.dispatchEvent(new CustomEvent('brk:data')); } });
  const commit = () => save(data);

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
      const a = attempts.get(email) || { n: 0, until: 0 };
      if (a.until > Date.now()) throw new Error(`Zu viele Versuche. Bitte in ${Math.ceil((a.until - Date.now()) / 1000)} Sekunden erneut.`);
      const user = data.users.find((u) => u.email === email);
      const ok = user ? await verifyPassword(password, user.pass) : (await hashPassword(password), false);
      if (!ok) {
        a.n += 1; if (a.n >= 5) { a.until = Date.now() + 30000; a.n = 0; }
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
    _setSession(user) { localStorage.setItem(SKEY, JSON.stringify({ uid: user.id, exp: Date.now() + SESSION_HOURS * 3600000 })); window.dispatchEvent(new CustomEvent('brk:auth')); },
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
    async insert(table, row) { const r = { id: row.id || uid(table.slice(0, 2)), createdAt: new Date().toISOString(), ...row }; data[table].push(r); commit(); return clone(r); },
    async update(table, id, patch) { const r = data[table].find((x) => x.id === id); if (!r) throw new Error('Nicht gefunden.'); Object.assign(r, patch); commit(); return clone(r); },
    async remove(table, id) { data[table] = data[table].filter((x) => x.id !== id); commit(); },
    async getSettings() { return clone(data.settings); },
    async saveSettings(s) { data.settings = { ...data.settings, ...s }; commit(); return clone(data.settings); },

    /** Öffentliche Belegung ohne personenbezogene Daten (wie die RPC busy_slots in Supabase). */
    async busy(fromDate, toDate) {
      const out = [];
      for (const a of data.appointments) if (a.status === 'booked' && a.date >= fromDate && a.date <= toDate) out.push({ id: a.id, staffId: a.staffId, date: a.date, start: a.start, end: a.start + a.duration });
      for (const b of data.blockers) if (b.date >= fromDate && b.date <= toDate) out.push({ id: b.id, staffId: b.staffId || null, date: b.date, start: b.start, end: b.end });
      return out;
    },
    async reset() { localStorage.removeItem(KEY); localStorage.removeItem(SKEY); data = load(); window.dispatchEvent(new CustomEvent('brk:auth')); },
  };
}
