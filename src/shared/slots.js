import { SLOT, RARITIES, RARITY_ORDER, ALL_SYMBOLS } from './economy.js';
import { dropPool } from './items.js';

const TABLE = [
  ['nothing', SLOT.nothing.weight],
  ['pair', SLOT.pair.weight],
  ['jackpot', SLOT.jackpot.weight],
  ...RARITY_ORDER.map((r) => [r, RARITIES[r].weight]),
];
const HIGH_SYMBOLS = [RARITIES.legendary.symbol, RARITIES.epic.symbol];

const pick = (rng, list) => list[rng(list.length)];
const chance = (rng, p) => rng(1000) < p * 1000;

function weighted(rng, table) {
  let x = rng(table.reduce((sum, [, w]) => sum + w, 0));
  for (const [key, weight] of table) {
    x -= weight;
    if (x < 0) return key;
  }
  return table[table.length - 1][0];
}

function distinctReels(rng) {
  const pool = [...ALL_SYMBOLS];
  return [0, 1, 2].map(() => pool.splice(rng(pool.length), 1)[0]);
}

function pairReels(rng) {
  const s = chance(rng, SLOT.pair.highChance) ? pick(rng, HIGH_SYMBOLS) : pick(rng, ALL_SYMBOLS);
  const odd = chance(rng, SLOT.pair.thirdReelMiss) ? 2 : rng(2);
  const reels = [s, s, s];
  reels[odd] = pick(rng, ALL_SYMBOLS.filter((x) => x !== s));
  return reels;
}

export const isNearMiss = (reels) => reels[0] === reels[1] && reels[1] !== reels[2] && HIGH_SYMBOLS.includes(reels[0]);

export function rollSpin(rng) {
  const outcome = weighted(rng, TABLE);
  if (outcome === 'nothing') return { outcome, reels: distinctReels(rng), amount: 0 };
  if (outcome === 'pair') {
    return { outcome, reels: pairReels(rng), amount: SLOT.pair.min + rng(SLOT.pair.max - SLOT.pair.min + 1) };
  }
  if (outcome === 'jackpot') {
    const s = SLOT.jackpot.symbol;
    return { outcome, reels: [s, s, s], amount: SLOT.jackpot.amount };
  }
  const s = RARITIES[outcome].symbol;
  return { outcome, reels: [s, s, s], amount: 0, item: pick(rng, dropPool(outcome)) };
}

export function spinResult(spin, owned) {
  if (spin.outcome === 'nothing') return { result: { kind: 'nothing' }, delta: 0, newItem: null };
  if (spin.outcome === 'pair' || spin.outcome === 'jackpot') {
    return {
      result: { kind: 'coins', amount: spin.amount, combo: spin.outcome, nearMiss: isNearMiss(spin.reels) },
      delta: spin.amount,
      newItem: null,
    };
  }
  const duplicate = owned.includes(spin.item.id);
  const refund = duplicate ? RARITIES[spin.outcome].refund : 0;
  return {
    result: { kind: 'item', item: spin.item, duplicate, refund },
    delta: refund,
    newItem: duplicate ? null : spin.item.id,
  };
}
