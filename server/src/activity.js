import { SESSION } from '../../src/shared/economy.js';

async function idleSeconds(pool, userId) {
  const [row] = await pool.query(
    'SELECT TIMESTAMPDIFF(SECOND, last_seen_at, NOW(3)) AS idle FROM users WHERE id = ?',
    [userId],
  );
  return row ? Number(row.idle) : null;
}

export async function touch(pool, userId, idle) {
  const seconds = idle ?? await idleSeconds(pool, userId);
  if (seconds === null || seconds < SESSION.touchSeconds) return;
  if (seconds >= SESSION.timeoutMinutes * 60) {
    await pool.query(
      `UPDATE users SET session_no = session_no + 1, session_started_at = NOW(3), last_seen_at = NOW(3)
       WHERE id = ? AND last_seen_at <= NOW(3) - INTERVAL ? MINUTE`,
      [userId, SESSION.timeoutMinutes],
    );
    return;
  }
  await pool.query(
    'UPDATE users SET last_seen_at = NOW(3) WHERE id = ? AND last_seen_at <= NOW(3) - INTERVAL ? SECOND',
    [userId, SESSION.touchSeconds],
  );
}
