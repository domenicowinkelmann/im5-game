import { readFile } from 'node:fs/promises';
import mariadb from 'mariadb';
import { loadConfig } from '../src/config.js';

const config = loadConfig();
const sql = await readFile(new URL('../sql/schema.sql', import.meta.url), 'utf8');
const conn = await mariadb.createConnection({ ...config.db, multipleStatements: true });

try {
  await conn.query(sql);
  console.log(`Schema ready in database "${config.db.database}"`);
} finally {
  await conn.end();
}
