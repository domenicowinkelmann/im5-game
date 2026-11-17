import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { migrate } from '../src/migrate.js';

let app;
before(async () => { app = await startServer(); });
after(async () => { await app.stop(); });

const columns = (table) => app.pool.query(
  'SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
  [app.config.db.database, table]);

test('migrate can run twice on an existing schema', async () => {
  await migrate(app.config.db);
  await migrate(app.config.db);
  const names = (await columns('users')).map((c) => c.name);
  for (const name of ['registered_at', 'session_no', 'session_started_at']) assert.ok(names.includes(name), name);
  assert.ok((await columns('spins')).some((c) => c.name === 'slot_ms'));
  assert.ok((await columns('runs')).some((c) => c.name === 'session_no'));
});

test('migrate removes events stored without consent or before the consent', async () => {
  const user = (stats, at) => app.pool.query(
    `INSERT INTO users (coins, consent_stats, consent_stats_at) VALUES (0, ?, ${at})`, [stats]);
  const { insertId: none } = await user(0, 'NULL');
  const { insertId: later } = await user(1, 'NOW(3) - INTERVAL 1 HOUR');
  const event = (uid, at) => app.pool.query(`INSERT INTO events (user_id, name, created_at) VALUES (?, 'run_start', ${at})`, [uid]);
  await event(none, 'NOW(3)');
  await event(later, 'NOW(3) - INTERVAL 2 HOUR');
  await event(later, 'NOW(3)');
  await migrate(app.config.db);
  const rows = await app.pool.query('SELECT user_id FROM events WHERE user_id IN (?, ?)', [none, later]);
  assert.deepEqual(rows.map((r) => Number(r.user_id)), [Number(later)]);
});

test('no column stores an ip address or a user agent', async () => {
  const rows = await app.pool.query(
    `SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND (COLUMN_NAME REGEXP '(^|_)(ip|ua)(_|$)|ip_?addr|user_?agent')`,
    [app.config.db.database]);
  assert.deepEqual(rows.map((r) => `${r.t}.${r.c}`), []);
});

test('the archive tables have no reference to a user', async () => {
  for (const table of ['player_archive', 'player_archive_days']) {
    const names = (await columns(table)).map((c) => c.name);
    assert.ok(names.length > 0, table);
    assert.equal(names.includes('user_id'), false, table);
  }
  const fks = await app.pool.query(
    `SELECT TABLE_NAME AS t, REFERENCED_TABLE_NAME AS r FROM information_schema.KEY_COLUMN_USAGE
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME LIKE 'player_archive%' AND REFERENCED_TABLE_NAME IS NOT NULL`,
    [app.config.db.database]);
  assert.deepEqual(fks.map((f) => `${f.t}->${f.r}`), ['player_archive_days->player_archive']);
});
