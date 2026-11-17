/* BRK Studio Plattform – Anmelde-/Registrierformulare (Buchung und Kundenkonto) */
import { api } from './api.js';
import { DEMO_ACCOUNTS } from './seed.js';
import { $, $$, esc } from './ui.js';

export function authFormsHTML({ idp = 'a', admin = false } = {}) {
  const demo = admin ? DEMO_ACCOUNTS.admin : DEMO_ACCOUNTS.customer;
  return `
  <div class="auth-tabs" role="tablist" aria-label="Anmelden oder registrieren"${admin ? ' hidden' : ''}>
    <button type="button" role="tab" id="${idp}-tab-in" aria-controls="${idp}-in" aria-selected="true" data-tab="in">Anmelden</button>
    <button type="button" role="tab" id="${idp}-tab-up" aria-controls="${idp}-up" aria-selected="false" tabindex="-1" data-tab="up">Neu bei BRK</button>
  </div>
  <form class="auth-form" id="${idp}-in" role="tabpanel" aria-labelledby="${idp}-tab-in" data-form="in" novalidate>
    <div class="field"><label class="label" for="${idp}-email">E-Mail</label><input class="input" id="${idp}-email" name="email" type="email" autocomplete="username" spellcheck="false" required></div>
    <div class="field"><label class="label" for="${idp}-pw">Passwort</label><input class="input" id="${idp}-pw" name="password" type="password" autocomplete="current-password" required></div>
    <p class="form-error" data-error role="alert"></p>
    <button class="btn btn-dark btn-wide" type="submit">Anmelden</button>
  </form>
  <form class="auth-form" id="${idp}-up" role="tabpanel" aria-labelledby="${idp}-tab-up" data-form="up" hidden novalidate>
    <div class="field"><label class="label" for="${idp}-name">Name</label><input class="input" id="${idp}-name" name="name" autocomplete="name" required><p class="error" data-f="name"></p></div>
    <div class="field"><label class="label" for="${idp}-remail">E-Mail</label><input class="input" id="${idp}-remail" name="email" type="email" autocomplete="email" spellcheck="false" required><p class="error" data-f="email"></p></div>
    <div class="field"><label class="label" for="${idp}-phone">Telefon</label><input class="input" id="${idp}-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" required><p class="error" data-f="phone"></p></div>
    <div class="field"><label class="label" for="${idp}-rpw">Passwort <span class="label__hint">mind. 10 Zeichen, Buchstaben und Ziffern</span></label><input class="input" id="${idp}-rpw" name="password" type="password" autocomplete="new-password" required><p class="error" data-f="password"></p></div>
    <p class="form-error" data-error role="alert"></p>
    <button class="btn btn-dark btn-wide" type="submit">Konto anlegen</button>
    <p class="fine">Mit dem Konto speichern wir Name, E-Mail und Telefon für deine Termine. In dieser Demo nur in deinem Browser.</p>
  </form>
  <aside class="demo-creds" aria-label="Demo-Zugang">
    <p class="demo-creds__title"><span class="demo-flag__dot" aria-hidden="true"></span>Demo-Zugang ${admin ? 'Studio-Pult' : 'Kunde'}</p>
    <p class="demo-creds__row"><span>E-Mail</span><code>${esc(demo.email)}</code></p>
    <p class="demo-creds__row"><span>Passwort</span><code>${esc(demo.password)}</code></p>
    <button type="button" class="link-quiet link-quiet--dark" data-fill-demo>Demo-Daten einsetzen</button>
  </aside>`;
}

export function bindAuthForms(root, { onAuth, admin = false }) {
  const demo = admin ? DEMO_ACCOUNTS.admin : DEMO_ACCOUNTS.customer;
  const tabs = $$('[data-tab]', root);
  const show = (which, focus = true) => {
    tabs.forEach((t) => { const on = t.dataset.tab === which; t.setAttribute('aria-selected', on); t.tabIndex = on ? 0 : -1; });
    $$('[data-form]', root).forEach((f) => { f.hidden = f.dataset.form !== which; });
    if (focus) { const f = $(`[data-form="${which}"] input`, root); if (f) f.focus(); }
  };
  tabs.forEach((t) => {
    t.addEventListener('click', () => show(t.dataset.tab));
    t.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { const n = tabs[(tabs.indexOf(t) + 1) % tabs.length]; n.focus(); show(n.dataset.tab, false); } });
  });
  $('[data-fill-demo]', root).addEventListener('click', () => {
    show('in', false);
    const f = $('[data-form="in"]', root);
    f.email.value = demo.email; f.password.value = demo.password;
    f.querySelector('button[type="submit"]').focus();
  });
  const busy = (form, on) => { const b = form.querySelector('button[type="submit"]'); b.disabled = on; b.classList.toggle('is-busy', on); };
  $('[data-form="in"]', root).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.currentTarget; const err = $('[data-error]', f); err.textContent = '';
    if (!f.email.value || !f.password.value) { err.textContent = 'Bitte E-Mail und Passwort eingeben.'; return; }
    busy(f, true);
    try {
      const u = await api.login(f.email.value, f.password.value);
      if (admin && u.role !== 'admin') { await api.logout(); throw new Error('Dieses Konto hat keinen Zugang zum Studio-Pult.'); }
      onAuth(u);
    } catch (x) { err.textContent = x.message; f.password.select(); } finally { busy(f, false); }
  });
  $('[data-form="up"]', root).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.currentTarget; const err = $('[data-error]', f); err.textContent = '';
    $$('[data-f]', f).forEach((p) => { p.textContent = ''; });
    $$('input', f).forEach((i) => i.removeAttribute('aria-invalid'));
    busy(f, true);
    try {
      onAuth(await api.register({ name: f.elements.name.value, email: f.elements.email.value, phone: f.elements.phone.value, password: f.elements.password.value }));
    } catch (x) {
      if (x.fields) {
        let first;
        for (const [k, m] of Object.entries(x.fields)) { $(`[data-f="${k}"]`, f).textContent = m; f.elements[k].setAttribute('aria-invalid', 'true'); first = first || f.elements[k]; }
        if (first) first.focus();
      } else err.textContent = x.message;
    } finally { busy(f, false); }
  });
}
