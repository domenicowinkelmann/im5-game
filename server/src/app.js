import express from 'express';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ApiError, MSG } from './errors.js';
import { authenticate } from './auth.js';
import { createLimiters } from './limits.js';
import { authRoutes } from './routes/auth.js';
import { gameRoutes } from './routes/game.js';

const DIST = fileURLToPath(new URL('../../dist', import.meta.url));

function cors(origins) {
  return (req, res, next) => {
    const origin = req.get('origin');
    if (origin && origins.includes(origin)) {
      res.set({
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Max-Age': '600',
        Vary: 'Origin',
      });
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  };
}

export function createApp({ pool, config }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  const limits = createLimiters(config);
  const auth = authenticate(pool, config);
  const optionalAuth = authenticate(pool, config, { optional: true });

  const api = express.Router();
  if (config.corsOrigins.length) api.use(cors(config.corsOrigins));
  api.use(express.json({ limit: '8kb' }));
  api.use('/auth', authRoutes({ pool, config, limits, auth, optionalAuth }));
  api.use(gameRoutes({ pool, limits, auth }));
  api.use((req, res) => res.status(404).json({ error: MSG.notFound }));
  app.use('/api', api);

  if (existsSync(DIST)) app.use(express.static(DIST));

  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err instanceof ApiError) return res.status(err.status).json({ error: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: MSG.badRequest });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: MSG.tooLarge });
    console.error(err);
    res.status(500).json({ error: MSG.server });
  });

  return app;
}
