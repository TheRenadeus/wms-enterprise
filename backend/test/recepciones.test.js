// Entradas de stock: recepción manual, OC, ASN y devoluciones. El stock queda del
// cliente del documento, no se duplica al repetir y respeta lote/serie.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { startHarness } = require('./helpers/harness');

const PASS = 'clave-de-prueba-1';
let h;
let admin;
const tokens = {};

const stock = async (where, params = []) =>
  Number((await h.pool.query(`SELECT COALESCE(SUM(qty),0) AS q FROM inventory_lpns WHERE ${where}`, params)).rows[0].q);

before(async () => {
  delete process.env.DEMO_SANDBOX;
  h = await startHarness();
  await h.pool.query(`INSERT INTO clients (id, name, contact, email) VALUES ('CLI-A','Cliente A','',''), ('CLI-B','Cliente B','','')`);
  await h.pool.query(`INSERT INTO master_skus (sku, client_id, "desc", requires_lot) VALUES
    ('CAJA','CLI-A','Caja A',FALSE), ('CAJA','CLI-B','Caja B',FALSE), ('SOLO-B','CLI-B','Solo B',FALSE), ('CON-LOTE','CLI-A','Con lote',TRUE)`);
  await h.pool.query(`INSERT INTO locations_master (location_id, zone_code) VALUES ('RACK-1','A') ON CONFLICT DO NOTHING`);
  const hash = await bcrypt.hash(PASS, 4);
  for (const [u, role, scope] of [['picker1', 'PICKER', 'all'], ['coord1', 'COORDINADOR_TRANSPORTE', 'all'], ['ejec_b', 'EJECUTIVO_CUENTA', 'assigned']]) {
    await h.pool.query(`INSERT INTO users (username, full_name, password, role, status, allowed_clients, allowed_modules, client_scope)
      VALUES ($1,$1,$2,$3,'ACTIVE','ALL','ALL',$4)`, [u, hash, role, scope]);
  }
  await h.pool.query(`INSERT INTO user_clients (username, client_id) VALUES ('ejec_b','CLI-B')`);
  admin = await h.login('admin', h.ADMIN_PASSWORD);
  for (const u of ['picker1', 'coord1', 'ejec_b']) tokens[u] = await h.login(u, PASS);
});
after(async () => {
  await h?.stop();
});

const post = (url, body, token = admin) => h.request('POST', url, { token, body });

test('la recepción manual usa el cliente del documento y valida el maestro', async () => {
  const r = await post('/api/receive_batch', { docNum: 'R-1', docType: 'GUIA', client_id: 'CLI-B', items: [{ sku: 'CAJA', qty: 5 }] });
  assert.equal(r.status, 200, r.text);
  assert.equal(await stock(`sku='CAJA' AND client_id='CLI-B'`), 5);
  assert.equal(await stock(`sku='CAJA' AND client_id='CLI-A'`), 0);

  const ajeno = await post('/api/receive_batch', { docNum: 'R-2', docType: 'GUIA', client_id: 'CLI-A', items: [{ sku: 'SOLO-B', qty: 5 }] });
  assert.equal(ajeno.status, 422);
  const sinLote = await post('/api/receive_batch', { docNum: 'R-3', docType: 'GUIA', client_id: 'CLI-A', items: [{ sku: 'CON-LOTE', qty: 5 }] });
  assert.equal(sinLote.status, 422);
  const conLote = await post('/api/receive_batch', { docNum: 'R-4', docType: 'GUIA', client_id: 'CLI-A', items: [{ sku: 'CON-LOTE', qty: 5, batch: 'L1' }] });
  assert.equal(conLote.status, 200, conLote.text);
});

test('la merma descuenta solo stock del cliente y la ubicación indicados', async () => {
  await post('/api/receive_batch', { docNum: 'R-5', docType: 'GUIA', client_id: 'CLI-A', items: [{ sku: 'CAJA', qty: 8, location_id: 'RACK-1' }] });
  const r = await post('/api/adjust_batch', { docNum: 'AJ-1', client_id: 'CLI-A', items: [{ sku: 'CAJA', qty: 3, action: 'REMOVE', location_id: 'RACK-1' }] });
  assert.equal(r.status, 200, r.text);
  assert.equal(await stock(`sku='CAJA' AND client_id='CLI-A'`), 5);
  assert.equal(await stock(`sku='CAJA' AND client_id='CLI-B'`), 5, 'el stock de CLI-B no se tocó');
  const demasiado = await post('/api/adjust_batch', { docNum: 'AJ-2', client_id: 'CLI-A', items: [{ sku: 'CAJA', qty: 6, action: 'REMOVE', location_id: 'RACK-1' }] });
  assert.equal(demasiado.status, 400);
});

test('picker y coordinador de transporte no crean OC ni devoluciones', async () => {
  for (const u of ['picker1', 'coord1']) {
    const oc = await post('/api/purchase-orders', { doc_num: `X-${u}`, client_id: 'CLI-A', items: [{ sku: 'CAJA', expected_qty: 500 }] }, tokens[u]);
    assert.equal(oc.status, 403, `${u} OC`);
    const dev = await post('/api/returns', { doc_num: `D-${u}`, client_id: 'CLI-A', reason: 'x', items: [{ sku: 'CAJA', qty: 100 }] }, tokens[u]);
    assert.equal(dev.status, 403, `${u} devolución`);
  }
});

test('la OC se recibe por partes sin duplicar stock y no se recibe de más', async () => {
  const oc = await post('/api/purchase-orders', { doc_num: 'OC-100', client_id: 'CLI-A', items: [{ sku: 'CAJA', expected_qty: 100 }] });
  assert.equal(oc.status, 200, oc.text);
  const poId = oc.body.poId;
  const lineId = (await h.pool.query('SELECT id FROM purchase_order_lines WHERE po_id=$1', [poId])).rows[0].id;
  const antes = await stock(`sku='CAJA' AND client_id='CLI-A'`);

  assert.equal((await post(`/api/purchase-orders/${poId}/receive`, { received_items: [{ lineId, received_qty: 60 }] })).status, 200);
  const segunda = await post(`/api/purchase-orders/${poId}/receive`, { received_items: [{ lineId, received_qty: 40 }] });
  assert.equal(segunda.status, 200, segunda.text);
  assert.equal(segunda.body.status, 'COMPLETED');
  assert.equal(await stock(`sku='CAJA' AND client_id='CLI-A'`), antes + 100);

  assert.equal((await post(`/api/purchase-orders/${poId}/receive`, { received_items: [{ lineId, received_qty: 10 }] })).status, 409);
  assert.equal(await stock(`sku='CAJA' AND client_id='CLI-A'`), antes + 100);

  const otra = await post('/api/purchase-orders', { doc_num: 'OC-101', client_id: 'CLI-A', items: [{ sku: 'CAJA', expected_qty: 5 }] });
  const ajena = await post(`/api/purchase-orders/${otra.body.poId}/receive`, { received_items: [{ lineId, received_qty: 5 }] });
  assert.equal(ajena.status, 400, 'una línea de otra OC se rechaza');
  const repetida = await post(`/api/purchase-orders/${otra.body.poId}/receive`, { received_items: [{ lineId: 1, received_qty: 1 }, { lineId: 1, received_qty: 1 }] });
  assert.equal(repetida.status, 400);
  const fueraDeAlcance = await post(`/api/purchase-orders/${otra.body.poId}/receive`, { received_items: [{ lineId, received_qty: 1 }] }, tokens.ejec_b);
  assert.equal(fueraDeAlcance.status, 404);
});

test('un ASN no se recibe dos veces ni por encima de lo esperado', async () => {
  const asn = await post('/api/asns', { supplier_name: 'Prov', reference: 'ASN-REF-1', client_id: 'CLI-A', lines: [{ sku: 'CAJA', qty_expected: 10 }] });
  assert.equal(asn.status, 200, asn.text);
  const lineId = (await h.pool.query('SELECT id FROM asn_lines WHERE asn_id=$1', [asn.body.id])).rows[0].id;
  const antes = await stock(`sku='CAJA' AND client_id='CLI-A'`);

  assert.equal((await post(`/api/asns/${asn.body.id}/receive`, { lines: [{ line_id: lineId, qty_received: 15 }] })).status, 400);
  const ok = await post(`/api/asns/${asn.body.id}/receive`, { lines: [{ line_id: lineId, qty_received: 10 }] });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.body.status, 'RECIBIDO');
  assert.equal((await post(`/api/asns/${asn.body.id}/receive`, { lines: [{ line_id: lineId, qty_received: 10 }] })).status, 409);
  assert.equal(await stock(`sku='CAJA' AND client_id='CLI-A'`), antes + 10);
});

test('la inspección de una devolución no duplica stock y se hace una sola vez', async () => {
  const dev = await post('/api/returns', { doc_num: 'DEV-1', client_id: 'CLI-A', reason: 'cambio', items: [{ sku: 'CAJA', qty: 10, original_lpn: 'LPN-VIEJO' }] });
  assert.equal(dev.status, 200, dev.text);
  const lpnDev = (await h.pool.query(`SELECT new_lpn FROM return_lines WHERE return_id=$1`, [dev.body.returnId])).rows[0].new_lpn;
  const antes = await stock(`sku='CAJA' AND client_id='CLI-A'`);

  const insp = await post(`/api/returns/${dev.body.returnId}/inspect`, { disposition: 'RESTOCK', qty_accepted: 6 });
  assert.equal(insp.status, 200, insp.text);
  assert.equal(await stock(`sku='CAJA' AND client_id='CLI-A'`), antes - 4, 'quedan las 6 aceptadas, no 10 + 6');
  assert.equal(await stock(`id=$1`, [lpnDev]), 6);
  assert.equal((await post(`/api/returns/${dev.body.returnId}/inspect`, { disposition: 'RESTOCK', qty_accepted: 6 })).status, 409);

  const repetida = await post('/api/returns', { doc_num: 'DEV-2', client_id: 'CLI-A', reason: 'x', items: [{ sku: 'CAJA', qty: 1, original_lpn: 'LPN-VIEJO' }] });
  assert.equal(repetida.status, 409);
  const ajena = await post('/api/returns', { doc_num: 'DEV-3', client_id: 'CLI-A', reason: 'x', items: [{ sku: 'SOLO-B', qty: 1 }] });
  assert.equal(ajena.status, 400);

  const dev4 = await post('/api/returns', { doc_num: 'DEV-4', client_id: 'CLI-A', reason: 'x', items: [{ sku: 'CAJA', qty: 2 }] });
  const lineaOtra = (await h.pool.query(`SELECT id FROM return_lines WHERE return_id=$1`, [dev.body.returnId])).rows[0].id;
  const cruzada = await post(`/api/returns/${dev4.body.returnId}/inspect`, { disposition: 'RESTOCK', lines: [{ id: lineaOtra, qty_ok: 5000 }] });
  assert.equal(cruzada.status, 400);
  const scrap = await post(`/api/returns/${dev4.body.returnId}/inspect`, { disposition: 'SCRAP', qty_accepted: 0 });
  assert.equal(scrap.status, 200, scrap.text);
  const lpn4 = (await h.pool.query(`SELECT new_lpn FROM return_lines WHERE return_id=$1`, [dev4.body.returnId])).rows[0].new_lpn;
  assert.equal(await stock(`id=$1`, [lpn4]), 0, 'SCRAP da de baja el stock devuelto');
});
