import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { cleanupGuests, cleanupSessions, cleanup } from '../src/cleanup.js';
import { SEED_MARKER } from '../src/analytics/archive.js';
import { startJobs } from '../src/jobs.js';
import { migrate } from '../src/migrate.js';
import { PLAYTIME } from '../../src/shared/economy.js';

let app;
before(async () => { app = await startServer(); });
after(async () => { await app.stop(); });

const RUN = {
  distance: 1200, score: 1900, coins: 30, duration: 40, maxMultiplier: 2, tunnels: 1,
  cause: 'Baum erwischt', coinsByType: { bronze: 10, silver: 2, gold: 0, diamond: 0 },
};

async function guest() {
  const res = await app.call('POST', '/auth/guest', { body: {} });
  assert.equal(res.status, 200);
  return { token: res.body.token, uid: Number(res.body.profile.userId) };
}

const setSeen = (uid, hours) => app.pool.query(
  'UPDATE users SET last_seen_at = NOW(3) - INTERVAL ? HOUR WHERE id = ?', [hours, uid]);

async function exists(uid) {
  const [{ n }] = await app.pool.query('SELECT COUNT(*) AS n FROM users WHERE id = ?', [uid]);
  return n === 1;
}

async function archiveCount() {
  const [{ n }] = await app.pool.query('SELECT COUNT(*) AS n FROM player_archive');
  return n;
}

test('a guest inactive for 25 hours is archived and removed', async () => {
  const { token, uid } = await guest();
  await app.pool.query('UPDATE users SET created_at = UTC_DATE() - INTERVAL 4 DAY WHERE id = ?', [uid]);
  const first = await app.call('POST', '/runs', { token, body: RUN });
  assert.equal(first.status, 200);
  await app.pool.query('UPDATE users SET last_run_at = NOW(3) - INTERVAL 1 HOUR WHERE id = ?', [uid]);
  const second = await app.call('POST', '/runs', { token, body: RUN });
  assert.equal(second.status, 200);
  assert.equal((await app.call('POST', '/spin', { token })).status, 200);
  await app.pool.query('UPDATE runs SET doubled = 1, doubled_at = NOW(3) WHERE public_id = ?', [second.body.runId]);
  await app.pool.query(
    'UPDATE runs SET created_at = UTC_DATE() - INTERVAL 3 DAY + INTERVAL 10 HOUR WHERE public_id = ?', [first.body.runId]);
  await app.pool.query(
    `UPDATE runs SET created_at = UTC_DATE() - INTERVAL 2 DAY + INTERVAL 9 HOUR,
       doubled_at = UTC_DATE() - INTERVAL 2 DAY + INTERVAL 9 HOUR + INTERVAL 1 MINUTE WHERE public_id = ?`,
    [second.body.runId]);
  await app.pool.query('UPDATE spins SET created_at = UTC_DATE() - INTERVAL 2 DAY + INTERVAL 11 HOUR WHERE user_id = ?', [uid]);
  await app.pool.query('UPDATE users SET session_no = 3 WHERE id = ?', [uid]);
  await setSeen(uid, 25);

  const before = await archiveCount();
  assert.equal(await cleanupGuests(app.pool), 1);
  assert.equal(await exists(uid), false);
  assert.equal(await archiveCount(), before + 1);
  for (const table of ['sessions', 'runs', 'spins', 'inventory', 'loadout', 'events']) {
    const [{ n }] = await app.pool.query(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`, [uid]);
    assert.equal(n, 0, table);
  }
  assert.equal((await app.call('GET', '/me', { token })).status, 401);

  const [a] = await app.pool.query(
    `SELECT *, archived_on = UTC_DATE() AS today, first_day = UTC_DATE() - INTERVAL 4 DAY AS first_ok,
       last_day = DATE(NOW(3) - INTERVAL 25 HOUR) AS last_ok
     FROM player_archive ORDER BY id DESC LIMIT 1`);
  assert.equal(a.reason, 'expired');
  assert.equal(a.today, 1);
  assert.equal(a.first_ok, 1);
  assert.equal(a.last_ok, 1);
  assert.equal(a.registered, 0);
  assert.equal(a.consent_stats, 0);
  assert.equal(a.sessions, 3);
  assert.equal(a.runs, 2);
  assert.equal(a.spins, 1);
  assert.equal(a.doubled, 1);
  assert.equal(a.interstitials, 0);
  assert.equal(a.play_s, RUN.duration * 2 + PLAYTIME.spinSeconds);
  for (const key of ['nudges', 'device', 'os', 'browser', 'country', 'region', 'heat', 'segments']) {
    assert.equal(a[key], null, key);
  }
  assert.equal('user_id' in a, false);

  const days = await app.pool.query(
    `SELECT DATEDIFF(UTC_DATE(), day) AS ago, runs, flight_s, spins, slot_s, doubled, interstitials, nudges_shown, nudges_clicked
     FROM player_archive_days WHERE archive_id = ? ORDER BY day`,
    [a.id]);
  assert.deepEqual(days.map((d) => ({ ...d })), [
    { ago: 3, runs: 1, flight_s: 40, spins: 0, slot_s: 0, doubled: 0, interstitials: 0, nudges_shown: 0, nudges_clicked: 0 },
    { ago: 2, runs: 1, flight_s: 40, spins: 1, slot_s: PLAYTIME.spinSeconds, doubled: 1, interstitials: 0, nudges_shown: 0, nudges_clicked: 0 },
  ]);
});

test('a guest inactive for 23 hours stays', async () => {
  const { token, uid } = await guest();
  await setSeen(uid, 23);
  const before = await archiveCount();
  await cleanupGuests(app.pool);
  assert.equal(await exists(uid), true);
  assert.equal(await archiveCount(), before);
  assert.equal((await app.call('GET', '/me', { token })).status, 200);
});

test('registered players stay even after 30 days', async () => {
  const { token, uid } = await guest();
  const signup = await app.call('POST', '/auth/signup', { token, body: { username: 'Treu', password: 'geheim123' } });
  assert.equal(signup.status, 200);
  await setSeen(uid, 30 * 24);
  await cleanupGuests(app.pool);
  assert.equal(await exists(uid), true);
  assert.equal((await app.call('GET', '/me', { token: signup.body.token })).status, 200);
});

test('a second run changes nothing', async () => {
  const { uid } = await guest();
  await setSeen(uid, 48);
  assert.equal(await cleanupGuests(app.pool), 1);
  const before = await archiveCount();
  assert.equal(await cleanupGuests(app.pool), 0);
  assert.equal(await archiveCount(), before);
});

test('guests are removed in batches until none is left', async () => {
  const ids = [];
  for (let i = 0; i < 7; i++) {
    const { insertId } = await app.pool.query(
      'INSERT INTO users (coins, created_at, last_seen_at) VALUES (0, NOW(3) - INTERVAL 3 DAY, NOW(3) - INTERVAL ? HOUR)',
      [25 + i]);
    ids.push(insertId);
  }
  const before = await archiveCount();
  const [{ last }] = await app.pool.query('SELECT COALESCE(MAX(id), 0) AS last FROM player_archive');
  assert.equal(await cleanupGuests(app.pool, { batch: 2 }), ids.length);
  for (const id of ids) assert.equal(await exists(id), false);
  assert.equal(await archiveCount(), before + ids.length);
  const [{ n }] = await app.pool.query('SELECT COUNT(*) AS n FROM player_archive_days WHERE archive_id > ?', [last]);
  assert.equal(n, 0);
});

test('demo guests keep the seed marker when the cleanup archives them', async () => {
  const { token, uid } = await guest();
  await app.pool.query('UPDATE users SET created_at = NOW(3) - INTERVAL 2 DAY WHERE id = ?', [uid]);
  assert.equal((await app.call('POST', '/runs', { token, body: RUN })).status, 200);
  await app.pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [SEED_MARKER, uid]);
  const real = await guest();
  await setSeen(uid, 25);
  await setSeen(real.uid, 25);
  const [{ last }] = await app.pool.query('SELECT COALESCE(MAX(id), 0) AS last FROM player_archive');
  assert.equal(await cleanupGuests(app.pool), 2);
  assert.equal(await exists(uid), false);
  const rows = await app.pool.query('SELECT id, reason, runs FROM player_archive WHERE id > ? ORDER BY id', [last]);
  assert.deepEqual(rows.map(({ reason, runs }) => ({ reason, runs })), [{ reason: 'seed', runs: 1 }, { reason: 'expired', runs: 0 }]);
  const [{ n }] = await app.pool.query('SELECT COUNT(*) AS n FROM player_archive_days WHERE archive_id = ?', [rows[0].id]);
  assert.equal(n, 1);
  await app.pool.query("DELETE FROM player_archive WHERE reason = 'seed'");
  const [{ remaining }] = await app.pool.query('SELECT COUNT(*) AS remaining FROM player_archive_days WHERE archive_id = ?', [rows[0].id]);
  assert.equal(remaining, 0);
});

test('expired login sessions are deleted', async () => {
  const { token, uid } = await guest();
  await app.pool.query('UPDATE sessions SET expires_at = NOW(3) - INTERVAL 1 MINUTE WHERE user_id = ?', [uid]);
  assert.equal(await cleanupSessions(app.pool), 1);
  assert.equal((await app.call('GET', '/me', { token })).status, 401);
  assert.equal(await exists(uid), true);
  assert.deepEqual(await cleanup(app.pool, app.config), { sessions: 0, guests: 0 });
});

test('jobs never overlap', async () => {
  const { uid } = await guest();
  await setSeen(uid, 25);
  const jobs = startJobs(app.pool, app.config);
  try {
    assert.equal(await jobs.run(), false);
    while (!(await jobs.run())) await new Promise((r) => setTimeout(r, 10));
  } finally {
    jobs.stop();
  }
  assert.equal(await exists(uid), false);
});

test('the first start after an update keeps guests who played recently', async () => {
  const { token, uid } = await guest();
  await app.pool.query('UPDATE users SET created_at = NOW(3) - INTERVAL 3 DAY WHERE id = ?', [uid]);
  assert.equal((await app.call('POST', '/runs', { token, body: RUN })).status, 200);
  assert.equal((await app.call('POST', '/spin', { token })).status, 200);
  await app.pool.query('UPDATE runs SET created_at = NOW(3) - INTERVAL 2 HOUR WHERE user_id = ?', [uid]);
  await app.pool.query('UPDATE spins SET created_at = NOW(3) - INTERVAL 1 HOUR WHERE user_id = ?', [uid]);
  await setSeen(uid, 30);
  await migrate(app.config.db);
  const [{ idle }] = await app.pool.query(
    'SELECT TIMESTAMPDIFF(MINUTE, last_seen_at, NOW(3)) AS idle FROM users WHERE id = ?', [uid]);
  assert.ok(idle >= 59 && idle <= 61, `idle ${idle}`);
  await cleanupGuests(app.pool);
  assert.equal(await exists(uid), true);
  await migrate(app.config.db);
  const [{ again }] = await app.pool.query(
    'SELECT TIMESTAMPDIFF(MINUTE, last_seen_at, NOW(3)) AS again FROM users WHERE id = ?', [uid]);
  assert.equal(again, idle);
});
