/* BRK Studio Plattform – Buchungsstrecke /buchen/ */
import { api } from './api.js';
import { $, $$, toast, daysStrip, slotGrid, initChrome, icsFor, esc, addDays, fmtDate, hhmm } from './ui.js';
import { fmtPrice, fmtDuration } from './util.js';
import { authFormsHTML, bindAuthForms } from './auth-forms.js';

const root = $('[data-bk]');
const q = new URLSearchParams(location.search);
const today = api.now().date;
const S = { serviceId: q.get('s') || '', staffId: q.get('st') || 'any', date: q.get('d') || '', start: q.has('t') ? Number(q.get('t')) : null, from: today, user: null };
const DAYS = 14;
let cat;

async function init() {
  S.user = await initChrome();
  cat = await api.catalog();
  if (!cat.services.some((s) => s.id === S.serviceId && s.active !== false)) S.serviceId = '';
  if (S.date && S.date >= today) S.from = S.date > addDays(today, DAYS - 1) ? S.date : today;
  renderServices(); renderStaff(); await renderDays(); await renderSlots(); renderAccount(); summary();
  window.addEventListener('brk:data', async () => { cat = await api.catalog(); await renderDays(); await renderSlots(); });
}

function renderServices() {
  const groups = [...new Set(cat.services.filter((s) => s.active !== false).map((s) => s.cat))];
  $('[data-services]', root).innerHTML = groups.map((g) => `<p class="svc-list__group">${esc(g)}</p>` + cat.services.filter((s) => s.cat === g && s.active !== false).map((s) => `
    <label class="svc-opt"><input type="radio" name="service" value="${s.id}" ${S.serviceId === s.id ? 'checked' : ''}>
      <span class="svc-opt__in"><span class="svc-opt__name">${esc(s.name)}</span><span class="svc-opt__meta">${fmtDuration(s.duration)}</span><span class="svc-opt__price">${fmtPrice(s)}</span></span></label>`).join('')).join('');
  $$('input[name="service"]', root).forEach((i) => i.addEventListener('change', async () => {
    S.serviceId = i.value; S.start = null;
    const svc = cat.services.find((s) => s.id === S.serviceId);
    if (S.staffId !== 'any' && !svc.staffIds.includes(S.staffId)) S.staffId = 'any';
    renderStaff(); await renderDays(); await renderSlots(); summary();
  }));
}

function renderStaff() {
  const svc = cat.services.find((s) => s.id === S.serviceId);
  const team = cat.staff.filter((s) => s.active !== false && (!svc || svc.staffIds.includes(s.id)));
  const opt = (id, name, role) => `<label class="staff-opt"><input type="radio" name="staff" value="${id}" ${S.staffId === id ? 'checked' : ''}><span><b>${esc(name)}</b><small>${esc(role)}</small></span></label>`;
  $('[data-staff]', root).innerHTML = opt('any', 'Egal', 'Erste freie Zeit') + team.map((s) => opt(s.id, s.name, s.role || '')).join('');
  $$('input[name="staff"]', root).forEach((i) => i.addEventListener('change', async () => { S.staffId = i.value; S.start = null; await renderDays(); await renderSlots(); summary(); }));
}

async function renderDays() {
  const days = await api.daysOverview({ serviceId: S.serviceId, staffId: S.staffId, from: S.from, days: DAYS });
  if (S.date && !days.some((d) => d.date === S.date && d.open && d.free !== 0)) { if (S.date >= S.from && S.date <= addDays(S.from, DAYS - 1)) S.date = ''; }
  if (!S.date && S.serviceId) { const f = days.find((d) => d.open && d.free > 0); if (f) S.date = f.date; }
  $('[data-days]', root).innerHTML = daysStrip(days, S.date);
  $('[data-days-label]', root).textContent = `${fmtDate(S.from, 'short')} – ${fmtDate(addDays(S.from, DAYS - 1), 'short')}`;
  $('[data-days-prev]', root).disabled = S.from <= today;
  $$('input[name="date"]', root).forEach((i) => i.addEventListener('change', async () => { S.date = i.value; S.start = null; await renderSlots(); summary(); }));
}

async function renderSlots() {
  const box = $('[data-slots]', root);
  if (!S.serviceId) { box.innerHTML = '<p class="slots__empty">Wähle zuerst eine Leistung, dann zeigen wir die freien Zeiten.</p>'; return; }
  if (!S.date) { box.innerHTML = '<p class="slots__empty">In diesem Zeitraum ist nichts frei. Blättere weiter.</p>'; return; }
  const slots = await api.slots({ serviceId: S.serviceId, staffId: S.staffId, date: S.date });
  if (S.start != null && !slots.some((s) => s.start === S.start)) S.start = null;
  box.innerHTML = `<p class="slot-wrap__date">${fmtDate(S.date)}</p>${slotGrid(slots, S.start)}`;
  $$('input[name="time"]', box).forEach((i) => i.addEventListener('change', () => { S.start = Number(i.value); S.slotStaff = slots.find((s) => s.start === S.start).staffIds; summary(); }));
}

function renderAccount() {
  const box = $('[data-account]', root);
  if (S.user) {
    box.innerHTML = `<div class="who"><p class="who__name">${esc(S.user.name)}</p><p class="who__meta">${esc(S.user.email)}${S.user.phone ? ` · ${esc(S.user.phone)}` : ''}</p><button type="button" class="link-quiet link-quiet--dark" data-logout>Nicht du? Abmelden</button></div>`;
    $('[data-logout]', box).addEventListener('click', async () => { await api.logout(); S.user = null; renderAccount(); summary(); initChrome(); });
  } else {
    box.innerHTML = `<p class="bk-step__intro">Mit Konto kannst du später selbst stornieren, verschieben und bewerten.</p>${authFormsHTML({ idp: 'bk' })}`;
    bindAuthForms(box, { onAuth: (u) => { S.user = u; renderAccount(); summary(); initChrome(); toast(`Angemeldet als ${u.name}.`); $('[data-book-submit]').focus(); } });
  }
  $('[data-val="account"]', root).textContent = S.user ? S.user.name : '';
}

function summary() {
  const svc = cat.services.find((s) => s.id === S.serviceId);
  const st = S.staffId === 'any' ? null : cat.staff.find((s) => s.id === S.staffId);
  const set = (k, v) => { $(`[data-sum="${k}"]`).textContent = v || '–'; };
  const staffLabel = st ? st.name : (S.start != null && S.slotStaff ? `Egal (${S.slotStaff.map((id) => cat.staff.find((x) => x.id === id).name).join(' oder ')})` : 'Egal');
  set('service', svc && svc.name); set('staff', staffLabel);
  set('time', S.date && S.start != null ? `${fmtDate(S.date, 'short')}, ${hhmm(S.start)} Uhr` : '');
  set('duration', svc && fmtDuration(svc.duration)); set('price', svc && fmtPrice(svc));
  $('[data-val="service"]', root).textContent = svc ? svc.name : '';
  $('[data-val="staff"]', root).textContent = staffLabel;
  $('[data-val="time"]', root).textContent = S.date && S.start != null ? `${fmtDate(S.date, 'short')} · ${hhmm(S.start)}` : '';
  const ready = svc && S.date && S.start != null;
  const btn = $('[data-book-submit]');
  btn.disabled = !ready;
  $('[data-sum-hint]').textContent = !ready ? 'Wähle Leistung, Tag und Uhrzeit.' : S.user ? 'Alles bereit.' : 'Zum Buchen kurz anmelden oder Konto anlegen.';
  $$('.bk-step', root).forEach((s) => s.classList.toggle('is-done', !!$(`[data-val="${s.dataset.step}"]`, s).textContent && (s.dataset.step !== 'staff' || !!svc)));
}

$('[data-days-prev]', root).addEventListener('click', async () => { S.from = addDays(S.from, -DAYS); if (S.from < today) S.from = today; S.date = ''; S.start = null; await renderDays(); await renderSlots(); summary(); });
$('[data-days-next]', root).addEventListener('click', async () => { S.from = addDays(S.from, DAYS); S.date = ''; S.start = null; await renderDays(); await renderSlots(); summary(); });

$('[data-book-submit]').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  if (!S.user) { toast('Bitte melde dich an oder lege ein Konto an.'); const f = $('[data-account] input'); if (f) { f.scrollIntoView({ block: 'center', behavior: 'smooth' }); f.focus({ preventScroll: true }); } return; }
  if (S.user.role === 'admin') { toast('Als Admin bitte Termine im Studio-Pult anlegen.'); return; }
  btn.disabled = true; btn.classList.add('is-busy');
  try {
    const a = await api.book({ serviceId: S.serviceId, staffId: S.staffId === 'any' ? null : S.staffId, date: S.date, start: S.start, note: $('[data-note]').value });
    const svc = cat.services.find((s) => s.id === a.serviceId), st = cat.staff.find((s) => s.id === a.staffId);
    $('[data-done-text]').textContent = `${svc.name} bei ${st.name} am ${fmtDate(a.date)} um ${hhmm(a.start)} Uhr. Fleischmengergasse 29, 50676 Köln.`;
    $('[data-ics]').href = icsFor({ date: a.date, start: a.start, duration: a.duration, title: `BRK Studio: ${svc.name}`, location: 'BRK Studio, Fleischmengergasse 29, 50676 Köln' });
    $('.bk__grid', root).hidden = true; $('.app-hero', root).hidden = true;
    const done = $('[data-bk-done]'); done.hidden = false; window.scrollTo(0, 0); done.focus();
  } catch (x) {
    toast(x.message, 'is-error');
    await renderDays(); await renderSlots(); summary();
  } finally { btn.classList.remove('is-busy'); btn.disabled = !(S.serviceId && S.date && S.start != null); }
});

init();
