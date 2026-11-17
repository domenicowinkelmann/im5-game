import { loadConfig } from './config.js';
import { createPool } from './db.js';
import { createApp } from './app.js';
import { startJobs } from './jobs.js';
import { migrate } from './migrate.js';
import { openGeo } from './geo.js';

const config = loadConfig();

try {
  await migrate(config.db);
  console.log(`Schema ready in database "${config.db.database}"`);
} catch (e) {
  console.error('Database setup failed:', e.message);
  process.exit(1);
}

const pool = createPool(config.db);
const geo = await openGeo(config.geoipDb);
if (!config.geoipDb) console.log('GEOIP_DB not set, location disabled');
const app = createApp({ pool, config, geo });

const server = app.listen(config.port, (err) => {
  if (err) {
    console.error('Server start failed:', err.message);
    process.exit(1);
  }
  console.log(`Wingrush API listening on port ${config.port}`);
});

const jobs = startJobs(pool, config);

function shutdown() {
  jobs.stop();
  server.close(() => pool.end().finally(() => process.exit(0)));
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
