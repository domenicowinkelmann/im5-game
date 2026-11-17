import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { startServer } from './helpers.js';
import { asJson } from '../src/db.js';
import { computeMetrics } from '../src/analytics/metrics.js';
import { refreshProfile, refreshProfiles } from '../src/analytics/profiles.js';
import { purgeAnalytics } from '../src/analytics/privacy.js';
import { purgeRaw } from '../src/analytics/purge.js';
import { cleanupGuests } from '../src/cleanup.js';
import { PLAYTIME } from '../../src/shared/economy.js';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const FORBIDDEN = /slot|spin|gambl|verdopp|doubl|vielspiel|jackpot/i;
const RUN = {
  distance: 1200, score: 1900, coins: 30, duration: 40, maxMultiplier: 2, tunnels: 1,
  cause: 'Baum erwischt', coinsByType: { bronze: 10, silver: 2, gold: 0, diamond: 0 },
};

const geo = { lookup: () => ({ country: 'CH', region: 'GR' }) };

let app;
before(async () => { app = await startServer({ geo }); });
after(async () => { await app.stop(); });

async function guest(stats = true) {
  const res = await app.call('POST', '/auth/guest', { body: {} });
  assert.equal(res.status, 200);
  const token = res.body.token;
  if (stats) assert.equal((await app.consent(token, { stats: true })).status, 200);
  return { token, uid: Number(res.body.profile.userId) };
}

const sql = (query, params = []) => app.pool.query(query, params);

const consentSince = (uid, days) => sql('UPDATE users SET consent_stats_at = NOW(3) - INTERVAL ? DAY WHERE id = ?', [days, uid]);

async function addRun(uid, session, at, { ms = 40000, distance = 1000, score = 1500, cause = 'Baum erwischt' } = {}) {
  await sql(
    `INSERT INTO runs (public_id, user_id, session_no, distance, score, coins, duration_ms, max_multiplier, tunnels, cause, coins_by_type, created_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, 1, 0, ?, '{}', ${at})`,
    [randomBytes(16).toString('base64url'), uid, session, distance, score, ms, cause]);
}

const addSpin = (uid, session, at, ms) => sql(
  `INSERT INTO spins (user_id, session_no, outcome, reels, coins_delta, slot_ms, created_at)
   VALUES (?, ?, 'nothing', '[]', -100, ?, ${at})`, [uid, session, ms]);

const addSession = (uid, session, start, end, values = {}) => sql(
  `INSERT INTO play_sessions (user_id, session_no, started_at, last_active_at, tz_offset_min, device, os, browser, country, region)
   VALUES (?, ?, ${start}, ${end}, ?, ?, ?, ?, ?, ?)`,
  [uid, session, values.tz ?? null, values.device ?? null, values.os ?? null, values.browser ?? null, values.country ?? null, values.region ?? null]);

async function profile(uid) {
  const [row] = await sql('SELECT * FROM player_profiles WHERE user_id = ?', [uid]);
  return row ? { ...row, heat: asJson(row.heat), segments: asJson(row.segments), metrics: asJson(row.metrics) } : null;
}

async function today() {
  const [{ d }] = await sql('SELECT CAST(UTC_DATE() AS CHAR) AS d');
  return {
    at: (daysAgo, minutes) => `DATE '${d}' - INTERVAL ${daysAgo} DAY + INTERVAL ${minutes} MINUTE`,
    weekday: (daysAgo) => (new Date(Date.parse(`${d}T00:00:00Z`) - daysAgo * 86400000).getUTCDay() + 6) % 7,
  };
}

const nonZero = (heat) => Object.fromEntries(heat.map((v, i) => [i, v]).filter(([, v]) => v > 0));

function keys(value, out = []) {
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (!Array.isArray(value)) out.push(k);
      keys(v, out);
    }
  }
  return out;
}

test('heatmap uses the local hour and weekday of each session and sums runs and spins', async () => {
  const { uid } = await guest();
  await consentSince(uid, 10);
  await sql('UPDATE users SET tz_offset_min = -300 WHERE id = ?', [uid]);
  const { at, weekday } = await today();
  await addSession(uid, 1, at(2, 360), at(2, 420), { tz: 120 });
  await addRun(uid, 1, at(2, 390));
  await addSpin(uid, 1, at(2, 400), 3000);
  await addSession(uid, 2, at(3, 1380), at(3, 1430), { tz: 120 });
  await addRun(uid, 2, at(3, 1410), { ms: 20000 });
  await addRun(uid, 3, at(4, 720), { ms: 10000 });

  const result = await refreshProfile(app.pool, uid);
  assert.ok(result);
  const row = await profile(uid);
  assert.equal(row.heat.length, 168);
  const d2 = weekday(2);
  const d4 = weekday(4);
  assert.deepEqual(nonZero(row.heat), {
    [d2 * 24 + 1]: 20,
    [d4 * 24 + 7]: 10,
    [d2 * 24 + 8]: 40 + 3,
  });
  assert.equal(row.metrics.play.totalS, 73);
  assert.equal(row.metrics.play.activeDays90, 2);
  assert.equal(row.metrics.sessions.count, 3);
  assert.equal(row.sessions_90d, 3);
  assert.equal(row.fav_weekday, d2);

  const other = await guest();
  await consentSince(other.uid, 10);
  await addRun(other.uid, 1, at(2, 390));
  await refreshProfile(app.pool, other.uid);
  assert.deepEqual(nonZero((await profile(other.uid)).heat), { [d2 * 24 + 6]: 40 });
});

test('sessions, gameplay and context are summarised', async () => {
  const { uid } = await guest();
  await consentSince(uid, 30);
  await sql('UPDATE users SET created_at = NOW(3) - INTERVAL 30 DAY, session_no = 5 WHERE id = ?', [uid]);
  const ctx = { tz: 60, device: 'mobile', os: 'iOS', browser: 'Safari', country: 'CH', region: 'GR' };
  for (const [no, days] of [[1, 20], [2, 19], [3, 18], [4, 17]]) {
    await addSession(uid, no, `NOW(3) - INTERVAL ${days} DAY`, `NOW(3) - INTERVAL ${days} DAY + INTERVAL 30 MINUTE`,
      no === 1 ? { ...ctx, device: 'desktop', os: 'Windows', browser: 'Edge', country: 'DE', region: null } : ctx);
  }
  await addSession(uid, 5, 'NOW(3) - INTERVAL 60 MINUTE', 'NOW(3) - INTERVAL 30 MINUTE', ctx);
  const distances = [500, 600, 700, 800, 1000, 1200];
  for (const [i, distance] of distances.entries()) {
    await addRun(uid, 5, `NOW(3) - INTERVAL ${50 - i} MINUTE`, { distance, score: distance * 2, cause: i < 4 ? 'Baum erwischt' : 'Helikopter' });
  }

  const { metrics: m } = await computeMetrics(app.pool, uid);
  assert.deepEqual({ ...m.sessions }, {
    count: 5, avgS: 1800, completedCount: 4, completedAvgS: 1800, medianS: 1800, medianPauseH: 23.5, usualGapH: 23.5, lastPauseH: 406.5,
  });
  assert.deepEqual(m.context, { device: 'mobile', os: 'iOS', browser: 'Safari', country: 'CH', region: 'GR' });
  assert.equal(m.gameplay.runs, 6);
  assert.equal(m.gameplay.maxDistance, 1200);
  assert.equal(m.gameplay.avgDistance, 800);
  assert.equal(m.gameplay.avgScore, 1600);
  assert.equal(m.gameplay.avgDurationS, 40);
  assert.equal(m.gameplay.topCause, 'Baum erwischt');
  assert.equal(m.gameplay.trend, Number((1000 / 600 - 1).toFixed(3)));
  assert.equal(m.account.guest, true);

  await refreshProfile(app.pool, uid);
  const row = await profile(uid);
  assert.deepEqual(row.segments, ['gelegentlich', 'rueckkehrer', 'gast_fortschritt', 'mobil']);
  assert.equal(row.device, 'mobile');
  assert.equal(row.country, 'CH');
  assert.equal(row.region, 'GR');
  assert.equal(row.ad_tolerance, 0.8);
  assert.equal(row.churn_risk, 0);
  assert.ok(row.engagement > 0 && row.engagement <= 100);
  for (const k of keys(row.metrics)) assert.ok(!FORBIDDEN.test(k), k);
  for (const s of row.segments) assert.ok(!FORBIDDEN.test(s), s);
});

test('without stats consent there are no metrics and no profile', async () => {
  const { token, uid } = await guest(false);
  await addRun(uid, 1, 'NOW(3) - INTERVAL 1 HOUR');
  assert.equal(await computeMetrics(app.pool, uid), null);
  assert.equal(await refreshProfile(app.pool, uid), null);
  assert.equal(await profile(uid), null);
  await app.consent(token, { stats: false, adult: true });
  assert.equal(await refreshProfile(app.pool, uid), null);
  assert.equal(await profile(uid), null);
});

test('data before the consent or older than 90 days does not count', async () => {
  const { uid } = await guest();
  await consentSince(uid, 1);
  await addRun(uid, 1, 'NOW(3) - INTERVAL 2 DAY');
  await addRun(uid, 1, 'NOW(3) - INTERVAL 1 HOUR', { ms: 25000 });
  await addSpin(uid, 1, 'NOW(3) - INTERVAL 3 DAY', 3000);
  await refreshProfile(app.pool, uid);
  const row = await profile(uid);
  assert.equal(row.metrics.play.totalS, 25);
  assert.equal(row.metrics.gameplay.runs, 1);
  assert.equal(row.play_s_30d, 25);
  assert.equal(row.active_days_30d, 1);

  const old = await guest();
  await consentSince(old.uid, 200);
  await addRun(old.uid, 1, 'NOW(3) - INTERVAL 91 DAY');
  await addRun(old.uid, 1, 'NOW(3) - INTERVAL 40 DAY', { ms: 30000 });
  await addRun(old.uid, 1, 'NOW(3) - INTERVAL 1 DAY', { ms: 5000 });
  await refreshProfile(app.pool, old.uid);
  const r = await profile(old.uid);
  assert.equal(r.metrics.play.totalS, 35);
  assert.equal(r.play_s_30d, 5);
  assert.equal(r.metrics.play.activeDays90, 2);
});

test('lifetime account counters from before the consent do not shape the profile', async () => {
  const { uid } = await guest();
  await consentSince(uid, 3);
  await sql(
    'UPDATE users SET created_at = NOW(3) - INTERVAL 30 DAY, session_no = 12, total_runs = 40, coins = 120 WHERE id = ?', [uid]);
  await sql('DELETE FROM play_sessions WHERE user_id = ?', [uid]);
  for (let s = 2; s <= 11; s++) await addRun(uid, s, `NOW(3) - INTERVAL ${20 - s} DAY`);
  await addSession(uid, 12, 'NOW(3) - INTERVAL 2 HOUR', 'NOW(3) - INTERVAL 1 HOUR');
  await addRun(uid, 12, 'NOW(3) - INTERVAL 90 MINUTE');

  await refreshProfile(app.pool, uid);
  let row = await profile(uid);
  assert.equal(row.metrics.account.sessions, 1);
  assert.equal(row.metrics.account.runs, 1);
  assert.ok(Math.abs(row.metrics.account.consentHours - 72) < 0.1);
  assert.ok(!keys(row.metrics).includes('ageHours') && !keys(row.metrics).includes('sessionsTotal'));
  assert.ok(row.segments.includes('neu'));
  assert.ok(!row.segments.includes('gast_fortschritt'));

  for (const s of [13, 14, 15]) await addRun(uid, s, `NOW(3) - INTERVAL ${70 - s} MINUTE`);
  await refreshProfile(app.pool, uid);
  row = await profile(uid);
  assert.equal(row.metrics.account.sessions, 4);
  assert.equal(row.metrics.account.runs, 4);
  assert.ok(!row.segments.includes('neu'));
  assert.ok(row.segments.includes('gelegentlich'));
  assert.ok(row.segments.includes('gast_fortschritt'));
});

async function lockedWhile(uid, change) {
  const conn = await app.pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [uid]);
    const pending = refreshProfile(app.pool, uid);
    await new Promise((r) => setTimeout(r, 300));
    await change(conn);
    await conn.commit();
    return await pending;
  } finally {
    conn.release();
  }
}

test('a withdrawal during the refresh leaves no profile behind', async () => {
  const { uid } = await guest();
  await addRun(uid, 1, 'NOW(3)');
  assert.ok(await refreshProfile(app.pool, uid));
  assert.ok(await profile(uid));

  const result = await lockedWhile(uid, async (conn) => {
    await conn.query('UPDATE users SET consent_stats = 0, consent_stats_at = NULL WHERE id = ?', [uid]);
    await purgeAnalytics(conn, uid);
  });
  assert.equal(result, null);
  assert.equal(await profile(uid), null);

  const again = await guest();
  await addRun(again.uid, 1, 'NOW(3)');
  const renewed = await lockedWhile(again.uid, async (conn) => {
    await conn.query('UPDATE users SET consent_stats = 0, consent_stats_at = NULL WHERE id = ?', [again.uid]);
    await purgeAnalytics(conn, again.uid);
    await conn.query('UPDATE users SET consent_stats = 1, consent_stats_at = NOW(3) + INTERVAL 1 SECOND WHERE id = ?', [again.uid]);
  });
  assert.equal(renewed, null);
  assert.equal(await profile(again.uid), null);
  assert.ok(await refreshProfile(app.pool, again.uid));
});

test('withdrawing stats deletes the profile', async () => {
  const { token, uid } = await guest();
  await refreshProfile(app.pool, uid);
  assert.ok(await profile(uid));
  await app.consent(token, { stats: false });
  assert.equal(await profile(uid), null);
});

test('the job picks missing, outdated and stale profiles up to the limit', async () => {
  const missing = await guest();
  const fresh = await guest();
  const touched = await guest();
  const stale = await guest();
  const declined = await guest(false);
  const gone = await guest();
  await sql('UPDATE users SET last_seen_at = NOW(3) - INTERVAL 13 MONTH WHERE id = ?', [gone.uid]);
  while (await refreshProfiles(app.pool, { limit: 1000 }));
  await sql('DELETE FROM player_profiles WHERE user_id = ?', [missing.uid]);
  await sql('UPDATE users SET last_seen_at = NOW(3) - INTERVAL 1 HOUR WHERE id = ?', [fresh.uid]);
  await sql('UPDATE player_profiles SET computed_at = NOW(3) - INTERVAL 1 HOUR WHERE user_id = ?', [touched.uid]);
  await sql('UPDATE users SET last_seen_at = NOW(3) - INTERVAL 30 MINUTE WHERE id = ?', [touched.uid]);
  await sql('UPDATE users SET last_seen_at = NOW(3) - INTERVAL 2 DAY WHERE id = ?', [stale.uid]);
  await sql('UPDATE player_profiles SET computed_at = NOW(3) - INTERVAL 25 HOUR WHERE user_id = ?', [stale.uid]);
  const computed = async (uid) => (await sql(
    'SELECT computed_at > NOW(3) - INTERVAL 1 MINUTE AS recent FROM player_profiles WHERE user_id = ?', [uid]))[0]?.recent ?? null;

  assert.equal(await refreshProfiles(app.pool, { limit: 2 }), 2);
  assert.equal(await computed(missing.uid), 1);
  assert.equal(await refreshProfiles(app.pool, { limit: 2 }), 1);
  assert.equal(await refreshProfiles(app.pool, { limit: 2 }), 0);
  assert.equal(await computed(touched.uid), 1);
  assert.equal(await computed(stale.uid), 1);
  assert.equal(await profile(declined.uid), null);
  assert.equal(await profile(gone.uid), null);
});

test('the daily purge removes profiles after 12 months without activity', async () => {
  const old = await guest();
  const recent = await guest();
  await refreshProfile(app.pool, old.uid);
  await refreshProfile(app.pool, recent.uid);
  await sql('UPDATE users SET last_seen_at = NOW(3) - INTERVAL 13 MONTH WHERE id = ?', [old.uid]);
  await sql('UPDATE users SET last_seen_at = NOW(3) - INTERVAL 11 MONTH WHERE id = ?', [recent.uid]);
  const { profiles } = await purgeRaw(app.pool, { batch: 1 });
  assert.ok(profiles >= 1);
  assert.equal(await profile(old.uid), null);
  assert.ok(await profile(recent.uid));
  assert.equal((await purgeRaw(app.pool)).profiles, 0);
});

async function lastArchive() {
  const [a] = await sql('SELECT * FROM player_archive ORDER BY id DESC LIMIT 1');
  return { ...a, heat: asJson(a.heat), segments: asJson(a.segments) };
}

async function playedGuest(stats) {
  const g = await guest(false);
  await app.consent(g.token, { stats });
  await sql('UPDATE users SET created_at = NOW(3) - INTERVAL 4 DAY WHERE id = ?', [g.uid]);
  assert.equal((await app.call('POST', '/session', { token: g.token, body: { tzOffset: 60, touch: true }, headers: { 'User-Agent': IPHONE } })).status, 200);
  assert.equal((await app.call('POST', '/runs', { token: g.token, body: RUN })).status, 200);
  assert.equal((await app.call('POST', '/spin', { token: g.token })).status, 200);
  return g;
}

test('the archive keeps context, heatmap and segments only with consent', async () => {
  const g = await playedGuest(true);
  await sql('UPDATE users SET last_seen_at = NOW(3) - INTERVAL 25 HOUR WHERE id = ?', [g.uid]);
  assert.ok(await cleanupGuests(app.pool) >= 1);
  const a = await lastArchive();
  assert.equal(a.reason, 'expired');
  assert.equal('user_id' in a, false);
  assert.deepEqual([a.device, a.os, a.browser, a.country, a.region], ['mobile', 'iOS', 'Safari', 'CH', 'GR']);
  assert.equal(a.heat.length, 168);
  assert.equal(a.heat.reduce((s, v) => s + v, 0), RUN.duration + PLAYTIME.spinSeconds);
  assert.ok(a.segments.includes('mobil'));
  assert.ok(a.segments.includes('neu'));

  const declined = await playedGuest(false);
  await sql('UPDATE users SET last_seen_at = NOW(3) - INTERVAL 25 HOUR WHERE id = ?', [declined.uid]);
  await cleanupGuests(app.pool);
  const b = await lastArchive();
  assert.equal(b.consent_stats, 0);
  assert.deepEqual([b.device, b.os, b.browser, b.country, b.region, b.heat, b.segments], [null, null, null, null, null, null, null]);
});

test('deleting the account archives without context even with consent', async () => {
  const g = await playedGuest(true);
  await refreshProfile(app.pool, g.uid);
  assert.equal((await app.call('POST', '/account/delete', { token: g.token, body: {} })).status, 200);
  const a = await lastArchive();
  assert.equal(a.reason, 'deleted');
  assert.equal(a.consent_stats, 1);
  assert.deepEqual([a.device, a.os, a.browser, a.country, a.region, a.heat, a.segments], [null, null, null, null, null, null, null]);
  assert.equal(await profile(g.uid), null);
});

test('logging in from a guest archives the guest without context', async () => {
  const owner = await guest(false);
  assert.equal((await app.call('POST', '/auth/signup', { token: owner.token, body: { username: 'Ziel', password: 'geheim123' } })).status, 200);
  const g = await playedGuest(true);
  const login = await app.call('POST', '/auth/login', { token: g.token, body: { username: 'Ziel', password: 'geheim123' } });
  assert.equal(login.status, 200);
  const a = await lastArchive();
  assert.equal(a.reason, 'guest_login');
  assert.equal(a.consent_stats, 1);
  assert.deepEqual([a.device, a.os, a.browser, a.country, a.region, a.heat, a.segments], [null, null, null, null, null, null, null]);
});
