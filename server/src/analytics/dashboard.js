import { ADMIN, ACCOUNT, DAYPARTS, PRIVACY, SEGMENTS } from '../../../src/shared/economy.js';
import { SEGMENT_LABELS, heatStats } from '../../../src/shared/segments.js';
import { asJson } from '../db.js';

const DAY_MS = 86400000;
const n = (v) => Number(v ?? 0);
const rate = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 1000 : null);
const round1 = (v) => Math.round(v * 10) / 10;

const LIVE_DAYS = `
  SELECT user_id AS uid, DATE(created_at) AS day FROM runs WHERE created_at >= ?
  UNION SELECT user_id, DATE(created_at) FROM spins WHERE created_at >= ?
  UNION SELECT user_id, DATE(started_at) FROM play_sessions WHERE started_at >= ?
  UNION SELECT id, DATE(created_at) FROM users WHERE created_at >= ?
  UNION SELECT id, DATE(last_seen_at) FROM users WHERE last_seen_at >= ?`;

const ARCHIVE_DAYS = `
  SELECT archive_id AS aid, day FROM player_archive_days WHERE day >= ?
  UNION SELECT id, first_day FROM player_archive WHERE first_day >= ?
  UNION SELECT id, last_day FROM player_archive WHERE last_day >= ?`;

export function dayList(start, count) {
  const first = Date.parse(`${start}T00:00:00Z`);
  return Array.from({ length: count }, (_, i) => new Date(first + i * DAY_MS).toISOString().slice(0, 10));
}

async function range(db, days) {
  const { decisionsDays, sessionsDays } = PRIVACY.retention;
  const [row] = await db.query(
    `SELECT CAST(UTC_DATE() AS CHAR) AS today, CAST(UTC_DATE() - INTERVAL ? DAY AS CHAR) AS start,
       CAST(UTC_DATE() - INTERVAL LEAST(?, ?) DAY AS CHAR) AS decisionsFrom,
       CAST(UTC_DATE() - INTERVAL LEAST(?, ?) DAY AS CHAR) AS sessionsFrom`,
    [days - 1, days - 1, decisionsDays - 1, days - 1, sessionsDays - 1],
  );
  return row;
}

const decisionsNote = ({ start, decisionsFrom }) => (decisionsFrom > start
  ? [`Interstitials und Erinnerungen erst ab ${decisionsFrom}: Entscheidungen werden nach ${PRIVACY.retention.decisionsDays} Tagen gelöscht, auch die gelöschter Gäste zählen erst ab da.`]
  : []);

function toGrid(heat) {
  return Array.from({ length: 7 }, (_, d) => heat.slice(d * 24, d * 24 + 24));
}

function addHeat(target, heat) {
  if (!Array.isArray(heat) || heat.length !== 168 || !heat.some((v) => n(v) > 0)) return false;
  heat.forEach((v, i) => { target[i] += n(v); });
  return true;
}

async function nudgeFunnel(db, start) {
  const live = await db.query(
    `SELECT d.reason, COUNT(*) AS shown, SUM(d.outcome <=> 'dismissed') AS dismissed,
       SUM(COALESCE(u.registered_at >= d.created_at AND u.registered_at <= d.created_at + INTERVAL 24 HOUR, 0)) AS signups
     FROM decisions d JOIN users u ON u.id = d.user_id
     WHERE d.kind = 'nudge' AND d.shown = 1 AND d.created_at >= ?
     GROUP BY d.reason`,
    [start],
  );
  const consented = await db.query(
    `SELECT d.reason, COUNT(*) AS shown, SUM(d.outcome <=> 'clicked') AS clicked
     FROM decisions d JOIN users u ON u.id = d.user_id AND u.consent_stats = 1
     WHERE d.kind = 'nudge' AND d.shown = 1 AND d.created_at >= ? AND d.created_at >= u.consent_stats_at
     GROUP BY d.reason`,
    [start],
  );
  const [registered] = await db.query(
    `SELECT COUNT(DISTINCT d.user_id) AS c
     FROM decisions d JOIN users u ON u.id = d.user_id
     WHERE d.kind = 'nudge' AND d.shown = 1 AND d.created_at >= ?
       AND u.registered_at >= d.created_at AND u.registered_at <= d.created_at + INTERVAL 24 HOUR`,
    [start],
  );
  const archived = await db.query(
    `SELECT d.nudges_shown, d.nudge_reasons
     FROM player_archive_days d JOIN player_archive a ON a.id = d.archive_id AND a.registered = 0
     WHERE d.day >= ? AND d.nudges_shown > 0`,
    [start],
  );
  const reasons = new Map();
  const entry = (reason) => {
    if (!reasons.has(reason)) {
      reasons.set(reason, { reason, shown: 0, archivedShown: 0, dismissed: 0, signups: 0, consentedShown: 0, clicked: 0 });
    }
    return reasons.get(reason);
  };
  for (const r of live) Object.assign(entry(r.reason), { shown: n(r.shown), dismissed: n(r.dismissed), signups: n(r.signups) });
  for (const r of consented) Object.assign(entry(r.reason), { consentedShown: n(r.shown), clicked: n(r.clicked) });
  for (const row of archived) {
    let left = n(row.nudges_shown);
    for (const [reason, v] of Object.entries(asJson(row.nudge_reasons) ?? {})) {
      const shown = Math.min(left, n(v));
      entry(reason).archivedShown += shown;
      left -= shown;
    }
    if (left > 0) entry('unknown').archivedShown += left;
  }
  const finish = (e) => ({
    ...e,
    dismissRate: rate(e.dismissed, e.shown),
    signupRate: rate(e.signups, e.shown + e.archivedShown),
    clickRate: rate(e.clicked, e.consentedShown),
  });
  const list = [...reasons.values()].sort((a, b) => a.reason.localeCompare(b.reason));
  const total = list.reduce((t, e) => {
    for (const k of ['shown', 'archivedShown', 'dismissed', 'signups', 'consentedShown', 'clicked']) t[k] += e[k];
    return t;
  }, { shown: 0, archivedShown: 0, dismissed: 0, signups: 0, consentedShown: 0, clicked: 0 });
  return { byReason: list.map(finish), total: { ...finish(total), registrations: n(registered.c) } };
}

export async function overview(db, days) {
  const window = await range(db, days);
  const { today, start, decisionsFrom } = window;
  const series = new Map(dayList(start, days).map((day) => [day, {
    day, newPlayers: 0, signups: 0, activePlayers: 0, runs: 0, playMinutes: 0, doubled: 0, interstitials: 0, nudgesShown: 0,
  }]));
  const add = (rows, map) => {
    for (const r of rows) {
      const e = series.get(r.day);
      if (e) for (const [key, field] of Object.entries(map)) e[key] += n(r[field]);
    }
  };
  const p = [start];
  add(await db.query(
    'SELECT CAST(DATE(created_at) AS CHAR) AS day, COUNT(*) AS c FROM users WHERE created_at >= ? GROUP BY day', p,
  ), { newPlayers: 'c' });
  add(await db.query(
    'SELECT CAST(first_day AS CHAR) AS day, COUNT(*) AS c FROM player_archive WHERE first_day >= ? GROUP BY first_day', p,
  ), { newPlayers: 'c' });
  add(await db.query(
    'SELECT CAST(DATE(registered_at) AS CHAR) AS day, COUNT(*) AS c FROM users WHERE registered_at >= ? GROUP BY day', p,
  ), { signups: 'c' });
  add(await db.query(
    `SELECT CAST(a.day AS CHAR) AS day, COUNT(*) AS c FROM (${LIVE_DAYS}) a GROUP BY a.day`, [start, start, start, start, start],
  ), { activePlayers: 'c' });
  add(await db.query(
    `SELECT CAST(a.day AS CHAR) AS day, COUNT(*) AS c FROM (${ARCHIVE_DAYS}) a GROUP BY a.day`, [start, start, start],
  ), { activePlayers: 'c' });
  add(await db.query(
    `SELECT CAST(DATE(created_at) AS CHAR) AS day, COUNT(*) AS c, SUM(duration_ms) / 1000 AS s
     FROM runs WHERE created_at >= ? GROUP BY day`, p,
  ), { runs: 'c', playMinutes: 's' });
  add(await db.query(
    `SELECT CAST(DATE(created_at) AS CHAR) AS day, SUM(slot_ms) / 1000 AS s
     FROM spins WHERE created_at >= ? GROUP BY day`, p,
  ), { playMinutes: 's' });
  add(await db.query(
    `SELECT CAST(DATE(COALESCE(doubled_at, created_at)) AS CHAR) AS day, COUNT(*) AS c
     FROM runs WHERE doubled = 1 AND COALESCE(doubled_at, created_at) >= ? GROUP BY day`, p,
  ), { doubled: 'c' });
  add(await db.query(
    `SELECT CAST(DATE(created_at) AS CHAR) AS day, SUM(kind = 'interstitial') AS i, SUM(kind = 'nudge') AS g
     FROM decisions WHERE shown = 1 AND created_at >= ? GROUP BY day`, [decisionsFrom],
  ), { interstitials: 'i', nudgesShown: 'g' });
  add(await db.query(
    `SELECT CAST(d.day AS CHAR) AS day, SUM(d.runs) AS r, SUM(d.flight_s + d.slot_s) AS s, SUM(d.doubled) AS x,
       SUM(d.interstitials) AS i, SUM(d.nudges_shown) AS g
     FROM player_archive_days d WHERE d.day >= ? GROUP BY d.day`, p,
  ), { runs: 'r', playMinutes: 's', doubled: 'x', interstitials: 'i', nudgesShown: 'g' });

  const rows = [...series.values()].map((e) => ({
    ...e,
    playMinutes: round1(e.playMinutes / 60),
    ...(e.day < decisionsFrom ? { interstitials: null, nudgesShown: null } : {}),
  }));
  const [live] = await db.query(
    'SELECT COUNT(*) AS players, COALESCE(SUM(username IS NOT NULL), 0) AS registered FROM users WHERE last_seen_at >= ?', p,
  );
  const [gone] = await db.query(
    'SELECT COUNT(*) AS players, COALESCE(SUM(registered), 0) AS registered FROM player_archive WHERE last_day >= ?', p,
  );
  const [sessions] = await db.query(
    `SELECT COUNT(*) AS c, AVG(TIMESTAMPDIFF(SECOND, ps.started_at, ps.last_active_at)) AS avg_s
     FROM play_sessions ps JOIN users u ON u.id = ps.user_id AND u.consent_stats = 1
     WHERE ps.started_at >= ?`, p,
  );
  const funnel = await nudgeFunnel(db, decisionsFrom);
  const todayRow = rows.find((r) => r.day === today) ?? rows[rows.length - 1];
  const players = n(live.players) + n(gone.players);
  const registered = n(live.registered) + n(gone.registered);
  return {
    days,
    from: start,
    to: today,
    decisionsFrom,
    kpis: {
      activeToday: todayRow.activePlayers,
      newToday: todayRow.newPlayers,
      players,
      registered,
      registeredShare: rate(registered, players),
      avgSessionSeconds: sessions.avg_s == null ? null : Math.round(n(sessions.avg_s)),
      sessionsMeasured: n(sessions.c),
      interstitials: rows.reduce((s, r) => s + n(r.interstitials), 0),
      nudgesShown: rows.reduce((s, r) => s + n(r.nudgesShown), 0),
      nudgeSignups: funnel.total.registrations,
      nudgesWithSignup: funnel.total.signups,
      nudgeSignupBase: funnel.total.shown + funnel.total.archivedShown,
      nudgeSignupRate: funnel.total.signupRate,
    },
    series: rows,
    notes: [
      'Tage in UTC. Gelöschte Gäste sind über das anonyme Archiv enthalten.',
      'Die Ø Sessiondauer stammt nur von Spielern mit Statistik-Einwilligung.',
      'Erinnerungen mit Signup: Anteil der gezeigten Erinnerungen, nach denen innerhalb von 24 Stunden registriert wurde (gelöschte Gäste zählen ohne Registrierung mit). Registrierungen zählen jede Registrierung einmal.',
      ...decisionsNote(window),
    ],
  };
}

const playSql = (table, msColumn) => `
  SELECT t.${msColumn} AS ms, t.created_at AS ts, t.user_id AS uid, COALESCE(ps.tz_offset_min, u.tz_offset_min) AS off
  FROM ${table} t
  JOIN users u ON u.id = t.user_id AND u.consent_stats = 1
  LEFT JOIN play_sessions ps ON ps.user_id = t.user_id AND ps.session_no = t.session_no
  WHERE t.created_at >= ? AND t.created_at >= u.consent_stats_at`;

export async function activity(db, days) {
  const { today, start, sessionsFrom } = await range(db, days);
  const cells = await db.query(
    `SELECT WEEKDAY(x.ts + INTERVAL x.off MINUTE) AS wd, HOUR(x.ts + INTERVAL x.off MINUTE) AS h, SUM(x.ms) AS ms,
       COUNT(DISTINCT x.uid) AS players
     FROM (${playSql('runs', 'duration_ms')} UNION ALL ${playSql('spins', 'slot_ms')}) x
     WHERE x.off IS NOT NULL
     GROUP BY wd, h WITH ROLLUP`,
    [start, start],
  );
  const ms = Array(168).fill(0);
  let livePlayers = 0;
  for (const c of cells) {
    if (c.wd == null) livePlayers = n(c.players);
    else if (c.h != null) ms[c.wd * 24 + c.h] += n(c.ms);
  }
  const heat = ms.map((v) => Math.round(v / 1000));
  const archived = await db.query(
    'SELECT heat FROM player_archive WHERE consent_stats = 1 AND heat IS NOT NULL AND last_day >= ?',
    [start],
  );
  let archivedPlayers = 0;
  for (const row of archived) if (addHeat(heat, asJson(row.heat))) archivedPlayers++;
  const stats = heatStats(heat);

  const types = await db.query(
    `SELECT p.daypart, COUNT(*) AS c FROM player_profiles p JOIN users u ON u.id = p.user_id AND u.consent_stats = 1
     WHERE u.last_seen_at >= ? GROUP BY p.daypart`,
    [start],
  );
  const typeCount = new Map(types.map((t) => [t.daypart, n(t.c)]));

  const bins = ADMIN.sessionBinsSeconds;
  const lengths = await db.query(
    `SELECT INTERVAL(TIMESTAMPDIFF(SECOND, ps.started_at, ps.last_active_at), ${bins.map(() => '?').join(', ')}) AS b, COUNT(*) AS c
     FROM play_sessions ps JOIN users u ON u.id = ps.user_id AND u.consent_stats = 1
     WHERE ps.started_at >= ? GROUP BY b`,
    [...bins, sessionsFrom],
  );
  const byBin = new Map(lengths.map((l) => [n(l.b), n(l.c)]));
  const edges = [0, ...bins];

  return {
    days,
    from: start,
    to: today,
    unit: 's',
    players: livePlayers + archivedPlayers,
    heatmap: toGrid(heat),
    hours: stats.hours,
    weekdays: stats.weekdays,
    dayparts: Object.entries(DAYPARTS).map(([name, { from, to }]) => ({
      name, label: SEGMENT_LABELS[name], from, to,
      seconds: stats.dayparts[name].s, share: stats.dayparts[name].share,
      players: typeCount.get(name) ?? 0,
    })),
    sessionLengths: edges.map((from, i) => ({ from, to: edges[i + 1] ?? null, sessions: byBin.get(i) ?? 0 })),
    notes: [
      'Ortszeit der Spieler, Montag zuerst. Nur Spieler mit Statistik-Einwilligung, nur Daten ab der Einwilligung.',
      'Heatmaps gelöschter Gäste stammen aus dem Archiv und umfassen deren ganze Spielzeit.',
      ...(sessionsFrom > start ? [`Sessionlängen erst ab ${sessionsFrom}: Sessions werden nach ${PRIVACY.retention.sessionsDays} Tagen gelöscht.`] : []),
    ],
  };
}

async function cohortRows(db, kind, start) {
  const live = kind === 'live';
  const firsts = live
    ? 'SELECT id AS uid, DATE(created_at) AS first FROM users WHERE created_at >= ?'
    : 'SELECT id AS uid, first_day AS first FROM player_archive WHERE first_day >= ?';
  const days = live ? LIVE_DAYS : ARCHIVE_DAYS;
  const dayParams = Array(live ? 5 : 3).fill(start);
  const key = live ? 'uid' : 'aid';
  const byFirst = await db.query(
    `SELECT CAST(f.first - INTERVAL WEEKDAY(f.first) DAY AS CHAR) AS week, DATEDIFF(UTC_DATE(), f.first) AS age,
       COUNT(DISTINCT f.uid) AS size,
       ${ADMIN.retentionDays.map((_, i) => `COUNT(DISTINCT IF(DATEDIFF(a.day, f.first) = ?, f.uid, NULL)) AS r${i}`).join(',\n       ')}
     FROM (${firsts}) f LEFT JOIN (${days}) a ON a.${key} = f.uid
     GROUP BY f.first`,
    [...ADMIN.retentionDays, start, ...dayParams],
  );
  const byWeek = await db.query(
    `SELECT CAST(f.first - INTERVAL WEEKDAY(f.first) DAY AS CHAR) AS week,
       FLOOR(DATEDIFF(a.day, f.first - INTERVAL WEEKDAY(f.first) DAY) / 7) AS k, COUNT(DISTINCT f.uid) AS c
     FROM (${firsts}) f JOIN (${days}) a ON a.${key} = f.uid AND a.day >= f.first
     GROUP BY week, k`,
    [start, ...dayParams],
  );
  return { byFirst, byWeek };
}

export async function retention(db, weeks) {
  const [w] = await db.query(
    `SELECT CAST(UTC_DATE() AS CHAR) AS today,
       CAST(UTC_DATE() - INTERVAL WEEKDAY(UTC_DATE()) DAY - INTERVAL ? WEEK AS CHAR) AS start`,
    [weeks - 1],
  );
  const mondays = dayList(w.start, weeks * 7).filter((_, i) => i % 7 === 0);
  const dKeys = ADMIN.retentionDays.map((d) => `d${d}`);
  const cohorts = new Map(mondays.map((week, i) => [week, {
    week,
    size: 0,
    ...Object.fromEntries(dKeys.map((k) => [k, { eligible: 0, retained: 0, rate: null }])),
    retained: Array.from({ length: weeks - i }, () => 0),
    retention: [],
  }]));
  for (const kind of ['live', 'archive']) {
    const { byFirst, byWeek } = await cohortRows(db, kind, w.start);
    for (const r of byFirst) {
      const c = cohorts.get(r.week);
      if (!c) continue;
      c.size += n(r.size);
      ADMIN.retentionDays.forEach((d, i) => {
        if (n(r.age) <= d) return;
        c[dKeys[i]].eligible += n(r.size);
        c[dKeys[i]].retained += n(r[`r${i}`]);
      });
    }
    for (const r of byWeek) {
      const c = cohorts.get(r.week);
      const k = n(r.k);
      if (c && k >= 0 && k < c.retained.length) c.retained[k] += n(r.c);
    }
  }
  const totals = Object.fromEntries(dKeys.map((k) => [k, { eligible: 0, retained: 0, rate: null }]));
  const list = [...cohorts.values()].map((c) => {
    for (const k of dKeys) {
      c[k].rate = rate(c[k].retained, c[k].eligible);
      totals[k].eligible += c[k].eligible;
      totals[k].retained += c[k].retained;
    }
    c.retention = c.retained.map((v) => rate(v, c.size));
    return c;
  });
  for (const k of dKeys) totals[k].rate = rate(totals[k].retained, totals[k].eligible);
  return {
    weeks,
    from: w.start,
    to: w.today,
    cohorts: list,
    totals,
    note: `Gäste werden nach ${ACCOUNT.guestRetentionHours} Stunden ohne Spiel gelöscht und zählen bei einer Rückkehr als neue Spieler. Die Retention wird dadurch unterschätzt.`,
  };
}

const pct = (v) => `${Math.round(v * 100)} %`;

export function segmentRules() {
  const S = SEGMENTS;
  const rules = {
    neu: `Höchstens ${S.neu.maxSessions} Sessions seit der Einwilligung oder Einwilligung jünger als ${S.neu.maxAgeHours} Stunden`,
    stamm: `Mindestens ${S.stamm.activeDays30} aktive Tage in ${S.recentDays} Tagen und mindestens ${S.stamm.sessions} Sessions`,
    gelegentlich: 'Weder neu noch Stammspieler',
    rueckkehrer: `Letzte Pause mindestens ${S.rueckkehrer.pauseHours} Stunden und ${S.rueckkehrer.usualFactor}× die übliche Pause, ab ${S.rueckkehrer.sessions} Sessions`,
    abwanderung: `Abwanderungsrisiko mindestens ${S.abwanderung.churn}, ab ${S.abwanderung.sessions} Sessions`,
    wochenende: `Mindestens ${pct(S.wochenende.share)} der Spielzeit am Wochenende, ab ${S.wochenende.activeDays} aktiven Tagen`,
    werbe_muede: `Mindestens ${S.werbeMuede.shown} Interstitials gesehen und Werbetoleranz unter ${S.werbeMuede.below}`,
    werbe_tolerant: `Mindestens ${S.werbeTolerant.shown} Interstitials gesehen und Werbetoleranz mindestens ${S.werbeTolerant.atLeast}`,
    gast_fortschritt: `Gast mit mindestens ${S.guestProgress.runs} Runs, ${S.guestProgress.extraItems} Extra-Item oder ${S.guestProgress.coins} Münzen`,
  };
  for (const [name, { from, to }] of Object.entries(DAYPARTS)) {
    rules[name] = `Mindestens ${pct(S.daypart.share)} der Spielzeit zwischen ${from} und ${to} Uhr (Ortszeit) und mindestens ${S.daypart.minMinutes} Minuten`;
  }
  for (const [device, name] of Object.entries(S.devices)) {
    rules[name] = `Häufigstes Gerät: ${SEGMENT_LABELS[name]} (${device}), nur beschreibend`;
  }
  return rules;
}

function bins(rows, count, width, digits) {
  const out = Array.from({ length: count }, (_, i) => ({
    from: Math.round(i * width * 10 ** digits) / 10 ** digits,
    to: Math.round((i + 1) * width * 10 ** digits) / 10 ** digits,
    players: 0,
  }));
  let missing = 0;
  for (const r of rows) {
    if (r.b == null) missing += n(r.c);
    else out[Math.min(count - 1, Math.max(0, n(r.b)))].players += n(r.c);
  }
  return { bins: out, missing };
}

export async function segments(db) {
  const PROFILES = 'player_profiles p JOIN users u ON u.id = p.user_id AND u.consent_stats = 1';
  const [{ c: total }] = await db.query(`SELECT COUNT(*) AS c FROM ${PROFILES}`);
  const live = await db.query(
    `SELECT jt.segment, COUNT(*) AS c
     FROM ${PROFILES}, JSON_TABLE(p.segments, '$[*]' COLUMNS (segment VARCHAR(30) PATH '$')) jt
     GROUP BY jt.segment`,
  );
  const [{ c: archivedTotal }] = await db.query('SELECT COUNT(*) AS c FROM player_archive WHERE segments IS NOT NULL');
  const archived = await db.query(
    `SELECT jt.segment, COUNT(*) AS c
     FROM player_archive a, JSON_TABLE(a.segments, '$[*]' COLUMNS (segment VARCHAR(30) PATH '$')) jt
     WHERE a.segments IS NOT NULL
     GROUP BY jt.segment`,
  );
  const liveCount = new Map(live.map((r) => [r.segment, n(r.c)]));
  const archivedCount = new Map(archived.map((r) => [r.segment, n(r.c)]));
  const rules = segmentRules();
  const k = ADMIN.scoreBins;
  const histogram = async (expr, width, digits) => bins(await db.query(
    `SELECT ${expr} AS b, COUNT(*) AS c FROM ${PROFILES} GROUP BY b`,
  ), k, width, digits);
  return {
    profiles: n(total),
    archivedProfiles: n(archivedTotal),
    segments: Object.entries(SEGMENT_LABELS).map(([id, label]) => ({
      id,
      label,
      rule: rules[id] ?? null,
      players: liveCount.get(id) ?? 0,
      share: rate(liveCount.get(id) ?? 0, n(total)),
      archived: archivedCount.get(id) ?? 0,
    })),
    histograms: {
      engagement: await histogram(`LEAST(FLOOR(p.engagement / ${100 / k}), ${k - 1})`, 100 / k, 0),
      churnRisk: await histogram(`LEAST(FLOOR(p.churn_risk * ${k}), ${k - 1})`, 1 / k, 2),
      adTolerance: await histogram(`LEAST(FLOOR(p.ad_tolerance * ${k}), ${k - 1})`, 1 / k, 2),
    },
    notes: ['Segmente gibt es nur für Spieler mit Statistik-Einwilligung. Sie werden nie an Werbenetze weitergegeben.'],
  };
}

export async function engagement(db, days) {
  const window = await range(db, days);
  const { today, start, decisionsFrom } = window;
  const series = new Map(dayList(start, days).map((day) => [day, { day, interstitials: 0, doubled: 0, runs: 0 }]));
  const add = (rows, map) => {
    for (const r of rows) {
      const e = series.get(r.day);
      if (e) for (const [key, field] of Object.entries(map)) e[key] += n(r[field]);
    }
  };
  add(await db.query(
    `SELECT CAST(DATE(created_at) AS CHAR) AS day, COUNT(*) AS c FROM decisions
     WHERE kind = 'interstitial' AND shown = 1 AND created_at >= ? GROUP BY day`,
    [decisionsFrom],
  ), { interstitials: 'c' });
  add(await db.query(
    'SELECT CAST(DATE(created_at) AS CHAR) AS day, COUNT(*) AS c FROM runs WHERE created_at >= ? GROUP BY day',
    [start],
  ), { runs: 'c' });
  add(await db.query(
    `SELECT CAST(DATE(COALESCE(doubled_at, created_at)) AS CHAR) AS day, COUNT(*) AS c
     FROM runs WHERE doubled = 1 AND COALESCE(doubled_at, created_at) >= ? GROUP BY day`,
    [start],
  ), { doubled: 'c' });
  add(await db.query(
    `SELECT CAST(d.day AS CHAR) AS day, SUM(d.interstitials) AS i, SUM(d.doubled) AS x, SUM(d.runs) AS r
     FROM player_archive_days d WHERE d.day >= ? GROUP BY d.day`,
    [start],
  ), { interstitials: 'i', doubled: 'x', runs: 'r' });
  const daily = [...series.values()].map((e) => (e.day < decisionsFrom ? { ...e, interstitials: null } : e));

  const reasons = await db.query(
    `SELECT d.reason, COUNT(*) AS decisions, SUM(d.shown) AS shown, SUM(d.personalized) AS personalized,
       SUM(d.outcome <=> 'continued') AS continued, SUM(d.outcome <=> 'dropped') AS dropped
     FROM decisions d JOIN users u ON u.id = d.user_id AND u.consent_stats = 1
     WHERE d.kind = 'interstitial' AND d.created_at >= ? AND d.created_at >= u.consent_stats_at
     GROUP BY d.reason ORDER BY decisions DESC, d.reason`,
    [decisionsFrom],
  );
  const byReason = reasons.map((r) => ({
    reason: r.reason, decisions: n(r.decisions), shown: n(r.shown), personalized: n(r.personalized), dropped: n(r.dropped),
  }));
  const shownConsented = reasons.reduce((s, r) => s + n(r.shown), 0);
  const continued = reasons.reduce((s, r) => s + n(r.continued), 0);
  const runs = daily.reduce((s, d) => s + d.runs, 0);
  const doubled = daily.reduce((s, d) => s + d.doubled, 0);

  return {
    days,
    from: start,
    to: today,
    decisionsFrom,
    interstitials: {
      daily: daily.map(({ day, interstitials }) => ({ day, shown: interstitials })),
      shown: daily.reduce((s, d) => s + n(d.interstitials), 0),
      byReason,
      continueRate: { shown: shownConsented, continued, rate: rate(continued, shownConsented) },
    },
    rewarded: {
      daily: daily.map(({ day, doubled: x, runs: r }) => ({ day, doubled: x, runs: r })),
      doubled,
      runs,
      doubleRate: rate(doubled, runs),
    },
    nudges: await nudgeFunnel(db, decisionsFrom),
    notes: [
      'Gründe, Weiterspielquote und Klickrate nur von Spielern mit Statistik-Einwilligung und nur ab der Einwilligung.',
      'Signup-Quote: gezeigte Erinnerungen mit Registrierung innerhalb von 24 Stunden, gelöschte Gäste zählen ohne Registrierung mit. Registrierungen zählen jede Registrierung einmal.',
      'Verdoppeln wird nur gesamthaft ausgewiesen, nie pro Spieler.',
      `Entscheidungen werden nach ${PRIVACY.retention.decisionsDays} Tagen gelöscht.`,
      ...decisionsNote(window),
    ],
  };
}

const AUDIENCE = ['country', 'region', 'device', 'os', 'browser', 'screen', 'referrer', 'utm_source', 'utm_medium', 'utm_campaign'];
const ARCHIVE_AUDIENCE = ['country', 'region', 'device', 'os', 'browser'];
const AUDIENCE_KEYS = {
  country: 'countries', region: 'regions', device: 'devices', os: 'os', browser: 'browsers', screen: 'screens',
  referrer: 'referrers', utm_source: 'utmSources', utm_medium: 'utmMediums', utm_campaign: 'utmCampaigns',
};

function topValue(counts) {
  let best = null;
  for (const [value, c] of counts) if (best === null || c > counts.get(best)) best = value;
  return best;
}

export function suppressSmall(counts, k = PRIVACY.minGroupSize) {
  const groups = [];
  let other = 0;
  for (const [value, players] of counts) {
    if (players >= k) groups.push({ value, label: value ?? 'Unbekannt', players });
    else other += players;
  }
  groups.sort((a, b) => b.players - a.players || String(a.label).localeCompare(String(b.label)));
  if (other >= k) groups.push({ value: null, label: 'Andere', players: other, other: true });
  return { groups, suppressed: other >= k ? 0 : other };
}

export async function audience(db, days) {
  const { today, start: requested, sessionsFrom: start } = await range(db, days);
  const rows = await db.query(
    `SELECT ps.user_id, ${AUDIENCE.map((c) => `ps.${c}`).join(', ')}
     FROM play_sessions ps JOIN users u ON u.id = ps.user_id AND u.consent_stats = 1
     WHERE ps.started_at >= ? ORDER BY ps.user_id, ps.session_no`,
    [start],
  );
  const perUser = new Map();
  for (const r of rows) {
    if (!perUser.has(r.user_id)) perUser.set(r.user_id, Object.fromEntries(AUDIENCE.map((c) => [c, new Map()])));
    const u = perUser.get(r.user_id);
    for (const c of AUDIENCE) {
      const v = c === 'region' && r.country !== 'CH' ? null : r[c];
      if (v != null && v !== '') u[c].set(v, (u[c].get(v) ?? 0) + 1);
    }
  }
  const counts = Object.fromEntries(AUDIENCE.map((c) => [c, new Map()]));
  const bump = (c, v) => counts[c].set(v, (counts[c].get(v) ?? 0) + 1);
  let swissPlayers = 0;
  for (const u of perUser.values()) {
    for (const c of AUDIENCE) if (c !== 'region') bump(c, topValue(u[c]));
    if (topValue(u.country) === 'CH') {
      swissPlayers++;
      bump('region', topValue(u.region));
    }
  }
  const archived = await db.query(
    `SELECT ${ARCHIVE_AUDIENCE.join(', ')} FROM player_archive
     WHERE consent_stats = 1 AND last_day >= ? AND (country IS NOT NULL OR device IS NOT NULL)`,
    [start],
  );
  for (const a of archived) {
    for (const c of ARCHIVE_AUDIENCE) if (c !== 'region') bump(c, a[c] ?? null);
    if (a.country === 'CH') {
      swissPlayers++;
      bump('region', a.region ?? null);
    }
  }
  const players = perUser.size + archived.length;
  const dimensions = {};
  const suppressed = {};
  for (const c of AUDIENCE) {
    const result = suppressSmall(counts[c]);
    dimensions[AUDIENCE_KEYS[c]] = result.groups;
    suppressed[AUDIENCE_KEYS[c]] = result.suppressed;
  }
  const swissShown = swissPlayers >= PRIVACY.minGroupSize;
  if (!swissShown) suppressed.regions = null;
  return {
    days,
    from: start,
    to: today,
    minGroupSize: PRIVACY.minGroupSize,
    players,
    swissPlayers: swissShown ? swissPlayers : null,
    ...dimensions,
    suppressed,
    notes: [
      `Nur Spieler mit Statistik-Einwilligung. Gruppen mit weniger als ${PRIVACY.minGroupSize} Spielern sind unter «Andere» zusammengefasst oder ausgeblendet.`,
      'Jeder Spieler zählt einmal pro Merkmal (häufigster Wert). Gelöschte Gäste nur mit Land, Kanton, Gerät, OS und Browser.',
      'IP Geolocation by DB-IP',
      ...(start > requested ? [`Erst ab ${start}: Sessions werden nach ${PRIVACY.retention.sessionsDays} Tagen gelöscht, gelöschte Gäste zählen ebenfalls erst ab da.`] : []),
    ],
  };
}
