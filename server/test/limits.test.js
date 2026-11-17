import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createLimiters } from '../src/limits.js';

test('account deletion has its own per-user limit, independent of logins from the same ip', async () => {
  const limits = createLimiters({ isTest: false });
  const app = express();
  const auth = (req, res, next) => { req.user = { id: Number(req.get('x-user')) }; next(); };
  app.post('/login', limits.login, (req, res) => res.json({ ok: true }));
  app.post('/delete', auth, limits.accountDelete, (req, res) => res.json({ ok: true }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const hit = (path, user = 1) => fetch(`${base}${path}`, { method: 'POST', headers: { 'x-user': String(user) } }).then((r) => r.status);
  try {
    for (let i = 0; i < 20; i++) await hit('/login');
    assert.equal(await hit('/login'), 429);
    assert.equal(await hit('/delete'), 200);
    for (let i = 0; i < 9; i++) await hit('/delete');
    assert.equal(await hit('/delete'), 429);
    assert.equal(await hit('/delete', 2), 200);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
