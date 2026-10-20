import mariadb from 'mariadb';
import { loadConfig } from '../src/config.js';

const config = loadConfig();
const { host, port, user, database } = config.db;
console.log(`Connecting to ${user}@${host}:${port}/${database} ...`);

let conn;
try {
  conn = await mariadb.createConnection({ ...config.db, connectTimeout: 8000 });
  const [{ version }] = await conn.query('SELECT VERSION() AS version');
  const tables = (await conn.query('SHOW TABLES')).map((row) => Object.values(row)[0]);
  console.log(`OK, MariaDB ${version}`);
  console.log(tables.length ? `Tables: ${tables.join(', ')}` : 'No tables yet, run: npm run db:init');
} catch (e) {
  console.error(`Connection failed: ${e.code ?? ''} ${e.message}`);
  process.exitCode = 1;
} finally {
  await conn?.end();
}
