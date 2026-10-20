import { rateLimit } from 'express-rate-limit';
import { MSG } from './errors.js';

const handler = (req, res) => res.status(429).json({ error: MSG.tooMany });

export function createLimiters(config) {
  const scale = config.isTest ? 1000 : 1;
  const make = (minutes, limit, keyGenerator) => rateLimit({
    windowMs: minutes * 60 * 1000,
    limit: limit * scale,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler,
    ...(keyGenerator ? { keyGenerator } : {}),
  });
  const byUser = (prefix) => (req) => `${prefix}:${req.user.id}`;
  return {
    guest: make(10, 30),
    signup: make(60, 10),
    login: make(15, 20),
    loginName: make(15, 10, (req) => `name:${String(req.body?.username ?? '').trim().toLowerCase()}`),
    play: make(1, 60, byUser('play')),
    events: make(1, 120, byUser('events')),
  };
}
