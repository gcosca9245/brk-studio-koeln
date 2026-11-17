/* BRK Studio Plattform – gemeinsame Oberflächenbausteine */
import { api } from './api.js';
import { esc, addDays, fmtDate, hhmm, weekday } from './util.js';

export const $ = (s, c = document) => c.querySelector(s);
export const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));

/* ---------- Toast (aria-live) ---------- */
let toastEl;
export function toast(msg, kind = '') {
  if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'toast'; toastEl.setAttribute('role', 'status'); toastEl.setAttribute('aria-live', 'polite'); document.body.appendChild(toastEl); }
  toastEl.textContent = msg;
  toastEl.className = `toast is-on ${kind}`;
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(() => toastEl.classList.remove('is-on'), 3600);
}

/* ---------- Dialog (native <dialog>, Fokus kehrt zurück) ---------- */
export function openDialog({ title, body, actions = [], wide = false, onOpen }) {
  const d = document.createElement('dialog');
  d.className = `dlg${wide ? ' dlg--wide' : ''}`;
  d.setAttribute('aria-labelledby', 'dlg-title');
  d.innerHTML = `<form method="dialog" class="dlg__inner" novalidate>
    <header class="dlg__head"><h2 id="dlg-title" class="dlg__title">${esc(title)}</h2><button class="dlg__x" value="cancel" aria-label="Schließen"><span aria-hidden="true"></span></button></header>
    <div class="dlg__body">${body}</div>
    <p class="form-error" data-dlg-error role="alert"></p>
    <footer class="dlg__foot">${actions.map((a) => `<button type="${a.submit ? 'submit' : 'button'}" class="btn ${a.kind || 'btn-outline'} btn-sm" value="${a.value || ''}" data-act="${a.value || ''}">${esc(a.label)}</button>`).join('')}</footer>
  </form>`;
  const opener = document.activeElement;
  document.body.appendChild(d);
  d.addEventListener('close', () => { d.remove(); if (opener && opener.focus) opener.focus(); });
  d.showModal();
  d.error = (m) => { $('[data-dlg-error]', d).textContent = m || ''; };
  if (onOpen) onOpen(d);
  return d;
}
export function confirmDialog(title, text, okLabel = 'Bestätigen', danger = false) {
  return new Promise((resolve) => {
    const d = openDialog({ title, body: `<p class="dlg__text">${esc(text)}</p>`, actions: [{ label: 'Abbrechen', value: 'no' }, { label: okLabel, value: 'ok', kind: danger ? 'btn-danger' : 'btn-dark' }] });
    d.addEventListener('click', (e) => { const b = e.target.closest('[data-act]'); if (!b) return; resolve(b.dataset.act === 'ok'); d.close(); });
    d.addEventListener('cancel', () => resolve(false));
  });
}

/* ---------- Sterne ---------- */
const STAR = 'M12 2.6l2.8 6.1 6.6.7-4.9 4.5 1.4 6.5L12 17.1l-5.9 3.3 1.4-6.5L2.6 9.4l6.6-.7z';
export function stars(value, size = 14) {
  let s = `<span class="stars" role="img" aria-label="${String(value).replace('.', ',')} von 5 Sternen">`;
  for (let i = 1; i <= 5; i++) {
    const fill = Math.max(0, Math.min(1, value - i + 1));
    s += `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true"><path d="${STAR}" fill="none" stroke="currentColor" stroke-width="1.2"/>${fill > 0 ? `<clipPath id="c${i}${Math.round(fill * 10)}"><rect width="${24 * fill}" height="24"/></clipPath><path d="${STAR}" fill="currentColor" clip-path="url(#c${i}${Math.round(fill * 10)})"/>` : ''}</svg>`;
  }
  return `${s}</span>`;
}
/** Eingabe 1–5 Sterne als Radiogruppe. */
export function starInput(name = 'rating') {
  return `<fieldset class="star-input"><legend class="label">Deine Bewertung</legend><div class="star-input__row">${[1, 2, 3, 4, 5].map((n) => `<label><input type="radio" name="${name}" value="${n}" required><span class="sr-only">${n} ${n === 1 ? 'Stern' : 'Sterne'}</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${STAR}"/></svg></label>`).join('')}</div></fieldset>`;
}

/* ---------- Tagesleiste + Slots ---------- */
export function daysStrip(days, selected, name = 'date') {
  return days.map((d, i) => {
    const off = !d.open || d.free === 0;
    const lbl = i === 0 && d.date === api.now().date ? 'Heute' : fmtDate(d.date, 'wd');
    const info = !d.open ? 'zu' : d.free === 0 ? 'voll' : d.free == null ? fmtDate(d.date, 'mon') : `${d.free} frei`;
    return `<label class="day${off ? ' is-off' : ''}"><input type="radio" name="${name}" value="${d.date}" ${off ? 'disabled' : ''} ${selected === d.date ? 'checked' : ''} aria-label="${fmtDate(d.date)}${!d.open ? ', geschlossen' : d.free === 0 ? ', ausgebucht' : d.free ? `, ${d.free} freie Zeiten` : ''}"><span><small>${lbl}</small><b>${Number(d.date.slice(8))}</b><small>${info}</small></span></label>`;
  }).join('');
}
export function slotGrid(slots, selected, name = 'time') {
  if (!slots.length) return '<p class="slots__empty">An diesem Tag ist nichts mehr frei. Bitte wähle einen anderen Tag.</p>';
  // nach Tageszeit gruppieren: ruhiger zu lesen als ein langes Raster
  const groups = [['Mittag', 0, 840], ['Nachmittag', 840, 1020], ['Abend', 1020, 1440]];
  return groups.map(([label, a, b]) => {
    const g = slots.filter((s) => s.start >= a && s.start < b);
    if (!g.length) return '';
    return `<div class="slot-group"><p class="slot-group__label">${label}</p><div class="slots">${g.map((s) => `<label class="slot"><input type="radio" name="${name}" value="${s.start}" ${selected === s.start ? 'checked' : ''} aria-label="${hhmm(s.start)} Uhr"><span>${hhmm(s.start)}</span></label>`).join('')}</div></div>`;
  }).join('');
}

/* ---------- Kopfzeile: Konto-Link je nach Anmeldung ---------- */
export async function initChrome() {
  const u = await api.user();
  $$('[data-account-link]').forEach((a) => { a.textContent = u ? (u.role === 'admin' ? 'Studio-Pult' : u.name.split(' ')[0]) : 'Anmelden'; if (u && u.role === 'admin') a.href = a.dataset.admin || a.href; });
  $$('[data-demo-reset]').forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmDialog('Demo zurücksetzen?', 'Alle in diesem Browser gespeicherten Termine, Konten und Bewertungen werden gelöscht und die Beispieldaten neu geladen.', 'Zurücksetzen', true))) return;
    await api.resetDemo();
    location.reload();
  }));
  return u;
}

/* ---------- .ics für den eigenen Kalender ---------- */
export function icsFor({ date, start, duration, title, location }) {
  const z = (iso, m) => `${iso.replace(/-/g, '')}T${hhmm(m).replace(':', '')}00`;
  const body = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//BRK Studio//Demo//DE', 'BEGIN:VEVENT', `UID:${date}-${start}-${Math.random().toString(36).slice(2)}@brk-studio`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
    `DTSTART;TZID=Europe/Berlin:${z(date, start)}`, `DTEND;TZID=Europe/Berlin:${z(date, start + duration)}`, `SUMMARY:${title}`, `LOCATION:${location}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  return URL.createObjectURL(new Blob([body], { type: 'text/calendar' }));
}
export { esc, addDays, fmtDate, hhmm, weekday };
