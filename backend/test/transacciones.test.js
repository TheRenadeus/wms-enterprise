// Transacciones: ninguna conexión vuelve al pool con una transacción abierta, el
// historial de documentos se graba con el movimiento y los errores de la base no
// llegan en crudo al usuario.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { startHarness } = require('./helpers/harness');

const PASS = 'clave-de-prueba-1';
let h;
let admin;
let picker;

// Se mira desde una conexión propia: una consulta por el pool podría tomar justo la
// conexión que quedó con la transacción abierta y ocultar el problema.
const idleEnTransaccion = async () => {
  await new Promise((r) => setTimeout(r, 150));
  const { Client } = require('pg');
  const c = new Client({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER,
    password: process.env.DB_PASS, database: process.env.DB_NAME,
  });
  await c.connect();
  try {
    const r = await c.query(`SELECT COUNT(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND state = 'idle in transaction'`);
    return r.rows[0].n;
  } finally { await c.end(); }
};
const qtyDe = async (lpn) => Number((await h.pool.query('SELECT qty FROM inventory_lpns WHERE id=$1', [lpn])).rows[0]?.qty);

before(async () => {
  delete process.env.DEMO_SANDBOX;
  h = await startHarness();
  await h.pool.query(`INSERT INTO clients (id, name, contact, email) VALUES ('CLI-A','Cliente A','','')`);
  await h.pool.query(`INSERT INTO master_skus (sku, client_id, "desc") VALUES ('SKU-A1','CLI-A','Producto A')`);
  await h.pool.query(`INSERT INTO inventory_lpns (id, sku, client_id, qty, status, location_id, batch_number) VALUES
    ('L-LOTE','SKU-A1','CLI-A',10,'DISPONIBLE','PISO-RECEPCION','LOTE-1'),
    ('L-DESP','SKU-A1','CLI-A',10,'DISPONIBLE','PISO-RECEPCION',NULL)`);
  await h.pool.query(
    `INSERT INTO users (username, full_name, password, role, status, allowed_clients, allowed_modules)
     VALUES ('picker1','picker1',$1,'PICKER','ACTIVE','ALL','ALL')`, [await bcrypt.hash(PASS, 4)]);
  await h.pool.query(`INSERT INTO pick_tasks (id, doc_id, doc_num, doc_type, module, client_id, created_by) VALUES ('T1','D1','PED-1','PEDIDO','dispatch','CLI-A','admin')`);
  await h.pool.query(`INSERT INTO pick_task_lines (task_id, line_index, sku, lpn_id, qty_requested, status, assigned_to) VALUES ('T1',0,'SKU-A1','L-LOTE',2,'EN_PROCESO','picker1')`);
  admin = await h.login('admin', h.ADMIN_PASSWORD);
  picker = await h.login('picker1', PASS);
});
after(async () => {
  await h?.stop();
});

test('una confirmación rechazada no deja la transacción abierta', async () => {
  const linea = (await h.pool.query(`SELECT id FROM pick_task_lines WHERE task_id='T1'`)).rows[0].id;
  const r = await h.request('POST', `/api/picker/lines/${linea}/confirm`, { token: picker, body: { qty_confirmed: 2 } });
  assert.equal(r.status, 400); // falta confirmar el lote
  assert.equal(await idleEnTransaccion(), 0);
});

test('una conexión liberada con BEGIN pendiente se limpia sola', async () => {
  const { pool } = require('../db');
  const c = await pool.connect();
  await c.query('BEGIN');
  await c.query(`UPDATE inventory_lpns SET qty = 999 WHERE id = 'L-DESP'`);
  c.release();
  assert.equal(await idleEnTransaccion(), 0);
  assert.equal(await qtyDe('L-DESP'), 10, 'el cambio sin COMMIT no quedó aplicado');
});

test('el despacho graba su historial con lo aplicado y se puede anular', async () => {
  const r = await h.request('POST', '/api/dispatch_batch', {
    token: admin,
    body: { docNum: 'GD-100', docType: 'GUIA', client_id: 'CLI-A', username: 'otra-persona', items: [{ sku: 'SKU-A1', lpnId: 'L-DESP', qtyToPick: 3 }] },
  });
  assert.equal(r.status, 200, r.text);
  assert.equal(await qtyDe('L-DESP'), 7);
  const doc = (await h.pool.query(`SELECT * FROM document_history WHERE doc_num='GD-100'`)).rows[0];
  assert.ok(doc, 'el historial existe sin que el frontend lo envíe');
  assert.equal(doc.username, 'admin');
  assert.equal(doc.client_id, 'CLI-A');
  assert.equal(Number(doc.total_qty), 3);
  assert.deepEqual(JSON.parse(doc.items_json).map((i) => [i.lpnId, i.qtyToPick]), [['L-DESP', 3]]);

  const anular = await h.request('POST', `/api/document-history/${doc.id}/void`, { token: admin, body: { reason: 'prueba' } });
  assert.equal(anular.status, 200, anular.text);
  assert.equal(await qtyDe('L-DESP'), 10);
});

test('el historial ya no se acepta desde el cliente', async () => {
  const r = await h.request('POST', '/api/document-history', {
    token: admin,
    body: { id: 'X1', module: 'dispatch', doc_num: 'FALSO', items: [{ lpnId: 'L-DESP', sku: 'SKU-A1', qtyToPick: 1000 }], client_id: 'CLI-A' },
  });
  assert.equal(r.status, 410);
  const n = await h.pool.query(`SELECT COUNT(*)::int AS n FROM document_history WHERE doc_num='FALSO'`);
  assert.equal(n.rows[0].n, 0);
});

test('los errores de la base de datos no se muestran en crudo', async () => {
  const r = await h.request('POST', '/api/adjust_batch', {
    token: admin,
    body: { docNum: 'AJ-1', items: [{ sku: 'SKU-A1', qty: 1, action: 'ADD', location_id: 'X'.repeat(80) }] },
  });
  assert.ok(r.status >= 400);
  assert.ok(!/character varying|violates|relation|column/i.test(r.text), `respuesta: ${r.text}`);
});
