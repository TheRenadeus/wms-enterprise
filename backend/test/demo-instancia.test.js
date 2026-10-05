// Instancia de demostración (DEMO_INSTANCE=true): datos ficticios, un usuario por
// rol, funciones peligrosas bloqueadas y reinicio que no toca bases reales.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startHarness } = require('./helpers/harness');

const CLAVE = 'clave-demo-de-prueba';
let h;
let demo;
const tokens = {};

before(async () => {
  delete process.env.DEMO_SANDBOX;
  process.env.DEMO_INSTANCE = 'true';
  process.env.DEMO_PASSWORD = CLAVE;
  h = await startHarness();
  demo = require('../demo-instance');
  for (const u of demo.DEMO_USERS) tokens[u.username] = await h.login(u.username, CLAVE);
});
after(async () => {
  delete process.env.DEMO_INSTANCE;
  delete process.env.DEMO_PASSWORD;
  await h?.stop();
});

test('hay un usuario por cada rol del WMS y la demo trae datos', async () => {
  const roles = demo.DEMO_USERS.map((u) => u.role).sort();
  assert.deepEqual(roles, ['ADMIN', 'AUDITOR', 'CLIENTE', 'COORDINADOR_TRANSPORTE', 'EJECUTIVO_CUENTA', 'JEFE_BODEGA', 'PICKER']);
  const inv = await h.request('GET', '/api/inventory?limit=500', { token: tokens['demo.jefe'] });
  assert.equal(inv.status, 200);
  assert.ok(inv.body.length > 10);
  const cfg = await h.request('GET', '/api/system/config', { token: tokens['demo.jefe'] });
  assert.equal(cfg.body.demo_instance_marker, 'true');
});

test('el usuario cliente de la demo solo ve su empresa', async () => {
  const inv = await h.request('GET', '/api/inventory?limit=500', { token: tokens['demo.cliente'] });
  assert.equal(inv.status, 200);
  assert.deepEqual([...new Set(inv.body.map((l) => l.client_id))], ['ANDES']);
});

test('las funciones peligrosas están bloqueadas, la operación normal no', async () => {
  const admin = tokens['demo.admin'];
  const bloqueadas = [
    ['POST', '/api/users', { username: 'x', password: 'clave-larga-1', role: 'PICKER' }],
    ['POST', '/api/users/demo.picker/reset-password', { password: 'otra-clave-1' }],
    ['DELETE', '/api/users/demo.picker'],
    ['POST', '/api/keys', { name: 'k', client_id: 'ANDES' }],
    ['DELETE', '/api/clients/VERDE'],
    ['POST', '/api/locations/bulk-delete', { ids: ['A-01-1'] }],
    ['PUT', '/api/clients/ANDES/portal', { portal_enabled: true, portal_password: 'clave-portal-1' }],
    ['POST', '/api/system/config', { configs: { maintenance_mode: 'true' } }],
  ];
  for (const [method, url, body] of bloqueadas) {
    const r = await h.request(method, url, { token: admin, body });
    assert.equal(r.status, 403, `${method} ${url} respondió ${r.status}`);
    assert.equal(r.body?.demo_instance, true, `${method} ${url} no lo bloqueó la demo`);
  }
  const recibir = await h.request('POST', '/api/receive_batch', {
    token: tokens['demo.jefe'],
    body: { docNum: 'DEMO-PRUEBA', docType: 'GUIA', client_id: 'NORTE', items: [{ sku: 'NOR-GUANTE', qty: 10 }] },
  });
  assert.equal(recibir.status, 200, recibir.text);
});

test('el reinicio vuelve a los datos ficticios y respeta bases sin marca', async () => {
  assert.equal((await h.pool.query(`SELECT COUNT(*)::int AS n FROM document_history WHERE doc_num='DEMO-PRUEBA'`)).rows[0].n, 1);
  await demo.resetDemo(h.pool);
  assert.equal((await h.pool.query(`SELECT COUNT(*)::int AS n FROM document_history WHERE doc_num='DEMO-PRUEBA'`)).rows[0].n, 0);
  assert.ok((await h.pool.query(`SELECT COUNT(*)::int AS n FROM statuses`)).rows[0].n > 0, 'los catálogos base se conservan');
  await h.login('demo.picker', CLAVE);

  await h.pool.query(`DELETE FROM system_config WHERE key=$1`, [demo.MARKER_KEY]);
  await assert.rejects(() => demo.resetDemo(h.pool), /marca de demo/);
  assert.ok((await h.pool.query(`SELECT COUNT(*)::int AS n FROM clients`)).rows[0].n > 0, 'sin marca no se borró nada');
});

test('el bloqueo de la demo no se elude con mayúsculas ni barras extra', async () => {
  const admin = tokens['demo.admin'];
  for (const [method, url, body] of [
    ['POST', '/api/USERS', { username: 'x', password: 'clave-larga-1', role: 'PICKER' }],
    ['DELETE', '/api/Clients/VERDE'],
    ['GET', '/api/System/Backups'],
    ['GET', '/api/login-history'],
  ]) {
    const r = await h.request(method, url, { token: admin, body });
    assert.equal(r.status, 403, `${method} ${url} respondió ${r.status}`);
  }
  assert.equal((await h.pool.query(`SELECT COUNT(*)::int AS n FROM users WHERE username='x'`)).rows[0].n, 0);
});
