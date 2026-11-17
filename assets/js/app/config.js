/* BRK Studio Plattform – Konfiguration
   adapter: 'local'    = Demo, alle Daten im localStorage dieses Browsers (aktiv)
            'supabase' = vorbereitet, inaktiv. Für den Betrieb URL + anon key eintragen,
                         supabase/schema.sql einspielen und adapter umstellen. */
export const CONFIG = {
  adapter: 'local',
  supabase: { url: '', anonKey: '' },
  demo: true,
};
