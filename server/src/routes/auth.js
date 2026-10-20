import { Router } from 'express';
import { START_COINS, ACCOUNT } from '../../../src/shared/economy.js';
import { tx } from '../db.js';
import { ApiError, MSG } from '../errors.js';
import { hashPassword, verifyPassword, createSession } from '../auth.js';
import { loadProfile } from '../profile.js';

function credentials(body) {
  return {
    username: typeof body?.username === 'string' ? body.username.trim() : '',
    password: typeof body?.password === 'string' ? body.password : '',
  };
}

export function authRoutes({ pool, config, limits, auth, optionalAuth }) {
  const r = Router();

  r.post('/guest', limits.guest, async (req, res) => {
    res.json(await tx(pool, async (conn) => {
      const { insertId } = await conn.query('INSERT INTO users (coins) VALUES (?)', [START_COINS]);
      const token = await createSession(conn, insertId, config.sessionDays);
      return { token, profile: await loadProfile(conn, insertId) };
    }));
  });

  r.post('/signup', limits.signup, auth, async (req, res) => {
    const { username, password } = credentials(req.body);
    if (!ACCOUNT.usernamePattern.test(username)) throw new ApiError(400, MSG.username);
    if (password.length < ACCOUNT.passwordMin || password.length > ACCOUNT.passwordMax) {
      throw new ApiError(400, MSG.password);
    }
    if (req.user.username !== null) throw new ApiError(409, MSG.alreadyRegistered);
    const hash = await hashPassword(password);
    try {
      res.json(await tx(pool, async (conn) => {
        const result = await conn.query(
          'UPDATE users SET username = ?, password_hash = ? WHERE id = ? AND username IS NULL',
          [username, hash, req.user.id],
        );
        if (result.affectedRows !== 1) throw new ApiError(409, MSG.alreadyRegistered);
        await conn.query('DELETE FROM sessions WHERE user_id = ?', [req.user.id]);
        const token = await createSession(conn, req.user.id, config.sessionDays);
        return { token, profile: await loadProfile(conn, req.user.id) };
      }));
    } catch (e) {
      if (e.errno === 1062) throw new ApiError(409, MSG.usernameTaken);
      throw e;
    }
  });

  r.post('/login', limits.login, limits.loginName, optionalAuth, async (req, res) => {
    const { username, password } = credentials(req.body);
    const valid = ACCOUNT.usernamePattern.test(username) && password.length <= ACCOUNT.passwordMax;
    const [user] = valid ? await pool.query('SELECT id, password_hash FROM users WHERE username = ?', [username]) : [];
    const ok = await verifyPassword(password.slice(0, ACCOUNT.passwordMax), user?.password_hash ?? null);
    if (!ok) throw new ApiError(401, MSG.badLogin);
    res.json(await tx(pool, async (conn) => {
      if (req.user?.username === null) {
        await conn.query('DELETE FROM users WHERE id = ? AND username IS NULL', [req.user.id]);
      } else if (req.user) {
        await conn.query('DELETE FROM sessions WHERE token_hash = ?', [req.tokenHash]);
      }
      const token = await createSession(conn, user.id, config.sessionDays);
      return { token, profile: await loadProfile(conn, user.id) };
    }));
  });

  r.post('/logout', auth, async (req, res) => {
    await pool.query('DELETE FROM sessions WHERE token_hash = ?', [req.tokenHash]);
    res.json({ ok: true });
  });

  return r;
}
