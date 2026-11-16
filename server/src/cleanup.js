import { ACCOUNT } from '../../src/shared/economy.js';
import { tx } from './db.js';
import { archiveUser } from './analytics/archive.js';

export async function cleanupSessions(pool) {
  const { affectedRows } = await pool.query('DELETE FROM sessions WHERE expires_at < NOW(3)');
  return affectedRows;
}

async function removeGuest(pool, userId) {
  return tx(pool, async (conn) => {
    const [guest] = await conn.query(
      `SELECT id FROM users
       WHERE id = ? AND username IS NULL AND last_seen_at < NOW(3) - INTERVAL ? HOUR FOR UPDATE`,
      [userId, ACCOUNT.guestRetentionHours],
    );
    if (!guest) return false;
    await archiveUser(conn, userId, 'expired');
    await conn.query('DELETE FROM users WHERE id = ?', [userId]);
    return true;
  });
}

export async function cleanupGuests(pool, { batch = 100 } = {}) {
  let removed = 0;
  for (;;) {
    const rows = await pool.query(
      `SELECT id FROM users
       WHERE username IS NULL AND last_seen_at < NOW(3) - INTERVAL ? HOUR
       ORDER BY last_seen_at, id LIMIT ?`,
      [ACCOUNT.guestRetentionHours, batch],
    );
    let n = 0;
    for (const { id } of rows) if (await removeGuest(pool, id)) n++;
    removed += n;
    if (rows.length < batch || n === 0) return removed;
  }
}

export async function cleanup(pool, config) {
  const sessions = await cleanupSessions(pool);
  const guests = await cleanupGuests(pool, { batch: config.jobs.cleanupBatch });
  return { sessions, guests };
}
