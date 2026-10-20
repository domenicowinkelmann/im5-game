import { loadConfig } from '../src/config.js';
import { migrate } from '../src/migrate.js';

const config = loadConfig();
await migrate(config.db);
console.log(`Schema ready in database "${config.db.database}"`);
