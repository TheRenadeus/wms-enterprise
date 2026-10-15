// Gestión de usuarios por rango, portal de clientes y estabilidad del proceso ante
// peticiones malformadas.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { startHarness } = require('./helpers/harness');

const PASS = 'clave-de-prueba-1';
let h;
let admin;
const tokens = {};

async function crearUsuario(username, role, { scope = 'all', clientes = [], csv = 'ALL' } = {}) {
  const hash = await bcrypt.hash(PASS, 4);
  await h.pool.query(
    `INSERT INTO users (username, full_name, password, role, status, allowed_clients, allowed_modules, client_scope)
     VALUES ($1, $1, $2, $3, 'ACTIVE', $4, 'ALL', $5)`,
    [username, hash, role, csv, scope],
  );
  for (const c of clientes) {
    await h.pool.query('INSERT INTO user_clients (username, client_id) VALUES ($1, $2)', [username, c]);
  }
}

before(async () => {
  delete process.env.DEMO_SANDBOX;
  h = await startHarness();
  await h.pool.query(`INSERT INTO clients (id, name, contact, email) VALUES ('CLI-A','Cliente A','',''), ('CLI-B','Cliente B','','')`);
  await crearUsuario('admin2', 'ADMIN');
  await crearUsuario('super', 'SUPERADMIN');
  await crearUsuario('jefe_a', 'JEFE_BODEGA', { scope: 'assigned', clientes: ['CLI-A'] });
  admin = await h.login('admin', h.ADMIN_PASSWORD);
  for (const u of ['admin2', 'super', 'jefe_a']) tokens[u] = await h.login(u, PASS);
});
after(async () => {
  await h?.stop();
});

test('un ADMIN no crea, edita ni elimina a otro ADMIN', async () => {
  const tomar = await h.request('POST', '/api/users', {
    token: admin, body: { username: 'admin2', full_name: 'x', password: 'otra-clave-99', role: 'ADMIN' },
  });
  assert.equal(tomar.status, 403);
  await h.login('admin2', PASS); // la contraseña sigue siendo la original

  const degradar = await h.request('POST', '/api/users', {
    token: admin, body: { username: 'admin2', full_name: 'x', role: 'PICKER', status: 'SUSPENDED' },
  });
  assert.equal(degradar.status, 403);

  const nuevo = await h.request('POST', '/api/users', {
    token: admin, body: { username: 'admin3', full_name: 'x', password: 'clave-nueva-1', role: 'ADMIN' },
  });
  assert.equal(nuevo.status, 403);

  assert.equal((await h.request('DELETE', '/api/users/admin2', { token: admin })).status, 403);
  assert.equal((await h.request('DELETE', '/api/users/admin', { token: admin })).status, 403);
  const propio = await h.request('POST', '/api/users', {
    token: admin, body: { username: 'admin', full_name: 'yo', role: 'ADMIN' },
  });
  assert.equal(propio.status, 403);

  const r = await h.pool.query(`SELECT role, status FROM users WHERE username='admin2'`);
  assert.deepEqual(r.rows[0], { role: 'ADMIN', status: 'ACTIVE' });
});

test('un SUPERADMIN sí puede crear un ADMIN', async () => {
  const r = await h.request('POST', '/api/users', {
    token: tokens.super, body: { username: 'admin4', full_name: 'x', password: 'clave-nueva-1', role: 'ADMIN' },
  });
  assert.equal(r.status, 200, r.text);
});

test('editar un usuario no le cambia el rol ni le amplía los clientes', async () => {
  const alta = await h.request('POST', '/api/users', {
    token: admin,
    body: { username: 'ejec1', full_name: 'Ejecutivo', password: 'clave-nueva-1', role: 'EJECUTIVO_CUENTA', allowed_clients: 'CLI-A' },
  });
  assert.equal(alta.status, 200, alta.text);
  const editar = await h.request('POST', '/api/users', { token: admin, body: { username: 'ejec1', full_name: 'Otro nombre' } });
  assert.equal(editar.status, 200, editar.text);
  const r = await h.pool.query(`SELECT full_name, role, allowed_clients, status FROM users WHERE username='ejec1'`);
  assert.deepEqual(r.rows[0], { full_name: 'Otro nombre', role: 'EJECUTIVO_CUENTA', allowed_clients: 'CLI-A', status: 'ACTIVE' });
});

test('el portal solo se configura para clientes propios y queda registrado', async () => {
  const ajeno = await h.request('PUT', '/api/clients/CLI-B/portal', {
    token: tokens.jefe_a, body: { portal_enabled: true, portal_password: 'clave-portal-123' },
  });
  assert.equal(ajeno.status, 404);
  const b = await h.pool.query(`SELECT portal_enabled FROM clients WHERE id='CLI-B'`);
  assert.ok(!b.rows[0].portal_enabled);

  const propio = await h.request('PUT', '/api/clients/CLI-A/portal', {
    token: tokens.jefe_a, body: { portal_enabled: true, portal_password: 'clave-portal-123' },
  });
  assert.equal(propio.status, 200, propio.text);
  const log = await h.pool.query(`SELECT username FROM audit_log WHERE glosa LIKE 'Portal del cliente CLI-A%'`);
  assert.equal(log.rows[0]?.username, 'jefe_a');
});

test('peticiones malformadas no tumban el servidor', async () => {
  const malas = [
    ['POST', '/api/dispatch_batch', { docNum: 'X-1', items: [null] }],
    ['POST', '/api/document-history/1/void-request', { reason: 1 }],
    ['POST', '/api/locations/bulk', { locations: [{ loc_type: 5 }] }],
  ];
  for (const [method, url, body] of malas) {
    const res = await fetch(h.baseUrl + url, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    assert.ok(res.status >= 400, `${url} respondió ${res.status}`);
    const text = await res.text();
    assert.ok(!/at .+\.js:\d+/.test(text), `${url} devolvió una traza interna`);
  }
  const salud = await fetch(h.baseUrl + '/health', { signal: AbortSignal.timeout(5000) });
  assert.equal(salud.status, 200);
});

test('cambiar la contraseña del portal invalida las sesiones abiertas', async () => {
  const login = await h.request('POST', '/api/portal/login', { body: { client_id: 'CLI-A', password: 'clave-portal-123' } });
  assert.equal(login.status, 200, login.text);
  const consultar = () => fetch(h.baseUrl + '/api/portal/inventory/CLI-A', { headers: { 'x-portal-token': login.body.token } });
  assert.equal((await consultar()).status, 200);
  const cambio = await h.request('PUT', '/api/clients/CLI-A/portal', { token: tokens.jefe_a, body: { portal_enabled: true, portal_password: 'otra-clave-portal-9' } });
  assert.equal(cambio.status, 200, cambio.text);
  assert.equal((await consultar()).status, 401);
});
