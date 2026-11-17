import { ADMIN } from '../../shared/economy.js';
import { cohortTable, kpiTile, scaleLegend } from '../charts.js';
import { h } from '../dom.js';
import { formatDayFull, formatNumber, formatPercent } from '../format.js';
import { WEEK_OPTIONS, kpiRow, notesCard, page, pageHead, rangeControl, readRange } from './common.js';

export async function render(ctx) {
  const weeks = readRange(ctx, 'weeks', ADMIN.weeks.retention, ADMIN.weeks.max);
  const data = await ctx.api.retention(weeks);
  const dKeys = ADMIN.retentionDays.map((d) => `d${d}`);
  const tiles = dKeys.map((key, i) => {
    const t = data.totals[key];
    return kpiTile({
      label: `Tag ${ADMIN.retentionDays[i]}`,
      value: formatPercent(t.rate),
      sub: `${formatNumber(t.retained)} von ${formatNumber(t.eligible)} Spielern zurück`,
    });
  });

  return page(
    pageHead('Retention', `Wochen-Kohorten ab ${formatDayFull(data.from)} bis ${formatDayFull(data.to)} (UTC, Wochen ab Montag)`,
      rangeControl(ctx, { key: 'weeks', value: weeks, options: WEEK_OPTIONS, max: ADMIN.weeks.max, unit: 'Wochen' })),
    kpiRow(...tiles),
    h('section', { class: 'card figure wide' },
      h('header', { class: 'figure-head' }, h('div', {},
        h('h2', { text: 'Kohorten' }),
        h('p', { class: 'sub', text: 'D1/D7/D30: Anteil, der genau an diesem Tag wieder gespielt hat. W0 ist die Startwoche, W1 die Woche danach usw.: Anteil, der in dieser Woche aktiv war.' }))),
      scaleLegend(1, (v) => formatPercent(v, 0), { zero: formatPercent(0, 0) }),
      cohortTable({ cohorts: data.cohorts, weeks, dKeys })),
    notesCard([data.note]),
  );
}
