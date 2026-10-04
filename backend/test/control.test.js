// Anulación de documentos, conteos cíclicos y respaldo/restauración interna.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const bcrypt = require('bcryptjs');
const { startHarness } = require('./helpers/harness');

const PASS = 'clave-de-prueba-1';
const DIR_RESPALDOS = fs.mkdtempSync(path.join(os.tmpdir(), 'wms-test-respaldos-'));
let h;
let admin;
const tokens = {};

const stock = async (where, params = []) =>
  Number((await h.pool.query(`SELECT COALESCE(SUM(qty),0) AS q FROM inventory_lpns WHERE ${where}`, params)).rows[0].q);
const post = (url, body, token = admin) => h.request('POST', url, { token, body });
const docId = async (docNum, clientId) =>
  (await h.pool.query(`SELECT id FROM document_history WHERE doc_num=$1 AND client_id=$2 ORDER BY created_at DESC LIMIT 1`, [docNum, clientId])).rows[0]?.id;

before(async () => {
  delete process.env.DEMO_SANDBOX;
  process.env.BACKUPS_DIR = DIR_RESPALDOS;
  h = await startHarness();
  await h.pool.query(`INSERT INTO clients (id, name, contact, email) VALUES ('CLI-A','Cliente A','',''), ('CLI-B','Cliente B','','')`);
  await h.pool.query(`INSERT INTO master_skus (sku, client_id, "desc") VALUES ('CAJA','CLI-A','Caja A'), ('CAJA','CLI-B','Caja B')`);
  await h.pool.query(`INSERT INTO locations_master (location_id, zone_code) VALUES ('RACK-1','A') ON CONFLICT DO NOTHING`);
  const hash = await bcrypt.hash(PASS, 4);
  await h.pool.query(`INSERT INTO users (username, full_name, password, role, status, allowed_clients, allowed_modules, client_scope)
    VALUES ('super','super',$1,'SUPERADMIN','ACTIVE','ALL','ALL','all'), ('jefe_b','jefe_b',$1,'JEFE_BODEGA','ACTIVE','ALL','ALL','assigned')`, [hash]);
  await h.pool.query(`INSERT INTO user_clients (username, client_id) VALUES ('jefe_b','CLI-B')`);
  admin = await h.login('admin', h.ADMIN_PASSWORD);
  for (const u of ['super', 'jefe_b']) tokens[u] = await h.login(u, PASS);
});
after(async () => {
  await h?.stop();
  delete process.env.BACKUPS_DIR;
  fs.rmSync(DIR_RESPALDOS, { recursive: true, force: true });
});

test('anular una recepción solo afecta al cliente del documento', async () => {
  for (const c of ['CLI-A', 'CLI-B']) {
    const r = await post('/api/receive_batch', { docNum: 'FAC-1', docType: 'FACTURA', client_id: c, items: [{ sku: 'CAJA', qty: 7 }] });
    assert.equal(r.status, 200, r.text);
  }
  const fueraDeAlcance = await post(`/api/document-history/${await docId('FAC-1', 'CLI-A')}/void`, { reason: 'x' }, tokens.jefe_b);
  assert.equal(fueraDeAlcance.status, 404);

  const r = await post(`/api/document-history/${await docId('FAC-1', 'CLI-A')}/void`, { reason: 'error de digitación' });
  assert.equal(r.status, 200, r.text);
  assert.equal(await stock(`sku='CAJA' AND client_id='CLI-A'`), 0);
  assert.equal(await stock(`sku='CAJA' AND client_id='CLI-B'`), 7, 'la recepción de CLI-B con el mismo número sigue');
});

test('no se anula una recepción cuyo stock ya se movió, ni dos veces un despacho', async () => {
  await post('/api/receive_batch', { docNum: 'FAC-2', docType: 'FACTURA', client_id: 'CLI-A', items: [{ sku: 'CAJA', qty: 10 }] });
  const lpn = (await h.pool.query(`SELECT id FROM inventory_lpns WHERE client_id='CLI-A' AND sku='CAJA'`)).rows[0].id;
  const desp = await post('/api/dispatch_batch', { docNum: 'GD-2', docType: 'GUIA', client_id: 'CLI-A', items: [{ sku: 'CAJA', lpnId: lpn, qtyToPick: 4 }] });
  assert.equal(desp.status, 200, desp.text);

  const anularRec = await post(`/api/document-history/${await docId('FAC-2', 'CLI-A')}/void`, { reason: 'x' });
  assert.equal(anularRec.status, 409);
  assert.equal(await stock(`id=$1`, [lpn]), 6);

  const idDesp = await docId('GD-2', 'CLI-A');
  assert.equal((await post(`/api/document-history/${idDesp}/void`, { reason: 'x' })).status, 200);
  assert.equal((await post(`/api/document-history/${idDesp}/void`, { reason: 'x' })).status, 409);
  assert.equal(await stock(`id=$1`, [lpn]), 10, 'el stock se restauró una sola vez');
});

test('la anulación de documentos antiguos no usa comodines', async () => {
  // Documentos registrados antes de que el servidor guardara sus LPN.
  await h.pool.query(`INSERT INTO inventory_lpns (id, sku, client_id, qty, status, location_id) VALUES
    ('L-VIEJO-1','CAJA','CLI-A',3,'DISPONIBLE','PISO-RECEPCION'), ('L-VIEJO-2','CAJA','CLI-A',5,'DISPONIBLE','PISO-RECEPCION')`);
  await h.pool.query(`INSERT INTO audit_log (type, sku, qty, glosa, username) VALUES
    ('INBOUND','CAJA',3,'Doc: [GUIA] V_1. LPN: L-VIEJO-1','x'), ('INBOUND','CAJA',5,'Doc: [GUIA] VX1. LPN: L-VIEJO-2','x')`);
  await h.pool.query(`INSERT INTO document_history (id, module, doc_num, doc_type, username, items_json, total_qty, client_id)
    VALUES ('DH-VIEJO','receive','V_1','GUIA','x','[{"sku":"CAJA","qty":3}]',3,'CLI-A')`);
  const r = await post('/api/document-history/DH-VIEJO/void', { reason: 'x' });
  assert.equal(r.status, 200, r.text);
  assert.equal(await stock(`id='L-VIEJO-1'`), 0);
  assert.equal(await stock(`id='L-VIEJO-2'`), 5, 'el documento VX1 no se tocó');
});

test('el conteo cíclico compara contra el stock real y pide recontar si cambió', async () => {
  await post('/api/receive_batch', { docNum: 'FAC-CC', docType: 'FACTURA', client_id: 'CLI-B', items: [{ sku: 'CAJA', qty: 20, location_id: 'RACK-1' }] });
  const cc = await post('/api/cycle-count/create', { client_id: 'CLI-B', location_id: 'RACK-1' });
  assert.equal(cc.status, 200, cc.text);
  const lineas = (await h.request('GET', `/api/cycle-count/${cc.body.countId}/lines`, { token: admin })).body.lines;
  assert.equal(lineas.length, 1);
  const linea = lineas[0];
  assert.equal(linea.client_id, 'CLI-B');

  // Antes de contar se despachan 5: el conteo físico (15) coincide con el sistema.
  const lpn = (await h.pool.query(`SELECT id FROM inventory_lpns WHERE client_id='CLI-B' AND location_id='RACK-1'`)).rows[0].id;
  await post('/api/dispatch_batch', { docNum: 'GD-CC', docType: 'GUIA', client_id: 'CLI-B', items: [{ sku: 'CAJA', lpnId: lpn, qtyToPick: 5 }] });

  assert.equal((await post(`/api/cycle-count/${cc.body.countId}/count`, { lineId: linea.id, counted_qty: -1 })).status, 400);
  const contar = await post(`/api/cycle-count/${cc.body.countId}/count`, { lineId: linea.id, counted_qty: 15 });
  assert.equal(contar.status, 200, contar.text);
  assert.equal(contar.body.difference, 0);
  const enviar = await post(`/api/cycle-count/${cc.body.countId}/submit`, {});
  assert.equal(enviar.body.status, 'COMPLETED', 'sin diferencia real no hay ajuste');
  assert.equal(await stock(`id=$1`, [lpn]), 15);

  // Segundo conteo: se cuenta 12 (faltan 3) y luego se mueve stock antes de aprobar.
  const cc2 = await post('/api/cycle-count/create', { client_id: 'CLI-B', location_id: 'RACK-1' });
  const l2 = (await h.request('GET', `/api/cycle-count/${cc2.body.countId}/lines`, { token: admin })).body.lines[0];
  await post(`/api/cycle-count/${cc2.body.countId}/count`, { lineId: l2.id, counted_qty: 12 });
  assert.equal((await post(`/api/cycle-count/${cc2.body.countId}/count`, { lineId: linea.id, counted_qty: 0 })).status, 404, 'línea de otro conteo');
  assert.equal((await post(`/api/cycle-count/${cc2.body.countId}/submit`, {})).body.status, 'PENDIENTE_APROBACION');
  await post('/api/dispatch_batch', { docNum: 'GD-CC2', docType: 'GUIA', client_id: 'CLI-B', items: [{ sku: 'CAJA', lpnId: lpn, qtyToPick: 1 }] });
  const aprobar = await post(`/api/cycle-count/${cc2.body.countId}/approve`, {});
  assert.equal(aprobar.status, 409);
  assert.equal(await stock(`id=$1`, [lpn]), 14, 'no se aplicó un ajuste obsoleto');
});

test('respaldo y restauración cubren todas las tablas y dejan las secuencias al día', async () => {
  const oc = await post('/api/purchase-orders', { doc_num: 'OC-RESP', client_id: 'CLI-A', items: [{ sku: 'CAJA', expected_qty: 3 }] });
  assert.equal(oc.status, 200, oc.text);
  const respaldo = await post('/api/system/backup', {}, tokens.super);
  assert.equal(respaldo.status, 200, respaldo.text);

  await h.pool.query(`DELETE FROM purchase_order_lines`);
  await h.pool.query(`DELETE FROM user_clients`);
  const restaurar = await post(`/api/system/backups/${respaldo.body.id}/restore`, {}, tokens.super);
  assert.equal(restaurar.status, 200, restaurar.text);
  const lineas = await h.pool.query(`SELECT COUNT(*)::int AS n FROM purchase_order_lines WHERE po_id=$1`, [oc.body.poId]);
  assert.equal(lineas.rows[0].n, 1, 'las líneas de OC vuelven con el respaldo');
  const asignaciones = await h.pool.query(`SELECT COUNT(*)::int AS n FROM user_clients WHERE username='jefe_b'`);
  assert.equal(asignaciones.rows[0].n, 1);

  // Las secuencias quedaron por encima de los ids restaurados.
  const r = await post('/api/receive_batch', { docNum: 'FAC-POST', docType: 'FACTURA', client_id: 'CLI-A', items: [{ sku: 'CAJA', qty: 1 }] });
  assert.equal(r.status, 200, r.text);
});

test('no se registran ni restauran respaldos incompletos', async () => {
  // Igual que la interfaz: el archivo va como texto plano (octet-stream).
  const subir = async (cuerpo) => {
    const res = await fetch(h.baseUrl + '/api/system/backups/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', Authorization: `Bearer ${tokens.super}` },
      body: JSON.stringify(cuerpo),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const formatoAntiguo = await subir({ tables: { users: [{ username: 'a', role: 'ADMIN' }] } });
  assert.equal(formatoAntiguo.status, 400, 'formato antiguo');
  assert.match(formatoAntiguo.body.error, /antiguo/);
  const sinAdmin = await subir({ version: 2, tables: { users: [] } });
  assert.equal(sinAdmin.status, 400);
  assert.match(sinAdmin.body.error, /administrador/);
  assert.equal((await subir({ version: 2, tables: { users: 'x' } })).status, 400);
  const valido = await subir({ version: 2, tables: { users: [{ username: 'a', role: 'ADMIN', status: 'ACTIVE' }] } });
  assert.equal(valido.status, 200);
});
