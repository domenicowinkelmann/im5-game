import { decide } from '../../src/shared/engagement.js';
import { ADS, NUDGE, PRIVACY, SEGMENTS } from '../../src/shared/economy.js';

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const DROP_CHANCE = 0.03;

const formatters = new Map();
export function offsetMinutes(zone, ms) {
  if (!formatters.has(zone)) formatters.set(zone, new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' }));
  const name = formatters.get(zone).formatToParts(new Date(ms)).find((p) => p.type === 'timeZoneName').value;
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
}

export const localHour = (zone, ms) => new Date(ms + offsetMinutes(zone, ms) * 60 * 1000).getUTCHours();

export function engagementSim({
  consent, statsAt, zone, baseSegments = [], avgSessionSeconds = null, patience = 0.9, willRegister = false,
  random = Math.random,
}) {
  const decisions = [];
  const ads = [];
  const nudges = [];
  let continuedAds = 0;
  const chance = (p) => random() < p;
  const within = (list, t, ms) => list.filter((e) => e.at > t - ms).length;

  function segmentsNow() {
    const t = SEGMENTS.adTolerance;
    const tolerance = (continuedAds + t.continued) / (ads.length + t.shown);
    const out = baseSegments.filter(Boolean);
    if (ads.length >= SEGMENTS.werbeMuede.shown && tolerance < SEGMENTS.werbeMuede.below) out.push('werbe_muede');
    if (ads.length >= SEGMENTS.werbeTolerant.shown && tolerance >= SEGMENTS.werbeTolerant.atLeast) out.push('werbe_tolerant');
    return out;
  }

  function engage(placement, t, session, p, facts = {}) {
    const stats = consent.stats === 1 && statsAt !== null && t >= statsAt;
    const personal = stats && consent.personal === 1;
    const lastAd = ads[ads.length - 1];
    const lastNudge = nudges[nudges.length - 1];
    const ctx = {
      consent: { decided: consent.version === PRIVACY.version, stats, personal },
      guest: p.registeredAt === null || t < p.registeredAt,
      hour: localHour(zone, t),
      sessionNo: session.no,
      sessionSeconds: (t - session.start) / 1000,
      runs: p.runs,
      playSeconds: Math.floor(p.playMs / 1000),
      coins: p.coins,
      extraItems: p.extraItems,
      lastRunSeconds: p.lastRunSeconds,
      rewardedSecondsAgo: p.doubledAt === null ? null : (t - p.doubledAt) / 1000,
      interstitials: {
        session: ads.filter((a) => a.session === session.no).length,
        day: within(ads, t, DAY),
        secondsAgo: lastAd ? (t - lastAd.at) / 1000 : null,
        runsSince: lastAd ? p.runs - lastAd.runs : p.runs,
      },
      nudges: {
        session: nudges.filter((x) => x.session === session.no).length,
        day: within(nudges, t, DAY),
        secondsAgo: lastNudge ? (t - lastNudge.at) / 1000 : null,
        dismissed: nudges.filter((x) => x.outcome === 'dismissed' && x.at > t - NUDGE.dismissWindowHours * HOUR).length,
      },
      segments: personal ? segmentsNow() : [],
      avgSessionSeconds: personal ? avgSessionSeconds : null,
      facts: { newHighscore: facts.newHighscore === true, newItem: facts.newItem === true },
    };
    const d = decide(placement, ctx);
    const row = (kind, entry, shown, outcome = null, outcomeAt = null) => decisions.push({
      session: session.no, placement, kind, shown: shown ? 1 : 0, reason: entry.reason,
      personalized: entry.personalized ? 1 : 0, outcome, outcomeAt, at: Math.round(t),
    });
    let next = t;
    let registerAt = null;
    if (d.interstitial) {
      if (chance(DROP_CHANCE)) {
        if (stats) row('interstitial', d.interstitial, false, 'dropped', t + 500);
      } else {
        const end = t + ADS.interstitial.seconds * 1000;
        const continued = chance(patience);
        row('interstitial', d.interstitial, true, continued && stats ? 'continued' : null, continued && stats ? end : null);
        ads.push({ at: t, session: session.no, runs: p.runs });
        if (continued) continuedAds++;
        next = end;
      }
    }
    if (d.nudge) {
      if (chance(DROP_CHANCE)) {
        if (stats) row('nudge', d.nudge, false, 'dropped', t + 500);
      } else {
        const clicked = chance(willRegister ? 0.5 : 0.04);
        const outcome = clicked ? 'clicked' : 'dismissed';
        const at = t + (2 + random() * 6) * 1000;
        const kept = outcome === 'dismissed' || stats;
        row('nudge', d.nudge, true, kept ? outcome : null, kept ? at : null);
        nudges.push({ at: t, session: session.no, outcome });
        next = at;
        if (clicked && willRegister) registerAt = Math.round(at + (20 + random() * 100) * 1000);
      }
    }
    if (stats) for (const entry of d.skipped) row(entry.kind, entry, false);
    return { at: next, registerAt };
  }

  return { engage, decisions };
}
