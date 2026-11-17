import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide } from '../../src/shared/engagement.js';
import { ADS, NUDGE } from '../../src/shared/economy.js';

const I = ADS.interstitial;

function ctx(patch = {}) {
  const base = {
    consent: { decided: true, stats: false, personal: false },
    guest: true,
    hour: 15,
    sessionNo: 3,
    sessionSeconds: 900,
    runs: 10,
    playSeconds: 200,
    coins: 150,
    extraItems: 0,
    lastRunSeconds: 30,
    rewardedSecondsAgo: null,
    interstitials: { session: 0, day: 0, secondsAgo: null, runsSince: 10 },
    nudges: { session: 0, day: 0, secondsAgo: null, dismissed: 0 },
    segments: [],
    avgSessionSeconds: null,
    facts: { newHighscore: false, newItem: false },
  };
  const out = { ...base, ...patch };
  for (const key of ['consent', 'interstitials', 'nudges', 'facts']) out[key] = { ...base[key], ...patch[key] };
  return out;
}

const personal = (patch = {}) => ctx({ ...patch, consent: { stats: true, personal: true } });
const adReason = (c) => {
  const d = decide('gameover', c);
  return d.interstitial ? 'shown' : d.skipped.find((s) => s.kind === 'interstitial')?.reason;
};
const nudgeOf = (placement, c) => decide(placement, c).nudge;
const nudgeSkip = (placement, c) => decide(placement, c).skipped.find((s) => s.kind === 'nudge')?.reason ?? null;

test('without a consent decision nothing is shown or logged', () => {
  for (const placement of ['gameover', 'menu', 'slot_item']) {
    const d = decide(placement, ctx({ consent: { decided: false }, facts: { newItem: true, newHighscore: true }, runs: 50 }));
    assert.deepEqual(d, { interstitial: null, nudge: null, skipped: [] });
  }
  assert.deepEqual(decide('shop', ctx()), { interstitial: null, nudge: null, skipped: [] });
});

test('a fresh interstitial is shown after the grace period with the reason ok', () => {
  assert.deepEqual(decide('gameover', ctx()), {
    interstitial: { reason: 'ok', personalized: false }, nudge: null, skipped: [],
  });
});

test('interstitials only appear on the game over screen', () => {
  for (const placement of ['menu', 'slot_item']) {
    const d = decide(placement, ctx());
    assert.equal(d.interstitial, null);
    assert.ok(!d.skipped.some((s) => s.kind === 'interstitial'));
  }
});

test('the grace period covers the first sessions and the first runs', () => {
  assert.equal(adReason(ctx({ sessionNo: I.graceSessions })), 'grace');
  assert.equal(adReason(ctx({ sessionNo: I.graceSessions + 1 })), 'shown');
  assert.equal(adReason(ctx({ runs: I.graceRuns - 1 })), 'grace');
  assert.equal(adReason(ctx({ runs: I.graceRuns, interstitials: { runsSince: 10 } })), 'shown');
});

test('the checks run in the documented order', () => {
  const all = {
    sessionNo: 1, lastRunSeconds: 2, rewardedSecondsAgo: 10,
    interstitials: { session: 9, day: 99, secondsAgo: 5, runsSince: 0 },
  };
  const steps = [
    ['grace', { sessionNo: 3 }],
    ['short_run', { lastRunSeconds: 30 }],
    ['cooldown', { rewardedSecondsAgo: null }],
    ['comeback', { segments: [] }],
    ['session_cap', { interstitials: { session: 0 } }],
    ['day_cap', { interstitials: { day: 0 } }],
    ['min_gap', { interstitials: { secondsAgo: null } }],
    ['interval', { interstitials: { runsSince: 10 } }],
    ['shown', {}],
  ];
  let state = { ...all, segments: ['rueckkehrer'] };
  for (const [expected, fix] of steps) {
    const c = personal({ ...state });
    assert.equal(adReason(c), expected);
    state = { ...state, ...fix, interstitials: { ...state.interstitials, ...fix.interstitials } };
  }
});

test('short runs, the rewarded cooldown and the minimum gap block an interstitial', () => {
  assert.equal(adReason(ctx({ lastRunSeconds: I.minRunSeconds - 0.1 })), 'short_run');
  assert.equal(adReason(ctx({ lastRunSeconds: null })), 'short_run');
  assert.equal(adReason(ctx({ lastRunSeconds: I.minRunSeconds })), 'shown');
  assert.equal(adReason(ctx({ rewardedSecondsAgo: I.rewardedRestSeconds - 1 })), 'cooldown');
  assert.equal(adReason(ctx({ rewardedSecondsAgo: I.rewardedRestSeconds })), 'shown');
  assert.equal(adReason(ctx({ interstitials: { secondsAgo: I.minGapSeconds - 1 } })), 'min_gap');
  assert.equal(adReason(ctx({ interstitials: { secondsAgo: I.minGapSeconds } })), 'shown');
});

test('session and day caps', () => {
  assert.equal(adReason(ctx({ interstitials: { session: I.maxPerSession - 1 } })), 'shown');
  assert.equal(adReason(ctx({ interstitials: { session: I.maxPerSession } })), 'session_cap');
  assert.equal(adReason(ctx({ interstitials: { day: I.maxPerDay - 1 } })), 'shown');
  assert.equal(adReason(ctx({ interstitials: { day: I.maxPerDay } })), 'day_cap');
});

test('at night only one interstitial per session', () => {
  for (const hour of [0, 3, 4]) {
    assert.equal(adReason(ctx({ hour, interstitials: { session: 0 } })), 'shown');
    assert.equal(adReason(ctx({ hour, interstitials: { session: 1 } })), 'session_cap');
  }
  assert.equal(adReason(ctx({ hour: 5, interstitials: { session: 1 } })), 'shown');
  assert.equal(adReason(ctx({ hour: 23, interstitials: { session: 1 } })), 'shown');
  assert.equal(adReason(ctx({ hour: null, interstitials: { session: 1 } })), 'shown');
  assert.equal(decide('gameover', ctx({ hour: 2, interstitials: { session: 1 } })).skipped[0].personalized, false);
});

test('the interval depends on the session count', () => {
  const early = I.earlySessions;
  assert.equal(adReason(ctx({ sessionNo: early, interstitials: { runsSince: I.everyRunsEarly - 1 } })), 'interval');
  assert.equal(adReason(ctx({ sessionNo: early, interstitials: { runsSince: I.everyRunsEarly } })), 'shown');
  assert.equal(adReason(ctx({ sessionNo: early + 1, interstitials: { runsSince: I.everyRuns - 1 } })), 'interval');
  assert.equal(adReason(ctx({ sessionNo: early + 1, interstitials: { runsSince: I.everyRuns } })), 'shown');
});

test('segments and the own daypart only count with personal consent and stay inside the caps', () => {
  const late = { sessionNo: I.earlySessions + 1 };
  const tolerant = { ...late, segments: ['werbe_tolerant'], interstitials: { runsSince: ADS.personal.tolerantEveryRuns } };
  assert.deepEqual(decide('gameover', personal(tolerant)).interstitial, { reason: 'ok', personalized: true });
  assert.equal(adReason(ctx(tolerant)), 'interval');
  assert.equal(adReason(personal({ ...tolerant, interstitials: { runsSince: 9, session: I.maxPerSession } })), 'session_cap');
  assert.equal(adReason(personal({ ...tolerant, interstitials: { runsSince: 9, secondsAgo: 10 } })), 'min_gap');

  const tired = { ...late, segments: ['werbe_muede'], interstitials: { runsSince: ADS.personal.tiredEveryRuns - 1 } };
  assert.deepEqual(decide('gameover', personal(tired)).skipped[0], { kind: 'interstitial', reason: 'interval', personalized: true });
  assert.equal(adReason(ctx(tired)), 'shown');

  for (const seg of ['rueckkehrer', 'abwanderung']) {
    assert.deepEqual(decide('gameover', personal({ segments: [seg] })).skipped[0], { kind: 'interstitial', reason: 'comeback', personalized: true });
    assert.equal(adReason(ctx({ segments: [seg] })), 'shown');
  }

  const evening = { segments: ['abends'], interstitials: { session: 1 } };
  assert.deepEqual(decide('gameover', personal({ ...evening, hour: 9 })).skipped[0], { kind: 'interstitial', reason: 'session_cap', personalized: true });
  assert.equal(adReason(personal({ ...evening, hour: 19 })), 'shown');
  assert.equal(adReason(ctx({ ...evening, hour: 9 })), 'shown');
  assert.equal(adReason(personal({ segments: ['mobil', 'stamm'], hour: 9, interstitials: { session: 1 } })), 'shown');
});

test('a nudge never comes together with an interstitial', () => {
  const c = ctx({ runs: 10, facts: { newHighscore: true }, playSeconds: 5000 });
  const d = decide('gameover', c);
  assert.ok(d.interstitial);
  assert.equal(d.nudge, null);
  assert.deepEqual(d.skipped, [{ kind: 'nudge', reason: 'interstitial', personalized: false }]);
  for (let i = 0; i < 50; i++) {
    const r = decide('gameover', ctx({ sessionNo: 1 + (i % 6), runs: i, playSeconds: i * 100, interstitials: { runsSince: i % 8 }, facts: { newHighscore: i % 2 === 0 } }));
    assert.ok(!(r.interstitial && r.nudge));
  }
});

test('nudges only for guests with progress', () => {
  const item = { sessionNo: 1, facts: { newItem: true } };
  assert.deepEqual(nudgeOf('slot_item', ctx({ ...item, runs: 3 })), { reason: 'item', personalized: false });
  assert.deepEqual(nudgeOf('slot_item', ctx({ ...item, runs: 0, extraItems: 1 })), { reason: 'item', personalized: false });
  assert.deepEqual(nudgeOf('slot_item', ctx({ ...item, runs: 0, coins: 500 })), { reason: 'item', personalized: false });
  assert.equal(nudgeOf('slot_item', ctx({ ...item, runs: 2, coins: 499 })), null);
  assert.equal(nudgeSkip('slot_item', ctx({ ...item, runs: 2, coins: 499 })), 'no_progress');
  const registered = decide('slot_item', ctx({ ...item, guest: false }));
  assert.deepEqual(registered, { interstitial: null, nudge: null, skipped: [] });
  assert.equal(nudgeOf('slot_item', ctx({ sessionNo: 1, facts: { newItem: false } })), null);
});

test('nudge reasons per placement', () => {
  const g = { sessionNo: 1 };
  assert.equal(nudgeOf('gameover', ctx({ ...g, runs: NUDGE.highscoreMinRuns - 1, coins: 600, facts: { newHighscore: true } })), null);
  assert.deepEqual(nudgeOf('gameover', ctx({ ...g, runs: NUDGE.highscoreMinRuns, coins: 600, facts: { newHighscore: true } })), { reason: 'highscore', personalized: false });
  assert.equal(nudgeOf('menu', ctx({ ...g, runs: 5, facts: { newHighscore: true } })), null);
  assert.deepEqual(nudgeOf('menu', ctx({ runs: 5, sessionNo: NUDGE.returnMinSession, sessionSeconds: NUDGE.returnWithinSeconds })), { reason: 'return', personalized: false });
  assert.equal(nudgeOf('menu', ctx({ runs: 5, sessionNo: NUDGE.returnMinSession, sessionSeconds: NUDGE.returnWithinSeconds + 1 })), null);
  assert.equal(nudgeOf('menu', ctx({ runs: 5, sessionNo: 1, sessionSeconds: 10 })), null);
  assert.equal(nudgeOf('gameover', ctx({ ...g, runs: 5, playSeconds: NUDGE.progressSeconds - 1 })), null);
  assert.deepEqual(nudgeOf('gameover', ctx({ ...g, runs: 5, playSeconds: NUDGE.progressSeconds })), { reason: 'progress', personalized: false });
  assert.deepEqual(nudgeOf('menu', ctx({ runs: 5, sessionNo: 1, playSeconds: NUDGE.progressSeconds })), { reason: 'progress', personalized: false });
  assert.equal(nudgeOf('slot_item', ctx({ ...g, runs: 5, playSeconds: 5000 })), null);
});

test('the progress threshold is personalised only with personal consent', () => {
  const c = { sessionNo: 1, runs: 5, playSeconds: 300, avgSessionSeconds: 400 };
  assert.deepEqual(nudgeOf('gameover', personal(c)), { reason: 'progress', personalized: true });
  assert.equal(nudgeOf('gameover', ctx(c)), null);
  assert.equal(nudgeOf('gameover', personal({ ...c, playSeconds: 199 })), null);
  assert.equal(nudgeOf('gameover', personal({ ...c, avgSessionSeconds: 5000 })), null);
  assert.deepEqual(nudgeOf('gameover', personal({ ...c, avgSessionSeconds: 5000, playSeconds: 600 })), { reason: 'progress', personalized: false });
  assert.equal(nudgeOf('gameover', personal({ ...c, avgSessionSeconds: 4, playSeconds: NUDGE.progressMinSeconds - 1 })), null);
  assert.deepEqual(nudgeOf('gameover', personal({ ...c, avgSessionSeconds: 4, playSeconds: NUDGE.progressMinSeconds })), { reason: 'progress', personalized: true });
});

test('nudge caps and the pause after repeated dismissals', () => {
  const c = (nudges) => ctx({ sessionNo: 1, runs: 5, facts: { newItem: true }, nudges });
  assert.ok(nudgeOf('slot_item', c({})));
  assert.equal(nudgeSkip('slot_item', c({ session: NUDGE.maxPerSession })), 'session_cap');
  assert.equal(nudgeSkip('slot_item', c({ day: NUDGE.maxPerDay })), 'day_cap');
  assert.equal(nudgeSkip('slot_item', c({ secondsAgo: NUDGE.minGapMinutes * 60 - 1 })), 'min_gap');
  assert.ok(nudgeOf('slot_item', c({ secondsAgo: NUDGE.minGapMinutes * 60, day: NUDGE.maxPerDay - 1 })));
  assert.equal(nudgeSkip('slot_item', c({ dismissed: NUDGE.pauseAfterDismissals })), 'paused');
  assert.ok(nudgeOf('slot_item', c({ dismissed: NUDGE.pauseAfterDismissals - 1 })));
});

test('decide is deterministic and does not change its input', () => {
  const c = personal({ segments: ['werbe_tolerant', 'abends'], hour: 20, facts: { newHighscore: true } });
  const copy = structuredClone(c);
  const a = decide('gameover', c);
  const b = decide('gameover', c);
  assert.deepEqual(a, b);
  assert.deepEqual(c, copy);
});
