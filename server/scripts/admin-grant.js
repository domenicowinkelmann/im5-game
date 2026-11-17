import mariadb from 'mariadb';
import { pathToFileURL } from 'node:url';
import { loadConfig } from '../src/config.js';
import { migrate } from '../src/migrate.js';
import { ACCOUNT } from '../../src/shared/economy.js';

const USAGE = 'Usage: npm run admin:grant -- [--revoke] [--yes] <username>  (use "-- <username>" for names that look like flags)';
const FLAGS = ['--revoke', '--yes'];

export function parseArgs(args) {
  const split = args.indexOf('--');
  const head = split === -1 ? args : args.slice(0, split);
  const tail = split === -1 ? [] : args.slice(split + 1);
  const names = [...head.filter((a) => !FLAGS.includes(a)), ...tail];
  if (names.length !== 1 || !ACCOUNT.usernamePattern.test(names[0])) return null;
  return { username: names[0], revoke: head.includes('--revoke'), apply: head.includes('--yes') };
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

async function hasColumn(conn, database) {
  const [{ n }] = await conn.query(
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users' AND COLUMN_NAME = 'is_admin'`,
    [database],
  );
  return Number(n) === 1;
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed) fail(USAGE);
  const { username, revoke, apply } = parsed;
  const config = loadConfig();
  const { host, port, user, database } = config.db;
  console.log(`Target database: ${user}@${host}:${port}/${database}`);

  let conn;
  try {
    conn = await mariadb.createConnection({ ...config.db, connectTimeout: 8000 });
    const ready = await hasColumn(conn, database);
    if (!ready && apply) {
      await conn.end();
      conn = null;
      await migrate(config.db);
      console.log('Schema migrated (column users.is_admin added)');
      conn = await mariadb.createConnection({ ...config.db, connectTimeout: 8000 });
    }
    const [account] = await conn.query(
      `SELECT id, username, ${ready || apply ? 'is_admin' : '0 AS is_admin'} FROM users WHERE username = ? AND username IS NOT NULL`,
      [username],
    );
    if (!account) fail(`No registered account named "${username}" (guests cannot become admins, register in the game first)`);
    const label = `"${account.username}" (id ${account.id})`;
    const target = revoke ? 0 : 1;
    if (account.is_admin === target) {
      console.log(`${label} ${revoke ? 'has no admin rights' : 'is already an admin'}, nothing to do`);
    } else if (!apply) {
      if (!ready) console.log('Column users.is_admin is missing, it would be added by the schema migration');
      console.log(`Dry run: would ${revoke ? 'revoke admin rights from' : 'grant admin rights to'} ${label}${revoke ? ' and end its admin sessions' : ''}`);
      console.log('Run again with --yes to apply');
    } else {
      await conn.beginTransaction();
      await conn.query('UPDATE users SET is_admin = ? WHERE id = ?', [target, account.id]);
      const { affectedRows: ended } = revoke
        ? await conn.query('DELETE FROM sessions WHERE user_id = ? AND admin = 1', [account.id])
        : { affectedRows: 0 };
      await conn.commit();
      console.log(revoke ? `Revoked admin rights from ${label}, ended ${ended} admin sessions` : `Granted admin rights to ${label}`);
      if (!revoke) console.log('Sign in at /admin with the game password of this account');
    }
  } catch (e) {
    console.error(`Failed: ${e.code ?? ''} ${e.message}`);
    process.exitCode = 1;
  } finally {
    await conn?.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
