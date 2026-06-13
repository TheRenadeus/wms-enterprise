// Packing orders router (Sistema 3 — Empaque).
// Crea órdenes a partir de un dispatch, marca líneas EMPACADO y cierra.

const express = require('express');

const { pool, mapDbError } = require('../db');
const { requireJefeOrAbove, requirePickerOrAbove } = require('../middleware');
const { genLpnId } = require('../helpers');

const router = express.Router();

router.get('/packing-orders', requirePickerOrAbove, async (req, res) => {
  try {
    const r = await pool.query(`SELECT po.*, COALESCE(json_agg(pl ORDER BY pl.id) FILTER (WHERE pl.id IS NOT NULL),'[]') as lines
      FROM packing_orders po LEFT JOIN packing_lines pl ON pl.packing_order_id=po.id
      GROUP BY po.id ORDER BY po.created_at DESC LIMIT 200`);
    res.json(r.rows);
  } catch(e){ res.status(500).json({ error: mapDbError(e) }); }
});

router.post('/packing-orders', requireJefeOrAbove, async (req, res) => {
  const { dispatch_doc_num, client_id, lines, notes } = req.body;
  if (!dispatch_doc_num) return res.status(400).json({ error: 'Número de documento requerido.' });
  const id = genLpnId('PACK');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`INSERT INTO packing_orders (id,dispatch_doc_num,client_id,notes,created_by) VALUES ($1,$2,$3,$4,$5)`,
      [id, dispatch_doc_num.toUpperCase(), client_id||null, notes||null, req.user.username]);
    for (const l of (lines||[])) {
      await client.query(`INSERT INTO packing_lines (packing_order_id,lpn_id,sku,sku_desc,qty_expected) VALUES ($1,$2,$3,$4,$5)`,
        [id, l.lpn_id||null, l.sku, l.sku_desc||null, parseFloat(l.qty_expected)||0]);
    }
    await client.query('COMMIT');
    res.json({ success: true, id });
  } catch(e){ await client.query('ROLLBACK'); res.status(500).json({ error: mapDbError(e) }); }
  finally { client.release(); }
});

router.get('/packing-orders/:id', requirePickerOrAbove, async (req, res) => {
  try {
    const r = await pool.query(`SELECT po.*, COALESCE(json_agg(pl ORDER BY pl.id) FILTER (WHERE pl.id IS NOT NULL),'[]') as lines
      FROM packing_orders po LEFT JOIN packing_lines pl ON pl.packing_order_id=po.id
      WHERE po.id=$1 GROUP BY po.id`, [req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Orden no encontrada.' });
    res.json(r.rows[0]);
  } catch(e){ res.status(500).json({ error: mapDbError(e) }); }
});

router.put('/packing-orders/:id/lines/:lineId', requirePickerOrAbove, async (req, res) => {
  const { qty_packed, carton_num } = req.body;
  const cartonNum = parseInt(carton_num) || 1;
  try {
    await pool.query(`UPDATE packing_lines SET qty_packed=$1, carton_num=$2, status='EMPACADO' WHERE id=$3 AND packing_order_id=$4`,
      [parseFloat(qty_packed)||0, cartonNum, req.params.lineId, req.params.id]);
    res.json({ success: true });
  } catch(e){ res.status(500).json({ error: mapDbError(e) }); }
});

router.post('/packing-orders/:id/complete', requirePickerOrAbove, async (req, res) => {
  const { carton_count, total_weight_kg } = req.body;
  try {
    await pool.query(`UPDATE packing_orders SET status='EMPACADO', packed_by=$1, carton_count=$2, total_weight_kg=$3, packed_at=NOW() WHERE id=$4`,
      [req.user.username, parseInt(carton_count)||1, parseFloat(total_weight_kg)||null, req.params.id]);
    res.json({ success: true });
  } catch(e){ res.status(500).json({ error: mapDbError(e) }); }
});

module.exports = router;
