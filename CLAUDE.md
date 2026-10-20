# Projektkontext für Claude Code

Wingrush ist ein Casual-3D-Browsergame (Studienprojekt FHGR): Wingsuit-Flug, Münzen, Slotmachine für Skins. Backend: Node.js (Express 5) + MariaDB in `server/`, Hosting Infomaniak. Später kommt Werbung (Rewarded Ads) dazu.

## Stack
- Vite + Three.js, Vanilla JS (ES-Module), kein Framework
- UI ist ein DOM-Overlay (index.html + src/ui/ui.js + src/style.css)
- Sprache im UI und in Fehlermeldungen: Deutsch (Schweizer Schreibweise, immer «ss», nie Eszett)
- Backend: `server/` mit eigener package.json, Tests mit `node:test` (`npm --prefix server test`)

## Wichtige Regeln
- Keine Kommentare im Code (JS, CSS, HTML). Weder neue schreiben noch bestehende stehen lassen. Einzige Ausnahme im Backend: wenn wirklich nötig, ein kurzer einzeiliger Kommentar auf Englisch.
- `.env`-Dateien (z. B. `server/.env`) nie lesen, anzeigen oder bearbeiten, auch nicht über Bash. Neue Keys nur in `server/.env.example` ergänzen und dem User sagen.
- Spielregeln und Zahlen nur in `src/shared/economy.js`, Items nur in `src/shared/items.js`, Spin-Logik in `src/shared/slots.js` (bekommt den Zufallsgenerator übergeben: Server `crypto.randomInt`, Mock `Math.random`). Diese Dateien dürfen nur einander importieren, keine Pakete (das Backend importiert sie).
- Spiel- und UI-Code ruft nur `api` aus `src/api/index.js` auf, nie localStorage direkt.
- Münzen gutschreiben, Spins würfeln und Plausibilität prüfen passiert im Backend (`server/src/routes/game.js`). `mockApi.js` bildet dasselbe Verhalten für den Offline-Modus nach und muss bei Änderungen mitgezogen werden. Nie im Client-Spielcode.
- Jede Änderung an Münzen oder Runs im Backend läuft in `tx()` und sperrt zuerst die User-Zeile (`SELECT … FOR UPDATE`). Zeitvergleiche nur in SQL.
- Neue Endpunkte: in `restApi.js` und `mockApi.js` mit gleicher Antwortform ergänzen, Fehler als `{ error: '<Deutsch>' }` (Texte in `server/src/errors.js`).
- Neue Hindernisse in `src/game/entities.js` mit der Schnittstelle `{ object, getZ(), span, update?(dt, t, focus), hit(p, r) }` anlegen und in `World.populate()` spawnen.
- Werbung nur über `src/ads/adHooks.js`.
- Relevante Spielereignisse über `api.trackEvent(name, data)` loggen (Grundlage für Werbelogik).
- Spielzeit pro User (`playTime` im Profil, Spalten `play_flight_ms`/`play_slot_ms`) ist Grundlage für Werbung und Belohnungen und wird nur serverseitig in `/runs` und `/spin` gezählt.

## Nächste Schritte
1. Fluggefühl feintunen (Konstanten oben in `src/game/Player.js`)
2. Backend auf Infomaniak deployen (siehe README)
3. Consent-Banner, dann Ad-SDK in `adHooks.js`, dabei Verdoppeln mit Server-Side-Verification absichern
