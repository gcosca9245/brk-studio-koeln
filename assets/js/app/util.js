/* BRK Studio Plattform – Hilfsfunktionen (Datum in Köln, Formatierung, Sicherheit) */

export const TZ = 'Europe/Berlin';
const pad = (n) => String(n).padStart(2, '0');

/** Aktuelles Datum/Uhrzeit in Köln, unabhängig von der Zeitzone des Geräts. */
export function nowCologne() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t).value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

// Datumsrechnung auf Kalendertagen (UTC-Mittag, keine Sommerzeit-Fallen)
const toUTC = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d, 12)); };
const fromUTC = (dt) => `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
export const addDays = (iso, n) => { const d = toUTC(iso); d.setUTCDate(d.getUTCDate() + n); return fromUTC(d); };
export const weekday = (iso) => toUTC(iso).getUTCDay();             // 0 = Sonntag
export const diffDays = (a, b) => Math.round((toUTC(b) - toUTC(a)) / 86400000);
export const mondayOf = (iso) => addDays(iso, -((weekday(iso) + 6) % 7));
export const cmpDateTime = (d1, m1, d2, m2) => (d1 === d2 ? m1 - m2 : d1 < d2 ? -1 : 1);

export const hhmm = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
export const parseHHMM = (s) => { const [h, m] = String(s).split(':').map(Number); return h * 60 + (m || 0); };

const fmt = (opts) => new Intl.DateTimeFormat('de-DE', { timeZone: 'UTC', ...opts });
const F = {
  long: fmt({ weekday: 'long', day: 'numeric', month: 'long' }),
  longY: fmt({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
  short: fmt({ weekday: 'short', day: 'numeric', month: 'short' }),
  wd: fmt({ weekday: 'short' }),
  wdLong: fmt({ weekday: 'long' }),
  mon: fmt({ month: 'short' }),
  monYear: fmt({ month: 'long', year: 'numeric' }),
  num: fmt({ day: '2-digit', month: '2-digit' }),
};
export const fmtDate = (iso, kind = 'long') => F[kind].format(toUTC(iso)).replace(/\.(?=\s|$)/g, (m, i, s) => (kind === 'short' || kind === 'wd' || kind === 'mon' ? '' : m));
export const fmtDuration = (min) => (min < 60 ? `${min} Min.` : `${Math.floor(min / 60)} Std.${min % 60 ? ` ${min % 60} Min.` : ''}`);

/** Preis in Cent -> „36 €“, Spannen und „ab“ */
export function fmtPrice(svc) {
  const e = (c) => `${(c / 100).toLocaleString('de-DE', { minimumFractionDigits: c % 100 ? 2 : 0 })}\u00a0€`;
  if (svc.priceMode === 'from') return `ab ${e(svc.price)}`;
  if (svc.priceMode === 'range' && svc.priceTo) return `${(svc.price / 100).toLocaleString('de-DE')}–${e(svc.priceTo)}`;
  return e(svc.price);
}

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const uid = (p = 'id') => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
export const normEmail = (s) => String(s || '').trim().toLowerCase();
export const validEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(s || '').trim());
export const validPhone = (s) => /^\+?\d{6,15}$/.test(String(s || '').replace(/[\s()/-]/g, ''));

/* ---------- Passwort-Hashing (PBKDF2-SHA256, 120 000 Iterationen, zufälliges Salz) ---------- */
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const PBKDF2_ITER = 120000;
export async function hashPassword(password, saltB64) {
  const salt = saltB64 ? unb64(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITER }, key, 256);
  return { alg: 'PBKDF2-SHA256', iter: PBKDF2_ITER, salt: b64(salt), hash: b64(bits) };
}
export async function verifyPassword(password, rec) {
  if (!rec || !rec.salt) return false;
  const h = await hashPassword(password, rec.salt);
  // zeitkonstanter Vergleich
  if (h.hash.length !== rec.hash.length) return false;
  let diff = 0;
  for (let i = 0; i < h.hash.length; i++) diff |= h.hash.charCodeAt(i) ^ rec.hash.charCodeAt(i);
  return diff === 0;
}
export const passwordProblem = (p) => (String(p).length < 10 ? 'Mindestens 10 Zeichen.' : !/[A-Za-zÄÖÜäöüß]/.test(p) || !/\d/.test(p) ? 'Bitte Buchstaben und Ziffern kombinieren.' : '');
