import mariadb from 'mariadb';

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
