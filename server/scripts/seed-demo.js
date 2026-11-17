import { randomBytes } from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { createPool, tx } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { archiveUser, SEED_MARKER } from '../src/analytics/archive.js';
import { refreshProfile } from '../src/analytics/profiles.js';
import { validateRun, maxMultiplierFor, maxTunnelsFor } from '../../src/shared/runs.js';
import { rollSpin, spinResult } from '../../src/shared/slots.js';
import { ITEMS } from '../../src/shared/items.js';
import {
  START_COINS, SPIN_COST, STYLE_PER_SECOND, TUNNEL_BONUS, PLAYTIME, DOUBLE, PRIVACY, SESSION, SEGMENTS,
} from '../../src/shared/economy.js';
import { engagementSim, offsetMinutes } from './seed-engagement.js';

// Seed users carry SEED_MARKER as password hash; archiveUser turns every archive row of such a user into reason 'seed'.
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const LIVE_GUEST_HOURS = 20;

const stamp = (ms) => new Date(ms).toISOString().slice(0, 23).replace('T', ' ');

const args = process.argv.slice(2);
const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};

function option(name, fallback, max) {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = Number(args[i + 1]);
  if (!Number.isInteger(v) || v < 1 || v > max) fail(`--${name} needs a whole number between 1 and ${max}`);
  return v;
}

const players = option('players', 300, 5000);
const days = option('days', 60, 365);
const reset = args.includes('--reset');

const config = loadConfig();
const { host, port, user, database } = config.db;
if (!['127.0.0.1', 'localhost'].includes(host)) fail(`Refusing to seed ${host}: only a local database (DB_HOST 127.0.0.1 or localhost) is allowed`);
console.log(`Target: ${user}@${host}:${port}/${database}`);

const random = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(random(a, b + 1));
const chance = (p) => Math.random() < p;
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const rng = (n) => Math.floor(Math.random() * n);

function weighted(entries) {
  let x = Math.random() * entries.reduce((s, [, w]) => s + w, 0);
  for (const [value, w] of entries) {
    x -= w;
    if (x < 0) return value;
  }
  return entries[entries.length - 1][0];
}

const WEEKDAYS = [0, 1, 2, 3, 4];
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

const PERSONAS = {
  pendler: {
    weight: 25, days: WEEKDAYS, otherDays: 0.2, windows: [[[6, 8.5], 4], [[17, 18.5], 1]], minutes: [6, 20],
    devices: [['mobile', 9], ['tablet', 1]],
  },
  mittag: {
    weight: 20, days: WEEKDAYS, otherDays: 0.15, windows: [[[11.5, 13.5], 1]], minutes: [8, 25],
    devices: [['desktop', 6], ['mobile', 4]],
  },
  abend: {
    weight: 25, days: ALL_DAYS, otherDays: 1, windows: [[[18, 22], 1]], minutes: [10, 45],
    devices: [['desktop', 4], ['tablet', 3], ['mobile', 3]],
  },
  nachteule: {
    weight: 15, days: ALL_DAYS, otherDays: 1, windows: [[[22, 26], 1]], minutes: [15, 60],
    devices: [['desktop', 5], ['mobile', 5]],
  },
  wochenende: {
    weight: 15, days: [5, 6], otherDays: 0.1, windows: [[[9, 20], 1]], minutes: [15, 50],
    devices: [['tablet', 4], ['mobile', 4], ['desktop', 2]],
  },
};

const AGENTS = {
  mobile: [[['iOS', 'Safari'], 5], [['Android', 'Chrome'], 4], [['Android', 'Samsung Internet'], 1]],
  tablet: [[['iPadOS', 'Safari'], 6], [['Android', 'Chrome'], 4]],
  desktop: [[['Windows', 'Chrome'], 4], [['Windows', 'Edge'], 2], [['macOS', 'Safari'], 2], [['macOS', 'Chrome'], 1], [['Windows', 'Firefox'], 1]],
};
const SCREENS = { mobile: 'xs', tablet: 'm', desktop: 'l' };
const PERSONA_SEGMENTS = { pendler: ['morgens'], mittag: ['mittags'], abend: ['abends'], nachteule: ['nachts'], wochenende: ['wochenende'] };

const PLACES = [
  [{ country: 'CH', zone: 'Europe/Zurich', locales: ['de-CH'], regions: [['ZH', 8], ['BE', 5], ['GR', 6], ['LU', 3], ['SG', 3], ['AG', 3], ['BS', 2], ['ZG', 1]] }, 70],
  [{ country: 'CH', zone: 'Europe/Zurich', locales: ['fr-CH'], regions: [['GE', 3], ['VD', 4], ['FR', 1], ['NE', 1]] }, 10],
  [{ country: 'CH', zone: 'Europe/Zurich', locales: ['it-CH'], regions: [['TI', 1]] }, 4],
  [{ country: 'DE', zone: 'Europe/Berlin', locales: ['de-DE'] }, 7],
  [{ country: 'AT', zone: 'Europe/Vienna', locales: ['de-AT'] }, 4],
  [{ country: 'IT', zone: 'Europe/Rome', locales: ['it-IT'] }, 2],
  [{ country: 'US', zone: 'America/New_York', locales: ['en-US'] }, 2],
  [{ country: null, zone: 'Europe/Zurich', locales: ['de-CH', 'en-GB'] }, 1],
];

const REFERRERS = [[null, 40], ['www.google.com', 25], ['www.instagram.com', 12], ['www.tiktok.com', 8], ['moodle.fhgr.ch', 8], ['www.reddit.com', 4], ['duckduckgo.com', 3]];
const CAMPAIGNS = [[null, 80], [{ source: 'instagram', medium: 'social', campaign: 'herbst' }, 10], [{ source: 'flyer', medium: 'print', campaign: 'campus' }, 6], [{ source: 'newsletter', medium: 'email', campaign: 'launch' }, 4]];
const CAUSES = [['Baum erwischt', 30], ['Bodenkontakt', 25], ['Felsbogen gestreift', 15], ['Vogelschwarm', 10], ['Helikopter', 6], ['Rotorblatt', 4], ['Flugzeug', 4], ['Flugzeugflügel', 3], ['Helikopter-Heck', 2], ['Leitwerk', 1]];
const CONSENTS = [
  [{ version: PRIVACY.version, stats: 1, personal: 1, adult: 1 }, 45],
  [{ version: PRIVACY.version, stats: 1, personal: 0, adult: 1 }, 12],
  [{ version: PRIVACY.version, stats: 1, personal: 0, adult: 0 }, 8],
  [{ version: PRIVACY.version, stats: 0, personal: 0, adult: 1 }, 10],
  [{ version: PRIVACY.version, stats: 0, personal: 0, adult: 0 }, 5],
  [{ version: 0, stats: 0, personal: 0, adult: 0 }, 20],
];
const DEFAULT_ITEMS = ITEMS.filter((i) => i.default).map((i) => i.id);

function makeRun(skill) {
  const seconds = chance(0.1)
    ? Math.round(random(2, 8) * 10) / 10
    : Math.round(Math.min(600, 10 + -Math.log(1 - Math.random()) * 45 * skill) * 10) / 10;
  const mult = randInt(1, maxMultiplierFor(seconds));
  const distRaw = seconds * random(30, 45);
  const distance = Math.floor(distRaw);
  const tunnels = randInt(0, Math.floor(maxTunnelsFor(distance) * 0.3));
  const counts = {
    bronze: randInt(0, Math.floor(seconds * 0.5)),
    silver: randInt(0, Math.floor(seconds * 0.15)),
    gold: randInt(0, Math.floor(seconds * 0.05)),
    diamond: seconds > 30 && chance(0.15) ? 1 : 0,
  };
  const base = counts.bronze + counts.silver * 5 + counts.gold * 10 + counts.diamond * 50;
  const style = seconds * random(0.2, 0.9) * STYLE_PER_SECOND * mult;
  return validateRun({
    distance,
    score: Math.floor(distRaw + style + tunnels * TUNNEL_BONUS),
    coins: base * mult,
    duration: seconds,
    maxMultiplier: mult,
    tunnels,
    cause: weighted(CAUSES),
    coinsByType: counts,
  });
}

function planDays(guest) {
  if (guest) {
    if (chance(0.45)) return { start: randInt(0, 2), end: 0, live: true };
    const start = randInt(2, days);
    return { start, end: Math.max(1, start - randInt(0, 5)), live: false };
  }
  const start = Math.max(1, Math.floor(Math.random() ** 0.7 * days));
  const end = chance(0.25) ? randInt(0, start) : 0;
  const pause = chance(0.12) && start - end > 20 ? { from: end + randInt(3, 6), length: randInt(7, 14) } : null;
  return { start, end, pause, live: false };
}

function simulatePlayer(i, now) {
  const personaName = weighted(Object.entries(PERSONAS).map(([n, p]) => [n, p.weight]));
  const persona = PERSONAS[personaName];
  const guest = !chance(0.4);
  const place = weighted(PLACES);
  const device = weighted(persona.devices);
  const [os, browser] = weighted(AGENTS[device]);
  const region = place.regions ? weighted(place.regions) : null;
  const plan = planDays(guest);
  const level = random(0.25, 0.9);
  const skill = random(0.6, 1.6);
  const consent = weighted(CONSENTS);

  const sessions = [];
  const nowLocal = now + offsetMinutes(place.zone, now) * 60 * 1000;
  const today = Math.floor(nowLocal / DAY) * DAY;
  for (let ago = plan.start; ago >= plan.end; ago--) {
    if (plan.pause && ago <= plan.start - plan.pause.from && ago > plan.start - plan.pause.from - plan.pause.length) continue;
    const midnight = today - ago * DAY;
    const weekday = (new Date(midnight).getUTCDay() + 6) % 7;
    const p = level * (persona.days.includes(weekday) ? 1 : persona.otherDays);
    if (!chance(p)) continue;
    const count = chance(0.2) ? 2 : 1;
    for (let k = 0; k < count; k++) {
      const [from, to] = weighted(persona.windows);
      const local = midnight + random(from, to) * HOUR;
      const start = Math.round(local - offsetMinutes(place.zone, local - HOUR) * 60 * 1000);
      sessions.push({ start, minutes: random(...persona.minutes) });
    }
  }
  if (plan.live) sessions.push({ start: Math.round(now - random(1, 16) * HOUR), minutes: random(...persona.minutes) });
  sessions.sort((a, b) => a.start - b.start);

  const kept = [];
  for (const s of sessions) {
    const prev = kept[kept.length - 1];
    if (s.start > now - 5 * 60 * 1000) continue;
    if (prev && s.start < prev.end + (SESSION.timeoutMinutes + 5) * 60 * 1000) continue;
    s.end = Math.min(s.start + s.minutes * 60 * 1000, now - 60 * 1000);
    kept.push(s);
  }
  if (!kept.length) return null;

  const first = kept[0];
  const last = kept[kept.length - 1];
  const created = first.start - randInt(5, 30) * 1000;
  const consentAt = consent.version ? created + randInt(2, 10) * 1000 : null;
  let statsAt = consent.stats ? consentAt : null;
  if (statsAt && kept.length > 3 && chance(0.3)) statsAt = kept[Math.floor(kept.length / 2)].start;
  const planned = guest ? null : kept[Math.min(kept.length - 1, randInt(1, 5))].start + randInt(30, 300) * 1000;

  const owned = [...DEFAULT_ITEMS];
  const runs = [];
  const spins = [];
  const inventory = [];
  const doubledByDay = new Map();
  const p = {
    runs: 0, playMs: 0, coins: START_COINS, extraItems: 0, lastRunSeconds: null, doubledAt: null, registeredAt: planned,
  };
  const sim = engagementSim({
    consent, statsAt, zone: place.zone,
    baseSegments: [...PERSONA_SEGMENTS[personaName], SEGMENTS.devices[device]],
    avgSessionSeconds: Math.round(((persona.minutes[0] + persona.minutes[1]) / 2) * 60),
    patience: random(0.5, 1),
    willRegister: !guest,
  });
  const engage = (placement, t, s, facts = {}) => {
    const out = sim.engage(placement, t, s, p, facts);
    if (out.registerAt !== null && (p.registeredAt === null || out.registerAt < p.registeredAt)) p.registeredAt = out.registerAt;
    return out.at;
  };
  let highscore = 0;
  kept.forEach((s, index) => {
    s.no = index + 1;
    let t = engage('menu', s.start + random(3, 20) * 1000, s);
    t += random(5, 40) * 1000;
    let lastSpin = null;
    for (;;) {
      const run = makeRun(skill);
      if (!run) continue;
      const end = t + run.duration * 1000 + 1000;
      if (end > s.end) break;
      t = end;
      p.coins += run.coins;
      const r = { ...run, session: s.no, at: Math.round(t), doubledAt: null };
      const dayKey = Math.floor(t / DAY);
      if (run.coins > 0 && chance(0.2) && (doubledByDay.get(dayKey) ?? 0) < DOUBLE.maxPerDay) {
        r.doubledAt = Math.round(t + random(DOUBLE.minDelaySeconds + 2, 30) * 1000);
        doubledByDay.set(dayKey, (doubledByDay.get(dayKey) ?? 0) + 1);
        p.coins += run.coins;
        p.doubledAt = r.doubledAt;
        t = r.doubledAt;
      }
      runs.push(r);
      p.runs++;
      p.playMs += Math.round(run.duration * 1000);
      p.lastRunSeconds = run.duration;
      const newHighscore = run.score > highscore;
      highscore = Math.max(highscore, run.score);
      t = engage('gameover', t + random(1, 4) * 1000, s, { newHighscore });
      t += random(3, 15) * 1000;
      if (p.coins >= SPIN_COST && chance(0.15)) {
        for (let k = randInt(1, 3); k > 0 && p.coins >= SPIN_COST; k--) {
          t += random(3, 8) * 1000;
          if (t > s.end) break;
          const gap = lastSpin === null ? null : t - lastSpin;
          const slotMs = gap !== null && gap <= PLAYTIME.slotGapSeconds * 1000 ? Math.round(gap) : PLAYTIME.spinSeconds * 1000;
          const spin = rollSpin(rng);
          const { result, delta, newItem } = spinResult(spin, owned);
          p.coins += delta - SPIN_COST;
          p.playMs += slotMs;
          spins.push({
            session: s.no, outcome: spin.outcome, reels: spin.reels, item: spin.item?.id ?? null,
            duplicate: result.duplicate ? 1 : 0, delta: delta - SPIN_COST, slotMs, at: Math.round(t),
          });
          lastSpin = t;
          if (newItem) {
            owned.push(newItem);
            inventory.push({ item: newItem, at: Math.round(t) });
            p.extraItems++;
            t = engage('slot_item', t + random(2, 4) * 1000, s, { newItem: true });
          }
        }
      }
    }
    s.last = Math.min(Math.max(t, s.start) + random(5, 60) * 1000, now - 30 * 1000);
  });

  const registeredAt = p.registeredAt === null ? null : Math.min(p.registeredAt, last.last);
  const best = (key) => runs.reduce((m, r) => Math.max(m, r[key]), 0);
  return {
    persona: personaName,
    guest,
    live: guest && now - last.last < LIVE_GUEST_HOURS * HOUR,
    user: {
      username: guest ? null : `demo_${personaName}_${i}`,
      coins: Math.max(0, p.coins),
      highscore: best('score'),
      best_distance: best('distance'),
      total_runs: runs.length,
      play_flight_ms: runs.reduce((sum, r) => sum + Math.round(r.duration * 1000), 0),
      play_slot_ms: spins.reduce((sum, s) => sum + s.slotMs, 0),
      last_run_at: runs.length ? stamp(runs[runs.length - 1].at) : null,
      last_seen_at: stamp(last.last),
      created_at: stamp(created),
      registered_at: registeredAt ? stamp(registeredAt) : null,
      session_no: kept.length,
      session_started_at: stamp(last.start),
      consent_version: consent.version,
      consent_stats: consent.stats,
      consent_personal: consent.personal,
      age_16plus: consent.adult,
      consent_at: consentAt ? stamp(consentAt) : null,
      consent_stats_at: statsAt ? stamp(statsAt) : null,
      tz_offset_min: consent.stats ? offsetMinutes(place.zone, last.start) : null,
    },
    sessions: consent.stats
      ? kept.filter((s) => s.last >= statsAt && s.start >= now - PRIVACY.retention.sessionsDays * DAY).map((s) => {
        const utm = s.no === 1 ? weighted(CAMPAIGNS) : null;
        return [
          s.no, stamp(s.start), stamp(s.last), offsetMinutes(place.zone, s.start), place.zone, pick(place.locales),
          device, os, browser, SCREENS[device], device === 'desktop' ? 0 : 1, s.no === 1 ? weighted(REFERRERS) : null,
          utm?.source ?? null, utm?.medium ?? null, utm?.campaign ?? null, place.country, place.country === 'CH' ? region : null,
        ];
      })
      : [],
    runs,
    spins,
    inventory,
    decisions: sim.decisions,
  };
}

async function insertPlayer(conn, p) {
  const columns = Object.keys(p.user);
  const { insertId: id } = await conn.query(
    `INSERT INTO users (${columns.join(', ')}, password_hash) VALUES (${columns.map(() => '?').join(', ')}, ?)`,
    [...Object.values(p.user), SEED_MARKER],
  );
  if (p.runs.length) {
    await conn.batch(
      `INSERT INTO runs (public_id, user_id, session_no, distance, score, coins, duration_ms, max_multiplier, tunnels, cause,
         coins_by_type, doubled, doubled_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      p.runs.map((r) => [
        randomBytes(16).toString('base64url'), id, r.session, r.distance, r.score, r.coins, Math.round(r.duration * 1000),
        r.maxMultiplier, r.tunnels, r.cause, JSON.stringify(r.coinsByType), r.doubledAt ? 1 : 0,
        r.doubledAt ? stamp(r.doubledAt) : null, stamp(r.at),
      ]),
    );
  }
  if (p.spins.length) {
    await conn.batch(
      `INSERT INTO spins (user_id, session_no, outcome, reels, item_id, duplicate, coins_delta, slot_ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      p.spins.map((s) => [id, s.session, s.outcome, JSON.stringify(s.reels), s.item, s.duplicate, s.delta, s.slotMs, stamp(s.at)]),
    );
  }
  if (p.inventory.length) {
    await conn.batch(
      'INSERT INTO inventory (user_id, item_id, acquired_at) VALUES (?, ?, ?)',
      p.inventory.map((it) => [id, it.item, stamp(it.at)]),
    );
  }
  if (p.decisions.length) {
    await conn.batch(
      `INSERT INTO decisions (user_id, session_no, placement, kind, shown, reason, personalized, outcome, outcome_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      p.decisions.map((d) => [
        id, d.session, d.placement, d.kind, d.shown, d.reason, d.personalized, d.outcome,
        d.outcomeAt === null ? null : stamp(d.outcomeAt), stamp(d.at),
      ]),
    );
  }
  if (p.sessions.length) {
    await conn.batch(
      `INSERT INTO play_sessions (user_id, session_no, started_at, last_active_at, tz_offset_min, time_zone, locale, device, os,
         browser, screen, touch, referrer, utm_source, utm_medium, utm_campaign, country, region)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      p.sessions.map((row) => [id, ...row]),
    );
  }
  return id;
}

async function archiveGuest(conn, id) {
  const archiveId = await archiveUser(conn, id, 'seed');
  await conn.query(
    'UPDATE player_archive SET archived_on = LEAST(UTC_DATE(), last_day + INTERVAL 1 DAY) WHERE id = ?',
    [archiveId],
  );
  await conn.query('DELETE FROM users WHERE id = ?', [id]);
}

async function existing(pool) {
  const [{ users }] = await pool.query('SELECT COUNT(*) AS users FROM users WHERE password_hash = ?', [SEED_MARKER]);
  const [{ archived }] = await pool.query("SELECT COUNT(*) AS archived FROM player_archive WHERE reason = 'seed'");
  return { users, archived };
}

await migrate(config.db);
const pool = createPool(config.db);
try {
  if (reset) {
    const { affectedRows: users } = await pool.query('DELETE FROM users WHERE password_hash = ?', [SEED_MARKER]);
    const { affectedRows: archived } = await pool.query("DELETE FROM player_archive WHERE reason = 'seed'");
    console.log(`Removed ${users} demo players (with their runs, spins, sessions and profiles) and ${archived} demo archive rows`);
  } else {
    const before = await existing(pool);
    if (before.users || before.archived) fail('Demo data already exists, run with --reset first');
    const [{ now }] = await pool.query('SELECT UNIX_TIMESTAMP(NOW(3)) * 1000 AS now');
    const stats = { registered: 0, live: 0, archived: 0, runs: 0, spins: 0, sessions: 0, decisions: 0, shown: 0, profiles: 0 };
    const profileIds = [];
    for (let i = 1; i <= players; i++) {
      const p = simulatePlayer(i, Number(now));
      if (!p) continue;
      await tx(pool, async (conn) => {
        const id = await insertPlayer(conn, p);
        if (p.guest && !p.live) {
          await archiveGuest(conn, id);
          stats.archived++;
          return;
        }
        await conn.query(
          'DELETE FROM decisions WHERE user_id = ? AND created_at < NOW(3) - INTERVAL ? DAY',
          [id, PRIVACY.retention.decisionsDays],
        );
        if (p.guest) stats.live++;
        else stats.registered++;
        if (p.user.consent_stats) profileIds.push(id);
      });
      stats.runs += p.runs.length;
      stats.spins += p.spins.length;
      stats.sessions += p.user.session_no;
      stats.decisions += p.decisions.length;
      stats.shown += p.decisions.filter((d) => d.shown === 1).length;
    }
    for (const id of profileIds) if (await refreshProfile(pool, id)) stats.profiles++;
    console.log(`Seeded ${stats.registered} registered players, ${stats.live} guests and ${stats.archived} archived guests over ${days} days`);
    console.log(`${stats.sessions} sessions, ${stats.runs} runs, ${stats.spins} spins, ${stats.profiles} profiles`);
    console.log(`${stats.decisions} ad and reminder decisions simulated (${stats.shown} shown), older than ${PRIVACY.retention.decisionsDays} days removed for live players`);
    console.log(`Demo rows are marked with password hash ${SEED_MARKER} and archive reason seed, also after the cleanup archives them`);
    console.log('Remove everything again with: npm run db:seed-demo -- --reset');
  }
} finally {
  await pool.end();
}
