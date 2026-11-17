/* BRK Studio Plattform – Studio-Pult /admin/ (Inhaber) */
import { api } from './api.js';
import { $, $$, toast, openDialog, confirmDialog, stars, initChrome, esc, addDays, fmtDate, hhmm } from './ui.js';
import { fmtPrice, fmtDuration, mondayOf, weekday, parseHHMM } from './util.js';
import { dayHours } from './core.js';
import { authFormsHTML, bindAuthForms } from './auth-forms.js';
import { initPult, renderPanel, allowed, idle } from './pult/index.js';
import { pult } from './pult-api.js';
import { P as PS } from './pult/kit.js';
import { kasse } from './pult/kasse.js';

const PPM = 1.5;           // Pixel pro Minute im Kalender
const SNAP = 15;
const S = { view: 'day', mode: 'staff', date: api.now().date, staff: 'all', rf: 'pending' };
let cat, data, me;

async function init() {
  await initChrome();
  try { me = await api.admin.guard(); } catch (_) { me = null; }
  me ? showPult() : showAuth();
}
function showAuth(msg) {
  idle.stop();
  $('[data-pult]').hidden = true; $('[data-adm-auth]').hidden = false;
  document.body.classList.add('app--dark');
  const box = $('[data-auth-forms]');
  box.innerHTML = authFormsHTML({ idp: 'adm', admin: true });
  bindAuthForms(box, { admin: true, onAuth: async (u) => { me = u; try { await pult.logLogin(); } catch (_) { /* optional */ } showPult(); } });
  if (msg) { const e = box.querySelector('[data-error]'); if (e) e.textContent = msg; }
}
idle.onLogout = async (msg) => { await api.logout(); me = null; showAuth(msg); };
async function showPult() {
  document.body.classList.remove('app--dark');
  $('[data-adm-auth]').hidden = true; $('[data-pult]').hidden = false;
  $('[data-me]').innerHTML = `<b>${esc(me.name)}</b><span>${me.role === 'admin' ? 'Inhaber' : 'Mitarbeiter'}</span>`;
  await initPult(me, nav);
  await reload();
  nav((location.hash || (me.role === 'admin' ? '#uebersicht' : '#kalender')).slice(1));
}
async function reload() {
  cat = await api.catalog();
  data = await api.admin.data();
  const p = data.reviews.filter((r) => r.status === 'pending').length;
  const c = $('[data-count-pending]'); c.hidden = !p; c.textContent = p;
  const sel = $('[data-cal-staff]');
  const active = cat.staff.filter((s) => s.active !== false);
  if (S.staff !== 'all' && !active.some((s) => s.id === S.staff)) S.staff = 'all';
  sel.innerHTML = `<option value="all">Ganzes Team</option>${active.map((s) => `<option value="${s.id}" ${S.staff === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}`;
  renderCal(); renderReviews(); renderStaff(); renderServices(); if (me.role === 'admin') renderSettings();
}
window.addEventListener('brk:data', async () => { if (me && !dragging) { try { cat = await api.catalog(); data = await api.admin.data(); renderCal(); } catch (_) { /* abgemeldet */ } } });

/* ---------- Navigation ---------- */
function nav(target) {
  let [which, sub] = String(target).split('/');
  if (!$(`[data-panel="${which}"]`) || !allowed(which)) which = 'kalender';
  $$('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== which; });
  $$('[data-nav]').forEach((b) => { if (b.dataset.nav === which) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  const h = sub ? `${which}/${sub}` : which;
  if (location.hash.slice(1) !== h) history.replaceState(null, '', `#${h}`);
  if (which === 'kalender') renderCal(); else renderPanel(which, sub);
  document.body.classList.toggle('is-kasse', which === 'kasse');
}
$$('[data-nav]').forEach((b) => b.addEventListener('click', () => { nav(b.dataset.nav); const h = $(`[data-panel="${b.dataset.nav}"] h1`); if (h) h.focus({ preventScroll: false }); }));
window.addEventListener('hashchange', () => { if (me) nav(location.hash.slice(1)); });
$('[data-logout]').addEventListener('click', async () => { await api.logout(); me = null; showAuth(); });

/* ---------- Kalender ---------- */
const svcOf = (id) => cat.services.find((s) => s.id === id) || { name: 'Leistung', price: 0, duration: 30 };
const staffOf = (id) => cat.staff.find((s) => s.id === id) || { name: '–' };

const resCols = () => (PS.db ? PS.db.resources : []).map((r) => ({ id: r.id, name: r.name, role: r.type === 'chair' ? 'Stuhl' : r.type === 'color' ? 'Farbe' : 'Waschen', hours: {}, isRes: true }));
function columns() {
  const team = S.mode === 'res' ? resCols() : cat.staff.filter((s) => s.active !== false && (S.staff === 'all' || s.id === S.staff));
  if (S.view === 'day') return team.map((st) => ({ date: S.date, st }));
  const mon = mondayOf(S.date), cols = [];
  for (let i = 0; i < 7; i++) { const date = addDays(mon, i); for (const st of team) cols.push({ date, st }); }
  return cols;
}
function range(cols) {
  let lo = 24 * 60, hi = 0;
  for (const h of Object.values(cat.settings.hours)) if (h) { lo = Math.min(lo, h[0]); hi = Math.max(hi, h[1]); }
  for (const a of data.appointments) if (cols.some((c) => c.date === a.date) && a.status === 'booked') { lo = Math.min(lo, a.start); hi = Math.max(hi, a.start + a.duration); }
  lo = Math.floor((lo - 30) / 60) * 60; hi = Math.ceil((hi + 30) / 60) * 60;
  return [Math.max(0, lo), Math.min(1440, hi)];
}

function renderCal() {
  if (!cat) return;
  const cols = columns();
  const [lo, hi] = range(cols);
  const now = api.now();
  const H = (hi - lo) * PPM;
  const mon = mondayOf(S.date);
  $('[data-cal-title]').textContent = S.view === 'day' ? fmtDate(S.date, 'longY') : `${fmtDate(mon, 'num')} – ${fmtDate(addDays(mon, 6), 'num')} · ${fmtDate(mon, 'monYear')}`;
  $$('[data-view]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.view === S.view));
  const multi = S.view === 'week' && S.staff === 'all';
  let head = '<div class="cal__corner"></div>';
  let body = `<div class="cal__axis" style="height:${H}px">`;
  for (let m = lo; m < hi; m += 60) body += `<span style="top:${(m - lo) * PPM}px">${hhmm(m)}</span>`;
  body += '</div>';
  cols.forEach((c, i) => {
    const firstOfDay = !i || cols[i - 1].date !== c.date;
    const hrs = dayHours(cat.settings, c.st, c.date);
    const isToday = c.date === now.date;
    const label = S.view === 'day' ? `<b>${esc(c.st.name)}</b><small>${esc(c.st.role || '')}</small>` : `<b>${fmtDate(c.date, 'wd')} ${Number(c.date.slice(8))}</b>${multi ? `<small>${esc(c.st.name)}</small>` : ''}`;
    head += `<div class="cal__h${isToday ? ' is-today' : ''}${firstOfDay && i ? ' is-daystart' : ''}${!hrs ? ' is-closed' : ''}">${label}</div>`;
    let col = `<div class="cal__col${firstOfDay && i ? ' is-daystart' : ''}${!hrs ? ' is-closed' : ''}" data-date="${c.date}" data-staff="${c.st.id}" style="height:${H}px">`;
    // geschlossene Zeiten schraffiert
    if (!hrs) col += `<div class="cal__off" style="top:0;height:${H}px"><span>geschlossen</span></div>`;
    else {
      if (hrs[0] > lo) col += `<div class="cal__off" style="top:0;height:${(hrs[0] - lo) * PPM}px"></div>`;
      if (hrs[1] < hi) col += `<div class="cal__off" style="top:${(hrs[1] - lo) * PPM}px;height:${(hi - hrs[1]) * PPM}px"></div>`;
    }
    if (!c.st.isRes) {
      const br = c.st.breaks && (c.st.breaks[weekday(c.date)] || c.st.breaks.all);
      if (br && hrs) col += `<div class="cal__pause" style="top:${(br[0] - lo) * PPM}px;height:${(br[1] - br[0]) * PPM}px" aria-hidden="true"><span>Pause</span></div>`;
      for (const b of data.blockers.filter((x) => x.date === c.date && (!x.staffId || x.staffId === c.st.id))) {
        col += `<button type="button" class="blk${b.kind === 'absence' ? ' blk--absence' : ''}" data-block="${b.id}" style="top:${(b.start - lo) * PPM}px;height:${(b.end - b.start) * PPM}px"><span class="blk__t">${b.kind === 'absence' ? esc(b.absenceType || 'Abwesend') : `${hhmm(b.start)}–${hhmm(b.end)}`}</span><span class="blk__r">${esc(b.reason || 'Blocker')}${b.staffId ? '' : ' · Studio'}</span></button>`;
      }
    }
    for (const a of data.appointments.filter((x) => x.date === c.date && (c.st.isRes ? resOf(x) === c.st.id : x.staffId === c.st.id) && x.status === 'booked')) {
      const svc = svcOf(a.serviceId);
      const past = api.isPast(a);
      col += `<button type="button" class="ev${a.source === 'customer' ? ' ev--online' : ''}${past ? ' is-past' : ''}${a.paidBonId ? ' is-paid' : ''}${a.duration <= 20 ? ' ev--tiny' : ''}" data-appt="${a.id}" style="top:${(a.start - lo) * PPM}px;height:${a.duration * PPM - 2}px" aria-label="${esc(a.name)}, ${esc(svc.name)}, ${hhmm(a.start)} bis ${hhmm(a.start + a.duration)}${a.paidBonId ? ', bezahlt' : ''}">
        <span class="ev__t">${hhmm(a.start)}–${hhmm(a.start + a.duration)}${a.paidBonId ? '<i class="ev__paid">bezahlt</i>' : a.deposit ? '<i class="ev__paid">Anzahlung</i>' : ''}</span><span class="ev__n">${esc(a.name.replace(/^Beispiel · /, ''))}${a.example ? '<i class="ev__ex">Beispiel</i>' : ''}</span><span class="ev__s">${esc(svc.name)}${c.st.isRes ? ` · ${esc(staffOf(a.staffId).name)}` : ''}</span></button>`;
    }
    if (isToday && now.minutes > lo && now.minutes < hi) col += `<div class="cal__now" style="top:${(now.minutes - lo) * PPM}px" aria-hidden="true"></div>`;
    col += '</div>';
    body += col;
  });
  const minCol = S.view === 'day' ? 220 : multi ? 92 : 120;
  const cal = $('[data-cal]');
  cal.style.setProperty('--cols', cols.length);
  cal.style.setProperty('--colmin', `${minCol}px`);
  cal.dataset.lo = lo;
  cal.dataset.mode = S.mode;
  $$('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.mode === S.mode));
  cal.innerHTML = `<div class="cal__head">${head}</div><div class="cal__body">${body}</div>`;
  renderKpis(cols);
}

function renderKpis(cols) {
  const dates = [...new Set(cols.map((c) => c.date))];
  // Plätze-Ansicht: Kennzahlen über das ganze Team
  if (cols.some((c) => c.st.isRes)) cols = dates.flatMap((date) => cat.staff.filter((s) => s.active !== false).map((st) => ({ st, date })));
  const ids = new Set(cols.map((c) => c.st.id));
  const appts = data.appointments.filter((a) => a.status === 'booked' && dates.includes(a.date) && ids.has(a.staffId));
  const revenue = appts.reduce((s, a) => s + svcOf(a.serviceId).price, 0);
  let cap = 0;
  for (const c of cols) { const h = dayHours(cat.settings, c.st, c.date); if (h) cap += h[1] - h[0]; }
  const used = appts.reduce((s, a) => s + a.duration, 0);
  const online = appts.filter((a) => a.source === 'customer').length;
  const pend = data.reviews.filter((r) => r.status === 'pending').length;
  $('[data-kpis]').innerHTML = `
    <div><dt>Termine</dt><dd>${appts.length}</dd></div>
    <div><dt>Auslastung</dt><dd>${cap ? Math.round((used / cap) * 100) : 0}&nbsp;%</dd></div>
    <div><dt>Umsatz (ca.)</dt><dd>${(revenue / 100).toLocaleString('de-DE')}&nbsp;€</dd></div>
    <div><dt>Online gebucht</dt><dd>${online}</dd></div>
    <div><dt>Bewertungen offen</dt><dd>${pend}</dd></div>`;
}

$('[data-cal-prev]').addEventListener('click', () => { S.date = addDays(S.date, S.view === 'day' ? -1 : -7); renderCal(); });
$('[data-cal-next]').addEventListener('click', () => { S.date = addDays(S.date, S.view === 'day' ? 1 : 7); renderCal(); });
$('[data-cal-today]').addEventListener('click', () => { S.date = api.now().date; renderCal(); });
$$('[data-view]').forEach((b) => b.addEventListener('click', () => { S.view = b.dataset.view; renderCal(); }));
$$('[data-mode]').forEach((b) => b.addEventListener('click', () => { S.mode = b.dataset.mode; renderCal(); }));
/** Platz eines Termins: gespeichert oder Standardplatz des Mitarbeiters bzw. Farbplatz */
function resOf(a) { if (a.resourceId) return a.resourceId; const s = cat.services.find((x) => x.id === a.serviceId); if (s && s.resourceType === 'color') return 'rs_3'; const st = cat.staff.find((x) => x.id === a.staffId); return (st && st.resourceId) || 'rs_2'; }
$('[data-cal-staff]').addEventListener('change', (e) => { S.staff = e.target.value; renderCal(); });
$('[data-new-appt]').addEventListener('click', () => apptDialog({ date: S.date, start: 12 * 60, staffId: S.staff === 'all' ? cat.staff[0].id : S.staff }));
$('[data-new-block]').addEventListener('click', () => blockDialog({ date: S.date, start: 12 * 60, end: 13 * 60, staffId: S.staff === 'all' ? '' : S.staff }));

/* Klick auf leere Fläche / Termin / Blocker */
const cal = $('[data-cal]');
cal.addEventListener('click', (e) => {
  if (suppressClick) { suppressClick = false; return; }
  const ev = e.target.closest('[data-appt]'); if (ev) { apptDetail(ev.dataset.appt); return; }
  const bl = e.target.closest('[data-block]'); if (bl) { blockDialog(data.blockers.find((b) => b.id === bl.dataset.block)); return; }
  const col = e.target.closest('.cal__col'); if (!col || cal.dataset.mode === 'res') return;
  const m = Number(cal.dataset.lo) + Math.floor((e.clientY - col.getBoundingClientRect().top) / PPM / SNAP) * SNAP;
  quickNew({ date: col.dataset.date, staffId: col.dataset.staff, start: m });
});

function quickNew(p) {
  const d = openDialog({
    title: `${fmtDate(p.date, 'short')}, ${hhmm(p.start)} Uhr`,
    body: `<p class="dlg__text">bei ${esc(staffOf(p.staffId).name)}. Was möchtest du anlegen?</p>`,
    actions: [{ label: 'Blocker', value: 'block' }, { label: 'Termin', value: 'appt', kind: 'btn-dark' }],
  });
  d.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]'); if (!b || !b.dataset.act || b.dataset.act === 'cancel') return;
    d.close();
    if (b.dataset.act === 'appt') apptDialog(p); else blockDialog({ ...p, end: p.start + 60 });
  });
}

/* ---------- Ziehen zum Verschieben (Maus/Stift; Touch über Dialog) ---------- */
let dragging = null, suppressClick = false;
cal.addEventListener('pointerdown', (e) => {
  const ev = e.target.closest('[data-appt]');
  if (!ev || e.pointerType === 'touch' || e.button !== 0 || cal.dataset.mode === 'res') return;
  const a = data.appointments.find((x) => x.id === ev.dataset.appt);
  dragging = { ev, a, x0: e.clientX, y0: e.clientY, moved: false, pid: e.pointerId };
});
window.addEventListener('pointermove', (e) => {
  if (!dragging || e.pointerId !== dragging.pid) return;
  const dx = e.clientX - dragging.x0, dy = e.clientY - dragging.y0;
  if (!dragging.moved && Math.hypot(dx, dy) < 6) return;
  if (!dragging.moved) { dragging.moved = true; dragging.ev.classList.add('is-drag'); document.body.classList.add('is-dragging'); }
  const snapPx = SNAP * PPM;
  dragging.ev.style.transform = `translate(${dx}px, ${Math.round(dy / snapPx) * snapPx}px)`;
  dragging.ev.style.pointerEvents = 'none';
  const under = document.elementFromPoint(e.clientX, e.clientY);
  $$('.cal__col.is-target').forEach((c) => c.classList.remove('is-target'));
  const col = under && under.closest('.cal__col'); if (col) col.classList.add('is-target');
});
window.addEventListener('pointerup', async (e) => {
  if (!dragging || e.pointerId !== dragging.pid) return;
  const d = dragging; dragging = null;
  document.body.classList.remove('is-dragging');
  $$('.cal__col.is-target').forEach((c) => c.classList.remove('is-target'));
  if (!d.moved) return;
  suppressClick = true; setTimeout(() => { suppressClick = false; }, 0);
  const under = document.elementFromPoint(e.clientX, e.clientY);
  const col = under && under.closest('.cal__col');
  const dyMin = Math.round((e.clientY - d.y0) / PPM / SNAP) * SNAP;
  if (!col) { renderCal(); return; }
  const target = { date: col.dataset.date, staffId: col.dataset.staff, start: d.a.start + dyMin };
  try { await api.admin.moveAppointment(d.a.id, target); toast(`Verschoben auf ${fmtDate(target.date, 'short')}, ${hhmm(target.start)} Uhr.`); } catch (x) { toast(x.message, 'is-error'); }
  data = await api.admin.data(); renderCal();
});

/* ---------- Dialoge: Termin ---------- */
const timeOptions = (sel, from = 7 * 60, to = 22 * 60) => { let o = ''; for (let m = from; m <= to; m += SNAP) o += `<option value="${m}" ${m === sel ? 'selected' : ''}>${hhmm(m)}</option>`; return o; };
const staffOptions = (sel, withAll = false) => `${withAll ? `<option value="" ${!sel ? 'selected' : ''}>Ganzes Studio</option>` : ''}${cat.staff.filter((s) => s.active !== false).map((s) => `<option value="${s.id}" ${s.id === sel ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}`;
const serviceOptions = (sel) => cat.services.filter((s) => s.active !== false).map((s) => `<option value="${s.id}" ${s.id === sel ? 'selected' : ''}>${esc(s.name)} · ${fmtDuration(s.duration)} · ${fmtPrice(s)}</option>`).join('');

function apptDialog(p) {
  const d = openDialog({
    title: 'Neuer Termin', wide: true,
    body: `<div class="grid2">
      <div class="field span2"><label class="label" for="na-svc">Leistung</label><select class="input select" id="na-svc" name="serviceId">${serviceOptions(p.serviceId || cat.services[0].id)}</select></div>
      <div class="field"><label class="label" for="na-staff">Bei</label><select class="input select" id="na-staff" name="staffId">${staffOptions(p.staffId)}</select></div>
      <div class="field"><label class="label" for="na-date">Datum</label><input class="input" type="date" id="na-date" name="date" value="${p.date}"></div>
      <div class="field"><label class="label" for="na-time">Uhrzeit</label><select class="input select" id="na-time" name="start">${timeOptions(p.start)}</select></div>
      <div class="field"><label class="label" for="na-name">Gast</label><input class="input" id="na-name" name="name" autocomplete="off" placeholder="Vor- und Nachname"></div>
      <div class="field"><label class="label" for="na-phone">Telefon <span class="label__hint">optional</span></label><input class="input" id="na-phone" name="phone" type="tel" autocomplete="off"></div>
      <div class="field span2"><label class="label" for="na-note">Notiz <span class="label__hint">optional</span></label><input class="input" id="na-note" name="note" autocomplete="off"></div>
      <label class="check span2" data-force hidden><input type="checkbox" name="force"> Trotz Überschneidung anlegen</label>
    </div>`,
    actions: [{ label: 'Abbrechen', value: 'cancel' }, { label: 'Termin anlegen', value: 'ok', kind: 'btn-dark' }],
    onOpen: (dl) => setTimeout(() => dl.querySelector('#na-name').focus(), 30),
  });
  d.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]'); if (!b || b.dataset.act !== 'ok') return;
    e.preventDefault();
    const f = $('form', d).elements;
    try {
      await api.admin.createAppointment({ serviceId: f.serviceId.value, staffId: f.staffId.value, date: f.date.value, start: Number(f.start.value), name: f.name.value, phone: f.phone.value, note: f.note.value, force: f.force.checked });
      d.close(); toast('Termin angelegt.'); S.date = f.date.value; data = await api.admin.data(); renderCal();
    } catch (x) { d.error(x.message); if (/vergeben|Öffnungszeiten|geschlossen/.test(x.message)) $('[data-force]', d).hidden = false; }
  });
}

function apptDetail(id) {
  const a = data.appointments.find((x) => x.id === id);
  const svc = svcOf(a.serviceId);
  const hist = (a.history || []).map((h) => `<li>${new Date(h.at).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })} · ${esc(h.by === 'admin' ? 'Studio' : 'Kunde')} · ${esc(h.what)}</li>`).join('');
  const d = openDialog({
    title: a.name.replace(/^Beispiel · /, ''), wide: true,
    body: `<dl class="facts">
        <div><dt>Leistung</dt><dd>${esc(svc.name)} · ${fmtPrice(svc)}</dd></div>
        <div><dt>Quelle</dt><dd>${a.source === 'customer' ? 'Online vom Kunden gebucht' : 'Im Studio angelegt'}${a.example ? ' · <span class="tag">Beispiel</span>' : ''}</dd></div>
        <div><dt>Telefon</dt><dd>${a.phone ? `<a href="tel:${esc(a.phone.replace(/\s/g, ''))}">${esc(a.phone)}</a>` : '–'}</dd></div>
        <div><dt>Notiz</dt><dd>${esc(a.note || '–')}</dd></div>
        <div><dt>Kasse</dt><dd>${a.paidBonId ? `bezahlt${PS.db ? ` · Bon ${esc((PS.db.transactions.find((t) => t.id === a.paidBonId) || {}).no || '')}` : ''}` : 'noch nicht kassiert'}${a.deposit ? ` · Anzahlung ${(a.deposit.amount / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}` : ''}</dd></div>
      </dl>
      ${a.paidBonId ? '' : `<div class="row-actions row-actions--start"><button type="button" class="btn btn-dark btn-sm" data-act="cash">Kassieren</button>${a.deposit ? '' : '<button type="button" class="btn btn-outline btn-sm" data-act="deposit">Anzahlung</button>'}${api.isPast(a) ? '<button type="button" class="btn btn-outline btn-sm" data-act="noshow">Nicht erschienen</button>' : ''}</div>`}
      <p class="label dlg__sub">Verschieben</p>
      <div class="grid3">
        <div class="field"><label class="label" for="ed-date">Datum</label><input class="input" type="date" id="ed-date" name="date" value="${a.date}"></div>
        <div class="field"><label class="label" for="ed-time">Uhrzeit</label><select class="input select" id="ed-time" name="start">${timeOptions(a.start)}</select></div>
        <div class="field"><label class="label" for="ed-staff">Bei</label><select class="input select" id="ed-staff" name="staffId">${staffOptions(a.staffId)}</select></div>
      </div>
      ${hist ? `<details class="hist"><summary>Verlauf</summary><ul>${hist}</ul></details>` : ''}`,
    actions: [{ label: 'Stornieren', value: 'del', kind: 'btn-danger' }, { label: 'Schließen', value: 'cancel' }, { label: 'Speichern', value: 'ok', kind: 'btn-dark' }],
  });
  d.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const f = $('form', d).elements;
    if (b.dataset.act === 'cash' || b.dataset.act === 'deposit') { e.preventDefault(); d.close(); if (b.dataset.act === 'cash') kasse.fromAppointment(a.id); else kasse.deposit(a.id); nav('kasse'); return; }
    if (b.dataset.act === 'noshow') {
      e.preventDefault(); d.close();
      if (!(await confirmDialog('Nicht erschienen?', 'Der Termin wird als No-Show markiert. Danach kannst du an der Kasse eine Ausfallgebühr buchen.', 'Markieren'))) return;
      await pult.markNoShow(a.id); kasse.fee(a.id); toast('Als nicht erschienen markiert.'); nav('kasse'); return;
    }
    if (b.dataset.act === 'ok') {
      e.preventDefault();
      try { await api.admin.moveAppointment(a.id, { date: f.date.value, start: Number(f.start.value), staffId: f.staffId.value }); d.close(); toast('Termin gespeichert.'); data = await api.admin.data(); renderCal(); } catch (x) { d.error(x.message); }
    }
    if (b.dataset.act === 'del') {
      e.preventDefault();
      d.close();
      if (!(await confirmDialog('Termin stornieren?', `${a.name} · ${fmtDate(a.date, 'short')}, ${hhmm(a.start)} Uhr. Die Zeit wird sofort wieder buchbar.`, 'Stornieren', true))) return;
      await api.admin.cancelAppointment(a.id); toast('Termin storniert.'); data = await api.admin.data(); renderCal();
    }
  });
}

/* ---------- Dialoge: Blocker ---------- */
function blockDialog(b) {
  const edit = !!b.id;
  const d = openDialog({
    title: edit ? 'Blocker bearbeiten' : 'Zeit blockieren', wide: true,
    body: `<div class="grid2">
      <div class="field"><label class="label" for="bl-staff">Für</label><select class="input select" id="bl-staff" name="staffId">${staffOptions(b.staffId || '', true)}</select></div>
      <div class="field"><label class="label" for="bl-date">Datum</label><input class="input" type="date" id="bl-date" name="date" value="${b.date}"></div>
      <div class="field"><label class="label" for="bl-from">Von</label><select class="input select" id="bl-from" name="start">${timeOptions(b.start)}</select></div>
      <div class="field"><label class="label" for="bl-to">Bis</label><select class="input select" id="bl-to" name="end">${timeOptions(b.end)}</select></div>
      <label class="check"><input type="checkbox" name="allday"> Ganzer Tag</label>
      ${edit ? '' : '<div class="field"><label class="label" for="bl-until">Wiederholen bis <span class="label__hint">optional</span></label><input class="input" type="date" id="bl-until" name="until"></div>'}
      <div class="field span2"><label class="label" for="bl-reason">Grund <span class="label__hint">nur intern sichtbar</span></label><input class="input" id="bl-reason" name="reason" value="${esc(b.reason || '')}" placeholder="z. B. Urlaub, Fortbildung, Pause" autocomplete="off"></div>
    </div>`,
    actions: [...(edit ? [{ label: 'Löschen', value: 'del', kind: 'btn-danger' }] : []), { label: 'Abbrechen', value: 'cancel' }, { label: edit ? 'Speichern' : 'Blockieren', value: 'ok', kind: 'btn-dark' }],
  });
  d.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]'); if (!btn) return;
    const f = $('form', d).elements;
    if (btn.dataset.act === 'del') { e.preventDefault(); await api.admin.removeBlocker(b.id); d.close(); toast('Blocker entfernt.'); data = await api.admin.data(); renderCal(); return; }
    if (btn.dataset.act !== 'ok') return;
    e.preventDefault();
    let start = Number(f.start.value), end = Number(f.end.value);
    if (f.allday.checked) { start = 0; end = 1440; }
    const base = { staffId: f.staffId.value || null, start, end, reason: f.reason.value.trim() };
    try {
      if (edit) await api.admin.saveBlocker({ ...b, ...base, date: f.date.value });
      else {
        const until = f.until && f.until.value && f.until.value > f.date.value ? f.until.value : f.date.value;
        let n = 0;
        for (let day = f.date.value; day <= until && n < 120; day = addDays(day, 1)) { if (cat.settings.hours[weekday(day)] || day === f.date.value) { await api.admin.saveBlocker({ ...base, date: day }); n++; } }
        toast(n > 1 ? `${n} Tage blockiert.` : 'Zeit blockiert.');
      }
      d.close(); data = await api.admin.data(); renderCal();
    } catch (x) { d.error(x.message); }
  });
}

/* ---------- Bewertungen ---------- */
function renderReviews() {
  $$('[data-rf]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.rf === S.rf));
  const list = data.reviews.filter((r) => r.status === S.rf);
  $('[data-reviews]').innerHTML = list.length ? list.map((r) => `<li class="mod">
      <div class="mod__head">${stars(r.rating, 15)}<b>${esc(r.name.replace(/^Beispiel · /, ''))}</b>${r.example ? '<span class="tag">Beispiel</span>' : ''}<span class="mod__meta">${new Date(r.createdAt).toLocaleDateString('de-DE', { day: 'numeric', month: 'short', year: 'numeric' })} · ${esc(staffOf(r.staffId).name)}</span></div>
      <p class="mod__text">${esc(r.text)}</p>
      <div class="mod__actions">${r.status !== 'approved' ? `<button class="btn btn-dark btn-sm" data-approve="${r.id}">Freigeben</button>` : ''}${r.status !== 'rejected' ? `<button class="btn btn-outline btn-sm" data-reject="${r.id}">${r.status === 'approved' ? 'Ausblenden' : 'Ablehnen'}</button>` : ''}</div>
    </li>`).join('') : `<li class="empty">${S.rf === 'pending' ? 'Keine offenen Bewertungen. Alles erledigt.' : 'Keine Einträge.'}</li>`;
}
$$('[data-rf]').forEach((b) => b.addEventListener('click', () => { S.rf = b.dataset.rf; renderReviews(); }));
$('[data-reviews]').addEventListener('click', async (e) => {
  const ap = e.target.closest('[data-approve]'), rj = e.target.closest('[data-reject]');
  if (!ap && !rj) return;
  await api.admin.setReview((ap || rj).dataset[ap ? 'approve' : 'reject'], ap ? 'approved' : 'rejected');
  toast(ap ? 'Freigegeben. Erscheint jetzt auf der Website.' : 'Nicht veröffentlicht.');
  await reload();
});

/* ---------- Team ---------- */
const WD = [[1, 'Mo'], [2, 'Di'], [3, 'Mi'], [4, 'Do'], [5, 'Fr'], [6, 'Sa'], [0, 'So']];
function renderStaff() {
  $('[data-staff-list]').innerHTML = cat.staff.map((s) => {
    const n = cat.services.filter((v) => v.staffIds.includes(s.id)).length;
    const own = Object.keys(s.hours || {}).length;
    return `<li class="tbl__row"><div class="tbl__main"><b>${esc(s.name)}</b><span>${esc(s.role || '')}</span></div><span class="tbl__cell">${n} Leistungen</span><span class="tbl__cell">${own ? 'Eigene Arbeitszeiten' : 'Salonzeiten'}</span><span class="status status--${s.active !== false ? 'approved' : 'rejected'}">${s.active !== false ? 'Aktiv' : 'Inaktiv'}</span><button class="btn btn-outline btn-sm" data-edit-staff="${s.id}">Bearbeiten</button></li>`;
  }).join('');
}
$('[data-add-staff]').addEventListener('click', () => staffDialog({}));
$('[data-staff-list]').addEventListener('click', (e) => { const b = e.target.closest('[data-edit-staff]'); if (b) staffDialog(cat.staff.find((s) => s.id === b.dataset.editStaff)); });
function staffDialog(s) {
  const edit = !!s.id;
  const hours = s.hours || {};
  const d = openDialog({
    title: edit ? s.name : 'Neues Teammitglied', wide: true,
    body: `<div class="grid2">
      <div class="field"><label class="label" for="sf-name">Name</label><input class="input" id="sf-name" name="name" value="${esc(s.name || '')}" autocomplete="off"></div>
      <div class="field"><label class="label" for="sf-role">Rolle</label><input class="input" id="sf-role" name="role" value="${esc(s.role || '')}" autocomplete="off" placeholder="z. B. Barber"></div>
      <label class="check span2"><input type="checkbox" name="active" ${s.active !== false ? 'checked' : ''}> Aktiv und online buchbar</label>
    </div>
    <p class="label dlg__sub">Leistungen</p>
    <div class="checks">${cat.services.map((v) => `<label class="check"><input type="checkbox" name="svc" value="${v.id}" ${v.staffIds.includes(s.id) ? 'checked' : ''}> ${esc(v.name)}</label>`).join('')}</div>
    <p class="label dlg__sub">Arbeitszeiten <span class="label__hint">leer = Salonzeiten</span></p>
    <div class="hours-edit">${WD.map(([wd, l]) => { const h = hours[wd]; const salon = cat.settings.hours[wd]; return `<div class="hours-edit__row"><span>${l}</span>${salon ? `<select class="input select" name="h${wd}">
        <option value="salon" ${h === undefined ? 'selected' : ''}>Salonzeiten (${hhmm(salon[0])}–${hhmm(salon[1])})</option>
        <option value="off" ${h === null ? 'selected' : ''}>Frei</option>
        ${[[12, 16], [14, 19], [12, 18], [15, 20]].map(([a, z]) => { const v = `${a * 60}-${z * 60}`; return `<option value="${v}" ${h && h[0] === a * 60 && h[1] === z * 60 ? 'selected' : ''}>${a}–${z} Uhr</option>`; }).join('')}
      </select>` : '<em>Salon geschlossen</em>'}</div>`; }).join('')}</div>`,
    actions: [...(edit ? [{ label: 'Entfernen', value: 'del', kind: 'btn-danger' }] : []), { label: 'Abbrechen', value: 'cancel' }, { label: 'Speichern', value: 'ok', kind: 'btn-dark' }],
  });
  d.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const f = $('form', d).elements;
    if (b.dataset.act === 'del') {
      e.preventDefault();
      try { await api.admin.removeStaff(s.id); d.close(); toast('Entfernt.'); await reload(); } catch (x) { d.error(x.message); }
      return;
    }
    if (b.dataset.act !== 'ok') return;
    e.preventDefault();
    const hrs = {};
    for (const [wd] of WD) { const el = f[`h${wd}`]; if (!el || el.value === 'salon') continue; hrs[wd] = el.value === 'off' ? null : el.value.split('-').map(Number); }
    try {
      const saved = await api.admin.saveStaff({ ...s, name: f.name.value.trim(), role: f.role.value.trim(), active: f.active.checked, hours: hrs });
      const chosen = $$('input[name="svc"]', d).filter((i) => i.checked).map((i) => i.value);
      for (const v of cat.services) {
        const has = v.staffIds.includes(saved.id), want = chosen.includes(v.id);
        if (has !== want) await api.admin.saveService({ ...v, staffIds: want ? [...v.staffIds, saved.id] : v.staffIds.filter((x) => x !== saved.id) });
      }
      d.close(); toast('Gespeichert.'); await reload();
    } catch (x) { d.error(x.message); }
  });
}

/* ---------- Leistungen ---------- */
function renderServices() {
  const cats = [...new Set(cat.services.map((s) => s.cat))];
  $('[data-service-list]').innerHTML = cats.map((c) => `<h2 class="tbl__group">${esc(c)}</h2><ul class="tbl">${cat.services.filter((s) => s.cat === c).map((s) => `
    <li class="tbl__row"><div class="tbl__main"><b>${esc(s.name)}</b><span>${s.staffIds.map((id) => esc(staffOf(id).name)).join(', ') || 'Niemand zugeordnet'}</span></div><span class="tbl__cell">${fmtDuration(s.duration)}</span><span class="tbl__cell tbl__price">${fmtPrice(s)}</span><span class="status status--${s.active !== false ? 'approved' : 'rejected'}">${s.active !== false ? 'Online' : 'Versteckt'}</span><button class="btn btn-outline btn-sm" data-edit-service="${s.id}">Bearbeiten</button></li>`).join('')}</ul>`).join('');
}
$('[data-add-service]').addEventListener('click', () => serviceDialog({ cat: 'Herren', duration: 30, price: 3000, priceMode: 'fixed', staffIds: cat.staff.map((s) => s.id) }));
$('[data-service-list]').addEventListener('click', (e) => { const b = e.target.closest('[data-edit-service]'); if (b) serviceDialog(cat.services.find((s) => s.id === b.dataset.editService)); });
function serviceDialog(s) {
  const edit = !!s.id;
  const euro = (c) => (c == null ? '' : String(c / 100).replace('.', ','));
  const d = openDialog({
    title: edit ? s.name : 'Neue Leistung', wide: true,
    body: `<div class="grid2">
      <div class="field span2"><label class="label" for="sv-name">Name</label><input class="input" id="sv-name" name="name" value="${esc(s.name || '')}" autocomplete="off"></div>
      <div class="field"><label class="label" for="sv-cat">Bereich</label><input class="input" id="sv-cat" name="cat" value="${esc(s.cat || '')}" list="sv-cats" autocomplete="off"><datalist id="sv-cats"><option value="Herren"><option value="Damen"></datalist></div>
      <div class="field"><label class="label" for="sv-dur">Dauer in Minuten</label><input class="input" id="sv-dur" name="duration" type="number" min="5" step="5" value="${s.duration}"></div>
      <div class="field"><label class="label" for="sv-mode">Preisangabe</label><select class="input select" id="sv-mode" name="priceMode"><option value="fixed" ${s.priceMode === 'fixed' ? 'selected' : ''}>Festpreis</option><option value="from" ${s.priceMode === 'from' ? 'selected' : ''}>ab</option><option value="range" ${s.priceMode === 'range' ? 'selected' : ''}>von – bis</option></select></div>
      <div class="field"><label class="label" for="sv-price">Preis in €</label><input class="input" id="sv-price" name="price" inputmode="decimal" value="${euro(s.price)}"></div>
      <div class="field"><label class="label" for="sv-to">Bis € <span class="label__hint">nur bei von – bis</span></label><input class="input" id="sv-to" name="priceTo" inputmode="decimal" value="${euro(s.priceTo)}"></div>
      <label class="check"><input type="checkbox" name="active" ${s.active !== false ? 'checked' : ''}> Online buchbar</label>
    </div>
    <p class="label dlg__sub">Wer bietet sie an</p>
    <div class="checks">${cat.staff.map((st) => `<label class="check"><input type="checkbox" name="st" value="${st.id}" ${s.staffIds.includes(st.id) ? 'checked' : ''}> ${esc(st.name)}</label>`).join('')}</div>`,
    actions: [...(edit ? [{ label: 'Löschen', value: 'del', kind: 'btn-danger' }] : []), { label: 'Abbrechen', value: 'cancel' }, { label: 'Speichern', value: 'ok', kind: 'btn-dark' }],
  });
  d.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const f = $('form', d).elements;
    if (b.dataset.act === 'del') {
      e.preventDefault(); d.close();
      if (!(await confirmDialog('Leistung löschen?', 'Bestehende Termine bleiben erhalten. Tipp: „Online buchbar“ abwählen blendet sie nur aus.', 'Löschen', true))) return;
      await api.admin.removeService(s.id); toast('Gelöscht.'); await reload(); return;
    }
    if (b.dataset.act !== 'ok') return;
    e.preventDefault();
    const cents = (v) => (v === '' ? null : Math.round(parseFloat(String(v).replace(',', '.')) * 100));
    try {
      await api.admin.saveService({ ...s, name: f.name.value.trim(), cat: f.cat.value.trim() || 'Herren', duration: Number(f.duration.value), priceMode: f.priceMode.value, price: cents(f.price.value), priceTo: cents(f.priceTo.value), active: f.active.checked, staffIds: $$('input[name="st"]', d).filter((i) => i.checked).map((i) => i.value) });
      d.close(); toast('Gespeichert. Website und Buchung zeigen den neuen Stand.'); await reload();
    } catch (x) { d.error(x.message); }
  });
}

/* ---------- Einstellungen ---------- */
function renderSettings() {
  const s = cat.settings;
  const f = $('[data-settings]');
  f.innerHTML = `<fieldset class="set-block"><legend class="label">Öffnungszeiten</legend>${WD.map(([wd, l]) => { const h = s.hours[wd]; return `<div class="hours-edit__row"><span>${l}</span><label class="check"><input type="checkbox" name="open${wd}" ${h ? 'checked' : ''}> geöffnet</label><select class="input select" name="o${wd}" aria-label="${l} öffnet">${timeOptions(h ? h[0] : 720, 6 * 60, 23 * 60)}</select><select class="input select" name="c${wd}" aria-label="${l} schließt">${timeOptions(h ? h[1] : 1140, 6 * 60, 23 * 60)}</select></div>`; }).join('')}</fieldset>
    <fieldset class="set-block"><legend class="label">Buchungsregeln</legend><div class="grid3">
      <div class="field"><label class="label" for="se-lead">Vorlauf (Minuten)</label><input class="input" id="se-lead" name="leadMinutes" type="number" min="0" step="15" value="${s.leadMinutes}"></div>
      <div class="field"><label class="label" for="se-cancel">Storno bis (Stunden vorher)</label><input class="input" id="se-cancel" name="cancelHours" type="number" min="0" value="${s.cancelHours}"></div>
      <div class="field"><label class="label" for="se-hor">Buchbar im Voraus (Tage)</label><input class="input" id="se-hor" name="horizonDays" type="number" min="7" value="${s.horizonDays}"></div>
    </div></fieldset>
    <div class="row-actions"><button class="btn btn-dark btn-sm" type="submit">Speichern</button><button class="btn btn-outline btn-sm" type="button" data-demo-reset2>Demo zurücksetzen</button></div>`;
  $('[data-demo-reset2]', f).addEventListener('click', () => $('[data-demo-reset]').click());
}
$('[data-settings]').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget.elements;
  const hours = {};
  for (const [wd] of WD) hours[wd] = f[`open${wd}`].checked ? [Number(f[`o${wd}`].value), Number(f[`c${wd}`].value)] : null;
  if (Object.values(hours).some((h) => h && h[1] <= h[0])) { toast('Schließzeit muss nach der Öffnungszeit liegen.', 'is-error'); return; }
  await api.admin.saveSettings({ hours, leadMinutes: Number(f.leadMinutes.value), cancelHours: Number(f.cancelHours.value), horizonDays: Number(f.horizonDays.value) });
  toast('Einstellungen gespeichert.'); await reload();
});

init();
