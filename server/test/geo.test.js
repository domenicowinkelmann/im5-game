import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cantonCode, locate, openGeo, CANTON_CODES } from '../src/geo.js';

test('all 26 cantons are known', () => {
  assert.equal(CANTON_CODES.length, 26);
});

test('canton names in german, french, italian and english map to the code', () => {
  const cases = {
    zurich: 'ZH', 'Zürich': 'ZH', Berne: 'BE', bern: 'BE', Lucerne: 'LU', Luzern: 'LU',
    Grisons: 'GR', 'Graubünden': 'GR', Grigioni: 'GR', Geneva: 'GE', 'Genève': 'GE', Genf: 'GE',
    Ticino: 'TI', Tessin: 'TI', Valais: 'VS', Wallis: 'VS', 'Basel-City': 'BS', 'Basel-Landschaft': 'BL',
    'Saint Gallen': 'SG', 'St. Gallen': 'SG', 'Neuchâtel': 'NE', 'Appenzell Ausserrhoden': 'AR',
    'Appenzell Innerrhoden': 'AI', Fribourg: 'FR', 'Canton of Zurich': 'ZH', 'Kanton Zug': 'ZG',
    'Republic and Canton of Geneva': 'GE', 'canton du Jura': 'JU',
  };
  for (const [name, code] of Object.entries(cases)) assert.equal(cantonCode(name), code, name);
  assert.equal(cantonCode('Bavaria'), null);
  assert.equal(cantonCode(''), null);
  assert.equal(cantonCode(undefined), null);
});

function reader(records) {
  return { get: (ip) => records[ip] ?? null };
}

const RECORDS = {
  '1.2.3.4': { country: { iso_code: 'CH' }, subdivisions: [{ names: { en: 'Grisons' } }], city: { names: { en: 'Chur' } } },
  '5.6.7.8': { country: { iso_code: 'DE' }, subdivisions: [{ names: { en: 'Bavaria' } }] },
  '9.9.9.9': { country: { iso_code: 'CH' } },
  '2001:db8::1': { country: { iso_code: 'ch' }, subdivisions: [{ names: { de: 'Zürich' } }] },
};

test('locate returns only country and canton, the canton only for switzerland', () => {
  const r = reader(RECORDS);
  assert.deepEqual(locate(r, '1.2.3.4'), { country: 'CH', region: 'GR' });
  assert.deepEqual(locate(r, '::ffff:1.2.3.4'), { country: 'CH', region: 'GR' });
  assert.deepEqual(locate(r, '5.6.7.8'), { country: 'DE', region: null });
  assert.deepEqual(locate(r, '9.9.9.9'), { country: 'CH', region: null });
  assert.deepEqual(locate(r, '2001:db8::1'), { country: 'CH', region: 'ZH' });
  assert.deepEqual(locate(r, '10.0.0.1'), { country: null, region: null });
  assert.deepEqual(locate(r, 'keine ip'), { country: null, region: null });
  assert.deepEqual(locate({ get: () => { throw new Error('x'); } }, '1.2.3.4'), { country: null, region: null });
  assert.deepEqual(locate(null, '1.2.3.4'), { country: null, region: null });
});

test('a missing or unreadable database disables the location without an error', async (t) => {
  t.mock.method(console, 'warn', () => {});
  for (const file of [null, '', '/nicht/vorhanden.mmdb', new URL(import.meta.url).pathname]) {
    const geo = await openGeo(file);
    assert.deepEqual(geo.lookup('1.2.3.4'), { country: null, region: null });
  }
});
