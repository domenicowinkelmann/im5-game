import { h, note } from '../dom.js';
import { clampInt, formatDay, formatDayFull, formatNumber } from '../format.js';

export const DAY_OPTIONS = [7, 30, 90, 180, 365];
export const WEEK_OPTIONS = [4, 8, 12, 26, 52];

export function readRange(ctx, key, fallback, max) {
  return clampInt(ctx.query.get(key) ?? fallback, fallback, 1, max);
}

export function rangeControl(ctx, { key, value, options, max, unit }) {
  const list = [...new Set([...options.filter((o) => o <= max), value])].sort((a, b) => a - b);
  return h('div', { class: 'range', role: 'group', 'aria-label': 'Zeitraum' },
    h('span', { class: 'range-label', text: 'Zeitraum' }),
    list.map((o) => h('button', {
      type: 'button',
      class: 'chip',
      'aria-pressed': String(o === value),
      text: `${o} ${unit}`,
      onclick: () => ctx.setQuery({ [key]: o }),
    })));
}

export function pageHead(title, sub, controls = null) {
  return h('div', { class: 'page-head' },
    h('div', {}, h('h1', { text: title }), sub ? h('p', { class: 'sub', text: sub }) : null),
    controls);
}

export const periodText = (data) => `${formatDayFull(data.from)} bis ${formatDayFull(data.to)} (Tage in UTC)`;

export const decisionsPeriod = (data, days) => (data.decisionsFrom > data.from
  ? `seit ${formatDayFull(data.decisionsFrom)}`
  : `in ${days} Tagen`);

export function seriesTable(days, series, formatDayFn = formatDay) {
  return {
    columns: [{ label: 'Tag' }, ...series.map((se) => ({ label: se.label, num: true }))],
    rows: days.map((day, i) => [formatDayFn(day), ...series.map((se) => (se.values[i] == null ? null : (se.format ?? formatNumber)(se.values[i])))]),
  };
}

export function notesCard(notes, title = 'Hinweise') {
  const list = (Array.isArray(notes) ? notes : [notes]).filter(Boolean);
  if (!list.length) return null;
  return h('section', { class: 'card notes-card' }, h('h2', { text: title }), note(list));
}

export const grid = (...children) => h('div', { class: 'grid' }, ...children);
export const kpiRow = (...children) => h('div', { class: 'kpis' }, ...children);
export const page = (...children) => h('div', { class: 'page' }, ...children);
