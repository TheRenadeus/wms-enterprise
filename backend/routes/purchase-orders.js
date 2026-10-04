// Purchase orders router.
// Flujo: crear OC (PENDING) → recibir parcial/total (PARTIAL/COMPLETED) → cada
// recepción crea LPN en PISO-RECEPCION y registra audit_log INBOUND.

const express = require('express');
const { pool, mapDbError, isUniqueViolation, userError } = require('../db');
const { requireAuth, requireAdmin, requireStockWrite, checkClientAccess } = require('../middleware');
const { validarEntrada, rechazoEntrada, crearLpnsEntrada, httpError } = require('../stock-entrante');
const { genLpnId } = require('../helpers');
const { scopeCondition, clientAllowed } = require('../scope');

const router = express.Router();

router.get('/purchase-orders', requireAuth, async (req, res) => {
  try {
    const params = [];
    const result = await pool.query(`
      SELECT po.*,
        (SELECT COUNT(*) FROM purchase_order_lines WHERE po_id=po.id) as total_lines,
        (SELECT COUNT(*) FROM purchase_order_lines WHERE po_id=po.id AND status='RECEIVED') as received_lines
      FROM purchase_orders po
      WHERE ${scopeCondition(req.clientScope, 'po.client_id', params)}
      ORDER BY created_at DESC LIMIT 50
    `, params);
    res.json(result.rows);
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});

router.post('/purchase-orders', requireStockWrite, checkClientAccess('write'), async (req, res) => {
  const { doc_num, supplier, client_id, expected_date, notes, items } = req.body;
  if (!doc_num || !String(doc_num).trim()) return res.status(400).json({ error: 'El número de documento (doc_num) es requerido.' });
  if (!items || !Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'La OC debe tener al menos un ítem.' });
  for (let i = 0; i < items.length; i++) {
    const qty = parseFloat(items[i]?.expected_qty);
    if (!items[i]?.sku || !String(items[i].sku).trim()) return res.status(400).json({ error: `Ítem ${i+1}: SKU es requerido.` });
    if (isNaN(qty) || qty <= 0) return res.status(400).json({ error: `Ítem ${i+1}: expected_qty debe ser mayor a 0.` });
  }
  const effectiveClient = String(client_id || 'GENERAL').trim().toUpperCase();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const dupCheck = await client.query('SELECT id FROM purchase_orders WHERE doc_num=$1 AND client_id=$2 LIMIT 1', [String(doc_num).trim().toUpperCase(), effectiveClient]);
    if (dupCheck.rows.length > 0) { await client.query('ROLLBACK'); return res.status(409).json({ error: `Ya existe una Orden de Compra con el número '${doc_num}' para el cliente '${effectiveClient}'.` }); }
    // Los SKU tienen que ser del cliente de la OC.
    const skus = [...new Set(items.map(it => String(it.sku).trim().toUpperCase()))];
    const existentes = new Set((await client.query('SELECT sku FROM master_skus WHERE sku = ANY($1) AND client_id=$2 AND deleted_at IS NULL', [skus, effectiveClient])).rows.map(r => r.sku));
    const faltan = skus.filter(s => !existentes.has(s));
    if (faltan.length) { await client.query('ROLLBACK'); return res.status(400).json({ error: `SKU que no existen para el cliente ${effectiveClient}: ${faltan.join(', ')}` }); }
    const poId = `OC-${Date.now()}`;
    await client.query(`INSERT INTO purchase_orders (id,doc_num,supplier,client_id,status,created_by,expected_date,notes) VALUES ($1,$2,$3,$4,'PENDING',$5,$6,$7)`,
      [poId, String(doc_num).trim().toUpperCase(), supplier||'', effectiveClient, req.user.username, expected_date||null, notes||'']);
    for (const item of items) {
      await client.query(`INSERT INTO purchase_order_lines (po_id,sku,expected_qty,status) VALUES ($1,$2,$3,'PENDING')`,
        [poId, String(item.sku).trim().toUpperCase(), parseFloat(item.expected_qty)]);
    }
    await client.query('COMMIT');
    res.json({ success: true, poId });
  } catch(e) {
    await client.query('ROLLBACK').catch(() => {});
    if (isUniqueViolation(e)) return res.status(409).json({ error: `Ya existe una Orden de Compra con el número '${doc_num}' para este cliente.` });
    res.status(500).json({ error: mapDbError(e) });
  } finally { client.release(); }
});

router.get('/purchase-orders/:id/lines', requireAuth, async (req, res) => {
  try {
    const po = await pool.query(`SELECT * FROM purchase_orders WHERE id=$1`, [req.params.id]);
    // Una OC de otro cliente se trata como inexistente (no se confirma que exista).
    if (!po.rows[0] || !clientAllowed(req.clientScope, po.rows[0].client_id)) {
      return res.status(404).json({ error: 'Orden de compra no encontrada.' });
    }
    const lines = await pool.query(`
      SELECT pol.*, s."desc", s.uom
      FROM purchase_order_lines pol
      LEFT JOIN master_skus s ON pol.sku = s.sku AND s.client_id = $2
      WHERE pol.po_id = $1 ORDER BY pol.id
    `, [req.params.id, po.rows[0].client_id]);
    res.json({ po: po.rows[0], lines: lines.rows });
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});

// Recepción de OC. received_qty es lo recibido EN ESTA recepción (no el acumulado):
// el LPN se crea solo por esa cantidad y la línea acumula. Una línea completa no se
// vuelve a recibir y la OC queda bloqueada mientras se procesa.
router.post('/purchase-orders/:id/receive', requireStockWrite, async (req, res) => {
  const items = Array.isArray(req.body.received_items) ? req.body.received_items : [];
  if (!items.length) return res.status(400).json({ error: 'Ingrese las cantidades recibidas.' });
  const ids = items.map(it => String(it?.lineId ?? ''));
  if (ids.some(id => !id) || new Set(ids).size !== ids.length) return res.status(400).json({ error: 'Cada línea de la OC puede venir una sola vez.' });
  for (const it of items) {
    const q = Number(it.received_qty);
    if (!Number.isFinite(q) || q < 0) return res.status(400).json({ error: 'Las cantidades recibidas deben ser números mayores o iguales a 0.' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const poRes = await client.query(`SELECT * FROM purchase_orders WHERE id=$1 FOR UPDATE`, [req.params.id]);
    const po = poRes.rows[0];
    if (!po || !clientAllowed(req.clientScope, po.client_id)) throw httpError(404, 'Orden de compra no encontrada.');
    if (po.status === 'COMPLETED') throw httpError(409, 'La orden de compra ya fue recibida completa.');
    const filas = [];
    const lineas = [];
    for (const it of items) {
      const qty = Number(it.received_qty);
      if (qty === 0) continue;
      const lr = await client.query(`SELECT * FROM purchase_order_lines WHERE id=$1 AND po_id=$2 FOR UPDATE`, [it.lineId, po.id]);
      const line = lr.rows[0];
      if (!line) throw httpError(400, `La línea ${it.lineId} no pertenece a esta orden de compra.`);
      if (line.status === 'RECEIVED') throw httpError(409, `La línea del SKU ${line.sku} ya fue recibida completa.`);
      lineas.push({ id: line.id, total: Number(line.received_qty || 0) + qty });
      filas.push({ sku: line.sku, qty, location_id: it.location_id, batch_number: it.batch_number, expiry_date: it.expiry_date, serial_number: it.serial_number });
    }
    if (!filas.length) throw httpError(400, 'Ingrese al menos una cantidad mayor a 0.');
    const { valid, errors } = await validarEntrada(client, filas, po.client_id);
    if (errors.length) throw rechazoEntrada(errors);
    for (const l of lineas) {
      await client.query(
        `UPDATE purchase_order_lines SET received_qty=$1, difference=$1-expected_qty,
           status = CASE WHEN $1 >= expected_qty THEN 'RECEIVED' ELSE 'PARTIAL' END WHERE id=$2`,
        [l.total, l.id]);
    }
    await crearLpnsEntrada(client, valid, {
      prefijo: 'OC', glosaLpn: `OC: ${po.id} Doc: ${po.doc_num || ''}`, username: req.user.username,
      glosaKardex: (lpnId) => `Recepción OC ${po.id}. LPN: ${lpnId}`,
    });
    const pend = await client.query(`SELECT COUNT(*)::int AS n FROM purchase_order_lines WHERE po_id=$1 AND status <> 'RECEIVED'`, [po.id]);
    const newStatus = pend.rows[0].n === 0 ? 'COMPLETED' : 'PARTIAL';
    await client.query(`UPDATE purchase_orders SET status=$1 WHERE id=$2`, [newStatus, po.id]);
    await client.query('COMMIT');
    res.json({ success: true, status: newStatus });
  } catch(e) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(e.status || (e.severity ? 500 : 400)).json({ error: userError(e), ...(e.errors ? { errors: e.errors } : {}) });
  } finally { client.release(); }
});

module.exports = router;
