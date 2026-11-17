import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import maxmind from 'maxmind';
import { geoipPath } from '../src/config.js';
import { locate } from '../src/geo.js';

const SOURCE = 'https://download.db-ip.com/free/dbip-city-lite-';
const PROBE = '8.8.8.8';

function month(offset) {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - offset);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function download(part) {
  for (const offset of [0, 1]) {
    const url = `${SOURCE}${month(offset)}.mmdb.gz`;
    const res = await fetch(url);
    if (res.status === 404) {
      console.log(`Not available yet: ${url}`);
      continue;
    }
    if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}): ${url}`);
    console.log(`Downloading ${url} ...`);
    await pipeline(Readable.fromWeb(res.body), createGunzip(), createWriteStream(part));
    return url;
  }
  throw new Error('No DB-IP City Lite file found for this or the previous month');
}

async function update(target) {
  const part = `${target}.part`;
  await mkdir(dirname(target), { recursive: true });
  try {
    await download(part);
    const reader = await maxmind.open(part);
    const probe = locate(reader, PROBE);
    if (!probe.country) throw new Error(`Test lookup for ${PROBE} returned no country`);
    await rename(part, target);
    console.log(`GeoIP database ready: ${target} (test ${PROBE} -> ${probe.country})`);
    console.log('Restart the server to load the new file.');
  } catch (e) {
    await rm(part, { force: true });
    throw e;
  }
}

async function check(target, ips) {
  const reader = await maxmind.open(target);
  for (const ip of ips) {
    let raw = null;
    try { raw = maxmind.validate(ip) ? reader.get(ip) : null; } catch {}
    console.log(JSON.stringify({
      ip,
      country: raw?.country?.iso_code ?? null,
      subdivisions: raw?.subdivisions?.map((s) => s.names) ?? null,
      result: locate(reader, ip),
    }, null, 2));
  }
}

const target = geoipPath();
if (!target) {
  console.error('GEOIP_DB is not set (e.g. GEOIP_DB=../geoip/dbip-city-lite.mmdb in server/.env)');
  process.exit(1);
}

const args = process.argv.slice(2);
try {
  if (args[0] === '--check') await check(target, args.length > 1 ? args.slice(1) : [PROBE]);
  else await update(target);
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
