const BASE = import.meta.env.VITE_API_URL || '/api';
const TOKEN_KEY = 'wingrush.token';

let memoryToken = null;
let pendingGuest = null;

function readToken() {
  try { return localStorage.getItem(TOKEN_KEY); } catch (e) { return memoryToken; }
}

function writeToken(token) {
  memoryToken = token;
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch (e) {}
}

async function request(method, path, body, token) {
  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    throw new Error('Server nicht erreichbar');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) {
    const err = new Error(data?.error || (res.status >= 500 ? 'Server nicht erreichbar' : 'Unbekannter Fehler'));
    err.status = res.status;
    throw err;
  }
  return data;
}

function ensureToken() {
  const token = readToken();
  if (token) return Promise.resolve(token);
  if (!pendingGuest) {
    pendingGuest = request('POST', '/auth/guest', {})
      .then((res) => { writeToken(res.token); return res.token; })
      .finally(() => { pendingGuest = null; });
  }
  return pendingGuest;
}

async function call(method, path, body) {
  const token = await ensureToken();
  try {
    return await request(method, path, body, token);
  } catch (e) {
    if (e.status !== 401) throw e;
    if (readToken() === token) writeToken(null);
    return request(method, path, body, await ensureToken());
  }
}

function withNewToken(res) {
  writeToken(res.token);
  return { profile: res.profile };
}

export const restApi = {
  getMe: () => call('GET', '/me'),
  submitRun: (run) => call('POST', '/runs', run),
  claimDouble: (runId) => call('POST', `/runs/${encodeURIComponent(runId)}/double`, {}),
  spin: () => call('POST', '/spin', {}),
  equip: (itemId) => call('POST', '/equip', { itemId }),
  trackEvent: (name, data) => call('POST', '/events', { name, data }).catch(() => {}),
  signup: (username, password) => call('POST', '/auth/signup', { username, password }).then(withNewToken),
  login: (username, password) => request('POST', '/auth/login', { username, password }, readToken()).then(withNewToken),
  async logout() {
    const token = readToken();
    if (token) await request('POST', '/auth/logout', {}, token).catch(() => {});
    if (readToken() === token) writeToken(null);
    return { profile: await call('GET', '/me') };
  },
};
