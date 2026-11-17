# BRK Studio Köln – One-Page-Website (Entwurf)

Website für **BRK Studio**, Friseur & Barbershop in der Fleischmengergasse 29, direkt am Neumarkt in Köln.
Hero mit Video, Leistungen & Preise, scrollbasierte Studio-Story, Team, Galerie, Mini-Spiel, eigene Buchungsplattform mit Kundenkonto, Bewertungen und Studio-Pult (Demo), Kontakt & Anfahrt.

**Live:** https://gcosca9245.github.io/brk-studio-koeln/

> **Wichtig vor dem Livegang**
> - **Fotos vom Salon:** Die Bilder vom Innenraum, Empfang, der Ladenfront und das Porträt von Burak stammen aus den öffentlichen Profilen des Salons (Planity). Die **Nutzungsrechte müssen vor dem Livegang mit dem Inhaber geklärt werden.**
> - **Platzhalter:** Das Teamfoto von Angelo und alle Galeriebilder sind **Stockfotos (Platzhalterbilder)** und zeigen weder das Team noch Arbeiten des Studios. Das Hero-Video ist ebenfalls Stockmaterial (Stimmungsbild, nicht der Salon).
> - **Buchungsplattform:** Läuft als Demo komplett im Browser (localStorage). Termine, Konten und Bewertungen sind nur auf dem jeweiligen Gerät sichtbar. Für den Echtbetrieb muss das vorbereitete Supabase-Backend aktiviert werden (siehe unten). Einträge mit „Beispiel“ sind Beispieldaten.
> - **Impressum und Datenschutz** sind Platzhalterseiten und müssen ergänzt werden.
> - Das Logo ist ein **neuer Entwurf**. Am Laden hängt bereits ein anderes BRK-Studio-Logo; welche Marke verwendet wird, entscheidet der Inhaber.

## Konzept

Monochromes Editorial-Design: tiefes Schwarz und Off-White im Wechsel, Haarlinien statt Boxen, Typografie trägt die Seite. Gold (#C9A96E) erscheint nur in winzigen Details (Statuspunkt, Bildunterschriften, Kartenmarkierung). Preise stehen wie auf einer Karte, ohne Klick sichtbar.

## Technik

- HTML, **Tailwind CSS 3.4.17** (kompiliert, kein CDN), Vanilla JS
- **Lenis 1.3.4** (weiches Scrollen), **GSAP 3.13.0 + ScrollTrigger** (Reveals, Parallaxe, angeheftete Galerie) – lokal in `assets/vendor/`
- Hero: Video mit langsamem Auszoomen beim Laden (Ken Burns), Headline Buchstabe für Buchstabe aus einer Maske, Parallaxe beim Scrollen, Pause-Schalter, eigene Hochformat-Variante für Smartphones, Pause außerhalb des Sichtbereichs
- Studio-Story: der Satz wird beim Scrollen Wort für Wort hell, Bilder mit dezenter Parallaxe
- Galerie: ab 1024 px horizontal angeheftet, mobil natives Wischen mit Scroll-Snap
- Buchung: 14 Tage, Sonntag geschlossen, Zeiten nach Öffnungszeiten und Dauer der Leistung, „Buchen“ bei jeder Leistung wählt sie vor, Validierung mit Fokus auf das erste Fehlerfeld
- Karte als 2-Klick-Lösung (Google Maps lädt erst nach Klick)
- Mini-Spiel „Einmal Burak sein“ (`#spiel`): eigene monochrome Canvas-Illustration (Burak als Silhouette ohne Gesicht, Gast im Barberstuhl, goldene Schere). Rund 900 Strähnen wachsen aus der Kopfhaut und sind wie eine echte Frisur gekämmt: oben nach hinten, an der Seite schräg nach hinten unten, ab dem Hinterkopf fallen sie weich. Geschnitten wird nur bei gedrückter Maus oder aufgesetztem Finger: Jede Strähne wird exakt am Schnittpunkt mit dem Scherenweg gekürzt (Strecke gegen Strecke, mit zusammengefassten Pointer-Events auch bei schnellen Bewegungen lückenlos), das abgeschnittene Stück fällt als eigenes Teil zu Boden. Die Zielform (Fade, Classic, Buzz) liegt als gestrichelte Kontur über dem Kopf; der Fortschritt misst die Nähe zur Zielkontur, zu kurz kostet nur wenig. Am Ende macht Burak den Feinschliff. Mobil ist das Bild auf den Kopf gezoomt. Tastatur: Spielfeld fokussieren und Leertaste (oder Button „Schneiden“), Burak schneidet dann abschnittsweise exakt auf die Kontur; Fortschritt über `aria-live`; bei reduzierter Bewegung fallen die Strähnen ohne Physik.
- Nur `transform` und `opacity` werden animiert; `prefers-reduced-motion`: kein Lenis, keine Parallaxe, Video startet nicht, alle Inhalte sofort sichtbar
- Alle Schriften, Bilder und Videos liegen im Repository; ohne Klick auf die Karte werden keine Drittanbieter geladen

## Struktur

```
index.html               One-Pager
impressum.html           Platzhalter
datenschutz.html         Platzhalter
favicon.svg
src/input.css            Quell-CSS (Tailwind + Komponenten, kommentiert)
assets/css/styles.css    kompiliertes CSS
assets/js/boot.js        setzt js/motion-Klassen im <head>
assets/js/main.js        Scroll-Choreografie, Menü, Video, Karte
assets/js/app/           Buchungsplattform (ES-Module, siehe unten)
buchen/                  Online-Buchung
konto/                   Kundenkonto
admin/                   Studio-Pult für Burak
supabase/schema.sql      Datenbankschema mit RLS für den Echtbetrieb
assets/js/game.js        Mini-Spiel „Einmal Burak sein“ (Canvas, ohne Bibliotheken)
assets/vendor/           gsap.min.js, ScrollTrigger.min.js, lenis.min.js
assets/fonts/            Inter (variabel, Gewicht + optische Größe)
assets/img/              Logos (SVG), Fotos (WebP)
assets/media/            Hero-Video Desktop/Mobil + Poster
```

## Buchungsplattform (statt Planity)

**Seiten:** `/buchen/` (Leistung, Mitarbeiter, Termin, Daten), `/konto/` (Termine, Bewertungen, Profil), `/admin/` (Studio-Pult). Auf der Startseite zeigt der Abschnitt „Termin“ echte freie Zeiten aus derselben Logik, „Bewertungen“ den Durchschnitt und die freigegebenen Stimmen.

**Kunden:** Registrieren und Anmelden, buchen (freie Zeiten nach Öffnungszeiten, Arbeitszeiten, Dauer, Vorlauf 60 Min., bestehenden Terminen und Blockern), stornieren und verschieben bis 12 Std. vorher, Kalenderdatei (.ics), nach dem Termin bewerten (eine Bewertung pro Termin, erscheint erst nach Freigabe), Profil ändern, Konto löschen.

**Admin (Burak):** Tages- und Wochenkalender je Mitarbeiter, Kennzahlen (Termine, Auslastung, Umsatz, Online-Anteil, offene Bewertungen), Termine manuell anlegen und per Ziehen oder Dialog verschieben (Konflikte werden abgelehnt), stornieren, Blocker (ganztägig, wiederholend, mit Grund), Team mit Arbeitszeiten und Leistungen, Leistungen und Preise (fest, ab, von–bis), Bewertungen freigeben oder ablehnen, Einstellungen (Öffnungszeiten, Raster, Vorlauf, Horizont, Stornofrist, Schließtage).

**Demo-Zugänge** (stehen auch auf den Login-Seiten):

| Rolle | E-Mail | Passwort |
|---|---|---|
| Admin (Burak) | burak@brk-studio.demo | Burak#Demo2026 |
| Kunde | kunde@brk-studio.demo | Kunde#Demo2026 |

Passwörter werden mit PBKDF2-SHA256 (120.000 Iterationen, WebCrypto) gehasht, nach 5 Fehlversuchen 30 s Sperre, Sitzung 8 Std. „Demo zurücksetzen“ in der Leiste lädt die Beispieldaten neu.

**Architektur:** `assets/js/app/core.js` enthält die reine Terminlogik (freie Zeiten, Konflikte, Bewertungsschnitt), `api.js` die Fachfunktionen, darunter ein Adapter: `adapters/local.js` (aktiv, localStorage) oder `adapters/supabase.js` (vorbereitet). Umschalten in `assets/js/app/config.js`.

**Echtbetrieb mit Supabase:**
1. Projekt anlegen, `supabase/schema.sql` im SQL-Editor ausführen (Tabellen, Row Level Security, `is_admin()`, RPCs `busy_slots`, `book_appointment` mit Konfliktprüfung und Ausschlussbedingung gegen Doppelbuchungen, `delete_own_account`).
2. Burak registrieren und in `profiles` die Rolle `admin` setzen.
3. In `config.js` `adapter: 'supabase'`, URL und anon key eintragen, `demo: false`.

**Fehlt für den Echtbetrieb:** aktiviertes Backend mit serverseitiger Prüfung (die Demo prüft nur im Browser), geräteübergreifende Daten, E-Mail/SMS-Bestätigungen und Erinnerungen, Passwort-zurücksetzen, rechtssichere Datenschutzerklärung und AGB/Stornobedingungen, optional Anzahlung/Zahlung, Bildrechte.

## Entwicklung

```bash
npm install
npm run build:css      # CSS neu bauen
python3 -m http.server # lokal ansehen
```

## Logo

`assets/img/logo-dark.svg` (schwarz, für helle Flächen) und `assets/img/logo-light.svg` (weiß, für dunkle Flächen).
„BRK“ als Konturen aus Inter Black, eine feine Schere schneidet durch die Buchstaben: Die spitz zulaufenden Klingen sind in den Buchstaben ausgespart, Drehpunkt und Griffe laufen als Haarlinie nach rechts aus. Darunter gesperrt „STUDIO KÖLN“.

## Medien und Lizenzen

| Datei | Quelle | Lizenz / Status |
| --- | --- | --- |
| `real-salon-*`, `real-stuhl-*`, `real-spiegel-*`, `real-licht-*` | Innenraumfoto von BRK Studio, [Planity-Profil](https://www.planity.com/de-DE/brk-studio-50676-koln) (Ausschnitte, monochrom gegradet) | **Foto vom Salon – Nutzungsrechte vor Livegang mit dem Inhaber klären** |
| `real-empfang-*` | Empfangsfoto von BRK Studio, Planity-Profil (Ausschnitt) | **wie oben** |
| `real-fassade-*` | Foto der Ladenfront, Planity-Profil | **wie oben** |
| `real-burak-*` | Teamfoto „Burak“, Planity-Profil | **wie oben** |
| `team-angelo-*` | Stockfoto, [Pexels 28209072](https://www.pexels.com/photo/28209072/) | Pexels-Lizenz – **Platzhalterbild, zeigt nicht Angelo** |
| `g-textur-*` | [Pexels 17928570](https://www.pexels.com/photo/17928570/) | Pexels-Lizenz – Platzhalter |
| `g-hochsteck-*` | [Pexels 20593207](https://www.pexels.com/photo/20593207/) | Pexels-Lizenz – Platzhalter |
| `g-profil-*` | [Pexels 30873846](https://www.pexels.com/photo/30873846/) | Pexels-Lizenz – Platzhalter |
| `g-bob-*` | [Pexels 7091506](https://www.pexels.com/photo/7091506/) | Pexels-Lizenz – Platzhalter |
| `g-fade-*` | [Pexels 39559324](https://www.pexels.com/photo/39559324/) | Pexels-Lizenz – Platzhalter |
| `g-wellen-*` | [Pexels 2504927](https://www.pexels.com/photo/2504927/) | Pexels-Lizenz – Platzhalter |
| `g-schnitt-*` | [Pexels 32037672](https://www.pexels.com/photo/32037672/) | Pexels-Lizenz – Platzhalter |
| `g-lang-*` | [Pexels 33949286](https://www.pexels.com/photo/33949286/) | Pexels-Lizenz – Platzhalter |
| `g-scheitel-*` | [Pexels 12706272](https://www.pexels.com/photo/12706272/) | Pexels-Lizenz – Platzhalter |
| `g-klassik-*` | [Pexels 10775092](https://www.pexels.com/photo/10775092/) | Pexels-Lizenz – Platzhalter |
| `hero-desktop.mp4`, `hero-mobile.mp4`, `hero-poster*.webp` | Video von cottonbro studio, [Pexels 3996965](https://www.pexels.com/video/3996965/) – zugeschnitten (16:9 und 9:16), nahtlos geloopt, monochrom gegradet, komprimiert (1,3 MB / 0,9 MB) | Pexels-Lizenz – Stimmungsbild, nicht der Salon |
| Inter | Rasmus Andersson, via Fontsource | SIL Open Font License 1.1 |
| GSAP 3.13 | GreenSock | GSAP Standard License (kostenlos) |
| Lenis 1.3.4 | darkroom.engineering | MIT |
| Tailwind CSS 3.4.17 | Tailwind Labs | MIT |

Die [Pexels-Lizenz](https://www.pexels.com/license/) erlaubt kostenlose kommerzielle Nutzung und Bearbeitung ohne Namensnennung (Nennung erfolgt freiwillig). Abgebildete Personen in Stockfotos sind Models, keine Kundinnen oder Kunden des Studios.

**Schrift:** Satoshi (Fontshare) wurde bewusst nicht verwendet. Ihre Lizenz (ITF FFL) verbietet die Weitergabe der Schriftdateien, und ein öffentliches Repository macht sie für alle herunterladbar. Stattdessen Inter Black (frei nach OFL), wie im Briefing als Alternative genannt.

## Öffnungszeiten und Preise

Laut Vorgabe: Mo 12–19, Di–Mi 12–18, Do–Fr 12–19, Sa 12–20, So geschlossen. Preise und Dauern laut Vorgabe bzw. Planity-Profil (Stand November 2026). Auf Planity stehen teils abweichende Öffnungszeiten (Mo–Fr 12–20, Sa 11–19) – bitte mit dem Inhaber abgleichen.

## Quellen für Texte

Texte zu Burak (Inhaber, 11 Jahre Erfahrung) laut Briefing. Die Rolle von Angelo (Friseurmeister) und das Zitat zur Wohnzimmer-Atmosphäre stammen aus den öffentlichen Salonprofilen auf Treatwell bzw. Planity – bitte vor dem Livegang vom Inhaber bestätigen lassen.

## Deployment

GitHub Pages aus dem Branch `gh-pages`, aktualisiert durch `.github/workflows/deploy.yml` bei jedem Push auf `main`.
Binärdateien wurden beim ersten Upload als base64-kodiertes tar-Archiv übertragen und vom Workflow wiederhergestellt.
