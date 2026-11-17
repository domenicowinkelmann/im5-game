import { SEGMENTS } from '../../../src/shared/economy.js';
import { heatStats, usualGapHours } from '../../../src/shared/segments.js';

const round = (v, digits = 0) => Math.round(v * 10 ** digits) / 10 ** digits;
const sum = (list) => list.reduce((s, v) => s + v, 0);
const avg = (list) => (list.length ? sum(list) / list.length : null);

function median(list) {
  if (!list.length) return null;
  const sorted = [...list].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function mode(values) {
  const counts = new Map();
  let best = null;
  for (const v of values) {
    if (v == null || v === '') continue;
    const n = (counts.get(v) ?? 0) + 1;
    counts.set(v, n);
    if (best === null || n >= counts.get(best)) best = v;
  }
  return best;
}

const plays = (conn, userId, since) => conn.query(
  `SELECT x.ms, x.recent, HOUR(x.ts + INTERVAL x.off MINUTE) AS h, WEEKDAY(x.ts + INTERVAL x.off MINUTE) AS wd,
     TO_DAYS(x.ts + INTERVAL x.off MINUTE) AS day
   FROM (
     SELECT r.duration_ms AS ms, r.created_at AS ts, r.created_at >= NOW(3) - INTERVAL ? DAY AS recent,
       COALESCE(p.tz_offset_min, u.tz_offset_min, 0) AS off
     FROM runs r
     JOIN users u ON u.id = r.user_id
     LEFT JOIN play_sessions p ON p.user_id = r.user_id AND p.session_no = r.session_no
     WHERE r.user_id = ? AND r.created_at >= ?
     UNION ALL
     SELECT s.slot_ms, s.created_at, s.created_at >= NOW(3) - INTERVAL ? DAY,
       COALESCE(p.tz_offset_min, u.tz_offset_min, 0)
     FROM spins s
     JOIN users u ON u.id = s.user_id
     LEFT JOIN play_sessions p ON p.user_id = s.user_id AND p.session_no = s.session_no
     WHERE s.user_id = ? AND s.created_at >= ?
   ) x`,
  [SEGMENTS.recentDays, userId, since, SEGMENTS.recentDays, userId, since],
);

const sessionSpans = (conn, userId, since) => conn.query(
  `SELECT session_no, clipped, TIMESTAMPDIFF(SECOND, start_ts, end_ts) AS dur_s,
     TIMESTAMPDIFF(SECOND, LAG(end_ts) OVER (ORDER BY start_ts, session_no), start_ts) AS pause_s
   FROM (
     SELECT session_no, MIN(t0) < ? AS clipped, GREATEST(MIN(t0), ?) AS start_ts, MAX(t1) AS end_ts
     FROM (
       SELECT session_no, started_at AS t0, last_active_at AS t1
         FROM play_sessions WHERE user_id = ? AND last_active_at >= ?
       UNION ALL
       SELECT session_no, created_at - INTERVAL duration_ms * 1000 MICROSECOND, created_at
         FROM runs WHERE user_id = ? AND created_at >= ?
       UNION ALL
       SELECT session_no, created_at - INTERVAL slot_ms * 1000 MICROSECOND, created_at
         FROM spins WHERE user_id = ? AND created_at >= ?
     ) t
     GROUP BY session_no
   ) s
   ORDER BY start_ts, session_no`,
  [since, since, userId, since, userId, since, userId, since],
);

function gameplay(runs) {
  if (!runs.length) {
    return { runs: 0, avgDistance: null, maxDistance: null, avgScore: null, avgDurationS: null, avgMultiplier: null, tunnelsPerKm: null, topCause: null, trend: null };
  }
  const distances = runs.map((r) => r.distance);
  const totalKm = sum(distances) / 1000;
  const k = Math.min(SEGMENTS.trendRuns, Math.floor(runs.length / 2));
  const first = k ? avg(distances.slice(0, k)) : null;
  const last = k ? avg(distances.slice(-k)) : null;
  return {
    runs: runs.length,
    avgDistance: round(avg(distances)),
    maxDistance: Math.max(...distances),
    avgScore: round(avg(runs.map((r) => r.score))),
    avgDurationS: round(avg(runs.map((r) => r.duration_ms)) / 1000, 1),
    avgMultiplier: round(avg(runs.map((r) => r.max_multiplier)), 2),
    tunnelsPerKm: totalKm > 0 ? round(sum(runs.map((r) => r.tunnels)) / totalKm, 2) : 0,
    topCause: mode(runs.map((r) => r.cause)),
    trend: first ? round(last / first - 1, 3) : null,
  };
}

const duration = (r) => Math.max(0, Number(r.dur_s));

function sessionStats(rows, currentNo) {
  const durations = rows.map(duration);
  const completed = rows.filter((r) => !Number(r.clipped) && r.session_no < currentNo).map(duration);
  const pauses = rows.slice(1).map((r) => Math.max(0, Number(r.pause_s)) / 3600);
  const medianPause = median(pauses);
  return {
    count: rows.length,
    avgS: rows.length ? round(avg(durations)) : null,
    completedCount: completed.length,
    completedAvgS: completed.length ? round(avg(completed)) : null,
    medianS: rows.length ? round(median(durations)) : null,
    medianPauseH: medianPause === null ? null : round(medianPause, 2),
    usualGapH: round(usualGapHours(medianPause), 2),
    lastPauseH: pauses.length ? round(pauses[pauses.length - 1], 2) : null,
  };
}

function context(rows) {
  const country = mode(rows.map((r) => r.country));
  const first = rows[0];
  return {
    context: {
      device: mode(rows.map((r) => r.device)),
      os: mode(rows.map((r) => r.os)),
      browser: mode(rows.map((r) => r.browser)),
      country,
      region: country ? mode(rows.filter((r) => r.country === country).map((r) => r.region)) : null,
    },
    acquisition: {
      referrer: first?.referrer ?? null,
      utmSource: first?.utm_source ?? null,
      utmMedium: first?.utm_medium ?? null,
      utmCampaign: first?.utm_campaign ?? null,
    },
  };
}

async function engagement(conn, userId, since) {
  const rows = await conn.query(
    `SELECT kind, reason, COUNT(*) AS shown, SUM(outcome <=> 'continued') AS continued,
       SUM(outcome <=> 'clicked') AS clicked, SUM(outcome <=> 'dismissed') AS dismissed
     FROM decisions WHERE user_id = ? AND shown = 1 AND created_at >= ?
     GROUP BY kind, reason ORDER BY kind, reason`,
    [userId, since],
  );
  const ads = { shown: 0, continued: 0 };
  const nudges = {};
  for (const r of rows) {
    if (r.kind === 'interstitial') {
      ads.shown += Number(r.shown);
      ads.continued += Number(r.continued);
    } else if (r.kind === 'nudge') {
      nudges[r.reason] = { shown: Number(r.shown), clicked: Number(r.clicked), dismissed: Number(r.dismissed) };
    }
  }
  return { ads, nudges };
}

export async function computeMetrics(conn, userId) {
  const [user] = await conn.query(
    `SELECT username, coins, session_no, CAST(consent_stats_at AS CHAR) AS consent_key,
       CAST(COALESCE(consent_stats_at, NOW(3)) AS CHAR) AS consented,
       CAST(GREATEST(COALESCE(consent_stats_at, NOW(3)), NOW(3) - INTERVAL ? DAY) AS CHAR) AS since,
       TIMESTAMPDIFF(SECOND, last_seen_at, NOW(3)) AS idle_s,
       TIMESTAMPDIFF(SECOND, COALESCE(consent_stats_at, NOW(3)), NOW(3)) AS consent_s
     FROM users WHERE id = ? AND consent_stats = 1`,
    [SEGMENTS.windowDays, userId],
  );
  if (!user) return null;
  const { since } = user;
  const playRows = await plays(conn, userId, since);
  const runs = await conn.query(
    `SELECT distance, score, duration_ms, max_multiplier, tunnels, cause
     FROM runs WHERE user_id = ? AND created_at >= ? ORDER BY created_at, id`,
    [userId, since],
  );
  const spans = await sessionSpans(conn, userId, since);
  const sessionRows = await conn.query(
    `SELECT device, os, browser, country, region, referrer, utm_source, utm_medium, utm_campaign
     FROM play_sessions WHERE user_id = ? AND last_active_at >= ? ORDER BY session_no`,
    [userId, since],
  );
  const [{ n: extraItems }] = await conn.query('SELECT COUNT(*) AS n FROM inventory WHERE user_id = ?', [userId]);
  const [consented] = await conn.query(
    `SELECT COUNT(DISTINCT session_no) AS sessions, COALESCE(SUM(is_run), 0) AS runs
     FROM (
       SELECT session_no, 0 AS is_run FROM play_sessions WHERE user_id = ? AND last_active_at >= ?
       UNION ALL
       SELECT session_no, 1 FROM runs WHERE user_id = ? AND created_at >= ?
       UNION ALL
       SELECT session_no, 0 FROM spins WHERE user_id = ? AND created_at >= ?
     ) t`,
    [userId, user.consented, userId, user.consented, userId, user.consented],
  );

  const heatMs = Array(168).fill(0);
  const days = new Set();
  const recentDays = new Set();
  let recentMs = 0;
  for (const p of playRows) {
    heatMs[p.wd * 24 + p.h] += p.ms;
    days.add(p.day);
    if (p.recent) {
      recentDays.add(p.day);
      recentMs += p.ms;
    }
  }
  const heat = heatMs.map((ms) => Math.round(ms / 1000));
  const stats = heatStats(heat);
  const metrics = {
    windowDays: SEGMENTS.windowDays,
    hoursSinceLast: round(Number(user.idle_s) / 3600, 2),
    account: {
      guest: user.username === null,
      consentHours: round(Number(user.consent_s) / 3600, 2),
      sessions: Number(consented.sessions),
      runs: Number(consented.runs),
      extraItems,
      coins: user.coins,
    },
    sessions: sessionStats(spans, user.session_no),
    play: {
      totalS: stats.total,
      s30d: Math.round(recentMs / 1000),
      activeDays30: recentDays.size,
      activeDays90: days.size,
    },
    favHour: stats.favHour,
    favWeekday: stats.favWeekday,
    daypart: stats.daypart,
    dayparts: stats.dayparts,
    weekendShare: stats.weekendShare,
    consistency: stats.consistency,
    ...context(sessionRows),
    gameplay: gameplay(runs),
    ...(await engagement(conn, userId, since)),
  };
  return { consentKey: user.consent_key, heat, metrics };
}
