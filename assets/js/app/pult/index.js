/* Studio-Pult – Einstieg der Module: Daten laden, Panels rendern, Rollen, Auto-Logout */
import { P } from './kit.js';
import { pult } from '../pult-api.js';
import { renderKasse, bindKasse } from './kasse.js';
import { renderUebersicht, renderBuchhaltung, renderZahlungen, renderStatistiken } from './finanzen.js';
import { renderBelege, renderKunden, renderGutscheine, renderProdukte, renderPakete, renderTeamPane, renderBizSettings } from './studio.js';
import { toast } from '../ui.js';

const $ = (s, c = document) => c.querySelector(s);
const $$ = (s, c = document) => [...c.querySelectorAll(s)];
let current = null, sub = null, teamTab = 'mitarbeiter';

export const PULT_PANELS = ['uebersicht', 'kasse', 'belege', 'kunden', 'gutscheine', 'produkte', 'pakete', 'buchhaltung', 'zahlungen', 'statistiken'];
const ADMIN_ONLY = ['uebersicht', 'bewertungen', 'leistungen', 'produkte', 'pakete', 'buchhaltung', 'zahlungen', 'statistiken', 'einstellungen'];

export async function initPult(me, nav) {
  P.me = me; P.nav = nav;
  P.refresh = async () => { P.db = await pult.load(); badges(); };
  try { await pult.syncClients(); } catch (_) { /* nur Komfort */ }
  await P.refresh();
  // Rollen: Mitarbeiter sehen nur Kalender, Kasse, eigene Bons, Kunden, Gutscheine, Team
  $$('[data-role="admin"]').forEach((el) => { el.hidden = me.role !== 'admin'; });
  idle.start(me);
}
export const allowed = (which) => P.me && (P.me.role === 'admin' || !ADMIN_ONLY.includes(which));
function badges() {
  const low = P.db.products.filter((p) => p.active !== false && p.stock <= p.minStock).length;
  const c = $('[data-count-stock]'); if (c) { c.hidden = !low; c.textContent = low; c.setAttribute('aria-label', `${low} Artikel unter Mindestbestand`); }
}

export function renderPanel(which, subKey) {
  current = which; sub = subKey || null;
  const root = $(`[data-panel="${which}"]`);
  if (!root || !P.db) return;
  const re = () => renderPanel(which, sub);
  switch (which) {
    case 'uebersicht': renderUebersicht(root); break;
    case 'kasse': renderKasse(root); bindKasse(root, re); break;
    case 'belege': renderBelege(root); break;
    case 'kunden': renderKunden(root); break;
    case 'gutscheine': renderGutscheine(root); break;
    case 'produkte': renderProdukte(root); break;
    case 'pakete': renderPakete(root); break;
    case 'buchhaltung': renderBuchhaltung(root, sub); break;
    case 'zahlungen': renderZahlungen(root); break;
    case 'statistiken': renderStatistiken(root); break;
    case 'team': renderTeam(); break;
    case 'einstellungen': { const box = $('[data-biz-settings]'); if (box && P.me.role === 'admin') renderBizSettings(box); break; }
    default: break;
  }
}
function renderTeam() {
  const tabs = $$('[data-team-tabs] [data-tab]');
  tabs.forEach((t) => t.setAttribute('aria-selected', t.dataset.tab === teamTab));
  $$('[data-team-pane]').forEach((p) => { p.hidden = p.dataset.teamPane !== teamTab; });
  if (teamTab !== 'mitarbeiter') renderTeamPane($(`[data-team-pane="${teamTab}"]`), teamTab, renderTeam);
}
document.addEventListener('click', (e) => { const t = e.target.closest('[data-team-tabs] [data-tab]'); if (t) { teamTab = t.dataset.tab; renderTeam(); } });

// Änderungen (auch aus anderen Tabs) übernehmen
let t0;
window.addEventListener('brk:data', () => {
  if (!P.me) return;
  clearTimeout(t0);
  t0 = setTimeout(async () => { if (document.querySelector('dialog[open]')) return; try { await P.refresh(); if (current && current !== 'kalender') renderPanel(current, sub); } catch (_) { /* abgemeldet */ } }, 120);
});

/* ---------- Automatische Abmeldung nach Inaktivität ---------- */
export const idle = {
  timer: null, warn: null, onLogout: null, last: Date.now(),
  start(me) {
    this.stop();
    const minutes = (P.db && P.db.settings.security && P.db.settings.security.idleMinutes) || 20;
    const ms = minutes * 60000;
    const bump = () => { this.last = Date.now(); };
    this._bump = bump;
    ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach((ev) => window.addEventListener(ev, bump, { passive: true }));
    this.timer = setInterval(() => {
      const idleFor = Date.now() - this.last;
      if (idleFor > ms - 60000 && !this.warned) { this.warned = true; toast('Ohne Aktivität wirst du in einer Minute abgemeldet.'); }
      if (idleFor < ms - 60000) this.warned = false;
      if (idleFor > ms && this.onLogout) { this.stop(); this.onLogout('Aus Sicherheitsgründen automatisch abgemeldet.'); }
    }, 5000);
    void me;
  },
  stop() { clearInterval(this.timer); if (this._bump) ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach((ev) => window.removeEventListener(ev, this._bump)); },
};
