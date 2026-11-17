import { ADMIN } from '../../shared/economy.js';
import { SEGMENT_LABELS } from '../../shared/segments.js';
import { h } from '../dom.js';
import {
  CONSENT_FILTERS, DASH, TYPE_LABELS, clampInt, consentText, formatDateTime, formatDuration, formatNumber, pageRange, playerName,
} from '../format.js';
import { page, pageHead } from './common.js';

const SORTS = ['id', 'username', 'created', 'lastSeen', 'runs', 'coins', 'playTime', 'engagement'];

const COLUMNS = [
  { key: 'id', label: 'ID', num: true },
  { key: 'username', label: 'Name' },
  { label: 'Typ' },
  { label: 'Einwilligung' },
  { key: 'created', label: 'Erstellt' },
  { key: 'lastSeen', label: 'Zuletzt aktiv' },
  { key: 'runs', label: 'Runs', num: true },
  { key: 'coins', label: 'Münzen', num: true },
  { key: 'playTime', label: 'Spielzeit', num: true },
  { key: 'engagement', label: 'Engagement', num: true },
  { label: 'Segmente' },
];

const pick = (value, options) => (options.includes(value) ? value : '');

function readFilters(query) {
  return {
    q: (query.get('q') ?? '').slice(0, ADMIN.maxQuery),
    type: pick(query.get('type'), Object.keys(TYPE_LABELS)),
    consent: pick(query.get('consent'), Object.keys(CONSENT_FILTERS)),
    segment: pick(query.get('segment'), Object.keys(SEGMENT_LABELS)),
    sort: pick(query.get('sort'), SORTS) || 'lastSeen',
    dir: query.get('dir') === 'asc' ? 'asc' : 'desc',
    page: clampInt(query.get('page') ?? 1, 1, 1, ADMIN.maxPage),
  };
}

function select(id, label, value, options, onChange) {
  const el = h('select', { id, name: id },
    h('option', { value: '', text: 'Alle' }),
    Object.entries(options).map(([k, v]) => h('option', { value: k, text: v, selected: k === value })));
  el.addEventListener('change', () => onChange(el.value));
  return h('div', { class: 'field' }, h('label', { for: id, text: label }), el);
}

export function segmentChips(list) {
  if (!list?.length) return DASH;
  return h('span', { class: 'chips' }, list.map((sg) => h('span', { class: 'chip-static', text: SEGMENT_LABELS[sg] ?? sg })));
}

export async function render(ctx) {
  const f = readFilters(ctx.query);
  const data = await ctx.api.players({ ...f, sort: f.sort, dir: f.dir, page: f.page });
  const update = (changes) => ctx.setQuery({ ...changes, page: changes.page ?? null });
  if (data.page !== f.page) ctx.replaceQuery({ page: data.page > 1 ? data.page : null });

  const search = h('input', { id: 'f-q', type: 'search', name: 'q', value: f.q, maxlength: ADMIN.maxQuery, placeholder: 'Name oder ID' });
  const form = h('form', { class: 'filters', role: 'search' },
    h('div', { class: 'field field-grow' }, h('label', { for: 'f-q', text: 'Suche' }), search),
    select('f-type', 'Typ', f.type, TYPE_LABELS, (v) => update({ type: v })),
    select('f-consent', 'Einwilligung', f.consent, CONSENT_FILTERS, (v) => update({ consent: v })),
    select('f-segment', 'Segment', f.segment, SEGMENT_LABELS, (v) => update({ segment: v })),
    h('button', { type: 'submit', class: 'btn', text: 'Suchen' }));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    update({ q: search.value.trim() });
  });

  const head = h('tr', {}, COLUMNS.map((c) => {
    if (!c.key) return h('th', { scope: 'col', class: c.num ? 'num' : null, text: c.label });
    const active = f.sort === c.key;
    const nextDir = active && f.dir === 'desc' ? 'asc' : 'desc';
    return h('th', {
      scope: 'col',
      class: c.num ? 'num' : null,
      'aria-sort': active ? (f.dir === 'asc' ? 'ascending' : 'descending') : null,
    }, h('button', {
      type: 'button',
      class: `sort${active ? ' active' : ''}`,
      onclick: () => update({ sort: c.key, dir: nextDir }),
    }, c.label, h('span', { class: 'sort-mark', 'aria-hidden': 'true', text: active ? (f.dir === 'asc' ? '▲' : '▼') : '↕' })));
  }));

  const rows = data.players.map((p) => h('tr', {},
    h('td', { class: 'num' }, h('a', { href: `#/players/${p.id}`, text: String(p.id) })),
    h('th', { scope: 'row' }, h('a', { href: `#/players/${p.id}`, text: playerName(p) })),
    h('td', { text: TYPE_LABELS[p.type] ?? p.type }),
    h('td', { text: consentText(p.consent) }),
    h('td', { text: formatDateTime(p.createdAt) }),
    h('td', { text: formatDateTime(p.lastSeenAt) }),
    h('td', { class: 'num', text: formatNumber(p.runs) }),
    h('td', { class: 'num', text: formatNumber(p.coins) }),
    h('td', { class: 'num', text: formatDuration(p.playSeconds) }),
    h('td', { class: 'num', text: formatNumber(p.engagement) }),
    h('td', {}, segmentChips(p.segments))));

  const { current, pages, from, to } = pageRange(data.page, data.total, data.pageSize);
  const pager = h('nav', { class: 'pager', 'aria-label': 'Seiten' },
    h('button', { type: 'button', class: 'btn btn-small', disabled: current <= 1, text: '‹ Zurück', onclick: () => update({ page: current - 1 }) }),
    h('span', { text: `${formatNumber(from)}–${formatNumber(to)} von ${formatNumber(data.total)} · Seite ${formatNumber(current)} von ${formatNumber(pages)}` }),
    h('button', { type: 'button', class: 'btn btn-small', disabled: current >= pages, text: 'Weiter ›', onclick: () => update({ page: current + 1 }) }));

  return page(
    pageHead('Spieler', `${formatNumber(data.total)} Treffer`),
    h('section', { class: 'card' },
      form,
      data.players.length
        ? h('div', { class: 'table-wrap' }, h('table', { class: 'data players' }, h('thead', {}, head), h('tbody', {}, rows)))
        : h('p', { class: 'empty', text: 'Keine Spieler gefunden.' }),
      pager),
  );
}
