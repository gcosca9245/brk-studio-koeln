/* BRK Studio Plattform – Datenschicht „supabase“ (vorbereitet, INAKTIV)
   Gleiche Schnittstelle wie adapters/local.js, spricht Supabase Auth + PostgREST per fetch an
   (keine externe Bibliothek). Aktivierung: supabase/schema.sql einspielen, in config.js
   url + anonKey eintragen und adapter: 'supabase' setzen.
   Passwörter verwaltet Supabase Auth (bcrypt), Rechte erzwingen die RLS-Policies im Schema.
   Spaltennamen: snake_case in der Datenbank, camelCase in der App (Umwandlung unten).
   Sicherheit: Im Browser steht nur der öffentliche anon key; was ein Konto darf, entscheiden
   RLS-Policies und Trigger in supabase/schema.sql. Kassieren, Storno und Monatsabschluss laufen
   über die Datenbankfunktionen create_bon, void_bon und close_month (pult-api.js).
   CSRF: Es gibt keine Auth-Cookies. Jede Anfrage trägt das JWT im Authorization-Header, das eine
   fremde Seite nicht mitsenden kann. */

const SKEY = 'brk.sb.session';
const camel = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()), v]));
const snake = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`), v]));
const TABLE = {
  staff: 'staff', services: 'services', users: 'profiles', appointments: 'appointments', blockers: 'blockers', reviews: 'reviews',
  clients: 'clients', products: 'products', packages: 'packages', packageCards: 'package_cards', resources: 'resources',
  transactions: 'transactions', cashmoves: 'cashmoves', stockmoves: 'stockmoves', vouchers: 'vouchers', installments: 'installments',
  attendance: 'attendance', closings: 'closings', audit: 'audit_log', stats: 'stats',
};
// Öffentliche Einstellungen (Website) liegen in settings, interne (Firma, DATEV, Kasse) in settings_private
const PUBLIC_SETTINGS = ['hours', 'step', 'leadMinutes', 'horizonDays', 'cancelHours', 'closedDates'];
const PAGE = 1000;

export function createSupabaseAdapter({ url, anonKey }) {
  if (!url || !anonKey) throw new Error('Supabase ist nicht konfiguriert (config.js).');
  const session = () => { try { return JSON.parse(localStorage.getItem(SKEY) || 'null'); } catch (_) { return null; } };
  const headers = (extra = {}) => {
    const s = session();
    return { apikey: anonKey, Authorization: `Bearer ${s ? s.access_token : anonKey}`, 'Content-Type': 'application/json', ...extra };
  };
  async function req(path, opts = {}) {
    const res = await fetch(`${url}${path}`, { ...opts, headers: headers(opts.headers) });
    if (res.status === 401 && session()) { await refresh(); return req(path, opts); }
    const body = res.status === 204 ? null : await res.json().catch(() => null);
    if (!res.ok) throw new Error((body && (body.message || body.msg || body.error_description)) || `Fehler ${res.status}`);
    return body;
  }
  async function refresh() {
    const s = session(); if (!s) return;
    const r = await fetch(`${url}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', headers: { apikey: anonKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: s.refresh_token }) });
    if (r.ok) localStorage.setItem(SKEY, JSON.stringify(await r.json())); else localStorage.removeItem(SKEY);
  }
  const rest = (t) => { if (!TABLE[t]) throw new Error(`Unbekannte Tabelle: ${t}`); return `/rest/v1/${TABLE[t]}`; };
  const enc = (v) => encodeURIComponent(String(v));

  return {
    name: 'supabase',
    async signUp({ name, email, phone, password }) {
      const r = await req('/auth/v1/signup', { method: 'POST', body: JSON.stringify({ email, password, data: { name, phone } }) });
      if (r.access_token) localStorage.setItem(SKEY, JSON.stringify(r));
      return this.getUser();
    },
    async signIn(email, password) {
      const r = await req('/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email, password }) });
      localStorage.setItem(SKEY, JSON.stringify(r));
      window.dispatchEvent(new CustomEvent('brk:auth'));
      return this.getUser();
    },
    async signOut() { try { await req('/auth/v1/logout', { method: 'POST' }); } finally { localStorage.removeItem(SKEY); window.dispatchEvent(new CustomEvent('brk:auth')); } },
    async getUser() {
      const s = session(); if (!s) return null;
      const rows = await req(`${rest('users')}?id=eq.${enc(s.user.id)}&select=*`);
      return rows && rows[0] ? camel(rows[0]) : null;
    },
    async updateProfile(id, patch) {
      if (patch.password) await req('/auth/v1/user', { method: 'PUT', body: JSON.stringify({ password: patch.password }) });
      const { password, ...rest2 } = patch;
      const rows = await req(`${rest('users')}?id=eq.${enc(id)}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(snake(rest2)) });
      return camel(rows[0]);
    },
    async deleteUser() { await req('/rest/v1/rpc/delete_own_account', { method: 'POST', body: '{}' }); localStorage.removeItem(SKEY); },
    async list(table, filter = {}) {
      const q = Object.entries(snake(filter)).map(([k, v]) => `${k}=eq.${enc(v)}`).join('&');
      const out = [];
      for (let from = 0; ; from += PAGE) {   // PostgREST liefert höchstens 1000 Zeilen je Anfrage
        const rows = await req(`${rest(table)}?select=*${q ? `&${q}` : ''}&order=id`, { headers: { Range: `${from}-${from + PAGE - 1}`, 'Range-Unit': 'items' } });
        out.push(...rows.map(camel));
        if (rows.length < PAGE) return out;
      }
    },
    async dump(tables) { return Object.fromEntries(await Promise.all(tables.map(async (t) => [t, await this.list(t).catch(() => [])]))); },
    async get(table, id) { const r = await req(`${rest(table)}?id=eq.${enc(id)}&select=*`); return r[0] ? camel(r[0]) : null; },
    async insert(table, row) {
      // Termine laufen über die RPC book_appointment: Prüfung + Exklusions-Constraint gegen Doppelbuchung
      if (table === 'appointments' && (await this.getUser() || {}).role === 'customer') return camel(await req('/rest/v1/rpc/book_appointment', { method: 'POST', body: JSON.stringify(snake(row)) }));
      const { id, ...r } = row;
      return camel((await req(rest(table), { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(snake(r)) }))[0]);
    },
    async update(table, id, patch) {
      const { id: _i, ...p } = patch;
      const rows = await req(`${rest(table)}?id=eq.${enc(id)}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(snake(p)) });
      if (!rows || !rows[0]) throw new Error('Keine Berechtigung oder Eintrag nicht gefunden.');
      return camel(rows[0]);
    },
    async remove(table, id) { await req(`${rest(table)}?id=eq.${enc(id)}`, { method: 'DELETE' }); },
    /** Geprüfte Datenbankfunktion aufrufen (create_bon, void_bon, close_month, log_event …) */
    async rpc(name, args = {}) {
      if (!/^[a-z_]+$/.test(name)) throw new Error('Ungültige Funktion.');
      const r = await req(`/rest/v1/rpc/${name}`, { method: 'POST', body: JSON.stringify(args) });
      return r && typeof r === 'object' && !Array.isArray(r) ? camel(r) : r;
    },
    /** Ohne Server-Transaktion: nur für Stammdaten. Geld und Bestand laufen über rpc() bzw. Trigger. */
    async atomic(fn) { return fn(this); },
    async getSettings() {
      const pub = (await req('/rest/v1/settings?id=eq.1&select=data'))[0].data;
      const priv = session() ? await req('/rest/v1/settings_private?id=eq.1&select=data').then((r) => (r[0] ? r[0].data : {})).catch(() => ({})) : {};
      return { ...priv, ...pub };
    },
    async saveSettings(s) {
      const pubPatch = Object.fromEntries(Object.entries(s).filter(([k]) => PUBLIC_SETTINGS.includes(k)));
      const privPatch = Object.fromEntries(Object.entries(s).filter(([k]) => !PUBLIC_SETTINGS.includes(k)));
      if (Object.keys(pubPatch).length) { const cur = (await req('/rest/v1/settings?id=eq.1&select=data'))[0].data; await req('/rest/v1/settings?id=eq.1', { method: 'PATCH', body: JSON.stringify({ data: { ...cur, ...pubPatch } }) }); }
      if (Object.keys(privPatch).length) { const cur = (await req('/rest/v1/settings_private?id=eq.1&select=data'))[0].data; await req('/rest/v1/settings_private?id=eq.1', { method: 'PATCH', body: JSON.stringify({ data: { ...cur, ...privPatch } }) }); }
      return this.getSettings();
    },
    async busy(fromDate, toDate) { return (await req('/rest/v1/rpc/busy_slots', { method: 'POST', body: JSON.stringify({ from_date: fromDate, to_date: toDate }) })).map(camel); },
    async reset() { throw new Error('Im Livebetrieb nicht verfügbar.'); },
  };
}
