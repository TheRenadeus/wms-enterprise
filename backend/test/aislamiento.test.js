// Aislamiento entre clientes y vigencia de la sesión.
// Dos clientes (CLI-A y CLI-B) y usuarios con alcance acotado a CLI-A: nada de
// CLI-B debe verse ni modificarse desde ellos.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const XLSX = require('xlsx');
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

const qtyDe = async (lpn) => (await h.pool.query('SELECT qty FROM inventory_lpns WHERE id=$1', [lpn])).rows[0]?.qty;

before(async () => {
  delete process.env.DEMO_SANDBOX;
  h = await startHarness();
  const q = (sql, p) => h.pool.query(sql, p);
  await q(`INSERT INTO clients (id, name, contact, email) VALUES ('CLI-A','Cliente A','',''), ('CLI-B','Cliente B','','')`);
  await q(`INSERT INTO master_skus (sku, client_id, "desc") VALUES
           ('SKU-A1','CLI-A','Producto A'), ('SKU-B1','CLI-B','Producto B'),
           ('SKU-X','CLI-A','Compartido A'), ('SKU-X','CLI-B','Compartido B')`);
  await q(`INSERT INTO inventory_lpns (id, sku, client_id, qty, status, location_id, created_at) VALUES
           ('LPN-A1','SKU-A1','CLI-A',100,'DISPONIBLE','PISO-RECEPCION', NOW() - interval '3 day'),
           ('LPN-B1','SKU-B1','CLI-B',100,'DISPONIBLE','PISO-RECEPCION', NOW() - interval '3 day'),
           ('LPN-XB','SKU-X','CLI-B',10,'DISPONIBLE','PISO-RECEPCION', NOW() - interval '2 day'),
           ('LPN-XA','SKU-X','CLI-A',10,'DISPONIBLE','PISO-RECEPCION', NOW() - interval '1 day')`);
  await q(`INSERT INTO audit_log (type, sku, qty, glosa, username, client_id) VALUES
           ('INBOUND','SKU-A1',1,'mov-a','x','CLI-A'),
           ('INBOUND','SKU-B1',1,'mov-b','x','CLI-B'),
           ('INBOUND','SKU-B1',1,'mov-b-sin-cliente','x',NULL),
           ('INBOUND','SKU-X',1,'mov-x-sin-cliente','x',NULL),
           ('INBOUND','SKU-A1',1,'mov-a-sin-cliente','x',NULL)`);
  await q(`INSERT INTO purchase_orders (id, doc_num, supplier, client_id) VALUES ('OC-B','OC-B','Prov','CLI-B')`);
  await q(`INSERT INTO purchase_order_lines (po_id, sku, expected_qty) VALUES ('OC-B','SKU-B1',5)`);

  await crearUsuario('cli_a', 'CLIENTE', { scope: 'assigned', clientes: ['CLI-A'] });
  await crearUsuario('cli_sin', 'CLIENTE');
  await crearUsuario('ejec_a', 'EJECUTIVO_CUENTA', { scope: 'assigned', clientes: ['CLI-A'] });
  await crearUsuario('jefe_a', 'JEFE_BODEGA', { scope: 'assigned', clientes: ['CLI-A'] });
  await crearUsuario('jefe_csv', 'JEFE_BODEGA', { csv: 'CLI-A' });
  await crearUsuario('temporal', 'EJECUTIVO_CUENTA');
  await crearUsuario('ejec_json', 'EJECUTIVO_CUENTA', { csv: '["CLI-A"]' });
  await crearUsuario('jefe_none', 'JEFE_BODEGA', { scope: 'none' });

  admin = await h.login('admin', h.ADMIN_PASSWORD);
  for (const u of ['cli_a', 'cli_sin', 'ejec_a', 'jefe_a', 'jefe_csv', 'temporal', 'ejec_json', 'jefe_none']) tokens[u] = await h.login(u, PASS);
});
after(async () => {
  await h?.stop();
});

const clientesDe = (rows) => [...new Set(rows.map((r) => r.client_id))].sort();

test('inventario: cada usuario ve solo sus clientes', async () => {
  const a = await h.request('GET', '/api/inventory', { token: tokens.cli_a });
  assert.equal(a.status, 200);
  assert.deepEqual(clientesDe(a.body), ['CLI-A']);

  // El personal interno acotado ve además el stock propio de la bodega.
  const csv = await h.request('GET', '/api/inventory', { token: tokens.jefe_csv });
  assert.equal(csv.status, 200);
  assert.deepEqual(clientesDe(csv.body).filter((c) => c.startsWith('CLI-')), ['CLI-A']);

  const sin = await h.request('GET', '/api/inventory', { token: tokens.cli_sin });
  assert.equal(sin.status, 200);
  assert.equal(sin.body.length, 0, 'un usuario de cliente sin cliente asignado no ve nada');

  const todo = await h.request('GET', '/api/inventory', { token: admin });
  assert.ok(clientesDe(todo.body).includes('CLI-B'));
});

test('maestros, reportes y facturación respetan el alcance', async () => {
  const sinB = async (url, token, pick = (b) => b) => {
    const r = await h.request('GET', url, { token });
    assert.equal(r.status, 200, `${url}: ${r.status} ${r.text}`);
    assert.ok(!JSON.stringify(pick(r.body)).includes('CLI-B'), `${url} entrega datos de CLI-B`);
    return r.body;
  };
  const clientes = await sinB('/api/clients', tokens.cli_a);
  assert.deepEqual(clientes.map((c) => c.id), ['CLI-A']);
  await sinB('/api/skus', tokens.ejec_a);
  await sinB('/api/bootstrap', tokens.ejec_a, (b) => b.skus);
  await sinB('/api/reports/inventory-aging', tokens.ejec_a);
  await sinB('/api/reports/expiry-alerts?days=99999', tokens.ejec_a);
  await sinB('/api/inventory/history', tokens.ejec_a);
  await sinB('/api/lpn/search?sku=SKU', tokens.ejec_a);
  await sinB('/api/analytics/sku-entries', tokens.ejec_a);

  const stats = await h.request('GET', '/api/stats', { token: tokens.cli_a });
  assert.equal(stats.body.lpns, 2, 'cuenta solo los LPN de CLI-A');

  assert.equal((await h.request('GET', '/api/report/billing/CLI-B', { token: tokens.ejec_a })).status, 404);
  assert.equal((await h.request('GET', '/api/lpn/history/LPN-B1', { token: tokens.ejec_a })).status, 404);
  assert.equal((await h.request('GET', '/api/report/billing/CLI-B', { token: admin })).status, 200);
});

test('un usuario de cliente solo llega a las consultas de su portal', async () => {
  for (const url of ['/api/notifications', '/api/stats/dispatch-kpis', '/api/report/billing/CLI-A', '/api/users', '/api/system/metrics', '/api/keys']) {
    const r = await h.request('GET', url, { token: tokens.cli_a });
    assert.equal(r.status, 403, `${url} respondió ${r.status}`);
  }
  for (const url of ['/api/inventory', '/api/skus', '/api/purchase-orders', '/api/document-history', '/api/shipments']) {
    const r = await h.request('GET', url, { token: tokens.cli_a });
    assert.equal(r.status, 200, `${url} respondió ${r.status}`);
  }
});

test('pedir otro cliente por parámetro se rechaza', async () => {
  const r = await h.request('GET', '/api/inventory?client_id=CLI-B', { token: tokens.ejec_a });
  assert.equal(r.status, 403);
});

test('kardex: sin movimientos de otro cliente, ni los que no traen cliente', async () => {
  const r = await h.request('GET', '/api/audit?limit=100', { token: tokens.cli_a });
  assert.equal(r.status, 200);
  const glosas = r.body.map((x) => x.glosa).sort();
  assert.deepEqual(glosas, ['mov-a', 'mov-a-sin-cliente']);
});

test('exportaciones respetan el alcance', async () => {
  const inv = await fetch(`${h.baseUrl}/api/export/inventory`, { headers: { Authorization: `Bearer ${tokens.ejec_a}` } });
  assert.equal(inv.status, 200);
  const wb = XLSX.read(Buffer.from(await inv.arrayBuffer()), { type: 'buffer' });
  const filas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]).slice(1); // fila 1 = descripciones
  assert.ok(filas.length > 0);
  const exportados = new Set(filas.map((f) => f.Cliente));
  assert.ok(exportados.has('CLI-A'));
  assert.ok(!exportados.has('CLI-B'));

  const cliEjec = await h.request('GET', '/api/export/clients', { token: tokens.ejec_a });
  assert.equal(cliEjec.status, 403, 'exportar clientes requiere jefe de bodega');

  const cliJefe = await h.request('GET', '/api/export/clients', { token: tokens.jefe_a });
  assert.equal(cliJefe.status, 200);
  assert.ok(cliJefe.text.includes('CLI-A'));
  assert.ok(!cliJefe.text.includes('CLI-B'));
});

test('órdenes de compra de otro cliente no se listan ni se abren', async () => {
  const lista = await h.request('GET', '/api/purchase-orders', { token: tokens.ejec_a });
  assert.equal(lista.status, 200);
  assert.ok(!lista.body.some((po) => po.id === 'OC-B'));

  const lineas = await h.request('GET', '/api/purchase-orders/OC-B/lines', { token: tokens.ejec_a });
  assert.equal(lineas.status, 404);

  const delAdmin = await h.request('GET', '/api/purchase-orders/OC-B/lines', { token: admin });
  assert.equal(delAdmin.status, 200);
});

test('importar stock, SKUs o clientes ajenos se rechaza completo', async () => {
  const inv = await h.request('POST', '/api/import/inventory', {
    token: tokens.ejec_a,
    body: { rows: [{ sku: 'SKU-A1', client_id: 'CLI-A', qty: 1 }, { sku: 'SKU-B1', client_id: 'CLI-B', qty: 5000 }] },
  });
  assert.equal(inv.status, 403);

  // Mismo intento subiendo el archivo (base64) en vez de filas JSON.
  const archivo = Buffer.from('sku,client_id,qty\nSKU-B1,CLI-B,5000\n').toString('base64');
  const inv2 = await h.request('POST', '/api/import/inventory', {
    token: tokens.ejec_a, body: { data: archivo, filename: 'stock.csv' },
  });
  assert.equal(inv2.status, 403);
  const n = await h.pool.query(`SELECT COUNT(*)::int AS n FROM inventory_lpns WHERE client_id='CLI-B'`);
  assert.equal(n.rows[0].n, 2, 'no se creó stock en CLI-B');

  const skus = await h.request('POST', '/api/import/skus', {
    token: tokens.ejec_a,
    body: { rows: [{ sku: 'SKU-B1', client_id: 'CLI-B', desc: 'cambiado', requires_serial: 'TRUE' }] },
  });
  assert.equal(skus.status, 403);
  const sku = await h.pool.query(`SELECT "desc" FROM master_skus WHERE sku='SKU-B1' AND client_id='CLI-B'`);
  assert.equal(sku.rows[0].desc, 'Producto B');

  const cli = await h.request('POST', '/api/import/clients', {
    token: tokens.jefe_a, body: { rows: [{ id: 'CLI-B', name: 'cambiado' }] },
  });
  assert.equal(cli.status, 403);
  const c = await h.pool.query(`SELECT name FROM clients WHERE id='CLI-B'`);
  assert.equal(c.rows[0].name, 'Cliente B');
});

test('importar stock propio sigue funcionando', async () => {
  const r = await h.request('POST', '/api/import/inventory', {
    token: tokens.ejec_a, body: { rows: [{ sku: 'SKU-A1', client_id: 'CLI-A', qty: 3 }] },
  });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.imported, 1);
});

test('API keys: sin claves globales ni de otros clientes para un jefe acotado', async () => {
  const global = await h.request('POST', '/api/keys', { token: admin, body: { name: 'global-admin' } });
  assert.equal(global.status, 200);

  const sinCliente = await h.request('POST', '/api/keys', { token: tokens.jefe_a, body: { name: 'k1' } });
  assert.equal(sinCliente.status, 403);
  const ajena = await h.request('POST', '/api/keys', { token: tokens.jefe_a, body: { name: 'k2', client_id: 'CLI-B' } });
  assert.equal(ajena.status, 403);

  const propia = await h.request('POST', '/api/keys', {
    token: tokens.jefe_a, body: { name: 'k3', client_id: 'CLI-A', created_by: 'otra-persona' },
  });
  assert.equal(propia.status, 200, propia.text);
  assert.ok(propia.body.raw_key?.startsWith('wms_'), 'la respuesta trae la clave que muestra el frontend');

  const lista = await h.request('GET', '/api/keys', { token: tokens.jefe_a });
  assert.equal(lista.status, 200);
  assert.deepEqual(lista.body.map((k) => k.name), ['k3']);
  assert.equal(lista.body[0].created_by, 'jefe_a');

  const idGlobal = (await h.pool.query(`SELECT id FROM api_keys WHERE name='global-admin'`)).rows[0].id;
  const revocar = await h.request('DELETE', `/api/keys/${idGlobal}`, { token: tokens.jefe_a });
  assert.equal(revocar.status, 404);
  const sigue = await h.pool.query('SELECT active FROM api_keys WHERE id=$1', [idGlobal]);
  assert.equal(sigue.rows[0].active, true);

  // La key de CLI-A solo lee CLI-A.
  const v1 = await h.request('GET', '/api/v1/inventory', { headers: { 'X-API-Key': propia.body.raw_key } });
  assert.equal(v1.status, 200);
  assert.deepEqual(clientesDe(v1.body), ['CLI-A']);
});

test('despacho: el LPN debe ser del SKU declarado y de un cliente permitido', async () => {
  // LPN de otro cliente declarado con un SKU propio.
  const ajeno = await h.request('POST', '/api/dispatch_batch', {
    token: tokens.ejec_a,
    body: { docNum: 'D-1', items: [{ sku: 'SKU-A1', lpnId: 'LPN-B1', qtyToPick: 5 }] },
  });
  assert.ok([403, 404].includes(ajeno.status), `llegó ${ajeno.status}`);
  assert.equal(Number(await qtyDe('LPN-B1')), 100);

  // Aun con acceso total, el SKU tiene que coincidir con el del LPN.
  const otroSku = await h.request('POST', '/api/dispatch_batch', {
    token: admin, body: { docNum: 'D-2', items: [{ sku: 'SKU-A1', lpnId: 'LPN-B1', qtyToPick: 5 }] },
  });
  assert.equal(otroSku.status, 400);
  assert.equal(Number(await qtyDe('LPN-B1')), 100);

  // Un documento no mezcla clientes.
  const mezcla = await h.request('POST', '/api/dispatch_batch', {
    token: admin,
    body: { docNum: 'D-3', items: [
      { sku: 'SKU-A1', lpnId: 'LPN-A1', qtyToPick: 1 },
      { sku: 'SKU-B1', lpnId: 'LPN-B1', qtyToPick: 1 },
    ] },
  });
  assert.equal(mezcla.status, 400);
  assert.equal(Number(await qtyDe('LPN-A1')), 100);

  // El caso normal sigue funcionando y deja el cliente en el kardex.
  const ok = await h.request('POST', '/api/dispatch_batch', {
    token: tokens.ejec_a, body: { docNum: 'D-4', items: [{ sku: 'SKU-A1', lpnId: 'LPN-A1', qtyToPick: 2 }] },
  });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(Number(await qtyDe('LPN-A1')), 98);
  const k = await h.pool.query(`SELECT client_id FROM audit_log WHERE glosa LIKE '%D-4%'`);
  assert.equal(k.rows[0].client_id, 'CLI-A');
});

test('despacho masivo: un SKU de varios clientes no se descuenta a ciegas', async () => {
  const r = await h.request('POST', '/api/import/dispatch', {
    token: admin, body: { rows: [{ sku: 'SKU-X', qty_to_pick: 5 }] },
  });
  assert.equal(r.status, 422);
  assert.equal(Number(await qtyDe('LPN-XB')), 10);
  assert.equal(Number(await qtyDe('LPN-XA')), 10);

  const conCliente = await h.request('POST', '/api/import/dispatch', {
    token: admin, body: { rows: [{ sku: 'SKU-X', qty_to_pick: 5, client_id: 'CLI-A' }] },
  });
  assert.equal(conCliente.body.success, 1, conCliente.text);
  assert.equal(Number(await qtyDe('LPN-XA')), 5);
  assert.equal(Number(await qtyDe('LPN-XB')), 10);
});

test('la sesión se corta al suspender, eliminar o cambiar de rol', async () => {
  assert.equal((await h.request('GET', '/api/inventory', { token: tokens.temporal })).status, 200);

  const susp = await h.request('POST', '/api/users', {
    token: admin, body: { username: 'temporal', full_name: 'temporal', role: 'EJECUTIVO_CUENTA', status: 'SUSPENDED' },
  });
  assert.equal(susp.status, 200, susp.text);
  assert.equal((await h.request('GET', '/api/inventory', { token: tokens.temporal })).status, 401);

  // Reactivado pero con otro rol: el token viejo (rol anterior) tampoco vale.
  await h.request('POST', '/api/users', {
    token: admin, body: { username: 'temporal', full_name: 'temporal', role: 'PICKER', status: 'ACTIVE' },
  });
  assert.equal((await h.request('GET', '/api/inventory', { token: tokens.temporal })).status, 401);
  const nuevo = await h.login('temporal', PASS);
  assert.equal((await h.request('GET', '/api/inventory', { token: nuevo })).status, 200);

  await h.request('DELETE', '/api/users/temporal', { token: admin });
  assert.equal((await h.request('GET', '/api/inventory', { token: nuevo })).status, 401);
});

test('los clientes permitidos guardados por la pantalla de Usuarios (JSON) se respetan', async () => {
  const inv = await h.request('GET', '/api/inventory', { token: tokens.ejec_json });
  assert.equal(inv.status, 200);
  const clientes = clientesDe(inv.body);
  assert.ok(clientes.includes('CLI-A'), 've su cliente');
  assert.ok(!clientes.includes('CLI-B'), 'no ve otros');
});

test("el alcance 'Sin acceso' no ve stock de nadie, tampoco el propio", async () => {
  const inv = await h.request('GET', '/api/inventory', { token: tokens.jefe_none });
  assert.equal(inv.status, 200);
  assert.equal(inv.body.length, 0);
});
