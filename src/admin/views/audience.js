import { ADMIN } from '../../shared/economy.js';
import { barList, figure, kpiTile } from '../charts.js';
import { audienceLabel, formatNumber } from '../format.js';
import { DAY_OPTIONS, grid, kpiRow, notesCard, page, pageHead, periodText, rangeControl, readRange } from './common.js';

const DIMENSIONS = [
  { key: 'countries', title: 'Land' },
  { key: 'regions', title: 'Kanton', subtitle: 'Nur Spieler aus der Schweiz' },
  { key: 'devices', title: 'Gerät' },
  { key: 'os', title: 'Betriebssystem' },
  { key: 'browsers', title: 'Browser' },
  { key: 'screens', title: 'Bildschirm' },
  { key: 'referrers', title: 'Referrer', subtitle: 'Herkunftsseite (nur Hostname)' },
  { key: 'utmSources', title: 'UTM-Quelle' },
  { key: 'utmMediums', title: 'UTM-Medium' },
  { key: 'utmCampaigns', title: 'UTM-Kampagne' },
];

function dimension(def, data) {
  const groups = data[def.key] ?? [];
  const items = groups.map((g) => ({
    label: audienceLabel(def.key, g),
    value: g.players,
    valueLabel: 'Spieler',
    muted: Boolean(g.other) || g.value == null,
  }));
  const fewSwiss = def.key === 'regions' && data.swissPlayers == null;
  const hidden = fewSwiss ? 0 : data.suppressed?.[def.key] ?? 0;
  const parts = [def.subtitle];
  if (hidden > 0) parts.push(`${formatNumber(hidden)} Spieler in Gruppen unter ${data.minGroupSize} ausgeblendet`);
  const empty = fewSwiss ? `Weniger als ${data.minGroupSize} Spieler aus der Schweiz` : 'Keine Gruppe erreicht die Mindestgrösse';
  return figure({
    title: def.title,
    subtitle: parts.filter(Boolean).join(' · ') || null,
    chart: barList({ items, label: def.title, empty }),
    table: () => ({ columns: [{ label: def.title }, { label: 'Spieler', num: true }], rows: items.map((it) => [it.label, formatNumber(it.value)]), empty }),
  });
}

export async function render(ctx) {
  const days = readRange(ctx, 'days', ADMIN.days.audience, ADMIN.days.max);
  const data = await ctx.api.audience(days);
  return page(
    pageHead('Publikum', periodText(data),
      rangeControl(ctx, { key: 'days', value: days, options: DAY_OPTIONS, max: ADMIN.days.max, unit: 'Tage' })),
    kpiRow(
      kpiTile({ label: 'Spieler', value: formatNumber(data.players), sub: 'mit Statistik-Einwilligung' }),
      kpiTile({
        label: 'Aus der Schweiz',
        value: data.swissPlayers == null ? `unter ${data.minGroupSize}` : formatNumber(data.swissPlayers),
        sub: 'Spieler mit Land CH',
      }),
      kpiTile({ label: 'Mindestgruppe', value: formatNumber(data.minGroupSize), sub: 'kleinere Gruppen nur als «Andere»' }),
    ),
    grid(...DIMENSIONS.map((def) => dimension(def, data))),
    notesCard(data.notes),
  );
}
