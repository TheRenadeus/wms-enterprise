// Arnés de pruebas de integración: PostgreSQL embebido (misma versión mayor que la
// imagen Docker), migraciones reales y la app Express escuchando en un puerto libre.
// Cada archivo de prueba arranca su propia base desechable.
const os = require('os');
const path = require('path');
const fs = require('fs');
const net = require('net');

const ADMIN_PASSWORD = 'admin-de-prueba-123';

const freePort = () =>
  new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });

async function startHarness() {
  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  const pgPort = await freePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wms-test-pg-'));
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'wms_test',
    password: 'wms_test',
    port: pgPort,
    persistent: false,
    onLog: () => {},
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('wms_test');

  Object.assign(process.env, {
    NODE_ENV: 'test',
    DB_HOST: 'localhost',
    DB_PORT: String(pgPort),
    DB_USER: 'wms_test',
    DB_PASS: 'wms_test',
    DB_NAME: 'wms_test',
    JWT_SECRET: 'secreto-solo-para-pruebas',
    SEED_ADMIN_PASSWORD: ADMIN_PASSWORD,
    LOAD_TEST: '1', // sin rate limit: las pruebas hacen muchas peticiones seguidas
  });

  const { app, bootstrap } = require('../../server');
  const { pool } = require('../../db');
  await bootstrap();

  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  async function request(method, url, { token, body, headers = {} } = {}) {
    const res = await fetch(baseUrl + url, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: res.status, body: json, text, headers: res.headers };
  }

  async function login(username, password) {
    const r = await request('POST', '/api/login', { body: { username, password } });
    if (r.status !== 200) throw new Error(`login ${username} falló: ${r.status} ${r.text}`);
    return r.body.token;
  }

  async function stop() {
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
    await pg.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }

  return { baseUrl, request, login, pool, stop, ADMIN_PASSWORD };
}

module.exports = { startHarness };
