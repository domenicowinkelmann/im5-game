import { cleanup } from './cleanup.js';

export function startJobs(pool, config) {
  let running = false;
  async function run() {
    if (running) return false;
    running = true;
    try {
      const { guests } = await cleanup(pool, config);
      if (guests) console.log(`Archived and removed ${guests} inactive guests`);
    } catch (e) {
      console.error('Jobs failed:', e.message);
    } finally {
      running = false;
    }
    return true;
  }
  run();
  const timer = setInterval(run, config.jobs.intervalMinutes * 60 * 1000);
  timer.unref();
  return { run, stop: () => clearInterval(timer) };
}
