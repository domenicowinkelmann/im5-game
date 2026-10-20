import {
  COIN_TYPES, MULTIPLIER, TUNNEL_BONUS, STYLE_PER_SECOND, RUN_LIMITS,
} from '../../../src/shared/economy.js';

const COIN_KEYS = Object.keys(COIN_TYPES);
const isCount = (v) => Number.isSafeInteger(v) && v >= 0;
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function validateRun(body) {
  if (!isPlainObject(body)) return null;
  const { distance, score, coins, duration, maxMultiplier, tunnels, cause = '', coinsByType } = body;

  if (![distance, score, coins, tunnels].every(isCount)) return null;
  if (typeof duration !== 'number' || !Number.isFinite(duration)) return null;
  if (duration < 0 || duration > RUN_LIMITS.maxDuration) return null;
  if (!Number.isInteger(maxMultiplier) || maxMultiplier < 1 || maxMultiplier > MULTIPLIER.max) return null;
  if (typeof cause !== 'string' || cause.length > 40) return null;
  if (!isPlainObject(coinsByType) || Object.keys(coinsByType).length !== COIN_KEYS.length) return null;
  if (!COIN_KEYS.every((k) => isCount(coinsByType[k]))) return null;

  const dur = Math.max(1, duration);
  const base = COIN_KEYS.reduce((sum, k) => sum + coinsByType[k] * COIN_TYPES[k].value, 0);
  if (coins < base || coins > base * maxMultiplier) return null;
  if (coins > dur * RUN_LIMITS.maxCoinsPerSecond + RUN_LIMITS.coinBuffer) return null;
  if (distance > dur * RUN_LIMITS.maxSpeed + 50) return null;

  const fixed = distance + tunnels * TUNNEL_BONUS;
  if (score < fixed || score > fixed + 1 + duration * STYLE_PER_SECOND * maxMultiplier) return null;

  return {
    distance, score, coins, duration, maxMultiplier, tunnels, cause,
    coinsByType: Object.fromEntries(COIN_KEYS.map((k) => [k, coinsByType[k]])),
  };
}
