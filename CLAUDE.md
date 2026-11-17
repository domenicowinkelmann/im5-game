# Projektkontext für Claude Code

Wingrush ist ein Casual-3D-Browsergame (Studienprojekt FHGR): Wingsuit-Flug, Münzen, Slotmachine für Skins. Backend: Node.js (Express 5) + MariaDB in `server/`, Hosting Infomaniak. Dazu Analytics mit Einwilligung, Werbepausen und Registrier-Erinnerungen (Werbung noch Platzhalter) und ein Admin-Dashboard (`admin.html`, `src/admin/`).

## Stack
- Vite + Three.js, Vanilla JS (ES-Module), kein Framework
- UI ist ein DOM-Overlay (index.html + src/ui/ui.js + src/style.css)
- Sprache im UI und in Fehlermeldungen: Deutsch (Schweizer Schreibweise, immer «ss», nie Eszett)
- Backend: `server/` mit eigener package.json, Tests mit `node:test`. Immer mit lokalen Zugangsdaten starten, die Test-DB muss auf `_test` enden und wird geleert: `cd server && DB_USER=… DB_PASSWORD=… DB_NAME_TEST=wingrush_test npm test`
- Lokale DB unter Windows: `npm run db:local:start` / `db:local:stop` / `db:local:status` (portable MariaDB 10.11.19 in `../mariadb`, Einrichtung einmalig mit `npm run db:local:setup` durch den User)

## Wichtige Regeln
- Keine Kommentare im Code (JS, CSS, HTML). Weder neue schreiben noch bestehende stehen lassen. Einzige Ausnahme im Backend: wenn wirklich nötig, ein kurzer einzeiliger Kommentar auf Englisch.
- `.env`-Dateien (lokal und auf dem Hosting, z. B. `server/.env`) nie lesen, anzeigen oder bearbeiten, auch nicht über Bash. Neue Keys nur in `server/.env.example` ergänzen und dem User sagen.
- Spielregeln und Zahlen nur in `src/shared/economy.js` (u. a. `ADS`, `NUDGE`, `SEGMENTS`, `PRIVACY`, `ADMIN`, `CONTEXT`, `SESSION`), Items nur in `src/shared/items.js`, Spin-Logik in `src/shared/slots.js` (bekommt den Zufallsgenerator übergeben: Server `crypto.randomInt`, Mock `Math.random`), Run-Plausibilität in `src/shared/runs.js` (Server und Mock nutzen dieselbe Prüfung), Werbe- und Erinnerungs-Entscheid in `src/shared/engagement.js` (`decide()`), Profile und Segmente in `src/shared/segments.js`. Diese Dateien dürfen nur einander importieren, keine Pakete (das Backend importiert sie).
- Spiel- und UI-Code ruft nur `api` aus `src/api/index.js` auf, nie localStorage direkt.
- Münzen gutschreiben, Spins würfeln und Plausibilität prüfen passiert im Backend (`server/src/routes/game.js`). `mockApi.js` bildet dasselbe Verhalten für den Offline-Modus nach und muss bei Änderungen mitgezogen werden, auch bei Consent, Session, Engage und Gast-Ablauf. Nie im Client-Spielcode.
- `server/sql/schema.sql` läuft bei jedem Serverstart (`server/src/migrate.js`). Deshalb muss jede Änderung wiederholbar sein: `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE … ADD COLUMN IF NOT EXISTS` / `DROP COLUMN IF EXISTS` / `MODIFY COLUMN`. Bestehende Statements nie umschreiben, sondern neue anhängen. Neue Tabellen in `server/test/helpers.js` in `TABLES` eintragen (Kinder vor `users`).
- Jede Änderung an Münzen oder Runs im Backend läuft in `tx()` und sperrt zuerst die User-Zeile (`SELECT … FOR UPDATE`). Zeitvergleiche nur in SQL. Der Server-Prozess läuft in UTC (`server/src/db.js`).
- Neue Endpunkte: in `restApi.js` und `mockApi.js` mit gleicher Antwortform ergänzen, Fehler als `{ error: '<Deutsch>' }` (Texte in `server/src/errors.js`).
- 401 nur bei fehlender oder ungültiger Session, weil der Client dann still einen neuen Gast anlegt (einzige Ausnahme: falsche Login-Daten bei `/auth/login` und `/admin/login`). Admin-Ablehnung 403, falsches Passwort (z. B. beim Löschen des Kontos) 400.
- Neue Hindernisse in `src/game/entities.js` mit der Schnittstelle `{ object, getZ(), span, update?(dt, t, focus), hit(p, r) }` anlegen und in `World.populate()` spawnen.
- Werbung nur über `src/ads/adHooks.js`.
- Relevante Spielereignisse über `api.trackEvent(name, data)` loggen. Namen und Felder nur aus der Allowlist `EVENTS` in `economy.js`.
- Analytics nur mit Einwilligung: Der Server prüft `consent_stats` (Ereignisse, Sessions, Profile), der Wrapper `src/api/index.js` lässt `trackEvent` und `startSession` nur mit `consent.stats` durch. Personalisierung nur mit `consent_personal` (ab 16, Selbstauskunft).
- Keine IP-Adressen, User-Agent-Strings oder Fingerprints speichern. Keine Sucht-Segmente. Slot- und Verdoppel-Kennzahlen nur aggregiert, nie pro Spieler. Verdoppeln bleibt statisch. Keine Segmente oder Daten an Werbenetze.
- `decisions`: gezeigte Entscheidungen immer speichern (Obergrenzen), übersprungene und die Outcomes in `STATS_OUTCOMES` nur mit Statistik-Einwilligung.
- Jede User-Löschung läuft über `archiveUser` (`server/src/analytics/archive.js`) in derselben Transaktion. Zusatzangaben (Gerät, Standort, Heatmap, Segmente) im Archiv nur bei Grund `'expired'` oder `'seed'`.
- Admin-Frontend in `src/admin/`: importiert ausser eigenen Dateien nur `src/shared/economy.js`, `src/shared/segments.js` und `@fontsource`, nie `src/api/*` oder `src/style.css`. Texte nur per `textContent`, Token nur in `sessionStorage`. Admin-Endpunkte akzeptieren nur Sessions aus dem Admin-Login.
- `src/ui/privacy.js` (Datenschutzerklärung) bei jeder Änderung an erhobenen Daten mitziehen (der Guard-Test in `server/test/context.test.js` prüft die Kontextfelder). Bei wesentlichen Änderungen `PRIVACY.version` erhöhen, dann erscheint das Banner erneut.
- Spielzeit pro User (`playTime` im Profil, Spalten `play_flight_ms`/`play_slot_ms`) ist Grundlage für Werbung und Belohnungen und wird nur serverseitig in `/runs` und `/spin` gezählt.
- Demo-Daten (`npm run db:seed-demo`) nur lokal, das Skript verweigert andere Hosts.

## Nächste Schritte
1. Fluggefühl feintunen (Konstanten oben in `src/game/Player.js`)
2. Branch `feature/analytics` nach Commit und Merge auf Infomaniak deployen (siehe README): erster Start löscht Gäste, die seit über 24 h inaktiv sind; `GEOIP_DB` setzen und `npm run geo:update`; danach `npm run admin:grant -- <name> --yes`
3. Platzhalter für die Verantwortlichen in der Datenschutzerklärung (`src/ui/privacy.js`) ausfüllen und den Text prüfen lassen
4. Echtes Ad-SDK in `adHooks.js` einbauen, dabei Verdoppeln mit Server-Side-Verification absichern
