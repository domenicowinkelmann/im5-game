import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, PROFILE_KEYS } from './helpers.js';
import { PRIVACY, EVENTS } from '../../src/shared/economy.js';

let app;
before(async () => { app = await startServer(); });
after(async () => { await app.stop(); });

const RUN_END = { accepted: true, duration: 40.5, distance: 1200, cause: 'Baum erwischt', score: 1900, coins: 30, extra: 'x' };

async function guest() {
  const res = await app.call('POST', '/auth/guest', { body: {} });
  assert.equal(res.status, 200);
  return { token: res.body.token, uid: Number(res.body.profile.userId), profile: res.body.profile };
}

async function registered(username, password = 'geheim123') {
  const g = await guest();
  const res = await app.call('POST', '/auth/signup', { token: g.token, body: { username, password } });
  assert.equal(res.status, 200);
  return { token: res.body.token, uid: g.uid };
}

const user = async (uid) => (await app.pool.query(
  `SELECT consent_version, consent_stats, consent_personal, age_16plus, consent_at, consent_stats_at, tz_offset_min
   FROM users WHERE id = ?`, [uid]))[0];

async function events(uid) {
  return app.pool.query('SELECT name, data FROM events WHERE user_id = ? ORDER BY id', [uid]);
}

const track = (token, name, data) => app.call('POST', '/events', { token, body: { name, data } });

test('a new guest has not decided yet', async () => {
  const { token, profile } = await guest();
  assert.deepEqual(Object.keys(profile).sort(), PROFILE_KEYS);
  assert.deepEqual(profile.consent, { decided: false, stats: false, personal: false, adult: false });
  assert.deepEqual((await app.call('GET', '/me', { token })).body.consent, profile.consent);
});

test('consent validates booleans and personal needs stats and age', async () => {
  const { token, uid } = await guest();
  for (const body of [{}, { stats: 1, personal: false, adult: false }, { stats: true, personal: 'ja', adult: true }, { stats: true, personal: true }]) {
    assert.deepEqual(await app.call('POST', '/consent', { token, body }), { status: 400, body: { error: 'Ungültige Anfrage' } }, JSON.stringify(body));
  }
  assert.equal((await user(uid)).consent_version, 0);

  const noAge = await app.consent(token, { stats: true, personal: true, adult: false });
  assert.equal(noAge.status, 200);
  assert.deepEqual(noAge.body.profile.consent, { decided: true, stats: true, personal: false, adult: false });
  assert.deepEqual(Object.keys(noAge.body.profile).sort(), PROFILE_KEYS);

  const noStats = await app.consent(token, { stats: false, personal: true, adult: true });
  assert.deepEqual(noStats.body.profile.consent, { decided: true, stats: false, personal: false, adult: true });

  const all = await app.consent(token, { stats: true, personal: true, adult: true });
  assert.deepEqual(all.body.profile.consent, { decided: true, stats: true, personal: true, adult: true });
  const row = await user(uid);
  assert.equal(row.consent_version, PRIVACY.version);
  assert.deepEqual([row.consent_stats, row.consent_personal, row.age_16plus], [1, 1, 1]);
  assert.ok(row.consent_at instanceof Date);
  assert.equal((await app.call('POST', '/consent', { body: { stats: true, personal: false, adult: false } })).status, 401);
});

test('an outdated consent version counts as undecided', async () => {
  const { token, uid } = await guest();
  await app.consent(token, { stats: true });
  await app.pool.query('UPDATE users SET consent_version = ? WHERE id = ?', [PRIVACY.version - 1, uid]);
  assert.deepEqual((await app.call('GET', '/me', { token })).body.consent, { decided: false, stats: true, personal: false, adult: false });
});

test('consent_stats_at is only set when stats switches from off to on', async () => {
  const { token, uid } = await guest();
  await app.consent(token, { stats: false });
  assert.equal((await user(uid)).consent_stats_at, null);

  await app.consent(token, { stats: true });
  const first = (await user(uid)).consent_stats_at;
  assert.ok(first instanceof Date);
  await app.pool.query('UPDATE users SET consent_stats_at = consent_stats_at - INTERVAL 1 HOUR WHERE id = ?', [uid]);
  const aged = (await user(uid)).consent_stats_at;

  await app.consent(token, { stats: true, adult: true, personal: true });
  assert.equal((await user(uid)).consent_stats_at.getTime(), aged.getTime());

  await app.consent(token, { stats: false });
  assert.equal((await user(uid)).consent_stats_at, null);
  await app.consent(token, { stats: true });
  const again = (await user(uid)).consent_stats_at;
  assert.ok(again.getTime() > aged.getTime());
});

test('without consent events are accepted but not stored', async () => {
  const { token, uid } = await guest();
  assert.deepEqual(await track(token, 'run_end', RUN_END), { status: 200, body: { ok: true } });
  assert.deepEqual(await track(token, 'screen_view', { screen: 'menu' }), { status: 200, body: { ok: true } });
  await app.consent(token, { stats: false, adult: true });
  assert.deepEqual(await track(token, 'run_start'), { status: 200, body: { ok: true } });
  assert.equal((await events(uid)).length, 0);
});

test('with stats consent events are stored and reduced to the allowed fields', async () => {
  const { token, uid } = await guest();
  await app.consent(token, { stats: true });
  assert.equal((await track(token, 'run_end', RUN_END)).status, 200);
  assert.equal((await track(token, 'run_start', { runs: 3 })).status, 200);
  assert.equal((await track(token, 'screen_view', { screen: 'x'.repeat(100), userAgent: 'Mozilla' })).status, 200);
  assert.equal((await track(token, 'rewarded_ad_start', { placement: { nested: true } })).status, 200);
  const rows = await events(uid);
  assert.deepEqual(rows.map((r) => r.name), ['run_end', 'run_start', 'screen_view', 'rewarded_ad_start']);
  const data = rows.map((r) => (typeof r.data === 'string' ? JSON.parse(r.data) : r.data));
  assert.deepEqual(data[0], { accepted: true, duration: 40.5, distance: 1200, cause: 'Baum erwischt' });
  assert.equal(data[1], null);
  assert.deepEqual(Object.keys(data[2]), EVENTS.screen_view);
  assert.ok(data[2].screen.length < 100);
  assert.equal(data[3], null);
});

test('unknown or redundant event names are rejected', async () => {
  const { token, uid } = await guest();
  await app.consent(token, { stats: true });
  for (const name of ['new_highscore', 'slot_spin', 'signup', 'consent_changed', 'menu_open', 'constructor', '__proto__']) {
    assert.deepEqual(await track(token, name, {}), { status: 400, body: { error: 'Ungültiges Ereignis' } }, name);
  }
  const fresh = await guest();
  assert.equal((await track(fresh.token, 'new_highscore', {})).status, 400);
  assert.equal((await events(uid)).length, 0);
});

test('withdrawing stats deletes events and the time zone offset', async () => {
  const { token, uid } = await guest();
  const other = await guest();
  await app.consent(token, { stats: true, personal: true, adult: true });
  await app.consent(other.token, { stats: true });
  await track(token, 'run_start');
  await track(token, 'screen_view', { screen: 'slots' });
  await track(other.token, 'run_start');
  await app.pool.query('UPDATE users SET tz_offset_min = 60 WHERE id IN (?, ?)', [uid, other.uid]);
  assert.equal((await events(uid)).length, 2);

  const res = await app.consent(token, { stats: false, personal: true, adult: true });
  assert.deepEqual(res.body.profile.consent, { decided: true, stats: false, personal: false, adult: true });
  assert.equal((await events(uid)).length, 0);
  const row = await user(uid);
  assert.equal(row.tz_offset_min, null);
  assert.equal(row.consent_personal, 0);
  assert.equal((await events(other.uid)).length, 1);
  assert.equal((await user(other.uid)).tz_offset_min, 60);

  await track(token, 'run_start');
  assert.equal((await events(uid)).length, 0);
});

test('a guest can delete the account without a password', async () => {
  const { token, uid } = await guest();
  await app.consent(token, { stats: true });
  await track(token, 'run_start');
  const [{ last }] = await app.pool.query('SELECT COALESCE(MAX(id), 0) AS last FROM player_archive');
  assert.deepEqual(await app.call('POST', '/account/delete', { token, body: {} }), { status: 200, body: { ok: true } });
  const [{ n }] = await app.pool.query('SELECT COUNT(*) AS n FROM users WHERE id = ?', [uid]);
  assert.equal(n, 0);
  assert.equal((await events(uid)).length, 0);
  const archived = await app.pool.query(
    'SELECT reason, registered, consent_stats, device, os, browser, country, region, heat, segments FROM player_archive WHERE id > ?', [last]);
  assert.equal(archived.length, 1);
  assert.deepEqual({ ...archived[0] }, {
    reason: 'deleted', registered: 0, consent_stats: 1, device: null, os: null, browser: null, country: null, region: null, heat: null, segments: null,
  });
  assert.deepEqual(await app.call('GET', '/me', { token }), { status: 401, body: { error: 'Nicht angemeldet' } });
  assert.equal((await app.call('POST', '/account/delete', { token, body: {} })).status, 401);
});

test('a registered account needs the right password to be deleted', async () => {
  const { token, uid } = await registered('Loescher');
  const [{ last }] = await app.pool.query('SELECT COALESCE(MAX(id), 0) AS last FROM player_archive');
  for (const body of [{}, { password: '' }, { password: 'falsch123' }, { password: 42 }, { password: 'x'.repeat(200) }]) {
    assert.deepEqual(await app.call('POST', '/account/delete', { token, body }), { status: 400, body: { error: 'Passwort falsch' } }, JSON.stringify(body).slice(0, 40));
  }
  assert.equal((await app.call('GET', '/me', { token })).status, 200);
  assert.deepEqual(await app.call('POST', '/account/delete', { token, body: { password: 'geheim123' } }), { status: 200, body: { ok: true } });
  const [{ n }] = await app.pool.query('SELECT COUNT(*) AS n FROM users WHERE id = ?', [uid]);
  assert.equal(n, 0);
  const archived = await app.pool.query('SELECT reason, registered, consent_stats FROM player_archive WHERE id > ?', [last]);
  assert.deepEqual(archived.map((a) => ({ ...a })), [{ reason: 'deleted', registered: 1, consent_stats: 0 }]);
  assert.equal((await app.call('GET', '/me', { token })).status, 401);
  const login = await app.call('POST', '/auth/login', { body: { username: 'Loescher', password: 'geheim123' } });
  assert.equal(login.status, 401);
});
