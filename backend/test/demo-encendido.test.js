// Sandbox de demostración ENCENDIDO (DEMO_SANDBOX=true): nunca debe llegar a datos reales.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startHarness } = require('./helpers/harness');

let h;
let demoToken;
before(async () => {
  process.env.DEMO_SANDBOX = 'true';
  h = await startHarness();
  // Dato real en la base: no debe aparecer jamás en una sesión de sandbox.
  await h.pool.query(`INSERT INTO clients (id, name, email) VALUES ('REAL-1', 'Cliente Real SpA', 'secreto@real.cl') ON CONFLICT DO NOTHING`);
  const r = await h.request('POST', '/api/demo/login', { body: { scenario: '3PL', role: 'ADMIN' } });
  assert.equal(r.status, 200);
  demoToken = r.body.token;
});
after(async () => {
  await h?.stop();
  delete process.env.DEMO_SANDBOX;
});

test('rutas que el sandbox no simula responden 403, también con variantes de URL', async () => {
  for (const url of ['/api/export/clients', '/api/export/inventory', '/api/EXPORT/clients', '/api/clients/', '/api/users/', '/api/system/config/']) {
    const r = await h.request('GET', url, { token: demoToken });
    assert.equal(r.status, 403, `${url} respondió ${r.status}`);
    assert.ok(!r.text.includes('secreto@real.cl'), `${url} filtró datos reales`);
  }
});

test('las rutas simuladas siguen funcionando con datos ficticios', async () => {
  const r = await h.request('GET', '/api/clients', { token: demoToken });
  assert.equal(r.status, 200);
  assert.ok(!r.text.includes('secreto@real.cl'));
});

test('el feedback del sandbox rechaza mensajes enormes', async () => {
  const r = await h.request('POST', '/api/demo/feedback', { token: demoToken, body: { message: 'x'.repeat(5000) } });
  assert.equal(r.status, 400);
});
