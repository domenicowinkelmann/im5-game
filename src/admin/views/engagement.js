import { ADMIN } from '../../shared/economy.js';
import { barList, dataTable, figure, kpiTile, lineChart } from '../charts.js';
import { h } from '../dom.js';
import { formatNumber, formatPercent, reasonLabel } from '../format.js';
import {
  DAY_OPTIONS, decisionsPeriod, grid, kpiRow, notesCard, page, pageHead, periodText, rangeControl, readRange, seriesTable,
} from './common.js';

const count = (part, whole) => `${formatNumber(part)} von ${formatNumber(whole)}`;

function nudgeRow(label, r, className = null) {
  return {
    className,
    cells: [
      label,
      formatNumber(r.shown),
      formatNumber(r.archivedShown),
      `${formatNumber(r.dismissed)} (${formatPercent(r.dismissRate)})`,
      `${formatNumber(r.signups)} (${formatPercent(r.signupRate)})`,
      `${count(r.clicked, r.consentedShown)} (${formatPercent(r.clickRate)})`,
    ],
  };
}

export async function render(ctx) {
  const days = readRange(ctx, 'days', ADMIN.days.engagement, ADMIN.days.max);
  const data = await ctx.api.engagement(days);
  const { interstitials: ads, rewarded, nudges } = data;
  const x = ads.daily.map((d) => d.day);
  const adSeries = [{ label: 'Interstitials', values: ads.daily.map((d) => d.shown), slot: 1 }];
  const doubleSeries = [{ label: 'Verdopplungen', values: rewarded.daily.map((d) => d.doubled), slot: 1 }];
  const runSeries = { label: 'Runs', values: rewarded.daily.map((d) => d.runs) };
  const total = nudges.total;
  const reasonItems = ads.byReason.map((r) => ({
    label: reasonLabel(r.reason),
    sub: r.reason === 'ok' ? 'Interstitial gezeigt' : 'übersprungen',
    value: r.decisions,
    valueLabel: 'Entscheidungen',
    muted: r.reason !== 'ok',
    extra: [
      { value: formatNumber(r.shown), label: 'gezeigt' },
      { value: formatNumber(r.personalized), label: 'personalisiert' },
      { value: formatNumber(r.dropped), label: 'nicht angezeigt' },
    ],
  }));

  return page(
    pageHead('Werbung & Erinnerungen', periodText(data),
      rangeControl(ctx, { key: 'days', value: days, options: DAY_OPTIONS, max: ADMIN.days.max, unit: 'Tage' })),
    kpiRow(
      kpiTile({ label: 'Interstitials', value: formatNumber(ads.shown), sub: `gezeigt ${decisionsPeriod(data, days)}`, spark: adSeries[0].values }),
      kpiTile({ label: 'Weiterspielquote', value: formatPercent(ads.continueRate.rate), sub: `${count(ads.continueRate.continued, ads.continueRate.shown)} gezeigten (mit Einwilligung)` }),
      kpiTile({ label: 'Verdopplungen', value: formatNumber(rewarded.doubled), sub: `${formatPercent(rewarded.doubleRate)} von ${formatNumber(rewarded.runs)} Runs`, spark: doubleSeries[0].values }),
      kpiTile({ label: 'Erinnerungen', value: formatNumber(total.shown + total.archivedShown), sub: `${decisionsPeriod(data, days)}, davon ${formatNumber(total.archivedShown)} an inzwischen gelöschte Gäste` }),
      kpiTile({ label: 'Erinnerungen mit Signup', value: formatPercent(total.signupRate), sub: `${count(total.signups, total.shown + total.archivedShown)} mit Registrierung innerhalb 24 h` }),
      kpiTile({ label: 'Registrierungen nach Erinnerung', value: formatNumber(total.registrations), sub: 'innerhalb 24 h, jede Registrierung einmal' }),
    ),
    grid(
      figure({
        title: 'Interstitials pro Tag',
        subtitle: 'Gezeigt, inklusive gelöschter Gäste',
        chart: lineChart({ x, series: adSeries, label: 'Interstitials pro Tag' }),
        table: () => seriesTable(x, adSeries),
      }),
      figure({
        title: 'Verdopplungen pro Tag',
        subtitle: 'Rewarded-Werbung, nur gesamthaft',
        chart: lineChart({ x, series: doubleSeries, label: 'Verdopplungen pro Tag' }),
        table: () => seriesTable(x, [...doubleSeries, runSeries]),
      }),
    ),
    figure({
      title: 'Interstitial-Entscheidungen nach Grund',
      subtitle: 'Nur Spieler mit Statistik-Einwilligung; übersprungene Gründe grau',
      wide: true,
      chart: barList({ items: reasonItems, label: 'Interstitial-Entscheidungen nach Grund', empty: 'Keine Entscheidungen im Zeitraum' }),
      table: () => ({
        columns: [{ label: 'Grund' }, { label: 'Entscheidungen', num: true }, { label: 'Gezeigt', num: true }, { label: 'Personalisiert', num: true }, { label: 'Nicht angezeigt', num: true }],
        rows: ads.byReason.map((r) => [reasonLabel(r.reason), formatNumber(r.decisions), formatNumber(r.shown), formatNumber(r.personalized), formatNumber(r.dropped)]),
      }),
    }),
    h('section', { class: 'card figure wide' },
      h('header', { class: 'figure-head' }, h('div', {},
        h('h2', { text: 'Erinnerungen nach Grund' }),
        h('p', { class: 'sub', text: `Registrierungen nach einer Erinnerung (innerhalb 24 h): ${formatNumber(total.registrations)}` }))),
      dataTable({
        columns: [
          { label: 'Grund' },
          { label: 'Gezeigt', num: true },
          { label: 'Gelöschte Gäste', num: true },
          { label: '«Später»', num: true },
          { label: 'Mit Signup (Quote)', num: true },
          { label: 'Klicks (mit Einwilligung)', num: true },
        ],
        rows: [...nudges.byReason.map((r) => nudgeRow(reasonLabel(r.reason), r)), ...(nudges.byReason.length ? [nudgeRow('Total', total, 'total')] : [])],
        empty: 'Keine Erinnerungen im Zeitraum',
      })),
    notesCard(data.notes),
  );
}
