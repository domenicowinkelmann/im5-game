import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { START_COINS, ACCOUNT, SESSION } from '../../src/shared/economy.js';

const KEY = 'wingrush.save.v1';
const HOUR = 3600000;
const MOCK = new URL('../../src/api/mockApi.js', import.meta.url);
const RUN = {
  distance: 1200, score: 1900, coins: 30, duration: 40, maxMultiplier: 2, tunnels: 1,
  cause: 'Baum erwischt', coinsByType: { bronze: 10, silver: 2, gold: 0, diamond: 0 },
};
const PROFILE_KEYS = ['bestDistance', 'coins', 'equipped', 'highscore', 'inventory', 'playTime', 'totalRuns', 'userId', 'username'];

const store = new Map();
const realNow = Date.now;
let now = realNow();
let loads = 0;

before(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)); },
      removeItem: (k) => { store.delete(k); },
    },
  });
  Date.now = () => now;
});

after(() => {
  Date.now = realNow;
  delete globalThis.localStorage;
});

const advance = (ms) => { now += ms; };
const saved = () => JSON.parse(store.get(KEY));

async function freshMock() {
  loads += 1;
  return (await import(`${MOCK.href}?load=${loads}`)).mockApi;
}

test('mock guest expires after the retention time and leaves a notice once', async () => {
  store.clear();
  const api = await freshMock();
  const first = await api.getMe();
  assert.deepEqual(Object.keys(first).sort(), PROFILE_KEYS);
  assert.equal(api.takeSessionNotice(), null);

  advance(60000);
  const run = await api.submitRun(RUN);
  assert.equal(run.profile.coins, START_COINS + RUN.coins);

  advance((ACCOUNT.guestRetentionHours - 1) * HOUR);
  const kept = await api.getMe();
  assert.equal(kept.userId, first.userId);
  assert.equal(kept.coins, START_COINS + RUN.coins);
  assert.equal(api.takeSessionNotice(), null);

  advance((ACCOUNT.guestRetentionHours + 1) * HOUR);
  const fresh = await api.getMe();
  assert.notEqual(fresh.userId, first.userId);
  assert.equal(fresh.coins, START_COINS);
  assert.equal(fresh.totalRuns, 0);
  assert.deepEqual(api.takeSessionNotice(), { wasGuest: true });
  assert.equal(api.takeSessionNotice(), null);
  assert.equal(saved().userId, fresh.userId);
});

test('mock guest that expired while the page was closed gets the notice on load', async () => {
  store.clear();
  const api = await freshMock();
  const old = await api.getMe();
  advance(60000);
  await api.submitRun(RUN);
  advance((ACCOUNT.guestRetentionHours + 1) * HOUR);
  const reloaded = await freshMock();
  assert.deepEqual(reloaded.takeSessionNotice(), { wasGuest: true });
  assert.notEqual((await reloaded.getMe()).userId, old.userId);
});

test('mock registered players never expire', async () => {
  store.clear();
  const api = await freshMock();
  await api.signup('Treu', 'geheim123');
  advance(30 * 24 * HOUR);
  const me = await api.getMe();
  assert.equal(me.username, 'Treu');
  assert.equal(api.takeSessionNotice(), null);
});

test('mock counts a new session after the idle timeout and throttles touches', async () => {
  store.clear();
  const api = await freshMock();
  await api.getMe();
  await api.trackEvent('menu_open');
  const start = saved();
  assert.equal(start.sessionNo, 1);

  advance((SESSION.touchSeconds - 10) * 1000);
  await api.getMe();
  assert.equal(saved().lastSeenAt, start.lastSeenAt);

  advance(2 * 60000);
  await api.getMe();
  assert.equal(saved().lastSeenAt, now);
  assert.equal(saved().sessionNo, 1);

  advance((SESSION.timeoutMinutes + 1) * 60000);
  await api.submitRun(RUN);
  const after = saved();
  assert.equal(after.sessionNo, 2);
  assert.equal(after.sessionStartedAt, now);
  assert.equal(after.runs[0].sessionNo, 2);
});
