// Returns router: alta, listado e inspección de devoluciones.
// El POST /returns crea LPNs en estado RETENIDO/DISPONIBLE según condición.
// La inspección puede repostear stock si disposition=RESTOCK.

const express = require('express');
const { pool, mapDbError } = require('../db');
const { requireAuth, requireJefeOrAbove, checkClientAccess } = require('../middleware');
const { validateBody, schemas } = require('../schemas');
const { genLpnId } = require('../helpers');

const router = express.Router();

router.post('/returns', requireAuth, checkClientAccess('write', { required: true }), async (req, res) => {
  const { doc_num, doc_type, client_id, reason, glosa, items, username } = req.body;
  if (!items || items.length === 0) return res.status(400).json({ error: 'Debe incluir al menos un ítem.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const returnId = genLpnId('RET');
    await client.query(`INSERT INTO returns (id,doc_num,doc_type,client_id,reason,status,created_by,glosa) VALUES ($1,$2,$3,$4,$5,'COMPLETED',$6,$7)`,
      [returnId, doc_num, doc_type || 'DEVOLUCION', client_id || 'GENERAL', reason, username, glosa || '']);

    for (const item of items) {
      const itemQty = parseFloat(item.qty);
      if (isNaN(itemQty) || itemQty <= 0) throw new Error(`La cantidad de devolución para SKU ${item.sku} debe ser mayor a 0.`);

      if (item.original_lpn && item.original_lpn.trim() !== '') {
        const alreadyRet = await client.query(
          'SELECT return_id FROM returned_lpns WHERE original_lpn = $1', [item.original_lpn]
        );
        if (alreadyRet.rows.length > 0) {
          throw new Error(`El LPN '${item.original_lpn}' ya fue devuelto anteriormente (referencia: ${alreadyRet.rows[0].return_id}).`);
        }
      }

      const newLpnId = genLpnId('RET');
      const skuRow = await client.query('SELECT client_id FROM master_skus WHERE sku=$1 LIMIT 1', [item.sku]);
      const clientId = skuRow.rows[0]?.client_id || client_id || 'GENERAL';

      await client.query(`INSERT INTO inventory_lpns (id,sku,qty,client_id,status,location_id,glosa) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [newLpnId, item.sku, itemQty, clientId, item.condition === 'MALO' ? 'RETENIDO' : 'DISPONIBLE', item.location_id || 'PISO-RECEPCION', `Devolución ${returnId}: ${reason}`]);

      await client.query(`INSERT INTO return_lines (return_id,sku,qty,original_lpn,new_lpn,condition,location_id,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [returnId, item.sku, itemQty, item.original_lpn || '', newLpnId, item.condition || 'BUENO', item.location_id || 'PISO-RECEPCION', item.notes || '']);

      if (item.original_lpn && item.original_lpn.trim() !== '') {
        await client.query(
          'INSERT INTO returned_lpns (original_lpn, return_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
          [item.original_lpn, returnId]
        );
      }

      await client.query(`INSERT INTO audit_log (type,sku,qty,glosa,username) VALUES ('INBOUND',$1,$2,$3,$4)`,
        [item.sku, itemQty, `Devolución [${doc_type || 'DEV'}] ${doc_num}. LPN: ${newLpnId}. Motivo: ${reason}`, username]);
    }

    await client.query('COMMIT');
    res.json({ success: true, returnId });
  } catch(e) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: e.message || mapDbError(e) });
  } finally { client.release(); }
});

router.get('/returns', requireAuth, async (req, res) => {
  try {
    const q = `SELECT r.*, COALESCE(json_agg(rl ORDER BY rl.id) FILTER (WHERE rl.id IS NOT NULL),'[]') as lines
             FROM returns r LEFT JOIN return_lines rl ON rl.return_id=r.id GROUP BY r.id ORDER BY r.created_at DESC LIMIT 200`;
    res.json((await pool.query(q)).rows);
  } catch(e){ res.status(500).json({ error: mapDbError(e) }); }
});

router.post('/returns/:id/inspect', requireJefeOrAbove, validateBody(schemas.returnsInspect), async (req, res) => {
  const { disposition } = req.body;
  const inspection_notes = req.body.inspection_notes || req.body.condition_notes || null;
  const qty_accepted = req.body.qty_accepted ? parseFloat(req.body.qty_accepted) : null;
  const location_to = req.body.location_to || 'PISO-RECEPCION';
  const lines = req.body.lines || null;
  if (!disposition) return res.status(400).json({ error: 'disposition requerida (RESTOCK|SCRAP|SUPPLIER).' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`UPDATE returns SET inspection_status='INSPECCIONADO', disposition=$1, inspection_notes=$2, inspected_by=$3, inspected_at=NOW() WHERE id=$4`,
      [disposition, inspection_notes, req.user.username, req.params.id]);
    if (Array.isArray(lines)) {
      for (const l of lines) {
        await client.query(`UPDATE return_lines SET qty_ok=$1, qty_damaged=$2 WHERE id=$3`, [parseFloat(l.qty_ok)||0, parseFloat(l.qty_damaged)||0, l.id]);
      }
    }
    if (disposition === 'RESTOCK') {
      if (qty_accepted && qty_accepted > 0) {
        const retRow = await client.query(`SELECT * FROM returns WHERE id=$1`, [req.params.id]);
        const ret = retRow.rows[0];
        if (ret) {
          const sku = ret.sku || (await client.query(`SELECT sku FROM return_lines WHERE return_id=$1 LIMIT 1`, [req.params.id])).rows[0]?.sku;
          if (sku) {
            const lpnId = genLpnId('RET');
            const skuRow = await client.query('SELECT client_id FROM master_skus WHERE sku=$1 LIMIT 1', [sku]);
            const clientId = skuRow.rows[0]?.client_id || ret.client_id || 'GENERAL';
            await client.query(`INSERT INTO inventory_lpns (id,sku,qty,client_id,status,location_id,glosa) VALUES ($1,$2,$3,$4,'DISPONIBLE',$5,$6)`,
              [lpnId, sku, qty_accepted, clientId, location_to, `Devolución aprobada ${req.params.id}`]);
            await client.query(`INSERT INTO audit_log (type,sku,qty,glosa,username) VALUES ('RETURN_IN',$1,$2,$3,$4)`,
              [sku, qty_accepted, `Restock devolución ${req.params.id}. Destino: ${location_to}`, req.user.username]);
          }
        }
      } else if (Array.isArray(lines)) {
        const rl = await client.query(`SELECT * FROM return_lines WHERE return_id=$1`, [req.params.id]);
        for (const l of rl.rows) {
          const qtyOk = parseFloat(l.qty_ok)||0;
          if (qtyOk > 0) {
            const lpnId = genLpnId('RET');
            const skuRow = await client.query('SELECT client_id FROM master_skus WHERE sku=$1 LIMIT 1', [l.sku]);
            const clientId = skuRow.rows[0]?.client_id || 'GENERAL';
            await client.query(`INSERT INTO inventory_lpns (id,sku,qty,client_id,status,location_id,glosa) VALUES ($1,$2,$3,$4,'DISPONIBLE',$5,$6)`,
              [lpnId, l.sku, qtyOk, clientId, location_to, `Devolución aprobada ${req.params.id}`]);
            await client.query(`INSERT INTO audit_log (type,sku,qty,glosa,username) VALUES ('RETURN_IN',$1,$2,$3,$4)`,
              [l.sku, qtyOk, `Restock devolución ${req.params.id}`, req.user.username]);
          }
        }
      }
    }
    await client.query('COMMIT');
    res.json({ success: true });
  } catch(e){ await client.query('ROLLBACK'); res.status(500).json({ error: mapDbError(e) }); }
  finally { client.release(); }
});

module.exports = router;
