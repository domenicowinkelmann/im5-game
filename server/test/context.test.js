import { test } from 'node:test';
import assert from 'node:assert/strict';
import { screenClass, cleanContext, CONTEXT } from '../../src/shared/economy.js';

const CONTEXT_JS = new URL('../../src/api/context.js', import.meta.url);
let loads = 0;

async function freshContext() {
  loads += 1;
  return (await import(`${CONTEXT_JS.href}?load=${loads}`)).collectContext;
}

function windowStub({ width = 1024, coarse = false, referrer = '', host = 'wingrush.example', search = '', language = 'de-CH' } = {}) {
  return {
    innerWidth: width,
    navigator: { language },
    matchMedia: (q) => ({ matches: q === '(pointer: coarse)' && coarse }),
    document: { referrer },
    location: { hostname: host, search },
  };
}

test('screen classes follow the width thresholds', () => {
  assert.deepEqual([320, 479, 480, 767, 768, 1199, 1200, 2560].map(screenClass), ['xs', 'xs', 's', 's', 'm', 'm', 'l', 'l']);
  assert.equal(screenClass(0), null);
  assert.equal(screenClass(undefined), null);
});

test('context reads offset, zone, locale, screen and touch', async () => {
  const collect = await freshContext();
  const ctx = collect(windowStub({ width: 400, coarse: true }));
  assert.equal(ctx.tzOffset, -new Date().getTimezoneOffset() || 0);
  assert.equal(ctx.timeZone, Intl.DateTimeFormat().resolvedOptions().timeZone);
  assert.equal(ctx.locale, 'de-CH');
  assert.equal(ctx.screen, 'xs');
  assert.equal(ctx.touch, true);
  assert.equal(collect(windowStub({ width: 1400 })).touch, false);
});

test('referrer host and utm are only sent on the first call', async () => {
  const collect = await freshContext();
  const win = windowStub({
    referrer: 'https://www.Google.ch/search?q=wingrush',
    search: '?utm_source=insta&utm_medium=story&utm_campaign=herbst&x=1',
  });
  const first = collect(win);
  assert.equal(first.referrer, 'www.google.ch');
  assert.deepEqual(first.utm, { source: 'insta', medium: 'story', campaign: 'herbst' });
  const second = collect(win);
  assert.equal(second.referrer, null);
  assert.equal(second.utm, null);
});

test('own host, broken referrers and missing utm give null', async () => {
  let collect = await freshContext();
  const own = collect(windowStub({ referrer: 'https://wingrush.example/menu' }));
  assert.equal(own.referrer, null);
  assert.equal(own.utm, null);
  collect = await freshContext();
  assert.equal(collect(windowStub({ referrer: 'kein link' })).referrer, null);
  collect = await freshContext();
  assert.deepEqual(collect(windowStub({ search: '?utm_source=mail' })).utm, { source: 'mail', medium: null, campaign: null });
});

test('a window without matchMedia or navigator still works', async () => {
  const collect = await freshContext();
  const ctx = collect({ innerWidth: 900, location: { hostname: 'x', search: '' } });
  assert.equal(ctx.touch, false);
  assert.equal(ctx.locale, null);
  assert.equal(ctx.screen, 'm');
});

test('cleanContext validates and limits every field', () => {
  const clean = cleanContext({
    tzOffset: 60, timeZone: 'Europe/Zurich', locale: 'de-CH', screen: 'm', touch: false,
    referrer: ' WWW.Example.COM ', utm: { source: 'a'.repeat(100), medium: ' newsletter\n', campaign: 42 },
  });
  assert.deepEqual(clean, {
    tzOffset: 60, timeZone: 'Europe/Zurich', locale: 'de-CH', screen: 'm', touch: false,
    referrer: 'www.example.com', utm: { source: 'a'.repeat(CONTEXT.textMax), medium: 'newsletter', campaign: null },
  });
  const bad = cleanContext({
    tzOffset: 5000, timeZone: '../etc/passwd', locale: 'deutsch schweiz', screen: 'xl', touch: 'ja',
    referrer: 'https://evil.example/pfad', utm: 'x',
  });
  assert.deepEqual(bad, {
    tzOffset: null, timeZone: null, locale: null, screen: null, touch: null,
    referrer: null, utm: { source: null, medium: null, campaign: null },
  });
  assert.equal(cleanContext({ tzOffset: 60.5 }).tzOffset, null);
  assert.equal(cleanContext({ tzOffset: -840 }).tzOffset, -840);
  assert.deepEqual(cleanContext(null), cleanContext({}));
  assert.equal(Array.from(cleanContext({ utm: { source: '😀'.repeat(50) } }).utm.source).length, CONTEXT.textMax);
});

test('privacy notice and consent text disclose every stored context field', async () => {
  const { readFile } = await import('node:fs/promises');
  const { privacyHtml } = await import('../../src/ui/privacy.js');
  const index = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  const consent = index.match(/id="consent-stats"[\s\S]*?<span class="consent-desc">([\s\S]*?)<\/span>/)[1];
  const notice = privacyHtml().replace(/\s+/g, ' ');
  const phrases = {
    tzOffset: ['Zeitzone', 'Spielzeiten'],
    timeZone: ['Zeitzone', 'Spielzeiten'],
    locale: ['Sprache des Browsers', 'Sprache'],
    screen: ['Bildschirmgrösse', 'Bildschirmgrösse'],
    touch: ['Touch', 'Touch'],
    referrer: ['verweisenden Website', 'verweisende Website'],
    'utm.source': ['utm_source', 'Kampagnen-Angaben'],
    'utm.medium': ['utm_medium', 'Kampagnen-Angaben'],
    'utm.campaign': ['utm_campaign', 'Kampagnen-Angaben'],
    device: ['Gerätetyp', 'Typ'],
    os: ['Betriebssystem', 'System'],
    browser: ['Browser-Familie', 'Browser'],
    country: ['Land', 'Land'],
    region: ['Kanton', 'Kanton'],
  };
  const fields = Object.entries(cleanContext({})).flatMap(([k, v]) => (v && typeof v === 'object' ? Object.keys(v).map((s) => `${k}.${s}`) : [k]));
  for (const field of [...fields, 'device', 'os', 'browser', 'country', 'region']) {
    assert.ok(phrases[field], `no disclosure defined for ${field}`);
    assert.ok(notice.includes(phrases[field][0]), `privacy notice misses ${field}`);
    assert.ok(consent.includes(phrases[field][1]), `consent text misses ${field}`);
  }
});
