import { cleanup } from './cleanup.js';
import { purgeRaw } from './analytics/purge.js';
import { refreshProfiles } from './analytics/profiles.js';

function exclusive(name, task) {
  let running = false;
  return async () => {
    if (running) return false;
    running = true;
    try {
      await task();
    } catch (e) {
      console.error(`${name} failed:`, e.message);
    } finally {
      running = false;
    }
    return true;
  };
}

export function startJobs(pool, config) {
  const run = exclusive('Jobs', async () => {
    const { guests } = await cleanup(pool, config);
    if (guests) console.log(`Archived and removed ${guests} inactive guests`);
  });
  const profiles = exclusive('Profiles', async () => {
    await refreshProfiles(pool, { limit: config.jobs.profileBatch, maxAgeHours: config.jobs.profileMaxAgeHours });
  });
  const purge = exclusive('Purge', async () => {
    const { events, sessions, decisions, profiles: stale } = await purgeRaw(pool, { batch: config.jobs.purgeBatch });
    if (events || sessions || decisions || stale) {
      console.log(`Purged ${events} events, ${sessions} play sessions, ${decisions} decisions and ${stale} profiles`);
    }
  });
  run();
  profiles();
  purge();
  const timers = [
    setInterval(run, config.jobs.intervalMinutes * 60 * 1000),
    setInterval(profiles, config.jobs.intervalMinutes * 60 * 1000),
    setInterval(purge, config.jobs.purgeHours * 3600 * 1000),
  ];
  timers.forEach((t) => t.unref());
  return { run, profiles, purge, stop: () => timers.forEach((t) => clearInterval(t)) };
}
