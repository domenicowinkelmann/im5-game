export const COIN_TYPES = {
  bronze:  { value: 1,  color: '#c98a4b', label: 'Bronze' },
  silver:  { value: 5,  color: '#dfe6ee', label: 'Silber' },
  gold:    { value: 10, color: '#ffc83d', label: 'Gold' },
  diamond: { value: 50, color: '#7ff6ff', label: 'Diamant' },
};

export const MULTIPLIER = {
  nearDistance: 9,
  stepSeconds: 1.4,
  max: 5,
  resetDistance: 24,
  resetSeconds: 1.0,
};

export const TUNNEL_BONUS = 250;
export const STYLE_PER_SECOND = 15;

export const SPIN_COST = 100;
export const START_COINS = 150;

export const RARITY_ORDER = ['common', 'rare', 'epic', 'legendary'];
export const RARITIES = {
  common:    { label: 'Gewöhnlich', color: '#9aa7b8', weight: 110, refund: 15,  symbol: '🪂' },
  rare:      { label: 'Selten',     color: '#3fa7ff', weight: 25, refund: 40,  symbol: '🔥' },
  epic:      { label: 'Episch',     color: '#b46cff', weight: 7,  refund: 100, symbol: '⭐' },
  legendary: { label: 'Legendär',   color: '#ffb020', weight: 3,  refund: 300, symbol: '💎' },
};
export const SLOT = {
  nothing: { weight: 700 },
  pair: { weight: 150, min: 30, max: 70, highChance: 0.5, thirdReelMiss: 0.7 },
  jackpot: { weight: 5, amount: 300, symbol: '🪙' },
};
export const FILLER_SYMBOLS = ['🪙', '🦅', '🚁', '🍀'];
export const ALL_SYMBOLS = [...RARITY_ORDER.map((r) => RARITIES[r].symbol), ...FILLER_SYMBOLS];

export const CHUNK_LENGTH = 160;

export const RUN_LIMITS = {
  maxCoinsPerSecond: 80,
  coinBuffer: 500,
  bufferSeconds: 20,
  maxSpeed: 90,
  distanceBuffer: 50,
  maxDuration: 1800,
  minGapSeconds: 0.5,
  timeTolerance: 0.05,
};

export const DOUBLE = { minDelaySeconds: 3, windowSeconds: 900, maxPerDay: 20 };

export const PLAYTIME = { spinSeconds: 3, slotGapSeconds: 60 };

export const ACCOUNT = { usernamePattern: /^[A-Za-z0-9_.-]{3,20}$/, passwordMin: 8, passwordMax: 128, guestRetentionHours: 24 };

export const SESSION = { timeoutMinutes: 30, touchSeconds: 60 };

export const PRIVACY = {
  version: 1,
  personalMinAge: 16,
  minGroupSize: 5,
  retention: { eventsDays: 90, sessionsDays: 90, decisionsDays: 90, profileMonths: 12 },
};

export const ADS = {
  interstitial: {
    seconds: 5,
    graceSessions: 2,
    graceRuns: 5,
    earlySessions: 4,
    everyRunsEarly: 6,
    everyRuns: 4,
    minGapSeconds: 180,
    maxPerSession: 3,
    maxPerDay: 8,
    rewardedRestSeconds: 300,
    minRunSeconds: 8,
    night: { from: 0, to: 5 },
    nightMaxPerSession: 1,
    offDaypartMaxPerSession: 1,
    continueSeconds: 120,
  },
  personal: { tolerantEveryRuns: 3, tiredEveryRuns: 6 },
};

export const NUDGE = {
  maxPerSession: 1,
  maxPerDay: 2,
  minGapMinutes: 120,
  pauseAfterDismissals: 3,
  dismissWindowHours: 72,
  highscoreMinRuns: 2,
  returnMinSession: 2,
  returnWithinSeconds: 120,
  progressSeconds: 600,
  progressSessionShare: 0.5,
  progressMinSeconds: 180,
  progressMinSessions: 2,
};

export const ADMIN = {
  pageSize: 50,
  maxPage: 100000,
  recentRows: 50,
  maxQuery: 40,
  days: { overview: 30, activity: 90, engagement: 30, audience: 90, max: 365 },
  weeks: { retention: 12, max: 52 },
  retentionDays: [1, 7, 30],
  sessionBinsSeconds: [60, 180, 300, 600, 1200, 1800, 3600],
  scoreBins: 10,
};

export const PLACEMENTS = ['gameover', 'menu', 'slot_item'];
export const OUTCOMES = { clicked: 'nudge', dismissed: 'nudge', continued: 'interstitial', dropped: null };
export const STATS_OUTCOMES = ['clicked', 'continued'];

export const DAYPARTS = {
  morgens: { from: 5, to: 11 },
  mittags: { from: 11, to: 14 },
  nachmittags: { from: 14, to: 18 },
  abends: { from: 18, to: 22 },
  nachts: { from: 22, to: 5 },
};

export const SEGMENTS = {
  windowDays: 90,
  recentDays: 30,
  usualGapMinHours: 6,
  favHourSpan: 3,
  trendRuns: 10,
  engagement: { recency: 0.4, active: 0.35, play: 0.25, recencyHours: 168, activeDays: 15, playMinutes: 300 },
  churn: { minSessions: 2, gapFactor: 2 },
  adTolerance: { continued: 4, shown: 5 },
  neu: { maxSessions: 3, maxAgeHours: 48 },
  stamm: { activeDays30: 8, sessions: 6 },
  rueckkehrer: { pauseHours: 48, usualFactor: 3, sessions: 4 },
  abwanderung: { churn: 0.6, sessions: 3 },
  daypart: { share: 0.4, minMinutes: 30 },
  wochenende: { share: 0.6, activeDays: 4 },
  werbeMuede: { shown: 4, below: 0.55 },
  werbeTolerant: { shown: 6, atLeast: 0.9 },
  guestProgress: { runs: 3, extraItems: 1, coins: 500 },
  devices: { mobile: 'mobil', tablet: 'tablet', desktop: 'desktop' },
};

export const EVENTS = {
  run_start: [],
  run_end: ['accepted', 'duration', 'distance', 'cause'],
  rewarded_ad_start: ['placement'],
  rewarded_ad_complete: ['placement'],
  screen_view: ['screen'],
};

export const EVENT_LIMITS = { maxBytes: 2000, maxString: 40 };

export function cleanEvent(name, data) {
  if (typeof name !== 'string' || !Object.hasOwn(EVENTS, name)) return null;
  if (data != null && (typeof data !== 'object' || Array.isArray(data))) return null;
  const clean = {};
  for (const key of EVENTS[name]) {
    const v = data?.[key];
    if (typeof v === 'boolean') clean[key] = v;
    else if (typeof v === 'number' && Number.isFinite(v)) clean[key] = v;
    else if (typeof v === 'string') clean[key] = v.slice(0, EVENT_LIMITS.maxString);
  }
  return { name, data: Object.keys(clean).length ? clean : null };
}

export const CONTEXT = {
  screens: [['xs', 480], ['s', 768], ['m', 1200]],
  largeScreen: 'l',
  tzOffsetMax: 840,
  textMax: 40,
  hostMax: 100,
  timeZoneMax: 64,
  localeMax: 35,
};

export function screenClass(width) {
  const w = Number(width);
  if (!Number.isFinite(w) || w <= 0) return null;
  for (const [name, below] of CONTEXT.screens) if (w < below) return name;
  return CONTEXT.largeScreen;
}

const SCREEN_NAMES = [...CONTEXT.screens.map(([name]) => name), CONTEXT.largeScreen];
const TIME_ZONE = /^[A-Za-z][A-Za-z0-9_+\-/]*$/;
const LOCALE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/;
const HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

function contextText(v, max) {
  if (typeof v !== 'string') return null;
  const s = Array.from(v.replace(/\p{C}/gu, '').trim()).slice(0, max).join('').trim();
  return s || null;
}

function matching(v, pattern, max) {
  return typeof v === 'string' && v.length <= max && pattern.test(v) ? v : null;
}

export function cleanContext(input) {
  const c = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const utm = c.utm && typeof c.utm === 'object' && !Array.isArray(c.utm) ? c.utm : {};
  const host = typeof c.referrer === 'string' ? c.referrer.trim().toLowerCase() : null;
  return {
    tzOffset: Number.isInteger(c.tzOffset) && Math.abs(c.tzOffset) <= CONTEXT.tzOffsetMax ? c.tzOffset : null,
    timeZone: matching(c.timeZone, TIME_ZONE, CONTEXT.timeZoneMax),
    locale: matching(c.locale, LOCALE, CONTEXT.localeMax),
    screen: SCREEN_NAMES.includes(c.screen) ? c.screen : null,
    touch: typeof c.touch === 'boolean' ? c.touch : null,
    referrer: matching(host, HOST, CONTEXT.hostMax),
    utm: {
      source: contextText(utm.source, CONTEXT.textMax),
      medium: contextText(utm.medium, CONTEXT.textMax),
      campaign: contextText(utm.campaign, CONTEXT.textMax),
    },
  };
}
