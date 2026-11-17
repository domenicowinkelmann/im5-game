import { mockApi } from './mockApi.js';
import { restApi } from './restApi.js';

const useMock = import.meta.env.VITE_API === 'mock' || import.meta.env.MODE === 'single';
const base = useMock ? mockApi : restApi;
const NEEDS_STATS = ['trackEvent', 'startSession'];

let consent = null;

function remember(res) {
  const p = res?.profile ?? res;
  if (p && typeof p === 'object' && p.consent) consent = { ...p.consent };
  return res;
}

function wrap(name, fn) {
  if (NEEDS_STATS.includes(name)) {
    return (...args) => (consent?.stats ? fn.apply(base, args) : Promise.resolve());
  }
  return (...args) => {
    const out = fn.apply(base, args);
    return out instanceof Promise ? out.then(remember) : out;
  };
}

export const api = Object.fromEntries(
  Object.entries(base).map(([name, fn]) => [name, typeof fn === 'function' ? wrap(name, fn) : fn]),
);

api.consent = () => (consent ? { ...consent } : null);

if (typeof window !== 'undefined') window.api = api;
