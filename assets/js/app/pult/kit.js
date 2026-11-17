/* Studio-Pult – gemeinsame Bausteine: Zustand, Format, Zeitraum, Tabellen, Diagramme, Export, Druck.
   Alle Nutzerdaten gehen durch esc() bevor sie in Markup landen. */
import { esc, addDays, mondayOf, hhmm, nowCologne, weekday } from '../util.js';
import { eur, pct, toCSV, num2 } from '../ledger.js';
import { addMonth } from '../seed-pult.js';

export const P = { db: null, me: null, gross: true, range: null, preset: 'month' };
export const isAdmin = () => P.me && P.me.role === 'admin';
export const today = () => nowCologne().date;
export { esc, eur, pct, hhmm, addDays, addMonth, weekday, num2 };

export const staffName = (id) => (P.db.staff.find((s) => s.id === id) || { name: id === 'system' ? 'System' : '–' }).name;
export const svcOf = (id) => P.db.services.find((s) => s.id === id);
export const clientOf = (id) => P.db.clients.find((c) => c.id === id);
export const productOf = (id) => P.db.products.find((p) => p.id === id);
export const dateDE = (iso) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : '–');
export const monthDE = (ym) => new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${ym}-15T12:00:00Z`));
export const int = (n) => Number(n || 0).toLocaleString('de-DE');
export const euroIn = (c) => (c == null ? '' : num2(c).replace(/\./g, ''));
export const exampleTag = (x) => (x && x.example ? '<span class="tag">Beispiel</span>' : '');

/* ---------- Zeitraum ---------- */
export const PRESETS = [['today', 'Heute'], ['yesterday', 'Gestern'], ['week', 'Diese Woche'], ['month', 'Dieser Monat'], ['lastmonth', 'Letzter Monat'], ['quarter', 'Quartal'], ['year', 'Dieses Jahr'], ['custom', 'Zeitraum']];
export function presetRange(k, t = today()) {
  const ym = t.slice(0, 7);
  const end = (m) => { const [y, mo] = m.split('-').map(Number); return `${m}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, '0')}`; };
  switch (k) {
    case 'today': return { from: t, to: t };
    case 'yesterday': return { from: addDays(t, -1), to: addDays(t, -1) };
    case 'week': return { from: mondayOf(t), to: addDays(mondayOf(t), 6) };
    case 'lastmonth': { const m = addMonth(ym, -1); return { from: `${m}-01`, to: end(m) }; }
    case 'quarter': { const q = Math.floor((Number(ym.slice(5)) - 1) / 3) * 3 + 1; const m = `${ym.slice(0, 4)}-${String(q).padStart(2, '0')}`; return { from: `${m}-01`, to: end(addMonth(m, 2)) }; }
    case 'year': return { from: `${t.slice(0, 4)}-01-01`, to: `${t.slice(0, 4)}-12-31` };
    case 'month': default: return { from: `${ym}-01`, to: end(ym) };
  }
}
export function ensureRange() { if (!P.range) P.range = presetRange(P.preset); return P.range; }
/** Vergleichszeitraum ein Jahr früher */
export const lastYear = (r) => ({ from: `${Number(r.from.slice(0, 4)) - 1}${r.from.slice(4)}`, to: `${Number(r.to.slice(0, 4)) - 1}${r.to.slice(4)}`.replace(/-02-29$/, '-02-28') });

export function toolbar({ range = true, vat = true, csv = '', print = true, extra = '' } = {}) {
  const r = ensureRange();
  return `<div class="tbar" data-tbar>
    ${range ? `<div class="tbar__range">
      <label class="sr-only" for="tb-preset">Zeitraum</label>
      <select class="select select--box" id="tb-preset" data-preset>${PRESETS.map(([k, l]) => `<option value="${k}" ${P.preset === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <label class="tbar__date"><span class="sr-only">Von</span><input class="input input--sm" type="date" data-from value="${r.from}"></label>
      <span aria-hidden="true">–</span>
      <label class="tbar__date"><span class="sr-only">Bis</span><input class="input input--sm" type="date" data-to value="${r.to}"></label>
    </div>` : ''}
    <div class="tbar__tools">${extra}
      ${vat ? `<div class="seg seg--sm" role="group" aria-label="Beträge"><button type="button" data-vat="gross" aria-pressed="${P.gross}">inkl. MwSt.</button><button type="button" data-vat="net" aria-pressed="${!P.gross}">exkl. MwSt.</button></div>` : ''}
      ${csv ? `<button type="button" class="btn btn-outline btn-sm" data-csv="${esc(csv)}">CSV</button>` : ''}
      ${print ? '<button type="button" class="btn btn-outline btn-sm" data-print>Drucken</button>' : ''}
    </div>
  </div>`;
}
/** Delegierte Ereignisse der Werkzeugleiste in einem Panel. */
export function bindToolbar(root, rerender) {
  if (root._tb) return; root._tb = true;
  root.addEventListener('change', (e) => {
    if (e.target.matches('[data-preset]')) { P.preset = e.target.value; if (P.preset !== 'custom') P.range = presetRange(P.preset); rerender(); }
    else if (e.target.matches('[data-from],[data-to]')) {
      const f = root.querySelector('[data-from]').value, t = root.querySelector('[data-to]').value;
      if (f && t && f <= t) { P.range = { from: f, to: t }; P.preset = 'custom'; rerender(); }
    }
  });
  root.addEventListener('click', (e) => {
    const v = e.target.closest('[data-vat]'); if (v) { P.gross = v.dataset.vat === 'gross'; rerender(); return; }
    const c = e.target.closest('[data-csv]'); if (c) { exportCSV(c.dataset.csv); return; }
    if (e.target.closest('[data-print]')) window.print();
  });
}

/* ---------- Tabellen ---------- */
const EXPORTS = new Map();
const cellVal = (c, r) => (c.get ? c.get(r) : r[c.key]);
function fmtCell(c, v, r) {
  if (c.html) return c.html(r);
  switch (c.type) {
    case 'money': return eur(v);
    case 'amount': return eur(v == null ? 0 : P.gross ? v.gross : v.net);
    case 'int': return int(v);
    case 'pct': return v == null ? '–' : pct(v);
    case 'date': return dateDE(v);
    case 'time': return v == null ? '–' : hhmm(v);
    default: return esc(v == null || v === '' ? '–' : v);
  }
}
const isNum = (c) => ['money', 'amount', 'int', 'pct'].includes(c.type) || c.num;
export function table({ id, title = '', cols, rows, foot = null, empty = 'Keine Einträge im gewählten Zeitraum.', rowAttr = () => '', cls = '' }) {
  EXPORTS.set(id, { title: title || id, cols, rows, foot });
  if (!rows.length) return `<p class="empty">${esc(empty)}</p>`;
  const th = cols.map((c) => `<th scope="col"${isNum(c) ? ' class="num"' : ''}>${esc(c.label)}</th>`).join('');
  const tr = rows.map((r) => `<tr ${rowAttr(r)}>${cols.map((c, i) => { const v = cellVal(c, r); const t = i === 0 ? 'th scope="row"' : 'td'; return `<${t}${isNum(c) ? ' class="num"' : c.cls ? ` class="${c.cls}"` : ''}>${fmtCell(c, v, r)}</${t.split(' ')[0]}>`; }).join('')}</tr>`).join('');
  const tf = foot ? `<tfoot><tr>${cols.map((c, i) => { const v = c.footVal ? c.footVal(foot) : c.html && !c.foot ? null : (() => { try { return cellVal(c, foot); } catch (_) { return null; } })(); return `<${i ? 'td' : 'th scope="row"'}${isNum(c) ? ' class="num"' : ''}>${i === 0 ? esc(foot.label || 'Summe') : v == null || (typeof v === 'number' && Number.isNaN(v)) ? '' : fmtCell({ ...c, html: null }, v, foot)}</${i ? 'td' : 'th'}>`; }).join('')}</tr></tfoot>` : '';
  return `<div class="dt-wrap ${cls}"><table class="dt" data-table="${esc(id)}"><thead><tr>${th}</tr></thead><tbody>${tr}</tbody>${tf}</table></div>`;
}
export function exportCSV(id) {
  const t = EXPORTS.get(id); if (!t) return;
  const src = t.cols.filter((c) => !c.noExport);
  const cols = src.map((c, i) => ({
    label: c.type === 'amount' ? `${c.label} (${P.gross ? 'brutto' : 'netto'})` : c.label,
    type: c.type === 'amount' || c.type === 'money' ? 'money' : c.type === 'int' ? 'num' : c.type === 'pct' ? 'pct' : 'text',
    get: (r) => {
      if (i === 0 && r.__foot) return r.label || 'Summe';
      let v;
      try { v = r.__foot ? (c.footVal ? c.footVal(r) : c.html && !c.foot ? null : cellVal(c, r)) : c.csv ? c.csv(r) : cellVal(c, r); } catch (_) { v = null; }
      if (v == null || (typeof v === 'number' && Number.isNaN(v))) return c.type === 'pct' ? '' : c.type === 'amount' || c.type === 'money' ? null : '';
      if (c.type === 'amount') return P.gross ? v.gross : v.net;
      if (c.type === 'date') return dateDE(v);
      if (c.type === 'time') return hhmm(v);
      return v;
    },
  }));
  const rows = t.foot ? [...t.rows, { ...t.foot, __foot: true }] : t.rows;
  const csv = toCSV(rows, cols);
  const r = ensureRange();
  download(`${slug(t.title)}_${r.from}_${r.to}.csv`, new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }));
}
export const slug = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ß/g, 'ss').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'export';
export function download(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/* ---------- Kennzahlen-Kacheln ---------- */
export function tiles(list, cls = '') {
  return `<dl class="kpis ${list.length > 4 ? 'kpis--many' : 'kpis--few'} ${cls}">${list.map((k) => `<div${k.accent ? ' class="is-accent"' : ''}><dt>${esc(k.label)}</dt><dd>${k.value}</dd>${k.sub ? `<p class="kpi__sub${k.trend > 0 ? ' is-up' : k.trend < 0 ? ' is-down' : ''}">${k.sub}</p>` : ''}</div>`).join('')}</dl>`;
}
export function trend(cur, prev) {
  if (!prev) return { sub: 'Vorjahr: keine Daten', trend: 0 };
  const d = (cur - prev) / Math.abs(prev);
  return { sub: `${d >= 0 ? '+' : '−'}${pct(Math.abs(d))} zum Vorjahr`, trend: Math.sign(d) };
}

/* ---------- Diagramme (SVG, nur Zahlen und escapte Beschriftungen) ---------- */
export function bars(series, { height = 180, fmt = eur, compare = null, label = 'Diagramm' } = {}) {
  if (!series.length) return '<p class="empty">Keine Daten.</p>';
  const W = Math.max(320, series.length * 28), H = height, pad = 22;
  const max = Math.max(1, ...series.map((s) => s.value), ...(compare || []).map((s) => s.value));
  const bw = (W / series.length) * 0.62;
  const step = W / series.length;
  const every = Math.ceil(series.length / 12);
  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H + pad}" preserveAspectRatio="none" role="img" aria-label="${esc(label)}">`;
  for (let g = 1; g <= 3; g++) svg += `<line class="chart__grid" x1="0" x2="${W}" y1="${H - (H * g) / 3}" y2="${H - (H * g) / 3}"/>`;
  series.forEach((s, i) => {
    const h = (Math.max(0, s.value) / max) * (H - 8);
    const x = i * step + (step - bw) / 2;
    svg += `<rect class="chart__bar${s.hi ? ' is-hi' : ''}" x="${x.toFixed(1)}" y="${(H - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}"><title>${esc(s.label)}: ${esc(fmt(s.value))}</title></rect>`;
    if (i % every === 0) svg += `<text class="chart__x" x="${(i * step + step / 2).toFixed(1)}" y="${H + 15}" text-anchor="middle">${esc(s.short || s.label)}</text>`;
  });
  if (compare) {
    const pts = compare.map((s, i) => `${(i * step + step / 2).toFixed(1)},${(H - (Math.max(0, s.value) / max) * (H - 8)).toFixed(1)}`).join(' ');
    svg += `<polyline class="chart__cmp" points="${pts}"/>`;
  }
  svg += '</svg>';
  return `<figure class="chart-wrap">${svg}<figcaption class="chart__legend"><span class="lg lg--bar"></span>${esc(label)}${compare ? '<span class="lg lg--line"></span>Vorjahr' : ''}<span class="chart__max">max. ${esc(fmt(max))}</span></figcaption></figure>`;
}
export function hbars(rows, { fmt = eur } = {}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return `<ol class="hbars">${rows.map((r) => `<li><span class="hbars__l">${esc(r.label)}</span><span class="hbars__v">${esc(fmt(r.value))}</span><span class="hbars__track" aria-hidden="true"><span style="transform:scaleX(${(Math.max(0, r.value) / max).toFixed(3)})"></span></span></li>`).join('')}</ol>`;
}

/* ---------- Tabs ---------- */
export function tabs(name, list, current) {
  return `<div class="tabs" role="tablist" aria-label="${esc(name)}">${list.map(([k, l]) => `<button type="button" role="tab" data-tab="${k}" aria-selected="${k === current}">${esc(l)}</button>`).join('')}</div>`;
}

/* ---------- Druck eines einzelnen Belegs ---------- */
export function printOnly(html) {
  const root = document.querySelector('[data-print-root]');
  root.innerHTML = html;
  document.body.classList.add('is-printing-doc');
  const done = () => { document.body.classList.remove('is-printing-doc'); root.innerHTML = ''; window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  window.print();
  setTimeout(done, 1500);
}
export const head = (title, right = '', sub = '') => `<header class="panel-head"><div><h1 class="panel-title" tabindex="-1">${esc(title)}</h1>${sub ? `<p class="panel-sub">${sub}</p>` : ''}</div><div class="panel-head__tools">${right}</div></header>`;
export const demoNote = (t) => `<p class="note-demo"><span class="demo-flag__dot" aria-hidden="true"></span>${t}</p>`;
