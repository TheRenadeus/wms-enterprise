// Returns router: alta, listado e inspección de devoluciones.
// El POST /returns crea un LPN por línea (RETENIDO si la condición es MALO, si no
// DISPONIBLE) con el cliente de la devolución. La inspección opera sobre esos
// mismos LPN: RESTOCK deja disponible lo aceptado y da de baja el resto; SCRAP y
// SUPPLIER dan de baja lo que quede en stock. Una devolución se inspecciona una vez.

const express = require('express');
const { pool, mapDbError, isUniqueViolation, userError } = require('../db');
const { requireAuth, requireJefeOrAbove, requireStockWrite, checkClientAccess } = require('../middleware');
const { validateBody, schemas } = require('../schemas');
const { genLpnId } = require('../helpers');
const { scopeCondition, clientAllowed } = require('../scope');
const { httpError, clientesEquivalentes, duenosDeSkus } = require('../stock-entrante');

const router = express.Router();

const txt = (v) => (v === undefined || v === null ? '' : String(v).trim());

async function ubicacionValida(db, loc) {
  if (!loc || loc === 'PISO-RECEPCION') return 'PISO-RECEPCION';
  const r = await db.query('SELECT 1 FROM locations_master WHERE location_id=$1', [loc]);
  if (!r.rows.length) throw httpError(400, `La ubicación '${loc}' no existe.`);
  return loc;
}

router.post('/returns', requireStockWrite, checkClientAccess('write', { required: true }), async (req, res) => {
  const { doc_num, doc_type, reason, glosa, items } = req.body;
  const username = req.user.username;
  const clientId = txt(req.body.client_id).toUpperCase();
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'Debe incluir al menos un ítem.' });
  if (!txt(doc_num)) return res.status(400).json({ error: 'El número de documento es obligatorio.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const returnId = genLpnId('RET');
    const equivalentes = await clientesEquivalentes(client, clientId);
    const duenos = await duenosDeSkus(client, items.map((it) => it?.sku), equivalentes);
    await client.query(`INSERT INTO returns (id,doc_num,doc_type,client_id,reason,status,created_by,glosa) VALUES ($1,$2,$3,$4,$5,'COMPLETED',$6,$7)`,
      [returnId, txt(doc_num), doc_type || 'DEVOLUCION', clientId, reason, username, glosa || '']);

    for (const item of items) {
      const sku = txt(item?.sku).toUpperCase();
      const itemQty = Number(item?.qty);
      if (!sku || !Number.isFinite(itemQty) || itemQty <= 0) throw httpError(400, `La cantidad de devolución para SKU ${sku || '(vacío)'} debe ser mayor a 0.`);
      // El producto tiene que ser del cliente de la devolución.
      const dueno = duenos.get(sku);
      if (!dueno) throw httpError(400, `El SKU ${sku} no existe para el cliente ${clientId}.`);
      const location = await ubicacionValida(client, txt(item.location_id));
      const originalLpn = txt(item.original_lpn);

      if (originalLpn) {
        // La clave primaria de returned_lpns serializa devoluciones simultáneas del
        // mismo LPN: la segunda espera a la primera y luego no inserta nada.
        const marca = await client.query(
          'INSERT INTO returned_lpns (original_lpn, return_id) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING original_lpn',
          [originalLpn, returnId]);
        if (!marca.rowCount) {
          const prev = await client.query('SELECT return_id FROM returned_lpns WHERE original_lpn = $1', [originalLpn]);
          throw httpError(409, `El LPN '${originalLpn}' ya fue devuelto anteriormente (referencia: ${prev.rows[0]?.return_id}).`);
        }
      }

      const newLpnId = genLpnId('RET');
      await client.query(
        `INSERT INTO inventory_lpns (id,sku,sku_version,qty,client_id,status,location_id,glosa)
         VALUES ($1,$2,COALESCE((SELECT current_version FROM master_skus WHERE sku=$8 AND client_id=$9),1),$3,$4,$5,$6,$7)`,
        [newLpnId, sku, itemQty, dueno, item.condition === 'MALO' ? 'RETENIDO' : 'DISPONIBLE', location, `Devolución ${returnId}: ${reason || ''}`, sku, dueno]);

      await client.query(`INSERT INTO return_lines (return_id,sku,qty,original_lpn,new_lpn,condition,location_id,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [returnId, sku, itemQty, originalLpn, newLpnId, item.condition || 'BUENO', location, item.notes || '']);

      await client.query(`INSERT INTO audit_log (type,sku,qty,glosa,username,client_id) VALUES ('INBOUND',$1,$2,$3,$4,$5)`,
        [sku, itemQty, `Devolución [${doc_type || 'DEV'}] ${txt(doc_num)}. LPN: ${newLpnId}. Motivo: ${reason || ''}`, username, dueno]);
    }

    await client.query('COMMIT');
    res.json({ success: true, returnId });
  } catch(e) {
    await client.query('ROLLBACK').catch(() => {});
    if (isUniqueViolation(e)) return res.status(409).json({ error: `Ya existe una devolución con el número '${doc_num}' para este cliente y tipo.` });
    res.status(e.status || (e.severity ? 500 : 400)).json({ error: userError(e) });
  } finally { client.release(); }
});

router.get('/returns', requireAuth, async (req, res) => {
  try {
    const params = [];
    const q = `SELECT r.*, COALESCE(json_agg(rl ORDER BY rl.id) FILTER (WHERE rl.id IS NOT NULL),'[]') as lines
             FROM returns r LEFT JOIN return_lines rl ON rl.return_id=r.id
             WHERE ${scopeCondition(req.clientScope, 'r.client_id', params)}
             GROUP BY r.id ORDER BY r.created_at DESC LIMIT 200`;
    res.json((await pool.query(q, params)).rows);
  } catch(e){ res.status(500).json({ error: mapDbError(e) }); }
});

router.post('/returns/:id/inspect', requireJefeOrAbove, validateBody(schemas.returnsInspect), async (req, res) => {
  const { disposition } = req.body;
  const inspection_notes = req.body.inspection_notes || req.body.condition_notes || null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ret = (await client.query(`SELECT * FROM returns WHERE id=$1 FOR UPDATE`, [req.params.id])).rows[0];
    if (!ret || !clientAllowed(req.clientScope, ret.client_id)) throw httpError(404, 'Devolución no encontrada.');
    if (ret.inspection_status === 'INSPECCIONADO') throw httpError(409, 'Esta devolución ya fue inspeccionada.');
    const lineas = (await client.query(`SELECT * FROM return_lines WHERE return_id=$1 ORDER BY id FOR UPDATE`, [ret.id])).rows;
    const locationTo = req.body.location_to ? await ubicacionValida(client, txt(req.body.location_to)) : null;

    // Cantidad aceptada por línea: detalle por línea o un total repartido en orden.
    const aceptada = new Map();
    if (Array.isArray(req.body.lines)) {
      for (const l of req.body.lines) {
        const linea = lineas.find((x) => String(x.id) === String(l.id));
        if (!linea) throw httpError(400, `La línea ${l.id} no pertenece a esta devolución.`);
        const ok = Number(l.qty_ok) || 0;
        const dañada = Number(l.qty_damaged) || 0;
        if (ok + dañada > Number(linea.qty)) throw httpError(400, `${linea.sku}: lo inspeccionado (${ok + dañada}) supera lo devuelto (${linea.qty}).`);
        aceptada.set(linea.id, ok);
        await client.query(`UPDATE return_lines SET qty_ok=$1, qty_damaged=$2 WHERE id=$3 AND return_id=$4`, [ok, dañada, linea.id, ret.id]);
      }
    } else {
      let resto = Number(req.body.qty_accepted) || 0;
      const total = lineas.reduce((s, l) => s + Number(l.qty), 0);
      if (resto > total) throw httpError(400, `La cantidad aceptada (${resto}) supera lo devuelto (${total}).`);
      for (const linea of lineas) {
        const ok = Math.min(resto, Number(linea.qty));
        resto -= ok;
        aceptada.set(linea.id, ok);
        await client.query(`UPDATE return_lines SET qty_ok=$1, qty_damaged=$2 WHERE id=$3 AND return_id=$4`, [ok, Number(linea.qty) - ok, linea.id, ret.id]);
      }
    }

    // Se opera sobre el LPN creado por cada línea (lo que siga en stock).
    for (const linea of lineas) {
      if (!linea.new_lpn) continue;
      const lpn = (await client.query(`SELECT id, qty, sku, client_id FROM inventory_lpns WHERE id=$1 FOR UPDATE`, [linea.new_lpn])).rows[0];
      if (!lpn) continue; // ya salió del stock
      const enStock = Number(lpn.qty);
      const conservar = disposition === 'RESTOCK' ? Math.min(aceptada.get(linea.id) || 0, enStock) : 0;
      const baja = enStock - conservar;
      if (conservar > 0) {
        await client.query(`UPDATE inventory_lpns SET qty=$1, status='DISPONIBLE', location_id=COALESCE($2, location_id) WHERE id=$3`, [conservar, locationTo, lpn.id]);
      } else {
        await client.query(`DELETE FROM inventory_lpns WHERE id=$1`, [lpn.id]);
      }
      if (baja > 0) {
        await client.query(`INSERT INTO audit_log (type,sku,qty,glosa,username,client_id) VALUES ('ADJUST_OUT',$1,$2,$3,$4,$5)`,
          [lpn.sku, baja, `Baja por inspección de devolución ${ret.id} (${disposition}). LPN: ${lpn.id}`, req.user.username, lpn.client_id]);
      }
    }

    await client.query(`UPDATE returns SET inspection_status='INSPECCIONADO', disposition=$1, inspection_notes=$2, inspected_by=$3, inspected_at=NOW() WHERE id=$4`,
      [disposition, inspection_notes, req.user.username, ret.id]);
    await client.query('COMMIT');
    res.json({ success: true });
  } catch(e){
    await client.query('ROLLBACK').catch(() => {});
    res.status(e.status || (e.severity ? 500 : 400)).json({ error: userError(e) });
  } finally { client.release(); }
});

module.exports = router;
