import { PRIVACY } from '../../../src/shared/economy.js';
import { scoreProfile, deriveSegments } from '../../../src/shared/segments.js';
import { withConn } from '../db.js';
import { computeMetrics } from './metrics.js';

export async function evaluate(conn, userId) {
  const result = await computeMetrics(conn, userId);
  if (!result) return null;
  const scores = scoreProfile(result.metrics);
  return { ...result, scores, segments: deriveSegments(result.metrics, scores) };
}

export async function refreshProfile(pool, userId) {
  return withConn(pool, async (conn) => {
    const p = await evaluate(conn, userId);
    if (!p) {
      await conn.query(
        'DELETE p FROM player_profiles p JOIN users u ON u.id = p.user_id WHERE p.user_id = ? AND u.consent_stats = 0',
        [userId],
      );
      return null;
    }
    const { metrics: m, scores } = p;
    const { affectedRows } = await conn.query(
      `INSERT INTO player_profiles
         (user_id, computed_at, engagement, churn_risk, ad_tolerance, daypart, fav_hour, fav_weekday, weekend_share,
          device, country, region, play_s_30d, active_days_30d, sessions_90d, segments, heat, metrics)
       SELECT id, NOW(3), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
       FROM users WHERE id = ? AND consent_stats = 1 AND CAST(consent_stats_at AS CHAR) <=> ?
       ON DUPLICATE KEY UPDATE computed_at = VALUES(computed_at), engagement = VALUES(engagement),
         churn_risk = VALUES(churn_risk), ad_tolerance = VALUES(ad_tolerance), daypart = VALUES(daypart),
         fav_hour = VALUES(fav_hour), fav_weekday = VALUES(fav_weekday), weekend_share = VALUES(weekend_share),
         device = VALUES(device), country = VALUES(country), region = VALUES(region),
         play_s_30d = VALUES(play_s_30d), active_days_30d = VALUES(active_days_30d), sessions_90d = VALUES(sessions_90d),
         segments = VALUES(segments), heat = VALUES(heat), metrics = VALUES(metrics)`,
      [
        scores.engagement, scores.churnRisk, scores.adTolerance, m.daypart, m.favHour, m.favWeekday, m.weekendShare,
        m.context.device, m.context.country, m.context.region, m.play.s30d, m.play.activeDays30, m.sessions.count,
        JSON.stringify(p.segments), JSON.stringify(p.heat), JSON.stringify(m), userId, p.consentKey,
      ],
    );
    return affectedRows ? { ...scores, segments: p.segments } : null;
  });
}

export async function refreshProfiles(pool, { limit = 200, maxAgeHours = 24 } = {}) {
  const rows = await pool.query(
    `SELECT u.id FROM users u
     LEFT JOIN player_profiles p ON p.user_id = u.id
     WHERE u.consent_stats = 1 AND u.last_seen_at > NOW(3) - INTERVAL ? MONTH
       AND (p.user_id IS NULL OR u.last_seen_at > p.computed_at OR p.computed_at < NOW(3) - INTERVAL ? HOUR)
     ORDER BY p.computed_at IS NOT NULL, p.computed_at, u.id
     LIMIT ?`,
    [PRIVACY.retention.profileMonths, maxAgeHours, limit],
  );
  let refreshed = 0;
  for (const { id } of rows) if (await refreshProfile(pool, id)) refreshed++;
  return refreshed;
}
