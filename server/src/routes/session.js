import { Router } from 'express';
import { cleanContext } from '../../../src/shared/economy.js';
import { tx, lockUser } from '../db.js';
import { ApiError, MSG } from '../errors.js';
import { parseUserAgent } from '../ua.js';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function sessionRoutes({ pool, limits, auth, geo }) {
  const r = Router();

  r.post('/session', auth, limits.events, async (req, res) => {
    const body = req.body ?? {};
    if (!isObject(body)) throw new ApiError(400, MSG.badRequest);
    const uid = req.user.id;
    const [user] = await pool.query('SELECT consent_stats FROM users WHERE id = ?', [uid]);
    if (user?.consent_stats !== 1) return res.json({ ok: true });
    const ctx = cleanContext(body);
    const agent = parseUserAgent(req.get('user-agent'), { touch: ctx.touch === true });
    if (agent.bot) return res.json({ ok: true });
    const place = geo.lookup(req.ip);
    await tx(pool, async (conn) => {
      const locked = await lockUser(conn, uid, 'consent_stats');
      if (locked.consent_stats !== 1) return;
      await conn.query(
        `INSERT INTO play_sessions
           (user_id, session_no, started_at, last_active_at, tz_offset_min, time_zone, locale, device, os, browser,
            screen, touch, referrer, utm_source, utm_medium, utm_campaign, country, region)
         SELECT u.id, u.session_no, u.session_started_at, NOW(3), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
         FROM users u WHERE u.id = ?
         ON DUPLICATE KEY UPDATE play_sessions.last_active_at = NOW(3),
           play_sessions.tz_offset_min = COALESCE(VALUES(tz_offset_min), play_sessions.tz_offset_min),
           play_sessions.time_zone = COALESCE(VALUES(time_zone), play_sessions.time_zone),
           play_sessions.locale = COALESCE(VALUES(locale), play_sessions.locale),
           play_sessions.device = COALESCE(VALUES(device), play_sessions.device),
           play_sessions.os = COALESCE(VALUES(os), play_sessions.os),
           play_sessions.browser = COALESCE(VALUES(browser), play_sessions.browser),
           play_sessions.screen = COALESCE(VALUES(screen), play_sessions.screen),
           play_sessions.touch = COALESCE(VALUES(touch), play_sessions.touch),
           play_sessions.referrer = COALESCE(VALUES(referrer), play_sessions.referrer),
           play_sessions.utm_source = COALESCE(VALUES(utm_source), play_sessions.utm_source),
           play_sessions.utm_medium = COALESCE(VALUES(utm_medium), play_sessions.utm_medium),
           play_sessions.utm_campaign = COALESCE(VALUES(utm_campaign), play_sessions.utm_campaign),
           play_sessions.country = COALESCE(VALUES(country), play_sessions.country),
           play_sessions.region = IF(VALUES(country) IS NULL, play_sessions.region, VALUES(region))`,
        [
          ctx.tzOffset, ctx.timeZone, ctx.locale, agent.device, agent.os, agent.browser,
          ctx.screen, ctx.touch, ctx.referrer, ctx.utm.source, ctx.utm.medium, ctx.utm.campaign,
          place.country, place.region, uid,
        ],
      );
      if (ctx.tzOffset !== null) {
        await conn.query('UPDATE users SET tz_offset_min = ? WHERE id = ?', [ctx.tzOffset, uid]);
      }
    });
    res.json({ ok: true });
  });

  return r;
}
