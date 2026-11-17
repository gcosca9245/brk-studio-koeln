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
- Effekte (`assets/js/fx.js`): **Intro** beim ersten Besuch je Sitzung (eine Schere schneidet das Bild waagerecht, das Hero-Video öffnet sich an der Schnittlinie, ca. 1,2 s, Klick/Taste/Scrollen überspringt, nicht bei Sprungzielen und reduzierter Bewegung); **Scheren-Cursor** nur bei feinem Zeiger (öffnet sich über Bildern, „Ansehen“ über der Galerie, normaler Cursor in Formularfeldern und im Spiel); **Abschnittswechsel als horizontaler Schnitt** (Maskenkante mit Linie und Schere, auch beim Öffnen von Impressum und Datenschutz); **Burak als Linienfigur** ab 1200 px am linken Rand mit einer kleinen Geschichte je Abschnitt bis zum Spiel, dort übergibt er die Schere; **„Wohnzimmer“** über die volle Breite mit echten Salonfotos in den Buchstaben (SVG-Maske, auf dem Desktop angeheftet und von groß auf passend gezoomt, mobil zweizeilig)
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
assets/js/fx.js          Intro, Scheren-Cursor, Schnittkanten, Burak-Figur, Wohnzimmer
assets/vendor/           gsap.min.js, ScrollTrigger.min.js, lenis.min.js
assets/fonts/            Inter (variabel, Gewicht + optische Größe)
assets/img/              Logos (SVG), Fotos (WebP)
assets/media/            Hero-Video Desktop/Mobil + Poster
```

## Buchungsplattform (statt Planity)

**Seiten:** `/buchen/` (Leistung, Mitarbeiter, Termin, Daten), `/konto/` (Termine, Bewertungen, Profil), `/admin/` (Studio-Pult). Auf der Startseite zeigt der Abschnitt „Termin“ echte freie Zeiten aus derselben Logik, „Bewertungen“ den Durchschnitt und die freigegebenen Stimmen.

**Kunden:** Registrieren und Anmelden, buchen (freie Zeiten nach Öffnungszeiten, Arbeitszeiten, Dauer, Vorlauf 60 Min., bestehenden Terminen und Blockern), stornieren und verschieben bis 12 Std. vorher, Kalenderdatei (.ics), nach dem Termin bewerten (eine Bewertung pro Termin, erscheint erst nach Freigabe), Profil ändern, Konto löschen.

**Studio-Pult `/admin/`** (Desktop zuerst, auch auf Tablet und Handy nutzbar). Alle Beispieldaten sind mit „Beispiel“ markiert.

| Bereich | Inhalt |
|---|---|
| Übersicht | Umsatz heute, gestern, Monat, Jahr mit Vorjahresvergleich, Termine, Auslastung, Ø Bon, Trinkgeld, offene Raten, Lagerwarnungen, 12-Monats-Diagramm, Top-Leistungen und -Produkte, Auslastung nach Wochentag und Stunde |
| Kalender | Tag und Woche je Mitarbeiter oder je Platz (Stühle, Farb- und Waschplatz), Online-Buchungen sofort sichtbar, Pausen, Abwesenheiten, Blocker, Ziehen zum Verschieben, aus dem Termin kassieren, Anzahlung, No-Show |
| Kasse | Termin oder frei kassieren, Leistungen, Produkte, Gutscheine, Beauty-Pakete, Ausfallgebühr, Raten, Anzahlungen; Rabatt je Position oder auf den Bon; Bar, Karte, Gutschein, Anzahlung, Ratenzahlung, gemischt; Trinkgeld je Mitarbeiter bar oder Karte; Rückgeld; Bon mit Pflichtangaben, Druck, E-Mail/SMS vorbereitet |
| Transaktionen | alle Bons mit Filter, Storno nur als Gegenbon (Admin, mit Grund) |
| Kundenkartei | Historie, Käufe, Produkte, Guthaben (Gutscheine, Pakete, Raten), Vorlieben, Notizen, Einwilligungen |
| Gutscheine | verkaufen, Code prüfen, Restwert, Ablauf; Onlineverkauf vorbereitet |
| Team | Mitarbeiter, Anwesenheit (Stempeln), Abwesenheiten und Pausen, Umsatz und Leistung, Trinkgeld |
| Leistungen, Produkte & Lager, Beauty-Pakete | Preise, Dauer, Kategorien, MwSt., Einkaufspreis, Bestand, Mindestmenge mit Warnung, Wareneingang/-ausgang, Inventur, Inventurwert |
| Buchhaltung | Kennzahlen, weitere Kennzahlen, Umsatz, Mitarbeiter, Dienstleistungen, Produkte (Marge), MwSt., Zahlungsmethoden, Bargeldverwaltung (Kassenbuch, Zählprotokoll, Bank, Einlage, Entnahme, Trinkgeld-Auszahlung), Gutscheine, Beauty-Pakete, Trinkgeld, Monatsabschluss |
| Zahlungen | offene Raten, Zahlungsarten, Onlinezahlung (Stripe vorbereitet, inaktiv) |
| Statistiken | eigene Auswertungen (Kennzahl, Gruppierung, Aufteilung, Zeitraum, Tabelle oder Diagramm) speichern |
| Einstellungen | Öffnungszeiten, Firma und Steuernummer für den Bon, DATEV-Berater/Mandant, SKR03/04, Kontenzuordnung, Auto-Logout, Audit-Log |

Jede Tabelle: Zeitraumfilter, inkl./exkl. MwSt., CSV-Export (Excel, Semikolon, UTF-8 mit BOM), Drucken.

**Monatsabschluss (ein Klick):** ZIP mit `EXTF_Buchungsstapel_JJJJMM_SKR03.csv` (DATEV-Format Buchungsstapel, EXTF 700, Formatversion 13, Windows-1252, Berater- und Mandantennummer aus den Einstellungen; Erlöse 19 %/7 %, Kasse, Geldtransit für Karte, Gutscheine als erhaltene Anzahlung, Trinkgeld als durchlaufender Posten ohne Steuer), `Transaktionen_JJJJMM.csv`, `Monatsbericht_JJJJMM.html` (druckbar) und `LIESMICH.txt`. Danach den Monat sperren: Bons, Kassenbuch und Lager dieses Monats sind dann nicht mehr änderbar, Korrekturen laufen als Gegenbuchung im laufenden Monat. Kontenzuordnung bitte mit dem Steuerberater abstimmen.

**Demo-Zugänge** (stehen auch auf den Login-Seiten):

| Rolle | E-Mail | Passwort |
|---|---|---|
| Admin (Burak) | burak@brk-studio.demo | Burak#Demo2026 |
| Mitarbeiter (Angelo) | angelo@brk-studio.demo | Angelo#Demo2026 |
| Kunde | kunde@brk-studio.demo | Kunde#Demo2026 |

Mitarbeiter sehen Kalender, Kasse, Kunden, Gutscheine und Team; Buchhaltung, Storno, Monatsabschluss, Preise und Einstellungen sind dem Admin vorbehalten. „Demo zurücksetzen“ in der Leiste lädt die Beispieldaten neu.

**Architektur:** `core.js` (Terminlogik), `ledger.js` (Beträge in Cent, USt. je Satz, Gutschein-, Paket- und Ratenstand, Kassenbuch, DATEV), `zip.js` (ZIP ohne Bibliothek), `validate.js` (zentrale Eingabeprüfung), `api.js` und `pult-api.js` (Fachfunktionen), darunter ein Adapter: `adapters/local.js` (aktiv, localStorage) oder `adapters/supabase.js` (vorbereitet). Oberfläche des Pults in `assets/js/app/pult/`.

## Sicherheit – ehrlich

**Die Demo ist nicht sicher und soll es auch nicht sein.** Alle Daten liegen im Browser der Besucherin. Wer die Entwicklerwerkzeuge öffnet, kann sie lesen und ändern, auch Rollen und Bons. Rollen, Sperren und Prüfungen im Browser zeigen nur, wie es funktionieren wird. Echte Daten gehören erst in das System, wenn Supabase aktiv ist.

**Was die Demo im Browser tut**
- Passwörter nur als PBKDF2-SHA256-Hash (WebCrypto, 120.000 Iterationen, Salz je Konto), nie im Klartext.
- Passwortregeln: mindestens 10 Zeichen, Buchstaben und Ziffern, keine Allerweltspasswörter, nicht die E-Mail.
- Login-Bremse: nach 5 Fehlversuchen 30 s Sperre, ab 10 Fehlversuchen 5 Minuten, auch nach Neuladen.
- Sitzungen: Kunden 8 Std., Team 4 Std.; im Pult automatische Abmeldung nach Inaktivität (Standard 20 Min., Warnung 1 Min. vorher).
- Rollen Kunde, Mitarbeiter, Admin; jede Funktion prüft die Rolle.
- Bons, Kassenbuch, Lagerbewegungen, Abschlüsse und Audit-Log sind nur anhängbar, die Monatssperre gilt für alle Buchungen, Storno nur als Gegenbon. Das ahmt die Datenbank-Trigger nach.
- Kein `innerHTML` mit ungeprüften Daten: Nutzerdaten werden escaped oder per `textContent` gesetzt (Test `tools/qa-xss.js`: HTML in 20 Feldern, 41 Ansichten, kein Element entsteht).
- Zentrale Eingabeprüfung und Normalisierung (`validate.js`: Länge, Format, Unicode-NFC, Steuer- und Bidi-Zeichen entfernt).
- Content-Security-Policy per Meta-Tag auf jeder Seite: nur eigene Skripte, keine Inline-Skripte, kein `eval`, keine Plugins, `base-uri` und `form-action` auf die eigene Seite; Referrer-Policy `strict-origin-when-cross-origin`; externe Links mit `rel="noopener noreferrer"`. Inline-Stilattribute bleiben für Kalender- und Diagrammpositionen erlaubt.
- Exporte gegen CSV- und Formel-Injection geschützt (Zellen mit `= + - @` bekommen ein `'`, im DATEV-Text werden sie entfernt).

**Was erst mit Supabase wirklich geschützt ist** (`supabase/schema.sql`)
- Supabase Auth (bcrypt, JWT); Rollen in `profiles.role`; neue Konten sind immer Kunde, Rechte vergibt nur ein Admin (Trigger gegen Selbstbeförderung).
- Row Level Security auf jeder Tabelle, ohne passende Policy kein Zugriff; Kunden sehen nur eigene Termine, Karteikarte, Pakete und Raten; Mitarbeiter keine Buchhaltungs-Einstellungen und kein Audit-Log.
- Kassieren, Storno und Monatsabschluss nur über geprüfte Datenbankfunktionen (`create_bon`, `void_bon`, `close_month`). Der Server rechnet Summen und Steuern selbst, vergibt die Bonnummer fortlaufend, datiert nicht zurück, prüft Bestand, Gutschein-Restwert, Anzahlung und Raten.
- Trigger: nur anhängbar (auch für den Datenbank-Eigentümer), Monatssperre, Bestand nur über Lagerbewegungen, Kasse nie negativ, Einlage und Entnahme nur Admin, Stempeln nur für sich selbst.
- Audit-Log schreiben nur Trigger und Funktionen; Clients können es nicht schreiben, ändern oder löschen.
- Im Frontend steht nur der öffentliche anon key, nie der service_role key.
- CSRF: Die App nutzt keine Auth-Cookies. Jede Anfrage trägt das JWT im `Authorization`-Header, das eine fremde Seite nicht mitsenden kann. Ein CSRF-Token ist deshalb nicht nötig. Das gilt, solange keine Cookie-Sitzungen eingeführt werden.
- Getestet gegen lokales PostgreSQL mit Auth-Nachbildung: `tools/run-schema-test.sh`, 38 Prüfungen (Rechte, Summenprüfung, Bestand, Gutschein, Storno, Sperre, Audit).

**Grenzen und offene Punkte**
- Keine TSE: Die Kasse ist **kein** zulässiges Kassensystem nach KassenSichV. Für echten Kassenbetrieb braucht es eine zertifizierte TSE (z. B. Cloud-TSE) und die Meldung beim Finanzamt.
- GitHub Pages kann keine HTTP-Header setzen. `frame-ancestors` (Schutz vor Einbetten), HSTS und `Permissions-Policy` gehen nur mit eigenem Hosting oder einem Proxy (z. B. Cloudflare).
- Die Sitzung liegt im localStorage. Gegen Skript-Einschleusung schützen CSP und Escaping. Mit Supabase kurze JWT-Laufzeit wählen.
- In Supabase einstellen: Passwortregeln und Leaked-Password-Schutz, Rate Limits und CAPTCHA, E-Mail-Bestätigung, MFA für Admin und Team, Session-Timeout.
- DATEV-Export, Kontenzuordnung, Gutschein- und Trinkgeldbehandlung bitte mit dem Steuerberater abstimmen.

**Echtbetrieb mit Supabase:**
1. Projekt anlegen, `supabase/schema.sql` im SQL-Editor ausführen.
2. Burak und das Team registrieren; im SQL-Editor Rollen setzen (Anleitung am Ende der Datei).
3. In `config.js` `adapter: 'supabase'`, URL und anon key eintragen, `demo: false`.

**Fehlt für den Echtbetrieb:** aktivierte Supabase-Datenbank, TSE, Stripe-Anbindung (Edge Function, Webhook), E-Mail/SMS-Versand, Passwort zurücksetzen, Datenübernahme, rechtssichere Datenschutzerklärung und AGB/Stornobedingungen, Abstimmung mit dem Steuerberater, Bildrechte.

## Tests

```bash
node tools/qa-platform.js   # Buchung, Konto, Admin-Kalender, Blocker, Bewertungen
node tools/qa-pult.js       # Kasse, Trinkgeld -> Buchhaltung/Kassenbuch, Lager, Gutschein, Storno, ZIP/DATEV, Sperre, Rollen
node tools/qa-xss.js        # HTML-Nutzlasten in Daten -> kein Element in 41 Ansichten
node tools/qa-csp.js        # keine CSP-Verstöße auf allen Seiten
tools/run-schema-test.sh    # Supabase-Schema gegen lokales PostgreSQL
```

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
