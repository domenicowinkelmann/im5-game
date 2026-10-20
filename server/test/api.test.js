import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { START_COINS, SPIN_COST, DOUBLE, RUN_LIMITS, PLAYTIME } from '../../src/shared/economy.js';
import { DEFAULT_LOADOUT, ITEMS } from '../../src/shared/items.js';

let app;
before(async () => { app = await startServer(); });
after(async () => { await app.stop(); });

const PROFILE_KEYS = ['bestDistance', 'coins', 'equipped', 'highscore', 'inventory', 'playTime', 'totalRuns', 'userId', 'username'];

const RUN = {
  distance: 1200, score: 1900, coins: 30, duration: 40, maxMultiplier: 2, tunnels: 1,
  cause: 'Baum erwischt', coinsByType: { bronze: 10, silver: 2, gold: 0, diamond: 0 },
};

async function guest() {
  const res = await app.call('POST', '/auth/guest', { body: {} });
  assert.equal(res.status, 200);
  return res.body;
}

async function agedGuest() {
  const g = await guest();
  await app.pool.query('UPDATE users SET created_at = NOW(3) - INTERVAL 1 HOUR WHERE id = ?', [Number(g.profile.userId)]);
  return g;
}

const setCoins = (userId, coins) => app.pool.query('UPDATE users SET coins = ? WHERE id = ?', [coins, Number(userId)]);
const ageRuns = (userId, seconds) => app.pool.query(
  'UPDATE runs SET created_at = NOW(3) - INTERVAL ? SECOND WHERE user_id = ?', [seconds, Number(userId)]);

test('guest gets a profile shaped like the mock', async () => {
  const { token, profile } = await guest();
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(Object.keys(profile).sort(), PROFILE_KEYS);
  assert.equal(profile.username, null);
  assert.equal(profile.coins, START_COINS);
  assert.deepEqual(profile.inventory, ITEMS.filter((i) => i.default).map((i) => i.id));
  assert.deepEqual(profile.equipped, DEFAULT_LOADOUT);
  assert.deepEqual(profile.playTime, { flight: 0, slots: 0, total: 0 });
  const me = await app.call('GET', '/me', { token });
  assert.deepEqual(me.body, profile);
});

test('requests without a valid token get 401', async () => {
  assert.equal((await app.call('GET', '/me')).status, 401);
  assert.equal((await app.call('GET', '/me', { token: 'x'.repeat(43) })).status, 401);
  assert.deepEqual((await app.call('POST', '/spin', { token: 'nope' })).body, { error: 'Nicht angemeldet' });
});

test('malformed json and unknown routes return german errors', async () => {
  const { token } = await guest();
  assert.deepEqual(await app.call('POST', '/runs', { token, raw: '{bad' }), { status: 400, body: { error: 'Ungültige Anfrage' } });
  assert.deepEqual(await app.call('GET', '/nope'), { status: 404, body: { error: 'Nicht gefunden' } });
});

test('signup upgrades the guest and keeps progress', async () => {
  const g = await agedGuest();
  const run = await app.call('POST', '/runs', { token: g.token, body: RUN });
  assert.equal(run.status, 200);
  const res = await app.call('POST', '/auth/signup', { token: g.token, body: { username: 'Flieger_1', password: 'geheim123' } });
  assert.equal(res.status, 200);
  assert.equal(res.body.profile.username, 'Flieger_1');
  assert.equal(res.body.profile.userId, g.profile.userId);
  assert.equal(res.body.profile.coins, START_COINS + RUN.coins);
  assert.equal(res.body.profile.totalRuns, 1);
  assert.notEqual(res.body.token, g.token);
  assert.equal((await app.call('GET', '/me', { token: g.token })).status, 401);
  assert.equal((await app.call('GET', '/me', { token: res.body.token })).status, 200);
  const again = await app.call('POST', '/auth/signup', { token: res.body.token, body: { username: 'Anders', password: 'geheim123' } });
  assert.deepEqual(again, { status: 409, body: { error: 'Bereits angemeldet' } });
});

test('signup validates input and usernames are case-insensitive', async () => {
  const a = await guest();
  for (const body of [
    { username: 'ab', password: 'geheim123' },
    { username: 'mit leer', password: 'geheim123' },
    { username: 'Ümlaut', password: 'geheim123' },
    { username: ['Array'], password: 'geheim123' },
    { username: 'Gueltig', password: 'kurz' },
    { username: 'Gueltig', password: 'x'.repeat(129) },
  ]) {
    assert.equal((await app.call('POST', '/auth/signup', { token: a.token, body })).status, 400, JSON.stringify(body));
  }
  assert.equal((await app.call('POST', '/auth/signup', { token: a.token, body: { username: 'Foo', password: 'geheim123' } })).status, 200);
  const b = await guest();
  const clash = await app.call('POST', '/auth/signup', { token: b.token, body: { username: 'foo', password: 'geheim123' } });
  assert.deepEqual(clash, { status: 409, body: { error: 'Benutzername vergeben' } });
  assert.equal((await app.call('POST', '/auth/signup', { body: { username: 'Ohne', password: 'geheim123' } })).status, 401);
});

test('login, wrong credentials and logout', async () => {
  const a = await guest();
  await app.call('POST', '/auth/signup', { token: a.token, body: { username: 'Pilotin', password: 'richtig123' } });
  const wrong = await app.call('POST', '/auth/login', { body: { username: 'Pilotin', password: 'falsch123' } });
  const unknown = await app.call('POST', '/auth/login', { body: { username: 'Niemand', password: 'falsch123' } });
  assert.deepEqual(wrong, { status: 401, body: { error: 'Benutzername oder Passwort falsch' } });
  assert.deepEqual(unknown, wrong);
  assert.equal((await app.call('POST', '/auth/login', { body: {} })).status, 401);

  const g = await guest();
  const ok = await app.call('POST', '/auth/login', { token: g.token, body: { username: 'pilotin', password: 'richtig123' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.profile.username, 'Pilotin');
  assert.equal((await app.call('GET', '/me', { token: g.token })).status, 401);
  const [orphan] = await app.pool.query('SELECT COUNT(*) AS n FROM users WHERE id = ?', [Number(g.profile.userId)]);
  assert.equal(orphan.n, 0);

  assert.deepEqual(await app.call('POST', '/auth/logout', { token: ok.body.token }), { status: 200, body: { ok: true } });
  assert.equal((await app.call('GET', '/me', { token: ok.body.token })).status, 401);
});

test('runs credit coins and track highscore', async () => {
  const g = await agedGuest();
  const first = await app.call('POST', '/runs', { token: g.token, body: RUN });
  assert.equal(first.status, 200);
  assert.match(first.body.runId, /^[A-Za-z0-9_-]{22}$/);
  assert.equal(first.body.newHighscore, true);
  assert.equal(first.body.profile.coins, START_COINS + RUN.coins);
  assert.equal(first.body.profile.highscore, RUN.score);
  assert.equal(first.body.profile.bestDistance, RUN.distance);
  await app.pool.query('UPDATE users SET last_run_at = NOW(3) - INTERVAL 1 HOUR WHERE id = ?', [Number(g.profile.userId)]);
  const second = await app.call('POST', '/runs', { token: g.token, body: { ...RUN, score: RUN.score - 100 } });
  assert.equal(second.body.newHighscore, false);
  assert.equal(second.body.profile.totalRuns, 2);
});

test('runs are rejected when implausible or faster than real time', async () => {
  const g = await agedGuest();
  const bad = await app.call('POST', '/runs', { token: g.token, body: { ...RUN, coins: 999999 } });
  assert.deepEqual(bad, { status: 400, body: { error: 'Run abgelehnt (unplausibel)' } });
  const fresh = await guest();
  const tooFast = await app.call('POST', '/runs', { token: fresh.token, body: RUN });
  assert.equal(tooFast.status, 400);
  const short = { ...RUN, duration: 1, distance: 50, score: 50 + 250, coins: 10, coinsByType: { bronze: 10, silver: 0, gold: 0, diamond: 0 }, maxMultiplier: 1 };
  assert.ok(short.duration <= RUN_LIMITS.timeSlack);
  assert.equal((await app.call('POST', '/runs', { token: fresh.token, body: short })).status, 200);
  assert.equal((await app.call('POST', '/runs', { token: fresh.token, body: RUN })).status, 400);
  const [u] = await app.pool.query('SELECT total_runs FROM users WHERE id = ?', [Number(fresh.profile.userId)]);
  assert.equal(u.total_runs, 1);
});

test('parallel runs: only one fits into the elapsed time', async () => {
  const g = await guest();
  await app.pool.query('UPDATE users SET created_at = NOW(3) - INTERVAL 50 SECOND WHERE id = ?', [Number(g.profile.userId)]);
  const results = await Promise.all([1, 2].map(() => app.call('POST', '/runs', { token: g.token, body: RUN })));
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 400]);
});

test('double: once, own run only, inside the window, daily cap', async () => {
  const g = await agedGuest();
  const run = await app.call('POST', '/runs', { token: g.token, body: RUN });
  const path = `/runs/${run.body.runId}/double`;
  assert.deepEqual(await app.call('POST', path, { token: g.token }), { status: 409, body: { error: 'Werbung noch nicht fertig' } });
  await ageRuns(g.profile.userId, DOUBLE.minDelaySeconds + 1);

  const other = await guest();
  assert.equal((await app.call('POST', path, { token: other.token })).status, 404);
  assert.equal((await app.call('POST', '/runs/abc/double', { token: g.token })).status, 404);

  const results = await Promise.all([1, 2].map(() => app.call('POST', path, { token: g.token })));
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  const me = await app.call('GET', '/me', { token: g.token });
  assert.equal(me.body.coins, START_COINS + RUN.coins * 2);

  await app.pool.query('UPDATE users SET last_run_at = NOW(3) - INTERVAL 1 HOUR WHERE id = ?', [Number(g.profile.userId)]);
  const late = await app.call('POST', '/runs', { token: g.token, body: RUN });
  await ageRuns(g.profile.userId, DOUBLE.windowSeconds + 1);
  assert.equal((await app.call('POST', `/runs/${late.body.runId}/double`, { token: g.token })).status, 410);

  await app.pool.query(
    'UPDATE runs SET doubled = 1, doubled_at = NOW(3) WHERE user_id = ?', [Number(g.profile.userId)]);
  for (let i = 0; i < DOUBLE.maxPerDay; i++) {
    await app.pool.query(
      `INSERT INTO runs (public_id, user_id, distance, score, coins, duration_ms, max_multiplier, tunnels, coins_by_type, doubled, doubled_at)
       VALUES (?, ?, 0, 0, 1, 1000, 1, 0, '{}', 1, NOW(3))`,
      [`filler${String(i).padStart(16, '0')}`, Number(g.profile.userId)]);
  }
  await app.pool.query('UPDATE users SET last_run_at = NOW(3) - INTERVAL 1 HOUR WHERE id = ?', [Number(g.profile.userId)]);
  const capped = await app.call('POST', '/runs', { token: g.token, body: RUN });
  await app.pool.query('UPDATE runs SET created_at = NOW(3) - INTERVAL 10 SECOND WHERE public_id = ?', [capped.body.runId]);
  assert.deepEqual(await app.call('POST', `/runs/${capped.body.runId}/double`, { token: g.token }), { status: 429, body: { error: 'Tageslimit erreicht' } });
});

test('spin charges coins and returns the mock result shape', async () => {
  const g = await guest();
  const res = await app.call('POST', '/spin', { token: g.token });
  assert.equal(res.status, 200);
  assert.equal(res.body.reels.length, 3);
  const { result, profile } = res.body;
  if (result.kind === 'nothing') {
    assert.deepEqual(result, { kind: 'nothing' });
    assert.equal(profile.coins, START_COINS - SPIN_COST);
  } else if (result.kind === 'coins') {
    assert.deepEqual(Object.keys(result).sort(), ['amount', 'combo', 'kind', 'nearMiss']);
    assert.equal(profile.coins, START_COINS - SPIN_COST + result.amount);
  } else {
    assert.deepEqual(Object.keys(result).sort(), ['duplicate', 'item', 'kind', 'refund']);
    assert.ok(result.item.name && result.item.rarity && result.item.category);
    assert.equal(profile.coins, START_COINS - SPIN_COST + result.refund);
    if (!result.duplicate) assert.ok(profile.inventory.includes(result.item.id));
  }
  await setCoins(g.profile.userId, 0);
  assert.deepEqual(await app.call('POST', '/spin', { token: g.token }), { status: 400, body: { error: 'Zu wenig Münzen' } });
});

test('parallel spins never overspend', async () => {
  const g = await guest();
  await setCoins(g.profile.userId, SPIN_COST);
  const results = await Promise.all(Array.from({ length: 5 }, () => app.call('POST', '/spin', { token: g.token })));
  const ok = results.filter((r) => r.status === 200);
  assert.equal(ok.length, 1);
  assert.ok(results.filter((r) => r.status !== 200).every((r) => r.body.error === 'Zu wenig Münzen'));
  const [{ coins }] = await app.pool.query('SELECT coins FROM users WHERE id = ?', [Number(g.profile.userId)]);
  const r = ok[0].body.result;
  assert.equal(coins, r.kind === 'coins' ? r.amount : r.kind === 'item' ? r.refund : 0);
});

test('equip only owned items', async () => {
  const g = await guest();
  const locked = ITEMS.find((i) => !i.default && i.category === 'suit');
  assert.deepEqual(await app.call('POST', '/equip', { token: g.token, body: { itemId: locked.id } }), { status: 400, body: { error: 'Item nicht im Besitz' } });
  assert.equal((await app.call('POST', '/equip', { token: g.token, body: { itemId: 'quatsch' } })).status, 400);
  assert.equal((await app.call('POST', '/equip', { token: g.token })).status, 400);
  await app.pool.query('INSERT INTO inventory (user_id, item_id) VALUES (?, ?)', [Number(g.profile.userId), locked.id]);
  const res = await app.call('POST', '/equip', { token: g.token, body: { itemId: locked.id } });
  assert.equal(res.body.profile.equipped.suit, locked.id);
  const back = await app.call('POST', '/equip', { token: g.token, body: { itemId: DEFAULT_LOADOUT.suit } });
  assert.equal(back.body.profile.equipped.suit, DEFAULT_LOADOUT.suit);
});

test('events are validated and stored', async () => {
  const g = await guest();
  assert.deepEqual(await app.call('POST', '/events', { token: g.token, body: { name: 'run_start', data: { runs: 0 } } }), { status: 200, body: { ok: true } });
  assert.equal((await app.call('POST', '/events', { token: g.token, body: { name: 'run_start' } })).status, 200);
  for (const body of [{ name: 'Böse' }, { name: 'x'.repeat(41) }, { name: 'ok', data: [1] }, { name: 'ok', data: 'str' }, { name: 'ok', data: { s: 'x'.repeat(2100) } }]) {
    assert.equal((await app.call('POST', '/events', { token: g.token, body })).status, 400, JSON.stringify(body).slice(0, 40));
  }
  const [{ n }] = await app.pool.query('SELECT COUNT(*) AS n FROM events WHERE user_id = ?', [Number(g.profile.userId)]);
  assert.equal(n, 2);
});

test('play time counts flight time and time at the slot machine', async () => {
  const g = await agedGuest();
  const uid = Number(g.profile.userId);
  const run = await app.call('POST', '/runs', { token: g.token, body: RUN });
  assert.deepEqual(run.body.profile.playTime, { flight: RUN.duration, slots: 0, total: RUN.duration });

  await setCoins(uid, SPIN_COST * 3);
  const first = await app.call('POST', '/spin', { token: g.token });
  assert.equal(first.body.profile.playTime.slots, PLAYTIME.spinSeconds);

  await app.pool.query('UPDATE spins SET created_at = NOW(3) - INTERVAL 20 SECOND WHERE user_id = ?', [uid]);
  const second = await app.call('POST', '/spin', { token: g.token });
  assert.ok([20, 21].includes(second.body.profile.playTime.slots - PLAYTIME.spinSeconds), JSON.stringify(second.body.profile.playTime));

  const before = second.body.profile.playTime.slots;
  await app.pool.query('UPDATE spins SET created_at = NOW(3) - INTERVAL ? SECOND WHERE user_id = ?', [PLAYTIME.slotGapSeconds + 30, uid]);
  const third = await app.call('POST', '/spin', { token: g.token });
  const t = third.body.profile.playTime;
  assert.equal(t.slots, before + PLAYTIME.spinSeconds);
  assert.equal(t.total, t.flight + t.slots);

  const signup = await app.call('POST', '/auth/signup', { token: g.token, body: { username: 'Zeitmesser', password: 'geheim123' } });
  assert.deepEqual(signup.body.profile.playTime, t);
});

test('health check', async () => {
  assert.deepEqual(await app.call('GET', '/health'), { status: 200, body: { ok: true } });
});
