import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DASH, audienceLabel, clampInt, consentText, durationAxis, formatDateTime, formatDay, formatDayFull, formatDayLong, formatDuration, formatHours,
  formatNumber, formatPercent, formatSessionBin, formatSince, formatTzOffset, pageRange, playerName, reasonLabel,
} from '../../src/admin/format.js';
import { labelEvery, levelOf, maxOf, niceStep, niceTicks, scaleLinear, segmentsOf, stepDigits, tickLabels } from '../../src/admin/charts.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const ADMIN_DIR = join(ROOT, 'src', 'admin');

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

const IMPORT = /(?:\bimport\s+(?:[^'"]*?\s+from\s+)?|\bimport\s*\(\s*|\bexport\s+[^'"]*?\s+from\s+)['"]([^'"]+)['"]/g;

function importsOf(path) {
  return [...readFileSync(path, 'utf8').matchAll(IMPORT)].map((m) => m[1]);
}

test('Zahlen, Prozente und Dauer im Schweizer Format', () => {
  const group = new Intl.NumberFormat('de-CH').formatToParts(1000).find((p) => p.type === 'group').value;
  assert.match(group, /^['’]$/);
  assert.equal(formatNumber(1234567), `1${group}234${group}567`);
  assert.equal(formatNumber(12.345, 1), '12.3');
  assert.equal(formatNumber(null), DASH);
  assert.equal(formatNumber(undefined), DASH);
  assert.equal(formatNumber('abc'), DASH);
  assert.equal(formatPercent(0.125), '12.5%');
  assert.equal(formatPercent(0.5, 0), '50%');
  assert.equal(formatPercent(null), DASH);
  assert.equal(formatDuration(400), '6:40');
  assert.equal(formatDuration(59.6), '1:00');
  assert.equal(formatDuration(3725), '1:02:05');
  assert.equal(formatDuration(-5), '0:00');
  assert.equal(formatDuration(null), DASH);
  assert.equal(formatHours(5400), '1.5 h');
});

test('Datum: Tagesreihen als UTC-Tage, Zeitpunkte in Ortszeit', () => {
  assert.equal(formatDay('2026-11-07'), '07.11.');
  assert.equal(formatDayLong('2026-11-07'), 'Sa., 07.11.2026');
  assert.equal(formatDayFull('2025-11-18'), '18.11.2025');
  assert.equal(formatDayFull('2026-01-01'), '01.01.2026');
  assert.equal(formatDayFull(null), DASH);
  assert.equal(formatDay('kein Datum'), DASH);
  assert.equal(formatDateTime('2026-11-17T08:05:00.000Z', { timeZone: 'UTC' }), '17.11.2026, 08:05');
  assert.equal(formatDateTime('2026-11-17T08:05:00.000Z', { timeZone: 'Europe/Zurich' }), '17.11.2026, 09:05');
  assert.equal(formatDateTime(null), DASH);
  const now = Date.parse('2026-11-17T12:00:00Z');
  assert.equal(formatSince('2026-11-17T11:59:30Z', now), 'seit eben');
  assert.equal(formatSince('2026-11-17T11:59:00Z', now), 'seit 1 Minute');
  assert.equal(formatSince('2026-11-17T09:00:00Z', now), 'seit 3 Stunden');
  assert.equal(formatSince('2026-11-16T11:00:00Z', now), 'seit 1 Tag');
  assert.equal(formatSince('2026-11-14T12:00:00Z', now), 'seit 3 Tagen');
  assert.equal(formatTzOffset(120), 'UTC+2');
  assert.equal(formatTzOffset(-330), 'UTC−5:30');
  assert.equal(formatTzOffset(null), DASH);
});

test('Beschriftungen für Spieler, Publikum und Gründe', () => {
  assert.equal(playerName({ id: 42, username: null }), 'Gast #42');
  assert.equal(playerName({ id: 7, username: 'anna' }), 'anna');
  assert.equal(consentText({ decided: false }), 'Noch nicht entschieden');
  assert.equal(consentText({ decided: true, stats: true, personal: false }), 'Statistik ja, Personal. nein');
  assert.equal(audienceLabel('countries', { value: null, label: 'Andere', players: 9, other: true }), 'Andere (kleine Gruppen)');
  assert.equal(audienceLabel('devices', { value: null, label: 'Unbekannt', players: 6 }), 'Unbekannt');
  assert.equal(audienceLabel('countries', { value: 'CH', players: 6 }), 'Schweiz (CH)');
  assert.equal(audienceLabel('regions', { value: 'GR', players: 6 }), 'Graubünden (GR)');
  assert.equal(audienceLabel('devices', { value: 'mobile', players: 6 }), 'Mobil');
  assert.equal(audienceLabel('screens', { value: 'l', players: 6 }), 'Gross (ab 1200 px)');
  assert.equal(audienceLabel('os', { value: 'other', players: 6 }), 'Anderes System');
  assert.equal(audienceLabel('referrers', { value: 'example.ch', players: 6 }), 'example.ch');
  assert.equal(formatSessionBin({ from: 60, to: 180 }), '1–3 min');
  assert.equal(formatSessionBin({ from: 3600, to: null }), 'ab 60 min');
  const source = readFileSync(join(ROOT, 'src', 'shared', 'engagement.js'), 'utf8');
  const reasons = new Set([...source.matchAll(/(?:reason: |return |\? )'([a-z_]+)'/g)].map((m) => m[1]));
  assert.ok(reasons.size >= 15);
  for (const reason of reasons) assert.notEqual(reasonLabel(reason), reason, `Label fehlt für ${reason}`);
  assert.equal(clampInt('30', 7, 1, 365), 30);
  assert.equal(clampInt('999', 7, 1, 365), 365);
  assert.equal(clampInt('x', 7, 1, 365), 7);
  assert.deepEqual(pageRange(1, 120, 50), { current: 1, pages: 3, from: 1, to: 50 });
  assert.deepEqual(pageRange(3, 120, 50), { current: 3, pages: 3, from: 101, to: 120 });
  assert.deepEqual(pageRange(5, 50, 50), { current: 1, pages: 1, from: 1, to: 50 });
  assert.deepEqual(pageRange(9, 120, 50), { current: 3, pages: 3, from: 101, to: 120 });
  assert.deepEqual(pageRange(4, 0, 50), { current: 1, pages: 1, from: 0, to: 0 });
  assert.deepEqual(pageRange(0, 10, 50), { current: 1, pages: 1, from: 1, to: 10 });
});

test('Skalen, Ticks und Farbstufen der Diagramme', () => {
  assert.equal(niceStep(21.75), 25);
  assert.equal(niceStep(0.3), 0.5);
  assert.deepEqual(niceTicks(87), [0, 25, 50, 75, 100]);
  assert.deepEqual(niceTicks(0, { integer: true }), [0, 1]);
  assert.deepEqual(niceTicks(3, { integer: true }), [0, 1, 2, 3]);
  assert.deepEqual(niceTicks(1), [0, 0.25, 0.5, 0.75, 1]);
  assert.equal(stepDigits(25), 0);
  assert.equal(stepDigits(2.5), 1);
  assert.equal(stepDigits(0.25), 2);
  assert.equal(stepDigits(0.025), 3);
  const plain = (v, d) => formatNumber(v, d);
  assert.deepEqual(tickLabels(niceTicks(1), plain), ['0', '0.25', '0.5', '0.75', '1']);
  assert.deepEqual(tickLabels(niceTicks(0.15), plain), ['0', '0.05', '0.1', '0.15']);
  assert.deepEqual(tickLabels(niceTicks(0.04), plain), ['0', '0.01', '0.02', '0.03', '0.04']);
  assert.deepEqual(tickLabels(niceTicks(87), plain), ['0', '25', '50', '75', '100']);
  for (const max of [0, 0.025, 0.04, 0.15, 0.9, 1, 3.3, 47, 1234]) {
    const labels = tickLabels(niceTicks(max), plain);
    assert.equal(new Set(labels).size, labels.length, `doppelte Ticks bei ${max}`);
  }
  const hours = durationAxis(5400);
  assert.equal(hours.unit, 'h');
  assert.equal(hours.toUnit(5400), 1.5);
  assert.equal(hours.format(1.5), '1:30:00');
  assert.equal(hours.tick(0.25, 2), '0.25 h');
  const minutes = durationAxis(90);
  assert.equal(minutes.unit, 'min');
  assert.equal(minutes.format(minutes.toUnit(90)), '1:30');
  assert.equal(minutes.toUnit(null), null);
  assert.equal(minutes.format(null), DASH);
  const seconds = durationAxis(30);
  assert.deepEqual([seconds.unit, seconds.integer, seconds.format(30)], ['s', true, '0:30']);
  assert.equal(durationAxis(0).unit, 's');
  const y = scaleLinear([0, 100], [200, 0]);
  assert.equal(y(0), 200);
  assert.equal(y(25), 150);
  assert.equal(maxOf([1, null, 7, undefined, 3]), 7);
  assert.equal(levelOf(0, 10), 0);
  assert.equal(levelOf(null, 10), 0);
  assert.equal(levelOf(0.1, 10), 1);
  assert.equal(levelOf(10, 10), 6);
  assert.equal(levelOf(5, 0), 0);
  assert.equal(labelEvery(30, 600, 60), 3);
  assert.equal(labelEvery(7, 600, 60), 1);
  assert.deepEqual(segmentsOf([1, null, 2, 3, null]), [[[0, 1]], [[2, 2], [3, 3]]]);
});

test('Admin importiert nur eigene Dateien, economy.js, segments.js und Schriften', () => {
  const allowed = new Set([join(ROOT, 'src', 'shared', 'economy.js'), join(ROOT, 'src', 'shared', 'segments.js')]);
  const list = files(ADMIN_DIR).filter((f) => f.endsWith('.js') || f.endsWith('.css'));
  assert.ok(list.some((f) => f.endsWith(`${sep}main.js`)));
  for (const file of list) {
    const text = readFileSync(file, 'utf8');
    const name = relative(ROOT, file);
    assert.doesNotMatch(text, /innerHTML|outerHTML|insertAdjacentHTML/, `${name} setzt HTML`);
    assert.doesNotMatch(text, /wingrush\.token|localStorage/, `${name} nutzt den Spiel-Token`);
    assert.doesNotMatch(text, /@import\s+url|fonts\.googleapis|cdn\./i, `${name} lädt externe Ressourcen`);
    for (const spec of importsOf(file)) {
      if (!spec.startsWith('.')) {
        assert.match(spec, /^@fontsource\/(rubik|lilita-one)\//, `${name}: Paket ${spec} nicht erlaubt`);
        continue;
      }
      const target = resolve(dirname(file), spec);
      assert.ok(!target.startsWith(join(ROOT, 'src', 'api')), `${name} importiert ${spec}`);
      assert.ok(!target.endsWith(`${sep}style.css`), `${name} importiert ${spec}`);
      assert.ok(target.startsWith(ADMIN_DIR + sep) || allowed.has(target), `${name} importiert ${spec}`);
    }
  }
  const html = readFileSync(join(ROOT, 'admin.html'), 'utf8');
  assert.match(html, /<meta name="robots" content="noindex, nofollow"/);
  assert.match(html, /<html lang="de-CH">/);
  assert.match(html, /src="\/src\/admin\/main\.js"/);
  assert.doesNotMatch(html, /https?:\/\//);
});

test('Vite baut das Admin nur ausserhalb des Single-Builds', () => {
  const config = readFileSync(join(ROOT, 'vite.config.js'), 'utf8');
  assert.match(config, /mode === 'single'/);
  assert.match(config, /admin: fileURLToPath\(new URL\('\.\/admin\.html', import\.meta\.url\)\)/);
  const single = config.indexOf('viteSingleFile()');
  const admin = config.indexOf('admin.html');
  const branch = config.indexOf('} else {');
  assert.ok(single < branch && branch < admin);
});
