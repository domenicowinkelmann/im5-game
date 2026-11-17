import { STATS_OUTCOMES } from '../../../src/shared/economy.js';

export async function purgeAnalytics(conn, userId) {
  await conn.query('DELETE FROM events WHERE user_id = ?', [userId]);
  await conn.query('DELETE FROM play_sessions WHERE user_id = ?', [userId]);
  await conn.query('DELETE FROM player_profiles WHERE user_id = ?', [userId]);
  await conn.query('DELETE FROM decisions WHERE user_id = ? AND shown = 0', [userId]);
  await conn.query(
    `UPDATE decisions SET outcome = NULL, outcome_at = NULL
     WHERE user_id = ? AND outcome IN (${STATS_OUTCOMES.map(() => '?').join(', ')})`,
    [userId, ...STATS_OUTCOMES],
  );
  await conn.query('UPDATE users SET tz_offset_min = NULL WHERE id = ?', [userId]);
}
