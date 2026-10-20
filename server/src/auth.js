import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { ApiError, MSG } from './errors.js';

const scrypt = promisify(scryptCb);
const N = 16384, R = 8, P = 1, KEYLEN = 64;
const BEARER = /^Bearer ([A-Za-z0-9_-]{43})$/;
const REFRESH_SECONDS = 86400;

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

const DUMMY_HASH = await hashPassword(randomBytes(16).toString('hex'));

export async function verifyPassword(password, stored) {
  const parts = (stored || DUMMY_HASH).split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, salt, hash] = parts;
  const expected = Buffer.from(hash, 'base64');
  const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, {
    N: Number(n), r: Number(r), p: Number(p),
  });
  return Boolean(stored) && timingSafeEqual(actual, expected);
}

export const hashToken = (token) => createHash('sha256').update(token).digest('hex');

export function readToken(req) {
  const match = BEARER.exec(req.get('authorization') || '');
  return match ? match[1] : null;
}

export async function createSession(conn, userId, days) {
  const token = randomBytes(32).toString('base64url');
  await conn.query(
    'INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, NOW(3) + INTERVAL ? DAY)',
    [hashToken(token), userId, days],
  );
  return token;
}

export function authenticate(pool, config, { optional = false } = {}) {
  return async (req, res, next) => {
    const token = readToken(req);
    const tokenHash = token && hashToken(token);
    const rows = tokenHash ? await pool.query(
      `SELECT s.user_id, u.username, TIMESTAMPDIFF(SECOND, s.refreshed_at, NOW(3)) AS age
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > NOW(3)`,
      [tokenHash],
    ) : [];
    if (!rows.length) {
      if (optional) return next();
      throw new ApiError(401, MSG.unauthorized);
    }
    const session = rows[0];
    if (session.age > REFRESH_SECONDS) {
      await pool.query(
        'UPDATE sessions SET refreshed_at = NOW(3), expires_at = NOW(3) + INTERVAL ? DAY WHERE token_hash = ?',
        [config.sessionDays, tokenHash],
      );
      await pool.query('UPDATE users SET last_seen_at = NOW(3) WHERE id = ?', [session.user_id]);
    }
    req.user = { id: session.user_id, username: session.username };
    req.tokenHash = tokenHash;
    next();
  };
}
