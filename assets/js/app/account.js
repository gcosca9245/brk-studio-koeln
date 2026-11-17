/* BRK Studio Plattform – Kundenkonto /konto/ */
import { api } from './api.js';
import { $, $$, toast, openDialog, confirmDialog, stars, starInput, daysStrip, slotGrid, initChrome, esc, addDays, fmtDate, hhmm } from './ui.js';
import { fmtPrice, fmtDuration } from './util.js';
import { authFormsHTML, bindAuthForms } from './auth-forms.js';

const root = $('[data-acc]');
let user, cat;

async function init() {
  user = await initChrome();
  cat = await api.catalog();
  if (user && user.role !== 'customer') { location.replace('../admin/'); return; }
  user ? showApp() : showAuth();
}

function showAuth() {
  $('[data-acc-app]').hidden = true;
  const s = $('[data-acc-auth]'); s.hidden = false;
  const box = $('[data-auth-forms]');
  box.innerHTML = authFormsHTML({ idp: 'acc' });
  bindAuthForms(box, { onAuth: async (u) => { user = u; await initChrome(); showApp(); toast(`Willkommen, ${u.name.split(' ')[0]}.`); } });
}

async function showApp() {
  $('[data-acc-auth]').hidden = true;
  $('[data-acc-app]').hidden = false;
  $('[data-hello]').textContent = `Hallo, ${user.name.split(' ')[0]}.`;
  route();
  await renderAppointments(); await renderReviews(); fillProfile();
}

/* ---------- Ansichten über Hash ---------- */
function route() {
  const v = (location.hash || '#termine').slice(1);
  const view = ['termine', 'bewertungen', 'profil'].includes(v) ? v : 'termine';
  $$('[data-view]').forEach((el) => { el.hidden = el.dataset.view !== view; });
  $$('[data-view-link]').forEach((a) => a.toggleAttribute('aria-current', a.dataset.viewLink === view));
}
window.addEventListener('hashchange', route);

const svcOf = (id) => cat.services.find((s) => s.id === id) || { name: 'Leistung', duration: 0, price: 0 };
const staffOf = (id) => cat.staff.find((s) => s.id === id) || { name: '–' };

async function renderAppointments() {
  const [list, reviews, settings] = [await api.myAppointments(), await api.myReviews(), cat.settings];
  const upcoming = list.filter((a) => a.status === 'booked' && !api.isPast(a));
  const past = list.filter((a) => a.status !== 'booked' || api.isPast(a)).reverse();
  const row = (a, kind) => {
    const svc = svcOf(a.serviceId), st = staffOf(a.staffId);
    const rv = reviews.find((r) => r.appointmentId === a.id);
    const change = api.canChange(a, settings.cancelHours);
    let actions = '';
    if (kind === 'up') actions = change ? `<button class="btn btn-outline btn-sm" data-move="${a.id}">Verschieben</button><button class="link-quiet link-quiet--dark" data-cancel="${a.id}">Stornieren</button>` : '<p class="appt__fine">Kurzfristige Änderungen bitte telefonisch.</p>';
    else if (a.status === 'cancelled') actions = '<p class="appt__fine">Storniert</p>';
    else actions = rv ? `<p class="appt__fine">${rv.status === 'approved' ? 'Bewertung veröffentlicht' : rv.status === 'rejected' ? 'Bewertung nicht veröffentlicht' : 'Bewertung wartet auf Freigabe'}</p>` : `<button class="btn btn-dark btn-sm" data-review="${a.id}">Bewerten</button>`;
    return `<li class="appt${a.status === 'cancelled' ? ' is-cancelled' : ''}">
      <div class="appt__date"><span class="appt__wd">${fmtDate(a.date, 'wd')}</span><span class="appt__day">${Number(a.date.slice(8))}</span><span class="appt__mon">${fmtDate(a.date, 'mon')}</span></div>
      <div class="appt__main"><p class="appt__svc">${esc(svc.name)}</p><p class="appt__meta">${hhmm(a.start)}–${hhmm(a.start + a.duration)} Uhr · bei ${esc(st.name)} · ${fmtPrice(svc)}${a.example ? ' · <span class="tag">Beispiel</span>' : ''}</p></div>
      <div class="appt__actions">${actions}</div></li>`;
  };
  $('[data-upcoming]').innerHTML = upcoming.length ? upcoming.map((a) => row(a, 'up')).join('') : '<li class="empty">Keine anstehenden Termine. <a href="../buchen/">Jetzt buchen</a></li>';
  $('[data-past]').innerHTML = past.length ? past.map((a) => row(a, 'past')).join('') : '<li class="empty">Noch keine vergangenen Termine.</li>';
}

root.addEventListener('click', async (e) => {
  const c = e.target.closest('[data-cancel]'), m = e.target.closest('[data-move]'), r = e.target.closest('[data-review]');
  if (c) {
    const a = (await api.myAppointments()).find((x) => x.id === c.dataset.cancel);
    if (!(await confirmDialog('Termin stornieren?', `${svcOf(a.serviceId).name} am ${fmtDate(a.date)} um ${hhmm(a.start)} Uhr wird storniert. Die Zeit wird sofort wieder frei.`, 'Stornieren', true))) return;
    try { await api.cancelMine(a.id); toast('Termin storniert.'); await renderAppointments(); } catch (x) { toast(x.message, 'is-error'); }
  }
  if (m) moveDialog(m.dataset.move);
  if (r) reviewDialog(r.dataset.review);
});

/* ---------- Verschieben: gleiche Slot-Logik wie bei der Buchung ---------- */
async function moveDialog(id) {
  const a = (await api.myAppointments()).find((x) => x.id === id);
  const svc = svcOf(a.serviceId);
  const today = api.now().date;
  const st = { from: today, date: a.date, start: null, staffId: a.staffId };
  const d = openDialog({
    title: 'Termin verschieben', wide: true,
    body: `<p class="dlg__text">${esc(svc.name)} · bisher ${fmtDate(a.date, 'short')}, ${hhmm(a.start)} Uhr bei ${esc(staffOf(a.staffId).name)}</p>
      <div class="field"><label class="label" for="mv-staff">Bei</label><select class="input select" id="mv-staff" data-mv-staff><option value="any">Egal</option>${cat.staff.filter((s) => svc.staffIds.includes(s.id)).map((s) => `<option value="${s.id}" ${s.id === a.staffId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>
      <div class="days" data-mv-days role="radiogroup" aria-label="Tag"></div><div class="slot-wrap" data-mv-slots aria-live="polite"></div>`,
    actions: [{ label: 'Abbrechen', value: 'cancel' }, { label: 'Neue Zeit übernehmen', value: 'ok', kind: 'btn-dark' }],
  });
  const draw = async () => {
    const days = await api.daysOverview({ serviceId: a.serviceId, staffId: st.staffId, from: st.from, days: 14, excludeId: a.id });
    if (!days.some((x) => x.date === st.date && x.free)) { const f = days.find((x) => x.free); st.date = f ? f.date : ''; }
    $('[data-mv-days]', d).innerHTML = daysStrip(days, st.date, 'mvdate');
    const slots = st.date ? await api.slots({ serviceId: a.serviceId, staffId: st.staffId, date: st.date, excludeId: a.id }) : [];
    $('[data-mv-slots]', d).innerHTML = st.date ? slotGrid(slots, st.start, 'mvtime') : '';
  };
  d.addEventListener('change', async (e) => {
    if (e.target.name === 'mvdate') { st.date = e.target.value; st.start = null; await draw(); }
    if (e.target.name === 'mvtime') st.start = Number(e.target.value);
    if (e.target.matches('[data-mv-staff]')) { st.staffId = e.target.value; st.start = null; await draw(); }
  });
  d.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    if (b.dataset.act !== 'ok') return;
    e.preventDefault();
    if (st.start == null) { d.error('Bitte eine neue Uhrzeit wählen.'); return; }
    try { await api.rescheduleMine(a.id, { date: st.date, start: st.start, staffId: st.staffId === 'any' ? null : st.staffId }); d.close(); toast('Termin verschoben.'); await renderAppointments(); } catch (x) { d.error(x.message); await draw(); }
  });
  draw();
}

/* ---------- Bewerten ---------- */
function reviewDialog(id) {
  const d = openDialog({
    title: 'Wie war dein Termin?',
    body: `${starInput()}<div class="field"><label class="label" for="rv-text">Ein paar Worte</label><textarea class="input input--area" id="rv-text" name="text" rows="4" maxlength="600" placeholder="Was hat dir gefallen?"></textarea></div><p class="fine">Deine Bewertung erscheint mit Vorname und Initial, sobald das Studio sie freigegeben hat.</p>`,
    actions: [{ label: 'Abbrechen', value: 'cancel' }, { label: 'Bewertung senden', value: 'ok', kind: 'btn-dark' }],
  });
  d.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]'); if (!b || b.dataset.act !== 'ok') return;
    e.preventDefault();
    const f = $('form', d);
    const rating = (f.querySelector('input[name="rating"]:checked') || {}).value;
    try { await api.submitReview({ appointmentId: id, rating, text: f.elements.text.value }); d.close(); toast('Danke! Deine Bewertung wartet auf Freigabe.'); await renderAppointments(); await renderReviews(); } catch (x) { d.error(x.message); }
  });
}

async function renderReviews() {
  const list = (await api.myReviews()).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const label = { pending: 'Wartet auf Freigabe', approved: 'Veröffentlicht', rejected: 'Nicht veröffentlicht' };
  $('[data-my-reviews]').innerHTML = list.length ? list.map((r) => `<li class="rev"><div class="rev__top">${stars(r.rating)}<span class="status status--${r.status}">${label[r.status]}</span></div><p class="rev__text">${esc(r.text)}</p><p class="rev__meta">${new Date(r.createdAt).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' })} · ${esc(staffOf(r.staffId).name)}</p></li>`).join('') : '<li class="empty">Noch keine Bewertungen. Nach deinem Termin kannst du ihn unter „Termine“ bewerten.</li>';
}

/* ---------- Profil ---------- */
function fillProfile() {
  const f = $('[data-profile]');
  f.elements.name.value = user.name; f.elements.phone.value = user.phone || ''; f.elements.email.value = user.email;
}
$('[data-profile]').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget; const err = $('[data-error]', f); err.textContent = '';
  try {
    user = await api.updateProfile({ name: f.elements.name.value, phone: f.elements.phone.value, password: f.elements.password.value || undefined });
    f.elements.password.value = ''; toast('Profil gespeichert.'); $('[data-hello]').textContent = `Hallo, ${user.name.split(' ')[0]}.`; initChrome();
  } catch (x) { err.textContent = x.message; }
});
$('[data-logout]').addEventListener('click', async () => { await api.logout(); await initChrome(); user = null; showAuth(); toast('Abgemeldet.'); });
$('[data-delete]').addEventListener('click', async () => {
  if (!(await confirmDialog('Konto wirklich löschen?', 'Das lässt sich nicht rückgängig machen. Offene Termine bleiben ohne Kontaktdaten bestehen.', 'Endgültig löschen', true))) return;
  await api.deleteAccount(); await initChrome(); user = null; showAuth(); toast('Konto gelöscht.');
});
window.addEventListener('brk:data', () => { if (user) renderAppointments(); });

init();
