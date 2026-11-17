import mariadb from 'mariadb';
import { ApiError, MSG } from './errors.js';

// mariadb converts Date values with the Node time zone, so it has to match the UTC session
process.env.TZ = 'UTC';

export function createPool(db) {
  return mariadb.createPool({
    ...db,
    connectionLimit: 5,
    acquireTimeout: 10000,
    idleTimeout: 60,
    timezone: 'Z',
    bigIntAsNumber: true,
    insertIdAsNumber: true,
    decimalAsNumber: true,
  });
}

export async function withConn(pool, fn) {
  const conn = await pool.getConnection();
  try {
    return await fn(conn);
  } finally {
    conn.release();
  }
}

export async function tx(pool, fn) {
  return withConn(pool, async (conn) => {
    await conn.beginTransaction();
    try {
      const result = await fn(conn);
      await conn.commit();
      return result;
    } catch (e) {
      await conn.rollback().catch(() => {});
      throw e;
    }
  });
}

export async function lockUser(conn, userId, columns = 'id') {
  const [user] = await conn.query(`SELECT ${columns} FROM users WHERE id = ? FOR UPDATE`, [userId]);
  if (!user) throw new ApiError(401, MSG.unauthorized);
  return user;
}

export function asJson(v) {
  if (v == null) return null;
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}
