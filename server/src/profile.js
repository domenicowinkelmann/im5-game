import { ITEMS, DEFAULT_LOADOUT, getItem } from '../../src/shared/items.js';
import { ApiError, MSG } from './errors.js';

const DEFAULT_ITEMS = ITEMS.filter((i) => i.default).map((i) => i.id);

const playTime = (flightMs, slotMs) => ({
  flight: Math.floor(flightMs / 1000),
  slots: Math.floor(slotMs / 1000),
  total: Math.floor((flightMs + slotMs) / 1000),
});

export async function ownedItems(conn, userId) {
  const rows = await conn.query(
    'SELECT item_id FROM inventory WHERE user_id = ? ORDER BY acquired_at, item_id',
    [userId],
  );
  const owned = [...DEFAULT_ITEMS];
  for (const { item_id: id } of rows) if (getItem(id) && !owned.includes(id)) owned.push(id);
  return owned;
}

export async function loadProfile(conn, userId) {
  const [user] = await conn.query(
    `SELECT id, username, coins, highscore, best_distance, total_runs, play_flight_ms, play_slot_ms
     FROM users WHERE id = ?`,
    [userId],
  );
  if (!user) throw new ApiError(401, MSG.unauthorized);
  const inventory = await ownedItems(conn, userId);
  const rows = await conn.query('SELECT category, item_id FROM loadout WHERE user_id = ?', [userId]);
  const equipped = { ...DEFAULT_LOADOUT };
  for (const { category, item_id: id } of rows) {
    if (category in equipped && getItem(id)?.category === category && inventory.includes(id)) equipped[category] = id;
  }
  return {
    userId: String(user.id),
    username: user.username,
    coins: user.coins,
    highscore: user.highscore,
    bestDistance: user.best_distance,
    totalRuns: user.total_runs,
    playTime: playTime(user.play_flight_ms, user.play_slot_ms),
    inventory,
    equipped,
  };
}
