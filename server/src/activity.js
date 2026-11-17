import { SESSION } from '../../src/shared/economy.js';

async function idleSeconds(pool, userId) {
  const [row] = await pool.query(
    'SELECT TIMESTAMPDIFF(SECOND, last_seen_at, NOW(3)) AS idle, consent_stats FROM users WHERE id = ?',
    [userId],
  );
  return row ? { idle: Number(row.idle), stats: row.consent_stats === 1 } : null;
}

async function carryContext(pool, userId) {
  await pool.query(
    `INSERT IGNORE INTO play_sessions
       (user_id, session_no, started_at, last_active_at, tz_offset_min, time_zone, locale, device, os, browser, screen, touch, country, region)
     SELECT u.id, u.session_no, u.session_started_at, NOW(3), COALESCE(p.tz_offset_min, u.tz_offset_min),
       p.time_zone, p.locale, p.device, p.os, p.browser, p.screen, p.touch, p.country, p.region
     FROM users u
     LEFT JOIN play_sessions p ON p.user_id = u.id AND p.session_no < u.session_no
     WHERE u.id = ? AND u.consent_stats = 1
     ORDER BY p.session_no DESC
     LIMIT 1`,
    [userId],
  );
}

export async function touch(pool, userId, known = {}) {
  const state = known.idle == null ? await idleSeconds(pool, userId) : { idle: Number(known.idle), stats: known.stats };
  if (!state || state.idle < SESSION.touchSeconds) return;
  if (state.idle >= SESSION.timeoutMinutes * 60) {
    const { affectedRows } = await pool.query(
      `UPDATE users SET session_no = session_no + 1, session_started_at = NOW(3), last_seen_at = NOW(3)
       WHERE id = ? AND last_seen_at <= NOW(3) - INTERVAL ? MINUTE`,
      [userId, SESSION.timeoutMinutes],
    );
    if (affectedRows === 1 && state.stats) await carryContext(pool, userId);
    return;
  }
  const { affectedRows } = await pool.query(
    'UPDATE users SET last_seen_at = NOW(3) WHERE id = ? AND last_seen_at <= NOW(3) - INTERVAL ? SECOND',
    [userId, SESSION.touchSeconds],
  );
  if (affectedRows === 1 && state.stats) {
    await pool.query(
      `UPDATE play_sessions p JOIN users u ON u.id = p.user_id AND u.session_no = p.session_no
       SET p.last_active_at = NOW(3) WHERE p.user_id = ?`,
      [userId],
    );
  }
}
