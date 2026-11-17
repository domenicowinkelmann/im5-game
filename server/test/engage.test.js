import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { startServer } from './helpers.js';
import { asJson } from '../src/db.js';
import { cleanupGuests } from '../src/cleanup.js';
import { refreshProfile } from '../src/analytics/profiles.js';
import { purgeRaw } from '../src/analytics/purge.js';
import { ADS, NUDGE, PRIVACY } from '../../src/shared/economy.js';

const I = ADS.interstitial;
const ITEM = 'suit_glacier';
const MOCK = new URL('../../src/api/mockApi.js', import.meta.url);

let app;
const store = new Map();

before(async () => {
  app = await startServer();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)); },
      removeItem: (k) => { store.delete(k); },
    },
  });
});

after(async () => {
  delete globalThis.localStorage;
  await app.stop();
});

const sql = (query, params = []) => app.pool.query(query, params);

async function guest(flags = {}) {
  const res = await app.call('POST', '/auth/guest', { body: {} });
  assert.equal(res.status, 200);
  const token = res.body.token;
  if (flags !== null) assert.equal((await app.consent(token, flags)).status, 200);
  return { token, uid: Number(res.body.profile.userId) };
}

async function addRuns(uid, count, { session = 1, seconds = 30, minutesAgo = 0 } = {}) {
  for (let i = 0; i < count; i++) {
    await sql(
      `INSERT INTO runs (public_id, user_id, session_no, distance, score, coins, duration_ms, max_multiplier, tunnels, cause, coins_by_type, created_at)
       VALUES (?, ?, ?, 1000, 1500, 10, ?, 1, 0, '', '{}', NOW(3) - INTERVAL ? MINUTE + INTERVAL ? MICROSECOND)`,
      [randomBytes(16).toString('base64url'), uid, session, seconds * 1000, minutesAgo, i * 1000]);
  }
  await sql(
    `UPDATE users SET total_runs = total_runs + ?, play_flight_ms = play_flight_ms + ? WHERE id = ?`,
    [count, count * seconds * 1000, uid]);
}

async function age(uid, minutes) {
  await sql('UPDATE runs SET created_at = created_at - INTERVAL ? MINUTE WHERE user_id = ?', [minutes, uid]);
  await sql('UPDATE decisions SET created_at = created_at - INTERVAL ? MINUTE WHERE user_id = ?', [minutes, uid]);
}

const setSession = (uid, no, secondsAgo = 600) => sql(
  'UPDATE users SET session_no = ?, session_started_at = NOW(3) - INTERVAL ? SECOND, last_seen_at = NOW(3) WHERE id = ?',
  [no, secondsAgo, uid]);

const engage = (token, placement, facts = {}) => app.call('POST', '/engage', { token, body: { placement, facts: { hour: 15, ...facts } } });
const outcome = (token, id, value) => app.call('POST', `/engage/${id}`, { token, body: { outcome: value } });
const decisions = (uid) => sql(
  'SELECT id, session_no, placement, kind, shown, reason, personalized, outcome FROM decisions WHERE user_id = ? ORDER BY id', [uid]);

async function readyForAds(flags = {}, runs = I.everyRunsEarly) {
  const g = await guest(flags);
  await addRuns(g.uid, runs, { minutesAgo: 10 });
  await setSession(g.uid, I.graceSessions + 1);
  return g;
}

test('placements and facts are validated', async () => {
  const { token } = await guest();
  assert.equal((await app.call('POST', '/engage', { token, body: { placement: 'shop' } })).status, 400);
  assert.equal((await app.call('POST', '/engage', { token, body: {} })).status, 400);
  assert.equal((await app.call('POST', '/engage', { body: { placement: 'menu' } })).status, 401);
  const res = await app.call('POST', '/engage', { token, body: { placement: 'menu', facts: 'x' } });
  assert.deepEqual(res.body, { interstitial: null, nudge: null });
});

test('without a consent decision nothing is shown or logged', async () => {
  const g = await guest(null);
  await addRuns(g.uid, 20);
  await setSession(g.uid, 9);
  for (const placement of ['gameover', 'menu', 'slot_item']) {
    const res = await engage(g.token, placement, { newItem: true, newHighscore: true });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { interstitial: null, nudge: null });
  }
  assert.equal((await decisions(g.uid)).length, 0);
});

test('a new guest sees no interstitial in the first two sessions', async () => {
  const g = await guest({ stats: true });
  await addRuns(g.uid, 30);
  for (let session = 1; session <= I.graceSessions; session++) {
    await setSession(g.uid, session);
    for (let i = 0; i < 3; i++) assert.equal((await engage(g.token, 'gameover')).body.interstitial, null);
  }
  const rows = await decisions(g.uid);
  assert.ok(rows.length >= 6);
  assert.ok(rows.filter((r) => r.kind === 'interstitial').every((r) => r.shown === 0 && r.reason === 'grace'));

  await setSession(g.uid, I.graceSessions + 1);
  const res = await engage(g.token, 'gameover');
  assert.deepEqual(Object.keys(res.body.interstitial).sort(), ['id', 'seconds']);
  assert.equal(res.body.interstitial.seconds, I.seconds);
});

test('after the grace period the interval counts runs since the last interstitial', async () => {
  const g = await readyForAds({ stats: true }, I.everyRunsEarly - 1);
  assert.equal((await engage(g.token, 'gameover')).body.interstitial, null);
  await addRuns(g.uid, 1);
  assert.ok((await engage(g.token, 'gameover')).body.interstitial);

  await age(g.uid, 60);
  await setSession(g.uid, I.earlySessions + 1);
  await addRuns(g.uid, I.everyRuns - 1);
  assert.equal((await engage(g.token, 'gameover')).body.interstitial, null);
  await addRuns(g.uid, 1);
  assert.ok((await engage(g.token, 'gameover')).body.interstitial);

  const reasons = (await decisions(g.uid)).filter((r) => r.kind === 'interstitial').map((r) => [r.shown, r.reason]);
  assert.deepEqual(reasons, [[0, 'interval'], [1, 'ok'], [0, 'interval'], [1, 'ok']]);
});

test('short runs, the minimum gap and the session and day caps', async () => {
  const g = await readyForAds({ stats: true }, 40);
  await addRuns(g.uid, 1, { seconds: I.minRunSeconds - 1 });
  assert.equal((await engage(g.token, 'gameover')).body.interstitial, null);
  await addRuns(g.uid, 1, { seconds: 20 });
  assert.ok((await engage(g.token, 'gameover')).body.interstitial);
  await addRuns(g.uid, 10);
  assert.equal((await engage(g.token, 'gameover')).body.interstitial, null);

  await age(g.uid, 60);
  const session = I.graceSessions + 1;
  await sql(
    `INSERT INTO decisions (user_id, session_no, placement, kind, shown, reason, created_at)
     VALUES (?, ?, 'gameover', 'interstitial', 1, 'ok', NOW(3) - INTERVAL 50 MINUTE),
            (?, ?, 'gameover', 'interstitial', 1, 'ok', NOW(3) - INTERVAL 40 MINUTE)`,
    [g.uid, session, g.uid, session]);
  await addRuns(g.uid, 10);
  assert.equal((await engage(g.token, 'gameover')).body.interstitial, null);

  await setSession(g.uid, session + 1);
  assert.ok((await engage(g.token, 'gameover')).body.interstitial);

  const filler = Array.from({ length: I.maxPerDay }, () => '(?, 1, \'gameover\', \'interstitial\', 1, \'ok\', NOW(3) - INTERVAL 20 HOUR)');
  await sql(`INSERT INTO decisions (user_id, session_no, placement, kind, shown, reason, created_at) VALUES ${filler.join(', ')}`,
    Array(I.maxPerDay).fill(g.uid));
  await setSession(g.uid, session + 2);
  assert.equal((await engage(g.token, 'gameover')).body.interstitial, null);

  const skipped = (await decisions(g.uid)).filter((r) => r.kind === 'interstitial' && r.shown === 0).map((r) => r.reason);
  assert.deepEqual(skipped, ['short_run', 'min_gap', 'session_cap', 'day_cap']);
});

test('no interstitial within the rest period after a rewarded ad', async () => {
  const g = await readyForAds({ stats: true });
  await sql('UPDATE runs SET doubled = 1, doubled_at = NOW(3) - INTERVAL ? SECOND WHERE user_id = ? ORDER BY id LIMIT 1',
    [I.rewardedRestSeconds - 60, g.uid]);
  assert.equal((await engage(g.token, 'gameover')).body.interstitial, null);
  assert.equal((await decisions(g.uid)).at(-1).reason, 'cooldown');
  await sql('UPDATE runs SET doubled_at = NOW(3) - INTERVAL ? SECOND WHERE user_id = ? AND doubled = 1',
    [I.rewardedRestSeconds + 1, g.uid]);
  assert.ok((await engage(g.token, 'gameover')).body.interstitial);
});

test('a guest with progress gets the item nudge, others do not', async () => {
  const g = await guest();
  const none = await engage(g.token, 'slot_item', { newItem: true });
  assert.deepEqual(none.body, { interstitial: null, nudge: null });

  await sql('INSERT INTO inventory (user_id, item_id) VALUES (?, ?)', [g.uid, ITEM]);
  const res = await engage(g.token, 'slot_item', { newItem: true });
  assert.equal(res.body.interstitial, null);
  assert.deepEqual(Object.keys(res.body.nudge).sort(), ['id', 'reason']);
  assert.equal(res.body.nudge.reason, 'item');
  assert.equal((await engage(g.token, 'slot_item', { newItem: true })).body.nudge, null);
  assert.equal((await engage(g.token, 'slot_item', { newItem: false })).body.nudge, null);
  assert.deepEqual((await decisions(g.uid)).map((r) => [r.kind, r.shown, r.reason]), [['nudge', 1, 'item']]);

  const reg = await guest();
  await sql('UPDATE users SET coins = 900 WHERE id = ?', [reg.uid]);
  const signup = await app.call('POST', '/auth/signup', { token: reg.token, body: { username: 'Nudgefrei', password: 'geheim123' } });
  assert.equal(signup.status, 200);
  assert.deepEqual((await engage(signup.body.token, 'slot_item', { newItem: true })).body, { interstitial: null, nudge: null });
  assert.equal((await decisions(reg.uid)).length, 0);
});

test('highscore, return and progress nudges with their caps', async () => {
  const g = await guest({ stats: true });
  await addRuns(g.uid, NUDGE.highscoreMinRuns + 1);
  const hs = await engage(g.token, 'gameover', { newHighscore: true });
  assert.equal(hs.body.nudge.reason, 'highscore');
  assert.equal((await outcome(g.token, hs.body.nudge.id, 'dismissed')).status, 200);
  assert.equal((await engage(g.token, 'gameover', { newHighscore: true })).body.nudge, null);

  await sql('UPDATE decisions SET created_at = NOW(3) - INTERVAL ? MINUTE WHERE user_id = ?', [NUDGE.minGapMinutes + 1, g.uid]);
  await setSession(g.uid, 2, 30);
  assert.equal((await engage(g.token, 'menu')).body.nudge.reason, 'return');
  assert.equal((await engage(g.token, 'menu')).body.nudge, null);

  await sql('UPDATE decisions SET created_at = NOW(3) - INTERVAL 25 HOUR WHERE user_id = ?', [g.uid]);
  await setSession(g.uid, 3, 900);
  await sql('UPDATE users SET play_flight_ms = ? WHERE id = ?', [NUDGE.progressSeconds * 1000, g.uid]);
  const progress = await engage(g.token, 'menu');
  assert.equal(progress.body.nudge.reason, 'progress');
  await outcome(g.token, progress.body.nudge.id, 'dismissed');

  await sql('UPDATE decisions SET created_at = NOW(3) - INTERVAL 30 HOUR WHERE user_id = ?', [g.uid]);
  await sql('UPDATE decisions SET outcome = \'dismissed\' WHERE user_id = ? AND shown = 1', [g.uid]);
  await setSession(g.uid, 4, 900);
  assert.equal((await engage(g.token, 'menu')).body.nudge, null);
  assert.equal((await decisions(g.uid)).at(-1).reason, 'paused');
  for (let i = 0; i < 2; i++) {
    await app.consent(g.token, { stats: false });
    assert.equal((await engage(g.token, 'menu')).body.nudge, null);
  }
});

test('the progress threshold is personalised only from completed sessions since the consent', async () => {
  const flags = { stats: true, personal: true, adult: true };
  const fresh = await guest(flags);
  await addRuns(fresh.uid, 3, { seconds: 3 });
  assert.equal((await engage(fresh.token, 'gameover')).body.nudge, null);
  assert.equal((await decisions(fresh.uid)).some((d) => d.kind === 'nudge'), false);

  const g = await guest(flags);
  await sql('UPDATE users SET consent_stats_at = NOW(3) - INTERVAL 3 DAY WHERE id = ?', [g.uid]);
  const past = (no, daysAgo) => sql(
    `INSERT INTO play_sessions (user_id, session_no, started_at, last_active_at)
     VALUES (?, ?, NOW(3) - INTERVAL ? DAY, NOW(3) - INTERVAL ? DAY + INTERVAL 400 SECOND)`,
    [g.uid, no, daysAgo, daysAgo]);
  await past(1, 2);
  await addRuns(g.uid, 3, { seconds: 70, session: 3 });
  await setSession(g.uid, 2, 60);
  assert.equal((await engage(g.token, 'gameover')).body.nudge, null);

  await past(2, 1);
  await setSession(g.uid, 3, 60);
  const res = await engage(g.token, 'gameover');
  assert.equal(res.body.nudge?.reason, 'progress');
  const [row] = await sql('SELECT reason, personalized FROM decisions WHERE id = ?', [res.body.nudge.id]);
  assert.deepEqual({ ...row }, { reason: 'progress', personalized: 1 });
});

test('outcomes are accepted once and only for own shown decisions', async () => {
  const a = await guest({ stats: true });
  const b = await guest();
  await addRuns(a.uid, 3);
  const res = await engage(a.token, 'slot_item', { newItem: true });
  const id = res.body.nudge.id;
  assert.equal((await outcome(b.token, id, 'clicked')).status, 404);
  assert.equal((await outcome(a.token, id, 'continued')).status, 404);
  assert.equal((await outcome(a.token, id, 'gewonnen')).status, 400);
  assert.equal((await outcome(a.token, 'abc', 'clicked')).status, 404);
  assert.equal((await outcome(a.token, 0, 'clicked')).status, 404);
  const ok = await outcome(a.token, id, 'clicked');
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body, { ok: true });
  assert.equal((await outcome(a.token, id, 'dismissed')).status, 404);
  const [row] = await sql('SELECT outcome, outcome_at IS NOT NULL AS stamped FROM decisions WHERE id = ?', [id]);
  assert.deepEqual({ ...row }, { outcome: 'clicked', stamped: 1 });

  await engage(a.token, 'gameover');
  const skipped = (await decisions(a.uid)).find((r) => r.shown === 0);
  assert.ok(skipped);
  assert.equal((await outcome(a.token, skipped.id, 'continued')).status, 404);

  const ad = await readyForAds();
  const shown = await engage(ad.token, 'gameover');
  assert.equal((await outcome(ad.token, shown.body.interstitial.id, 'clicked')).status, 404);
  assert.equal((await outcome(ad.token, shown.body.interstitial.id, 'continued')).status, 200);
});

test('a dropped decision is not counted and is only kept as skipped with stats consent', async () => {
  const g = await readyForAds({ stats: true });
  const first = (await engage(g.token, 'gameover')).body.interstitial;
  const other = await guest();
  assert.equal((await outcome(other.token, first.id, 'dropped')).status, 404);
  assert.deepEqual((await outcome(g.token, first.id, 'dropped')).body, { ok: true });
  assert.equal((await outcome(g.token, first.id, 'dropped')).status, 404);
  assert.equal((await outcome(g.token, first.id, 'continued')).status, 404);
  const [row] = await sql('SELECT shown, outcome FROM decisions WHERE id = ?', [first.id]);
  assert.deepEqual({ ...row }, { shown: 0, outcome: 'dropped' });
  const second = (await engage(g.token, 'gameover')).body.interstitial;
  assert.ok(second);
  assert.equal((await outcome(g.token, second.id, 'continued')).status, 200);
  assert.equal((await outcome(g.token, second.id, 'dropped')).status, 404);

  const n = await readyForAds({ stats: false });
  const ad = (await engage(n.token, 'gameover')).body.interstitial;
  assert.equal((await outcome(n.token, ad.id, 'dropped')).status, 200);
  assert.equal((await decisions(n.uid)).length, 0);
  assert.ok((await engage(n.token, 'gameover')).body.interstitial);

  const h = await guest();
  await addRuns(h.uid, 3);
  const nudge = (await engage(h.token, 'slot_item', { newItem: true })).body.nudge;
  assert.equal((await outcome(h.token, nudge.id, 'dropped')).status, 200);
  assert.equal((await engage(h.token, 'slot_item', { newItem: true })).body.nudge.reason, 'item');
});

test('parallel requests return at most one interstitial', async () => {
  const g = await readyForAds({ stats: true }, 30);
  const results = await Promise.all(Array.from({ length: 6 }, () => engage(g.token, 'gameover')));
  assert.ok(results.every((r) => r.status === 200));
  assert.equal(results.filter((r) => r.body.interstitial).length, 1);
  const rows = await decisions(g.uid);
  assert.equal(rows.filter((r) => r.kind === 'interstitial' && r.shown === 1).length, 1);
  assert.equal(rows.filter((r) => r.kind === 'interstitial').length, 6);
});

test('without stats consent only shown decisions are logged', async () => {
  const g = await readyForAds({ stats: false });
  assert.ok((await engage(g.token, 'gameover')).body.interstitial);
  for (let i = 0; i < 3; i++) assert.equal((await engage(g.token, 'gameover')).body.interstitial, null);
  const rows = await decisions(g.uid);
  assert.deepEqual(rows.map((r) => [r.kind, r.shown, r.reason]), [['interstitial', 1, 'ok']]);

  const s = await readyForAds({ stats: true });
  await engage(s.token, 'gameover');
  await engage(s.token, 'gameover');
  assert.deepEqual((await decisions(s.uid)).map((r) => [r.kind, r.shown, r.reason]), [
    ['interstitial', 1, 'ok'], ['interstitial', 0, 'min_gap'],
  ]);
});

test('personal consent uses live segments for the interval', async () => {
  const late = I.earlySessions + 1;
  const make = async (flags) => {
    const g = await guest(flags);
    await sql('UPDATE users SET consent_stats_at = NOW(3) - INTERVAL 3 DAY WHERE id = ?', [g.uid]);
    const shown = Array.from({ length: 6 }, () => '(?, 1, \'gameover\', \'interstitial\', 1, \'ok\', \'continued\', NOW(3) - INTERVAL 2 DAY)');
    await sql(`INSERT INTO decisions (user_id, session_no, placement, kind, shown, reason, outcome, created_at) VALUES ${shown.join(', ')}`,
      Array(6).fill(g.uid));
    await addRuns(g.uid, ADS.personal.tolerantEveryRuns, { minutesAgo: 20 });
    await sql('UPDATE users SET total_runs = 30 WHERE id = ?', [g.uid]);
    await setSession(g.uid, late);
    return g;
  };
  const tolerant = await make({ stats: true, personal: true, adult: true });
  assert.ok((await engage(tolerant.token, 'gameover')).body.interstitial);
  const row = (await decisions(tolerant.uid)).filter((r) => r.kind === 'interstitial').at(-1);
  assert.deepEqual([row.shown, row.reason, row.personalized], [1, 'ok', 1]);

  const plain = await make({ stats: true });
  assert.equal((await engage(plain.token, 'gameover')).body.interstitial, null);
  const skipped = (await decisions(plain.uid)).filter((r) => r.kind === 'interstitial').at(-1);
  assert.deepEqual([skipped.shown, skipped.reason, skipped.personalized], [0, 'interval', 0]);
});

test('withdrawing stats keeps only shown decisions and the daily purge removes old ones', async () => {
  const g = await readyForAds({ stats: true });
  const ad = (await engage(g.token, 'gameover')).body.interstitial;
  await outcome(g.token, ad.id, 'continued');
  await engage(g.token, 'gameover');
  assert.deepEqual((await decisions(g.uid)).map((r) => [r.shown, r.reason, r.outcome]), [[1, 'ok', 'continued'], [0, 'min_gap', null]]);
  await app.consent(g.token, { stats: false });
  assert.deepEqual((await decisions(g.uid)).map((r) => [r.id, r.shown, r.outcome]), [[ad.id, 1, null]]);
  assert.equal((await engage(g.token, 'gameover')).body.interstitial, null);

  const n = await readyForAds({ stats: false });
  assert.ok((await engage(n.token, 'gameover')).body.interstitial);
  await app.consent(n.token, { stats: false });
  assert.equal((await engage(n.token, 'gameover')).body.interstitial, null);
  assert.equal((await decisions(n.uid)).length, 1);

  const old = await readyForAds({ stats: true });
  await engage(old.token, 'gameover');
  await engage(old.token, 'gameover');
  const [first] = await decisions(old.uid);
  await sql('UPDATE decisions SET created_at = NOW(3) - INTERVAL ? DAY WHERE id = ?', [PRIVACY.retention.decisionsDays + 1, first.id]);
  const result = await purgeRaw(app.pool, { batch: 1 });
  assert.ok(result.decisions >= 1);
  assert.deepEqual((await decisions(old.uid)).map((r) => r.id).includes(first.id), false);
  assert.ok((await decisions(old.uid)).length >= 1);
});

test('profile and archive count interstitials and nudges', async () => {
  const g = await readyForAds({ stats: true });
  const ad = await engage(g.token, 'gameover');
  await outcome(g.token, ad.body.interstitial.id, 'continued');
  await sql('INSERT INTO inventory (user_id, item_id) VALUES (?, ?)', [g.uid, ITEM]);
  const nudge = await engage(g.token, 'slot_item', { newItem: true });
  await outcome(g.token, nudge.body.nudge.id, 'clicked');

  await refreshProfile(app.pool, g.uid);
  const [p] = await sql('SELECT ad_tolerance, metrics FROM player_profiles WHERE user_id = ?', [g.uid]);
  const m = asJson(p.metrics);
  assert.deepEqual(m.ads, { shown: 1, continued: 1 });
  assert.deepEqual(m.nudges, { item: { shown: 1, clicked: 1, dismissed: 0 } });
  assert.equal(Number(p.ad_tolerance), 0.833);

  await sql('UPDATE users SET last_seen_at = NOW(3) - INTERVAL 25 HOUR WHERE id = ?', [g.uid]);
  assert.ok(await cleanupGuests(app.pool) >= 1);
  const [a] = await sql('SELECT id, interstitials, nudges FROM player_archive ORDER BY id DESC LIMIT 1');
  assert.equal(a.interstitials, 1);
  assert.deepEqual(asJson(a.nudges), { item: { shown: 1, clicked: 1 } });
  const days = await sql(
    `SELECT SUM(interstitials) AS i, SUM(nudges_shown) AS s, SUM(nudges_clicked) AS c, SUM(runs) AS r
     FROM player_archive_days WHERE archive_id = ?`, [a.id]);
  assert.deepEqual({ ...days[0] }, { i: 1, s: 1, c: 1, r: I.everyRunsEarly });
  const reasons = await sql('SELECT nudge_reasons FROM player_archive_days WHERE archive_id = ? AND nudges_shown > 0', [a.id]);
  assert.deepEqual(reasons.map((r) => asJson(r.nudge_reasons)), [{ item: 1 }]);
});

test('the mock makes the same decisions for the same sequence', async () => {
  const runs = I.everyRunsEarly;
  const g = await readyForAds({}, runs);
  await sql('UPDATE users SET coins = 400, session_started_at = NOW(3) - INTERVAL 30 SECOND WHERE id = ?', [g.uid]);

  const now = Date.now();
  store.clear();
  store.set('wingrush.save.v1', JSON.stringify({
    userId: 'guest-parity', coins: 400, totalRuns: runs, playFlightMs: runs * 30000, createdAt: now - 3600000,
    lastSeenAt: now - 5000, sessionNo: I.graceSessions + 1, sessionStartedAt: now - 30000, lastRunAt: now - 600000,
    runs: Array.from({ length: runs }, (_, i) => ({ runId: `r${i}`, duration: 30, coins: 10, doubled: false, at: now - 600000 + i, sessionNo: 1 })),
    consent: { version: PRIVACY.version, stats: false, personal: false, adult: false, statsAt: null },
  }));
  const mock = (await import(`${MOCK.href}?parity=1`)).mockApi;

  const steps = [
    ['gameover', {}],
    ['gameover', { newHighscore: true }],
    ['menu', {}],
    ['slot_item', { newItem: true }],
    ['gameover', {}],
  ];
  const strip = (r) => ({
    interstitial: r.interstitial && { seconds: r.interstitial.seconds },
    nudge: r.nudge && { reason: r.nudge.reason },
  });
  const server = [];
  const local = [];
  for (const [placement, facts] of steps) {
    server.push(strip((await engage(g.token, placement, facts)).body));
    local.push(strip(await mock.engage(placement, { hour: 15, ...facts })));
  }
  assert.deepEqual(local, server);
  assert.ok(server[0].interstitial);
  assert.equal(server[1].nudge.reason, 'highscore');
  const saved = JSON.parse(store.get('wingrush.save.v1')).decisions;
  const rows = await decisions(g.uid);
  assert.deepEqual(saved.map((d) => [d.kind, d.shown, d.reason]).reverse(), rows.map((r) => [r.kind, !!r.shown, r.reason]));

  const nudgeId = saved.find((d) => d.kind === 'nudge').id;
  const serverNudge = rows.find((r) => r.kind === 'nudge' && r.shown).id;
  const mockOutcome = () => JSON.parse(store.get('wingrush.save.v1')).decisions.find((d) => d.id === nudgeId).outcome;
  const serverOutcome = async () => (await decisions(g.uid)).find((r) => r.id === serverNudge).outcome;
  assert.equal(await mock.engageOutcome(nudgeId, 'continued'), undefined);
  assert.equal((await outcome(g.token, serverNudge, 'continued')).status, 404);
  assert.deepEqual(await mock.engageOutcome(nudgeId, 'clicked'), { ok: true });
  assert.equal((await outcome(g.token, serverNudge, 'clicked')).status, 200);
  assert.deepEqual([mockOutcome(), await serverOutcome()], [null, null]);
  assert.deepEqual(await mock.engageOutcome(nudgeId, 'dismissed'), { ok: true });
  assert.equal((await outcome(g.token, serverNudge, 'dismissed')).status, 200);
  assert.deepEqual([mockOutcome(), await serverOutcome()], ['dismissed', 'dismissed']);
  assert.equal(await mock.engageOutcome(nudgeId, 'clicked'), undefined);
  assert.equal((await outcome(g.token, serverNudge, 'clicked')).status, 404);
});

test('without stats consent only «Später» is stored and withdrawing clears the other reactions', async () => {
  const n = await readyForAds({ stats: false });
  const ad = (await engage(n.token, 'gameover')).body.interstitial;
  assert.deepEqual((await outcome(n.token, ad.id, 'continued')).body, { ok: true });
  const first = (await engage(n.token, 'slot_item', { newItem: true })).body.nudge;
  assert.deepEqual((await outcome(n.token, first.id, 'clicked')).body, { ok: true });
  await age(n.uid, NUDGE.minGapMinutes + 1);
  await setSession(n.uid, I.graceSessions + 2);
  const second = (await engage(n.token, 'slot_item', { newItem: true })).body.nudge;
  assert.deepEqual((await outcome(n.token, second.id, 'dismissed')).body, { ok: true });
  assert.deepEqual((await decisions(n.uid)).map((r) => [r.id, r.outcome]), [[ad.id, null], [first.id, null], [second.id, 'dismissed']]);

  const s = await readyForAds({ stats: true });
  const shown = (await engage(s.token, 'gameover')).body.interstitial;
  await outcome(s.token, shown.id, 'continued');
  const nudge = (await engage(s.token, 'slot_item', { newItem: true })).body.nudge;
  await outcome(s.token, nudge.id, 'clicked');
  assert.deepEqual((await decisions(s.uid)).map((r) => [r.id, r.outcome]), [[shown.id, 'continued'], [nudge.id, 'clicked']]);
  await app.consent(s.token, { stats: false });
  assert.deepEqual((await decisions(s.uid)).map((r) => [r.id, r.outcome]), [[shown.id, null], [nudge.id, null]]);
});
