/* BRK Studio Plattform – Fachlogik über dem Adapter
   Website, Buchung, Konto und Admin rufen nur diese Funktionen auf. */
import { CONFIG } from './config.js';
import { createLocalAdapter } from './adapters/local.js';
import { slotsFor, checkSlot, ratingSummary } from './core.js';
import { nowCologne, addDays, cmpDateTime, validEmail, validPhone, passwordProblem } from './util.js';

let db;
export async function adapter() {
  if (db) return db;
  if (CONFIG.adapter === 'supabase') {
    const { createSupabaseAdapter } = await import('./adapters/supabase.js');
    db = createSupabaseAdapter(CONFIG.supabase);
  } else db = createLocalAdapter();
  return db;
}
const sortBy = (k) => (a, b) => (a[k] ?? 0) - (b[k] ?? 0);
const byDateTime = (a, b) => cmpDateTime(a.date, a.start, b.date, b.start);

/** role: 'admin' | 'customer' | ['admin', 'staff'] – im Livebetrieb erzwingt RLS dasselbe serverseitig. */
export async function requireUser(role) {
  const u = await (await adapter()).getUser();
  if (!u) throw new Error('Bitte melde dich an.');
  if (role && !(Array.isArray(role) ? role.includes(u.role) : u.role === role)) throw new Error('Keine Berechtigung.');
  return u;
}
const TEAM = ['admin', 'staff'];

export const api = {
  get demo() { return CONFIG.adapter === 'local'; },
  now: nowCologne,

  /* ---------- Katalog ---------- */
  async catalog() {
    const d = await adapter();
    const [staff, services, settings] = await Promise.all([d.list('staff'), d.list('services'), d.getSettings()]);
    return { staff: staff.sort(sortBy('order')), services: services.sort(sortBy('order')), settings };
  },

  /* ---------- Verfügbarkeit (Website, Buchung, Verschieben) ---------- */
  async slots({ serviceId, staffId = 'any', date, excludeId }) {
    const d = await adapter();
    const { staff, services, settings } = await this.catalog();
    const service = services.find((s) => s.id === serviceId && s.active !== false);
    const busy = await d.busy(date, date);
    return slotsFor({ service, staffId, date, data: { staff, settings, busy }, now: nowCologne(), excludeId });
  },
  /** Anzahl freier Startzeiten je Tag (für die Tagesleiste). */
  async daysOverview({ serviceId, staffId = 'any', from, days = 14, excludeId }) {
    const d = await adapter();
    const { staff, services, settings } = await this.catalog();
    const service = services.find((s) => s.id === serviceId);
    const to = addDays(from, days - 1);
    const busy = await d.busy(from, to);
    const now = nowCologne();
    const out = [];
    for (let i = 0; i < days; i++) {
      const date = addDays(from, i);
      const open = !!settings.hours[new Date(`${date}T12:00:00Z`).getUTCDay()] && !(settings.closedDates || []).includes(date);
      const free = service ? slotsFor({ service, staffId, date, data: { staff, settings, busy }, now, excludeId }).length : null;
      out.push({ date, open, free });
    }
    return out;
  },

  /* ---------- Auth ---------- */
  async user() { return (await adapter()).getUser(); },
  async register({ name, email, phone, password }) {
    const errors = {};
    if (!name || name.trim().length < 2) errors.name = 'Bitte gib deinen Namen an.';
    if (!validEmail(email)) errors.email = 'Bitte gib eine gültige E-Mail an.';
    if (!validPhone(phone)) errors.phone = 'Bitte gib eine Telefonnummer an, z. B. 0171 2345678.';
    const pw = passwordProblem(password || '', email || ''); if (pw) errors.password = pw;
    if (Object.keys(errors).length) { const e = new Error('Bitte prüfe deine Angaben.'); e.fields = errors; throw e; }
    return (await adapter()).signUp({ name, email, phone, password });
  },
  async login(email, password) { return (await adapter()).signIn(email, password); },
  async logout() { return (await adapter()).signOut(); },
  async updateProfile(patch) { const u = await requireUser(); if (patch.password) { const p = passwordProblem(patch.password, u.email); if (p) throw new Error(p); } return (await adapter()).updateProfile(u.id, patch); },
  async deleteAccount() { const u = await requireUser('customer'); await (await adapter()).deleteUser(u.id); await this.logout(); },

  /* ---------- Buchen (Kunde) ---------- */
  async book({ serviceId, staffId, date, start, note }) {
    const u = await requireUser();
    const d = await adapter();
    const { staff, services, settings } = await this.catalog();
    const service = services.find((s) => s.id === serviceId);
    const busy = await d.busy(date, date);
    // „Egal“: ersten freien Mitarbeiter zu dieser Zeit nehmen
    let st = staff.find((s) => s.id === staffId);
    if (!st) { const slot = slotsFor({ service, staffId: 'any', date, data: { staff, settings, busy }, now: nowCologne() }).find((x) => x.start === start); st = slot && staff.find((s) => s.id === slot.staffIds[0]); }
    const problem = checkSlot({ service, staff: st, date, start, data: { settings, busy }, now: nowCologne() });
    if (problem) throw new Error(problem);
    return d.insert('appointments', { date, start, duration: service.duration, serviceId, staffId: st.id, customerId: u.id, name: u.name, phone: u.phone, note: (note || '').slice(0, 500), status: 'booked', source: 'customer', history: [{ at: new Date().toISOString(), by: 'customer', what: 'gebucht' }] });
  },
  async myAppointments() {
    const u = await requireUser();
    return (await (await adapter()).list('appointments', { customerId: u.id })).sort(byDateTime);
  },
  /** Storno durch Kunden bis cancelHours vor Beginn. */
  async cancelMine(id) {
    const u = await requireUser();
    const d = await adapter();
    const a = await d.get('appointments', id);
    if (!a || a.customerId !== u.id) throw new Error('Termin nicht gefunden.');
    if (!this.canChange(a, (await d.getSettings()).cancelHours)) throw new Error('Kurzfristige Änderungen bitte telefonisch.');
    return d.update('appointments', id, { status: 'cancelled', history: [...(a.history || []), { at: new Date().toISOString(), by: 'customer', what: 'storniert' }] });
  },
  async rescheduleMine(id, { date, start, staffId }) {
    const u = await requireUser();
    const d = await adapter();
    const a = await d.get('appointments', id);
    if (!a || a.customerId !== u.id) throw new Error('Termin nicht gefunden.');
    const { staff, services, settings } = await this.catalog();
    if (!this.canChange(a, settings.cancelHours)) throw new Error('Kurzfristige Änderungen bitte telefonisch.');
    const service = services.find((s) => s.id === a.serviceId);
    const busy = await d.busy(date, date);
    let st = staff.find((s) => s.id === (staffId || a.staffId));
    const free = slotsFor({ service, staffId: staffId || 'any', date, data: { staff, settings, busy }, now: nowCologne(), excludeId: id }).find((x) => x.start === start);
    if (!staffId && free && !free.staffIds.includes(st.id)) st = staff.find((s) => s.id === free.staffIds[0]);
    const problem = checkSlot({ service, staff: st, date, start, data: { settings, busy }, now: nowCologne(), excludeId: id });
    if (problem) throw new Error(problem);
    return d.update('appointments', id, { date, start, staffId: st.id, history: [...(a.history || []), { at: new Date().toISOString(), by: 'customer', what: `verschoben von ${a.date} ${a.start}` }] });
  },
  canChange(a, cancelHours = 12) {
    const n = nowCologne();
    const mins = (Date.UTC(...a.date.split('-').map((x, i) => (i === 1 ? x - 1 : +x))) - Date.UTC(...n.date.split('-').map((x, i) => (i === 1 ? x - 1 : +x)))) / 60000 + a.start - n.minutes;
    return a.status === 'booked' && mins >= cancelHours * 60;
  },
  isPast(a) { const n = nowCologne(); return cmpDateTime(a.date, a.start + a.duration, n.date, n.minutes) <= 0; },

  /* ---------- Bewertungen ---------- */
  async publicReviews() {
    const d = await adapter();
    const all = await d.list('reviews', { status: 'approved' });
    const sum = ratingSummary(all);
    sum.list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return sum;
  },
  async myReviews() { const u = await requireUser(); return (await adapter()).list('reviews', { customerId: u.id }); },
  async submitReview({ appointmentId, rating, text }) {
    const u = await requireUser('customer');
    const d = await adapter();
    const a = await d.get('appointments', appointmentId);
    if (!a || a.customerId !== u.id || a.status !== 'booked' || !this.isPast(a)) throw new Error('Bewerten kannst du nur eigene, vergangene Termine.');
    if ((await d.list('reviews', { appointmentId })).length) throw new Error('Diesen Termin hast du schon bewertet.');
    rating = Math.round(Number(rating));
    if (!(rating >= 1 && rating <= 5)) throw new Error('Bitte wähle 1 bis 5 Sterne.');
    text = String(text || '').trim();
    if (text.length < 10) throw new Error('Bitte schreib ein paar Worte (mind. 10 Zeichen).');
    const first = u.name.split(' ')[0], last = (u.name.split(' ')[1] || '').charAt(0);
    return d.insert('reviews', { appointmentId, customerId: u.id, staffId: a.staffId, name: `${first}${last ? ` ${last}.` : ''}`, rating, text: text.slice(0, 600), status: 'pending' });
  },

  /* ---------- Admin ---------- */
  admin: {
    async guard() { return requireUser(TEAM); },
    async data(from, to) {
      await requireUser(TEAM);
      const d = await adapter();
      const [appointments, blockers, reviews, users] = await Promise.all([d.list('appointments'), d.list('blockers'), d.list('reviews'), d.list('users')]);
      const inRange = (x) => (!from || x.date >= from) && (!to || x.date <= to);
      return { appointments: appointments.filter(inRange).sort(byDateTime), blockers: blockers.filter(inRange), reviews: reviews.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)), customers: users.filter((u) => u.role === 'customer') };
    },
    async createAppointment({ serviceId, staffId, date, start, name, phone, note, force }) {
      await requireUser(TEAM);
      const d = await adapter();
      const { staff, services, settings } = await api.catalog();
      const service = services.find((s) => s.id === serviceId), st = staff.find((s) => s.id === staffId);
      if (!name || name.trim().length < 2) throw new Error('Bitte einen Namen für den Gast eintragen.');
      const problem = checkSlot({ service, staff: st, date, start, data: { settings, busy: await d.busy(date, date) }, admin: true });
      if (problem && !force) throw new Error(problem);
      return d.insert('appointments', { date, start, duration: service.duration, serviceId, staffId, customerId: null, name: name.trim(), phone: (phone || '').trim(), note: note || '', status: 'booked', source: 'admin', history: [{ at: new Date().toISOString(), by: 'admin', what: 'angelegt' }] });
    },
    async moveAppointment(id, { date, start, staffId }) {
      await requireUser(TEAM);
      const d = await adapter();
      const a = await d.get('appointments', id);
      const { staff, services, settings } = await api.catalog();
      const service = services.find((s) => s.id === a.serviceId), st = staff.find((s) => s.id === (staffId || a.staffId));
      const problem = checkSlot({ service, staff: st, date, start, data: { settings, busy: await d.busy(date, date) }, excludeId: id, admin: true });
      if (problem) throw new Error(problem);
      return d.update('appointments', id, { date, start, staffId: st.id, history: [...(a.history || []), { at: new Date().toISOString(), by: 'admin', what: `verschoben von ${a.date} ${a.start}` }] });
    },
    async cancelAppointment(id) {
      await requireUser(TEAM);
      const d = await adapter(); const a = await d.get('appointments', id);
      return d.update('appointments', id, { status: 'cancelled', history: [...(a.history || []), { at: new Date().toISOString(), by: 'admin', what: 'storniert' }] });
    },
    async saveBlocker(b) {
      await requireUser(TEAM);
      const d = await adapter();
      if (!(b.end > b.start)) throw new Error('Das Ende muss nach dem Beginn liegen.');
      if (b.id) return d.update('blockers', b.id, b);
      return d.insert('blockers', b);
    },
    async removeBlocker(id) { await requireUser(TEAM); return (await adapter()).remove('blockers', id); },
    async saveStaff(s) { await requireUser('admin'); const d = await adapter(); if (!s.name || !s.name.trim()) throw new Error('Name fehlt.'); return s.id ? d.update('staff', s.id, s) : d.insert('staff', { active: true, hours: {}, order: 99, ...s }); },
    async removeStaff(id) {
      await requireUser('admin'); const d = await adapter();
      const n = (await d.list('appointments', { staffId: id })).filter((a) => a.status === 'booked' && !api.isPast(a)).length;
      if (n) throw new Error(`Es gibt noch ${n} offene Termine. Bitte erst verschieben oder deaktivieren.`);
      return d.remove('staff', id);
    },
    async saveService(s) {
      await requireUser('admin'); const d = await adapter();
      if (!s.name || !s.name.trim()) throw new Error('Name fehlt.');
      if (!(s.duration >= 5)) throw new Error('Dauer fehlt.');
      if (!(s.price >= 0)) throw new Error('Preis fehlt.');
      return s.id ? d.update('services', s.id, s) : d.insert('services', { active: true, order: 99, staffIds: [], ...s });
    },
    async removeService(id) { await requireUser('admin'); return (await adapter()).remove('services', id); },
    async setReview(id, status) { await requireUser('admin'); return (await adapter()).update('reviews', id, { status, moderatedAt: new Date().toISOString() }); },
    async saveSettings(s) { await requireUser('admin'); return (await adapter()).saveSettings(s); },
  },
  async resetDemo() { return (await adapter()).reset(); },
};
