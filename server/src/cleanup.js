export async function cleanup(pool, config) {
  await pool.query('DELETE FROM sessions WHERE expires_at < NOW(3)');
  await pool.query(
    'DELETE FROM users WHERE username IS NULL AND last_seen_at < NOW(3) - INTERVAL ? DAY',
    [config.guestRetentionDays],
  );
}
