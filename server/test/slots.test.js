import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { rollSpin, spinResult, isNearMiss } from '../../src/shared/slots.js';
import { SLOT, RARITIES, RARITY_ORDER, ALL_SYMBOLS } from '../../src/shared/economy.js';
import { dropPool } from '../../src/shared/items.js';

const OUTCOMES = [
  ['nothing', SLOT.nothing.weight],
  ['pair', SLOT.pair.weight],
  ['jackpot', SLOT.jackpot.weight],
  ...RARITY_ORDER.map((r) => [r, RARITIES[r].weight]),
];

const firstThen = (value, rest = () => 0) => {
  let used = false;
  return (max) => {
    if (used) return rest(max);
    used = true;
    return value;
  };
};

const allEqual = (r) => r[0] === r[1] && r[1] === r[2];
const distinctCount = (r) => new Set(r).size;

test('the weight table maps to every outcome', () => {
  let offset = 0;
  for (const [key, weight] of OUTCOMES) {
    assert.equal(rollSpin(firstThen(offset)).outcome, key);
    assert.equal(rollSpin(firstThen(offset + weight - 1)).outcome, key);
    offset += weight;
  }
});

test('reels always match the outcome', () => {
  for (let i = 0; i < 5000; i++) {
    const spin = rollSpin(randomInt);
    assert.ok(spin.reels.every((s) => ALL_SYMBOLS.includes(s)));
    if (spin.outcome === 'nothing') {
      assert.equal(distinctCount(spin.reels), 3);
      assert.equal(spin.amount, 0);
    } else if (spin.outcome === 'pair') {
      assert.equal(distinctCount(spin.reels), 2);
      assert.ok(spin.amount >= SLOT.pair.min && spin.amount <= SLOT.pair.max);
    } else if (spin.outcome === 'jackpot') {
      assert.deepEqual(spin.reels, [SLOT.jackpot.symbol, SLOT.jackpot.symbol, SLOT.jackpot.symbol]);
      assert.equal(spin.amount, SLOT.jackpot.amount);
    } else {
      assert.ok(allEqual(spin.reels));
      assert.equal(spin.reels[0], RARITIES[spin.outcome].symbol);
      assert.ok(dropPool(spin.outcome).includes(spin.item));
    }
  }
});

test('spinResult builds the client result and coin delta', () => {
  assert.deepEqual(spinResult({ outcome: 'nothing', reels: ['🦅', '🍀', '🚁'], amount: 0 }, []), {
    result: { kind: 'nothing' }, delta: 0, newItem: null,
  });
  const pair = spinResult({ outcome: 'pair', reels: ['💎', '💎', '🦅'], amount: 50 }, []);
  assert.deepEqual(pair, { result: { kind: 'coins', amount: 50, combo: 'pair', nearMiss: true }, delta: 50, newItem: null });
  const item = dropPool('rare')[0];
  const fresh = spinResult({ outcome: 'rare', reels: ['🔥', '🔥', '🔥'], item }, []);
  assert.deepEqual(fresh, { result: { kind: 'item', item, duplicate: false, refund: 0 }, delta: 0, newItem: item.id });
  const dup = spinResult({ outcome: 'rare', reels: ['🔥', '🔥', '🔥'], item }, [item.id]);
  assert.equal(dup.delta, RARITIES.rare.refund);
  assert.equal(dup.newItem, null);
});

test('near miss only for two high symbols on the first reels', () => {
  assert.equal(isNearMiss(['💎', '💎', '🦅']), true);
  assert.equal(isNearMiss(['⭐', '⭐', '🍀']), true);
  assert.equal(isNearMiss(['🦅', '🦅', '💎']), false);
  assert.equal(isNearMiss(['💎', '🦅', '💎']), false);
  assert.equal(isNearMiss(['💎', '💎', '💎']), false);
});

test('distribution follows the weights', () => {
  const total = OUTCOMES.reduce((s, [, w]) => s + w, 0);
  const n = 100_000;
  const counts = {};
  for (let i = 0; i < n; i++) {
    const o = rollSpin(randomInt).outcome;
    counts[o] = (counts[o] || 0) + 1;
  }
  for (const [k, w] of OUTCOMES) {
    assert.ok(Math.abs((counts[k] ?? 0) / n - w / total) < 0.01, `${k}: ${counts[k] / n} vs ${w / total}`);
  }
});
