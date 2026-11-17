import { ADMIN } from '../../shared/economy.js';
import { barList, columnChart, figure, heatmap, maxOf } from '../charts.js';
import {
  WEEKDAYS, WEEKDAYS_SHORT, durationAxis, formatDuration, formatHourRange, formatNumber, formatPercent, formatSessionBin,
} from '../format.js';
import { DAY_OPTIONS, grid, notesCard, page, pageHead, periodText, rangeControl, readRange } from './common.js';

function timeColumns(seconds, labels, titles, label) {
  const axis = durationAxis(maxOf(seconds));
  const items = seconds.map((v, i) => ({ label: labels[i], title: titles[i], value: axis.toUnit(v) }));
  return columnChart({ items, format: axis.format, tick: axis.tick, integer: axis.integer, label });
}

export async function render(ctx) {
  const days = readRange(ctx, 'days', ADMIN.days.activity, ADMIN.days.max);
  const data = await ctx.api.activity(days);
  const hourLabels = data.hours.map((_, i) => String(i));
  const hourTitles = data.hours.map((_, i) => formatHourRange(i, i + 1));
  const typeItems = data.dayparts.map((p) => ({
    label: p.label,
    sub: formatHourRange(p.from, p.to),
    value: p.players,
    valueLabel: 'Spieler mit diesem Typ',
    extra: [{ value: formatPercent(p.share), label: `der Spielzeit (${formatDuration(p.seconds)})` }],
  }));
  const lengthItems = data.sessionLengths.map((b) => ({ label: formatSessionBin(b), value: b.sessions }));

  return page(
    pageHead('Aktivität', `${periodText(data)} · ${formatNumber(data.players)} Spieler mit Einwilligung`,
      rangeControl(ctx, { key: 'days', value: days, options: DAY_OPTIONS, max: ADMIN.days.max, unit: 'Tage' })),
    figure({
      title: 'Spielzeit nach Wochentag und Stunde',
      subtitle: 'Ortszeit der Spieler, Montag zuerst',
      wide: true,
      chart: heatmap({ grid: data.heatmap, format: formatDuration, rowLabels: WEEKDAYS_SHORT, rowTitles: WEEKDAYS, label: 'Spielzeit nach Wochentag und Stunde' }),
      table: () => ({
        columns: [{ label: 'Wochentag' }, ...Array.from({ length: 24 }, (_, i) => ({ label: String(i), num: true }))],
        rows: data.heatmap.map((row, d) => [WEEKDAYS[d], ...row.map((v) => formatDuration(v))]),
      }),
    }),
    grid(
      figure({
        title: 'Spielzeit nach Uhrzeit',
        subtitle: 'Ortszeit, Summe aller Spieler',
        chart: timeColumns(data.hours, hourLabels, hourTitles, 'Spielzeit nach Uhrzeit'),
        table: () => ({ columns: [{ label: 'Stunde' }, { label: 'Spielzeit', num: true }], rows: data.hours.map((v, i) => [formatHourRange(i, i + 1), formatDuration(v)]) }),
      }),
      figure({
        title: 'Spielzeit nach Wochentag',
        subtitle: 'Ortszeit, Summe aller Spieler',
        chart: timeColumns(data.weekdays, WEEKDAYS_SHORT, WEEKDAYS, 'Spielzeit nach Wochentag'),
        table: () => ({ columns: [{ label: 'Wochentag' }, { label: 'Spielzeit', num: true }], rows: data.weekdays.map((v, i) => [WEEKDAYS[i], formatDuration(v)]) }),
      }),
      figure({
        title: 'Tageszeit-Typen',
        subtitle: 'Spieler nach bevorzugter Tageszeit (Profil)',
        chart: barList({ items: typeItems, label: 'Tageszeit-Typen' }),
        table: () => ({
          columns: [{ label: 'Tageszeit' }, { label: 'Zeitraum' }, { label: 'Spieler', num: true }, { label: 'Spielzeit', num: true }, { label: 'Anteil Spielzeit', num: true }],
          rows: data.dayparts.map((p) => [p.label, formatHourRange(p.from, p.to), formatNumber(p.players), formatDuration(p.seconds), formatPercent(p.share)]),
        }),
      }),
      figure({
        title: 'Sessionlängen',
        subtitle: 'Anzahl Sessions nach Dauer',
        chart: columnChart({ items: lengthItems, label: 'Sessionlängen' }),
        table: () => ({ columns: [{ label: 'Dauer' }, { label: 'Sessions', num: true }], rows: lengthItems.map((b) => [b.label, formatNumber(b.value)]) }),
      }),
    ),
    notesCard(data.notes),
  );
}
