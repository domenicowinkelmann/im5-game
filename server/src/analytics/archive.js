export async function archiveUser(conn, userId, reason) {
  const { affectedRows, insertId } = await conn.query(
    `INSERT INTO player_archive
       (reason, archived_on, first_day, last_day, registered, consent_stats, sessions, runs, spins, play_s, doubled, interstitials)
     SELECT ?, UTC_DATE(), DATE(u.created_at), DATE(u.last_seen_at), u.username IS NOT NULL, 0, u.session_no,
       (SELECT COUNT(*) FROM runs WHERE user_id = u.id),
       (SELECT COUNT(*) FROM spins WHERE user_id = u.id),
       (u.play_flight_ms + u.play_slot_ms) DIV 1000,
       (SELECT COUNT(*) FROM runs WHERE user_id = u.id AND doubled = 1),
       0
     FROM users u WHERE u.id = ?`,
    [reason, userId],
  );
  if (affectedRows !== 1) return null;
  await conn.query(
    `INSERT INTO player_archive_days (archive_id, day, runs, flight_s, spins, slot_s, doubled)
     SELECT ?, day, SUM(runs), SUM(flight_ms) DIV 1000, SUM(spins), SUM(slot_ms) DIV 1000, SUM(doubled)
     FROM (
       SELECT DATE(created_at) AS day, 1 AS runs, duration_ms AS flight_ms, 0 AS spins, 0 AS slot_ms, 0 AS doubled
         FROM runs WHERE user_id = ?
       UNION ALL
       SELECT DATE(COALESCE(doubled_at, created_at)), 0, 0, 0, 0, 1 FROM runs WHERE user_id = ? AND doubled = 1
       UNION ALL
       SELECT DATE(created_at), 0, 0, 1, slot_ms, 0 FROM spins WHERE user_id = ?
     ) activity
     GROUP BY day`,
    [insertId, userId, userId, userId],
  );
  return insertId;
}
