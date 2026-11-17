const SVG_NS = 'http://www.w3.org/2000/svg';
const PROPS = new Set(['value', 'checked', 'selected', 'disabled', 'hidden', 'open']);

function apply(el, props, svg) {
  for (const [key, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (key === 'text') el.textContent = String(v);
    else if (key === 'class') el.setAttribute('class', v);
    else if (key === 'style') Object.assign(el.style, v);
    else if (key.startsWith('on') && typeof v === 'function') el.addEventListener(key.slice(2), v);
    else if (!svg && PROPS.has(key)) el[key] = v;
    else el.setAttribute(key, v === true ? '' : String(v));
  }
}

function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  apply(el, props, false);
  append(el, children);
  return el;
}

export function s(tag, props = {}, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  apply(el, props, true);
  append(el, children);
  return el;
}

export function note(texts) {
  const list = (Array.isArray(texts) ? texts : [texts]).filter(Boolean);
  return list.length ? h('ul', { class: 'notes' }, list.map((t) => h('li', { text: t }))) : null;
}

export function message(text, kind = 'info') {
  return h('p', { class: `message message-${kind}`, role: kind === 'error' ? 'alert' : 'status', text });
}
