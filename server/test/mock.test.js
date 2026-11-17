import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { START_COINS, ACCOUNT, SESSION, PRIVACY, ADS } from '../../src/shared/economy.js';

const KEY = 'wingrush.save.v1';
const HOUR = 3600000;
const MOCK = new URL('../../src/api/mockApi.js', import.meta.url);
const RUN = {
  distance: 1200, score: 1900, coins: 30, duration: 40, maxMultiplier: 2, tunnels: 1,
  cause: 'Baum erwischt', coinsByType: { bronze: 10, silver: 2, gold: 0, diamond: 0 },
};
const PROFILE_KEYS = ['bestDistance', 'coins', 'consent', 'equipped', 'highscore', 'inventory', 'playTime', 'totalRuns', 'userId', 'username'];

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

test('mock profile starts undecided and consent follows the server rules', async () => {
  store.clear();
  const api = await freshMock();
  const me = await api.getMe();
  assert.deepEqual(me.consent, { decided: false, stats: false, personal: false, adult: false });
  await assert.rejects(api.setConsent({ stats: 1, personal: false, adult: false }), { message: 'Ungültige Anfrage' });

  const noAge = await api.setConsent({ stats: true, personal: true, adult: false });
  assert.deepEqual(Object.keys(noAge).sort(), ['profile']);
  assert.deepEqual(Object.keys(noAge.profile).sort(), PROFILE_KEYS);
  assert.deepEqual(noAge.profile.consent, { decided: true, stats: true, personal: false, adult: false });
  assert.equal(saved().consent.version, PRIVACY.version);
  const statsAt = saved().consent.statsAt;
  assert.equal(statsAt, now);
  advance(5000);
  await api.setConsent({ stats: true, personal: true, adult: true });
  assert.equal(saved().consent.statsAt, statsAt);
  assert.equal(saved().consent.personal, true);
});

test('mock stores events only with consent, from the allowlist and reduced', async () => {
  store.clear();
  const api = await freshMock();
  await api.getMe();
  await api.trackEvent('run_start');
  assert.equal(saved().events.length, 0);

  await api.setConsent({ stats: true, personal: false, adult: false });
  await api.trackEvent('run_end', { accepted: true, duration: 40, distance: 1200, cause: 'Baum', score: 9, newHighscore: true });
  await api.trackEvent('new_highscore', { score: 9 });
  await api.trackEvent('screen_view', { screen: 'menu' });
  const events = saved().events;
  assert.deepEqual(events.map((e) => e.name), ['screen_view', 'run_end']);
  assert.deepEqual(events[1].data, { accepted: true, duration: 40, distance: 1200, cause: 'Baum' });

  const res = await api.setConsent({ stats: false, personal: false, adult: false });
  assert.deepEqual(res.profile.consent, { decided: true, stats: false, personal: false, adult: false });
  assert.deepEqual(saved().events, []);
  assert.equal(saved().consent.statsAt, null);
  await api.trackEvent('run_start');
  assert.deepEqual(saved().events, []);
});

test('mock deleteAccount resets the save and asks registered players for a password', async () => {
  store.clear();
  const api = await freshMock();
  const old = await api.getMe();
  await api.setConsent({ stats: true, personal: false, adult: true });
  advance(60000);
  await api.submitRun(RUN);
  const res = await api.deleteAccount();
  assert.deepEqual(Object.keys(res), ['profile']);
  assert.notEqual(res.profile.userId, old.userId);
  assert.equal(res.profile.coins, START_COINS);
  assert.equal(res.profile.consent.decided, false);
  assert.equal(saved().userId, res.profile.userId);

  await api.signup('Weg', 'geheim123');
  await assert.rejects(api.deleteAccount(''), { message: 'Passwort falsch' });
  assert.equal((await api.getMe()).username, 'Weg');
  const gone = await api.deleteAccount('geheim123');
  assert.equal(gone.profile.username, null);
  assert.equal(api.takeSessionNotice(), null);
});

const CONTEXT = {
  tzOffset: 60, timeZone: 'Europe/Zurich', locale: 'de-CH', screen: 's', touch: true,
  referrer: 'www.google.ch', utm: { source: 'insta', medium: null, campaign: null },
};

test('mock startSession stores the context only with stats consent', async () => {
  store.clear();
  const api = await freshMock();
  await api.getMe();
  assert.deepEqual(await api.startSession(CONTEXT), { ok: true });
  assert.deepEqual(saved().playSessions, []);
  assert.equal(saved().tzOffset, null);

  await api.setConsent({ stats: true, personal: false, adult: true });
  assert.deepEqual(await api.startSession({ ...CONTEXT, tzOffset: 9999, screen: 'xl' }), { ok: true });
  let [row] = saved().playSessions;
  assert.equal(row.sessionNo, saved().sessionNo);
  assert.equal(row.startedAt, saved().sessionStartedAt);
  assert.deepEqual([row.tzOffset, row.screen, row.referrer, row.utm.source], [null, null, 'www.google.ch', 'insta']);

  await api.startSession({ ...CONTEXT, referrer: null, utm: null });
  assert.equal(saved().playSessions.length, 1);
  [row] = saved().playSessions;
  assert.deepEqual([row.tzOffset, row.screen, row.referrer, row.utm.source], [60, 's', 'www.google.ch', 'insta']);
  assert.equal(saved().tzOffset, 60);
});

test('mock carries the context into a new session and clears it on withdrawal', async () => {
  store.clear();
  const api = await freshMock();
  await api.setConsent({ stats: true, personal: false, adult: true });
  await api.startSession(CONTEXT);
  advance((SESSION.timeoutMinutes + 1) * 60000);
  await api.getMe();
  const [second, first] = saved().playSessions;
  assert.deepEqual([first.sessionNo, second.sessionNo], [1, 2]);
  assert.equal(second.startedAt, now);
  assert.deepEqual([second.tzOffset, second.locale, second.screen, second.touch], [60, 'de-CH', 's', true]);
  assert.equal(second.referrer, null);
  assert.deepEqual(second.utm, { source: null, medium: null, campaign: null });

  advance(2 * 60000);
  await api.getMe();
  assert.equal(saved().playSessions[0].lastActiveAt, now);

  await api.setConsent({ stats: false, personal: false, adult: true });
  assert.deepEqual(saved().playSessions, []);
  assert.equal(saved().tzOffset, null);
  advance((SESSION.timeoutMinutes + 1) * 60000);
  await api.getMe();
  assert.deepEqual(saved().playSessions, []);
});

test('mock engage follows the grace period, the interval and logs like the server', async () => {
  store.clear();
  const api = await freshMock();
  await api.getMe();
  const I = ADS.interstitial;
  const play = async (count) => {
    for (let i = 0; i < count; i++) {
      advance(RUN.duration * 1000 + 5000);
      await api.submitRun(RUN);
    }
  };
  await play(I.everyRunsEarly);
  assert.deepEqual(await api.engage('gameover', { hour: 15 }), { interstitial: null, nudge: null });
  assert.equal(saved().decisions.length, 0);
  await assert.rejects(api.engage('shop', {}), { message: 'Ungültige Anfrage' });

  await api.setConsent({ stats: true, personal: false, adult: true });
  for (let session = 1; session <= I.graceSessions; session++) {
    assert.equal((await api.engage('gameover', { hour: 15 })).interstitial, null);
    advance((SESSION.timeoutMinutes + 1) * 60000);
    await play(1);
  }
  assert.equal(saved().sessionNo, I.graceSessions + 1);
  const shown = await api.engage('gameover', { hour: 15 });
  assert.deepEqual(Object.keys(shown.interstitial).sort(), ['id', 'seconds']);
  assert.equal(shown.interstitial.seconds, I.seconds);
  assert.deepEqual(await api.engageOutcome(shown.interstitial.id, 'continued'), { ok: true });
  assert.equal(await api.engageOutcome(shown.interstitial.id, 'continued'), undefined);

  await play(I.everyRunsEarly - 1);
  assert.equal((await api.engage('gameover', { hour: 15 })).interstitial, null);
  await play(1);
  assert.ok((await api.engage('gameover', { hour: 15 })).interstitial);

  const log = saved().decisions.filter((d) => d.kind === 'interstitial').reverse().map((d) => [d.shown, d.reason]);
  assert.deepEqual(log, [[false, 'grace'], [false, 'grace'], [true, 'ok'], [false, 'interval'], [true, 'ok']]);
  assert.equal(saved().decisions.find((d) => d.id === shown.interstitial.id).outcome, 'continued');

  await api.setConsent({ stats: false, personal: false, adult: true });
  assert.deepEqual(saved().decisions.map((d) => [d.shown, d.reason, d.outcome]), [[true, 'ok', null], [true, 'ok', null]]);
  assert.equal((await api.engage('gameover', { hour: 15 })).interstitial, null);
  await api.setConsent({ stats: false, personal: false, adult: true });
  assert.equal(saved().decisions.length, 2);
  assert.equal((await api.engage('gameover', { hour: 15 })).interstitial, null);
});

test('mock drops undisplayed decisions like the server and prunes only skipped ones by count', async () => {
  store.clear();
  const api = await freshMock();
  await api.getMe();
  const I = ADS.interstitial;
  store.set(KEY, JSON.stringify({
    ...saved(), sessionNo: I.graceSessions + 1, totalRuns: I.everyRunsEarly, runs: [{ duration: 30, at: now - 600000 }],
    consent: { version: PRIVACY.version, stats: false, personal: false, adult: true, statsAt: null },
  }));
  let mock = await freshMock();
  const hidden = (await mock.engage('gameover', { hour: 15 })).interstitial;
  assert.deepEqual(await mock.engageOutcome(hidden.id, 'dropped'), { ok: true });
  assert.deepEqual(saved().decisions, []);

  await mock.setConsent({ stats: true, personal: false, adult: true });
  const first = (await mock.engage('gameover', { hour: 15 })).interstitial;
  assert.equal(await mock.engageOutcome(first.id, 'gewonnen'), undefined);
  assert.deepEqual(await mock.engageOutcome(first.id, 'dropped'), { ok: true });
  assert.equal(await mock.engageOutcome(first.id, 'continued'), undefined);
  assert.deepEqual(saved().decisions.map((d) => [d.shown, d.outcome]), [[false, 'dropped']]);
  const second = (await mock.engage('gameover', { hour: 15 })).interstitial;
  assert.ok(second);
  assert.deepEqual(await mock.engageOutcome(second.id, 'continued'), { ok: true });
  assert.equal(await mock.engageOutcome(second.id, 'dropped'), undefined);

  for (let i = 0; i < 250; i++) {
    advance(60000);
    await mock.engage('gameover', { hour: 15 });
  }
  assert.equal(saved().decisions.filter((d) => !d.shown).length, 200);
  assert.ok(saved().decisions.some((d) => d.id === second.id && d.shown));

  const maxAge = PRIVACY.retention.decisionsDays * 24 * HOUR;
  const aged = saved();
  aged.decisions.find((d) => d.id === second.id).at = now - maxAge - 1;
  store.set(KEY, JSON.stringify(aged));
  mock = await freshMock();
  await mock.engage('gameover', { hour: 15 });
  assert.ok(!saved().decisions.some((d) => d.id === second.id));
});
