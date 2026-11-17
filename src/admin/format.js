export const LOCALE = 'de-CH';
export const DASH = '–';

const numberFormats = new Map();
const percentFormats = new Map();

function numberFormat(digits) {
  if (!numberFormats.has(digits)) {
    numberFormats.set(digits, new Intl.NumberFormat(LOCALE, { maximumFractionDigits: digits }));
  }
  return numberFormats.get(digits);
}

const isNumber = (v) => v != null && v !== '' && Number.isFinite(Number(v));

export function formatNumber(v, digits = 0) {
  return isNumber(v) ? numberFormat(digits).format(Number(v)) : DASH;
}

export function formatPercent(rate, digits = 1) {
  if (!isNumber(rate)) return DASH;
  if (!percentFormats.has(digits)) {
    percentFormats.set(digits, new Intl.NumberFormat(LOCALE, { style: 'percent', maximumFractionDigits: digits }));
  }
  return percentFormats.get(digits).format(Number(rate));
}

const pad = (v) => String(v).padStart(2, '0');

export function formatDuration(seconds) {
  if (!isNumber(seconds)) return DASH;
  const s = Math.max(0, Math.round(Number(seconds)));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = s % 60;
  return h ? `${h}:${pad(m)}:${pad(rest)}` : `${m}:${pad(rest)}`;
}

export function formatHours(seconds, digits = 1) {
  return isNumber(seconds) ? `${formatNumber(Number(seconds) / 3600, digits)} h` : DASH;
}

const TIME_UNITS = [[3600, 'h'], [60, 'min'], [1, 's']];

export function durationAxis(maxSeconds) {
  const [seconds, unit] = TIME_UNITS.find(([size]) => Number(maxSeconds) >= size) ?? TIME_UNITS[TIME_UNITS.length - 1];
  return {
    unit,
    toUnit: (v) => (isNumber(v) ? Number(v) / seconds : null),
    format: (v) => (isNumber(v) ? formatDuration(Number(v) * seconds) : DASH),
    tick: (v, digits) => `${formatNumber(v, digits)} ${unit}`,
    integer: seconds === 1,
  };
}

function toDate(value) {
  if (value == null || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function dateFormat(options, timeZone) {
  return new Intl.DateTimeFormat(LOCALE, timeZone ? { ...options, timeZone } : options);
}

export function formatDate(value, { timeZone } = {}) {
  const d = toDate(value);
  return d ? dateFormat({ day: '2-digit', month: '2-digit', year: 'numeric' }, timeZone).format(d) : DASH;
}

export function formatDateTime(value, { timeZone } = {}) {
  const d = toDate(value);
  return d
    ? dateFormat({ day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }, timeZone).format(d)
    : DASH;
}

export function formatShortDate(value, { timeZone } = {}) {
  const d = toDate(value);
  return d ? dateFormat({ day: '2-digit', month: '2-digit' }, timeZone).format(d) : DASH;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function utcDay(day) {
  return typeof day === 'string' && DAY.test(day) ? toDate(`${day}T00:00:00Z`) : null;
}

export function formatDay(day) {
  const d = utcDay(day);
  return d ? dateFormat({ day: '2-digit', month: '2-digit' }, 'UTC').format(d) : DASH;
}

export function formatDayFull(day) {
  const d = utcDay(day);
  return d ? dateFormat({ day: '2-digit', month: '2-digit', year: 'numeric' }, 'UTC').format(d) : DASH;
}

export function formatDayLong(day) {
  const d = utcDay(day);
  return d ? dateFormat({ weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' }, 'UTC').format(d) : DASH;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export function formatSince(value, now = Date.now()) {
  const d = toDate(value);
  if (!d) return DASH;
  const minutes = Math.floor(Math.max(0, now - d.getTime()) / 60000);
  if (minutes < 1) return 'seit eben';
  if (minutes < 60) return `seit ${plural(minutes, 'Minute', 'Minuten')}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `seit ${plural(hours, 'Stunde', 'Stunden')}`;
  return `seit ${plural(Math.floor(hours / 24), 'Tag', 'Tagen')}`;
}

export const WEEKDAYS_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
export const WEEKDAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

export function formatHourRange(from, to) {
  return `${from}–${to} Uhr`;
}

export function formatSessionBin({ from, to }) {
  const min = (s) => formatNumber(s / 60, 1);
  return to == null ? `ab ${min(from)} min` : `${min(from)}–${min(to)} min`;
}

export function formatScoreBin({ from, to }, digits = 0) {
  return `${formatNumber(from, digits)}–${formatNumber(to, digits)}`;
}

export function formatTzOffset(minutes) {
  if (!isNumber(minutes)) return DASH;
  const m = Number(minutes);
  const sign = m < 0 ? '−' : '+';
  const abs = Math.abs(m);
  return `UTC${sign}${Math.floor(abs / 60)}${abs % 60 ? `:${pad(abs % 60)}` : ''}`;
}

export const playerName = (p) => p?.username ?? `Gast #${p?.id}`;

export const TYPE_LABELS = { guest: 'Gast', registered: 'Registriert', admin: 'Admin' };

export const CONSENT_FILTERS = { stats: 'Statistik ja', personal: 'Personalisiert ja', none: 'Ohne Statistik' };

export function consentText(c) {
  if (!c) return DASH;
  if (!c.decided) return 'Noch nicht entschieden';
  return `Statistik ${c.stats ? 'ja' : 'nein'}, Personal. ${c.personal ? 'ja' : 'nein'}`;
}

export const REASON_LABELS = {
  grace: 'Schonfrist',
  short_run: 'Run zu kurz',
  cooldown: 'Ruhe nach Verdoppeln',
  comeback: 'Rückkehr oder Abwanderung',
  session_cap: 'Limit pro Session',
  day_cap: 'Limit pro Tag',
  min_gap: 'Mindestabstand',
  interval: 'Intervall nicht erreicht',
  ok: 'Gezeigt',
  item: 'Neues Item',
  highscore: 'Neuer Highscore',
  return: 'Rückkehr ins Menü',
  progress: 'Spielfortschritt',
  paused: 'Pause nach «Später»',
  interstitial: 'Interstitial hatte Vorrang',
  no_progress: 'Kein Fortschritt',
  unknown: 'Unbekannt',
};

export const reasonLabel = (r) => REASON_LABELS[r] ?? r ?? DASH;

export const OUTCOME_LABELS = {
  clicked: 'Geklickt',
  dismissed: '«Später»',
  continued: 'Weitergespielt',
  dropped: 'Nicht angezeigt',
};

export const outcomeLabel = (o) => (o == null ? DASH : OUTCOME_LABELS[o] ?? o);

export const PLACEMENT_LABELS = { gameover: 'Game Over', menu: 'Menü', slot_item: 'Slot-Item' };
export const KIND_LABELS = { interstitial: 'Interstitial', nudge: 'Erinnerung' };
export const DEVICE_LABELS = { mobile: 'Mobil', tablet: 'Tablet', desktop: 'Desktop' };
export const SCREEN_LABELS = {
  xs: 'Sehr klein (unter 480 px)',
  s: 'Klein (480–767 px)',
  m: 'Mittel (768–1199 px)',
  l: 'Gross (ab 1200 px)',
};

export const CANTONS = {
  AG: 'Aargau', AI: 'Appenzell Innerrhoden', AR: 'Appenzell Ausserrhoden', BE: 'Bern', BL: 'Basel-Landschaft',
  BS: 'Basel-Stadt', FR: 'Freiburg', GE: 'Genf', GL: 'Glarus', GR: 'Graubünden', JU: 'Jura', LU: 'Luzern',
  NE: 'Neuenburg', NW: 'Nidwalden', OW: 'Obwalden', SG: 'St. Gallen', SH: 'Schaffhausen', SO: 'Solothurn',
  SZ: 'Schwyz', TG: 'Thurgau', TI: 'Tessin', UR: 'Uri', VD: 'Waadt', VS: 'Wallis', ZG: 'Zug', ZH: 'Zürich',
};

let regionNames = null;

export function countryName(code) {
  if (!code) return null;
  try {
    regionNames ??= new Intl.DisplayNames(LOCALE, { type: 'region' });
    return regionNames.of(code) ?? code;
  } catch (e) {
    return code;
  }
}

export function placeText(country, region) {
  if (!country) return 'Ort unbekannt';
  return region ? `${country}-${region}` : country;
}

const OTHER_VALUES = { os: 'Anderes System', browsers: 'Anderer Browser' };

export function audienceLabel(dimension, group) {
  if (group.other) return 'Andere (kleine Gruppen)';
  const v = group.value;
  if (v == null || v === '') return 'Unbekannt';
  if (v === 'other' && OTHER_VALUES[dimension]) return OTHER_VALUES[dimension];
  if (dimension === 'countries') return `${countryName(v)} (${v})`;
  if (dimension === 'regions') return CANTONS[v] ? `${CANTONS[v]} (${v})` : v;
  if (dimension === 'devices') return DEVICE_LABELS[v] ?? v;
  if (dimension === 'screens') return SCREEN_LABELS[v] ?? v;
  return String(v);
}

export function deviceText(s) {
  const parts = [DEVICE_LABELS[s?.device] ?? s?.device, s?.os, s?.browser].filter(Boolean);
  return parts.length ? parts.join(' / ') : DASH;
}

export function clampInt(value, fallback, min, max) {
  const v = Number(value);
  if (!Number.isInteger(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

export function pageRange(page, total, pageSize) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = clampInt(page, 1, 1, pages);
  const to = Math.min(total, current * pageSize);
  const from = total ? Math.min((current - 1) * pageSize + 1, to) : 0;
  return { current, pages, from, to };
}
