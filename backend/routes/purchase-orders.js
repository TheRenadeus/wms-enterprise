// Purchase orders router.
// Flujo: crear OC (PENDING) → recibir parcial/total (PARTIAL/COMPLETED) → cada
// recepción crea LPN en PISO-RECEPCION y registra audit_log INBOUND.

const express = require('express');
const { pool, mapDbError, isUniqueViolation } = require('../db');
const { requireAuth, requireAdmin, checkClientAccess } = require('../middleware');
const { genLpnId } = require('../helpers');

const router = express.Router();

router.get('/purchase-orders', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT po.*,
        (SELECT COUNT(*) FROM purchase_order_lines WHERE po_id=po.id) as total_lines,
        (SELECT COUNT(*) FROM purchase_order_lines WHERE po_id=po.id AND status='RECEIVED') as received_lines
      FROM purchase_orders po ORDER BY created_at DESC LIMIT 50
    `);
    res.json(result.rows);
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});

router.post('/purchase-orders', requireAuth, checkClientAccess('write'), async (req, res) => {
  const { doc_num, supplier, client_id, expected_date, notes, items, username } = req.body;
  if (!doc_num || !String(doc_num).trim()) return res.status(400).json({ error: 'El número de documento (doc_num) es requerido.' });
  if (!items || !Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'La OC debe tener al menos un ítem.' });
  for (let i = 0; i < items.length; i++) {
    const qty = parseFloat(items[i].expected_qty);
    if (!items[i].sku || !String(items[i].sku).trim()) return res.status(400).json({ error: `Ítem ${i+1}: SKU es requerido.` });
    if (isNaN(qty) || qty <= 0) return res.status(400).json({ error: `Ítem ${i+1}: expected_qty debe ser mayor a 0.` });
  }
  try {
    const effectiveClient = (client_id || 'GENERAL').toUpperCase();
    const dupCheck = await pool.query('SELECT id FROM purchase_orders WHERE doc_num=$1 AND client_id=$2 LIMIT 1', [doc_num.trim().toUpperCase(), effectiveClient]);
    if (dupCheck.rows.length > 0) return res.status(409).json({ error: `Ya existe una Orden de Compra con el número '${doc_num}' para el cliente '${effectiveClient}'.` });
    const poId = `OC-${Date.now()}`;
    await pool.query(`INSERT INTO purchase_orders (id,doc_num,supplier,client_id,status,created_by,expected_date,notes) VALUES ($1,$2,$3,$4,'PENDING',$5,$6,$7)`,
      [poId, doc_num.trim().toUpperCase(), supplier||'', effectiveClient, username, expected_date||null, notes||'']);
    for (const item of items) {
      await pool.query(`INSERT INTO purchase_order_lines (po_id,sku,expected_qty,status) VALUES ($1,$2,$3,'PENDING')`,
        [poId, item.sku, parseFloat(item.expected_qty)]);
    }
    res.json({ success: true, poId });
  } catch(e) {
    if (isUniqueViolation(e)) return res.status(409).json({ error: `Ya existe una Orden de Compra con el número '${doc_num}' para este cliente.` });
    res.status(500).json({ error: mapDbError(e) });
  }
});

router.get('/purchase-orders/:id/lines', requireAuth, async (req, res) => {
  try {
    const lines = await pool.query(`
      SELECT pol.*, s."desc", s.uom
      FROM purchase_order_lines pol
      LEFT JOIN master_skus s ON pol.sku = s.sku
      WHERE pol.po_id = $1 ORDER BY pol.id
    `, [req.params.id]);
    const po = await pool.query(`SELECT * FROM purchase_orders WHERE id=$1`, [req.params.id]);
    res.json({ po: po.rows[0], lines: lines.rows });
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});

router.post('/purchase-orders/:id/receive', requireAuth, async (req, res) => {
  const { received_items, username } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const po = await client.query(`SELECT * FROM purchase_orders WHERE id=$1`, [req.params.id]);
    const poClientId = po.rows[0]?.client_id || 'GENERAL';
    for (const item of received_items) {
      const line = await client.query(`SELECT * FROM purchase_order_lines WHERE id=$1`, [item.lineId]);
      if (!line.rows.length) continue;
      const expected = parseFloat(line.rows[0].expected_qty);
      const received = parseFloat(item.received_qty);
      const diff = received - expected;
      await client.query(`UPDATE purchase_order_lines SET received_qty=$1, difference=$2, status=$3 WHERE id=$4`,
        [received, diff, received >= expected ? 'RECEIVED' : 'PARTIAL', item.lineId]);
      if (received > 0) {
        const lpnId = genLpnId('OC');
        await client.query(`INSERT INTO inventory_lpns (id, sku, qty, client_id, status, location_id, glosa) VALUES ($1,$2,$3,$4,'DISPONIBLE','PISO-RECEPCION',$5)`,
          [lpnId, line.rows[0].sku, received, poClientId, `OC: ${req.params.id} Doc: ${po.rows[0]?.doc_num || ''}`]);
        await client.query(`INSERT INTO audit_log (type, sku, qty, glosa, username) VALUES ('INBOUND', $1, $2, $3, $4)`,
          [line.rows[0].sku, received, `Recepción OC ${req.params.id}. LPN: ${lpnId}`, username || 'SYSTEM']);
      }
    }
    const remaining = await client.query(`SELECT COUNT(*) as cnt FROM purchase_order_lines WHERE po_id=$1 AND status='PENDING'`, [req.params.id]);
    const newStatus = parseInt(remaining.rows[0].cnt) === 0 ? 'COMPLETED' : 'PARTIAL';
    await client.query(`UPDATE purchase_orders SET status=$1 WHERE id=$2`, [newStatus, req.params.id]);
    await client.query('COMMIT');
    res.json({ success: true, status: newStatus });
  } catch(e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: mapDbError(e) });
  } finally { client.release(); }
});

module.exports = router;
