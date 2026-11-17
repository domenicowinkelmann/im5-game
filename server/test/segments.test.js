import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DAYPARTS, SEGMENTS } from '../../src/shared/economy.js';
import {
  SEGMENT_LABELS, daypartOf, heatStats, scoreProfile, deriveSegments, hasProgress, usualGapHours,
} from '../../src/shared/segments.js';

const FORBIDDEN = /slot|spin|gambl|wette|verdopp|doubl|vielspiel|automat|jackpot|gl(ue|ü)ck|casino|einsatz/i;

function dayparts(shares = {}, minutes = 60) {
  return Object.fromEntries(Object.keys(DAYPARTS).map((name) => [
    name, { share: shares[name] ?? 0, s: (shares[name] ?? 0) * minutes * 60 },
  ]));
}

function metrics(patch = {}) {
  const base = {
    hoursSinceLast: 2,
    account: { guest: false, consentHours: 24 * 30, sessions: 10, runs: 40, extraItems: 0, coins: 120 },
    sessions: { count: 5, usualGapH: 24, lastPauseH: 20 },
    play: { totalS: 3600, s30d: 1800, activeDays30: 5, activeDays90: 9 },
    dayparts: dayparts(),
    weekendShare: 0.2,
    context: { device: null },
    ads: { shown: 0, continued: 0 },
  };
  const out = { ...base, ...patch };
  for (const key of ['account', 'sessions', 'play', 'context', 'ads']) out[key] = { ...base[key], ...patch[key] };
  return out;
}

const segmentsOf = (m) => deriveSegments(m, scoreProfile(m));

test('daypartOf covers every hour and wraps over midnight', () => {
  const expected = {
    0: 'nachts', 1: 'nachts', 4: 'nachts', 5: 'morgens', 10: 'morgens', 11: 'mittags', 13: 'mittags',
    14: 'nachmittags', 17: 'nachmittags', 18: 'abends', 21: 'abends', 22: 'nachts', 23: 'nachts',
  };
  for (const [hour, part] of Object.entries(expected)) assert.equal(daypartOf(Number(hour)), part, hour);
  assert.equal(daypartOf(24), 'nachts');
  assert.equal(daypartOf(-1), 'nachts');
  assert.equal(daypartOf(29), 'morgens');
  const counts = {};
  for (let h = 0; h < 24; h++) counts[daypartOf(h)] = (counts[daypartOf(h)] ?? 0) + 1;
  assert.deepEqual(counts, { nachts: 7, morgens: 6, mittags: 3, nachmittags: 4, abends: 4 });
});

test('engagement follows the formula', () => {
  const e = SEGMENTS.engagement;
  assert.equal(scoreProfile(metrics({ hoursSinceLast: 0, play: { activeDays30: 15, s30d: 300 * 60 } })).engagement, 100);
  assert.equal(scoreProfile(metrics({ hoursSinceLast: 0, play: { activeDays30: 30, s30d: 900 * 60 } })).engagement, 100);
  assert.equal(scoreProfile(metrics({ hoursSinceLast: 168, play: { activeDays30: 0, s30d: 0 } })).engagement, 15);
  const m = metrics({ hoursSinceLast: 50, play: { activeDays30: 6, s30d: 45 * 60 } });
  const expected = Math.round(100 * (e.recency * Math.exp(-50 / 168) + e.active * (6 / 15) + e.play * (Math.log(46) / Math.log(301))));
  assert.equal(scoreProfile(m).engagement, expected);
  assert.equal(scoreProfile(metrics({ hoursSinceLast: -3, play: { activeDays30: 0, s30d: 0 } })).engagement, 40);
});

test('churn risk needs two sessions and uses the usual gap with a floor of 6 hours', () => {
  assert.equal(scoreProfile(metrics({ sessions: { count: 1 } })).churnRisk, null);
  assert.equal(scoreProfile(metrics({ sessions: { count: 0 } })).churnRisk, null);
  assert.equal(scoreProfile(metrics({ hoursSinceLast: 24, sessions: { count: 2, usualGapH: 12 } })).churnRisk, 0.632);
  assert.equal(scoreProfile(metrics({ hoursSinceLast: 12, sessions: { count: 3, usualGapH: 1 } })).churnRisk, 0.632);
  assert.equal(scoreProfile(metrics({ hoursSinceLast: 0, sessions: { count: 3 } })).churnRisk, 0);
  assert.equal(usualGapHours(null), 6);
  assert.equal(usualGapHours(2), 6);
  assert.equal(usualGapHours(30), 30);
});

test('ad tolerance is smoothed towards (0 + 4) / (0 + 5)', () => {
  assert.equal(scoreProfile(metrics()).adTolerance, 0.8);
  assert.equal(scoreProfile(metrics({ ads: { shown: 9, continued: 2 } })).adTolerance, 0.429);
  assert.equal(scoreProfile(metrics({ ads: { shown: 10, continued: 10 } })).adTolerance, 0.933);
});

test('exactly one of neu, stamm and gelegentlich applies', () => {
  assert.ok(segmentsOf(metrics({ account: { sessions: 3 } })).includes('neu'));
  assert.ok(segmentsOf(metrics({ account: { consentHours: 47 } })).includes('neu'));
  const stamm = metrics({ play: { activeDays30: 8 }, sessions: { count: 6 } });
  assert.ok(segmentsOf(stamm).includes('stamm'));
  assert.ok(segmentsOf({ ...stamm, account: { ...stamm.account, consentHours: 10 } }).includes('neu'));
  assert.ok(segmentsOf(metrics({ play: { activeDays30: 7 }, sessions: { count: 6 } })).includes('gelegentlich'));
  assert.ok(segmentsOf(metrics({ play: { activeDays30: 8 }, sessions: { count: 5 } })).includes('gelegentlich'));
  for (const m of [metrics(), stamm, metrics({ account: { sessions: 1 } })]) {
    assert.equal(segmentsOf(m).filter((s) => ['neu', 'stamm', 'gelegentlich'].includes(s)).length, 1);
  }
});

test('rueckkehrer needs a long pause before the last session and four sessions', () => {
  assert.ok(segmentsOf(metrics({ sessions: { count: 4, usualGapH: 10, lastPauseH: 48 } })).includes('rueckkehrer'));
  assert.ok(!segmentsOf(metrics({ sessions: { count: 4, usualGapH: 10, lastPauseH: 47.9 } })).includes('rueckkehrer'));
  assert.ok(!segmentsOf(metrics({ sessions: { count: 4, usualGapH: 20, lastPauseH: 59 } })).includes('rueckkehrer'));
  assert.ok(segmentsOf(metrics({ sessions: { count: 4, usualGapH: 20, lastPauseH: 60 } })).includes('rueckkehrer'));
  assert.ok(!segmentsOf(metrics({ sessions: { count: 3, usualGapH: 10, lastPauseH: 100 } })).includes('rueckkehrer'));
  assert.ok(!segmentsOf(metrics({ sessions: { count: 4, usualGapH: 10, lastPauseH: null } })).includes('rueckkehrer'));
});

test('abwanderung needs a churn risk of 0.6 and three sessions', () => {
  const gone = metrics({ hoursSinceLast: 100, sessions: { count: 3, usualGapH: 24 } });
  assert.ok(scoreProfile(gone).churnRisk >= 0.6);
  assert.ok(segmentsOf(gone).includes('abwanderung'));
  assert.ok(!segmentsOf({ ...gone, sessions: { ...gone.sessions, count: 2 } }).includes('abwanderung'));
  const close = metrics({ hoursSinceLast: 40, sessions: { count: 5, usualGapH: 24 } });
  assert.ok(scoreProfile(close).churnRisk < 0.6);
  assert.ok(!segmentsOf(close).includes('abwanderung'));
});

test('daypart segments need a share of 0.4 and 30 minutes', () => {
  const at = (shares, minutes) => segmentsOf(metrics({ dayparts: dayparts(shares, minutes) }));
  assert.ok(at({ abends: 0.4, morgens: 0.6 }, 100).includes('abends'));
  assert.ok(at({ abends: 0.4, morgens: 0.6 }, 100).includes('morgens'));
  assert.ok(!at({ abends: 0.39, morgens: 0.61 }, 100).includes('abends'));
  assert.ok(!at({ nachts: 1 }, 29).includes('nachts'));
  assert.ok(at({ nachts: 1 }, 30).includes('nachts'));
  for (const part of Object.keys(DAYPARTS)) assert.ok(at({ [part]: 1 }, 60).includes(part), part);
});

test('wochenende needs a share of 0.6 and four active days', () => {
  assert.ok(segmentsOf(metrics({ weekendShare: 0.6, play: { activeDays90: 4 } })).includes('wochenende'));
  assert.ok(!segmentsOf(metrics({ weekendShare: 0.59, play: { activeDays90: 9 } })).includes('wochenende'));
  assert.ok(!segmentsOf(metrics({ weekendShare: 1, play: { activeDays90: 3 } })).includes('wochenende'));
  assert.ok(!segmentsOf(metrics({ weekendShare: null })).includes('wochenende'));
});

test('ad segments only apply with enough shown interstitials', () => {
  assert.ok(segmentsOf(metrics({ ads: { shown: 4, continued: 0 } })).includes('werbe_muede'));
  assert.ok(!segmentsOf(metrics({ ads: { shown: 3, continued: 0 } })).includes('werbe_muede'));
  assert.ok(!segmentsOf(metrics({ ads: { shown: 5, continued: 2 } })).includes('werbe_muede'));
  assert.ok(segmentsOf(metrics({ ads: { shown: 6, continued: 6 } })).includes('werbe_tolerant'));
  assert.ok(!segmentsOf(metrics({ ads: { shown: 5, continued: 5 } })).includes('werbe_tolerant'));
  assert.ok(!segmentsOf(metrics({ ads: { shown: 6, continued: 5 } })).includes('werbe_tolerant'));
  const none = segmentsOf(metrics());
  assert.ok(!none.includes('werbe_muede') && !none.includes('werbe_tolerant'));
});

test('gast_fortschritt only for guests with progress', () => {
  assert.ok(segmentsOf(metrics({ account: { guest: true, runs: 3, coins: 0 } })).includes('gast_fortschritt'));
  assert.ok(segmentsOf(metrics({ account: { guest: true, runs: 0, extraItems: 1, coins: 0 } })).includes('gast_fortschritt'));
  assert.ok(segmentsOf(metrics({ account: { guest: true, runs: 0, coins: 500 } })).includes('gast_fortschritt'));
  assert.ok(!segmentsOf(metrics({ account: { guest: true, runs: 2, coins: 499 } })).includes('gast_fortschritt'));
  assert.ok(!segmentsOf(metrics({ account: { guest: false, runs: 99, coins: 9999 } })).includes('gast_fortschritt'));
  assert.equal(hasProgress(), false);
});

test('device segments are descriptive', () => {
  assert.ok(segmentsOf(metrics({ context: { device: 'mobile' } })).includes('mobil'));
  assert.ok(segmentsOf(metrics({ context: { device: 'tablet' } })).includes('tablet'));
  assert.ok(segmentsOf(metrics({ context: { device: 'desktop' } })).includes('desktop'));
  const none = segmentsOf(metrics({ context: { device: null } }));
  assert.ok(!none.some((s) => ['mobil', 'tablet', 'desktop'].includes(s)));
});

test('every derived segment has a German label', () => {
  const m = metrics({
    hoursSinceLast: 200, account: { guest: true, sessions: 2, coins: 600 }, sessions: { count: 6, usualGapH: 6, lastPauseH: 300 },
    dayparts: dayparts({ morgens: 0.5, abends: 0.5 }), weekendShare: 0.9, context: { device: 'tablet' }, ads: { shown: 8, continued: 0 },
  });
  const segments = segmentsOf(m);
  assert.ok(segments.length >= 7, segments.join());
  for (const s of segments) assert.equal(typeof SEGMENT_LABELS[s], 'string', s);
});

test('no segment, label or threshold is about the slot machine or doubling', async () => {
  const words = [
    ...Object.keys(SEGMENT_LABELS), ...Object.values(SEGMENT_LABELS),
    ...Object.keys(SEGMENTS), JSON.stringify(SEGMENTS),
  ];
  for (const w of words) assert.ok(!FORBIDDEN.test(w), w);
  const source = await readFile(new URL('../../src/shared/segments.js', import.meta.url), 'utf8');
  assert.ok(!FORBIDDEN.test(source));
  for (const bad of ['slot_vielspieler', 'verdoppler', 'spin_fan', 'gambler', 'double_lover']) {
    assert.equal(bad in SEGMENT_LABELS, false, bad);
  }
});

test('heat statistics use a circular favourite hour, shares and consistency', () => {
  const heat = Array(168).fill(0);
  heat[23] = 100;
  heat[24 + 0] = 100;
  heat[24 + 1] = 100;
  heat[5 * 24 + 12] = 150;
  const s = heatStats(heat);
  assert.equal(s.total, 450);
  assert.equal(s.favHour, 0);
  assert.equal(s.favWeekday, 1);
  assert.equal(s.daypart, 'nachts');
  assert.equal(s.dayparts.nachts.s, 300);
  assert.equal(s.dayparts.nachts.share, 0.667);
  assert.equal(s.dayparts.mittags.share, 0.333);
  assert.equal(s.weekendShare, 0.333);
  assert.equal(heatStats(Array(168).fill(10)).consistency, 0);
  const single = Array(168).fill(0);
  single[3 * 24 + 19] = 900;
  assert.equal(heatStats(single).consistency, 1);
  assert.equal(heatStats(single).favHour, 19);
  const empty = heatStats(Array(168).fill(0));
  assert.deepEqual([empty.favHour, empty.daypart, empty.weekendShare, empty.consistency], [null, null, null, null]);
});
