import { PRIVACY } from '../../../src/shared/economy.js';

async function deleteOlder(pool, table, column, days, batch) {
  let total = 0;
  for (;;) {
    const { affectedRows } = await pool.query(
      `DELETE FROM ${table} WHERE ${column} < NOW(3) - INTERVAL ? DAY LIMIT ?`,
      [days, batch],
    );
    total += affectedRows;
    if (affectedRows < batch) return total;
  }
}

async function deleteInactiveProfiles(pool, months, batch) {
  let total = 0;
  for (;;) {
    const { affectedRows } = await pool.query(
      `DELETE FROM player_profiles
       WHERE user_id IN (SELECT id FROM users WHERE last_seen_at < NOW(3) - INTERVAL ? MONTH) LIMIT ?`,
      [months, batch],
    );
    total += affectedRows;
    if (affectedRows < batch) return total;
  }
}

export async function purgeRaw(pool, { batch = 5000 } = {}) {
  const { eventsDays, sessionsDays, decisionsDays, profileMonths } = PRIVACY.retention;
  const events = await deleteOlder(pool, 'events', 'created_at', eventsDays, batch);
  const sessions = await deleteOlder(pool, 'play_sessions', 'started_at', sessionsDays, batch);
  const decisions = await deleteOlder(pool, 'decisions', 'created_at', decisionsDays, batch);
  const profiles = await deleteInactiveProfiles(pool, profileMonths, batch);
  return { events, sessions, decisions, profiles };
}
