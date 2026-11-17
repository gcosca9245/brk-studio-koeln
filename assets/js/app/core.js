/* BRK Studio Plattform – Terminlogik (rein, ohne Speicherzugriff)
   Eine Quelle für: Website-Slots, Buchungsstrecke, Kundenkonto und Admin-Kalender. */
import { weekday, addDays, cmpDateTime } from './util.js';

/** Öffnungszeit eines Mitarbeiters an einem Tag: Schnitt aus Salon- und persönlichen Zeiten. */
export function dayHours(settings, staff, date) {
  const wd = weekday(date);
  const salon = settings.hours[wd];
  if (!salon) return null;
  if (settings.closedDates && settings.closedDates.includes(date)) return null;
  const own = staff && staff.hours ? staff.hours[wd] : undefined;
  if (own === null) return null;
  const [o, c] = own ? [Math.max(own[0], salon[0]), Math.min(own[1], salon[1])] : salon;
  return o < c ? [o, c] : null;
}

/** Belegte Intervalle eines Mitarbeiters an einem Tag (Termine + Blocker). */
export function busyFor(staffId, date, busy, excludeId) {
  const out = [];
  for (const b of busy) {
    if (b.date !== date || b.id === excludeId) continue;
    if (b.staffId && b.staffId !== staffId) continue;   // Blocker ohne staffId gilt für alle
    out.push([b.start, b.end]);
  }
  return out;
}

const overlaps = (a0, a1, b0, b1) => a0 < b1 && b0 < a1;

/** Freie Startzeiten (Minuten) für einen Mitarbeiter. */
export function freeStarts({ staff, date, duration, settings, busy, now, excludeId }) {
  const hrs = dayHours(settings, staff, date);
  if (!hrs) return [];
  const step = settings.step || 15;
  const lead = settings.leadMinutes || 0;
  const taken = busyFor(staff.id, date, busy, excludeId);
  const out = [];
  for (let t = hrs[0]; t + duration <= hrs[1]; t += step) {
    if (now && cmpDateTime(date, t, now.date, now.minutes + lead) < 0) continue;
    if (taken.some(([a, b]) => overlaps(t, t + duration, a, b))) continue;
    out.push(t);
  }
  return out;
}

/** Mitarbeiter, die eine Leistung anbieten. */
export const staffFor = (service, staffList) => staffList.filter((s) => s.active !== false && (service.staffIds || []).includes(s.id));

/** Slots für eine Leistung: [{ start, staffIds }] – staffId 'any' = erster freier Mitarbeiter. */
export function slotsFor({ service, staffId, date, data, now, excludeId }) {
  if (!service) return [];
  const team = staffFor(service, data.staff).filter((s) => staffId === 'any' || !staffId || s.id === staffId);
  const map = new Map();
  for (const st of team) {
    for (const t of freeStarts({ staff: st, date, duration: service.duration, settings: data.settings, busy: data.busy, now, excludeId })) {
      if (!map.has(t)) map.set(t, []);
      map.get(t).push(st.id);
    }
  }
  return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([start, staffIds]) => ({ start, staffIds }));
}

/** Prüft einen konkreten Termin gegen Öffnungszeiten, Vorlauf, Horizont und Überschneidungen. */
export function checkSlot({ service, staff, date, start, data, now, excludeId, admin }) {
  if (!service || !staff) return 'Leistung oder Mitarbeiter fehlt.';
  if (!(service.staffIds || []).includes(staff.id) && !admin) return `${staff.name} bietet diese Leistung nicht an.`;
  const hrs = dayHours(data.settings, staff, date);
  if (!hrs && !admin) return 'An diesem Tag ist geschlossen.';
  if (hrs && !admin && (start < hrs[0] || start + service.duration > hrs[1])) return 'Außerhalb der Öffnungszeiten.';
  if (now && !admin && cmpDateTime(date, start, now.date, now.minutes + (data.settings.leadMinutes || 0)) < 0) return 'Dieser Zeitpunkt liegt zu kurz vor jetzt.';
  if (now && !admin && date > addDays(now.date, data.settings.horizonDays || 60)) return 'So weit im Voraus ist noch nicht buchbar.';
  const clash = busyFor(staff.id, date, data.busy, excludeId).some(([a, b]) => overlaps(start, start + service.duration, a, b));
  if (clash) return 'Diese Zeit ist inzwischen vergeben.';
  return '';
}

/** Belegungsliste aus Terminen und Blockern bauen. */
export function toBusy(appointments, blockers) {
  const out = [];
  for (const a of appointments) if (a.status === 'booked') out.push({ id: a.id, staffId: a.staffId, date: a.date, start: a.start, end: a.start + a.duration, kind: 'appt' });
  for (const b of blockers) out.push({ id: b.id, staffId: b.staffId || null, date: b.date, start: b.start, end: b.end, kind: 'block' });
  return out;
}

/** Durchschnitt freigegebener Bewertungen. */
export function ratingSummary(reviews) {
  const ok = reviews.filter((r) => r.status === 'approved');
  const avg = ok.length ? ok.reduce((s, r) => s + r.rating, 0) / ok.length : 0;
  const dist = [5, 4, 3, 2, 1].map((n) => ({ n, c: ok.filter((r) => r.rating === n).length }));
  return { count: ok.length, avg, dist, list: ok };
}
