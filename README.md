# Wingrush (Arbeitstitel)

Casual-3D-Game für den Browser: Wingsuit-Flug durch ein Alpental. Münzen sammeln, je riskanter desto wertvoller, und die Münzen im Glücksautomaten gegen Skins eintauschen.

## Starten

Voraussetzung: Node.js **≥ 20.19** (Vite 8). Mit Node 20.18 fehlt nach `npm install` die native Rolldown-Binding und der Build bricht ab. Das Backend allein läuft ab Node 20.12.

```bash
npm install
npm run dev        # http://localhost:5173 (auch im WLAN fürs Handy), /api wird an localhost:3000 weitergeleitet
npm run build      # Produktions-Build nach dist/ (Spiel und Admin-Dashboard)
```

Das Spiel braucht dafür das Backend (siehe unten). Ohne Backend: `VITE_API=mock npm run dev` nutzt den Browser-Mock.

`npm run build:single` erzeugt eine einzelne HTML-Datei (dist-single/index.html), praktisch für Abgaben oder schnelle Vorschauen. Sie läuft immer mit dem Mock, weil sie ohne Server geöffnet wird, und enthält das Admin-Dashboard nicht.

## Steuerung

| Aktion | Tastatur | Touch / Maus |
|---|---|---|
| Lenken | ← → oder A/D | horizontal ziehen |
| Hochziehen (bremst) | ↑ oder W | nach oben ziehen |
| Sturzflug (beschleunigt) | ↓ oder S | nach unten ziehen |
| Nochmal nach Crash | Leertaste / Enter | Button |

Solange ein Dialog offen ist (Werbung, Einwilligung, Hinweis), starten Leertaste und Enter keinen Run.

## Spielmechanik

- **Münzen:** Bronze 1 (hoch, sicher) · Silber 5 (knapp über Boden) · Gold 10 (in Felsbögen/Tunneln) · Diamant 50 (selten, in langen Tunneln)
- **Multiplikator x1–x5:** wer unter 9 m über Boden bleibt (oder im Tunnel), steigert ihn. Wer zu lange hoch fliegt, verliert ihn.
- **Tunnel-Durchflug:** +250 Score
- **Hindernisse:** Bäume, Vogelschwärme, Helikopter, entgegenkommende Flugzeuge. Dichte steigt mit der Distanz.
- **Glücksautomat:** 100 Münzen pro Spin. Wahrscheinlichkeiten (`SLOT` und `RARITIES` in `economy.js`):

  | Ergebnis | Chance |
  |---|---|
  | Niete | 70 % |
  | Zwei Gleiche: 30–70 Münzen | 15 % |
  | 🪙🪙🪙: Jackpot 300 Münzen | 0,5 % |
  | Drei Gleiche: Item, davon Gewöhnlich 11 %, Selten 2,5 %, Episch 0,7 %, Legendär 0,3 % | 14,5 % |

  Doppelte Items werden in Münzen umgewandelt. Es gibt keine Garantie, jeder Spin ist unabhängig. Gewürfelt wird nur auf dem Server, die Logik liegt in `src/shared/slots.js` und wird auch vom Mock genutzt.
- **Rewarded Ad (Platzhalter):** nach dem Run «Münzen verdoppeln».
- **Werbepausen (Platzhalter):** gelegentlich eine kurze Werbepause nach dem Game Over, siehe [Werbepausen und Erinnerungen](#werbepausen-und-erinnerungen).
- **Konto:** Beim ersten Besuch legt der Server automatisch ein Gast-Konto an. Unter «Konto» kann man es mit Benutzername + Passwort sichern (der Fortschritt bleibt). Anmelden mit einem bestehenden Konto ersetzt den Gast, dessen Fortschritt geht verloren (das UI warnt). Gast-Konten werden 24 h nach der letzten Aktivität gelöscht, siehe [Gast-Konten](#gast-konten-und-spiel-sessions).

Alle Zahlen stehen in `src/shared/economy.js`, alle Skins in `src/shared/items.js`.

## Struktur

```
index.html             Spiel (DOM-Overlay für das UI)
admin.html             Admin-Dashboard (noindex, nur im normalen Build)
src/
  main.js              Einstieg Spiel
  style.css            komplettes UI-Styling des Spiels
  shared/              Regeln (vom Backend, vom Mock und vom UI importiert, nur untereinander verknüpft)
    economy.js         alle Zahlen: Münzen, Limits, ACCOUNT, SESSION, PRIVACY, ADS, NUDGE, SEGMENTS, ADMIN, CONTEXT, EVENTS
    items.js
    slots.js           Spin-Logik (Server und Mock)
    runs.js            Plausibilität eingereichter Runs (Server und Mock)
    engagement.js      decide(): Werbepause und Registrier-Erinnerung ja/nein (Server und Mock)
    segments.js        Tageszeiten, Scores und Segmente der Spielerprofile, Labels fürs Dashboard
  api/
    index.js           wählt Mock oder echtes Backend, lässt Statistik-Aufrufe nur mit Einwilligung durch
    mockApi.js         simuliert das Backend im Browser (localStorage), inkl. Consent, Sessions, Gast-Ablauf
    restApi.js         echtes Backend (Token, Auto-Gast, Login, Hinweis bei gelöschtem Gast)
    context.js         Session-Kontext: Zeitzone, Sprache, Bildschirmklasse, Touch, Referrer-Host, UTM
  ads/adHooks.js       Einstiegspunkte für Werbung (Platzhalter)
  game/
    Game.js            Zustände, Loop, Kamera, Score/Multiplikator, Ablauf nach dem Game Over
    World.js           endlose Welt aus Chunks, Spawn-Logik
    terrain.js         Höhenfunktion (Noise) + Terrain-Mesh
    entities.js        Münzen, Felsbögen, Bäume, Vögel, Heli, Flugzeug
    Player.js          Flugphysik, Modell, Rauchspuren
    Input.js           Tastatur + Touch
    audio.js           synthetische Sounds (WebAudio)
  ui/
    ui.js              Menü, HUD, Game Over, Slotmachine, Garage, Konto, Modals (Einwilligung, Hinweise)
    privacy.js         Datenschutzerklärung (Entwurf, Werte aus economy.js)
  admin/               Admin-Dashboard (Vanilla JS, eigene SVG-Charts)
    main.js            Hash-Router, Login, Navigation
    api.js             Admin-API (Token in sessionStorage)
    charts.js          Linie, Balken, Heatmap, Kohorten, KPI-Kacheln
    dom.js, format.js  DOM-Helfer (nur textContent), Zahlen- und Datumsformate
    admin.css
    views/             overview, activity, retention, segments, engagement, audience, players, player, common
server/
  .env.example         Vorlage für server/.env (Zugangsdaten, nie committen)
  sql/schema.sql       Tabellen (MariaDB), läuft bei jedem Start, nur wiederholbare Statements
  scripts/
    db-init.js         legt die Tabellen an
    db-check.js        zeigt Verbindung und Tabellen
    local-db.js        portable MariaDB unter Windows
    admin-grant.js     Admin-Rechte vergeben/entziehen
    geo-update.js      lädt die GeoIP-Datenbank (DB-IP City Lite)
    seed-demo.js       Demo-Daten fürs Dashboard (nur lokal)
    seed-engagement.js Hilfsmodul von seed-demo.js (simuliert Werbepausen und Erinnerungen)
  src/
    index.js           Start: Migration, GeoIP laden, Server, Hintergrund-Jobs
    app.js             Express-App, alle Routen unter /api, liefert dist/ aus (/admin ohne .html)
    config.js          liest server/.env bzw. Umgebungsvariablen, Betriebswerte (Job-Takt, Batches)
    migrate.js         führt schema.sql aus
    db.js              Pool (UTC) + Transaktionen + lockUser
    errors.js          alle Fehlermeldungen (Deutsch)
    auth.js            Passwort-Hash (scrypt), Session-Tokens, authenticate
    activity.js        letzte Aktivität und Spiel-Sessions (neue Session nach 30 min Pause)
    cleanup.js         Gäste nach 24 h Inaktivität archivieren und löschen, abgelaufene Tokens
    jobs.js            Hintergrund-Jobs: Cleanup und Profile alle 15 min, Purge täglich
    geo.js             Land und Kanton aus der IP (flüchtig, nie gespeichert)
    ua.js              grobe Geräte-, OS- und Browser-Familie aus dem User-Agent (String wird nicht gespeichert)
    profile.js         Profil wie im Mock
    limits.js          Rate-Limits
    routes/            auth.js, game.js, privacy.js (/consent, /account/delete), session.js, engage.js, admin.js
    analytics/
      archive.js       archiveUser(): anonymes Archiv vor jeder User-Löschung
      privacy.js       löscht Statistikdaten bei Widerruf
      purge.js         Fristen: Rohdaten 90 Tage, Profile 12 Monate
      metrics.js       Kennzahlen pro Spieler (nur mit Statistik-Einwilligung)
      profiles.js      Profile berechnen (Job und Einzelaufruf)
      dashboard.js     Abfragen fürs Dashboard (live + Archiv, Mindestgruppengrösse)
      players.js       Spielerliste und -detail fürs Dashboard
  test/                node:test, Unit- und API-Tests
```

## Backend (Node.js + MariaDB)

### Lokal einrichten

```bash
brew install mariadb && brew services start mariadb
mariadb -u "$(whoami)" -e "
  CREATE DATABASE wingrush CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  CREATE DATABASE wingrush_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  CREATE USER 'wingrush'@'localhost' IDENTIFIED BY '<passwort>';
  GRANT ALL PRIVILEGES ON wingrush.* TO 'wingrush'@'localhost';
  GRANT ALL PRIVILEGES ON wingrush_test.* TO 'wingrush'@'localhost';"

cd server
cp .env.example .env      # Werte eintragen
npm install
npm run db:init           # Tabellen anlegen (passiert auch automatisch beim Start)
npm run dev               # http://localhost:3000/api/health
```

### Lokal unter Windows (ohne Docker und Admin-Rechte)

Eine portable MariaDB 10.11.19 (gleiche Version wie Infomaniak) liegt neben dem Repo in `../mariadb`, also ausserhalb von Git.

```bash
npm install && npm --prefix server install
npm run db:local:setup    # einmalig: Download + Prüfsumme, Datenordner, legt server/.env mit lokalem Zufallspasswort an
npm run db:local:start    # MariaDB im Hintergrund starten (nur 127.0.0.1:3306)
npm run db:local:status
npm run db:local:stop
```

Danach in zwei Terminals `npm --prefix server run dev` (Backend, legt die Tabellen an) und `npm run dev` (Frontend). Die Skripte verweigern den Dienst, wenn `DB_HOST` in `server/.env` nicht lokal ist. Lokal wird die Infomaniak-DB also nie angefasst.

### Tests

```bash
cd server
DB_USER=<lokaler-user> DB_PASSWORD=<lokales-passwort> DB_NAME_TEST=wingrush_test npm test
```

Die Tests laufen gegen `DB_NAME_TEST`. Der Name muss auf `_test` enden, sonst bricht der Lauf ab, und die Datenbank wird bei jedem Lauf geleert. Umgebungsvariablen haben Vorrang vor `server/.env`, so laufen die Tests sicher gegen die lokale DB. Aktuell rund 200 Tests (Unit-Tests für die Shared-Logik, API-Tests gegen eine echte MariaDB, Mock-Tests mit localStorage- und Zeit-Stub).

### server/.env

| Key | Bedeutung |
|---|---|
| `PORT` | Port des Servers (Standard 3000) |
| `DB_HOST`, `DB_PORT` | MariaDB-Host und -Port |
| `DB_USER`, `DB_PASSWORD` | DB-Benutzer |
| `DB_NAME` | Datenbank fürs Spiel |
| `DB_NAME_TEST` | Datenbank für `npm test`, muss auf `_test` enden und wird bei jedem Testlauf geleert |
| `TRUST_PROXY` | Anzahl Proxys vor dem Server, auf Infomaniak `1`. Lokal leer lassen |
| `CORS_ORIGIN` | Nur nötig, wenn Frontend und API auf verschiedenen Domains laufen (kommagetrennt) |
| `GEOIP_DB` | Pfad zur GeoIP-Datei, relativ zum Ordner `server/`. Empfohlen `../geoip/dbip-city-lite.mmdb`. Leer = kein Standort |

Umgebungsvariablen, die der Host setzt, haben Vorrang vor `server/.env`. Der Server-Prozess läuft immer in UTC (`server/src/db.js`), alle Zeitvergleiche passieren in SQL.

### Endpunkte

Alle unter `/api`, JSON. Ausser bei `/auth/guest`, `/auth/login` und `/health` braucht es den Header `Authorization: Bearer <token>`.

**Fehler** kommen immer als `{ "error": "<Meldung auf Deutsch>" }` (Texte in `server/src/errors.js`). Wichtige Statuscodes:

| Status | Bedeutung |
|---|---|
| 400 | Ungültige Anfrage, unplausibler Run, falsches Passwort beim Löschen des Kontos |
| 401 | Session fehlt, ist abgelaufen oder ungültig, ausserdem falsche Login-Daten bei `/auth/login` und `/admin/login`. Bekommt der Client auf einem normalen Aufruf 401, verwirft er den Token und legt still einen neuen Gast an. Deshalb nie 401 für etwas anderes verwenden |
| 403 | Kein Zugriff (Admin-Bereich ohne Admin-Rechte oder ohne Admin-Session) |
| 404 | Nicht gefunden (auch fremde oder unbekannte Entscheidungs-IDs) |
| 409 / 410 | Konflikt (z. B. bereits verdoppelt, Benutzername vergeben, Profil ohne Einwilligung) bzw. Angebot abgelaufen |
| 429 | Rate-Limit oder Tageslimit |

**Spiel**

| Methode | Pfad | Zweck → Antwort |
|---|---|---|
| POST | /auth/guest | Gast-Konto anlegen → `{ token, profile }` |
| POST | /auth/signup | Gast mit `{ username, password }` sichern (setzt `registered_at`), neuer Token → `{ token, profile }` |
| POST | /auth/login | Anmelden → `{ token, profile }`. Ein bisheriger Gast wird archiviert (`guest_login`) und gelöscht |
| POST | /auth/logout | Session beenden → `{ ok: true }` |
| GET | /me | Profil: `userId, username, coins, highscore, bestDistance, totalRuns, playTime, inventory, equipped, consent` mit `consent: { decided, stats, personal, adult }` |
| POST | /runs | Run abgeben, Server prüft Plausibilität und bucht Münzen → `{ runId, newHighscore, profile }` |
| POST | /runs/:id/double | Münzen verdoppeln nach Rewarded Ad → `{ profile }` |
| POST | /spin | Server würfelt Spin, zieht Münzen ab, legt Item ins Inventar → `{ reels, result, profile }` |
| POST | /equip | Item ausrüsten → `{ profile }` |
| POST | /consent | Einwilligung `{ stats, personal, adult }` (alle boolean) speichern → `{ profile }`. Details unten |
| POST | /session | Kontext der Spiel-Session → `{ ok: true }`. Details unten |
| POST | /events | Spielereignis `{ name, data }` → `{ ok: true }`. Details unten |
| POST | /engage | Werbepause oder Erinnerung? → `{ interstitial, nudge }`. Details unten |
| POST | /engage/:id | Ergebnis einer gezeigten Entscheidung `{ outcome }` → `{ ok: true }` |
| POST | /account/delete | Konto und Daten löschen `{ password? }` → `{ ok: true }` |
| GET | /health | Server + DB erreichbar? → `{ ok: true }` |

- **/consent:** `personal` wird nur gespeichert, wenn auch `stats` und `adult` (16+, Selbstauskunft) gesetzt sind. Beim ersten Erteilen von Statistik merkt sich der Server den Zeitpunkt (`consent_stats_at`), Profile nutzen nur Daten ab dann. Widerruf löscht sofort Ereignisse, Spiel-Sessions, Profil, übersprungene Entscheidungen, die Statistik-Outcomes und den gespeicherten Zeitzonen-Offset.
- **/session** `{ tzOffset, timeZone, locale, screen, touch, referrer, utm: { source, medium, campaign } }`: nur mit Statistik-Einwilligung gespeichert (Tabelle `play_sessions`), sonst still `{ ok: true }`. Gerät, OS und Browser kommen als grobe Familie aus dem User-Agent (`ua.js`), Land und Kanton aus der IP (`geo.js`). Weder IP noch User-Agent-String werden gespeichert. Bots werden ignoriert. Werte werden mit `cleanContext()` (`economy.js`) bereinigt.
- **/events:** nur Namen aus der Allowlist `EVENTS` in `economy.js` (`run_start`, `run_end`, `rewarded_ad_start`, `rewarded_ad_complete`, `screen_view`) mit den dort erlaubten Feldern, höchstens 2000 Byte. Unbekannte Namen geben 400. Gespeichert wird nur mit Statistik-Einwilligung, sonst wird das Ereignis still verworfen. Der Client schickt Ereignisse ohne Einwilligung gar nicht erst (`src/api/index.js`).
- **/engage** `{ placement: 'gameover' | 'menu' | 'slot_item', facts: { hour, newHighscore, newItem } }` → `{ interstitial: null | { id, seconds }, nudge: null | { id, reason } }`. Entscheidet mit `decide()` aus `src/shared/engagement.js`. Nie beides zugleich. Gezeigte Entscheidungen werden immer gespeichert (für die Obergrenzen), übersprungene nur mit Statistik-Einwilligung.
- **/engage/:id** `{ outcome }`: `clicked` / `dismissed` (Erinnerung), `continued` (nach der Werbepause weitergespielt), `dropped` (wurde doch nicht angezeigt). Nur für eigene, gezeigte Entscheidungen ohne Ergebnis, sonst 404. `clicked` und `continued` werden nur mit Statistik-Einwilligung gespeichert, `dismissed` immer (für die Pause nach dreimal «Später»).
- **/account/delete:** bei registrierten Konten ist das Passwort Pflicht, falsch → 400 (nie 401). Das Konto wird ohne Zusatzangaben archiviert (`deleted`) und dann gelöscht. Der Client legt danach einen neuen Gast an.

Grundsatz: **Der Server ist der Chef über Münzen und Spins.** Der Client zeigt nur an.

**Plausibilität eines Runs** (`src/shared/runs.js`, Zahlen in `RUN_LIMITS`):
- Münzen höchstens 80 pro Sekunde plus Puffer von 500. Den vollen Puffer gibt es erst ab 20 s Flugzeit, kurze Runs bekommen nur einen Anteil.
- Der Multiplikator muss in der Flugzeit erreichbar sein (eine Stufe pro 1,4 s).
- Höchstens ein Tunnel pro Chunk (160 m Distanz).
- Ein Run muss in die echte Zeit seit dem letzten Run passen, mit 0,5 s Abstand (der Crash dauert im Spiel 1,1 s). Runs können zusammen also nie länger dauern als die echte Zeit.

**Spielzeit** (`playTime: { flight, slots, total }` in Sekunden, im Profil) zählt nur der Server:
- **Flugzeit:** Summe der Run-Dauern.
- **Glücksautomat:** Abstand zum vorherigen Spin, wenn er höchstens 60 s beträgt, sonst pauschal 3 s pro Spin (`PLAYTIME` in `economy.js`). Leerlauf ohne Spin zählt nicht.

Gast-Zeit bleibt beim Registrieren erhalten.

Benutzernamen: 3–20 Zeichen `A–Z a–z 0–9 _ . -`, Gross-/Kleinschreibung zählt beim Vergleich nicht. Passwörter: 8–128 Zeichen, gespeichert als scrypt-Hash. Eine E-Mail gibt es nicht, deshalb ist auch kein Passwort-Reset möglich.

**Admin-API** (`/api/admin`, für das Dashboard):

| Methode | Pfad | Zweck |
|---|---|---|
| POST | /admin/login | `{ username, password }` → `{ token, username }`. Session 8 h, nur für Konten mit Admin-Rechten. Falsche Daten 401, kein Admin 403 |
| POST | /admin/logout | Admin-Session beenden |
| GET | /admin/me | `{ id, username }` |
| GET | /admin/overview?days=30 | KPIs und Tagesreihen (neue Spieler, Signups, Aktive, Runs, Spielminuten, Verdopplungen, Werbepausen, Erinnerungen) |
| GET | /admin/activity?days=90 | Heatmap Wochentag × Stunde (Ortszeit), Stunden, Wochentage, Tageszeit-Typen, Session-Längen |
| GET | /admin/retention?weeks=12 | Wochen-Kohorten, D1/D7/D30 |
| GET | /admin/segments | Segment-Verteilung, Score-Histogramme |
| GET | /admin/engagement?days=30 | Werbepausen mit Gründen und Weiterspielquote, Rewarded aggregiert, Erinnerungen je Grund mit Registrierungen |
| GET | /admin/audience?days=90 | Land, Kanton, Gerät, OS, Browser, Bildschirm, Referrer, UTM (Gruppen unter 5 → «Andere») |
| GET | /admin/players?q&segment&type&consent&sort&dir&page | Spielerliste |
| GET | /admin/players/:id | Spielerdetail (Analytics nur mit Einwilligung) |
| POST | /admin/players/:id/recompute | Profil neu berechnen → `{ profile }` (409 ohne Statistik-Einwilligung) |
| POST | /admin/players/:id/delete | Spieler archivieren (`admin`) und löschen. Admins und das eigene Konto: 403 |

Alle Admin-Endpunkte ausser `/login` brauchen einen Token aus dem Admin-Login. Ein normaler Spiel-Token gibt 403, auch bei Admins. Admin-Aufrufe zählen nicht als Spielaktivität. Rate-Limit 120 Aufrufe pro Minute.

### Gast-Konten und Spiel-Sessions

- Gast-Konten werden **24 h nach der letzten Aktivität** gelöscht (`ACCOUNT.guestRetentionHours`). Der Job läuft alle 15 min (`server/src/jobs.js`), pro Gast in einer eigenen Transaktion mit erneuter Prüfung. Vorher wird der Gast anonym archiviert (`archiveUser`, siehe Datenschutz). Registrierte Konten bleiben, bis man sie löscht.
- Als Aktivität zählt jeder Spiel-Aufruf mit Token, `last_seen_at` wird höchstens einmal pro Minute aktualisiert.
- Nach **30 min Pause** beginnt eine neue Spiel-Session (`SESSION.timeoutMinutes`, `users.session_no`). Runs und Spins speichern ihre Session-Nummer.
- Im Client: Menü und Konto weisen Gäste auf die 24-h-Löschung hin. Ist ein Gast gelöscht worden, zeigt das Spiel beim nächsten Start einen Hinweis und beginnt mit einem neuen Gast. Der Mock bildet den Ablauf nach.

## Datenschutz

- **Opt-in:** Beim ersten Start erscheint ein Banner mit drei gleich gestalteten Buttons «Ablehnen», «Auswahl speichern» und «Alle akzeptieren». Die Wahl lässt sich im Konto jederzeit ändern. Ohne Entscheid gibt es keine Werbepausen und Erinnerungen.
- **Notwendig** (immer): Konto, Spielstand, Runs und Spins (mit Zeitpunkt und Session-Nummer), letzte Aktivität, Prüfung gegen Betrug, gezeigte Werbepausen und Erinnerungen samt «Später» (für die Obergrenzen), die Einwilligung selbst. Der Token liegt im localStorage, es gibt keine Cookies. Schriften werden selbst ausgeliefert.
- **Statistik** (Einwilligung): Spielereignisse (`events`), Spiel-Sessions mit Kontext (`play_sessions`: Zeitzone, Sprache, Gerät/OS/Browser-Familie, Bildschirmklasse, Touch, Referrer-Host, UTM, Land, Kanton), übersprungene Entscheidungen und Outcomes, Spielerprofil mit Scores und Segmenten (`player_profiles`). Profile nutzen nur Daten ab der Einwilligung.
- **Personalisierte Angebote** (Einwilligung, nur ab 16, Selbstauskunft, setzt Statistik voraus): Werbepausen und Erinnerungen richten sich nach Segmenten und Tageszeit, immer innerhalb der festen Obergrenzen.
- **Fristen** (`PRIVACY.retention`): Ereignisse, Spiel-Sessions und Entscheidungen 90 Tage, Profile 12 Monate nach der letzten Aktivität, Gäste 24 h. Der Purge läuft täglich (`server/src/analytics/purge.js`).
- **Widerruf** löscht sofort alle Statistikdaten des Kontos. **Kontolöschung** im Konto (bei Registrierten mit Passwort).
- **Archiv** (`player_archive`, `player_archive_days`): vor jeder Löschung eines Kontos, unbefristet, ohne User-ID und Benutzername. Enthält erste/letzte Spieltage, registriert ja/nein, Einwilligung ja/nein, Zähler und Tageszeilen (Runs, Spins, Spielzeit, Verdopplungen, Werbepausen, Erinnerungen). Gerät, OS, Browser, Land, Kanton, Heatmap und Segmente kommen nur bei abgelaufenen Gästen (`expired`) mit Statistik-Einwilligung dazu, nie bei Kontolöschung, Gast-Login oder Admin-Löschung.
- **Nie gespeichert:** IP-Adressen, User-Agent-Strings, Fingerprints, GPS, Stadt, Koordinaten, Werbe-IDs. Keine Sucht-Segmente, Slot- und Verdoppel-Kennzahlen nur aggregiert. Keine Weitergabe von Daten oder Segmenten an Werbenetze oder andere Dritte.
- **Datenschutzerklärung:** `src/ui/privacy.js` (im Spiel über «Datenschutz»). Sie ist ein **Entwurf, keine Rechtsberatung**. Die Platzhalter für die Verantwortlichen (Name, Adresse, E-Mail) musst du selbst ausfüllen. Bei wesentlichen Änderungen `PRIVACY.version` erhöhen, dann erscheint das Banner erneut.

## Werbepausen und Erinnerungen

Beides entscheidet `decide()` in `src/shared/engagement.js` (Server und Mock identisch), alle Zahlen stehen in `ADS` und `NUDGE` in `economy.js`.

- **Werbepause (Interstitial, 5 s)** nur nach dem Game Over: frühestens ab der 3. Session und nach 5 Runs, nicht nach Runs unter 8 s, 5 min Ruhe nach einer Rewarded Ad, mindestens 3 min Abstand, alle 6 Runs (erste 4 Sessions) bzw. alle 4 Runs, höchstens 3 pro Session und 8 pro Tag, zwischen 0 und 5 Uhr höchstens 1 pro Session.
- **Mit «Personalisierte Angebote»:** werbetolerante Spieler alle 3, werbemüde alle 6 Runs, ausserhalb der eigenen Tageszeit höchstens 1 pro Session, Rückkehrer und Abwanderungsgefährdete gar keine.
- **Registrier-Erinnerung (Nudge)** nur für Gäste mit Fortschritt (≥ 3 Runs, ein gewonnenes Item oder ≥ 500 Münzen), nie zusammen mit einer Werbepause. Gründe: Item aus dem Automaten, neuer Highscore (ab dem 2. Run), Rückkehr ins Menü zu Beginn einer neuen Session, 10 min Spielzeit (personalisiert früher, passend zur üblichen Sessionlänge). Höchstens 1 pro Session, 2 pro Tag, 120 min Abstand, nach dreimal «Später» in 72 h Pause. Der Text nennt die 24-h-Löschung.
- **Werbung ist vorerst ein Platzhalter.** Alles läuft über `src/ads/adHooks.js` (`showRewardedAd`, `showInterstitial`), dort kommt später das echte Ad-SDK hin.

## Admin-Dashboard

**Zugang einrichten:**

1. Im Spiel ein Konto registrieren (Gäste können keine Admins werden).
2. `npm run admin:grant -- <name>` zeigt Ziel-Datenbank und einen Trockenlauf.
3. `npm run admin:grant -- <name> --yes` vergibt die Rechte, `--revoke --yes` entzieht sie (und beendet offene Admin-Sessions).
4. Öffnen: lokal im Vite-Dev-Server unter `http://localhost:5173/admin.html` (Backend muss laufen), nach `npm run build` über Express unter `http://localhost:3000/admin`. Anmelden mit dem Spiel-Passwort.

Auf dem Hosting läuft dasselbe Skript im Server-Ordner (`cd server && npm run admin:grant -- <name> --yes`), es nutzt die Zugangsdaten aus `server/.env`.

**Ansichten:** Übersicht (KPIs, Tageslinien), Aktivität (Heatmap Wochentag × Stunde in Ortszeit, Tageszeit-Typen, Session-Längen), Retention (Wochen-Kohorten, D1/D7/D30), Segmente, Werbung & Erinnerungen, Publikum (Land, Kanton, Gerät, Referrer, UTM), Spieler (Liste mit Filter und Detail inkl. Neu berechnen und Löschen). Zeitreihen und Kohorten enthalten das Archiv gelöschter Konten. Tage sind in UTC beschriftet. Gruppen mit weniger als 5 Spielern (`PRIVACY.minGroupSize`) werden zusammengefasst oder ausgeblendet. Der Token liegt nur in `sessionStorage`.

### GeoIP (Land und Kanton)

- Quelle: **DB-IP City Lite** (MMDB, Lizenz CC BY 4.0). Attribution «IP Geolocation by DB-IP» steht im Datenschutztext des Spiels und im Footer des Dashboards. Die Abfrage läuft lokal auf dem Server, die IP verlässt ihn nicht und wird nicht gespeichert. Gespeichert werden nur Land und (für die Schweiz) Kanton.
- In `server/.env` den Key `GEOIP_DB` setzen, empfohlen `GEOIP_DB=../geoip/dbip-city-lite.mmdb` (relativ zum Ordner `server/`, der Ordner `geoip/` ist in `.gitignore`).
- `npm run geo:update` lädt die Datei des aktuellen Monats (bei Bedarf Vormonat), prüft sie und ersetzt die alte. **Monatlich** laufen lassen, lokal und auf dem Hosting, danach den Server neu starten.
- `npm run geo:update -- --check <ip>` zeigt die Rohwerte und das Ergebnis für eine IP.
- Speicherbedarf rund 120 MB (Datei und RAM). Ohne `GEOIP_DB` läuft alles normal, nur ohne Standort. Fehlt die Datei oder ist sie unlesbar, startet der Server trotzdem (mit Warnung, ohne Standort).

### Demo-Daten

```bash
npm run db:seed-demo -- --players 300 --days 60
npm run db:seed-demo -- --reset
```

Erzeugt Spieler mit verschiedenen Tagesrhythmen, Runs, Spins, Sessions, Werbe- und Erinnerungs-Entscheidungen, Profile und Archivzeilen (`demo_*`, Archivgrund `seed`). `--reset` entfernt alles wieder. Läuft nur gegen eine lokale DB (`DB_HOST` `127.0.0.1` oder `localhost`), sonst bricht das Skript ab.

### Deploy auf Infomaniak

Lokal und auf dem Hosting gilt dasselbe: Der Server liest seine Zugangsdaten aus **`server/.env`**. Umgebungsvariablen des Hosts haben Vorrang. Die Datei ist in `.gitignore` und gehört nie ins Repo (es ist öffentlich).

**Hochladen** (per FTP oder Git) in einen Ordner, z. B. `sites/im5-game`. Ohne `node_modules/`, `dist/`, `geoip/` und ohne deine lokale `server/.env`.

**Auf dem Server** `server/.env` anlegen:
```
DB_HOST=<Host-Server aus dem DB-Panel>
DB_PORT=3306
DB_NAME=<Datenbank>
DB_USER=<DB-Benutzer>
DB_PASSWORD=<Passwort>
TRUST_PROXY=1
GEOIP_DB=../geoip/dbip-city-lite.mmdb
```
`GEOIP_DB` ist optional. Achtung: Bei späteren Uploads nie die lokale `server/.env` mitschicken, sonst wird die Datei auf dem Server überschrieben.

**Im Manager bei der Node.js-Site:**
- Ausführungsordner: der Projektordner (dort liegt die `package.json`)
- Node-Version: 22 (der Vite-Build braucht ≥ 20.19)
- Build-Befehl: `npm run build:deploy` (mit Git: `git pull && npm run build:deploy`). Baut Spiel und Admin-Dashboard nach `dist/` und installiert die Server-Pakete
- Start-Befehl: `npm start`
- Den Port übergibt Infomaniak über `PORT`, der Server nutzt ihn automatisch.

**Datenbank:** Tabellen werden beim Serverstart automatisch angelegt und angepasst (`server/sql/schema.sql`), dazu gehört auch das einmalige Aufräumen alter Ereignisse ohne Einwilligung. Schlägt das fehl (z. B. falsches Passwort), bricht der Start mit einer Meldung ab. `npm run db:check` zeigt Verbindung und Tabellen.

**Beim ersten Start mit der 24-h-Regel** archiviert und löscht der Cleanup sofort alle Gäste, die seit mehr als 24 h inaktiv sind. Das ist gewollt, sollte aber bewusst passieren (vorher kurz prüfen, ob noch Gäste mit Spielständen da sind, die man behalten will).

**Nach dem ersten Deploy:**
1. Optional GeoIP: `cd server && npm run geo:update`, danach die Site neu starten. Monatlich wiederholen.
2. Im Spiel ein Konto registrieren, dann `cd server && npm run admin:grant -- <name>` (Trockenlauf) und mit `--yes` vergeben.
3. Dashboard unter `https://<deine-domain>/admin` öffnen.

Die Infomaniak-DB ist von aussen gesperrt. Vom eigenen Rechner aus geht es nur, wenn du im DB-Panel deine IP freigibst. Vom Hosting aus funktioniert es ohne Freigabe.

### Bekannte Grenzen

- **Münzen verdoppeln** ist ohne serverseitige Bestätigung des Werbenetzwerks (SSV) nicht fälschungssicher. Bis dahin gilt: nur einmal pro Run, 3 s bis 15 min nach dem Run, max. 20 Mal pro Tag (`DOUBLE` in `economy.js`).
- **Werbung** ist nur ein Platzhalter (Fake-Overlay in `adHooks.js`), es gibt noch kein Ad-SDK und keine echten Einnahmen.
- **Retention wird unterschätzt:** Gäste mit über 24 h Pause werden gelöscht und zählen bei der Rückkehr als neue Spieler.
- **Kanton** ist bei Mobilfunk und VPN oft ungenau oder fehlt (IP des Anbieters statt des Standorts).
- **Datenschutzerklärung** ist ein Entwurf, die Verantwortlichen sind Platzhalter und der Text sollte geprüft werden.
- **Mehrere Tabs gleichzeitig:** Ein Run darf nicht länger dauern als die Zeit seit dem letzten Run (minus 0,5 s). Fliegt man in zwei Tabs parallel, wird der zweite Run abgelehnt (Schutz gegen Farming).
- Abmelden in einem Tab macht die anderen Tabs beim nächsten Aufruf zu einem neuen Gast.

## Debug

Im Mock-Modus setzt `api.resetSave()` in der Browser-Konsole den lokalen Spielstand zurück.
