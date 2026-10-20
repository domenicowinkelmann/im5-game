import { readFile } from 'node:fs/promises';
import mariadb from 'mariadb';

const SCHEMA = new URL('../sql/schema.sql', import.meta.url);

export async function migrate(db) {
  const sql = await readFile(SCHEMA, 'utf8');
  const conn = await mariadb.createConnection({ ...db, multipleStatements: true });
  try {
    await conn.query(sql);
  } finally {
    await conn.end();
  }
}
