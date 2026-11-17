const MAX_LENGTH = 512;

const BOT = /bot\b|crawl|spider|slurp|headless|lighthouse|pingdom|phantomjs|puppeteer|playwright|selenium|facebookexternalhit|embedly|preview|^(curl|wget|python|java|go-http|okhttp|node|axios|libwww|httpclient|postman)/i;

const BROWSERS = [
  ['Edge', /\bEdg(e|A|iOS)?\//],
  ['Samsung Internet', /SamsungBrowser\//],
  ['Opera', /\bOPR\/|\bOPT\/|OPiOS\/|Opera/],
  ['Firefox', /Firefox\/|FxiOS\//],
  ['Chrome', /CriOS\/|Chrome\/|Chromium\//],
  ['Safari', /Version\/[\d.]+.*Safari\//],
];

function platform(ua, touch) {
  if (/iPad/.test(ua)) return ['tablet', 'iPadOS'];
  if (/iPhone|iPod/.test(ua)) return ['mobile', 'iOS'];
  if (/Android/.test(ua)) return [/Mobile/.test(ua) ? 'mobile' : 'tablet', 'Android'];
  if (/CrOS/.test(ua)) return ['desktop', 'ChromeOS'];
  if (/Windows/.test(ua)) return ['desktop', 'Windows'];
  if (/Macintosh|Mac OS X/.test(ua)) return touch ? ['tablet', 'iPadOS'] : ['desktop', 'macOS'];
  if (/Linux|X11/.test(ua)) return ['desktop', 'Linux'];
  return [/Mobi/.test(ua) ? 'mobile' : 'desktop', 'other'];
}

export function parseUserAgent(ua, { touch = false } = {}) {
  const s = typeof ua === 'string' ? ua.slice(0, MAX_LENGTH).trim() : '';
  if (!s) return { device: null, os: null, browser: null, bot: false };
  const [device, os] = platform(s, touch === true);
  const browser = BROWSERS.find(([, re]) => re.test(s))?.[0] ?? 'other';
  return { device, os, browser, bot: BOT.test(s.replace(/cubot/gi, '')) };
}
