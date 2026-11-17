import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

const REST = new URL('../../src/api/restApi.js', import.meta.url);
const EXPIRED = 'Sitzung abgelaufen. Melde dich erneut an, um dein Konto zu löschen.';

let app;
let loads = 0;
const store = new Map();
const realFetch = globalThis.fetch;

before(async () => {
  app = await startServer();
  globalThis.fetch = (url, init) => realFetch(String(url).replace(/^\/api/, app.base), init);
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
  globalThis.fetch = realFetch;
  delete globalThis.localStorage;
  await app.stop();
});

async function freshRest() {
  store.clear();
  loads += 1;
  return (await import(`${REST.href}?load=${loads}`)).restApi;
}

const userCount = async (uid) => (await app.pool.query('SELECT COUNT(*) AS n FROM users WHERE id = ?', [uid]))[0].n;
const token = () => store.get('wingrush.token');

test('rest deleteAccount removes a guest and starts a new one', async () => {
  const api = await freshRest();
  const first = await api.getMe();
  const res = await api.deleteAccount();
  assert.equal(await userCount(first.userId), 0);
  assert.notEqual(res.profile.userId, first.userId);
  assert.equal(res.profile.username, null);
});

test('rest deleteAccount treats an already purged guest as deleted', async () => {
  const api = await freshRest();
  const first = await api.getMe();
  await app.pool.query('DELETE FROM users WHERE id = ?', [first.userId]);
  const res = await api.deleteAccount();
  assert.notEqual(res.profile.userId, first.userId);
});

test('rest deleteAccount never confirms a deletion for an expired registered session', async () => {
  const api = await freshRest();
  const guest = await api.getMe();
  await api.signup('Abgelaufen', 'geheim123');
  const old = token();
  await app.pool.query('UPDATE sessions SET expires_at = NOW(3) - INTERVAL 1 MINUTE WHERE user_id = ?', [guest.userId]);
  await assert.rejects(api.deleteAccount('geheim123'), { status: 401, message: EXPIRED });
  assert.equal(await userCount(guest.userId), 1);
  assert.equal(token(), undefined);
  assert.equal(api.takeSessionNotice(), null);

  const relogin = await api.login('Abgelaufen', 'geheim123');
  assert.equal(relogin.profile.userId, guest.userId);
  assert.notEqual(token(), old);
  await api.deleteAccount('geheim123');
  assert.equal(await userCount(guest.userId), 0);
});

test('rest deleteAccount without a stored token does not report a deletion', async () => {
  const api = await freshRest();
  const guest = await api.getMe();
  await api.signup('Ohnetoken', 'geheim123');
  store.delete('wingrush.token');
  await assert.rejects(api.deleteAccount('geheim123'), { status: 401, message: EXPIRED });
  assert.equal(await userCount(guest.userId), 1);
});
