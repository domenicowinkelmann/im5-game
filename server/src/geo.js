import maxmind from 'maxmind';

const CANTONS = {
  ZH: ['Zürich', 'Zurich', 'Zuerich', 'Zurigo', 'Turitg'],
  BE: ['Bern', 'Berne', 'Berna'],
  LU: ['Luzern', 'Lucerne', 'Lucerna'],
  UR: ['Uri'],
  SZ: ['Schwyz', 'Schwytz', 'Svitto'],
  OW: ['Obwalden', 'Obwald', 'Obvaldo'],
  NW: ['Nidwalden', 'Nidwald', 'Nidvaldo'],
  GL: ['Glarus', 'Glaris', 'Glarona'],
  ZG: ['Zug', 'Zoug', 'Zugo'],
  FR: ['Freiburg', 'Fribourg', 'Friburgo'],
  SO: ['Solothurn', 'Soleure', 'Soletta'],
  BS: ['Basel-Stadt', 'Bâle-Ville', 'Basilea Città', 'Basel-City', 'Basle-City', 'Basel'],
  BL: ['Basel-Landschaft', 'Basel-Land', 'Bâle-Campagne', 'Basilea Campagna', 'Basel-Country', 'Basle-Country'],
  SH: ['Schaffhausen', 'Schaffhouse', 'Sciaffusa'],
  AR: ['Appenzell Ausserrhoden', 'Appenzell Rhodes-Extérieures', 'Appenzello Esterno', 'Appenzell Outer Rhodes', 'Appenzell Outer-Rhodes'],
  AI: ['Appenzell Innerrhoden', 'Appenzell Rhodes-Intérieures', 'Appenzello Interno', 'Appenzell Inner Rhodes', 'Appenzell Inner-Rhodes'],
  SG: ['St. Gallen', 'Sankt Gallen', 'Saint-Gall', 'San Gallo', 'Saint Gallen'],
  GR: ['Graubünden', 'Graubuenden', 'Grisons', 'Grigioni', 'Grischun'],
  AG: ['Aargau', 'Argovie', 'Argovia'],
  TG: ['Thurgau', 'Thurgovie', 'Turgovia'],
  TI: ['Tessin', 'Ticino'],
  VD: ['Waadt', 'Vaud'],
  VS: ['Wallis', 'Valais', 'Vallese'],
  NE: ['Neuenburg', 'Neuchâtel'],
  GE: ['Genf', 'Genève', 'Geneva', 'Ginevra'],
  JU: ['Jura', 'Giura'],
};

const PREFIX = /^(canton|kanton|cantone|chantun|republic and canton|republique et canton)( of| de| du| des| di| del| d)? /;

export function normalizeName(name) {
  return String(name ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .trim()
    .replace(PREFIX, '');
}

const BY_NAME = new Map(
  Object.entries(CANTONS).flatMap(([code, names]) => names.map((n) => [normalizeName(n), code])),
);

export const CANTON_CODES = Object.keys(CANTONS);

export function cantonCode(name) {
  return BY_NAME.get(normalizeName(name)) ?? null;
}

const NOWHERE = Object.freeze({ country: null, region: null });

function regionOf(subdivision) {
  if (!subdivision) return null;
  const iso = String(subdivision.iso_code ?? '').toUpperCase();
  if (CANTON_CODES.includes(iso)) return iso;
  for (const name of Object.values(subdivision.names ?? {})) {
    const code = cantonCode(name);
    if (code) return code;
  }
  return null;
}

export function locate(reader, ip) {
  if (!reader || typeof ip !== 'string') return NOWHERE;
  const address = ip.replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, '');
  if (!maxmind.validate(address)) return NOWHERE;
  let record;
  try { record = reader.get(address); } catch { return NOWHERE; }
  const iso = String(record?.country?.iso_code ?? '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(iso)) return NOWHERE;
  return { country: iso, region: iso === 'CH' ? regionOf(record.subdivisions?.[0]) : null };
}

export const noGeo = Object.freeze({ lookup: () => NOWHERE });

export async function openGeo(file) {
  if (!file) return noGeo;
  try {
    const reader = await maxmind.open(file);
    return { lookup: (ip) => locate(reader, ip) };
  } catch {
    console.warn('GeoIP database not readable, location disabled');
    return noGeo;
  }
}
