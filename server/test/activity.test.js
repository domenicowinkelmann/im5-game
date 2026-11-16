import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { SESSION } from '../../src/shared/economy.js';

let app;
before(async () => { app = await startServer(); });
after(async () => { await app.stop(); });

async function guest() {
  const res = await app.call('POST', '/auth/guest', { body: {} });
  assert.equal(res.status, 200);
  return { token: res.body.token, uid: Number(res.body.profile.userId) };
}

const setIdle = (uid, seconds) => app.pool.query(
  'UPDATE users SET last_seen_at = NOW(3) - INTERVAL ? SECOND, session_started_at = NOW(3) - INTERVAL ? SECOND WHERE id = ?',
  [seconds, seconds + 600, uid]);

async function activity(uid) {
  const [row] = await app.pool.query(
    `SELECT session_no, TIMESTAMPDIFF(SECOND, last_seen_at, NOW(3)) AS idle,
       TIMESTAMPDIFF(SECOND, session_started_at, NOW(3)) AS session_age
     FROM users WHERE id = ?`,
    [uid]);
  return row;
}

test('requests within a minute do not write last_seen_at', async () => {
  const { token, uid } = await guest();
  await setIdle(uid, 30);
  assert.equal((await app.call('GET', '/me', { token })).status, 200);
  const row = await activity(uid);
  assert.ok(row.idle >= 30, `idle ${row.idle}`);
  assert.equal(row.session_no, 1);
});

test('last_seen_at is refreshed after two minutes without a new session', async () => {
  const { token, uid } = await guest();
  await setIdle(uid, 120);
  await app.call('GET', '/me', { token });
  const row = await activity(uid);
  assert.ok(row.idle <= 1, `idle ${row.idle}`);
  assert.equal(row.session_no, 1);
  assert.ok(row.session_age >= 700);
});

test('a new session starts after the idle timeout', async () => {
  const { token, uid } = await guest();
  await setIdle(uid, (SESSION.timeoutMinutes + 1) * 60);
  await app.call('GET', '/me', { token });
  const row = await activity(uid);
  assert.equal(row.session_no, 2);
  assert.ok(row.idle <= 1);
  assert.ok(row.session_age <= 1);
  await app.call('GET', '/me', { token });
  assert.equal((await activity(uid)).session_no, 2);
});

test('parallel requests after the timeout count the session only once', async () => {
  const { token, uid } = await guest();
  await setIdle(uid, (SESSION.timeoutMinutes + 1) * 60);
  const results = await Promise.all(Array.from({ length: 8 }, () => app.call('GET', '/me', { token })));
  assert.ok(results.every((r) => r.status === 200));
  assert.equal((await activity(uid)).session_no, 2);
});

test('login does not touch the session it replaces', async () => {
  const { token, uid } = await guest();
  const signup = await app.call('POST', '/auth/signup', { token, body: { username: 'Pendler', password: 'geheim123' } });
  assert.equal(signup.status, 200);
  await setIdle(uid, (SESSION.timeoutMinutes + 1) * 60);
  const login = await app.call('POST', '/auth/login', { token: signup.body.token, body: { username: 'Pendler', password: 'geheim123' } });
  assert.equal(login.status, 200);
  const row = await activity(uid);
  assert.equal(row.session_no, 1);
  assert.ok(row.idle >= SESSION.timeoutMinutes * 60);
  await app.call('GET', '/me', { token: login.body.token });
  assert.equal((await activity(uid)).session_no, 2);
});
