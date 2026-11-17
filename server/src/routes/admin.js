import { Router } from 'express';
import { ACCOUNT, ADMIN } from '../../../src/shared/economy.js';
import { tx } from '../db.js';
import { ApiError, MSG } from '../errors.js';
import { authenticate, createSession, verifyPassword } from '../auth.js';
import { archiveUser } from '../analytics/archive.js';
import { refreshProfile } from '../analytics/profiles.js';
import { overview, activity, retention, segments, engagement, audience } from '../analytics/dashboard.js';
import { listPlayers, playerDetail, playerProfile, PLAYER_SORTS, PLAYER_FILTERS } from '../analytics/players.js';

const PLAYER_ID = /^[1-9][0-9]{0,9}$/;
const MAX_ID = 4294967295;

const bad = () => new ApiError(400, MSG.badRequest);

function intParam(value, fallback, min, max) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[0-9]{1,7}$/.test(value)) throw bad();
  const v = Number(value);
  if (v < min || v > max) throw bad();
  return v;
}

function choice(value, options, fallback = null) {
  if (value === undefined || value === '') return fallback;
  if (typeof value !== 'string' || !options.includes(value)) throw bad();
  return value;
}

function text(value, max) {
  if (value === undefined) return '';
  if (typeof value !== 'string' || value.length > max) throw bad();
  return value.trim();
}

function playerId(value) {
  if (!PLAYER_ID.test(value) || Number(value) > MAX_ID) throw new ApiError(404, MSG.notFound);
  return Number(value);
}

const days = (req, fallback) => intParam(req.query.days, fallback, 1, ADMIN.days.max);

export function adminRoutes({ pool, config, limits }) {
  const r = Router();

  r.post('/login', limits.login, limits.loginName, async (req, res) => {
    const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const valid = ACCOUNT.usernamePattern.test(username) && password.length <= ACCOUNT.passwordMax;
    const [user] = valid ? await pool.query('SELECT id, username, password_hash FROM users WHERE username = ?', [username]) : [];
    const ok = await verifyPassword(password.slice(0, ACCOUNT.passwordMax), user?.password_hash ?? null);
    if (!ok) throw new ApiError(401, MSG.badLogin);
    const token = await tx(pool, async (conn) => {
      const [locked] = await conn.query('SELECT is_admin FROM users WHERE id = ? FOR UPDATE', [user.id]);
      if (locked?.is_admin !== 1) throw new ApiError(403, MSG.forbidden);
      return createSession(conn, user.id, { hours: config.adminSessionHours, admin: true });
    });
    res.json({ token, username: user.username });
  });

  r.use(authenticate(pool, config, { touch: false }), limits.admin, (req, res, next) => {
    if (!req.user.admin || !req.adminSession) throw new ApiError(403, MSG.forbidden);
    next();
  });

  r.post('/logout', async (req, res) => {
    await pool.query('DELETE FROM sessions WHERE token_hash = ?', [req.tokenHash]);
    res.json({ ok: true });
  });

  r.get('/me', (req, res) => {
    res.json({ id: req.user.id, username: req.user.username });
  });

  r.get('/overview', async (req, res) => {
    res.json(await overview(pool, days(req, ADMIN.days.overview)));
  });

  r.get('/activity', async (req, res) => {
    res.json(await activity(pool, days(req, ADMIN.days.activity)));
  });

  r.get('/retention', async (req, res) => {
    res.json(await retention(pool, intParam(req.query.weeks, ADMIN.weeks.retention, 1, ADMIN.weeks.max)));
  });

  r.get('/segments', async (req, res) => {
    res.json(await segments(pool));
  });

  r.get('/engagement', async (req, res) => {
    res.json(await engagement(pool, days(req, ADMIN.days.engagement)));
  });

  r.get('/audience', async (req, res) => {
    res.json(await audience(pool, days(req, ADMIN.days.audience)));
  });

  r.get('/players', async (req, res) => {
    const filters = {
      q: text(req.query.q, ADMIN.maxQuery),
      segment: choice(req.query.segment, PLAYER_FILTERS.segments),
      type: choice(req.query.type, PLAYER_FILTERS.types),
      consent: choice(req.query.consent, PLAYER_FILTERS.consents),
      sort: choice(req.query.sort, Object.keys(PLAYER_SORTS), 'lastSeen'),
      dir: choice(req.query.dir, ['asc', 'desc'], 'desc'),
      page: intParam(req.query.page, 1, 1, ADMIN.maxPage),
    };
    res.json(await listPlayers(pool, filters));
  });

  r.get('/players/:id', async (req, res) => {
    const detail = await playerDetail(pool, playerId(req.params.id));
    if (!detail) throw new ApiError(404, MSG.notFound);
    res.json(detail);
  });

  r.post('/players/:id/recompute', async (req, res) => {
    const id = playerId(req.params.id);
    const [user] = await pool.query('SELECT consent_stats FROM users WHERE id = ?', [id]);
    if (!user) throw new ApiError(404, MSG.notFound);
    if (user.consent_stats !== 1 || !(await refreshProfile(pool, id))) throw new ApiError(409, MSG.noConsent);
    res.json({ profile: await playerProfile(pool, id) });
  });

  r.post('/players/:id/delete', async (req, res) => {
    const id = playerId(req.params.id);
    if (id === req.user.id) throw new ApiError(403, MSG.forbidden);
    await tx(pool, async (conn) => {
      const [target] = await conn.query('SELECT id, is_admin FROM users WHERE id = ? FOR UPDATE', [id]);
      if (!target) throw new ApiError(404, MSG.notFound);
      if (target.is_admin === 1) throw new ApiError(403, MSG.forbidden);
      await archiveUser(conn, id, 'admin');
      await conn.query('DELETE FROM users WHERE id = ?', [id]);
    });
    res.json({ ok: true });
  });

  return r;
}
