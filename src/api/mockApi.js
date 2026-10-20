import { ITEMS, DEFAULT_LOADOUT, getItem } from '../shared/items.js';
import { SPIN_COST, START_COINS, RUN_LIMITS, DOUBLE, ACCOUNT, PLAYTIME } from '../shared/economy.js';
import { rollSpin, spinResult } from '../shared/slots.js';

const KEY = 'wingrush.save.v1';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function freshState() {
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
    runs: [],
    spins: [],
    events: [],
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

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
}

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
  };
}

const rng = (n) => Math.floor(Math.random() * n);

export const mockApi = {
  async getMe() {
    await wait(60);
    return profile();
  },

  async submitRun(run) {
    await wait(150);
    const dur = Math.max(1, run.duration);
    if (run.coins > dur * RUN_LIMITS.maxCoinsPerSecond + RUN_LIMITS.coinBuffer ||
        run.distance > dur * RUN_LIMITS.maxSpeed + 50) {
      throw new Error('Run abgelehnt (unplausibel)');
    }
    const runId = 'run-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const newHighscore = run.score > state.highscore;
    state.coins += run.coins;
    state.totalRuns += 1;
    state.playFlightMs += Math.round(run.duration * 1000);
    state.highscore = Math.max(state.highscore, run.score);
    state.bestDistance = Math.max(state.bestDistance, run.distance);
    state.runs.unshift({ runId, ...run, doubled: false, at: Date.now() });
    state.runs = state.runs.slice(0, 30);
    persist();
    return { runId, newHighscore, profile: profile() };
  },

  async claimDouble(runId) {
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
    await wait(180);
    if (state.coins < SPIN_COST) throw new Error('Zu wenig Münzen');
    state.coins -= SPIN_COST;
    const gap = state.spins.length ? Date.now() - state.spins[0].at : Infinity;
    state.playSlotMs += gap <= PLAYTIME.slotGapSeconds * 1000 ? gap : PLAYTIME.spinSeconds * 1000;
    const spin = rollSpin(rng);
    const { result, delta, newItem } = spinResult(spin, state.inventory);
    state.coins += delta;
    if (newItem) state.inventory.push(newItem);
    const { outcome, reels } = spin;
    state.spins.unshift({ at: Date.now(), outcome, reels });
    state.spins = state.spins.slice(0, 50);
    persist();
    return { reels, result, profile: profile() };
  },

  async equip(itemId) {
    await wait(60);
    const item = getItem(itemId);
    if (!item || !state.inventory.includes(itemId)) throw new Error('Item nicht im Besitz');
    state.equipped[item.category] = itemId;
    persist();
    return { profile: profile() };
  },

  async trackEvent(name, data = {}) {
    state.events.unshift({ name, data, at: Date.now() });
    state.events = state.events.slice(0, 200);
    persist();
  },

  async signup(username, password) {
    await wait(120);
    const name = String(username ?? '').trim();
    if (!ACCOUNT.usernamePattern.test(name)) throw new Error('Benutzername: 3–20 Zeichen (A–Z, 0–9, _ . -)');
    if (password.length < ACCOUNT.passwordMin || password.length > ACCOUNT.passwordMax) throw new Error('Passwort: 8–128 Zeichen');
    if (state.username) throw new Error('Bereits angemeldet');
    state.username = name;
    persist();
    return { profile: profile() };
  },

  async login() {
    await wait(120);
    throw new Error('Nur mit Server verfügbar');
  },

  async logout() {
    state = freshState();
    persist();
    return { profile: profile() };
  },

  async resetSave() {
    state = freshState();
    persist();
    return profile();
  },
};
