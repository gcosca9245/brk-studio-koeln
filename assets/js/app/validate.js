/* BRK Studio – zentrale Eingabeprüfung und Normalisierung
   Alle Formulare im Studio-Pult laufen hierüber. Im Livebetrieb prüfen zusätzlich
   CHECK-Constraints, Trigger und RLS in supabase/schema.sql (Client-Prüfung allein ist nie Schutz). */
import { parseEuro } from './ledger.js';
import { validEmail, validPhone, normEmail } from './util.js';

export class ValidationError extends Error { constructor(msg, field) { super(msg); this.field = field; } }
const fail = (m, f) => { throw new ValidationError(m, f); };
// Steuerzeichen raus, Leerraum zusammenfassen, Unicode normalisieren
const clean = (s) => String(s == null ? '' : s).normalize('NFC').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/g, '');

export const V = {
  text(s, { max = 200, min = 0, field = '', label = 'Text', multiline = false } = {}) {
    let v = clean(s);
    v = multiline ? v.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').trim() : v.replace(/\s+/g, ' ').trim();
    if (v.length < min) fail(min === 1 ? `${label} fehlt.` : `${label}: mindestens ${min} Zeichen.`, field);
    if (v.length > max) fail(`${label}: höchstens ${max} Zeichen.`, field);
    return v;
  },
  name(s, field = 'name') { return V.text(s, { min: 2, max: 80, field, label: 'Name' }); },
  email(s, { optional = true, field = 'email' } = {}) { const v = normEmail(clean(s)); if (!v && optional) return ''; if (!validEmail(v) || v.length > 120) fail('E-Mail-Adresse prüfen.', field); return v; },
  phone(s, { optional = true, field = 'phone' } = {}) { const v = clean(s).replace(/[^\d+ ()/-]/g, '').trim(); if (!v && optional) return ''; if (!validPhone(v)) fail('Telefonnummer prüfen, z. B. 0171 2345678.', field); return v; },
  money(s, { min = 0, max = 10000000, field = 'amount', label = 'Betrag', optional = false } = {}) {
    if ((s === '' || s == null) && optional) return null;
    const c = typeof s === 'number' ? Math.round(s) : parseEuro(s);
    if (c == null) fail(`${label}: bitte als Zahl, z. B. 12,50.`, field);
    if (c < min) fail(`${label} ist zu klein.`, field);
    if (c > max) fail(`${label} ist zu groß.`, field);
    return c;
  },
  int(s, { min = 0, max = 1e6, field = '', label = 'Zahl' } = {}) { const n = Number(String(s).replace(',', '.')); if (!Number.isInteger(n) || n < min || n > max) fail(`${label}: ganze Zahl von ${min} bis ${max}.`, field); return n; },
  date(s, { field = 'date', label = 'Datum' } = {}) { const v = clean(s).trim(); if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(`${v}T12:00:00Z`))) fail(`${label} prüfen.`, field); return v; },
  month(s) { const v = clean(s).trim(); if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) fail('Monat prüfen.'); return v; },
  oneOf(s, list, label = 'Auswahl') { if (!list.includes(s)) fail(`${label} ungültig.`); return s; },
  code(s) { const v = clean(s).toUpperCase().replace(/\s+/g, '').trim(); if (!/^[A-Z0-9-]{4,24}$/.test(v)) fail('Code prüfen (Buchstaben, Ziffern, Bindestrich).', 'code'); return v; },
  digits(s, { min = 1, max = 7, label = 'Nummer', optional = true } = {}) { const v = clean(s).trim(); if (!v && optional) return ''; if (!new RegExp(`^\\d{${min},${max}}$`).test(v)) fail(`${label}: ${min}–${max} Ziffern.`); return v; },
};
