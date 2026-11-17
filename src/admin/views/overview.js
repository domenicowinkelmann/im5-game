import { ADMIN } from '../../shared/economy.js';
import { figure, kpiTile, lineChart, maxOf } from '../charts.js';
import { durationAxis, formatDuration, formatNumber, formatPercent } from '../format.js';
import {
  DAY_OPTIONS, decisionsPeriod, grid, kpiRow, notesCard, page, pageHead, periodText, rangeControl, readRange, seriesTable,
} from './common.js';

function lines(title, subtitle, days, series, { integer = true, format, tick } = {}) {
  return figure({
    title,
    subtitle,
    legendItems: series.length > 1 ? series : null,
    chart: lineChart({ x: days, series, integer, format, tick, label: title }),
    table: () => seriesTable(days, series),
  });
}

export async function render(ctx) {
  const days = readRange(ctx, 'days', ADMIN.days.overview, ADMIN.days.max);
  const data = await ctx.api.overview(days);
  const k = data.kpis;
  const x = data.series.map((r) => r.day);
  const col = (key) => data.series.map((r) => r[key]);
  const playSeconds = col('playMinutes').map((v) => (v == null ? null : v * 60));
  const playAxis = durationAxis(maxOf(playSeconds));

  return page(
    pageHead('Übersicht', periodText(data), rangeControl(ctx, { key: 'days', value: days, options: DAY_OPTIONS, max: ADMIN.days.max, unit: 'Tage' })),
    kpiRow(
      kpiTile({ label: 'Aktive heute', value: formatNumber(k.activeToday), sub: 'Spieler am heutigen UTC-Tag', spark: col('activePlayers') }),
      kpiTile({ label: 'Neue heute', value: formatNumber(k.newToday), sub: 'neue Spieler (inkl. gelöschter Gäste)', spark: col('newPlayers') }),
      kpiTile({ label: 'Registriert-Anteil', value: formatPercent(k.registeredShare), sub: `${formatNumber(k.registered)} von ${formatNumber(k.players)} aktiven Spielern` }),
      kpiTile({ label: 'Ø Session', value: formatDuration(k.avgSessionSeconds), sub: `aus ${formatNumber(k.sessionsMeasured)} Sessions mit Einwilligung` }),
      kpiTile({ label: 'Interstitials', value: formatNumber(k.interstitials), sub: `gezeigt ${decisionsPeriod(data, days)}`, spark: col('interstitials') }),
      kpiTile({
        label: 'Erinnerungen mit Signup',
        value: formatPercent(k.nudgeSignupRate),
        sub: `${formatNumber(k.nudgesWithSignup)} von ${formatNumber(k.nudgeSignupBase)} Erinnerungen, ${formatNumber(k.nudgeSignups)} Registrierungen`,
      }),
    ),
    grid(
      lines('Spieler pro Tag', 'Aktive, neue und registrierte Spieler', x, [
        { label: 'Aktive', values: col('activePlayers'), slot: 1 },
        { label: 'Neue', values: col('newPlayers'), slot: 2 },
        { label: 'Signups', values: col('signups'), slot: 3 },
      ]),
      lines('Runs pro Tag', 'Alle Runs inklusive gelöschter Gäste', x, [
        { label: 'Runs', values: col('runs'), slot: 1 },
      ]),
      lines('Spielzeit pro Tag', 'Flug und Slotmaschine, Summe aller Spieler', x, [
        { label: 'Spielzeit', values: playSeconds.map(playAxis.toUnit), slot: 1, format: playAxis.format },
      ], { integer: playAxis.integer, format: playAxis.format, tick: playAxis.tick }),
      lines('Werbung und Erinnerungen pro Tag', 'Gezeigte Interstitials, Erinnerungen und Verdopplungen', x, [
        { label: 'Interstitials', values: col('interstitials'), slot: 1 },
        { label: 'Erinnerungen', values: col('nudgesShown'), slot: 2 },
        { label: 'Verdopplungen', values: col('doubled'), slot: 3 },
      ]),
    ),
    notesCard(data.notes),
  );
}
