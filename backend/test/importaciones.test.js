// Importaciones masivas: lectura segura de archivos, todo-o-nada, sin duplicados.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startHarness } = require('./helpers/harness');

let h;
let admin;
let TEMPLATES;

const b64 = (s) => Buffer.from(s).toString('base64');
const contar = async (sql, p) => (await h.pool.query(sql, p)).rows[0].n;

before(async () => {
  delete process.env.DEMO_SANDBOX;
  process.env.IMPORT_PARSE_TIMEOUT_MS = '1500';
  h = await startHarness();
  ({ TEMPLATES } = require('../import-export-helpers'));
  await h.pool.query(`INSERT INTO clients (id, name, contact, email) VALUES ('CLI-A','Cliente A','',''), ('CLI-B','Cliente B','','')`);
  await h.pool.query(`INSERT INTO master_skus (sku, client_id, "desc") VALUES
    ('SKU-A1','CLI-A','Producto A'), ('CAJA-01','CLI-A','Caja A'), ('CAJA-01','CLI-B','Caja B')`);
  await h.pool.query(`INSERT INTO inventory_lpns (id, sku, client_id, qty, status, location_id) VALUES
    ('L-CA','CAJA-01','CLI-A',5,'DISPONIBLE','PISO-RECEPCION'), ('L-CB','CAJA-01','CLI-B',5,'DISPONIBLE','PISO-RECEPCION'),
    ('L-A1','SKU-A1','CLI-A',50,'DISPONIBLE','PISO-RECEPCION')`);
  admin = await h.login('admin', h.ADMIN_PASSWORD);
});
after(async () => {
  delete process.env.IMPORT_PARSE_TIMEOUT_MS;
  await h?.stop();
});

const importar = (tipo, body) => h.request('POST', `/api/import/${tipo}`, { token: admin, body });

test('un archivo dañado no bloquea el servidor', async () => {
  // ZIP truncado: la librería de planillas se queda en un bucle infinito al leerlo.
  const danado = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00]).toString('base64');
  const pendiente = importar('inventory', { data: danado, filename: 'stock.xlsx' });
  const t0 = Date.now();
  const salud = await fetch(h.baseUrl + '/health', { signal: AbortSignal.timeout(3000) });
  assert.equal(salud.status, 200);
  assert.ok(Date.now() - t0 < 1000, 'la API sigue respondiendo mientras se lee el archivo');
  const r = await pendiente;
  assert.equal(r.status, 400);
});

test('solo se aceptan planillas cuyo contenido coincide con la extensión', async () => {
  assert.equal((await importar('inventory', { data: b64('sku,qty\nSKU-A1,1\n'), filename: 'stock.exe' })).status, 400);
  assert.equal((await importar('inventory', { data: b64('sku,qty\nSKU-A1,1\n'), filename: 'stock.xlsx' })).status, 400);
  assert.equal((await importar('inventory', { data: b64('MZ\u0000\u0000binario'), filename: 'stock.csv' })).status, 400);
  const ok = await importar('inventory', { data: b64('sku,client_id,qty\nSKU-A1,CLI-A,7\n'), filename: 'stock.csv' });
  assert.equal(ok.status, 200, ok.text);
});

test('las filas de descripción y ejemplo de la plantilla no se importan', async () => {
  const t = TEMPLATES.clients;
  const fila = (vals) => Object.fromEntries(t.headers.map((k, i) => [k, vals[i]]));
  const r = await importar('clients', { rows: [fila(t.desc), fila(t.example), { id: 'CLI-NUEVO', name: 'Cliente Nuevo' }] });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.success, 1);
  assert.equal(await contar(`SELECT COUNT(*)::int AS n FROM clients WHERE id = $1`, [String(t.example[0]).toUpperCase()]), 0);
});

test('con una fila con error no se importa nada', async () => {
  const antes = await contar(`SELECT COUNT(*)::int AS n FROM inventory_lpns`);
  const r = await importar('inventory', {
    rows: [{ sku: 'SKU-A1', client_id: 'CLI-A', qty: 4 }, { sku: 'NO-EXISTE', client_id: 'CLI-A', qty: 1 }],
  });
  assert.equal(r.status, 422);
  assert.ok(Array.isArray(r.body.errors) && r.body.errors.length === 1);
  assert.equal(await contar(`SELECT COUNT(*)::int AS n FROM inventory_lpns`), antes);

  const despacho = await importar('dispatch', { rows: [{ sku: 'SKU-A1', qty_to_pick: 2, client_id: 'CLI-A' }, { sku: 'SKU-A1', qty_to_pick: 'abc' }] });
  assert.equal(despacho.status, 422);
  const l = await h.pool.query(`SELECT qty FROM inventory_lpns WHERE id='L-A1'`);
  assert.equal(Number(l.rows[0].qty), 50, 'la fila válida tampoco se aplicó');
});

test('reimportar el mismo contenido o el mismo documento no duplica stock', async () => {
  const filas = [{ sku: 'SKU-A1', client_id: 'CLI-A', qty: 11, glosa: 'carga inicial' }];
  assert.equal((await importar('inventory', { rows: filas })).status, 200);
  assert.equal((await importar('inventory', { rows: filas })).status, 409);
  assert.equal(await contar(`SELECT COUNT(*)::int AS n FROM inventory_lpns WHERE glosa='carga inicial'`), 1);

  const rec = { rows: [{ sku: 'SKU-A1', qty: 3 }], client_id: 'CLI-A', doc_num: 'GUIA-77' };
  assert.equal((await importar('receive', rec)).status, 200);
  assert.equal((await importar('receive', rec)).status, 409);
});

test('una carga de 8.000 filas entra completa', async () => {
  const rows = Array.from({ length: 8000 }, (_, i) => ({ sku: 'SKU-A1', client_id: 'CLI-A', qty: 1, glosa: `masiva-${i}` }));
  const r = await importar('inventory', { rows });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.imported, 8000);
});

test('versionar un SKU no toca el mismo código de otro cliente', async () => {
  const r = await importar('skus', { rows: [{ sku: 'CAJA-01', client_id: 'CLI-A', desc: 'Caja A', requires_lot: 'TRUE' }] });
  assert.equal(r.status, 200, r.text);
  const filas = (await h.pool.query(`SELECT client_id, requires_lot, current_version FROM master_skus WHERE sku='CAJA-01' ORDER BY client_id`)).rows;
  assert.deepEqual(filas, [
    { client_id: 'CLI-A', requires_lot: true, current_version: 2 },
    { client_id: 'CLI-B', requires_lot: false, current_version: 1 },
  ]);
  const hist = await contar(`SELECT COUNT(*)::int AS n FROM sku_version_history WHERE sku='CAJA-01' AND client_id='CLI-B'`);
  assert.equal(hist, 0);
});
