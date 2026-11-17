import { ADMIN, PRIVACY } from '../../../src/shared/economy.js';
import { SEGMENT_LABELS } from '../../../src/shared/segments.js';
import { asJson } from '../db.js';
import { loadProfile } from '../profile.js';

export const PLAYER_SORTS = {
  id: 'u.id',
  username: 'u.username',
  created: 'u.created_at',
  lastSeen: 'u.last_seen_at',
  runs: 'u.total_runs',
  coins: 'u.coins',
  playTime: '(u.play_flight_ms + u.play_slot_ms)',
  engagement: 'IF(u.consent_stats = 1, p.engagement, NULL)',
};

const TYPES = {
  guest: 'u.username IS NULL',
  registered: 'u.username IS NOT NULL AND u.is_admin = 0',
  admin: 'u.is_admin = 1',
};

const CONSENTS = {
  stats: 'u.consent_stats = 1',
  personal: 'u.consent_personal = 1',
  none: 'u.consent_stats = 0',
};

export const PLAYER_FILTERS = { types: Object.keys(TYPES), consents: Object.keys(CONSENTS), segments: Object.keys(SEGMENT_LABELS) };

const HIDDEN_EVENTS = 'rewarded\\_ad\\_%';
const HIDDEN_SCREEN = 'slots';
const HIDDEN_REASON = 'cooldown';

const num = (v) => (v == null ? null : Number(v));

export const escapeLike = (q) => q.replace(/[\\%_]/g, (c) => `\\${c}`);

const typeOf = (u) => (u.is_admin === 1 ? 'admin' : u.username === null ? 'guest' : 'registered');

const consentOf = (u) => ({
  decided: u.consent_version === PRIVACY.version,
  stats: u.consent_stats === 1,
  personal: u.consent_personal === 1,
  adult: u.age_16plus === 1,
});

export async function listPlayers(db, { q = '', segment = null, type = null, consent = null, sort = 'lastSeen', dir = 'desc', page = 1 }) {
  const where = [];
  const params = [];
  if (q) {
    if (/^[0-9]{1,10}$/.test(q)) {
      where.push('(u.username LIKE ? OR u.id = ?)');
      params.push(`%${escapeLike(q)}%`, Number(q));
    } else {
      where.push('u.username LIKE ?');
      params.push(`%${escapeLike(q)}%`);
    }
  }
  if (segment) {
    where.push('u.consent_stats = 1 AND JSON_CONTAINS(p.segments, JSON_QUOTE(?))');
    params.push(segment);
  }
  if (type) where.push(TYPES[type]);
  if (consent) where.push(CONSENTS[consent]);
  const from = `FROM users u LEFT JOIN player_profiles p ON p.user_id = u.id${where.length ? ` WHERE ${where.join(' AND ')}` : ''}`;
  const order = dir === 'asc' ? 'ASC' : 'DESC';
  const [{ total: count }] = await db.query(`SELECT COUNT(*) AS total ${from}`, params);
  const total = Number(count);
  const current = Math.min(page, Math.max(1, Math.ceil(total / ADMIN.pageSize)));
  const rows = await db.query(
    `SELECT u.id, u.username, u.is_admin, u.consent_version, u.consent_stats, u.consent_personal, u.age_16plus,
       u.created_at, u.last_seen_at, u.total_runs, u.coins, u.play_flight_ms, u.play_slot_ms,
       IF(u.consent_stats = 1, p.engagement, NULL) AS engagement, IF(u.consent_stats = 1, p.segments, NULL) AS segments
     ${from}
     ORDER BY ${PLAYER_SORTS[sort]} ${order}, u.id ${order}
     LIMIT ? OFFSET ?`,
    [...params, ADMIN.pageSize, (current - 1) * ADMIN.pageSize],
  );
  return {
    players: rows.map((u) => ({
      id: u.id,
      username: u.username,
      type: typeOf(u),
      consent: consentOf(u),
      createdAt: u.created_at,
      lastSeenAt: u.last_seen_at,
      runs: u.total_runs,
      coins: u.coins,
      playSeconds: Math.floor((Number(u.play_flight_ms) + Number(u.play_slot_ms)) / 1000),
      engagement: num(u.engagement),
      segments: u.consent_stats === 1 ? asJson(u.segments) ?? null : null,
    })),
    total,
    page: current,
    pageSize: ADMIN.pageSize,
  };
}

function grid(heat) {
  return Array.isArray(heat) && heat.length === 168 ? Array.from({ length: 7 }, (_, d) => heat.slice(d * 24, d * 24 + 24)) : null;
}

export async function playerProfile(db, id) {
  const [p] = await db.query(
    `SELECT p.* FROM player_profiles p JOIN users u ON u.id = p.user_id AND u.consent_stats = 1 WHERE p.user_id = ?`,
    [id],
  );
  if (!p) return null;
  return {
    computedAt: p.computed_at,
    engagement: num(p.engagement),
    churnRisk: num(p.churn_risk),
    adTolerance: num(p.ad_tolerance),
    daypart: p.daypart,
    favHour: num(p.fav_hour),
    favWeekday: num(p.fav_weekday),
    weekendShare: num(p.weekend_share),
    device: p.device,
    country: p.country,
    region: p.region,
    playSeconds30d: num(p.play_s_30d),
    activeDays30d: num(p.active_days_30d),
    sessions90d: num(p.sessions_90d),
    segments: asJson(p.segments) ?? [],
    heatmap: grid(asJson(p.heat)),
    metrics: asJson(p.metrics),
  };
}

export async function playerDetail(db, id) {
  const [u] = await db.query(
    `SELECT id, username, is_admin, created_at, last_seen_at, registered_at, last_run_at, session_no, session_started_at,
       consent_version, consent_stats, consent_personal, age_16plus, consent_at, consent_stats_at, tz_offset_min
     FROM users WHERE id = ?`,
    [id],
  );
  if (!u) return null;
  const game = await loadProfile(db, id);
  const runs = await db.query(
    `SELECT public_id, session_no, distance, score, coins, duration_ms, max_multiplier, tunnels, cause, created_at
     FROM runs WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`,
    [id, ADMIN.recentRows],
  );
  const decisions = await db.query(
    `SELECT id, session_no, placement, kind, shown, reason, personalized, outcome, outcome_at, created_at
     FROM decisions WHERE user_id = ? AND NOT (reason <=> ?) ORDER BY created_at DESC, id DESC LIMIT ?`,
    [id, HIDDEN_REASON, ADMIN.recentRows],
  );
  const stats = u.consent_stats === 1;
  const sessions = stats ? await db.query(
    `SELECT session_no, started_at, last_active_at, TIMESTAMPDIFF(SECOND, started_at, last_active_at) AS duration_s,
       tz_offset_min, time_zone, locale, device, os, browser, screen, touch, referrer, utm_source, utm_medium, utm_campaign,
       country, region
     FROM play_sessions WHERE user_id = ? ORDER BY session_no DESC LIMIT ?`,
    [id, ADMIN.recentRows],
  ) : [];
  const events = stats ? await db.query(
    `SELECT e.id, e.name, e.data, e.created_at FROM events e JOIN users u ON u.id = e.user_id
     WHERE e.user_id = ? AND e.created_at >= u.consent_stats_at AND e.name NOT LIKE ?
       AND NOT (e.name = 'screen_view' AND JSON_VALUE(e.data, '$.screen') <=> ?)
     ORDER BY e.created_at DESC, e.id DESC LIMIT ?`,
    [id, HIDDEN_EVENTS, HIDDEN_SCREEN, ADMIN.recentRows],
  ) : [];
  return {
    player: {
      id: u.id,
      username: u.username,
      type: typeOf(u),
      createdAt: u.created_at,
      lastSeenAt: u.last_seen_at,
      registeredAt: u.registered_at,
      lastRunAt: u.last_run_at,
      sessionNo: u.session_no,
      sessionStartedAt: u.session_started_at,
    },
    game: {
      coins: game.coins,
      highscore: game.highscore,
      bestDistance: game.bestDistance,
      totalRuns: game.totalRuns,
      playTime: { total: game.playTime.total },
      inventory: game.inventory,
      equipped: game.equipped,
    },
    consent: {
      ...consentOf(u),
      version: u.consent_version,
      at: u.consent_at,
      statsAt: u.consent_stats_at,
    },
    runs: runs.map((r) => ({
      id: r.public_id,
      sessionNo: r.session_no,
      distance: r.distance,
      score: r.score,
      coins: r.coins,
      durationS: r.duration_ms / 1000,
      maxMultiplier: r.max_multiplier,
      tunnels: r.tunnels,
      cause: r.cause,
      createdAt: r.created_at,
    })),
    decisions: decisions.map((d) => ({
      id: Number(d.id),
      sessionNo: d.session_no,
      placement: d.placement,
      kind: d.kind,
      shown: d.shown === 1,
      reason: d.reason,
      personalized: d.personalized === 1,
      outcome: d.outcome,
      outcomeAt: d.outcome_at,
      createdAt: d.created_at,
    })),
    analytics: {
      allowed: stats,
      tzOffsetMin: stats ? num(u.tz_offset_min) : null,
      profile: stats ? await playerProfile(db, id) : null,
      sessions: sessions.map((s) => ({
        sessionNo: s.session_no,
        startedAt: s.started_at,
        lastActiveAt: s.last_active_at,
        durationS: Number(s.duration_s),
        tzOffsetMin: num(s.tz_offset_min),
        timeZone: s.time_zone,
        locale: s.locale,
        device: s.device,
        os: s.os,
        browser: s.browser,
        screen: s.screen,
        touch: s.touch == null ? null : s.touch === 1,
        referrer: s.referrer,
        utm: { source: s.utm_source, medium: s.utm_medium, campaign: s.utm_campaign },
        country: s.country,
        region: s.region,
      })),
      events: events.map((e) => ({ id: Number(e.id), name: e.name, data: asJson(e.data), createdAt: e.created_at })),
    },
  };
}
