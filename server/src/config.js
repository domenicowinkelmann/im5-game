import { fileURLToPath } from 'node:url';

const ENV_FILES = [
  fileURLToPath(new URL('../.env', import.meta.url)),
  fileURLToPath(new URL('../../../wingrush.env', import.meta.url)),
];

for (const file of ENV_FILES) {
  try { process.loadEnvFile(file); } catch {}
}

function required(name) {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`Missing env var ${name}`);
  return value;
}

export function loadConfig() {
  const env = process.env;
  const isTest = env.NODE_ENV === 'test';
  const database = isTest ? required('DB_NAME_TEST') : required('DB_NAME');
  if (isTest && !database.endsWith('_test')) throw new Error('DB_NAME_TEST must end with _test');
  return {
    isTest,
    port: Number(env.PORT) || 3000,
    trustProxy: Number(env.TRUST_PROXY) || false,
    corsOrigins: (env.CORS_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean),
    sessionDays: 90,
    guestRetentionDays: 180,
    db: {
      host: env.DB_HOST || '127.0.0.1',
      port: Number(env.DB_PORT) || 3306,
      user: required('DB_USER'),
      password: env.DB_PASSWORD ?? '',
      database,
    },
  };
}
