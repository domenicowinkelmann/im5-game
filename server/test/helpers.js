import { readFile } from 'node:fs/promises';
import mariadb from 'mariadb';
import { loadConfig } from '../src/config.js';
import { createPool } from '../src/db.js';
import { createApp } from '../src/app.js';

const TABLES = ['events', 'spins', 'runs', 'loadout', 'inventory', 'sessions', 'users'];

export async function resetDatabase(config) {
  const sql = await readFile(new URL('../sql/schema.sql', import.meta.url), 'utf8');
  const conn = await mariadb.createConnection({ ...config.db, multipleStatements: true });
  try {
    await conn.query(`DROP TABLE IF EXISTS ${TABLES.join(', ')}`);
    await conn.query(sql);
  } finally {
    await conn.end();
  }
}

export async function startServer() {
  const config = loadConfig();
  await resetDatabase(config);
  const pool = createPool(config.db);
  const server = createApp({ pool, config }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;

  async function call(method, path, { body, token, raw } = {}) {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(body !== undefined || raw !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
    });
    return { status: res.status, body: await res.json() };
  }

  async function stop() {
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  }

  return { call, pool, stop };
}
