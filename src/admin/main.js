import '@fontsource/rubik/400.css';
import '@fontsource/rubik/600.css';
import '@fontsource/lilita-one/400.css';
import './admin.css';
import { h, message } from './dom.js';
import { adminApi, onUnauthorized } from './api.js';
import { hideTip } from './charts.js';
import * as overview from './views/overview.js';
import * as activity from './views/activity.js';
import * as retention from './views/retention.js';
import * as segments from './views/segments.js';
import * as engagement from './views/engagement.js';
import * as audience from './views/audience.js';
import * as players from './views/players.js';
import * as player from './views/player.js';

const NAV = [
  { path: 'overview', label: 'Übersicht', view: overview },
  { path: 'activity', label: 'Aktivität', view: activity },
  { path: 'retention', label: 'Retention', view: retention },
  { path: 'segments', label: 'Segmente', view: segments },
  { path: 'engagement', label: 'Werbung & Erinnerungen', view: engagement },
  { path: 'audience', label: 'Publikum', view: audience },
  { path: 'players', label: 'Spieler', view: players },
];

const root = document.getElementById('app');
let user = null;
let shell = null;
let seq = 0;
let flashText = null;

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, search = ''] = raw.split('?');
  return { parts: path.split('/').filter(Boolean), query: new URLSearchParams(search) };
}

function resolve(parts) {
  if (parts[0] === 'players' && parts.length === 2) return { nav: 'players', view: player, params: { id: parts[1] } };
  const entry = NAV.find((n) => n.path === (parts[0] ?? 'overview')) ?? NAV[0];
  return { nav: entry.path, view: entry.view, params: {} };
}

function viewKey(path) {
  const { nav, params } = resolve(path.split('/').filter(Boolean));
  return `${nav}:${params.id ?? ''}`;
}

function hashFor(path, query) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) if (v != null && v !== '') q.set(k, String(v));
  const text = q.toString();
  return `#/${path}${text ? `?${text}` : ''}`;
}

function navigate(path, query) {
  const next = hashFor(path, query);
  if (location.hash === next) route();
  else location.hash = next;
}

function footer() {
  return h('footer', { class: 'footer' },
    h('a', { href: 'https://db-ip.com', target: '_blank', rel: 'noopener', text: 'IP Geolocation by DB-IP' }));
}

function brand() {
  return h('a', { class: 'brand', href: '#/overview' }, h('span', { class: 'brand-name', text: 'Wingrush' }), h('span', { class: 'brand-tag', text: 'Admin' }));
}

function standalone(...children) {
  shell = null;
  root.replaceChildren(h('div', { class: 'standalone' }, h('header', { class: 'standalone-head' }, brand()), h('main', { class: 'standalone-main' }, ...children), footer()));
}

async function logout() {
  await adminApi.logout();
  user = null;
  showLogin();
}

function showLogin(error = null) {
  user = null;
  hideTip();
  const err = h('p', { class: 'message message-error', role: 'alert', hidden: !error, text: error ?? '' });
  const name = h('input', { id: 'login-name', name: 'username', autocomplete: 'username', required: true, maxlength: 20 });
  const pass = h('input', { id: 'login-pass', name: 'password', type: 'password', autocomplete: 'current-password', required: true, maxlength: 128 });
  const submit = h('button', { type: 'submit', class: 'btn btn-primary', text: 'Anmelden' });
  const form = h('form', { class: 'card login', novalidate: true },
    h('h1', { text: 'Anmelden' }),
    h('p', { class: 'sub', text: 'Nur für Konten mit Admin-Rechten.' }),
    h('label', { for: 'login-name', text: 'Benutzername' }), name,
    h('label', { for: 'login-pass', text: 'Passwort' }), pass,
    err, submit);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!name.value.trim() || !pass.value) {
      err.textContent = 'Bitte Benutzername und Passwort eingeben.';
      err.hidden = false;
      return;
    }
    submit.disabled = true;
    err.hidden = true;
    try {
      await adminApi.login(name.value.trim(), pass.value);
      user = await adminApi.me();
      route();
    } catch (ex) {
      if (ex.status === 403) showForbidden();
      else {
        err.textContent = ex.message;
        err.hidden = false;
        submit.disabled = false;
        pass.value = '';
        pass.focus();
      }
    }
  });
  standalone(form);
  name.focus();
}

function showForbidden() {
  user = null;
  hideTip();
  standalone(h('section', { class: 'card login' },
    h('h1', { text: 'Kein Zugriff' }),
    h('p', { text: 'Dieses Konto hat keine Admin-Rechte oder sie wurden entzogen.' }),
    h('button', { type: 'button', class: 'btn btn-primary', text: 'Abmelden', onclick: logout })));
}

function buildShell() {
  const nav = h('nav', { class: 'nav', 'aria-label': 'Bereiche' },
    NAV.map((n) => h('a', { href: `#/${n.path}`, 'data-nav': n.path, text: n.label })));
  const main = h('main', { class: 'main', id: 'main', tabindex: -1 });
  const header = h('header', { class: 'top' },
    h('div', { class: 'top-row' },
      brand(),
      h('div', { class: 'who' },
        h('span', { class: 'who-name', text: user?.username ?? '' }),
        h('button', { type: 'button', class: 'btn btn-ghost btn-small', text: 'Abmelden', onclick: logout }))),
    nav);
  root.replaceChildren(h('div', { class: 'shell' }, header, main, footer()));
  shell = { nav, main };
}

function setActive(navPath) {
  for (const a of shell.nav.querySelectorAll('a')) {
    if (a.dataset.nav === navPath) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
}

function errorBox(text, retry) {
  return h('div', { class: 'card error-box' },
    message(text, 'error'),
    h('button', { type: 'button', class: 'btn', text: 'Erneut versuchen', onclick: retry }));
}

async function route() {
  hideTip();
  if (!adminApi.hasToken()) return showLogin();
  const mine = ++seq;
  if (!user) {
    try {
      user = await adminApi.me();
    } catch (e) {
      if (mine !== seq || e.status === 401) return;
      if (e.status === 403) return showForbidden();
      return standalone(errorBox(e.message, route));
    }
    if (mine !== seq) return;
  }
  if (!shell) buildShell();
  const { parts, query } = parseHash();
  const path = parts.join('/') || 'overview';
  const { nav, view, params } = resolve(parts);
  const key = viewKey(path);
  setActive(nav);
  const { main } = shell;
  const sameView = main.dataset.view === key;
  if (sameView && main.firstChild) main.classList.add('busy');
  else main.replaceChildren(h('p', { class: 'loading', role: 'status', text: 'Wird geladen …' }));
  main.dataset.view = key;
  const isCurrent = () => mine === seq;
  const merged = (updates) => {
    const next = Object.fromEntries(query.entries());
    for (const [k, v] of Object.entries(updates)) {
      if (v == null || v === '') delete next[k];
      else next[k] = v;
    }
    return next;
  };
  const ctx = {
    api: adminApi,
    user,
    params,
    query,
    isCurrent,
    navigate,
    setQuery(updates) {
      navigate(path, merged(updates));
    },
    replaceQuery(updates) {
      if (isCurrent()) history.replaceState(history.state, '', hashFor(path, merged(updates)));
    },
    refresh: route,
    flash(text, target = path) {
      flashText = { text, key: viewKey(target) };
    },
  };
  try {
    const node = await view.render(ctx);
    if (mine !== seq) return;
    const flash = flashText?.key === key ? message(flashText.text, 'ok') : null;
    flashText = null;
    main.classList.remove('busy');
    main.replaceChildren(...[flash, node].filter(Boolean));
    if (!sameView) window.scrollTo(0, 0);
  } catch (e) {
    if (mine !== seq) return;
    flashText = null;
    if (e.status === 401) return;
    if (e.status === 403) return showForbidden();
    main.classList.remove('busy');
    main.replaceChildren(errorBox(e.message, route));
  }
}

onUnauthorized(() => {
  seq++;
  flashText = null;
  showLogin('Sitzung abgelaufen. Bitte neu anmelden.');
});

window.addEventListener('hashchange', route);
route();
