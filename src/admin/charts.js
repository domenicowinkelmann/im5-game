import { h, s, note } from './dom.js';
import { formatNumber, formatDay, formatDayLong, formatPercent, DASH } from './format.js';

export const LEVELS = 6;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const round6 = (v) => Math.round(v * 1e6) / 1e6;

export function niceStep(raw) {
  if (!(raw > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  const m = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return round6(m * p);
}

export function niceTicks(max, { count = 4, integer = false } = {}) {
  const top = isNum(max) && max > 0 ? max : 1;
  let step = niceStep(top / count);
  if (integer) step = Math.max(1, Math.round(step));
  const n = Math.max(1, Math.ceil(round6(top / step)));
  return Array.from({ length: n + 1 }, (_, i) => round6(i * step));
}

export function stepDigits(step) {
  const text = String(round6(step));
  const dot = text.indexOf('.');
  return dot < 0 ? 0 : text.length - dot - 1;
}

export function tickLabels(ticks, tick) {
  const digits = stepDigits(ticks.length > 1 ? ticks[1] - ticks[0] : 1);
  return ticks.map((t) => tick(t, digits));
}

export function scaleLinear([d0, d1], [r0, r1]) {
  const span = d1 - d0 || 1;
  return (v) => r0 + ((v - d0) / span) * (r1 - r0);
}

export function maxOf(values) {
  let max = 0;
  for (const v of values) if (isNum(v) && v > max) max = v;
  return max;
}

export function levelOf(value, max, steps = LEVELS) {
  if (!isNum(value) || value <= 0 || !isNum(max) || max <= 0) return 0;
  return Math.min(steps, Math.floor((value / max) * steps) + 1);
}

export function labelEvery(count, width, minGap = 56) {
  if (count <= 1 || width <= 0) return 1;
  return Math.max(1, Math.ceil((count * minGap) / width));
}

export function segmentsOf(values) {
  const out = [];
  let current = null;
  values.forEach((v, i) => {
    if (isNum(v)) {
      if (!current) out.push((current = []));
      current.push([i, v]);
    } else {
      current = null;
    }
  });
  return out;
}

export const seriesColor = (slot) => `var(--series-${slot})`;

let tip = null;

function tipEl() {
  if (!tip) {
    tip = h('div', { class: 'tip', role: 'tooltip', hidden: true });
    document.body.append(tip);
    window.addEventListener('scroll', hideTip, { passive: true });
  }
  return tip;
}

export function showTip(x, y, title, rows = []) {
  const el = tipEl();
  el.replaceChildren(
    title ? h('div', { class: 'tip-title', text: title }) : null,
    ...rows.map((r) => h('div', { class: 'tip-row' },
      r.color ? h('span', { class: `key key-${r.mark ?? 'line'}`, style: { background: r.color } }) : null,
      h('strong', { text: r.value }),
      r.label ? h('span', { class: 'tip-label', text: r.label }) : null)),
  );
  el.hidden = false;
  const rect = el.getBoundingClientRect();
  let left = x + 14;
  if (left + rect.width > window.innerWidth - 8) left = x - rect.width - 14;
  let top = y + 14;
  if (top + rect.height > window.innerHeight - 8) top = y - rect.height - 14;
  el.style.left = `${Math.max(8, left)}px`;
  el.style.top = `${Math.max(8, top)}px`;
}

export function hideTip() {
  if (tip) tip.hidden = true;
}

export function bindTip(el, content) {
  const at = (x, y) => {
    const c = content();
    showTip(x, y, c.title, c.rows);
  };
  el.addEventListener('pointermove', (e) => at(e.clientX, e.clientY));
  el.addEventListener('pointerleave', hideTip);
  el.addEventListener('focus', () => {
    const r = el.getBoundingClientRect();
    at(r.left + r.width / 2, r.top + r.height / 2);
  });
  el.addEventListener('blur', hideTip);
}

function responsive(draw, className = 'chart-box') {
  const box = h('div', { class: className });
  let last = 0;
  const ro = new ResizeObserver((entries) => {
    if (!box.isConnected) {
      ro.disconnect();
      return;
    }
    const w = Math.floor(entries[0].contentRect.width);
    if (w <= 0 || w === last) return;
    last = w;
    box.replaceChildren(draw(w));
  });
  ro.observe(box);
  return box;
}

const textWidth = (text, px = 6.6) => String(text).length * px;

function roundedTop(x, y, w, hgt, r = 4) {
  const rr = Math.max(0, Math.min(r, w / 2, hgt));
  return `M${x},${y + hgt}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + hgt}Z`;
}

function yAxis(g, ticks, labels, y, left, right) {
  ticks.forEach((t, i) => {
    g.append(
      s('line', { class: t === 0 ? 'axis' : 'gridline', x1: left, x2: right, y1: y(t), y2: y(t) }),
      s('text', { class: 'tick', x: left - 6, y: y(t), 'text-anchor': 'end', 'dominant-baseline': 'middle', text: labels[i] }),
    );
  });
}

export function legend(items, mark = 'line') {
  if (items.length < 2) return null;
  return h('ul', { class: 'legend', 'aria-label': 'Legende' }, items.map((it) => h('li', {},
    h('span', { class: `key key-${mark}`, style: { background: seriesColor(it.slot) } }),
    h('span', { text: it.label }))));
}

export function lineChart({ x, series, format = (v, d) => formatNumber(v, d), tick = format, xLabel = formatDay, xTitle = formatDayLong, height = 220, integer = true, label }) {
  const draw = (W) => {
    const ticks = niceTicks(maxOf(series.flatMap((se) => se.values)), { integer });
    const labels = tickLabels(ticks, tick);
    const top = ticks[ticks.length - 1];
    const m = { t: 14, r: 18, b: 26, l: Math.max(28, ...labels.map((t) => textWidth(t))) + 10 };
    const pw = W - m.l - m.r;
    const ph = height - m.t - m.b;
    const n = x.length;
    const xs = (i) => m.l + (n > 1 ? (i * pw) / (n - 1) : pw / 2);
    const ys = scaleLinear([0, top], [m.t + ph, m.t]);
    const svg = s('svg', { class: 'chart', width: W, height, viewBox: `0 0 ${W} ${height}`, role: 'img', 'aria-label': label ?? series.map((se) => se.label).join(', ') });
    const g = s('g');
    yAxis(g, ticks, labels, ys, m.l, W - m.r);
    const k = labelEvery(n, pw, Math.max(48, textWidth(xLabel(x[0])) + 16));
    let previous = null;
    for (let i = n - 1; i >= 0; i -= k) {
      const text = xLabel(x[i]);
      if (text === previous) continue;
      previous = text;
      const anchor = n > 1 && i === 0 ? 'start' : i === n - 1 && n > 1 ? 'end' : 'middle';
      g.append(s('text', { class: 'tick', x: xs(i), y: height - 8, 'text-anchor': anchor, text }));
    }
    const single = series.length === 1;
    for (const se of series) {
      const color = seriesColor(se.slot);
      for (const seg of segmentsOf(se.values)) {
        const pts = seg.map(([i, v]) => [xs(i), ys(v)]);
        if (pts.length === 1) {
          g.append(s('circle', { class: 'point', cx: pts[0][0], cy: pts[0][1], r: 3, style: { fill: color } }));
          continue;
        }
        const d = pts.map(([px, py], j) => `${j ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join('');
        if (single) {
          const base = ys(0).toFixed(1);
          g.append(s('path', { class: 'area', d: `${d}L${pts[pts.length - 1][0].toFixed(1)},${base}L${pts[0][0].toFixed(1)},${base}Z`, style: { fill: color } }));
        }
        g.append(s('path', { class: 'line', d, style: { stroke: color } }));
      }
    }
    if (single) {
      const se = series[0];
      const lastIdx = se.values.findLastIndex(isNum);
      if (lastIdx >= 0) {
        const cx = xs(lastIdx);
        const cy = ys(se.values[lastIdx]);
        g.append(
          s('circle', { class: 'dot', cx, cy, r: 4, style: { fill: seriesColor(se.slot) } }),
          s('text', { class: 'end-label', x: cx - 6, y: cy - 10, 'text-anchor': 'end', text: format(se.values[lastIdx]) }),
        );
      }
    }
    const cross = s('line', { class: 'crosshair', y1: m.t, y2: m.t + ph, visibility: 'hidden' });
    const dots = s('g', { visibility: 'hidden' });
    const overlay = s('rect', {
      class: 'overlay', x: m.l - 8, y: 0, width: pw + 16, height, tabindex: 0,
      'aria-label': `${label ?? 'Verlauf'}: mit Pfeiltasten Tage durchgehen`,
    });
    let current = n - 1;
    const show = (i, cx, cy) => {
      current = Math.max(0, Math.min(n - 1, i));
      const px = xs(current);
      cross.setAttribute('x1', px);
      cross.setAttribute('x2', px);
      cross.setAttribute('visibility', 'visible');
      dots.replaceChildren(...series.filter((se) => isNum(se.values[current])).map((se) => s('circle', {
        class: 'dot', cx: px, cy: ys(se.values[current]), r: 4, style: { fill: seriesColor(se.slot) },
      })));
      dots.setAttribute('visibility', 'visible');
      const rect = svg.getBoundingClientRect();
      showTip(cx ?? rect.left + px, cy ?? rect.top + m.t, xTitle(x[current]), series.map((se) => ({
        value: isNum(se.values[current]) ? format(se.values[current]) : DASH,
        label: se.label,
        color: seriesColor(se.slot),
      })));
    };
    const hide = () => {
      cross.setAttribute('visibility', 'hidden');
      dots.setAttribute('visibility', 'hidden');
      hideTip();
    };
    overlay.addEventListener('pointermove', (e) => {
      const rect = svg.getBoundingClientRect();
      const i = n > 1 ? Math.round(((e.clientX - rect.left - m.l) / pw) * (n - 1)) : 0;
      show(i, e.clientX, e.clientY);
    });
    overlay.addEventListener('pointerleave', hide);
    overlay.addEventListener('focus', () => show(current));
    overlay.addEventListener('blur', hide);
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        show(current + (e.key === 'ArrowLeft' ? -1 : 1));
      }
    });
    g.append(cross, dots, overlay);
    svg.append(g);
    return svg;
  };
  return responsive(draw);
}

export function columnChart({ items, format = (v, d) => formatNumber(v, d), tick = format, height = 200, integer = true, label, labelMax = true }) {
  const draw = (W) => {
    const values = items.map((it) => it.value);
    const ticks = niceTicks(maxOf(values), { integer });
    const labels = tickLabels(ticks, tick);
    const top = ticks[ticks.length - 1];
    const m = { t: 18, r: 8, b: 26, l: Math.max(24, ...labels.map((t) => textWidth(t))) + 10 };
    const pw = W - m.l - m.r;
    const ph = height - m.t - m.b;
    const n = items.length;
    const band = pw / Math.max(1, n);
    const bw = Math.min(24, Math.max(2, band - 2));
    const ys = scaleLinear([0, top], [m.t + ph, m.t]);
    const svg = s('svg', { class: 'chart', width: W, height, viewBox: `0 0 ${W} ${height}`, role: 'img', 'aria-label': label ?? '' });
    const g = s('g');
    yAxis(g, ticks, labels, ys, m.l, W - m.r);
    const k = labelEvery(n, pw, Math.max(...items.map((it) => textWidth(it.label))) + 10);
    const maxValue = maxOf(values);
    const maxIdx = values.findIndex((v) => v === maxValue && v > 0);
    items.forEach((it, i) => {
      const cx = m.l + i * band + band / 2;
      const v = isNum(it.value) ? it.value : 0;
      const y = ys(v);
      const hgt = m.t + ph - y;
      const bar = hgt > 0
        ? s('path', { class: `bar${it.muted ? ' muted' : ''}`, d: roundedTop(cx - bw / 2, y, bw, hgt) })
        : null;
      if (bar && !it.muted) bar.style.fill = seriesColor(it.slot ?? 1);
      if (bar) g.append(bar);
      if ((n - 1 - i) % k === 0) {
        g.append(s('text', { class: 'tick', x: cx, y: height - 8, 'text-anchor': 'middle', text: it.label }));
      }
      if (labelMax && i === maxIdx) {
        g.append(s('text', { class: 'value-label', x: cx, y: y - 6, 'text-anchor': 'middle', text: format(v) }));
      }
      const hit = s('rect', {
        class: 'hit', x: m.l + i * band, y: m.t, width: band, height: ph, tabindex: 0,
        'aria-label': `${it.title ?? it.label}: ${isNum(it.value) ? format(it.value) : DASH}`,
      });
      bindTip(hit, () => ({
        title: it.title ?? it.label,
        rows: [{ value: isNum(it.value) ? format(it.value) : DASH, label: it.valueLabel ?? null }, ...(it.extra ?? [])],
      }));
      hit.addEventListener('pointerenter', () => bar?.classList.add('active'));
      hit.addEventListener('pointerleave', () => bar?.classList.remove('active'));
      g.append(hit);
    });
    svg.append(g);
    return svg;
  };
  return responsive(draw);
}

export function barList({ items, format = (v) => formatNumber(v), label, empty = 'Keine Daten' }) {
  if (!items.length) return h('p', { class: 'empty', text: empty });
  const max = Math.max(1, maxOf(items.map((it) => it.value)));
  return h('ul', { class: 'barlist', 'aria-label': label ?? null }, items.map((it) => {
    const value = isNum(it.value) ? format(it.value) : DASH;
    const row = h('li', { class: `bar-row${it.muted ? ' muted' : ''}`, tabindex: 0, 'aria-label': `${it.label}: ${value}` },
      h('span', { class: 'bar-label' }, h('span', { text: it.label }), it.sub ? h('small', { text: it.sub }) : null),
      h('span', { class: 'bar-track' },
        h('span', { class: 'bar-fill', style: { width: `${(Math.max(0, it.value ?? 0) / max) * 100}%` } })),
      h('span', { class: 'bar-value', text: value }));
    bindTip(row, () => ({ title: it.label, rows: [{ value, label: it.valueLabel ?? null }, ...(it.extra ?? [])] }));
    return row;
  }));
}

export function heatmap({ grid, format = (v) => formatNumber(v), rowLabels, rowTitles = rowLabels, cellTitle, label }) {
  const max = maxOf(grid.flat());
  const draw = (W) => {
    const left = 30;
    const topPad = 18;
    const cell = Math.max(8, Math.min(34, Math.floor((W - left - 4) / 24)));
    const width = left + cell * 24 + 2;
    const height = topPad + cell * grid.length + 2;
    const svg = s('svg', { class: 'chart heat', width, height, viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': label ?? 'Heatmap' });
    const every = cell < 16 ? 6 : 3;
    for (let hr = 0; hr < 24; hr += every) {
      svg.append(s('text', { class: 'tick', x: left + hr * cell + cell / 2, y: 11, 'text-anchor': 'middle', text: String(hr) }));
    }
    grid.forEach((row, d) => {
      svg.append(s('text', { class: 'tick', x: left - 6, y: topPad + d * cell + cell / 2, 'text-anchor': 'end', 'dominant-baseline': 'middle', text: rowLabels[d] }));
      row.forEach((v, hr) => {
        const rect = s('rect', {
          class: `cell lvl-${levelOf(v, max)}`, x: left + hr * cell + 1, y: topPad + d * cell + 1,
          width: cell - 2, height: cell - 2, rx: 2,
        });
        bindTip(rect, () => ({ title: cellTitle ? cellTitle(d, hr) : `${rowTitles[d]}, ${hr}–${hr + 1} Uhr`, rows: [{ value: format(v) }] }));
        svg.append(rect);
      });
    });
    return svg;
  };
  return h('div', { class: 'heat-wrap' }, responsive(draw), scaleLegend(max, format));
}

export function scaleLegend(max, format, { zero = 'kein Wert' } = {}) {
  const swatches = [h('span', { class: 'swatch lvl-0', title: zero })];
  for (let k = 1; k <= LEVELS; k++) {
    const from = ((k - 1) / LEVELS) * max;
    const to = (k / LEVELS) * max;
    swatches.push(h('span', { class: `swatch lvl-${k}`, title: `${format(from)} bis ${format(to)}` }));
  }
  return h('div', { class: 'scale', 'aria-hidden': 'true' },
    h('span', { class: 'scale-label', text: zero }),
    h('span', { class: 'scale-swatches' }, swatches),
    h('span', { class: 'scale-label', text: `bis ${format(max)}` }));
}

export function cohortTable({ cohorts, weeks, dKeys }) {
  const head = h('tr', {},
    h('th', { scope: 'col', text: 'Woche ab' }),
    h('th', { scope: 'col', class: 'num', text: 'Spieler' }),
    dKeys.map((k) => h('th', { scope: 'col', class: 'num', text: k.toUpperCase() })),
    Array.from({ length: weeks }, (_, i) => h('th', { scope: 'col', class: 'num', text: `W${i}` })));
  const rows = cohorts.map((c) => h('tr', {},
    h('th', { scope: 'row', text: formatDay(c.week) }),
    h('td', { class: 'num', text: formatNumber(c.size) }),
    dKeys.map((k) => {
      const d = c[k];
      const td = h('td', { class: 'num', text: d.rate == null ? DASH : formatPercent(d.rate, 0) });
      if (d.eligible) td.title = `${formatNumber(d.retained)} von ${formatNumber(d.eligible)}`;
      return td;
    }),
    Array.from({ length: weeks }, (_, i) => {
      const rate = c.retention[i];
      if (rate === undefined) return h('td', { class: 'cell-none' });
      if (rate == null) return h('td', { class: 'num cell-empty', text: DASH });
      const td = h('td', { class: `num cell lvl-${levelOf(rate, 1)}`, tabindex: 0, text: formatPercent(rate, 0) });
      bindTip(td, () => ({
        title: `Kohorte ${formatDay(c.week)}, Woche ${i}`,
        rows: [{ value: formatPercent(rate, 1), label: `${formatNumber(c.retained[i])} von ${formatNumber(c.size)}` }],
      }));
      return td;
    })));
  return h('div', { class: 'table-wrap' },
    h('table', { class: 'data cohort' }, h('thead', {}, head), h('tbody', {}, rows)));
}

export function sparkline(values, { slot = 1, height = 32 } = {}) {
  if (!values?.some(isNum)) return null;
  const draw = (W) => {
    const max = maxOf(values) || 1;
    const n = values.length;
    const xs = (i) => 3 + (n > 1 ? (i * (W - 6)) / (n - 1) : (W - 6) / 2);
    const ys = scaleLinear([0, max], [height - 4, 4]);
    const svg = s('svg', { class: 'spark', width: W, height, viewBox: `0 0 ${W} ${height}`, 'aria-hidden': 'true' });
    for (const seg of segmentsOf(values)) {
      const d = seg.map(([i, v], j) => `${j ? 'L' : 'M'}${xs(i).toFixed(1)},${ys(v).toFixed(1)}`).join('');
      svg.append(s('path', { class: 'spark-line', d }));
    }
    const last = values.findLastIndex(isNum);
    svg.append(s('circle', { class: 'dot', cx: xs(last), cy: ys(values[last]), r: 3.5, style: { fill: seriesColor(slot) } }));
    return svg;
  };
  return responsive(draw, 'spark-box');
}

export function kpiTile({ label, value, sub, spark }) {
  return h('div', { class: 'kpi' },
    h('span', { class: 'kpi-label', text: label }),
    h('strong', { class: 'kpi-value', text: value }),
    sub ? h('span', { class: 'kpi-sub', text: sub }) : null,
    spark ? sparkline(spark) : null);
}

export function meter(rate) {
  const w = isNum(rate) ? Math.max(0, Math.min(1, rate)) * 100 : 0;
  return h('span', { class: 'meter', 'aria-hidden': 'true' }, h('span', { class: 'meter-fill', style: { width: `${w}%` } }));
}

export function dataTable({ columns, rows, caption, empty = 'Keine Daten' }) {
  if (!rows.length) return h('p', { class: 'empty', text: empty });
  return h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
    caption ? h('caption', { text: caption }) : null,
    h('thead', {}, h('tr', {}, columns.map((c) => h('th', { scope: 'col', class: c.num ? 'num' : null, text: c.label })))),
    h('tbody', {}, rows.map((r) => h('tr', { class: r.className ?? null }, (r.cells ?? r).map((cell, i) => h(i === 0 ? 'th' : 'td', {
      scope: i === 0 ? 'row' : null,
      class: columns[i]?.num ? 'num' : null,
    }, cell == null ? DASH : cell)))))));
}

export function figure({ title, subtitle, chart, table, legendItems, legendMark, notes, actions, wide = false }) {
  const chartWrap = h('div', { class: 'figure-chart' }, chart);
  const tableWrap = table ? h('div', { class: 'figure-table', hidden: true }) : null;
  let showing = false;
  const btn = table ? h('button', { type: 'button', class: 'btn btn-ghost btn-small', 'aria-pressed': 'false', text: 'Tabelle' }) : null;
  btn?.addEventListener('click', () => {
    showing = !showing;
    if (showing && !tableWrap.firstChild) tableWrap.append(dataTable(typeof table === 'function' ? table() : table));
    chartWrap.hidden = showing;
    tableWrap.hidden = !showing;
    btn.textContent = showing ? 'Diagramm' : 'Tabelle';
    btn.setAttribute('aria-pressed', String(showing));
    hideTip();
  });
  return h('section', { class: `card figure${wide ? ' wide' : ''}` },
    h('header', { class: 'figure-head' },
      h('div', {}, h('h2', { text: title }), subtitle ? h('p', { class: 'sub', text: subtitle }) : null),
      h('div', { class: 'figure-actions' }, actions ?? null, btn)),
    legendItems ? legend(legendItems, legendMark) : null,
    chartWrap,
    tableWrap,
    notes ? note(notes) : null);
}
