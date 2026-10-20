import { Router } from 'express';
import { randomBytes, randomInt } from 'node:crypto';
import { SPIN_COST, RUN_LIMITS, DOUBLE, PLAYTIME } from '../../../src/shared/economy.js';
import { rollSpin, spinResult } from '../../../src/shared/slots.js';
import { getItem } from '../../../src/shared/items.js';
import { tx, withConn } from '../db.js';
import { ApiError, MSG } from '../errors.js';
import { loadProfile, ownedItems } from '../profile.js';
import { validateRun } from '../game/runs.js';

const RUN_ID = /^[A-Za-z0-9_-]{22}$/;
const EVENT_NAME = /^[a-z_]{1,40}$/;
const MAX_EVENT_BYTES = 2000;

async function lockUser(conn, userId, columns = 'id') {
  const [user] = await conn.query(`SELECT ${columns} FROM users WHERE id = ? FOR UPDATE`, [userId]);
  if (!user) throw new ApiError(401, MSG.unauthorized);
  return user;
}

export function gameRoutes({ pool, limits, auth }) {
  const r = Router();

  r.get('/health', async (req, res) => {
    try {
      await pool.query('SELECT 1');
    } catch {
      throw new ApiError(503, MSG.dbDown);
    }
    res.json({ ok: true });
  });

  r.get('/me', auth, async (req, res) => {
    res.json(await withConn(pool, (conn) => loadProfile(conn, req.user.id)));
  });

  r.post('/runs', auth, limits.play, async (req, res) => {
    const run = validateRun(req.body);
    if (!run) throw new ApiError(400, MSG.runRejected);
    const uid = req.user.id;
    res.json(await tx(pool, async (conn) => {
      const user = await lockUser(conn, uid,
        'highscore, TIMESTAMPDIFF(MICROSECOND, COALESCE(last_run_at, created_at), NOW(3)) / 1000000 AS elapsed');
      if (run.duration > Number(user.elapsed) + RUN_LIMITS.timeSlack) throw new ApiError(400, MSG.runRejected);
      const runId = randomBytes(16).toString('base64url');
      const durationMs = Math.round(run.duration * 1000);
      await conn.query(
        `INSERT INTO runs (public_id, user_id, distance, score, coins, duration_ms, max_multiplier, tunnels, cause, coins_by_type)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [runId, uid, run.distance, run.score, run.coins, durationMs,
          run.maxMultiplier, run.tunnels, run.cause, JSON.stringify(run.coinsByType)],
      );
      await conn.query(
        `UPDATE users SET coins = coins + ?, total_runs = total_runs + 1, play_flight_ms = play_flight_ms + ?,
           highscore = GREATEST(highscore, ?), best_distance = GREATEST(best_distance, ?), last_run_at = NOW(3)
         WHERE id = ?`,
        [run.coins, durationMs, run.score, run.distance, uid],
      );
      return { runId, newHighscore: run.score > user.highscore, profile: await loadProfile(conn, uid) };
    }));
  });

  r.post('/runs/:id/double', auth, limits.play, async (req, res) => {
    const publicId = req.params.id;
    if (!RUN_ID.test(publicId)) throw new ApiError(404, MSG.runNotFound);
    const uid = req.user.id;
    res.json(await tx(pool, async (conn) => {
      await lockUser(conn, uid);
      const [run] = await conn.query(
        `SELECT id, coins, doubled, TIMESTAMPDIFF(MICROSECOND, created_at, NOW(3)) / 1000000 AS age
         FROM runs WHERE public_id = ? AND user_id = ? FOR UPDATE`,
        [publicId, uid],
      );
      if (!run) throw new ApiError(404, MSG.runNotFound);
      if (run.doubled) throw new ApiError(409, MSG.alreadyClaimed);
      if (run.coins <= 0) throw new ApiError(400, MSG.nothingToDouble);
      if (Number(run.age) < DOUBLE.minDelaySeconds) throw new ApiError(409, MSG.tooEarly);
      if (Number(run.age) > DOUBLE.windowSeconds) throw new ApiError(410, MSG.expired);
      const [{ n }] = await conn.query(
        'SELECT COUNT(*) AS n FROM runs WHERE user_id = ? AND doubled_at > NOW(3) - INTERVAL 1 DAY',
        [uid],
      );
      if (n >= DOUBLE.maxPerDay) throw new ApiError(429, MSG.dailyLimit);
      await conn.query('UPDATE runs SET doubled = 1, doubled_at = NOW(3) WHERE id = ?', [run.id]);
      await conn.query('UPDATE users SET coins = coins + ? WHERE id = ?', [run.coins, uid]);
      return { profile: await loadProfile(conn, uid) };
    }));
  });

  r.post('/spin', auth, limits.play, async (req, res) => {
    const uid = req.user.id;
    res.json(await tx(pool, async (conn) => {
      const user = await lockUser(conn, uid, 'coins');
      if (user.coins < SPIN_COST) throw new ApiError(400, MSG.notEnoughCoins);
      const owned = await ownedItems(conn, uid);
      const [{ gap_ms: gapMs }] = await conn.query(
        'SELECT TIMESTAMPDIFF(MICROSECOND, MAX(created_at), NOW(3)) DIV 1000 AS gap_ms FROM spins WHERE user_id = ?',
        [uid],
      );
      const slotMs = gapMs !== null && gapMs <= PLAYTIME.slotGapSeconds * 1000 ? gapMs : PLAYTIME.spinSeconds * 1000;
      const spin = rollSpin(randomInt);
      const { result, delta: win, newItem } = spinResult(spin, owned);
      const delta = win - SPIN_COST;
      if (newItem) await conn.query('INSERT INTO inventory (user_id, item_id) VALUES (?, ?)', [uid, newItem]);
      await conn.query(
        'UPDATE users SET coins = coins + ?, play_slot_ms = play_slot_ms + ? WHERE id = ?',
        [delta, slotMs, uid],
      );
      await conn.query(
        'INSERT INTO spins (user_id, outcome, reels, item_id, duplicate, coins_delta) VALUES (?, ?, ?, ?, ?, ?)',
        [uid, spin.outcome, JSON.stringify(spin.reels), spin.item?.id ?? null, result.duplicate ? 1 : 0, delta],
      );
      return { reels: spin.reels, result, profile: await loadProfile(conn, uid) };
    }));
  });

  r.post('/equip', auth, limits.play, async (req, res) => {
    const itemId = req.body?.itemId;
    const item = typeof itemId === 'string' ? getItem(itemId) : undefined;
    const uid = req.user.id;
    res.json(await withConn(pool, async (conn) => {
      if (!item || !(await ownedItems(conn, uid)).includes(itemId)) throw new ApiError(400, MSG.notOwned);
      await conn.query(
        `INSERT INTO loadout (user_id, category, item_id) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE item_id = VALUES(item_id)`,
        [uid, item.category, itemId],
      );
      return { profile: await loadProfile(conn, uid) };
    }));
  });

  r.post('/events', auth, limits.events, async (req, res) => {
    const { name, data } = req.body ?? {};
    if (typeof name !== 'string' || !EVENT_NAME.test(name)) throw new ApiError(400, MSG.badEvent);
    if (data != null && (typeof data !== 'object' || Array.isArray(data))) throw new ApiError(400, MSG.badEvent);
    const json = data == null ? null : JSON.stringify(data);
    if (json && Buffer.byteLength(json) > MAX_EVENT_BYTES) throw new ApiError(400, MSG.badEvent);
    await pool.query('INSERT INTO events (user_id, name, data) VALUES (?, ?, ?)', [req.user.id, name, json]);
    res.json({ ok: true });
  });

  return r;
}
