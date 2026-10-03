const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startHarness } = require('./helpers/harness');

let h;
before(async () => {
  h = await startHarness();
});
after(async () => {
  await h?.stop();
});

test('el esquema se crea desde cero con las migraciones y /health responde', async () => {
  const r = await h.request('GET', '/health');
  assert.equal(r.status, 200);
  assert.equal(r.body.db, 'ok');
});

test('el admin inicial puede ingresar y consultar el inventario', async () => {
  const token = await h.login('admin', h.ADMIN_PASSWORD);
  const r = await h.request('GET', '/api/inventory', { token });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body));
});

test('sin token la API responde 401', async () => {
  const r = await h.request('GET', '/api/inventory');
  assert.equal(r.status, 401);
});
