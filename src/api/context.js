import { screenClass } from '../shared/economy.js';

const UTM = ['source', 'medium', 'campaign'];

let firstCall = true;

function safe(fn) {
  try { return fn() ?? null; } catch (e) { return null; }
}

function referrerHost(win) {
  return safe(() => {
    const ref = win.document?.referrer;
    if (!ref) return null;
    const host = new URL(ref).hostname.toLowerCase();
    return host && host !== String(win.location?.hostname ?? '').toLowerCase() ? host : null;
  });
}

function utmParams(win) {
  return safe(() => {
    const params = new URLSearchParams(win.location?.search ?? '');
    const utm = Object.fromEntries(UTM.map((k) => [k, params.get(`utm_${k}`) || null]));
    return UTM.some((k) => utm[k]) ? utm : null;
  });
}

export function collectContext(win = window) {
  const first = firstCall;
  firstCall = false;
  return {
    tzOffset: -new Date().getTimezoneOffset() || 0,
    timeZone: safe(() => Intl.DateTimeFormat().resolvedOptions().timeZone),
    locale: safe(() => win.navigator.language),
    screen: screenClass(win.innerWidth),
    touch: !!safe(() => win.matchMedia('(pointer: coarse)').matches),
    referrer: first ? referrerHost(win) : null,
    utm: first ? utmParams(win) : null,
  };
}
