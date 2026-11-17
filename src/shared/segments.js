import { DAYPARTS, SEGMENTS } from './economy.js';

export const SEGMENT_LABELS = {
  neu: 'Neu',
  stamm: 'Stammspieler',
  gelegentlich: 'Gelegentlich',
  rueckkehrer: 'Rückkehrer',
  abwanderung: 'Abwanderungsgefahr',
  morgens: 'Morgens',
  mittags: 'Mittags',
  nachmittags: 'Nachmittags',
  abends: 'Abends',
  nachts: 'Nachts',
  wochenende: 'Wochenende',
  werbe_muede: 'Werbemüde',
  werbe_tolerant: 'Werbetolerant',
  gast_fortschritt: 'Gast mit Fortschritt',
  mobil: 'Mobil',
  tablet: 'Tablet',
  desktop: 'Desktop',
};

const round = (v, digits = 3) => Math.round(v * 10 ** digits) / 10 ** digits || 0;
const sum = (list) => list.reduce((s, v) => s + v, 0);

function argmax(list, tie = list) {
  let best = 0;
  for (let i = 1; i < list.length; i++) {
    if (list[i] > list[best] || (list[i] === list[best] && tie[i] > tie[best])) best = i;
  }
  return best;
}

export function daypartOf(hour) {
  const h = ((Math.floor(hour) % 24) + 24) % 24;
  for (const [name, { from, to }] of Object.entries(DAYPARTS)) {
    if (from < to ? h >= from && h < to : h >= from || h < to) return name;
  }
  return null;
}

export function heatStats(heat) {
  const hours = Array(24).fill(0);
  const weekdays = Array(7).fill(0);
  heat.forEach((v, i) => {
    hours[i % 24] += v;
    weekdays[Math.floor(i / 24)] += v;
  });
  const total = sum(hours);
  const seconds = Object.fromEntries(Object.keys(DAYPARTS).map((name) => [name, 0]));
  hours.forEach((v, h) => { seconds[daypartOf(h)] += v; });
  const dayparts = Object.fromEntries(Object.entries(seconds).map(([name, s]) => [
    name, { s, share: total ? round(s / total) : 0 },
  ]));
  if (!total) {
    return { total, hours, weekdays, dayparts, favHour: null, favWeekday: null, daypart: null, weekendShare: null, consistency: null };
  }
  const half = Math.floor(SEGMENTS.favHourSpan / 2);
  const smoothed = hours.map((_, h) => {
    let s = 0;
    for (let d = -half; d <= half; d++) s += hours[(h + d + 24) % 24];
    return s;
  });
  const names = Object.keys(seconds);
  const entropy = -sum(hours.filter((v) => v > 0).map((v) => (v / total) * Math.log(v / total)));
  return {
    total,
    hours,
    weekdays,
    dayparts,
    favHour: argmax(smoothed, hours),
    favWeekday: argmax(weekdays),
    daypart: names[argmax(names.map((n) => seconds[n]))],
    weekendShare: round((weekdays[5] + weekdays[6]) / total),
    consistency: round(1 - entropy / Math.log(24)),
  };
}

export const usualGapHours = (medianPauseHours) => Math.max(SEGMENTS.usualGapMinHours, medianPauseHours ?? 0);

export function hasProgress({ runs = 0, extraItems = 0, coins = 0 } = {}) {
  const p = SEGMENTS.guestProgress;
  return runs >= p.runs || extraItems >= p.extraItems || coins >= p.coins;
}

export function scoreProfile(m) {
  const e = SEGMENTS.engagement;
  const hours = Math.max(0, m.hoursSinceLast);
  const playMinutes = m.play.s30d / 60;
  const engagement = Math.round(100 * (
    e.recency * Math.exp(-hours / e.recencyHours)
    + e.active * Math.min(1, m.play.activeDays30 / e.activeDays)
    + e.play * Math.min(1, Math.log(1 + playMinutes) / Math.log(1 + e.playMinutes))
  ));
  const churnRisk = m.sessions.count < SEGMENTS.churn.minSessions
    ? null
    : round(1 - Math.exp(-hours / (SEGMENTS.churn.gapFactor * usualGapHours(m.sessions.usualGapH))));
  const t = SEGMENTS.adTolerance;
  const adTolerance = round((m.ads.continued + t.continued) / (m.ads.shown + t.shown));
  return { engagement, churnRisk, adTolerance };
}

export function deriveSegments(m, scores) {
  const S = SEGMENTS;
  const out = [];
  const sessions = m.sessions.count;
  if (m.account.sessions <= S.neu.maxSessions || m.account.consentHours < S.neu.maxAgeHours) out.push('neu');
  else if (m.play.activeDays30 >= S.stamm.activeDays30 && sessions >= S.stamm.sessions) out.push('stamm');
  else out.push('gelegentlich');
  const pause = m.sessions.lastPauseH;
  if (sessions >= S.rueckkehrer.sessions && pause != null
    && pause >= Math.max(S.rueckkehrer.pauseHours, S.rueckkehrer.usualFactor * usualGapHours(m.sessions.usualGapH))) {
    out.push('rueckkehrer');
  }
  if (scores.churnRisk != null && scores.churnRisk >= S.abwanderung.churn && sessions >= S.abwanderung.sessions) {
    out.push('abwanderung');
  }
  for (const name of Object.keys(DAYPARTS)) {
    const part = m.dayparts[name];
    if (part && part.share >= S.daypart.share && part.s >= S.daypart.minMinutes * 60) out.push(name);
  }
  if (m.weekendShare != null && m.weekendShare >= S.wochenende.share && m.play.activeDays90 >= S.wochenende.activeDays) {
    out.push('wochenende');
  }
  if (m.ads.shown >= S.werbeMuede.shown && scores.adTolerance < S.werbeMuede.below) out.push('werbe_muede');
  if (m.ads.shown >= S.werbeTolerant.shown && scores.adTolerance >= S.werbeTolerant.atLeast) out.push('werbe_tolerant');
  if (m.account.guest && hasProgress(m.account)) out.push('gast_fortschritt');
  const device = S.devices[m.context.device];
  if (device) out.push(device);
  return out;
}
