import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseUserAgent } from '../src/ua.js';

const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  ipadDesktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  ipad: 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1',
  androidTablet: 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  androidPhone: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  samsung: 'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36',
  edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.2849.68',
  firefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0',
  firefoxMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.6; rv:132.0) Gecko/20100101 Firefox/132.0',
  headless: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/130.0.0.0 Safari/537.36',
  googlebot: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  cubot: 'Mozilla/5.0 (Linux; Android 12; CUBOT X50) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  chromebook: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
};

const family = (ua, opts) => parseUserAgent(ua, opts);

test('an iPhone is a mobile iOS Safari', () => {
  assert.deepEqual(family(UA.iphone), { device: 'mobile', os: 'iOS', browser: 'Safari', bot: false });
});

test('an iPad in desktop mode with touch is a tablet with iPadOS', () => {
  assert.deepEqual(family(UA.ipadDesktop, { touch: true }), { device: 'tablet', os: 'iPadOS', browser: 'Safari', bot: false });
  assert.deepEqual(family(UA.ipadDesktop), { device: 'desktop', os: 'macOS', browser: 'Safari', bot: false });
  assert.deepEqual(family(UA.ipad), { device: 'tablet', os: 'iPadOS', browser: 'Chrome', bot: false });
});

test('android without Mobile is a tablet', () => {
  assert.deepEqual(family(UA.androidTablet), { device: 'tablet', os: 'Android', browser: 'Chrome', bot: false });
  assert.deepEqual(family(UA.androidPhone), { device: 'mobile', os: 'Android', browser: 'Chrome', bot: false });
});

test('samsung internet, edge and firefox are recognised before chrome', () => {
  assert.deepEqual(family(UA.samsung), { device: 'mobile', os: 'Android', browser: 'Samsung Internet', bot: false });
  assert.deepEqual(family(UA.edge), { device: 'desktop', os: 'Windows', browser: 'Edge', bot: false });
  assert.deepEqual(family(UA.firefox), { device: 'desktop', os: 'Linux', browser: 'Firefox', bot: false });
  assert.deepEqual(family(UA.firefoxMac), { device: 'desktop', os: 'macOS', browser: 'Firefox', bot: false });
  assert.deepEqual(family(UA.chromebook), { device: 'desktop', os: 'ChromeOS', browser: 'Chrome', bot: false });
});

test('headless chrome and crawlers are bots, a cubot phone is not', () => {
  assert.equal(family(UA.headless).bot, true);
  assert.equal(family(UA.googlebot).bot, true);
  assert.equal(family('curl/8.7.1').bot, true);
  assert.equal(family(UA.cubot).bot, false);
});

test('an empty or missing user agent gives no families', () => {
  for (const ua of ['', '   ', undefined, null, 42]) {
    assert.deepEqual(family(ua), { device: null, os: null, browser: null, bot: false });
  }
});

test('the result never contains the user agent string', () => {
  const out = family(UA.edge);
  assert.deepEqual(Object.keys(out).sort(), ['bot', 'browser', 'device', 'os']);
  assert.ok(Object.values(out).every((v) => typeof v === 'boolean' || v.length <= 20));
});

test('a huge user agent is cut before parsing and stays fast', () => {
  const evil = `Version/${'1.'.repeat(8000)}`;
  const started = performance.now();
  for (let i = 0; i < 20; i++) parseUserAgent(evil);
  assert.ok(performance.now() - started < 100);
  assert.deepEqual(family(`${UA.iphone}${' x'.repeat(8000)}`), { device: 'mobile', os: 'iOS', browser: 'Safari', bot: false });
});
