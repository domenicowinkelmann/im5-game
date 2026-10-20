import { loadConfig } from './config.js';
import { createPool } from './db.js';
import { createApp } from './app.js';
import { cleanup } from './cleanup.js';
import { migrate } from './migrate.js';

const config = loadConfig();

try {
  await migrate(config.db);
  console.log(`Schema ready in database "${config.db.database}"`);
} catch (e) {
  console.error('Database setup failed:', e.message);
  process.exit(1);
}

const pool = createPool(config.db);
const app = createApp({ pool, config });

const server = app.listen(config.port, (err) => {
  if (err) {
    console.error('Server start failed:', err.message);
    process.exit(1);
  }
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
