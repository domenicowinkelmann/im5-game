import { ITEMS, DEFAULT_LOADOUT, getItem } from '../shared/items.js';
import {
  SPIN_COST, START_COINS, DOUBLE, ACCOUNT, PLAYTIME, SESSION, PRIVACY, ADS, NUDGE, PLACEMENTS, OUTCOMES, STATS_OUTCOMES,
  cleanEvent, cleanContext,
} from '../shared/economy.js';
import { rollSpin, spinResult } from '../shared/slots.js';
import { validateRun, fitsElapsed } from '../shared/runs.js';
import { decide } from '../shared/engagement.js';

const KEY = 'wingrush.save.v1';
const HOUR_MS = 3600000;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const CONTEXT_KEYS = ['tzOffset', 'timeZone', 'locale', 'screen', 'touch'];
const MAX_SESSIONS = 50;
const MAX_SKIPPED_DECISIONS = 200;
const DEFAULT_ITEM_COUNT = ITEMS.filter((i) => i.default).length;

function freshState() {
  const now = Date.now();
  return {
    userId: 'guest-' + Math.random().toString(36).slice(2, 10),
    username: null,
    coins: START_COINS,
    highscore: 0,
    bestDistance: 0,
    totalRuns: 0,
    playFlightMs: 0,
    playSlotMs: 0,
    inventory: ITEMS.filter((i) => i.default).map((i) => i.id),
    equipped: { ...DEFAULT_LOADOUT },
    createdAt: now,
    registeredAt: null,
    lastSeenAt: now,
    sessionNo: 1,
    sessionStartedAt: now,
    lastRunAt: null,
    runs: [],
    spins: [],
    events: [],
    playSessions: [],
    decisions: [],
    decisionSeq: 0,
    tzOffset: null,
    consent: { version: 0, stats: false, personal: false, adult: false, statsAt: null },
  };
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...freshState(), ...JSON.parse(raw) };
  } catch (e) {}
  return freshState();
}

let state = load();
let notice = null;

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
}

function touch() {
  const now = Date.now();
  const idle = now - state.lastSeenAt;
  if (!state.username && idle > ACCOUNT.guestRetentionHours * HOUR_MS) {
    state = freshState();
    notice = { wasGuest: true };
    persist();
    return;
  }
  if (idle < SESSION.touchSeconds * 1000) return;
  if (idle >= SESSION.timeoutMinutes * 60000) {
    state.sessionNo += 1;
    state.sessionStartedAt = now;
    if (state.consent.stats) carryContext(now);
  } else if (state.consent.stats) {
    const current = currentSession();
    if (current) current.lastActiveAt = now;
  }
  state.lastSeenAt = now;
  persist();
}

function currentSession() {
  return state.playSessions.find((s) => s.sessionNo === state.sessionNo) ?? null;
}

function carryContext(now) {
  if (currentSession()) return;
  const prev = state.playSessions.find((s) => s.sessionNo < state.sessionNo);
  const row = { sessionNo: state.sessionNo, startedAt: state.sessionStartedAt, lastActiveAt: now };
  for (const key of CONTEXT_KEYS) row[key] = prev?.[key] ?? null;
  row.tzOffset ??= state.tzOffset;
  row.referrer = null;
  row.utm = { source: null, medium: null, campaign: null };
  state.playSessions.unshift(row);
  state.playSessions = state.playSessions.slice(0, MAX_SESSIONS);
}

touch();
persist();

function profile() {
  return {
    userId: state.userId,
    username: state.username ?? null,
    coins: state.coins,
    highscore: state.highscore,
    bestDistance: state.bestDistance,
    totalRuns: state.totalRuns,
    playTime: {
      flight: Math.floor(state.playFlightMs / 1000),
      slots: Math.floor(state.playSlotMs / 1000),
      total: Math.floor((state.playFlightMs + state.playSlotMs) / 1000),
    },
    inventory: [...state.inventory],
    equipped: { ...state.equipped },
    consent: {
      decided: state.consent.version === PRIVACY.version,
      stats: state.consent.stats,
      personal: state.consent.personal,
      adult: state.consent.adult,
    },
  };
}

const rng = (n) => Math.floor(Math.random() * n);

function cleanFacts(facts) {
  const f = facts !== null && typeof facts === 'object' && !Array.isArray(facts) ? facts : {};
  return {
    hour: Number.isInteger(f.hour) && f.hour >= 0 && f.hour <= 23 ? f.hour : null,
    newHighscore: f.newHighscore === true,
    newItem: f.newItem === true,
  };
}

function decisionCounts(kind, now) {
  const shown = state.decisions.filter((d) => d.shown && d.kind === kind);
  const last = shown.reduce((max, d) => Math.max(max, d.at), -Infinity);
  const dismissWindow = NUDGE.dismissWindowHours * HOUR_MS;
  return {
    session: shown.filter((d) => d.sessionNo === state.sessionNo).length,
    day: shown.filter((d) => now - d.at < 24 * HOUR_MS).length,
    secondsAgo: last === -Infinity ? null : Math.floor((now - last) / 1000),
    last: last === -Infinity ? null : last,
    dismissed: shown.filter((d) => d.outcome === 'dismissed' && now - d.at < dismissWindow).length,
  };
}

function engageContext(facts, now) {
  const consent = state.consent;
  const ads = decisionCounts('interstitial', now);
  const nudges = decisionCounts('nudge', now);
  const doubled = state.runs.reduce((max, r) => Math.max(max, r.doubledAt ?? -Infinity), -Infinity);
  return {
    consent: { decided: consent.version === PRIVACY.version, stats: consent.stats, personal: consent.personal },
    guest: !state.username,
    hour: facts.hour,
    sessionNo: state.sessionNo,
    sessionSeconds: Math.floor((now - state.sessionStartedAt) / 1000),
    runs: state.totalRuns,
    playSeconds: Math.floor((state.playFlightMs + state.playSlotMs) / 1000),
    coins: state.coins,
    extraItems: Math.max(0, state.inventory.length - DEFAULT_ITEM_COUNT),
    lastRunSeconds: state.runs[0]?.duration ?? null,
    rewardedSecondsAgo: doubled === -Infinity ? null : Math.floor((now - doubled) / 1000),
    interstitials: {
      session: ads.session,
      day: ads.day,
      secondsAgo: ads.secondsAgo,
      runsSince: ads.last === null ? state.totalRuns : state.runs.filter((r) => r.at > ads.last).length,
    },
    nudges: { session: nudges.session, day: nudges.day, secondsAgo: nudges.secondsAgo, dismissed: nudges.dismissed },
    segments: [],
    avgSessionSeconds: null,
    facts: { newHighscore: facts.newHighscore, newItem: facts.newItem },
  };
}

function logDecision(placement, entry, shown, now) {
  state.decisionSeq += 1;
  state.decisions.unshift({
    id: state.decisionSeq,
    sessionNo: state.sessionNo,
    placement,
    kind: entry.kind,
    shown,
    reason: entry.reason,
    personalized: !!entry.personalized,
    outcome: null,
    outcomeAt: null,
    at: now,
  });
  return state.decisionSeq;
}

function pruneDecisions(now) {
  const maxAge = PRIVACY.retention.decisionsDays * 24 * HOUR_MS;
  let skipped = 0;
  state.decisions = state.decisions.filter((d) => now - d.at < maxAge && (d.shown || ++skipped <= MAX_SKIPPED_DECISIONS));
}

export const mockApi = {
  async getMe() {
    touch();
    await wait(60);
    return profile();
  },

  async submitRun(payload) {
    touch();
    await wait(150);
    const run = validateRun(payload);
    const elapsed = (Date.now() - (state.lastRunAt ?? state.createdAt)) / 1000;
    if (!run || !fitsElapsed(run.duration, elapsed)) throw new Error('Run abgelehnt (unplausibel)');
    const runId = 'run-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const newHighscore = run.score > state.highscore;
    state.coins += run.coins;
    state.totalRuns += 1;
    state.playFlightMs += Math.round(run.duration * 1000);
    state.highscore = Math.max(state.highscore, run.score);
    state.bestDistance = Math.max(state.bestDistance, run.distance);
    state.lastRunAt = Date.now();
    state.runs.unshift({ runId, ...run, doubled: false, at: state.lastRunAt, sessionNo: state.sessionNo });
    state.runs = state.runs.slice(0, 30);
    persist();
    return { runId, newHighscore, profile: profile() };
  },

  async claimDouble(runId) {
    touch();
    await wait(120);
    const r = state.runs.find((x) => x.runId === runId);
    if (!r) throw new Error('Run nicht gefunden');
    if (r.doubled) throw new Error('Bereits eingelöst');
    if (r.coins <= 0) throw new Error('Keine Münzen zum Verdoppeln');
    const age = (Date.now() - r.at) / 1000;
    if (age < DOUBLE.minDelaySeconds) throw new Error('Werbung noch nicht fertig');
    if (age > DOUBLE.windowSeconds) throw new Error('Angebot abgelaufen');
    const today = state.runs.filter((x) => x.doubledAt && Date.now() - x.doubledAt < 86400000).length;
    if (today >= DOUBLE.maxPerDay) throw new Error('Tageslimit erreicht');
    r.doubledAt = Date.now();
    r.doubled = true;
    state.coins += r.coins;
    persist();
    return { profile: profile() };
  },

  async spin() {
    touch();
    await wait(180);
    if (state.coins < SPIN_COST) throw new Error('Zu wenig Münzen');
    state.coins -= SPIN_COST;
    const gap = state.spins.length ? Date.now() - state.spins[0].at : Infinity;
    const slotMs = gap <= PLAYTIME.slotGapSeconds * 1000 ? gap : PLAYTIME.spinSeconds * 1000;
    state.playSlotMs += slotMs;
    const spin = rollSpin(rng);
    const { result, delta, newItem } = spinResult(spin, state.inventory);
    state.coins += delta;
    if (newItem) state.inventory.push(newItem);
    const { outcome, reels } = spin;
    state.spins.unshift({ at: Date.now(), outcome, reels, slotMs, sessionNo: state.sessionNo });
    state.spins = state.spins.slice(0, 50);
    persist();
    return { reels, result, profile: profile() };
  },

  async equip(itemId) {
    touch();
    await wait(60);
    const item = getItem(itemId);
    if (!item || !state.inventory.includes(itemId)) throw new Error('Item nicht im Besitz');
    state.equipped[item.category] = itemId;
    persist();
    return { profile: profile() };
  },

  async trackEvent(name, data) {
    touch();
    const event = cleanEvent(name, data);
    if (!event || !state.consent.stats) return;
    state.events.unshift({ ...event, at: Date.now() });
    state.events = state.events.slice(0, 200);
    persist();
  },

  async startSession(context) {
    touch();
    await wait(30);
    if (!state.consent.stats) return { ok: true };
    const ctx = cleanContext(context);
    const now = Date.now();
    let row = currentSession();
    if (!row) {
      row = { sessionNo: state.sessionNo, startedAt: state.sessionStartedAt, referrer: null, utm: { source: null, medium: null, campaign: null } };
      for (const key of CONTEXT_KEYS) row[key] = null;
      state.playSessions.unshift(row);
      state.playSessions = state.playSessions.slice(0, MAX_SESSIONS);
    }
    for (const key of [...CONTEXT_KEYS, 'referrer']) row[key] = ctx[key] ?? row[key];
    for (const key of Object.keys(ctx.utm)) row.utm[key] = ctx.utm[key] ?? row.utm[key];
    row.lastActiveAt = now;
    if (ctx.tzOffset !== null) state.tzOffset = ctx.tzOffset;
    persist();
    return { ok: true };
  },

  async engage(placement, facts) {
    touch();
    await wait(60);
    if (!PLACEMENTS.includes(placement)) throw new Error('Ungültige Anfrage');
    const now = Date.now();
    const ctx = engageContext(cleanFacts(facts), now);
    const d = decide(placement, ctx);
    const out = { interstitial: null, nudge: null };
    if (d.interstitial) {
      const id = logDecision(placement, { kind: 'interstitial', ...d.interstitial }, true, now);
      out.interstitial = { id, seconds: ADS.interstitial.seconds };
    }
    if (d.nudge) {
      const id = logDecision(placement, { kind: 'nudge', ...d.nudge }, true, now);
      out.nudge = { id, reason: d.nudge.reason };
    }
    if (ctx.consent.stats) for (const entry of d.skipped) logDecision(placement, entry, false, now);
    pruneDecisions(now);
    persist();
    return out;
  },

  async engageOutcome(id, outcome) {
    touch();
    await wait(30);
    const d = state.decisions.find((x) => x.id === Number(id));
    if (!d || !d.shown || d.outcome !== null || !Object.hasOwn(OUTCOMES, outcome)) return undefined;
    if (OUTCOMES[outcome] !== null && OUTCOMES[outcome] !== d.kind) return undefined;
    const stats = state.consent.stats;
    if (outcome === 'dropped' && !stats) state.decisions = state.decisions.filter((x) => x !== d);
    else if (outcome === 'dropped') Object.assign(d, { shown: false, outcome, outcomeAt: Date.now() });
    else if (stats || !STATS_OUTCOMES.includes(outcome)) Object.assign(d, { outcome, outcomeAt: Date.now() });
    persist();
    return { ok: true };
  },

  async setConsent({ stats, personal, adult } = {}) {
    touch();
    await wait(60);
    if (![stats, personal, adult].every((v) => typeof v === 'boolean')) throw new Error('Ungültige Anfrage');
    const was = state.consent.stats;
    state.consent = {
      version: PRIVACY.version,
      stats,
      personal: personal && stats && adult,
      adult,
      statsAt: !stats ? null : was ? state.consent.statsAt : Date.now(),
    };
    if (!stats && was) {
      state.events = [];
      state.playSessions = [];
      state.decisions = state.decisions
        .filter((d) => d.shown)
        .map((d) => (STATS_OUTCOMES.includes(d.outcome) ? { ...d, outcome: null, outcomeAt: null } : d));
      state.tzOffset = null;
    }
    persist();
    return { profile: profile() };
  },

  async deleteAccount(password) {
    touch();
    await wait(120);
    if (state.username && !password) throw new Error('Passwort falsch');
    state = freshState();
    persist();
    return { profile: profile() };
  },

  async signup(username, password) {
    touch();
    await wait(120);
    const name = String(username ?? '').trim();
    if (!ACCOUNT.usernamePattern.test(name)) throw new Error('Benutzername: 3–20 Zeichen (A–Z, 0–9, _ . -)');
    if (password.length < ACCOUNT.passwordMin || password.length > ACCOUNT.passwordMax) throw new Error('Passwort: 8–128 Zeichen');
    if (state.username) throw new Error('Bereits angemeldet');
    state.username = name;
    state.registeredAt = Date.now();
    persist();
    return { profile: profile() };
  },

  async login() {
    touch();
    await wait(120);
    throw new Error('Nur mit Server verfügbar');
  },

  async logout() {
    touch();
    state = freshState();
    persist();
    return { profile: profile() };
  },

  async resetSave() {
    touch();
    state = freshState();
    persist();
    return profile();
  },

  takeSessionNotice() {
    const n = notice;
    notice = null;
    return n;
  },
};
