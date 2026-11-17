import { Router } from 'express';
import { ACCOUNT, PRIVACY } from '../../../src/shared/economy.js';
import { tx, lockUser } from '../db.js';
import { ApiError, MSG } from '../errors.js';
import { verifyPassword } from '../auth.js';
import { loadProfile } from '../profile.js';
import { archiveUser } from '../analytics/archive.js';
import { purgeAnalytics } from '../analytics/privacy.js';

const isBool = (v) => typeof v === 'boolean';

export function privacyRoutes({ pool, limits, auth }) {
  const r = Router();

  r.post('/consent', auth, limits.events, async (req, res) => {
    const { stats, personal, adult } = req.body ?? {};
    if (![stats, personal, adult].every(isBool)) throw new ApiError(400, MSG.badRequest);
    const uid = req.user.id;
    res.json(await tx(pool, async (conn) => {
      const user = await lockUser(conn, uid, 'consent_stats');
      const statsAt = !stats ? 'NULL' : user.consent_stats === 1 ? 'consent_stats_at' : 'NOW(3)';
      await conn.query(
        `UPDATE users SET consent_stats_at = ${statsAt}, consent_version = ?, consent_stats = ?, consent_personal = ?,
           age_16plus = ?, consent_at = NOW(3)
         WHERE id = ?`,
        [PRIVACY.version, stats, personal && stats && adult, adult, uid],
      );
      if (!stats && user.consent_stats === 1) await purgeAnalytics(conn, uid);
      return { profile: await loadProfile(conn, uid) };
    }));
  });

  r.post('/account/delete', auth, limits.accountDelete, async (req, res) => {
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const uid = req.user.id;
    const [user] = await pool.query('SELECT username, password_hash FROM users WHERE id = ?', [uid]);
    if (!user) throw new ApiError(401, MSG.unauthorized);
    if (user.username !== null) {
      const ok = password.length > 0 && password.length <= ACCOUNT.passwordMax
        && await verifyPassword(password, user.password_hash);
      if (!ok) throw new ApiError(400, MSG.badPassword);
    }
    await tx(pool, async (conn) => {
      const locked = await lockUser(conn, uid, 'username');
      if (locked.username !== user.username) throw new ApiError(400, MSG.badPassword);
      await archiveUser(conn, uid, 'deleted');
      await conn.query('DELETE FROM users WHERE id = ?', [uid]);
    });
    res.json({ ok: true });
  });

  return r;
}
