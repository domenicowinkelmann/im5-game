import { loadConfig } from './config.js';
import { createPool } from './db.js';
import { createApp } from './app.js';
import { cleanup } from './cleanup.js';

const config = loadConfig();
const pool = createPool(config.db);
const app = createApp({ pool, config });

const server = app.listen(config.port, () => {
  console.log(`Wingrush API listening on port ${config.port}`);
});

const runCleanup = () => cleanup(pool, config).catch((e) => console.error('Cleanup failed:', e.message));
runCleanup();
setInterval(runCleanup, 24 * 60 * 60 * 1000).unref();

function shutdown() {
  server.close(() => pool.end().finally(() => process.exit(0)));
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
