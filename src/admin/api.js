const BASE = `${import.meta.env?.VITE_API_URL || '/api'}/admin`;
const TOKEN_KEY = 'wingrush.admin';

let memoryToken = null;
const listeners = new Set();

export class AdminError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function getToken() {
  try { return sessionStorage.getItem(TOKEN_KEY) ?? memoryToken; } catch (e) { return memoryToken; }
}

function setToken(token) {
  memoryToken = token;
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch (e) {}
}

export function onUnauthorized(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function query(params) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v != null && v !== '') q.set(k, String(v));
  }
  const text = q.toString();
  return text ? `?${text}` : '';
}

async function request(method, path, body, { auth = true } = {}) {
  const token = auth ? getToken() : null;
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch (e) {
    throw new AdminError(0, 'Server nicht erreichbar');
  }
  let data = null;
  try { data = await res.json(); } catch (e) {}
  if (!res.ok) {
    const error = new AdminError(res.status, data?.error || `Fehler ${res.status}`);
    if (res.status === 401 && auth) {
      setToken(null);
      for (const fn of listeners) fn(error);
    }
    throw error;
  }
  return data;
}

export const adminApi = {
  hasToken: () => Boolean(getToken()),
  async login(username, password) {
    const res = await request('POST', '/login', { username, password }, { auth: false });
    setToken(res.token);
    return res;
  },
  async logout() {
    if (getToken()) await request('POST', '/logout', {}).catch(() => null);
    setToken(null);
  },
  me: () => request('GET', '/me'),
  overview: (days) => request('GET', `/overview${query({ days })}`),
  activity: (days) => request('GET', `/activity${query({ days })}`),
  retention: (weeks) => request('GET', `/retention${query({ weeks })}`),
  segments: () => request('GET', '/segments'),
  engagement: (days) => request('GET', `/engagement${query({ days })}`),
  audience: (days) => request('GET', `/audience${query({ days })}`),
  players: (params) => request('GET', `/players${query(params)}`),
  player: (id) => request('GET', `/players/${encodeURIComponent(id)}`),
  recompute: (id) => request('POST', `/players/${encodeURIComponent(id)}/recompute`, {}),
  deletePlayer: (id) => request('POST', `/players/${encodeURIComponent(id)}/delete`, {}),
};
