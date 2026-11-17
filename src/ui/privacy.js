import { ACCOUNT, PRIVACY, ADS, SESSION } from '../shared/economy.js';

export function privacyHtml() {
  const { eventsDays, sessionsDays, decisionsDays, profileMonths } = PRIVACY.retention;
  const age = PRIVACY.personalMinAge;
  const ad = ADS.interstitial;
  return `
    <p class="privacy-draft">Entwurf, keine Rechtsberatung. Version ${PRIVACY.version}.</p>

    <h3>Verantwortlich</h3>
    <p>[Name der verantwortlichen Person], [Adresse], [E-Mail-Adresse]<br />Studienprojekt an der Fachhochschule Graubünden (FHGR).</p>

    <h3>Notwendige Daten</h3>
    <p>Damit Wingrush funktioniert, speichern wir: dein Konto (Benutzername, Passwort nur als sicherer Hash), deinen Spielstand
      (Münzen, Items, Highscore, Spielzeit), deine Runs und Spins mit Zeitpunkt, den Zeitpunkt deiner letzten Aktivität und die
      Nummer deiner Spielsitzung, deine Auswahl in diesem Datenschutz-Dialog samt Altersangabe, Daten zur Prüfung gegen Betrug
      sowie welche Werbepausen und Hinweise du wann gesehen hast und ob du einen Hinweis mit «Später» geschlossen hast
      (damit wir die Obergrenzen einhalten).
      Dein Anmelde-Token und ein Vermerk, ob du als Gast spielst, liegen im lokalen Speicher deines Browsers (localStorage).
      Wir setzen keine Cookies und laden keine Inhalte von fremden Servern, auch die Schriften liefern wir selbst aus.
      Ausserdem werten wir anonyme Gesamtzahlen aus (zum Beispiel Runs pro Tag), die keinen Rückschluss auf dich zulassen.
      Spielst du die Offline-Version, bleiben alle Daten in deinem Browser.</p>
    <p>Für alle gilt, unabhängig von deiner Einwilligung: Werbepausen gibt es frühestens in deiner ${ad.graceSessions + 1}.
      Spielsitzung und nach deinem ${ad.graceRuns}. Run, höchstens ${ad.maxPerSession} pro Spielsitzung und ${ad.maxPerDay} pro Tag,
      zwischen ${ad.night.from} und ${ad.night.to} Uhr höchstens ${ad.nightMaxPerSession} pro Spielsitzung. Eine neue Spielsitzung
      beginnt, wenn du ${SESSION.timeoutMinutes} Minuten nicht gespielt hast.</p>

    <h3>Statistik (nur mit Einwilligung)</h3>
    <p>Mit deiner Einwilligung erfassen wir zusätzlich Spielereignisse (Start und Ende eines Runs, besuchte Bildschirme,
      gestartete und beendete Werbung), ob du nach einer Werbepause weitergespielt oder einen Hinweis angenommen hast,
      wann und weshalb wir eine Werbepause oder einen Hinweis nicht gezeigt haben,
      Tageszeit und Wochentag deiner Spielsitzungen, Zeitzone, Gerätetyp, Betriebssystem,
      Browser-Familie, Sprache des Browsers, Bildschirmgrösse (nur grob in vier Stufen), ob du per Touch spielst,
      sowie Land und Kanton, die wir aus deiner IP-Adresse ableiten. Die IP-Adresse selbst speichern wir nicht.
      Kommst du über einen Link auf Wingrush, speichern wir ausserdem die Adresse der verweisenden Website (nur den Domainnamen,
      ohne Pfad) und allfällige Kampagnen-Angaben aus dem Link (utm_source, utm_medium, utm_campaign).</p>
    <p>Aus diesen Daten und deinen Runs berechnen wir ein Spielerprofil, zum Beispiel wann du üblicherweise spielst, wie aktiv
      du bist und zu welchen Gruppen du gehörst (etwa «spielt abends» oder «neu»). Dafür nutzen wir nur Daten ab deiner
      Einwilligung. So verstehen wir, wann und wie gespielt wird und wie Spielerinnen und Spieler zu Wingrush finden, und
      verbessern das Spiel.</p>

    <h3>Personalisierte Angebote (ab ${age} Jahren)</h3>
    <p>Nur wenn du Statistik erlaubst und bestätigst, dass du mindestens ${age} Jahre alt bist, stimmen wir Werbepausen und
      Hinweise auf dein Spielerprofil ab, immer innerhalb der oben genannten Obergrenzen. Zum Beispiel zeigen wir dir
      Werbepausen häufiger, wenn du nach Werbepausen meist weiterspielst, und seltener, wenn du danach oft aufhörst.
      Ausserhalb deiner üblichen Spielzeit zeigen wir weniger und nach einer längeren Spielpause keine Werbepausen. Als Gast
      erinnern wir dich unter Umständen früher ans Registrieren, passend zu deiner üblichen Sessionlänge. Wir geben keine
      Daten oder Gruppen an Werbenetzwerke weiter.</p>

    <h3>Was wir nicht erheben</h3>
    <p>Keine GPS-Daten, keine Stadt oder Koordinaten, keine gespeicherte IP-Adresse, keine vollständige Browser-Kennung,
      kein Fingerprinting und keine Werbe-IDs.</p>

    <h3>Speicherdauer</h3>
    <ul>
      <li>Gastkonten: ${ACCOUNT.guestRetentionHours} Stunden nach der letzten Aktivität</li>
      <li>Registrierte Konten: bis du sie löschst</li>
      <li>Spielereignisse: ${eventsDays} Tage</li>
      <li>Spielsitzungen: ${sessionsDays} Tage</li>
      <li>Entscheidungen zu Werbung und Hinweisen: ${decisionsDays} Tage</li>
      <li>Spielerprofile: ${profileMonths} Monate nach der letzten Aktivität</li>
      <li>Archiv gelöschter Konten: unbefristet</li>
    </ul>
    <p>Widerrufst du die Statistik-Einwilligung, löschen wir die zugehörigen Daten und dein Spielerprofil sofort.</p>
    <p>Wird ein Konto gelöscht, behalten wir ohne Benutzername und ohne Konto-Nummer in einem Archiv: den Grund und das Datum
      der Löschung, den ersten und letzten Spieltag, ob das Konto registriert war und Statistik erlaubt hatte, die Anzahl
      Spielsitzungen sowie insgesamt und pro Tag die Spielzeit und die Anzahl Runs, Spins, verdoppelter Belohnungen,
      Werbepausen und Hinweise (bei Hinweisen mit Grund und, sofern gespeichert, ob du sie angenommen hast).</p>
    <p>Nur wenn ein Gastkonto nach ${ACCOUNT.guestRetentionHours} Stunden ohne Aktivität abläuft und du Statistik erlaubt
      hattest, kommen Gerätetyp, Betriebssystem, Browser-Familie, Land, Kanton, die Verteilung deiner Spielzeit auf Wochentage
      und Stunden sowie deine Gruppen hinzu. In allen anderen Fällen speichern wir diese Zusatzangaben nicht: wenn du dein
      Konto selbst löschst, wenn wir es löschen oder wenn du dich als Gast mit einem bestehenden Konto anmeldest und das
      Gastkonto dadurch ersetzt wird.</p>

    <h3>Empfänger</h3>
    <p>Die Daten liegen bei unserem Hosting-Anbieter Infomaniak in der Schweiz. Infomaniak speichert technische Server-Logs.
      Land und Kanton bestimmen wir auf unserem eigenen Server mit einer Datenbank von DB-IP, deine IP-Adresse geht dabei
      nicht an DB-IP. Eine Weitergabe an weitere Dritte findet nicht statt.</p>

    <h3>Deine Rechte</h3>
    <p>Du hast nach dem Schweizer Datenschutzgesetz (DSG) das Recht auf Auskunft, Berichtigung und Löschung. Deine
      Einwilligung kannst du jederzeit im Konto ändern oder widerrufen, dort kannst du auch dein Konto und alle Daten
      löschen. Bei Fragen wende dich an die oben genannte Adresse. Du kannst dich ausserdem beim Eidgenössischen
      Datenschutz- und Öffentlichkeitsbeauftragten (EDÖB) beschweren.</p>

    <h3>Minderjährige</h3>
    <p>Unter ${age} Jahren gibt es keine personalisierten Angebote. Das Alter beruht auf deiner Selbstauskunft.</p>

    <h3>Änderungen</h3>
    <p>Dies ist Version ${PRIVACY.version}. Ändert sich die Datenschutzerklärung wesentlich, fragen wir dich erneut nach deiner Einwilligung.</p>

    <h3>Quellen</h3>
    <p><a href="https://db-ip.com" target="_blank" rel="noopener">IP Geolocation by DB-IP</a> (Lizenz CC BY 4.0)</p>`;
}
