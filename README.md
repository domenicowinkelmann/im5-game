# Wingrush (Arbeitstitel)

Casual-3D-Game für den Browser: Wingsuit-Flug durch ein Alpental. Münzen sammeln, je riskanter desto wertvoller, und die Münzen im Glücksautomaten gegen Skins eintauschen.

## Starten

Voraussetzung: Node.js **≥ 20.19** (Vite 8). Mit Node 20.18 fehlt nach `npm install` die native Rolldown-Binding und der Build bricht ab.

```bash
npm install
npm run dev        # http://localhost:5173 (auch im WLAN fürs Handy), /api wird an localhost:3000 weitergeleitet
npm run build      # Produktions-Build nach dist/
```

Das Spiel braucht dafür das Backend (siehe unten). Ohne Backend: `VITE_API=mock npm run dev` nutzt den Browser-Mock.

`npm run build:single` erzeugt eine einzelne HTML-Datei (dist-single/index.html), praktisch für Abgaben oder schnelle Vorschauen. Sie läuft immer mit dem Mock, weil sie ohne Server geöffnet wird.

## Steuerung

| Aktion | Tastatur | Touch / Maus |
|---|---|---|
| Lenken | ← → oder A/D | horizontal ziehen |
| Hochziehen (bremst) | ↑ oder W | nach oben ziehen |
| Sturzflug (beschleunigt) | ↓ oder S | nach unten ziehen |
| Nochmal nach Crash | Leertaste / Enter | Button |

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

- **Konto:** Beim ersten Besuch legt der Server automatisch ein Gast-Konto an. Unter «Konto» kann man es mit Benutzername + Passwort sichern (der Fortschritt bleibt). Anmelden mit einem bestehenden Konto ersetzt den Gast, dessen Fortschritt geht verloren (das UI warnt).

Alle Zahlen stehen in `src/shared/economy.js`, alle Skins in `src/shared/items.js`.

## Struktur

```
src/
  main.js              Einstieg
  style.css            komplettes UI-Styling
  shared/              Regeln & Items (vom Backend und vom Mock importiert)
    economy.js
    items.js
    slots.js           Spin-Logik (Server und Mock)
    runs.js            Plausibilität eingereichter Runs (Server und Mock)
  api/
    index.js           wählt Mock oder echtes Backend
    mockApi.js         simuliert Backend im Browser (localStorage)
    restApi.js         echtes Backend (Token, Auto-Gast, Login)
  ads/adHooks.js       Einstiegspunkte für Werbung (Platzhalter)
  game/
    Game.js            Zustände, Loop, Kamera, Score/Multiplikator
    World.js           endlose Welt aus Chunks, Spawn-Logik
    terrain.js         Höhenfunktion (Noise) + Terrain-Mesh
    entities.js        Münzen, Felsbögen, Bäume, Vögel, Heli, Flugzeug
    Player.js          Flugphysik, Modell, Rauchspuren
    Input.js           Tastatur + Touch
    audio.js           synthetische Sounds (WebAudio)
  ui/ui.js             Menü, HUD, Game Over, Slotmachine, Garage, Konto
server/
  .env.example         Vorlage für server/.env (Zugangsdaten, nie committen)
  sql/schema.sql       Tabellen (MariaDB)
  scripts/db-init.js   legt die Tabellen an
  src/
    index.js           Start, Cleanup alter Gäste/Sessions
    app.js             Express-App, alle Routen unter /api, liefert dist/ aus
    config.js          liest server/.env bzw. Umgebungsvariablen
    db.js              Pool + Transaktionen
    auth.js            Passwort-Hash (scrypt), Session-Tokens
    profile.js         Profil wie im Mock
    limits.js          Rate-Limits
    routes/            auth.js, game.js
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
npm test                  # Tests gegen DB_NAME_TEST (wird dabei geleert!)
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

Umgebungsvariablen, die der Host setzt, haben Vorrang vor `server/.env`.

### Endpunkte

Alle unter `/api`, JSON. Fehler kommen als `{ "error": "<Meldung>" }`. Ausser bei `guest`, `login` und `health` braucht es den Header `Authorization: Bearer <token>`.

| Methode | Pfad | Zweck |
|---|---|---|
| POST | /auth/guest | Gast-Konto anlegen → `{ token, profile }` |
| POST | /auth/signup | Gast mit `{ username, password }` sichern, neuer Token |
| POST | /auth/login | Anmelden → `{ token, profile }` (Gast-Session wird ersetzt) |
| POST | /auth/logout | Session beenden |
| GET | /me | Profil: Münzen, Highscore, Inventar, Ausrüstung, Benutzername, Spielzeit |
| POST | /runs | Run abgeben, Server prüft Plausibilität und bucht Münzen |
| POST | /runs/:id/double | Münzen verdoppeln nach Rewarded Ad |
| POST | /spin | Server würfelt Spin, zieht Münzen ab, legt Item ins Inventar |
| POST | /equip | Item ausrüsten |
| POST | /events | Verhaltensdaten für Werbelogik |
| GET | /health | Server + DB erreichbar? |

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

### Deploy auf Infomaniak

Lokal und auf dem Hosting gilt dasselbe: Der Server liest seine Zugangsdaten aus **`server/.env`**. Umgebungsvariablen des Hosts haben Vorrang. Die Datei ist in `.gitignore` und gehört nie ins Repo (es ist öffentlich).

**Hochladen** (per FTP oder Git) in einen Ordner, z. B. `sites/im5-game`. Ohne `node_modules/`, `dist/` und ohne deine lokale `server/.env`.

**Auf dem Server** `server/.env` anlegen:
```
DB_HOST=<Host-Server aus dem DB-Panel>
DB_PORT=3306
DB_NAME=<Datenbank>
DB_USER=<DB-Benutzer>
DB_PASSWORD=<Passwort>
TRUST_PROXY=1
```
Achtung: Bei späteren Uploads nie die lokale `server/.env` mitschicken, sonst wird die Datei auf dem Server überschrieben.

**Im Manager bei der Node.js-Site:**
- Ausführungsordner: der Projektordner (dort liegt die `package.json`)
- Node-Version: 22 (Vite 8 braucht ≥ 20.19)
- Build-Befehl: `npm run build:deploy` (mit Git: `git pull && npm run build:deploy`)
- Start-Befehl: `npm start`
- Den Port übergibt Infomaniak über `PORT`, der Server nutzt ihn automatisch.

**Datenbank:** Tabellen werden beim Serverstart automatisch angelegt und angepasst (`server/sql/schema.sql`). Schlägt das fehl (z. B. falsches Passwort), bricht der Start mit einer Meldung ab. `npm run db:check` zeigt Verbindung und Tabellen.

Die Infomaniak-DB ist von aussen gesperrt. Vom eigenen Rechner aus geht es nur, wenn du im DB-Panel deine IP freigibst. Vom Hosting aus funktioniert es ohne Freigabe.

### Bekannte Grenzen

- **Münzen verdoppeln** ist ohne serverseitige Bestätigung des Werbenetzwerks (SSV) nicht fälschungssicher. Bis dahin gilt: nur einmal pro Run, 3 s bis 15 min nach dem Run, max. 20 Mal pro Tag (`DOUBLE` in `economy.js`).
- **Mehrere Tabs gleichzeitig:** Ein Run darf nicht länger dauern als die Zeit seit dem letzten Run (minus 0,5 s). Fliegt man in zwei Tabs parallel, wird der zweite Run abgelehnt (Schutz gegen Farming).
- Abmelden in einem Tab macht die anderen Tabs beim nächsten Aufruf zu einem neuen Gast.

## Debug

Im Mock-Modus setzt `api.resetSave()` in der Browser-Konsole den lokalen Spielstand zurück.
