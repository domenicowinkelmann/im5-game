import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

let app;
before(async () => { app = await startServer(); });
after(async () => { await app.stop(); });

const asText = (d) => d.toISOString().slice(0, 23).replace('T', ' ');

test('dates read from the database are real UTC instants', async () => {
  const [row] = await app.pool.query('SELECT NOW(3) AS d, CAST(NOW(3) AS CHAR) AS s');
  assert.equal(asText(row.d), row.s);
  assert.ok(Math.abs(row.d.getTime() - Date.now()) < 60000);
});

test('dates sent to the database keep their UTC value in summer and winter', async () => {
  for (const iso of ['2026-07-15T12:00:00.000Z', '2026-11-17T12:00:00.000Z', '2026-03-29T01:30:00.000Z']) {
    const [row] = await app.pool.query("SELECT DATE_FORMAT(?, '%Y-%m-%d %H:%i:%s') AS back", [new Date(iso)]);
    assert.equal(row.back, iso.slice(0, 19).replace('T', ' '));
  }
});
