export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const MSG = {
  unauthorized: 'Nicht angemeldet',
  badRequest: 'Ungültige Anfrage',
  tooLarge: 'Anfrage zu gross',
  notFound: 'Nicht gefunden',
  server: 'Serverfehler',
  tooMany: 'Zu viele Anfragen, bitte warte kurz',
  username: 'Benutzername: 3–20 Zeichen (A–Z, 0–9, _ . -)',
  password: 'Passwort: 8–128 Zeichen',
  usernameTaken: 'Benutzername vergeben',
  alreadyRegistered: 'Bereits angemeldet',
  badLogin: 'Benutzername oder Passwort falsch',
  runRejected: 'Run abgelehnt (unplausibel)',
  runNotFound: 'Run nicht gefunden',
  alreadyClaimed: 'Bereits eingelöst',
  nothingToDouble: 'Keine Münzen zum Verdoppeln',
  tooEarly: 'Werbung noch nicht fertig',
  expired: 'Angebot abgelaufen',
  dailyLimit: 'Tageslimit erreicht',
  notEnoughCoins: 'Zu wenig Münzen',
  notOwned: 'Item nicht im Besitz',
  badEvent: 'Ungültiges Ereignis',
  dbDown: 'Datenbank nicht erreichbar',
};
