import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateRun } from '../src/game/runs.js';
import { COIN_TYPES, MULTIPLIER, TUNNEL_BONUS, STYLE_PER_SECOND, RUN_LIMITS } from '../../src/shared/economy.js';

function simulate({ seconds = 60, mult = 3, tunnels = 1, counts = { bronze: 10, silver: 6, gold: 2, diamond: 0 } } = {}) {
  const base = Object.entries(counts).reduce((s, [k, n]) => s + n * COIN_TYPES[k].value, 0);
  const distRaw = seconds * 40.7;
  const style = seconds * 0.5 * STYLE_PER_SECOND * mult;
  return {
    distance: Math.floor(distRaw),
    score: Math.floor(distRaw + style + tunnels * TUNNEL_BONUS),
    coins: base * mult,
    duration: seconds,
    maxMultiplier: mult,
    tunnels,
    cause: 'Baum erwischt',
    coinsByType: counts,
  };
}

test('accepts a realistic run', () => {
  const run = simulate();
  assert.deepEqual(validateRun(run), run);
});

test('accepts an instant crash with zero duration', () => {
  const run = simulate({ seconds: 0, tunnels: 0, counts: { bronze: 0, silver: 0, gold: 0, diamond: 0 } });
  assert.ok(validateRun(run));
});

test('rejects wrong types and shapes', () => {
  const run = simulate();
  for (const patch of [
    { coins: -1 }, { coins: 1.5 }, { coins: '10' }, { distance: null }, { tunnels: -2 },
    { duration: 'x' }, { duration: Infinity }, { duration: -1 }, { duration: RUN_LIMITS.maxDuration + 1 },
    { maxMultiplier: 0 }, { maxMultiplier: MULTIPLIER.max + 1 }, { maxMultiplier: 2.5 },
    { cause: 5 }, { cause: 'x'.repeat(41) },
    { coinsByType: null }, { coinsByType: [] }, { coinsByType: { bronze: 1 } },
    { coinsByType: { bronze: 1, silver: 0, gold: 0, diamond: 0, ruby: 0 } },
    { coinsByType: { bronze: -1, silver: 0, gold: 0, diamond: 0 } },
  ]) {
    assert.equal(validateRun({ ...run, ...patch }), null, JSON.stringify(patch));
  }
  assert.equal(validateRun(null), null);
  assert.equal(validateRun([]), null);
});

test('rejects coins outside of the multiplier range', () => {
  const run = simulate({ mult: 2 });
  const base = run.coins / 2;
  assert.ok(validateRun({ ...run, coins: base }));
  assert.equal(validateRun({ ...run, coins: base - 1 }), null);
  assert.equal(validateRun({ ...run, coins: base * 2 + 1 }), null);
});

test('rejects coins and distance above the time limits', () => {
  const run = simulate({ seconds: 10 });
  assert.equal(validateRun({ ...run, distance: 10 * RUN_LIMITS.maxSpeed + 51, score: run.score + 10_000 }), null);
  const counts = { bronze: 0, silver: 0, gold: 0, diamond: 20 };
  assert.equal(validateRun({ ...simulate({ seconds: 10, mult: 1, counts }) }), null);
});

test('rejects scores outside of the formula bounds', () => {
  const run = simulate({ seconds: 30, mult: 2, tunnels: 2 });
  const fixed = run.distance + run.tunnels * TUNNEL_BONUS;
  assert.equal(validateRun({ ...run, score: fixed - 1 }), null);
  const max = Math.floor(fixed + 1 + run.duration * STYLE_PER_SECOND * run.maxMultiplier);
  assert.ok(validateRun({ ...run, score: max }));
  assert.equal(validateRun({ ...run, score: max + 1 }), null);
});

test('strips unknown fields', () => {
  const out = validateRun({ ...simulate(), admin: true, coinsByType: { bronze: 10, silver: 6, gold: 2, diamond: 0 } });
  assert.equal(out.admin, undefined);
});
