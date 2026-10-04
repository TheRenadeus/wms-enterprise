// Sandbox de demostración APAGADO (instalación normal de un cliente).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { startHarness } = require('./helpers/harness');

let h;
before(async () => {
  delete process.env.DEMO_SANDBOX;
  h = await startHarness();
});
after(async () => {
  await h?.stop();
});

test('el login demo no es público', async () => {
  const r = await h.request('POST', '/api/demo/login', { body: { scenario: '3PL', role: 'ADMIN' } });
  assert.ok([401, 404].includes(r.status), `esperaba 401/404, llegó ${r.status}`);
  assert.equal(r.body?.token, undefined);
});

test('un token demo emitido antes (firmado con el secreto real) se rechaza', async () => {
  const token = jwt.sign(
    { username: 'sandbox_admin', role: 'ADMIN', allowed_clients: 'ALL', allowed_modules: 'ALL', is_demo: true },
    process.env.JWT_SECRET,
    { expiresIn: '30d' },
  );
  for (const url of ['/api/export/clients', '/api/inventory', '/api/users', '/api/system/config']) {
    const r = await h.request('GET', url, { token });
    assert.equal(r.status, 401, `${url} respondió ${r.status}`);
  }
});

test('/system/config no entrega claves internas', async () => {
  await h.pool.query(
    `INSERT INTO system_config (key, value) VALUES ('demo_feedback', '[{"message":"x"}]'), ('tutorial_progress_juan', '{}')
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
  );
  const token = await h.login('admin', h.ADMIN_PASSWORD);
  const r = await h.request('GET', '/api/system/config', { token });
  assert.equal(r.status, 200);
  assert.equal(r.body.demo_feedback, undefined);
  assert.equal(r.body.tutorial_progress_juan, undefined);
});
