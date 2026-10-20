export const COIN_TYPES = {
  bronze:  { value: 1,  color: '#c98a4b', label: 'Bronze' },
  silver:  { value: 5,  color: '#dfe6ee', label: 'Silber' },
  gold:    { value: 10, color: '#ffc83d', label: 'Gold' },
  diamond: { value: 50, color: '#7ff6ff', label: 'Diamant' },
};

export const MULTIPLIER = {
  nearDistance: 9,
  stepSeconds: 1.4,
  max: 5,
  resetDistance: 24,
  resetSeconds: 1.0,
};

export const TUNNEL_BONUS = 250;
export const STYLE_PER_SECOND = 15;

export const SPIN_COST = 100;
export const START_COINS = 150;

export const RARITY_ORDER = ['common', 'rare', 'epic', 'legendary'];
export const RARITIES = {
  common:    { label: 'Gewöhnlich', color: '#9aa7b8', weight: 110, refund: 15,  symbol: '🪂' },
  rare:      { label: 'Selten',     color: '#3fa7ff', weight: 25, refund: 40,  symbol: '🔥' },
  epic:      { label: 'Episch',     color: '#b46cff', weight: 7,  refund: 100, symbol: '⭐' },
  legendary: { label: 'Legendär',   color: '#ffb020', weight: 3,  refund: 300, symbol: '💎' },
};
export const SLOT = {
  nothing: { weight: 700 },
  pair: { weight: 150, min: 30, max: 70, highChance: 0.5, thirdReelMiss: 0.7 },
  jackpot: { weight: 5, amount: 300, symbol: '🪙' },
};
export const FILLER_SYMBOLS = ['🪙', '🦅', '🚁', '🍀'];
export const ALL_SYMBOLS = [...RARITY_ORDER.map((r) => RARITIES[r].symbol), ...FILLER_SYMBOLS];

export const RUN_LIMITS = { maxCoinsPerSecond: 40, coinBuffer: 500, maxSpeed: 90, maxDuration: 1800, timeSlack: 5 };

export const DOUBLE = { minDelaySeconds: 3, windowSeconds: 900, maxPerDay: 20 };

export const PLAYTIME = { spinSeconds: 3, slotGapSeconds: 60 };

export const ACCOUNT ={ usernamePattern: /^[A-Za-z0-9_.-]{3,20}$/, passwordMin: 8, passwordMax: 128 };
