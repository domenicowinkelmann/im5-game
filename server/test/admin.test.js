import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { startServer } from './helpers.js';
import { cleanupGuests } from '../src/cleanup.js';
import { suppressSmall, dayList, overview, activity, retention, segments, engagement, audience } from '../src/analytics/dashboard.js';
import { escapeLike, listPlayers, playerDetail } from '../src/analytics/players.js';
import { asJson } from '../src/db.js';
import { MSG } from '../src/errors.js';
import { engagementSim } from '../scripts/seed-engagement.js';
import { parseArgs } from '../scripts/admin-grant.js';
import { ADMIN, PRIVACY } from '../../src/shared/economy.js';

const PASSWORD = 'geheim123';
const RUN = {
  distance: 1200, score: 1900, coins: 30, duration: 40, maxMultiplier: 2, tunnels: 1,
  cause: 'Baum erwischt', coinsByType: { bronze: 10, silver: 2, gold: 0, diamond: 0 },
};

let app;
let admin;
before(async () => {
  app = await startServer();
  admin = await makeAdmin('chef');
});
after(async () => { await app.stop(); });

const sql = (query, params = []) => app.pool.query(query, params);
const get = (path, token = admin.token) => app.call('GET', `/admin${path}`, { token });
const post = (path, body, token = admin.token) => app.call('POST', `/admin${path}`, { token, body: body ?? {} });

async function guest(flags = null) {
  const res = await app.call('POST', '/auth/guest', { body: {} });
  assert.equal(res.status, 200);
  const token = res.body.token;
  if (flags) assert.equal((await app.consent(token, flags)).status, 200);
  return { token, uid: Number(res.body.profile.userId) };
}

async function registered(username, flags = null) {
  const g = await guest(flags);
  const res = await app.call('POST', '/auth/signup', { token: g.token, body: { username, password: PASSWORD } });
  assert.equal(res.status, 200);
  return { token: res.body.token, uid: g.uid, username };
}

async function makeAdmin(username) {
  const user = await registered(username);
  await sql('UPDATE users SET is_admin = 1 WHERE id = ?', [user.uid]);
  const res = await app.call('POST', '/admin/login', { body: { username, password: PASSWORD } });
  assert.equal(res.status, 200);
  assert.equal(res.body.username, username);
  return { ...user, gameToken: user.token, token: res.body.token };
}

async function playRun(g) {
  await sql('UPDATE users SET created_at = created_at - INTERVAL 1 HOUR WHERE id = ?', [g.uid]);
  const res = await app.call('POST', '/runs', { token: g.token, body: RUN });
  assert.equal(res.status, 200);
  return res.body;
}

async function sessionCount(uid) {
  const [{ n }] = await sql('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?', [uid]);
  return n;
}

async function addRun(uid, at, { ms = 40000, session = 1 } = {}) {
  await sql(
    `INSERT INTO runs (public_id, user_id, session_no, distance, score, coins, duration_ms, max_multiplier, tunnels, cause, coins_by_type, created_at)
     VALUES (?, ?, ?, 1000, 1500, 10, ?, 1, 0, '', '{}', ${at})`,
    [randomBytes(16).toString('base64url'), uid, session, ms]);
}

const addSession = (uid, session, start, values = {}) => sql(
  `INSERT INTO play_sessions (user_id, session_no, started_at, last_active_at, tz_offset_min, device, os, browser, country, region)
   VALUES (?, ?, ${start}, ${start} + INTERVAL 10 MINUTE, ?, ?, ?, ?, ?, ?)`,
  [uid, session, values.tz ?? null, values.device ?? null, values.os ?? null, values.browser ?? null,
    values.country ?? null, values.region ?? null]);

async function today() {
  const [{ d }] = await sql('SELECT CAST(UTC_DATE() AS CHAR) AS d');
  return {
    d,
    day: (ago) => new Date(Date.parse(`${d}T00:00:00Z`) - ago * 86400000).toISOString().slice(0, 10),
    at: (ago, minutes) => `DATE '${d}' - INTERVAL ${ago} DAY + INTERVAL ${minutes} MINUTE`,
    weekday: (ago) => (new Date(Date.parse(`${d}T00:00:00Z`) - ago * 86400000).getUTCDay() + 6) % 7,
  };
}

test('admin endpoints need a valid session', async () => {
  for (const token of [undefined, 'x'.repeat(43)]) {
    const res = await app.call('GET', '/admin/overview', { token });
    assert.equal(res.status, 401);
    assert.equal(res.body.error, MSG.unauthorized);
  }
  assert.equal((await app.call('POST', '/admin/logout', { body: {} })).status, 401);
  assert.equal((await app.call('GET', '/admin/players/1', { token: 'y'.repeat(43) })).status, 401);
});

test('non-admins get 403 and the admin login creates no session for them', async () => {
  const user = await registered('spieler_x');
  const before = await sessionCount(user.uid);
  const denied = await app.call('POST', '/admin/login', { body: { username: 'spieler_x', password: PASSWORD } });
  assert.equal(denied.status, 403);
  assert.equal(denied.body.error, MSG.forbidden);
  assert.equal(await sessionCount(user.uid), before);
  const wrong = await app.call('POST', '/admin/login', { body: { username: 'spieler_x', password: 'falsch12345' } });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.body.error, MSG.badLogin);
  assert.equal((await app.call('POST', '/admin/login', { body: {} })).status, 401);
  assert.equal((await get('/overview', user.token)).status, 403);
  const g = await guest();
  assert.equal((await get('/me', g.token)).status, 403);
  assert.equal((await get('/me', admin.gameToken)).status, 403);
});

test('admin login lasts 8 hours, is not extended and logout removes only that session', async () => {
  const me = await get('/me');
  assert.equal(me.status, 200);
  assert.deepEqual(me.body, { id: admin.uid, username: 'chef' });
  const [s] = await sql(
    `SELECT admin, TIMESTAMPDIFF(SECOND, NOW(3), expires_at) AS left_s FROM sessions
     WHERE user_id = ? AND admin = 1 ORDER BY created_at DESC LIMIT 1`, [admin.uid]);
  assert.equal(s.admin, 1);
  assert.ok(s.left_s > 8 * 3600 - 60 && s.left_s <= 8 * 3600, String(s.left_s));
  const [game] = await sql(
    'SELECT TIMESTAMPDIFF(DAY, NOW(3), expires_at) AS left_d FROM sessions WHERE user_id = ? AND admin = 0', [admin.uid]);
  assert.ok(game.left_d >= 89, String(game.left_d));

  const second = await app.call('POST', '/admin/login', { body: { username: 'chef', password: PASSWORD } });
  assert.equal(second.status, 200);
  await sql(
    `UPDATE sessions SET refreshed_at = NOW(3) - INTERVAL 2 DAY, expires_at = NOW(3) + INTERVAL 1 HOUR
     WHERE user_id = ? AND admin = 1 AND token_hash <> SHA2(?, 256)`, [admin.uid, admin.token]);
  assert.equal((await get('/me', second.body.token)).status, 200);
  const [extended] = await sql(
    `SELECT COUNT(*) AS n FROM sessions WHERE user_id = ? AND admin = 1 AND expires_at > NOW(3) + INTERVAL 2 HOUR
       AND token_hash <> SHA2(?, 256)`, [admin.uid, admin.token]);
  assert.equal(extended.n, 0);
  await sql('UPDATE sessions SET expires_at = NOW(3) - INTERVAL 1 SECOND WHERE token_hash = SHA2(?, 256)', [second.body.token]);
  assert.equal((await get('/me', second.body.token)).status, 401);

  const third = await app.call('POST', '/admin/login', { body: { username: 'chef', password: PASSWORD } });
  const before = await sessionCount(admin.uid);
  assert.deepEqual((await post('/logout', {}, third.body.token)).body, { ok: true });
  assert.equal(await sessionCount(admin.uid), before - 1);
  assert.equal((await get('/me', third.body.token)).status, 401);
  assert.equal((await get('/me')).status, 200);
  assert.equal((await app.call('GET', '/me', { token: admin.gameToken })).status, 200);
});

test('revoked admin rights take effect immediately', async () => {
  const other = await makeAdmin('chef_zwei');
  assert.equal((await get('/me', other.token)).status, 200);
  await sql('UPDATE users SET is_admin = 0 WHERE id = ?', [other.uid]);
  assert.equal((await get('/overview', other.token)).status, 403);
});

test('query parameters are validated', async () => {
  for (const path of ['/overview?days=0', '/overview?days=366', '/overview?days=abc', '/activity?days=1.5',
    '/retention?weeks=0', '/retention?weeks=53', '/engagement?days=-1', '/audience?days=999',
    '/overview?days=3&days=4', '/players?page=0', '/players?sort=password_hash', '/players?dir=sideways',
    '/players?type=robot', '/players?consent=all', '/players?segment=slot_fan', `/players?q=${'a'.repeat(41)}`]) {
    const res = await get(path);
    assert.equal(res.status, 400, path);
    assert.equal(res.body.error, MSG.badRequest, path);
  }
  for (const path of ['/players/0', '/players/abc', '/players/99999999999', '/players/4000000000']) {
    assert.equal((await get(path)).status, 404, path);
  }
});

test('overview keeps archived guests in the daily series', async () => {
  const t = await today();
  const g = await guest();
  await playRun(g);
  await sql(`UPDATE users SET created_at = ${t.at(3, 600)} WHERE id = ?`, [g.uid]);
  await sql(`UPDATE runs SET created_at = ${t.at(3, 620)} WHERE user_id = ?`, [g.uid]);
  await sql(
    `INSERT INTO decisions (user_id, session_no, placement, kind, shown, reason, created_at) VALUES
       (?, 1, 'gameover', 'interstitial', 1, 'ok', ${t.at(3, 625)}), (?, 1, 'menu', 'nudge', 1, 'return', ${t.at(3, 630)})`,
    [g.uid, g.uid]);
  await sql(`UPDATE users SET last_seen_at = ${t.at(2, 60)} WHERE id = ?`, [g.uid]);

  const before = await get('/overview?days=7');
  assert.equal(before.status, 200);
  assert.equal(before.body.series.length, 7);
  assert.equal(before.body.to, t.d);
  assert.deepEqual(before.body.series.map((s) => s.day), dayList(t.day(6), 7));
  const pick = (body, ago) => body.series.find((s) => s.day === t.day(ago));
  const day3 = pick(before.body, 3);
  assert.ok(day3.newPlayers >= 1 && day3.runs >= 1 && day3.interstitials >= 1 && day3.nudgesShown >= 1);

  assert.ok(await cleanupGuests(app.pool) >= 1);
  const [{ n }] = await sql('SELECT COUNT(*) AS n FROM users WHERE id = ?', [g.uid]);
  assert.equal(n, 0);
  const after = await get('/overview?days=7');
  for (const ago of [3, 2]) {
    const a = pick(after.body, ago);
    const b = pick(before.body, ago);
    for (const key of ['newPlayers', 'activePlayers', 'runs', 'playMinutes', 'interstitials', 'nudgesShown', 'doubled']) {
      assert.equal(a[key], b[key], `${key} ${ago}`);
    }
  }
  assert.equal(after.body.kpis.interstitials, before.body.kpis.interstitials);
  for (const key of ['activeToday', 'newToday', 'registeredShare', 'avgSessionSeconds', 'nudgeSignupRate']) {
    assert.ok(key in after.body.kpis, key);
  }
});

test('nudge to signup counts registrations within 24 hours', async () => {
  const before = (await get('/engagement?days=7')).body.nudges.total;
  const late = await guest();
  await sql(`INSERT INTO decisions (user_id, session_no, placement, kind, shown, reason, outcome, created_at)
     VALUES (?, 1, 'menu', 'nudge', 1, 'progress', 'dismissed', NOW(3) - INTERVAL 30 HOUR)`, [late.uid]);
  const soon = await guest();
  await sql(`INSERT INTO decisions (user_id, session_no, placement, kind, shown, reason, outcome, created_at)
     VALUES (?, 1, 'menu', 'nudge', 1, 'progress', 'clicked', NOW(3) - INTERVAL 2 HOUR)`, [soon.uid]);
  const twice = await guest();
  await sql(`INSERT INTO decisions (user_id, session_no, placement, kind, shown, reason, outcome, created_at) VALUES
      (?, 1, 'menu', 'nudge', 1, 'progress', NULL, NOW(3) - INTERVAL 5 HOUR),
      (?, 2, 'gameover', 'nudge', 1, 'highscore', NULL, NOW(3) - INTERVAL 150 MINUTE)`, [twice.uid, twice.uid]);
  for (const [g, name] of [[late, 'spaet_1'], [soon, 'bald_1'], [twice, 'zweimal_1']]) {
    assert.equal((await app.call('POST', '/auth/signup', { token: g.token, body: { username: name, password: PASSWORD } })).status, 200);
  }
  const res = await get('/engagement?days=7');
  assert.equal(res.status, 200);
  const total = res.body.nudges.total;
  assert.equal(total.shown, before.shown + 4);
  assert.equal(total.signups, before.signups + 3);
  assert.equal(total.registrations, before.registrations + 2);
  assert.equal(total.dismissed, before.dismissed + 1);
  assert.equal(total.consentedShown, before.consentedShown);
  const progress = res.body.nudges.byReason.find((r) => r.reason === 'progress');
  assert.ok(progress.signups >= 2);
  const overview = await get('/overview?days=7');
  assert.equal(overview.body.kpis.nudgeSignups, total.registrations);
  assert.equal(overview.body.kpis.nudgesWithSignup, total.signups);
  assert.equal(overview.body.kpis.nudgeSignupBase, total.shown + total.archivedShown);
  assert.equal(overview.body.kpis.nudgeSignupRate, total.signupRate);
  assert.ok(overview.body.kpis.nudgeSignups <= overview.body.series.reduce((s, r) => s + r.signups, 0));
});

test('archived nudges only count inside the requested window', async () => {
  const reasonOf = (body, reason) => body.nudges.byReason.find((r) => r.reason === reason)?.archivedShown ?? 0;
  const seriesSum = (body) => body.series.reduce((s, r) => s + r.nudgesShown, 0);
  const t = await today();
  const g = await guest();
  await sql(`UPDATE users SET created_at = ${t.at(11, 600)} WHERE id = ?`, [g.uid]);
  await sql(`INSERT INTO decisions (user_id, session_no, placement, kind, shown, reason, created_at) VALUES
      (?, 1, 'menu', 'nudge', 1, 'progress', ${t.at(10, 720)}),
      (?, 1, 'menu', 'nudge', 1, 'progress', ${t.at(10, 721)}),
      (?, 1, 'menu', 'nudge', 1, 'progress', ${t.at(10, 722)}),
      (?, 2, 'menu', 'nudge', 1, 'return', NOW(3) - INTERVAL 26 HOUR)`,
    [g.uid, g.uid, g.uid, g.uid]);
  await sql('UPDATE users SET last_seen_at = NOW(3) - INTERVAL 25 HOUR WHERE id = ?', [g.uid]);

  const before = (await get('/engagement?days=3')).body;
  const overviewBefore = (await get('/overview?days=3')).body;
  assert.ok(await cleanupGuests(app.pool) >= 1);
  const [{ n }] = await sql('SELECT COUNT(*) AS n FROM users WHERE id = ?', [g.uid]);
  assert.equal(n, 0);
  const [a] = await sql('SELECT id, nudges FROM player_archive ORDER BY id DESC LIMIT 1');
  const days = await sql(
    'SELECT DATEDIFF(UTC_DATE(), day) >= 10 AS old, nudges_shown, nudge_reasons FROM player_archive_days WHERE archive_id = ? ORDER BY day',
    [a.id]);
  assert.deepEqual(days.map((d) => [Boolean(d.old), d.nudges_shown, asJson(d.nudge_reasons)]),
    [[true, 3, { progress: 3 }], [false, 1, { return: 1 }]]);

  const after = (await get('/engagement?days=3')).body;
  assert.equal(after.nudges.total.archivedShown, before.nudges.total.archivedShown + 1);
  assert.equal(after.nudges.total.shown + after.nudges.total.archivedShown, before.nudges.total.shown + before.nudges.total.archivedShown);
  assert.equal(reasonOf(after, 'return'), reasonOf(before, 'return') + 1);
  assert.equal(reasonOf(after, 'progress'), reasonOf(before, 'progress'));

  const overview = (await get('/overview?days=3')).body;
  assert.equal(overview.kpis.nudgesShown, seriesSum(overview));
  assert.equal(overview.kpis.nudgesShown, overviewBefore.kpis.nudgesShown);
  assert.equal(overviewBefore.kpis.nudgesShown, seriesSum(overviewBefore));

  const { insertId: legacy } = await sql(
    `INSERT INTO player_archive (reason, archived_on, first_day, last_day)
     VALUES ('inactive', UTC_DATE(), UTC_DATE(), UTC_DATE())`);
  await sql('INSERT INTO player_archive_days (archive_id, day, nudges_shown) VALUES (?, UTC_DATE(), 2)', [legacy]);
  const withLegacy = (await get('/engagement?days=3')).body;
  assert.equal(reasonOf(withLegacy, 'unknown'), reasonOf(after, 'unknown') + 2);
  assert.equal(withLegacy.nudges.total.archivedShown, after.nudges.total.archivedShown + 2);
  await sql('DELETE FROM player_archive WHERE id = ?', [legacy]);
});

test('continue rate only uses consented decisions since the consent', async () => {
  const before = (await get('/engagement?days=30')).body.interstitials.continueRate;
  const yes = await guest({ stats: true });
  const no = await guest();
  await sql('UPDATE users SET consent_stats_at = NOW(3) - INTERVAL 1 DAY WHERE id = ?', [yes.uid]);
  await sql(`INSERT INTO decisions (user_id, session_no, placement, kind, shown, reason, outcome, created_at) VALUES
      (?, 1, 'gameover', 'interstitial', 1, 'ok', 'continued', NOW(3) - INTERVAL 1 HOUR),
      (?, 1, 'gameover', 'interstitial', 1, 'ok', NULL, NOW(3) - INTERVAL 2 HOUR),
      (?, 1, 'gameover', 'interstitial', 0, 'interval', NULL, NOW(3) - INTERVAL 3 HOUR),
      (?, 1, 'gameover', 'interstitial', 1, 'ok', 'continued', NOW(3) - INTERVAL 3 DAY),
      (?, 1, 'gameover', 'interstitial', 1, 'ok', NULL, NOW(3) - INTERVAL 1 HOUR)`,
  [yes.uid, yes.uid, yes.uid, yes.uid, no.uid]);
  const res = await get('/engagement?days=30');
  const after = res.body.interstitials.continueRate;
  assert.equal(after.shown, before.shown + 2);
  assert.equal(after.continued, before.continued + 1);
  assert.ok(res.body.interstitials.byReason.some((r) => r.reason === 'interval' && r.shown === 0 && r.decisions >= 1));
  assert.ok(Array.isArray(res.body.rewarded.daily) && res.body.rewarded.daily.length === 30);
  assert.equal(JSON.stringify(res.body).includes('userId'), false);
});

test('heatmap is 7x24 in local time and only uses consented players', async () => {
  const t = await today();
  const before = (await get('/activity?days=7')).body;
  const yes = await guest({ stats: true });
  await sql('UPDATE users SET consent_stats_at = NOW(3) - INTERVAL 5 DAY WHERE id = ?', [yes.uid]);
  await addSession(yes.uid, 1, t.at(2, 380), { tz: 120 });
  await addRun(yes.uid, t.at(2, 390));
  const no = await guest();
  await sql('UPDATE users SET tz_offset_min = 120 WHERE id = ?', [no.uid]);
  await addRun(no.uid, t.at(2, 390));

  const res = await get('/activity?days=7');
  assert.equal(res.status, 200);
  const { heatmap } = res.body;
  assert.equal(heatmap.length, 7);
  for (const row of heatmap) assert.equal(row.length, 24);
  const wd = t.weekday(2);
  assert.equal(heatmap[wd][8] - before.heatmap[wd][8], 40);
  assert.equal(heatmap[wd][6] - before.heatmap[wd][6], 0);
  assert.equal(res.body.hours[8] - before.hours[8], 40);
  assert.equal(res.body.weekdays[wd] - before.weekdays[wd], 40);
  assert.equal(res.body.players, before.players + 1);
  const morning = res.body.dayparts.find((p) => p.name === 'morgens');
  assert.equal(morning.seconds - before.dayparts.find((p) => p.name === 'morgens').seconds, 40);
  assert.equal(res.body.sessionLengths.length, ADMIN.sessionBinsSeconds.length + 1);
  const bin = res.body.sessionLengths.find((b) => b.from === 600);
  assert.equal(bin.sessions - before.sessionLengths.find((b) => b.from === 600).sessions, 1);

  const archive = (heat) => sql(
    `INSERT INTO player_archive (reason, archived_on, first_day, last_day, consent_stats, heat)
     VALUES ('expired', UTC_DATE(), UTC_DATE() - INTERVAL 2 DAY, UTC_DATE() - INTERVAL 1 DAY, 1, ?)`,
    [JSON.stringify(heat)]);
  await archive(Array(168).fill(0));
  const idle = (await get('/activity?days=7')).body;
  assert.equal(idle.players, res.body.players);
  assert.deepEqual(idle.heatmap, res.body.heatmap);
  const busy = Array(168).fill(0);
  busy[wd * 24 + 20] = 30;
  await archive(busy);
  const played = (await get('/activity?days=7')).body;
  assert.equal(played.players, res.body.players + 1);
  assert.equal(played.heatmap[wd][20] - res.body.heatmap[wd][20], 30);
  await sql("DELETE FROM player_archive WHERE reason = 'expired' AND heat IS NOT NULL AND consent_stats = 1 AND first_day = UTC_DATE() - INTERVAL 2 DAY");
});

test('retention builds weekly cohorts from live and archived players', async () => {
  const [{ monday }] = await sql(
    "SELECT CAST(UTC_DATE() - INTERVAL WEEKDAY(UTC_DATE()) DAY - INTERVAL 5 WEEK AS CHAR) AS monday");
  const at = (days, hours = 10) => `DATE '${monday}' + INTERVAL ${days} DAY + INTERVAL ${hours} HOUR`;
  const ids = [];
  for (const [name, seen] of [['kohorte_a', 7], ['kohorte_b', 0]]) {
    const { insertId } = await sql(
      `INSERT INTO users (username, coins, created_at, last_seen_at, session_started_at) VALUES (?, 0, ${at(0)}, ${at(seen, 11)}, ${at(0)})`,
      [name]);
    ids.push(insertId);
  }
  await addRun(ids[0], at(1));
  await addRun(ids[0], at(7));
  const { insertId: aid } = await sql(
    `INSERT INTO player_archive (reason, archived_on, first_day, last_day, sessions, runs)
     VALUES ('expired', DATE '${monday}' + INTERVAL 3 DAY, DATE '${monday}', DATE '${monday}' + INTERVAL 1 DAY, 2, 1)`);
  await sql(`INSERT INTO player_archive_days (archive_id, day, runs) VALUES (?, DATE '${monday}' + INTERVAL 1 DAY, 1)`, [aid]);

  const res = await get('/retention?weeks=8');
  assert.equal(res.status, 200);
  assert.equal(res.body.cohorts.length, 8);
  assert.match(res.body.note, /24 Stunden/);
  const c = res.body.cohorts.find((x) => x.week === monday);
  assert.ok(c);
  assert.equal(c.size, 3);
  assert.deepEqual(c.d1, { eligible: 3, retained: 2, rate: 0.667 });
  assert.deepEqual(c.d7, { eligible: 3, retained: 1, rate: 0.333 });
  assert.deepEqual(c.d30, { eligible: 3, retained: 0, rate: 0 });
  assert.equal(c.retention.length, 6);
  assert.equal(c.retention[0], 1);
  assert.equal(c.retention[1], 0.333);
  assert.equal(c.retention[2], 0);
  const current = res.body.cohorts[res.body.cohorts.length - 1];
  assert.equal(current.retention.length, 1);
  assert.equal(current.d7.eligible <= current.size, true);
});

test('retention only counts a day once it is over', async () => {
  const before = (await get('/retention?weeks=2')).body.totals;
  const { insertId } = await sql(
    `INSERT INTO users (username, coins, created_at, last_seen_at, session_started_at)
     VALUES ('gestern_1', 0, UTC_DATE() - INTERVAL 1 DAY + INTERVAL 10 HOUR, NOW(3), NOW(3))`);
  await addRun(insertId, 'NOW(3)');
  const after = (await get('/retention?weeks=2')).body.totals;
  assert.deepEqual(after.d1, before.d1);
  await sql('UPDATE users SET created_at = UTC_DATE() - INTERVAL 2 DAY + INTERVAL 10 HOUR WHERE id = ?', [insertId]);
  await sql('UPDATE runs SET created_at = UTC_DATE() - INTERVAL 1 DAY + INTERVAL 11 HOUR WHERE user_id = ?', [insertId]);
  const done = (await get('/retention?weeks=2')).body.totals;
  assert.equal(done.d1.eligible, before.d1.eligible + 1);
  assert.equal(done.d1.retained, before.d1.retained + 1);
});

test('small groups are merged into Andere or suppressed', async () => {
  assert.deepEqual(suppressSmall(new Map([['a', 4]])), { groups: [], suppressed: 4 });
  assert.deepEqual(suppressSmall(new Map([['a', 3], ['b', 3], ['c', 5]])), {
    groups: [{ value: 'c', label: 'c', players: 5 }, { value: null, label: 'Andere', players: 6, other: true }],
    suppressed: 0,
  });
  assert.equal(PRIVACY.minGroupSize, 5);

  const t = await today();
  const players = async (region, count) => {
    for (let i = 0; i < count; i++) {
      const g = await guest({ stats: true });
      await addSession(g.uid, 1, t.at(1, 600), { country: 'CH', region, device: 'tablet', os: 'Plan9', browser: 'Lynx' });
      await addSession(g.uid, 2, t.at(1, 700), { country: 'CH', region: 'ZG', device: 'tablet', os: 'Plan9', browser: 'Lynx' });
      await addSession(g.uid, 3, t.at(1, 800), { country: 'CH', region, device: 'tablet', os: 'Plan9', browser: 'Lynx' });
    }
  };
  const regions = (body) => Object.fromEntries(body.regions.map((g) => [g.label, g.players]));
  await players('TI', 4);
  const few = await get('/audience?days=30');
  assert.equal(few.status, 200);
  assert.equal(few.body.swissPlayers, null);
  assert.equal(few.body.countries.some((g) => g.value === 'CH'), false);
  assert.equal(few.body.suppressed.regions, null);
  assert.deepEqual(few.body.regions, []);
  await players('VS', 5);
  const first = await get('/audience?days=30');
  assert.equal(first.status, 200);
  assert.equal(first.body.swissPlayers, 9);
  assert.equal(regions(first.body).VS, 5);
  assert.equal('TI' in regions(first.body), false);
  assert.equal('ZG' in regions(first.body), false);
  assert.equal(first.body.minGroupSize, 5);
  assert.ok(first.body.suppressed.regions >= 4 || regions(first.body).Andere >= 5);
  assert.equal(typeof first.body.suppressed.regions, 'number');
  assert.ok(first.body.browsers.some((g) => g.label === 'Lynx' && g.players === 9));

  await players('TI', 1);
  const second = await get('/audience?days=30');
  assert.equal(regions(second.body).TI, 5);
  for (const key of ['countries', 'regions', 'devices', 'os', 'browsers', 'screens', 'referrers', 'utmSources', 'utmMediums', 'utmCampaigns']) {
    assert.ok(Array.isArray(second.body[key]), key);
    for (const g of second.body[key]) assert.ok(g.players >= 5, `${key} ${g.label}`);
  }
});

test('player list filters, sorts by whitelist and escapes LIKE patterns', async () => {
  await guest({ stats: true });
  for (const [i, name] of ['pct%name', 'pctXname', 'und_er', 'undXer', 'back\\slash'].entries()) {
    await sql('INSERT INTO users (username, coins) VALUES (?, ?)', [name, (i + 1) * 10]);
  }
  const percent = await get(`/players?q=${encodeURIComponent('%')}`);
  assert.equal(percent.status, 200);
  assert.deepEqual(percent.body.players.map((p) => p.username), ['pct%name']);
  assert.equal(percent.body.total, 1);
  const under = await get(`/players?q=${encodeURIComponent('d_e')}`);
  assert.deepEqual(under.body.players.map((p) => p.username), ['und_er']);
  const slash = await get(`/players?q=${encodeURIComponent('k\\s')}`);
  assert.deepEqual(slash.body.players.map((p) => p.username), ['back\\slash']);
  assert.equal(escapeLike('a%b_c\\d'), 'a\\%b\\_c\\\\d');

  const sorted = await get('/players?q=pct&sort=coins&dir=asc');
  assert.deepEqual(sorted.body.players.map((p) => p.username), ['pct%name', 'pctXname']);
  const sortedDesc = await get('/players?q=pct&sort=coins&dir=desc');
  assert.deepEqual(sortedDesc.body.players.map((p) => p.username), ['pctXname', 'pct%name']);
  const desc = await get('/players?q=und&sort=username&dir=desc');
  assert.deepEqual(desc.body.players.map((p) => p.username), ['undXer', 'und_er']);

  const all = await get('/players');
  assert.equal(all.status, 200);
  assert.equal(all.body.page, 1);
  assert.equal(all.body.pageSize, ADMIN.pageSize);
  assert.ok(all.body.total > 0 && all.body.players.length === Math.min(all.body.total, ADMIN.pageSize));
  const row = all.body.players[0];
  for (const key of ['id', 'username', 'type', 'consent', 'createdAt', 'lastSeenAt', 'runs', 'coins', 'playSeconds', 'engagement', 'segments']) {
    assert.ok(key in row, key);
  }
  const admins = await get('/players?type=admin');
  assert.ok(admins.body.players.every((p) => p.type === 'admin'));
  assert.ok(admins.body.players.some((p) => p.username === 'chef'));
  const guests = await get('/players?type=guest&consent=none');
  assert.ok(guests.body.players.every((p) => p.username === null && !p.consent.stats && p.engagement === null && p.segments === null));
  const stats = await get('/players?consent=stats');
  assert.ok(stats.body.players.length > 0 && stats.body.players.every((p) => p.consent.stats));
  const last = Math.max(1, Math.ceil(all.body.total / ADMIN.pageSize));
  const page = await get('/players?page=999');
  assert.equal(page.body.page, last);
  assert.equal(page.body.total, all.body.total);
  assert.equal(page.body.players.length, all.body.total - (last - 1) * ADMIN.pageSize);
  const pct = await get('/players?q=pct&sort=coins&dir=asc&page=5');
  assert.equal(pct.body.page, 1);
  assert.deepEqual(pct.body.players.map((p) => p.username), ['pct%name', 'pctXname']);
  const none = await get('/players?q=niemand-heisst-so&page=3');
  assert.equal(none.body.page, 1);
  assert.equal(none.body.total, 0);
  assert.deepEqual(none.body.players, []);
});

test('player detail hides analytics without consent', async () => {
  const g = await guest();
  await playRun(g);
  await addSession(g.uid, 1, 'NOW(3) - INTERVAL 20 MINUTE', { country: 'CH', region: 'GR' });
  await sql(`INSERT INTO events (user_id, name, data) VALUES (?, 'run_start', NULL)`, [g.uid]);
  await sql(`INSERT INTO decisions (user_id, session_no, placement, kind, shown, reason) VALUES (?, 1, 'gameover', 'interstitial', 1, 'ok')`, [g.uid]);
  const res = await get(`/players/${g.uid}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.player.id, g.uid);
  assert.equal(res.body.player.type, 'guest');
  assert.equal(res.body.consent.stats, false);
  assert.equal(res.body.game.totalRuns, 1);
  assert.deepEqual(Object.keys(res.body.game.playTime), ['total']);
  assert.equal(res.body.game.playTime.total, RUN.duration);
  assert.equal(res.body.runs.length, 1);
  assert.equal(res.body.runs[0].distance, RUN.distance);
  assert.equal('doubled' in res.body.runs[0], false);
  assert.equal(res.body.decisions.length, 1);
  assert.deepEqual(
    { reason: res.body.decisions[0].reason, shown: res.body.decisions[0].shown, kind: res.body.decisions[0].kind },
    { reason: 'ok', shown: true, kind: 'interstitial' });
  assert.deepEqual(res.body.analytics, { allowed: false, tzOffsetMin: null, profile: null, sessions: [], events: [] });

  const c = await guest({ stats: true });
  await addSession(c.uid, 1, 'NOW(3) - INTERVAL 20 MINUTE', { tz: 60, country: 'CH', region: 'GR' });
  await addRun(c.uid, 'NOW(3) - INTERVAL 15 MINUTE');
  await sql(`INSERT INTO events (user_id, name, data, created_at) VALUES (?, 'run_start', NULL, NOW(3) - INTERVAL 1 DAY)`, [c.uid]);
  await sql(`INSERT INTO events (user_id, name, data) VALUES (?, 'screen_view', '{"screen":"menu"}'),
      (?, 'rewarded_ad_start', '{"placement":"double_coins"}'), (?, 'rewarded_ad_complete', '{"placement":"double_coins"}'),
      (?, 'screen_view', '{"screen":"slots"}')`,
  [c.uid, c.uid, c.uid, c.uid]);
  await sql(`INSERT INTO decisions (user_id, session_no, placement, kind, shown, reason) VALUES
      (?, 1, 'gameover', 'interstitial', 0, 'cooldown'), (?, 1, 'gameover', 'interstitial', 0, 'interval')`, [c.uid, c.uid]);
  const recompute = await post(`/players/${c.uid}/recompute`);
  assert.equal(recompute.status, 200);
  assert.equal(recompute.body.profile.heatmap.length, 7);
  const detail = await get(`/players/${c.uid}`);
  assert.equal(detail.body.analytics.allowed, true);
  assert.equal(detail.body.analytics.sessions.length, 1);
  assert.equal(detail.body.analytics.sessions[0].region, 'GR');
  assert.deepEqual(detail.body.analytics.events.map((e) => e.data), [{ screen: 'menu' }]);
  assert.equal(JSON.stringify(detail.body).includes('double_coins'), false);
  assert.deepEqual(detail.body.decisions.map((d) => d.reason), ['interval']);
  assert.equal(JSON.stringify(detail.body).includes('slots'), false);
  assert.equal('slots' in detail.body.game.playTime, false);
  assert.ok(Array.isArray(detail.body.analytics.profile.segments));
  assert.equal((await get('/players/4294967295')).status, 404);
});

test('recompute is refused without consent', async () => {
  const g = await guest();
  const res = await post(`/players/${g.uid}/recompute`);
  assert.equal(res.status, 409);
  assert.equal(res.body.error, MSG.noConsent);
  assert.equal((await post('/players/4294967295/recompute')).status, 404);
});

test('admins delete players with an archive row, never admins or themselves', async () => {
  const other = await registered('chef_drei');
  await sql('UPDATE users SET is_admin = 1 WHERE id = ?', [other.uid]);
  const denied = await post(`/players/${other.uid}/delete`);
  assert.equal(denied.status, 403);
  assert.equal(denied.body.error, MSG.forbidden);
  assert.equal((await post(`/players/${admin.uid}/delete`)).status, 403);

  const victim = await registered('loesch_mich');
  await app.consent(victim.token, { stats: true });
  assert.equal((await app.call('POST', '/session', { token: victim.token, body: {} })).status, 200);
  await playRun(victim);
  const [{ last }] = await sql('SELECT COALESCE(MAX(id), 0) AS last FROM player_archive');
  const res = await post(`/players/${victim.uid}/delete`);
  assert.deepEqual(res, { status: 200, body: { ok: true } });
  const [{ n }] = await sql('SELECT COUNT(*) AS n FROM users WHERE id = ?', [victim.uid]);
  assert.equal(n, 0);
  const archived = await sql(
    'SELECT reason, registered, consent_stats, runs, device, os, browser, country, region, heat, segments FROM player_archive WHERE id > ?', [last]);
  assert.deepEqual(archived.map((a) => ({ ...a })), [{
    reason: 'admin', registered: 1, consent_stats: 1, runs: 1, device: null, os: null, browser: null, country: null, region: null, heat: null, segments: null,
  }]);
  assert.equal((await app.call('GET', '/me', { token: victim.token })).status, 401);
  assert.equal((await post(`/players/${victim.uid}/delete`)).status, 404);
});

test('segments list every label with rule texts and score histograms', async () => {
  const fresh = await guest({ stats: true });
  await playRun(fresh);
  assert.equal((await post(`/players/${fresh.uid}/recompute`)).status, 200);
  const res = await get('/segments');
  assert.equal(res.status, 200);
  assert.ok(res.body.profiles >= 1);
  const ids = res.body.segments.map((s) => s.id);
  assert.ok(ids.includes('neu') && ids.includes('werbe_muede'));
  for (const s of res.body.segments) {
    assert.equal(typeof s.label, 'string');
    assert.equal(typeof s.rule, 'string');
    assert.doesNotMatch(s.rule, /\u00df/);
  }
  assert.ok(res.body.segments.find((s) => s.id === 'neu').players >= 1);
  for (const key of ['engagement', 'churnRisk', 'adTolerance']) {
    assert.equal(res.body.histograms[key].bins.length, ADMIN.scoreBins);
  }
  const total = res.body.histograms.engagement.bins.reduce((s, b) => s + b.players, 0) + res.body.histograms.engagement.missing;
  assert.equal(total, res.body.profiles);
});

function lcg(seed) {
  let x = seed;
  return () => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return x / 2147483648;
  };
}

function simulate(consent) {
  const sim = engagementSim({ consent, statsAt: 0, zone: 'Europe/Zurich', patience: 1, random: lcg(7) });
  const p = { runs: 0, playMs: 0, coins: 600, extraItems: 0, lastRunSeconds: null, doubledAt: null, registeredAt: null };
  let t = Date.UTC(2026, 0, 5, 17);
  for (let no = 1; no <= 6; no++) {
    const session = { no, start: t };
    t = sim.engage('menu', t + 5000, session, p).at;
    for (let r = 0; r < 12; r++) {
      t += 40000;
      p.runs++;
      p.playMs += 40000;
      p.lastRunSeconds = 40;
      t = sim.engage('gameover', t + 2000, session, p, { newHighscore: r === 3 }).at;
    }
    t = sim.engage('slot_item', t + 3000, session, p, { newItem: true }).at;
    t += 3 * 3600 * 1000;
  }
  return sim.decisions;
}

test('the seed stores decisions with the same consent rules as the server', () => {
  const decided = { version: PRIVACY.version, personal: 0 };
  const without = simulate({ ...decided, stats: 0 });
  assert.ok(without.some((d) => d.kind === 'interstitial'));
  assert.ok(without.some((d) => d.kind === 'nudge' && d.outcome === 'dismissed'));
  assert.ok(without.every((d) => d.shown === 1));
  assert.ok(without.every((d) => !['clicked', 'continued', 'dropped'].includes(d.outcome)));

  const withStats = simulate({ ...decided, stats: 1 });
  assert.ok(withStats.some((d) => d.shown === 0 && d.reason === 'grace'));
  assert.ok(withStats.some((d) => d.outcome === 'continued'));
  assert.ok(withStats.filter((d) => d.kind === 'interstitial' && d.shown === 1).every((d) => d.outcome === 'continued'));
  assert.equal(
    withStats.filter((d) => d.shown === 1).length,
    without.filter((d) => d.shown === 1).length,
  );
  assert.deepEqual(simulate({ version: 0, stats: 0, personal: 0 }), []);
});

test('windows longer than the retention only show decisions from the kept days', async () => {
  const t = await today();
  const keep = PRIVACY.retention.decisionsDays;
  const g = await guest();
  await sql(`INSERT INTO decisions (user_id, session_no, placement, kind, shown, reason, created_at) VALUES
      (?, 1, 'gameover', 'interstitial', 1, 'ok', ${t.at(keep - 1, 600)}),
      (?, 1, 'gameover', 'interstitial', 1, 'ok', ${t.at(keep + 10, 600)}),
      (?, 1, 'menu', 'nudge', 1, 'return', ${t.at(keep + 10, 610)})`, [g.uid, g.uid, g.uid]);
  const { insertId } = await sql(
    `INSERT INTO player_archive (reason, archived_on, first_day, last_day, consent_stats, country, region)
     VALUES ('expired', UTC_DATE(), DATE '${t.day(keep + 20)}', DATE '${t.day(keep + 10)}', 1, 'CH', 'GR')`);
  await sql(`INSERT INTO player_archive_days (archive_id, day, interstitials, nudges_shown, nudge_reasons) VALUES
      (?, DATE '${t.day(keep + 10)}', 4, 1, '{"altgrund":1}')`, [insertId]);

  const days = keep + 30;
  const res = await get(`/overview?days=${days}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.decisionsFrom, t.day(keep - 1));
  const day = (body, ago) => body.series.find((s) => s.day === t.day(ago));
  assert.equal(day(res.body, keep + 10).interstitials, null);
  assert.equal(day(res.body, keep + 10).nudgesShown, null);
  assert.ok(day(res.body, keep - 1).interstitials >= 1);
  assert.equal(res.body.kpis.interstitials, res.body.series.reduce((s, r) => s + (r.interstitials ?? 0), 0));
  assert.ok(res.body.notes.some((note) => note.includes(t.day(keep - 1))));
  const short = (await get('/overview?days=30')).body;
  assert.equal(short.decisionsFrom, short.from);
  assert.equal(short.notes.some((note) => note.includes('erst ab')), false);

  const eng = (await get(`/engagement?days=${days}`)).body;
  assert.equal(eng.decisionsFrom, t.day(keep - 1));
  assert.equal(eng.interstitials.daily.find((d) => d.day === t.day(keep + 10)).shown, null);
  assert.equal(eng.interstitials.shown, eng.interstitials.daily.reduce((s, d) => s + (d.shown ?? 0), 0));
  assert.equal(eng.nudges.byReason.some((r) => r.reason === 'altgrund'), false);

  const aud = (await get(`/audience?days=${days}`)).body;
  assert.equal(aud.from, t.day(PRIVACY.retention.sessionsDays - 1));
  const countBefore = aud.players;
  await sql('UPDATE player_archive SET last_day = UTC_DATE() WHERE id = ?', [insertId]);
  assert.equal((await get(`/audience?days=${days}`)).body.players, countBefore + 1);
  await sql('DELETE FROM player_archive WHERE id = ?', [insertId]);
  await sql('DELETE FROM decisions WHERE user_id = ?', [g.uid]);
});

test('dashboard queries also run with ONLY_FULL_GROUP_BY', async () => {
  const conn = await app.pool.getConnection();
  try {
    await conn.query("SET SESSION sql_mode = CONCAT(@@SESSION.sql_mode, ',ONLY_FULL_GROUP_BY')");
    const [{ mode }] = await conn.query('SELECT @@SESSION.sql_mode AS mode');
    assert.match(mode, /ONLY_FULL_GROUP_BY/);
    await overview(conn, 30);
    await activity(conn, 30);
    await retention(conn, 12);
    await segments(conn);
    await engagement(conn, 30);
    await audience(conn, 30);
    await listPlayers(conn, { sort: 'engagement' });
    await playerDetail(conn, admin.uid);
  } finally {
    await conn.query('SET SESSION sql_mode = DEFAULT');
    conn.release();
  }
});

test('admin:grant parses usernames that look like flags', () => {
  assert.deepEqual(parseArgs(['pilot']), { username: 'pilot', revoke: false, apply: false });
  assert.deepEqual(parseArgs(['-pilot', '--yes']), { username: '-pilot', revoke: false, apply: true });
  assert.deepEqual(parseArgs(['--revoke', '--yes', '--', '--yes']), { username: '--yes', revoke: true, apply: true });
  assert.deepEqual(parseArgs(['--', '---']), { username: '---', revoke: false, apply: false });
  for (const args of [[], ['--yes'], ['a', 'b'], ['pilot', '--yess'], ['ab'], ['pilot', '--', '--yes'], ['p ilot']]) {
    assert.equal(parseArgs(args), null, args.join(' '));
  }
});
