import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import mariadb from 'mariadb';

const VERSION = '10.11.19';
const SHA256 = '398ea30e5036010bbebe01d2b1804280424dcc2626e36d8e95155c04d25a0490';
const PKG = `mariadb-${VERSION}-winx64`;
const ZIP_URL = `https://archive.mariadb.org/mariadb-${VERSION}/winx64-packages/${PKG}.zip`;
const BASE = fileURLToPath(new URL('../../../mariadb/', import.meta.url));
const BIN = join(BASE, PKG, 'bin');
const DATA = join(BASE, 'data');
const ENV_FILE = fileURLToPath(new URL('../.env', import.meta.url));
const HOST = '127.0.0.1';
const LOCAL_HOSTS = ['127.0.0.1', 'localhost'];
const IDENT = /^\w{1,64}$/;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function portOpen(port) {
  return new Promise((resolve) => {
    const socket = connect({ host: HOST, port });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
  });
}

async function waitPort(port, open, seconds) {
  for (let i = 0; i < seconds * 4; i++) {
    if ((await portOpen(port)) === open) return true;
    await sleep(250);
  }
  return false;
}

const rootConn = (port) => mariadb.createConnection({ host: HOST, port, user: 'root', password: '', connectTimeout: 3000 });

function ensureEnvFile() {
  if (existsSync(ENV_FILE)) return false;
  const lines = [
    'PORT=3000',
    `DB_HOST=${HOST}`,
    'DB_PORT=3306',
    'DB_USER=wingrush',
    `DB_PASSWORD=${randomBytes(18).toString('base64url')}`,
    'DB_NAME=wingrush',
    'DB_NAME_TEST=wingrush_test',
    'TRUST_PROXY=',
    'CORS_ORIGIN=',
  ];
  writeFileSync(ENV_FILE, `${lines.join('\n')}\n`);
  return true;
}

async function localConfig({ withTest = false } = {}) {
  const { loadConfig } = await import('../src/config.js');
  const main = loadConfig();
  if (!LOCAL_HOSTS.includes(main.db.host)) {
    throw new Error(`DB_HOST is ${main.db.host}. local-db only manages a database on ${HOST}, check server/.env or run setup.`);
  }
  const test = withTest ? loadConfig({ ...process.env, NODE_ENV: 'test' }) : null;
  return { main, test };
}

function requireInstall() {
  if (!existsSync(join(BIN, 'mariadbd.exe')) || !existsSync(join(DATA, 'my.ini'))) {
    throw new Error('Local MariaDB is not set up yet, run: npm run db:local:setup');
  }
}

async function download() {
  const zip = join(BASE, `${PKG}.zip`);
  if (!existsSync(zip)) {
    console.log(`Downloading ${ZIP_URL} ...`);
    const res = await fetch(ZIP_URL);
    if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
    await pipeline(Readable.fromWeb(res.body), createWriteStream(`${zip}.part`));
    renameSync(`${zip}.part`, zip);
  }
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(zip)) hash.update(chunk);
  if (hash.digest('hex') !== SHA256) {
    rmSync(zip);
    throw new Error('Checksum mismatch, the download was removed. Run setup again.');
  }
  return zip;
}

function extract(zip) {
  if (existsSync(join(BIN, 'mariadbd.exe'))) return;
  console.log(`Extracting to ${BASE} ...`);
  const tar = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  execFileSync(tar, ['-xf', zip, '-C', BASE], { stdio: 'inherit' });
}

function initData(port) {
  if (existsSync(join(DATA, 'my.ini'))) return;
  if (existsSync(DATA) && readdirSync(DATA).length) throw new Error(`${DATA} exists but has no my.ini, remove it and run setup again.`);
  console.log(`Creating data directory ${DATA} ...`);
  execFileSync(join(BIN, 'mariadb-install-db.exe'), [`--datadir=${DATA}`, `--port=${port}`], { stdio: 'inherit' });
}

async function startServer(port) {
  if (await portOpen(port)) {
    console.log(`Port ${port} is already in use, MariaDB seems to be running.`);
    return;
  }
  const child = spawn(join(BIN, 'mariadbd.exe'), [
    `--defaults-file=${join(DATA, 'my.ini')}`,
    `--bind-address=${HOST}`,
    `--port=${port}`,
    '--character-set-server=utf8mb4',
    '--collation-server=utf8mb4_unicode_ci',
  ], { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
  if (!(await waitPort(port, true, 30))) throw new Error(`MariaDB did not start, see the .err file in ${DATA}`);
  console.log(`MariaDB ${VERSION} running on ${HOST}:${port}`);
}

async function setup() {
  if (ensureEnvFile()) console.log('Created server/.env with local credentials.');
  const { main, test } = await localConfig({ withTest: true });
  const { port, user, password } = main.db;
  const databases = [main.db.database, test.db.database];
  for (const name of [user, ...databases]) {
    if (!IDENT.test(name)) throw new Error(`Invalid name "${name}" in server/.env, only letters, digits and _ are allowed.`);
  }
  mkdirSync(BASE, { recursive: true });
  extract(await download());
  initData(port);
  await startServer(port);
  const conn = await rootConn(port);
  try {
    for (const name of databases) {
      await conn.query(`CREATE DATABASE IF NOT EXISTS \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    }
    for (const host of LOCAL_HOSTS) {
      await conn.query('CREATE USER IF NOT EXISTS ?@? IDENTIFIED BY ?', [user, host, password]);
      await conn.query('ALTER USER ?@? IDENTIFIED BY ?', [user, host, password]);
      for (const name of databases) await conn.query(`GRANT ALL PRIVILEGES ON \`${name}\`.* TO ?@?`, [user, host]);
    }
  } finally {
    await conn.end();
  }
  console.log(`Ready: databases ${databases.join(', ')} for user ${user}. Tables are created when the server starts.`);
}

async function start() {
  const { main } = await localConfig();
  requireInstall();
  await startServer(main.db.port);
}

async function stop() {
  const { main } = await localConfig();
  const { port } = main.db;
  if (!(await portOpen(port))) {
    console.log('MariaDB is not running.');
    return;
  }
  const conn = await rootConn(port);
  await conn.query('SHUTDOWN').catch(() => {});
  conn.destroy();
  if (!(await waitPort(port, false, 30))) throw new Error('MariaDB did not stop within 30 s.');
  console.log('MariaDB stopped.');
}

async function status() {
  const { main } = await localConfig();
  const { port } = main.db;
  try {
    const conn = await rootConn(port);
    const [{ version }] = await conn.query('SELECT VERSION() AS version');
    await conn.end();
    console.log(`Running: MariaDB ${version} on ${HOST}:${port}`);
  } catch {
    console.log(`Not running on ${HOST}:${port}`);
    process.exitCode = 1;
  }
}

const COMMANDS = { setup, start, stop, status };
const command = process.argv[2];

if (process.platform !== 'win32') {
  console.error('local-db is for Windows. On macOS install MariaDB with brew, see README.');
  process.exit(1);
}
if (!COMMANDS[command]) {
  console.error(`Usage: node scripts/local-db.js <${Object.keys(COMMANDS).join('|')}>`);
  process.exit(1);
}
try {
  await COMMANDS[command]();
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
