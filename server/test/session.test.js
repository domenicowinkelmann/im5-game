import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { purgeRaw } from '../src/analytics/purge.js';
import { SESSION, PRIVACY } from '../../src/shared/economy.js';

const SAFARI_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const HEADLESS = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/130.0.0.0 Safari/537.36';
const CONTEXT = {
  tzOffset: 60, timeZone: 'Europe/Zurich', locale: 'de-CH', screen: 's', touch: true,
  referrer: 'www.google.ch', utm: { source: 'insta', medium: 'story', campaign: 'herbst' },
};

const seen = [];
const geo = { lookup: (ip) => { seen.push(ip); return { country: 'CH', region: 'GR' }; } };

let app;
before(async () => { app = await startServer({ geo }); });
after(async () => { await app.stop(); });

async function guest() {
  const res = await app.call('POST', '/auth/guest', { body: {} });
  assert.equal(res.status, 200);
  return { token: res.body.token, uid: Number(res.body.profile.userId) };
}

const session = (token, body = CONTEXT, ua = SAFARI_IPHONE) =>
  app.call('POST', '/session', { token, body, headers: { 'User-Agent': ua } });

const rows = (uid) => app.pool.query('SELECT * FROM play_sessions WHERE user_id = ? ORDER BY session_no', [uid]);

const tzOf = async (uid) => (await app.pool.query('SELECT tz_offset_min FROM users WHERE id = ?', [uid]))[0].tz_offset_min;

test('without stats consent nothing is stored', async () => {
  const { token, uid } = await guest();
  assert.deepEqual(await session(token), { status: 200, body: { ok: true } });
  await app.consent(token, { stats: false, adult: true });
  assert.deepEqual(await session(token), { status: 200, body: { ok: true } });
  assert.equal((await rows(uid)).length, 0);
  assert.equal(await tzOf(uid), null);
});

test('with consent the session row stores families and the stubbed location only', async () => {
  const { token, uid } = await guest();
  await app.consent(token, { stats: true });
  seen.length = 0;
  assert.deepEqual(await session(token), { status: 200, body: { ok: true } });
  const [row] = await rows(uid);
  const [user] = await app.pool.query('SELECT session_no, session_started_at FROM users WHERE id = ?', [uid]);
  assert.equal(row.session_no, user.session_no);
  assert.equal(row.started_at.getTime(), user.session_started_at.getTime());
  assert.ok(row.last_active_at instanceof Date);
  assert.deepEqual({
    tz: row.tz_offset_min, zone: row.time_zone, locale: row.locale, device: row.device, os: row.os, browser: row.browser,
    screen: row.screen, touch: row.touch, referrer: row.referrer, utm: [row.utm_source, row.utm_medium, row.utm_campaign],
    country: row.country, region: row.region,
  }, {
    tz: 60, zone: 'Europe/Zurich', locale: 'de-CH', device: 'mobile', os: 'iOS', browser: 'Safari',
    screen: 's', touch: 1, referrer: 'www.google.ch', utm: ['insta', 'story', 'herbst'], country: 'CH', region: 'GR',
  });
  assert.equal(await tzOf(uid), 60);

  assert.equal(seen.length, 1);
  const stored = JSON.stringify(Object.values(row));
  assert.ok(!stored.includes(seen[0]), 'ip stored');
  assert.ok(!stored.includes('Mozilla') && !stored.includes('AppleWebKit'), 'user agent stored');
});

test('a reload in the same session updates the row and keeps referrer and utm', async () => {
  const { token, uid } = await guest();
  await app.consent(token, { stats: true });
  await session(token);
  await app.pool.query('UPDATE play_sessions SET last_active_at = last_active_at - INTERVAL 5 MINUTE WHERE user_id = ?', [uid]);
  const [before] = await rows(uid);
  await session(token, { ...CONTEXT, tzOffset: 120, screen: 'l', referrer: null, utm: null });
  const all = await rows(uid);
  assert.equal(all.length, 1);
  assert.equal(all[0].tz_offset_min, 120);
  assert.equal(all[0].screen, 'l');
  assert.equal(all[0].referrer, 'www.google.ch');
  assert.equal(all[0].utm_source, 'insta');
  assert.ok(all[0].last_active_at > before.last_active_at);
  assert.equal(await tzOf(uid), 120);
});

test('invalid values are dropped and a non-object body is rejected', async () => {
  const { token, uid } = await guest();
  await app.consent(token, { stats: true });
  const res = await session(token, { tzOffset: 9999, timeZone: '<script>', locale: 42, screen: 'xxl', touch: 'ja', referrer: 'https://x.ch/a', utm: [1] });
  assert.equal(res.status, 200);
  const [row] = await rows(uid);
  assert.deepEqual([row.tz_offset_min, row.time_zone, row.locale, row.screen, row.touch, row.referrer, row.utm_source],
    [null, null, null, null, null, null, null]);
  assert.equal(row.device, 'mobile');
  assert.equal(await tzOf(uid), null);
  assert.deepEqual(await app.call('POST', '/session', { token, body: [1, 2] }), { status: 400, body: { error: 'Ungültige Anfrage' } });
  assert.equal((await app.call('POST', '/session', { body: CONTEXT })).status, 401);
});

test('bots are ignored', async () => {
  const { token, uid } = await guest();
  await app.consent(token, { stats: true });
  seen.length = 0;
  assert.deepEqual(await session(token, CONTEXT, HEADLESS), { status: 200, body: { ok: true } });
  assert.equal((await rows(uid)).length, 0);
  assert.equal(await tzOf(uid), null);
  assert.equal(seen.length, 0);
});

const goIdle = (uid, seconds) => app.pool.query(
  'UPDATE users SET last_seen_at = NOW(3) - INTERVAL ? SECOND, session_started_at = NOW(3) - INTERVAL ? SECOND WHERE id = ?',
  [seconds, seconds + 600, uid]);

test('a new session takes over the context of the previous one only with consent', async () => {
  const { token, uid } = await guest();
  await app.consent(token, { stats: true });
  await session(token);
  await goIdle(uid, (SESSION.timeoutMinutes + 1) * 60);
  await app.call('GET', '/me', { token });
  const all = await rows(uid);
  assert.deepEqual(all.map((r) => r.session_no), [1, 2]);
  const [first, second] = all;
  for (const key of ['tz_offset_min', 'time_zone', 'locale', 'device', 'os', 'browser', 'screen', 'touch', 'country', 'region']) {
    assert.equal(second[key], first[key], key);
  }
  assert.deepEqual([second.referrer, second.utm_source, second.utm_medium, second.utm_campaign], [null, null, null, null]);
  const [user] = await app.pool.query('SELECT session_started_at FROM users WHERE id = ?', [uid]);
  assert.equal(second.started_at.getTime(), user.session_started_at.getTime());

  const other = await guest();
  await app.consent(other.token, { stats: false, adult: true });
  await goIdle(other.uid, (SESSION.timeoutMinutes + 1) * 60);
  await app.call('GET', '/me', { token: other.token });
  assert.equal((await rows(other.uid)).length, 0);
});

test('a new session without earlier context still gets a row with the stored offset', async () => {
  const { token, uid } = await guest();
  await app.consent(token, { stats: true });
  await app.pool.query('UPDATE users SET tz_offset_min = -300 WHERE id = ?', [uid]);
  await goIdle(uid, (SESSION.timeoutMinutes + 1) * 60);
  await app.call('GET', '/me', { token });
  const all = await rows(uid);
  assert.equal(all.length, 1);
  assert.equal(all[0].session_no, 2);
  assert.equal(all[0].tz_offset_min, -300);
  assert.equal(all[0].device, null);
});

test('activity moves last_active_at with the same throttle', async () => {
  const { token, uid } = await guest();
  await app.consent(token, { stats: true });
  await session(token);
  const age = async () => (await app.pool.query(
    'SELECT TIMESTAMPDIFF(SECOND, last_active_at, NOW(3)) AS age FROM play_sessions WHERE user_id = ?', [uid]))[0].age;
  await app.pool.query('UPDATE play_sessions SET last_active_at = NOW(3) - INTERVAL 10 MINUTE WHERE user_id = ?', [uid]);
  await app.pool.query('UPDATE users SET last_seen_at = NOW(3) - INTERVAL 30 SECOND WHERE id = ?', [uid]);
  await app.call('GET', '/me', { token });
  assert.ok(await age() >= 590);
  await app.pool.query('UPDATE users SET last_seen_at = NOW(3) - INTERVAL 120 SECOND WHERE id = ?', [uid]);
  await app.call('GET', '/me', { token });
  assert.ok(await age() <= 1);
});

test('the purge removes events and sessions older than the retention only', async () => {
  const { token, uid } = await guest();
  await app.consent(token, { stats: true });
  await session(token);
  for (let i = 0; i < 5; i++) await app.call('POST', '/events', { token, body: { name: 'run_start' } });
  await app.pool.query(
    `INSERT INTO play_sessions (user_id, session_no, started_at, last_active_at)
     VALUES (?, 90, NOW(3) - INTERVAL ? DAY, NOW(3) - INTERVAL ? DAY), (?, 91, NOW(3) - INTERVAL ? DAY, NOW(3) - INTERVAL ? DAY)`,
    [uid, PRIVACY.retention.sessionsDays + 1, PRIVACY.retention.sessionsDays + 1, uid, PRIVACY.retention.sessionsDays - 1, PRIVACY.retention.sessionsDays - 1]);
  await app.pool.query(
    `UPDATE events SET created_at = NOW(3) - INTERVAL ? DAY WHERE user_id = ? ORDER BY id LIMIT 3`,
    [PRIVACY.retention.eventsDays + 1, uid]);

  const result = await purgeRaw(app.pool, { batch: 2 });
  assert.ok(result.events >= 3 && result.sessions >= 1, JSON.stringify(result));
  const [{ n: events }] = await app.pool.query('SELECT COUNT(*) AS n FROM events WHERE user_id = ?', [uid]);
  assert.equal(events, 2);
  assert.deepEqual((await rows(uid)).map((r) => r.session_no), [1, 91]);
  assert.deepEqual(await purgeRaw(app.pool), { events: 0, sessions: 0, decisions: 0, profiles: 0 });
});

test('withdrawing stats deletes the play sessions', async () => {
  const { token, uid } = await guest();
  const other = await guest();
  await app.consent(token, { stats: true });
  await app.consent(other.token, { stats: true });
  await session(token);
  await session(other.token);
  await app.consent(token, { stats: false });
  assert.equal((await rows(uid)).length, 0);
  assert.equal(await tzOf(uid), null);
  assert.equal((await rows(other.uid)).length, 1);
  await session(token);
  assert.equal((await rows(uid)).length, 0);
});

test('deleting a user removes the play sessions', async () => {
  const { token, uid } = await guest();
  await app.consent(token, { stats: true });
  await session(token);
  assert.equal((await app.call('POST', '/account/delete', { token, body: {} })).status, 200);
  assert.equal((await rows(uid)).length, 0);
});
