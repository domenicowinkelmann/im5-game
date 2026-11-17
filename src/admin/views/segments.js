import { barList, columnChart, figure, kpiTile } from '../charts.js';
import { formatNumber, formatPercent, formatScoreBin } from '../format.js';
import { grid, kpiRow, notesCard, page, pageHead } from './common.js';

const HISTOGRAMS = [
  { key: 'engagement', title: 'Engagement', subtitle: 'Score 0 bis 100', digits: 0, missing: 'ohne Score' },
  { key: 'churnRisk', title: 'Abwanderungsrisiko', subtitle: 'Wert 0 bis 1', digits: 1, missing: 'ohne Wert (weniger als 2 Sessions)' },
  { key: 'adTolerance', title: 'Werbetoleranz', subtitle: 'Wert 0 bis 1', digits: 1, missing: 'ohne Wert' },
];

function histogram(def, hist) {
  const items = hist.bins.map((b) => ({ label: formatScoreBin(b, def.digits), title: formatScoreBin(b, 2), value: b.players, valueLabel: 'Spieler' }));
  return figure({
    title: def.title,
    subtitle: `${def.subtitle} · ${formatNumber(hist.missing)} Spieler ${def.missing}`,
    chart: columnChart({ items, label: def.title }),
    table: () => ({ columns: [{ label: 'Bereich' }, { label: 'Spieler', num: true }], rows: items.map((it) => [it.title, formatNumber(it.value)]) }),
  });
}

export async function render(ctx) {
  const data = await ctx.api.segments();
  const items = data.segments.map((sg) => ({
    label: sg.label,
    sub: sg.rule,
    value: sg.players,
    valueLabel: 'Spieler',
    extra: [
      { value: formatPercent(sg.share), label: 'der Profile' },
      { value: formatNumber(sg.archived), label: 'im Archiv' },
    ],
  }));

  return page(
    pageHead('Segmente', 'Aktuelle Profile von Spielern mit Statistik-Einwilligung'),
    kpiRow(
      kpiTile({ label: 'Profile', value: formatNumber(data.profiles), sub: 'Spieler mit Profil' }),
      kpiTile({ label: 'Archivierte Profile', value: formatNumber(data.archivedProfiles), sub: 'gelöschte Spieler mit Segmenten' }),
    ),
    figure({
      title: 'Verteilung',
      subtitle: 'Ein Spieler kann in mehreren Segmenten sein',
      wide: true,
      chart: barList({ items, label: 'Segmente' }),
      table: () => ({
        columns: [{ label: 'Segment' }, { label: 'Regel' }, { label: 'Spieler', num: true }, { label: 'Anteil', num: true }, { label: 'Archiv', num: true }],
        rows: data.segments.map((sg) => [sg.label, sg.rule, formatNumber(sg.players), formatPercent(sg.share), formatNumber(sg.archived)]),
      }),
    }),
    grid(...HISTOGRAMS.map((def) => histogram(def, data.histograms[def.key]))),
    notesCard(data.notes),
  );
}
