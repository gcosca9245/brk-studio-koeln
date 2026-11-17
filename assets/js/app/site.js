/* BRK Studio – Website: echte freie Zeiten, Preise und Bewertungen aus der Plattform */
import { api } from './api.js';
import { $, $$, stars, daysStrip, slotGrid, initChrome, esc, fmtDate, hhmm } from './ui.js';
import { fmtPrice, fmtDuration } from './util.js';

const box = $('[data-site-booking]');
const S = { serviceId: '', staffId: 'any', date: '', start: null };
let cat;

async function init() {
  initChrome();
  cat = await api.catalog();
  hydratePrices();
  if (box) { renderServices(); renderStaff(); await renderDays(); await renderSlots(); update(); }
  renderReviews();
  // Änderungen aus dem Studio-Pult (anderer Tab) sofort übernehmen
  window.addEventListener('brk:data', async () => { cat = await api.catalog(); hydratePrices(); if (box) { await renderDays(); await renderSlots(); update(); } renderReviews(); });
}

/* Preise und Dauer in „Leistungen“ kommen aus derselben Quelle wie die Buchung */
function hydratePrices() {
  $$('[data-svc]').forEach((li) => {
    const s = cat.services.find((x) => x.id === li.dataset.svc);
    if (!s) return;
    const price = $('.svc__price', li), time = $('.svc__time', li);
    if (price) price.innerHTML = `<span class="sr-only">Preis: </span>${s.priceMode === 'from' ? `<span class="svc__from">ab</span> ${fmtPrice({ ...s, priceMode: 'fixed' })}` : fmtPrice(s)}`;
    if (time) time.textContent = `ca. ${fmtDuration(s.duration)}`;
    li.hidden = s.active === false;
  });
}

function renderServices() {
  const groups = [...new Set(cat.services.filter((s) => s.active !== false).map((s) => s.cat))];
  $('[data-site-services]', box).innerHTML = groups.map((g) => `<p class="svc-pick__group">${esc(g)}</p>${cat.services.filter((s) => s.cat === g && s.active !== false).map((s) => `<label class="pill"><input type="radio" name="service" value="${s.id}" ${S.serviceId === s.id ? 'checked' : ''}><span>${esc(s.name)} <em>${fmtPrice(s)}</em></span></label>`).join('')}`).join('');
}
function renderStaff() {
  const svc = cat.services.find((s) => s.id === S.serviceId);
  const team = cat.staff.filter((s) => s.active !== false && (!svc || svc.staffIds.includes(s.id)));
  if (S.staffId !== 'any' && !team.some((s) => s.id === S.staffId)) S.staffId = 'any';
  $('[data-site-staff]', box).innerHTML = `<label class="pill"><input type="radio" name="site-staff" value="any" ${S.staffId === 'any' ? 'checked' : ''}><span>Egal</span></label>${team.map((s) => `<label class="pill"><input type="radio" name="site-staff" value="${s.id}" ${S.staffId === s.id ? 'checked' : ''}><span>${esc(s.name)}</span></label>`).join('')}`;
}
async function renderDays() {
  const days = await api.daysOverview({ serviceId: S.serviceId, staffId: S.staffId, from: api.now().date, days: 14 });
  if (S.date && !days.some((d) => d.date === S.date && d.open && d.free !== 0)) S.date = '';
  if (!S.date && S.serviceId) { const f = days.find((d) => d.open && d.free > 0); if (f) S.date = f.date; }
  $('[data-site-days]', box).innerHTML = daysStrip(days, S.date, 'date');
  const total = days.reduce((n, d) => n + (d.free || 0), 0);
  $('[data-site-days-hint]', box).textContent = S.serviceId ? `${total} freie Zeiten in 14 Tagen` : '';
}
async function renderSlots() {
  const el = $('[data-site-slots]', box);
  const hint = $('[data-site-slot-hint]', box);
  if (!S.serviceId) { el.innerHTML = ''; hint.textContent = 'Bitte zuerst eine Leistung wählen'; return; }
  if (!S.date) { el.innerHTML = '<p class="slots__empty">In den nächsten 14 Tagen ist nichts frei. Im Buchungsbereich kannst du weiterblättern.</p>'; hint.textContent = ''; return; }
  const slots = await api.slots({ serviceId: S.serviceId, staffId: S.staffId, date: S.date });
  if (S.start != null && !slots.some((s) => s.start === S.start)) S.start = null;
  el.innerHTML = slotGrid(slots, S.start, 'time');
  hint.textContent = slots.length ? `${slots.length} frei am ${fmtDate(S.date, 'short')}` : '';
}
function update() {
  const svc = cat.services.find((s) => s.id === S.serviceId);
  const a = $('[data-site-continue]', box);
  const p = new URLSearchParams();
  if (S.serviceId) p.set('s', S.serviceId);
  if (S.staffId !== 'any') p.set('st', S.staffId);
  if (S.date) p.set('d', S.date);
  if (S.start != null) p.set('t', S.start);
  a.href = `buchen/${p.toString() ? `?${p}` : ''}`;
  const ready = svc && S.date && S.start != null;
  a.classList.toggle('is-disabled', !ready);
  a.setAttribute('aria-disabled', String(!ready));
  a.textContent = ready ? `${hhmm(S.start)} Uhr reservieren` : 'Weiter zur Buchung';
  $('[data-site-summary]', box).textContent = svc ? [svc.name, fmtPrice(svc), S.date && fmtDate(S.date), S.start != null && `${hhmm(S.start)} Uhr`].filter(Boolean).join(' · ') : '';
}

if (box) {
  box.addEventListener('change', async (e) => {
    const n = e.target.name;
    if (n === 'service') { S.serviceId = e.target.value; S.start = null; renderStaff(); await renderDays(); await renderSlots(); }
    if (n === 'site-staff') { S.staffId = e.target.value; S.start = null; await renderDays(); await renderSlots(); }
    if (n === 'date') { S.date = e.target.value; S.start = null; await renderSlots(); }
    if (n === 'time') S.start = Number(e.target.value);
    update();
  });
  $('[data-site-continue]', box).addEventListener('click', (e) => {
    if (e.currentTarget.getAttribute('aria-disabled') === 'true') { e.preventDefault(); const t = !S.serviceId ? $('input[name="service"]', box) : $('input[name="time"]', box); if (t) t.focus(); }
  });
  // „Buchen“-Links in Leistungen / im Spiel wählen die Leistung vor (Klick-Handler in main.js löst change aus)
  $$('[data-book]').forEach((b) => b.addEventListener('click', async () => {
    const id = b.dataset.book;
    if (!cat || !cat.services.some((s) => s.id === id)) return;
    S.serviceId = id; S.start = null; renderServices(); renderStaff(); await renderDays(); await renderSlots(); update();
  }));
}

/* ---------- Bewertungen: Durchschnitt nur aus freigegebenen Einträgen ---------- */
async function renderReviews() {
  const list = $('[data-reviews-list]');
  if (!list) return;
  const sum = await api.publicReviews();
  $('[data-score-avg]').textContent = sum.count ? sum.avg.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '–';
  $('[data-score-stars]').innerHTML = stars(Math.round(sum.avg * 10) / 10, 15);
  $('[data-score-count]').textContent = `${sum.count} ${sum.count === 1 ? 'Bewertung' : 'Bewertungen'}`;
  $('[data-score-dist]').innerHTML = sum.dist.map((d) => `<li><span>${d.n}</span><span class="bar"><span style="transform:scaleX(${sum.count ? d.c / sum.count : 0})"></span></span><span>${d.c}</span></li>`).join('');
  const staffName = (id) => (cat.staff.find((s) => s.id === id) || {}).name || '';
  list.innerHTML = sum.list.slice(0, 6).map((r) => `<li class="quote">
      <div class="quote__top">${stars(r.rating, 13)}${r.example ? '<span class="tag tag--dark">Beispiel</span>' : ''}</div>
      <blockquote class="quote__text">${esc(r.text)}</blockquote>
      <p class="quote__by">${esc(r.name.replace(/^Beispiel · /, ''))}<span>${staffName(r.staffId) ? `bei ${esc(staffName(r.staffId))} · ` : ''}${new Date(r.createdAt).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}</span></p>
    </li>`).join('') || '<li class="quote"><p class="quote__text">Noch keine Bewertungen.</p></li>';
}

init();
