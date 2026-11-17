import { evaluate } from './profiles.js';

export const SEED_MARKER = '!seed-demo';
const CONTEXT_REASONS = ['expired', 'seed'];

async function archiveContext(conn, userId, reason) {
  if (!CONTEXT_REASONS.includes(reason)) return null;
  const p = await evaluate(conn, userId);
  if (!p) return null;
  const { device, os, browser, country, region } = p.metrics.context;
  return { device, os, browser, country, region, heat: JSON.stringify(p.heat), segments: JSON.stringify(p.segments) };
}

async function nudgeSummary(conn, userId) {
  const rows = await conn.query(
    `SELECT reason, COUNT(*) AS shown, SUM(outcome <=> 'clicked') AS clicked
     FROM decisions WHERE user_id = ? AND kind = 'nudge' AND shown = 1 GROUP BY reason ORDER BY reason`,
    [userId],
  );
  if (!rows.length) return null;
  return JSON.stringify(Object.fromEntries(rows.map((r) => [r.reason, { shown: Number(r.shown), clicked: Number(r.clicked) }])));
}

export async function archiveUser(conn, userId, reason) {
  const c = await archiveContext(conn, userId, reason);
  const nudges = await nudgeSummary(conn, userId);
  const { affectedRows, insertId } = await conn.query(
    `INSERT INTO player_archive
       (reason, archived_on, first_day, last_day, registered, consent_stats, sessions, runs, spins, play_s, doubled, interstitials,
        nudges, device, os, browser, country, region, heat, segments)
     SELECT IF(u.password_hash <=> ?, 'seed', ?), UTC_DATE(), DATE(u.created_at), DATE(u.last_seen_at), u.username IS NOT NULL, u.consent_stats, u.session_no,
       (SELECT COUNT(*) FROM runs WHERE user_id = u.id),
       (SELECT COUNT(*) FROM spins WHERE user_id = u.id),
       (u.play_flight_ms + u.play_slot_ms) DIV 1000,
       (SELECT COUNT(*) FROM runs WHERE user_id = u.id AND doubled = 1),
       (SELECT COUNT(*) FROM decisions WHERE user_id = u.id AND kind = 'interstitial' AND shown = 1),
       ?, ?, ?, ?, ?, ?, ?, ?
     FROM users u WHERE u.id = ?`,
    [SEED_MARKER, reason, nudges, c?.device ?? null, c?.os ?? null, c?.browser ?? null, c?.country ?? null, c?.region ?? null,
      c?.heat ?? null, c?.segments ?? null, userId],
  );
  if (affectedRows !== 1) return null;
  await conn.query(
    `INSERT INTO player_archive_days
       (archive_id, day, runs, flight_s, spins, slot_s, doubled, interstitials, nudges_shown, nudges_clicked)
     SELECT ?, day, SUM(runs), SUM(flight_ms) DIV 1000, SUM(spins), SUM(slot_ms) DIV 1000, SUM(doubled),
       SUM(interstitials), SUM(nudges_shown), SUM(nudges_clicked)
     FROM (
       SELECT DATE(created_at) AS day, 1 AS runs, duration_ms AS flight_ms, 0 AS spins, 0 AS slot_ms, 0 AS doubled,
           0 AS interstitials, 0 AS nudges_shown, 0 AS nudges_clicked
         FROM runs WHERE user_id = ?
       UNION ALL
       SELECT DATE(COALESCE(doubled_at, created_at)), 0, 0, 0, 0, 1, 0, 0, 0 FROM runs WHERE user_id = ? AND doubled = 1
       UNION ALL
       SELECT DATE(created_at), 0, 0, 1, slot_ms, 0, 0, 0, 0 FROM spins WHERE user_id = ?
       UNION ALL
       SELECT DATE(created_at), 0, 0, 0, 0, 0, kind = 'interstitial', kind = 'nudge', kind = 'nudge' AND outcome <=> 'clicked'
         FROM decisions WHERE user_id = ? AND shown = 1
     ) activity
     GROUP BY day`,
    [insertId, userId, userId, userId, userId],
  );
  await conn.query(
    `UPDATE player_archive_days d
     JOIN (
       SELECT day, JSON_OBJECTAGG(reason, shown) AS reasons
       FROM (
         SELECT DATE(created_at) AS day, reason, COUNT(*) AS shown
         FROM decisions WHERE user_id = ? AND kind = 'nudge' AND shown = 1
         GROUP BY DATE(created_at), reason
       ) r
       GROUP BY day
     ) x ON x.day = d.day
     SET d.nudge_reasons = x.reasons
     WHERE d.archive_id = ?`,
    [userId, insertId],
  );
  return insertId;
}
