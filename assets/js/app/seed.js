/* BRK Studio Plattform – Beispieldaten (Demo)
   Alle Datensätze tragen example: true und werden in der Oberfläche als „Beispiel“ markiert.
   Passwörter liegen nur als PBKDF2-SHA256-Hash vor; die Klartext-Demo-Zugänge stehen im README. */
import { addDays, weekday } from './util.js';

const H = (h, m = 0) => h * 60 + m;

export const DEMO_ACCOUNTS = {
  admin: { email: 'burak@brk-studio.demo', password: 'Burak#Demo2026' },
  customer: { email: 'kunde@brk-studio.demo', password: 'Kunde#Demo2026' },
};

export function buildSeed(today) {
  const settings = {
    // Wochentag -> [öffnet, schließt] in Minuten; null = geschlossen (laut Briefing)
    hours: { 0: null, 1: [H(12), H(19)], 2: [H(12), H(18)], 3: [H(12), H(18)], 4: [H(12), H(19)], 5: [H(12), H(19)], 6: [H(12), H(20)] },
    step: 15, leadMinutes: 60, horizonDays: 60, cancelHours: 12, closedDates: [],
  };
  const staff = [
    { id: 'st_burak', name: 'Burak', role: 'Inhaber', bio: '11 Jahre Erfahrung', active: true, hours: {}, order: 1 },
    { id: 'st_angelo', name: 'Angelo', role: 'Friseurmeister', bio: '', active: true, hours: {}, order: 2 },
  ];
  const both = ['st_burak', 'st_angelo'];
  const services = [
    { id: 'sv_wss', cat: 'Herren', name: 'Waschen · Schneiden · Stylen', duration: 45, price: 3600, priceMode: 'fixed', staffIds: both, active: true, order: 1 },
    { id: 'sv_bart', cat: 'Herren', name: 'Haarschnitt + Bart', duration: 60, price: 4500, priceMode: 'fixed', staffIds: both, active: true, order: 2 },
    { id: 'sv_fast', cat: 'Herren', name: 'Fast Cut', duration: 15, price: 2500, priceMode: 'fixed', staffIds: both, active: true, order: 3 },
    { id: 'sv_sf', cat: 'Damen', name: 'Schneiden + Föhnen', duration: 60, price: 5500, priceTo: 6500, priceMode: 'range', staffIds: both, active: true, order: 4 },
    { id: 'sv_bal', cat: 'Damen', name: 'Balayage', duration: 200, price: 24900, priceMode: 'from', staffIds: both, active: true, order: 5 },
    { id: 'sv_str', cat: 'Damen', name: 'Strähnen', duration: 200, price: 15500, priceMode: 'from', staffIds: both, active: true, order: 6 },
  ];
  const users = [
    { id: 'us_admin', role: 'admin', name: 'Burak', email: 'burak@brk-studio.demo', phone: '', example: true,
      pass: { alg: 'PBKDF2-SHA256', iter: 120000, salt: 'SlTBb+ButIXJqniJpzZ38A==', hash: '/LONU5LxInGEdro+SfyvF1PW3LvFd2IItHL05mZX458=' } },
    { id: 'us_kunde', role: 'customer', name: 'Demo Kunde', email: 'kunde@brk-studio.demo', phone: '0171 0000000', example: true,
      pass: { alg: 'PBKDF2-SHA256', iter: 120000, salt: 'fmuli/+QwC0SKZpVbsGKyw==', hash: 'E1OWw7yodWTErKEm44RRjMs1QsV3KBfxJ9a5lNalKaM=' } },
  ];

  // nächster Öffnungstag ab einem Datum
  const open = (d) => { let x = d; while (!settings.hours[weekday(x)]) x = addDays(x, 1); return x; };
  const prevOpen = (d) => { let x = d; while (!settings.hours[weekday(x)]) x = addDays(x, -1); return x; };
  const svc = Object.fromEntries(services.map((s) => [s.id, s]));
  let n = 0;
  const appt = (date, start, serviceId, staffId, name, extra = {}) => ({
    id: `ap_seed${++n}`, date, start, duration: svc[serviceId].duration, serviceId, staffId,
    customerId: null, name, phone: '', note: '', status: 'booked', source: 'admin', example: true,
    createdAt: new Date().toISOString(), history: [], ...extra,
  });
  const d1 = open(addDays(today, 1)), d2 = open(addDays(d1, 1)), d3 = open(addDays(d2, 1)), d4 = open(addDays(d3, 1));
  const past1 = prevOpen(addDays(today, -6)), past2 = prevOpen(addDays(today, -20));
  const appointments = [
    appt(d1, H(12), 'sv_bart', 'st_burak', 'Beispiel · Kemal A.'),
    appt(d1, H(13, 30), 'sv_wss', 'st_burak', 'Beispiel · Jonas W.'),
    appt(d1, H(15), 'sv_fast', 'st_burak', 'Beispiel · Luca R.'),
    appt(d1, H(12, 30), 'sv_sf', 'st_angelo', 'Beispiel · Sarah M.'),
    appt(d1, H(14), 'sv_bal', 'st_angelo', 'Beispiel · Lea K.'),
    appt(d2, H(16), 'sv_bart', 'st_burak', 'Demo Kunde', { customerId: 'us_kunde', source: 'customer' }),
    appt(d2, H(12), 'sv_wss', 'st_angelo', 'Beispiel · Tim S.'),
    appt(d3, H(13), 'sv_str', 'st_angelo', 'Beispiel · Mira H.'),
    appt(d3, H(17), 'sv_wss', 'st_burak', 'Beispiel · Deniz Y.'),
    appt(d4, H(12, 15), 'sv_bart', 'st_burak', 'Beispiel · Paul F.'),
    appt(past1, H(14), 'sv_wss', 'st_burak', 'Demo Kunde', { customerId: 'us_kunde', source: 'customer' }),
    appt(past2, H(15), 'sv_fast', 'st_angelo', 'Demo Kunde', { customerId: 'us_kunde', source: 'customer' }),
  ];
  const blockers = [
    { id: 'bl_seed1', staffId: 'st_burak', date: d2, start: H(12), end: H(13), reason: 'Beispiel · Lieferant', example: true },
    { id: 'bl_seed2', staffId: 'st_angelo', date: d3, start: H(16), end: H(18), reason: 'Beispiel · Fortbildung', example: true },
  ];
  const ago = (days) => new Date(Date.now() - days * 86400000).toISOString();
  const rv = (id, name, rating, text, days, status = 'approved', staffId = 'st_burak') => ({ id, name, rating, text, staffId, status, createdAt: ago(days), customerId: null, appointmentId: null, example: true });
  const reviews = [
    rv('rv_s1', 'Beispiel · Kemal A.', 5, 'Fade sitzt perfekt, Burak nimmt sich Zeit und hört zu. Dazu ein Espresso, besser geht ein Samstag nicht los.', 9),
    rv('rv_s2', 'Beispiel · Sarah M.', 5, 'Angelo hat genau verstanden, was ich wollte. Ruhige Atmosphäre, ehrliche Beratung zur Länge.', 16, 'approved', 'st_angelo'),
    rv('rv_s3', 'Beispiel · Jonas W.', 5, 'Saubere Konturen, ehrlicher Preis. Fühlt sich eher an wie bei Freunden als im Salon.', 23),
    rv('rv_s4', 'Beispiel · Lea K.', 4, 'Balayage ist sehr natürlich geworden. Hat etwas länger gedauert als gedacht, das Ergebnis lohnt sich.', 34, 'approved', 'st_angelo'),
    rv('rv_s5', 'Beispiel · Deniz Y.', 5, 'Bester Bartschnitt in der Innenstadt. Termin online gebucht, pünktlich drangekommen.', 41),
    rv('rv_s6', 'Beispiel · Tim S.', 5, 'Kurz vor dem Termin noch ein Bier angeboten bekommen. Schnitt top, komme wieder.', 58, 'approved', 'st_angelo'),
    rv('rv_s7', 'Beispiel · Paul F.', 4, 'Gute Arbeit, nette Leute. Wartet auf Freigabe im Admin-Bereich.', 2, 'pending'),
  ];
  return { version: 1, seededAt: new Date().toISOString(), settings, staff, services, users, appointments, blockers, reviews };
}
