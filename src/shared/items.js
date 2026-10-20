export const ITEMS = [
  { id: 'suit_orange',   category: 'suit', name: 'Signalorange',    rarity: 'common', color: '#ff7a1a', accent: '#1d2633', default: true },
  { id: 'suit_glacier',  category: 'suit', name: 'Gletscherblau',   rarity: 'common', color: '#5fb6e8', accent: '#14324a' },
  { id: 'suit_forest',   category: 'suit', name: 'Tannengrün',      rarity: 'common', color: '#3f8a4f', accent: '#1b2b1f' },
  { id: 'suit_midnight', category: 'suit', name: 'Mitternacht',     rarity: 'rare',   color: '#2a3160', accent: '#8f9bff' },
  { id: 'suit_flamingo', category: 'suit', name: 'Flamingo',        rarity: 'rare',   color: '#ff6fa8', accent: '#3a1530' },
  { id: 'suit_alpine',   category: 'suit', name: 'Alpenrot',        rarity: 'rare',   color: '#d8262f', accent: '#ffffff' },
  { id: 'suit_chrome',   category: 'suit', name: 'Chrom',           rarity: 'epic',   color: '#cfd6de', accent: '#5a6470', metal: true },
  { id: 'suit_neon',     category: 'suit', name: 'Neon',            rarity: 'epic',   color: '#b6ff2e', accent: '#111111', glow: true },
  { id: 'suit_gold',     category: 'suit', name: 'Goldener Adler',  rarity: 'legendary', color: '#ffc83d', accent: '#5a3a00', metal: true, glow: true },

  { id: 'trail_white',   category: 'trail', name: 'Wolkenweiss', rarity: 'common', color: '#ffffff', default: true },
  { id: 'trail_red',     category: 'trail', name: 'Signalrot',   rarity: 'common', color: '#ff3b3b' },
  { id: 'trail_sky',     category: 'trail', name: 'Himmelblau',  rarity: 'common', color: '#58c4ff' },
  { id: 'trail_fire',    category: 'trail', name: 'Feuer',       rarity: 'rare',   color: '#ffb000', color2: '#ff2200' },
  { id: 'trail_toxic',   category: 'trail', name: 'Giftgrün',    rarity: 'rare',   color: '#7dff4f', color2: '#00b37a' },
  { id: 'trail_galaxy',  category: 'trail', name: 'Galaxie',     rarity: 'epic',   color: '#8b5cff', color2: '#22d3ee' },
  { id: 'trail_rainbow', category: 'trail', name: 'Regenbogen',  rarity: 'legendary', color: '#ff4d6d', rainbow: true },
];

export const CATEGORIES = { suit: 'Anzug', trail: 'Spur' };

export const DEFAULT_LOADOUT = { suit: 'suit_orange', trail: 'trail_white' };

const byId = new Map(ITEMS.map((i) => [i.id, i]));
export const getItem = (id) => byId.get(id);
export const itemsByCategory = (cat) => ITEMS.filter((i) => i.category === cat);

export const dropPool = (rarity) => ITEMS.filter((i) => i.rarity === rarity && !i.default);
