import { SEGMENT_LABELS } from '../../shared/segments.js';
import { dataTable, figure, heatmap, kpiTile, lineChart } from '../charts.js';
import { h, message } from '../dom.js';
import {
  DASH, KIND_LABELS, PLACEMENT_LABELS, SCREEN_LABELS, TYPE_LABELS, WEEKDAYS, WEEKDAYS_SHORT, countryName, deviceText, formatDate,
  formatDateTime, formatDuration, formatHourRange, formatNumber, formatPercent, formatShortDate, formatSince,
  formatTzOffset, outcomeLabel, placeText, playerName, reasonLabel,
} from '../format.js';
import { segmentChips } from './players.js';
import { grid, kpiRow, page } from './common.js';

const yesNo = (v) => (v ? 'ja' : 'nein');

function consentLine(c) {
  if (!c.decided) return 'Einwilligung: noch nicht entschieden';
  return `Einwilligung: Statistik ${yesNo(c.stats)}, Personal. ${yesNo(c.personal)}, 16+ ${yesNo(c.adult)}`;
}

function headline(d) {
  const { player: p, analytics: a } = d;
  const profile = a.profile;
  const session = a.sessions[0] ?? null;
  const country = profile?.country ?? session?.country ?? null;
  const region = profile ? profile.region : session?.region ?? null;
  const device = session ? deviceText(session) : profile?.device ? deviceText({ device: profile.device }) : null;
  return [
    `#${p.id}`,
    TYPE_LABELS[p.type] ?? p.type,
    formatSince(p.createdAt),
    a.allowed ? (country ? placeText(country, region) : 'Ort unbekannt') : null,
    a.allowed ? device ?? 'Gerät unbekannt' : null,
    consentLine(d.consent),
  ].filter(Boolean).join(' · ');
}

function confirmDelete(name, id) {
  return new Promise((resolve) => {
    const cancel = h('button', { type: 'button', class: 'btn', text: 'Abbrechen' });
    const ok = h('button', { type: 'button', class: 'btn btn-danger', text: 'Endgültig löschen' });
    const dialog = h('dialog', { class: 'dialog', 'aria-labelledby': 'del-title' },
      h('h2', { id: 'del-title', text: `${name} löschen?` }),
      h('p', { text: `Konto #${id} mit Spielstand, Runs, Sessions, Ereignissen und Profil wird sofort und endgültig gelöscht.` }),
      h('p', { text: 'Ins anonyme Archiv geht nur eine Zusammenfassung ohne Namen und ohne Benutzer-ID. Das kann nicht rückgängig gemacht werden.' }),
      h('div', { class: 'dialog-actions' }, cancel, ok));
    const done = (value) => {
      dialog.close();
      dialog.remove();
      resolve(value);
    };
    cancel.addEventListener('click', () => done(false));
    ok.addEventListener('click', () => done(true));
    dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      done(false);
    });
    document.body.append(dialog);
    dialog.showModal();
    cancel.focus();
  });
}

function runsSection(runs) {
  if (!runs.length) return h('section', { class: 'card' }, h('h2', { text: 'Runs' }), h('p', { class: 'empty', text: 'Noch keine Runs.' }));
  const chrono = [...runs].reverse();
  const x = chrono.map((r) => r.createdAt);
  const series = [{ label: 'Distanz (m)', values: chrono.map((r) => r.distance), slot: 1 }];
  const table = {
    columns: [
      { label: 'Zeit' }, { label: 'Session', num: true }, { label: 'Distanz', num: true }, { label: 'Score', num: true },
      { label: 'Münzen', num: true }, { label: 'Dauer', num: true }, { label: 'Multiplikator', num: true }, { label: 'Tunnel', num: true }, { label: 'Ursache' },
    ],
    rows: runs.map((r) => [
      formatDateTime(r.createdAt), formatNumber(r.sessionNo), `${formatNumber(r.distance)} m`, formatNumber(r.score), formatNumber(r.coins),
      formatDuration(r.durationS), `×${formatNumber(r.maxMultiplier, 1)}`, formatNumber(r.tunnels), r.cause || DASH,
    ]),
  };
  return h('div', { class: 'stack' },
    figure({
      title: 'Runs-Verlauf',
      subtitle: `Distanz der letzten ${runs.length} Runs, älteste links`,
      wide: true,
      chart: lineChart({ x, series, xLabel: (v) => formatShortDate(v), xTitle: (v) => formatDateTime(v), label: 'Distanz pro Run' }),
    }),
    h('section', { class: 'card' }, h('h2', { text: 'Runs' }), dataTable(table)));
}

function decisionsSection(decisions) {
  return h('section', { class: 'card' },
    h('h2', { text: 'Werbung & Erinnerungen' }),
    h('p', { class: 'sub', text: 'Entscheidungen mit Grund und Ergebnis (neueste zuerst). Übersprungene Interstitials nach dem Verdoppeln erscheinen nur gesamthaft, nie pro Spieler.' }),
    dataTable({
      columns: [
        { label: 'Zeit' }, { label: 'Session', num: true }, { label: 'Ort' }, { label: 'Art' }, { label: 'Gezeigt' },
        { label: 'Grund' }, { label: 'Personalisiert' }, { label: 'Ergebnis' },
      ],
      rows: decisions.map((d) => [
        formatDateTime(d.createdAt), formatNumber(d.sessionNo), PLACEMENT_LABELS[d.placement] ?? d.placement, KIND_LABELS[d.kind] ?? d.kind,
        yesNo(d.shown), reasonLabel(d.reason), yesNo(d.personalized),
        d.outcome ? `${outcomeLabel(d.outcome)} (${formatDateTime(d.outcomeAt)})` : DASH,
      ]),
      empty: 'Keine Entscheidungen gespeichert.',
    }));
}

function analyticsSection(a, consent) {
  if (!a.allowed) {
    return h('section', { class: 'card' },
      h('h2', { text: 'Statistik' }),
      message('Keine Statistik-Einwilligung: Profil, Sessions, Heatmap und Ereignisse werden für diesen Spieler nicht erfasst.', 'info'));
  }
  const p = a.profile;
  const parts = [];
  if (!p) {
    parts.push(h('section', { class: 'card' }, h('h2', { text: 'Profil' }),
      message('Noch kein Profil berechnet. «Neu berechnen» erstellt es sofort.', 'info')));
  } else {
    const m = p.metrics ?? {};
    const fav = p.favWeekday != null && p.favHour != null
      ? `${WEEKDAYS[p.favWeekday]}, ${formatHourRange(p.favHour, (p.favHour + 1) % 24)}`
      : DASH;
    parts.push(
      h('section', { class: 'card' },
        h('h2', { text: 'Segmente' }),
        h('p', { class: 'sub', text: `Profil berechnet am ${formatDateTime(p.computedAt)}${consent.statsAt ? `, Daten ab ${formatDate(consent.statsAt)}` : ''}` }),
        segmentChips(p.segments)),
      kpiRow(
        kpiTile({ label: 'Engagement', value: formatNumber(p.engagement), sub: 'Score 0 bis 100' }),
        kpiTile({ label: 'Abwanderungsrisiko', value: formatNumber(p.churnRisk, 2), sub: p.churnRisk == null ? 'erst ab 2 Sessions' : 'Wert 0 bis 1' }),
        kpiTile({ label: 'Werbetoleranz', value: formatNumber(p.adTolerance, 2), sub: 'Wert 0 bis 1' }),
        kpiTile({ label: 'Lieblingszeit', value: fav, sub: `Tageszeit: ${SEGMENT_LABELS[p.daypart] ?? DASH} (Ortszeit)` }),
        kpiTile({ label: 'Wochenende', value: formatPercent(p.weekendShare), sub: 'Anteil der Spielzeit' }),
        kpiTile({ label: 'Letzte 30 Tage', value: formatDuration(p.playSeconds30d), sub: `${formatNumber(p.activeDays30d)} aktive Tage, ${formatNumber(p.sessions90d)} Sessions in 90 Tagen` }),
      ),
      grid(
        p.heatmap
          ? figure({
            title: 'Spielzeit nach Wochentag und Stunde',
            subtitle: `Ortszeit des Spielers (${formatTzOffset(a.tzOffsetMin)}), Montag zuerst`,
            chart: heatmap({ grid: p.heatmap, format: formatDuration, rowLabels: WEEKDAYS_SHORT, rowTitles: WEEKDAYS, label: 'Spielzeit des Spielers' }),
            table: () => ({
              columns: [{ label: 'Wochentag' }, ...Array.from({ length: 24 }, (_, i) => ({ label: String(i), num: true }))],
              rows: p.heatmap.map((row, d) => [WEEKDAYS[d], ...row.map((v) => formatDuration(v))]),
            }),
          })
          : null,
        h('section', { class: 'card' },
          h('h2', { text: 'Kennzahlen' }),
          h('dl', { class: 'facts' },
            fact('Sessions im Fenster', formatNumber(m.sessions?.count)),
            fact('Ø Sessiondauer', formatDuration(m.sessions?.avgS)),
            fact('Median Sessiondauer', formatDuration(m.sessions?.medianS)),
            fact('Übliche Pause', m.sessions?.usualGapH == null ? DASH : `${formatNumber(m.sessions.usualGapH, 1)} h`),
            fact('Konsistenz', formatNumber(m.consistency, 2)),
            fact('Ø Distanz', m.gameplay?.avgDistance == null ? DASH : `${formatNumber(m.gameplay.avgDistance)} m`),
            fact('Häufigste Crash-Ursache', m.gameplay?.topCause || DASH),
            fact('Land', p.country ? `${countryName(p.country)}${p.region ? ` (${p.region})` : ''}` : DASH),
            fact('Akquise', [m.acquisition?.referrer, m.acquisition?.utmSource].filter(Boolean).join(' / ') || DASH))),
      ),
    );
  }
  parts.push(h('section', { class: 'card' },
    h('h2', { text: 'Sessions' }),
    dataTable({
      columns: [
        { label: 'Nr.', num: true }, { label: 'Start' }, { label: 'Dauer', num: true }, { label: 'Gerät' },
        { label: 'Ort' }, { label: 'Bildschirm' }, { label: 'Zeitzone' }, { label: 'Herkunft' },
      ],
      rows: a.sessions.map((se) => [
        formatNumber(se.sessionNo), formatDateTime(se.startedAt), formatDuration(se.durationS), deviceText(se),
        se.country ? placeText(se.country, se.region) : DASH, SCREEN_LABELS[se.screen] ?? se.screen ?? DASH, se.timeZone ?? formatTzOffset(se.tzOffsetMin),
        [se.referrer, se.utm?.source, se.utm?.medium, se.utm?.campaign].filter(Boolean).join(' / ') || DASH,
      ]),
      empty: 'Keine Sessions gespeichert.',
    })));
  if (a.events?.length) {
    parts.push(h('section', { class: 'card' },
      h('h2', { text: 'Ereignisse' }),
      h('p', { class: 'sub', text: 'Ohne Werbe- und Slotmaschinen-Ereignisse: diese erscheinen nur gesamthaft.' }),
      dataTable({
        columns: [{ label: 'Zeit' }, { label: 'Name' }, { label: 'Daten' }],
        rows: a.events.map((e) => [formatDateTime(e.createdAt), e.name, e.data ? JSON.stringify(e.data) : DASH]),
      })));
  }
  return h('div', { class: 'stack' }, parts);
}

function fact(label, value) {
  return [h('dt', { text: label }), h('dd', { text: value })];
}

export async function render(ctx) {
  const id = ctx.params.id;
  const d = await ctx.api.player(id);
  const name = playerName(d.player);
  const status = h('div', { class: 'action-status', 'aria-live': 'polite' });
  const say = (text, kind) => status.replaceChildren(message(text, kind));

  const recompute = h('button', { type: 'button', class: 'btn', text: 'Neu berechnen' });
  recompute.addEventListener('click', async () => {
    recompute.disabled = true;
    try {
      await ctx.api.recompute(id);
      if (!ctx.isCurrent()) return;
      ctx.flash('Profil neu berechnet.');
      ctx.refresh();
    } catch (e) {
      if (e.status === 401 || !ctx.isCurrent()) return;
      recompute.disabled = false;
      if (e.status === 409) say('Neu berechnen nicht möglich: Keine Statistik-Einwilligung.', 'info');
      else say(e.message, 'error');
    }
  });

  const remove = h('button', { type: 'button', class: 'btn btn-danger', text: 'Spieler löschen' });
  remove.addEventListener('click', async () => {
    if (!(await confirmDelete(name, d.player.id)) || !ctx.isCurrent()) return;
    remove.disabled = true;
    try {
      await ctx.api.deletePlayer(id);
      if (!ctx.isCurrent()) return;
      ctx.flash(`${name} wurde gelöscht.`, 'players');
      ctx.navigate('players');
    } catch (e) {
      if (e.status === 401 || !ctx.isCurrent()) return;
      remove.disabled = false;
      if (e.status === 403) say('Löschen nicht möglich: Admin-Konten und das eigene Konto können hier nicht gelöscht werden.', 'error');
      else if (e.status === 404) say('Spieler nicht gefunden, wurde er bereits gelöscht?', 'error');
      else say(e.message, 'error');
    }
  });

  const g = d.game;
  return page(
    h('a', { class: 'back', href: '#/players', text: '‹ Alle Spieler' }),
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', { text: name }), h('p', { class: 'sub', text: headline(d) })),
      h('div', { class: 'actions' }, recompute, remove)),
    status,
    kpiRow(
      kpiTile({ label: 'Münzen', value: formatNumber(g.coins) }),
      kpiTile({ label: 'Highscore', value: formatNumber(g.highscore), sub: `beste Distanz ${formatNumber(g.bestDistance)} m` }),
      kpiTile({ label: 'Runs', value: formatNumber(g.totalRuns), sub: `letzter ${formatDateTime(d.player.lastRunAt)}` }),
      kpiTile({ label: 'Spielzeit', value: formatDuration(g.playTime.total), sub: 'Flug und Slotmaschine' }),
      kpiTile({ label: 'Zuletzt aktiv', value: formatDateTime(d.player.lastSeenAt), sub: `Session ${formatNumber(d.player.sessionNo)} seit ${formatDateTime(d.player.sessionStartedAt)}` }),
      kpiTile({ label: 'Konto', value: formatDate(d.player.createdAt), sub: d.player.registeredAt ? `registriert ${formatDate(d.player.registeredAt)}` : 'nicht registriert' }),
    ),
    analyticsSection(d.analytics, d.consent),
    runsSection(d.runs),
    decisionsSection(d.decisions),
  );
}
