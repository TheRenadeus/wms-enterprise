// Historial de documentos cerrados (receive/dispatch/adjust) + anulaciones con
// aprobación (revierte el movimiento de stock). Extraído de server.js (COD-02).
const express = require('express');
const { pool, mapDbError } = require('../db');
const { requireAuth, requireJefe, requireStockWrite } = require('../middleware');
const { genLpnId } = require('../helpers');

const router = express.Router();

router.post('/document-history', requireAuth, async (req, res) => {
  const { id, module, doc_num, doc_type, glosa, username, items, doc_date, doc_ref, entered_at, client_id } = req.body;
  try {
    const totalQty = items.reduce((sum, i) => sum + parseFloat(i.qty || i.qtyToPick || 0), 0);
    await pool.query(
      `INSERT INTO document_history (id,module,doc_num,doc_type,glosa,username,items_json,total_qty,doc_date,doc_ref,entered_at,client_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (id) DO NOTHING`,
      [id, module, doc_num, doc_type||'', glosa||'', username, JSON.stringify(items), totalQty,
       doc_date||null, doc_ref||null, entered_at||null, client_id||'']
    );
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});

router.get('/document-history', requireAuth, async (req, res) => {
  const { module, search, date_from, date_to, limit: qLimit, offset: qOffset } = req.query;
  try {
    let conds = ['1=1']; let params = []; let idx = 1;
    if (module) { conds.push(`module = $${idx++}`); params.push(module); }
    if (search) { conds.push(`(doc_num ILIKE $${idx} OR glosa ILIKE $${idx} OR username ILIKE $${idx})`); params.push(`%${search}%`); idx++; }
    if (date_from) { conds.push(`created_at >= $${idx++}`); params.push(date_from); }
    if (date_to) { conds.push(`created_at <= $${idx++}`); params.push(date_to + 'T23:59:59'); }
    const limit = Math.min(parseInt(qLimit) || 500, 2000);
    const offset = Math.max(parseInt(qOffset) || 0, 0);
    params.push(limit); params.push(offset);
    const result = await pool.query(`SELECT * FROM document_history WHERE ${conds.join(' AND ')} ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`, params);
    res.json(result.rows);
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});

// Función compartida que ejecuta la reversión de stock
async function executeVoid(client, docHistoryId, reason, executedBy) {
  const docRow = await client.query('SELECT * FROM document_history WHERE id=$1', [docHistoryId]);
  if (!docRow.rows.length) throw new Error('Documento no encontrado en historial.');
  const doc = docRow.rows[0];
  if (doc.status === 'ANULADO') throw new Error('El documento ya fue anulado anteriormente.');
  if (!['receive','dispatch'].includes(doc.module)) throw new Error('Solo se pueden anular recepciones y despachos.');

  const items = JSON.parse(doc.items_json || '[]');
  const docNum = doc.doc_num;
  const module = doc.module;

  if (module === 'receive') {
    // Buscar LPNs creados por esta recepción en el audit_log
    const auditRows = await client.query(
      `SELECT glosa FROM audit_log WHERE type='INBOUND' AND glosa LIKE $1`,
      [`%] ${docNum}. LPN: %`]
    );
    const lpnIds = [];
    for (const row of auditRows.rows) {
      const m = row.glosa.match(/LPN:\s+([A-Z0-9-]+)/);
      if (m && m[1]) lpnIds.push(m[1]);
    }
    if (lpnIds.length === 0) throw new Error('No se encontraron LPNs asociados a esta recepción en el audit log.');
    for (const lpnId of lpnIds) {
      await client.query('DELETE FROM inventory_lpns WHERE id=$1', [lpnId]);
    }
    await client.query(
      `INSERT INTO audit_log (type,sku,qty,glosa,username) VALUES ('VOID_INBOUND','N/A',0,$1,$2)`,
      [`Anulación RECEPCIÓN Doc: ${docNum}. LPNs eliminados: ${lpnIds.join(', ')}. Motivo: ${reason}`, executedBy]
    );
  } else if (module === 'dispatch') {
    // Restaurar qty de cada LPN despachado
    for (const item of items) {
      if (!item.lpnId || !(item.qtyToPick > 0)) continue;
      const qty = parseFloat(item.qtyToPick);
      const updated = await client.query(
        'UPDATE inventory_lpns SET qty = qty + $1 WHERE id = $2 RETURNING id',
        [qty, item.lpnId]
      );
      if (updated.rowCount === 0) {
        // LPN fue eliminado por completo (qty=0) — re-insertar
        const skuRow = await client.query('SELECT client_id FROM master_skus WHERE sku=$1 LIMIT 1', [item.sku]);
        const clientId = skuRow.rows[0]?.client_id || 'GENERAL';
        await client.query(
          `INSERT INTO inventory_lpns (id,sku,qty,client_id,status,serial_number,location_id,glosa)
           VALUES ($1,$2,$3,$4,'DISPONIBLE',$5,$6,$7)`,
          [item.lpnId, item.sku, qty, clientId, item.serial||null,
           item.location||'PISO-RECEPCION', `Restaurado por anulación Doc: ${docNum}`]
        );
      }
    }
    await client.query(
      `INSERT INTO audit_log (type,sku,qty,glosa,username) VALUES ('VOID_OUTBOUND','N/A',0,$1,$2)`,
      [`Anulación DESPACHO Doc: ${docNum}. Stock restaurado. Motivo: ${reason}`, executedBy]
    );
  }

  // Marcar documento como ANULADO
  await client.query(
    `UPDATE document_history SET status='ANULADO', void_reason=$1, voided_by=$2, voided_at=NOW() WHERE id=$3`,
    [reason, executedBy, docHistoryId]
  );
}

// Anulación directa (ADMIN / SUPERADMIN)
router.post('/document-history/:id/void', requireJefe, async (req, res) => {
  // Anulación directa de despacho/recepción: JEFE_BODEGA+ (gate requireJefe).
  const { reason } = req.body;
  if (!reason || !reason.trim()) return res.status(400).json({ error: 'Debe indicar el motivo de la anulación.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await executeVoid(client, req.params.id, reason.trim(), req.user.username);
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally { client.release(); }
});

// Solicitar anulación (usuarios no-admin)
router.post('/document-history/:id/void-request', requireStockWrite, async (req, res) => {
  // EJECUTIVO_CUENTA solicita; JEFE_BODEGA+ anula directamente (no necesita solicitar).
  if (['JEFE_BODEGA','ADMIN','SUPERADMIN'].includes(req.user.role)) return res.status(400).json({ error: 'Tu rol puede anular directamente; no necesitas solicitarlo.' });
  const { reason } = req.body;
  if (!reason || !reason.trim()) return res.status(400).json({ error: 'Debe indicar el motivo de la anulación.' });
  try {
    const docRow = await pool.query('SELECT * FROM document_history WHERE id=$1', [req.params.id]);
    if (!docRow.rows.length) return res.status(404).json({ error: 'Documento no encontrado.' });
    const doc = docRow.rows[0];
    if (doc.status === 'ANULADO') return res.status(409).json({ error: 'El documento ya fue anulado.' });
    if (!['receive','dispatch'].includes(doc.module)) return res.status(400).json({ error: 'Solo se pueden anular recepciones y despachos.' });
    // Verificar que no haya solicitud pendiente para este doc
    const existing = await pool.query(`SELECT id FROM anulation_requests WHERE doc_history_id=$1 AND status='PENDIENTE'`, [req.params.id]);
    if (existing.rows.length) return res.status(409).json({ error: 'Ya existe una solicitud de anulación pendiente para este documento.' });
    const reqId = genLpnId('ANUL');
    await pool.query(
      `INSERT INTO anulation_requests (id,doc_history_id,doc_num,module,reason,requested_by) VALUES ($1,$2,$3,$4,$5,$6)`,
      [reqId, req.params.id, doc.doc_num, doc.module, reason.trim(), req.user.username]
    );
    res.json({ success: true, id: reqId });
  } catch (err) { res.status(500).json({ error: mapDbError(err) }); }
});

// Listar solicitudes de anulación (ADMIN/SUPERADMIN)
router.get('/anulation-requests', requireJefe, async (req, res) => {
  try {
    const { status } = req.query;
    const where = status ? `WHERE ar.status=$1` : '';
    const params = status ? [status] : [];
    const rows = await pool.query(
      `SELECT ar.*, dh.doc_type, dh.glosa, dh.total_qty, dh.created_at AS doc_created_at
       FROM anulation_requests ar
       LEFT JOIN document_history dh ON dh.id = ar.doc_history_id
       ${where} ORDER BY ar.created_at DESC LIMIT 200`, params
    );
    res.json(rows.rows);
  } catch (err) { res.status(500).json({ error: mapDbError(err) }); }
});

// Aprobar solicitud de anulación (ADMIN/SUPERADMIN)
router.post('/anulation-requests/:id/approve', requireJefe, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const reqRow = await client.query(`SELECT * FROM anulation_requests WHERE id=$1 FOR UPDATE`, [req.params.id]);
    if (!reqRow.rows.length) throw new Error('Solicitud no encontrada.');
    const anulReq = reqRow.rows[0];
    if (anulReq.status !== 'PENDIENTE') throw new Error('La solicitud ya fue procesada.');
    await executeVoid(client, anulReq.doc_history_id, anulReq.reason, req.user.username);
    await client.query(
      `UPDATE anulation_requests SET status='APROBADA', authorized_by=$1, resolved_at=NOW() WHERE id=$2`,
      [req.user.username, req.params.id]
    );
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally { client.release(); }
});

// Rechazar solicitud de anulación (ADMIN/SUPERADMIN)
router.post('/anulation-requests/:id/reject', requireJefe, async (req, res) => {
  const { reject_reason } = req.body;
  try {
    const r = await pool.query(
      `UPDATE anulation_requests SET status='RECHAZADA', authorized_by=$1, reject_reason=$2, resolved_at=NOW()
       WHERE id=$3 AND status='PENDIENTE' RETURNING id`,
      [req.user.username, reject_reason||'', req.params.id]
    );
    if (!r.rowCount) return res.status(404).json({ error: 'Solicitud no encontrada o ya procesada.' });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: mapDbError(err) }); }
});

module.exports = router;
