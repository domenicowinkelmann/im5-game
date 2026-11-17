import { ADS, NUDGE, DAYPARTS, PLACEMENTS } from './economy.js';
import { daypartOf, hasProgress } from './segments.js';

const COMEBACK = ['rueckkehrer', 'abwanderung'];

const validHour = (h) => (Number.isInteger(h) && h >= 0 && h <= 23 ? h : null);

function isNight(hour) {
  const { from, to } = ADS.interstitial.night;
  return hour !== null && hour >= from && hour < to;
}

function offDaypart(hour, segments) {
  const own = segments.filter((s) => Object.hasOwn(DAYPARTS, s));
  return hour !== null && own.length > 0 && !own.includes(daypartOf(hour));
}

function interstitialCheck(ctx, segments, hour) {
  const I = ADS.interstitial;
  const ads = ctx.interstitials;
  if (ctx.sessionNo <= I.graceSessions || ctx.runs < I.graceRuns) return { reason: 'grace', personalized: false };
  if (ctx.lastRunSeconds == null || ctx.lastRunSeconds < I.minRunSeconds) return { reason: 'short_run', personalized: false };
  if (ctx.rewardedSecondsAgo != null && ctx.rewardedSecondsAgo < I.rewardedRestSeconds) return { reason: 'cooldown', personalized: false };
  if (segments.some((s) => COMEBACK.includes(s))) return { reason: 'comeback', personalized: true };
  let cap = I.maxPerSession;
  let capPersonal = false;
  if (isNight(hour)) cap = Math.min(cap, I.nightMaxPerSession);
  if (offDaypart(hour, segments) && I.offDaypartMaxPerSession < cap) {
    cap = I.offDaypartMaxPerSession;
    capPersonal = true;
  }
  if (ads.session >= cap) return { reason: 'session_cap', personalized: capPersonal };
  if (ads.day >= I.maxPerDay) return { reason: 'day_cap', personalized: false };
  if (ads.secondsAgo != null && ads.secondsAgo < I.minGapSeconds) return { reason: 'min_gap', personalized: false };
  let every = ctx.sessionNo <= I.earlySessions ? I.everyRunsEarly : I.everyRuns;
  let everyPersonal = false;
  if (segments.includes('werbe_muede')) {
    every = ADS.personal.tiredEveryRuns;
    everyPersonal = true;
  } else if (segments.includes('werbe_tolerant')) {
    every = ADS.personal.tolerantEveryRuns;
    everyPersonal = true;
  }
  if (ads.runsSince < every) return { reason: 'interval', personalized: everyPersonal };
  return { reason: 'ok', personalized: everyPersonal || capPersonal, shown: true };
}

function progressThreshold(ctx, personal) {
  const avg = personal ? ctx.avgSessionSeconds : null;
  if (!(avg > 0)) return { seconds: NUDGE.progressSeconds, personalized: false };
  const seconds = Math.max(NUDGE.progressMinSeconds, Math.min(NUDGE.progressSeconds, NUDGE.progressSessionShare * avg));
  return { seconds, personalized: seconds < NUDGE.progressSeconds };
}

function nudgeCandidate(placement, ctx, personal) {
  const facts = ctx.facts ?? {};
  if (placement === 'slot_item') return facts.newItem === true ? { reason: 'item', personalized: false } : null;
  if (placement === 'gameover' && facts.newHighscore === true && ctx.runs >= NUDGE.highscoreMinRuns) {
    return { reason: 'highscore', personalized: false };
  }
  if (placement === 'menu' && ctx.sessionNo >= NUDGE.returnMinSession && ctx.sessionSeconds != null
    && ctx.sessionSeconds <= NUDGE.returnWithinSeconds) {
    return { reason: 'return', personalized: false };
  }
  const threshold = progressThreshold(ctx, personal);
  return ctx.playSeconds >= threshold.seconds ? { reason: 'progress', personalized: threshold.personalized } : null;
}

function nudgeBlock(ctx) {
  const n = ctx.nudges;
  if (n.dismissed >= NUDGE.pauseAfterDismissals) return 'paused';
  if (n.session >= NUDGE.maxPerSession) return 'session_cap';
  if (n.day >= NUDGE.maxPerDay) return 'day_cap';
  if (n.secondsAgo != null && n.secondsAgo < NUDGE.minGapMinutes * 60) return 'min_gap';
  return null;
}

export function decide(placement, ctx) {
  if (!PLACEMENTS.includes(placement) || !ctx?.consent?.decided) return { interstitial: null, nudge: null, skipped: [] };
  const personal = ctx.consent.personal === true;
  const segments = personal && Array.isArray(ctx.segments) ? ctx.segments : [];
  const hour = validHour(ctx.hour);
  const skipped = [];
  let interstitial = null;
  let nudge = null;

  if (placement === 'gameover') {
    const check = interstitialCheck(ctx, segments, hour);
    if (check.shown) interstitial = { reason: check.reason, personalized: check.personalized };
    else skipped.push({ kind: 'interstitial', reason: check.reason, personalized: check.personalized });
  }

  if (ctx.guest) {
    const candidate = nudgeCandidate(placement, ctx, personal);
    if (candidate) {
      const progress = hasProgress({ runs: ctx.runs, extraItems: ctx.extraItems, coins: ctx.coins });
      const block = interstitial ? 'interstitial' : !progress ? 'no_progress' : nudgeBlock(ctx);
      if (block) skipped.push({ kind: 'nudge', reason: block, personalized: false });
      else nudge = candidate;
    }
  }

  return { interstitial, nudge, skipped };
}
