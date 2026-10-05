// Historial de documentos cerrados (receive/dispatch/adjust) + anulaciones con
// aprobación (revierte el movimiento de stock). Extraído de server.js (COD-02).
const express = require('express');
const { pool, mapDbError, userError } = require('../db');
const { requireAuth, requireJefe, requireStockWrite } = require('../middleware');
const { scopeCondition, clientAllowed } = require('../scope');
const { httpError, r2 } = require('../stock-entrante');
const { genLpnId } = require('../helpers');

const router = express.Router();

// El historial lo graba el servidor al cerrar recepción, despacho o ajuste, dentro
// de la misma transacción (registrarHistorial en helpers.js). Ya no se acepta desde
// el cliente: permitiría documentos sin movimiento que luego se anulan o facturan.
router.post('/document-history', requireAuth, (req, res) => {
  res.status(410).json({ error: 'El historial de documentos lo registra el servidor al cerrar cada documento.' });
});

router.get('/document-history', requireAuth, async (req, res) => {
  const { module, search, date_from, date_to, limit: qLimit, offset: qOffset } = req.query;
  try {
    let conds = ['1=1']; let params = []; let idx = 1;
    if (module) { conds.push(`module = $${idx++}`); params.push(module); }
    if (search) { conds.push(`(doc_num ILIKE $${idx} OR glosa ILIKE $${idx} OR username ILIKE $${idx})`); params.push(`%${search}%`); idx++; }
    if (date_from) { conds.push(`created_at >= $${idx++}`); params.push(date_from); }
    if (date_to) { conds.push(`created_at <= $${idx++}`); params.push(date_to + 'T23:59:59'); }
    conds.push(scopeCondition(req.clientScope, 'client_id', params));
    idx = params.length + 1;
    const limit = Math.min(parseInt(qLimit) || 500, 2000);
    const offset = Math.max(parseInt(qOffset) || 0, 0);
    params.push(limit); params.push(offset);
    const result = await pool.query(`SELECT * FROM document_history WHERE ${conds.join(' AND ')} ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`, params);
    res.json(result.rows);
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});

// Función compartida que ejecuta la reversión de stock. Trabaja con los LPN que el
// servidor registró en el historial al cerrar el documento; para documentos
// anteriores a ese registro, con el kardex del documento (prefijo exacto, sin
// comodines). No anula si algún LPN ya tuvo movimientos.
async function executeVoid(client, docHistoryId, reason, executedBy, scope) {
  const docRow = await client.query('SELECT * FROM document_history WHERE id=$1 FOR UPDATE', [docHistoryId]);
  const doc = docRow.rows[0];
  if (!doc || !clientAllowed(scope, doc.client_id)) throw httpError(404, 'Documento no encontrado en historial.');
  if (doc.status === 'ANULADO') throw httpError(409, 'El documento ya fue anulado anteriormente.');
  if (!['receive','dispatch'].includes(doc.module)) throw httpError(400, 'Solo se pueden anular recepciones y despachos.');

  let items = [];
  try { items = JSON.parse(doc.items_json || '[]'); } catch { items = []; }
  if (!Array.isArray(items)) items = [];
  const docNum = doc.doc_num;
  const docClient = doc.client_id ? String(doc.client_id).toUpperCase() : null;

  if (doc.module === 'receive') {
    let creados = items.filter(i => i && i.lpnId).map(i => ({ lpnId: String(i.lpnId), qty: Number(i.qty) }));
    if (!creados.length) {
      const prefijo = `Doc: [${doc.doc_type || 'N/A'}] ${docNum}. LPN: `;
      const patron = prefijo.replace(/[\\%_]/g, '\\$&') + '%';
      const kardex = await client.query(`SELECT glosa, qty FROM audit_log WHERE type='INBOUND' AND glosa LIKE $1 ESCAPE '\\'`, [patron]);
      creados = kardex.rows.map(r => {
        const m = r.glosa.slice(prefijo.length).match(/^([A-Za-z0-9-]+)/);
        return m ? { lpnId: m[1], qty: Number(r.qty) } : null;
      }).filter(Boolean);
    }
    if (!creados.length) throw httpError(400, 'No se encontraron los LPN de esta recepción.');
    for (const c of creados) {
      const lpn = (await client.query('SELECT id, qty, sku, client_id FROM inventory_lpns WHERE id=$1 FOR UPDATE', [c.lpnId])).rows[0];
      if (!lpn) throw httpError(409, `El LPN ${c.lpnId} ya no está en stock: no se puede anular la recepción.`);
      if (docClient && String(lpn.client_id || '').toUpperCase() !== docClient) throw httpError(409, `El LPN ${c.lpnId} no pertenece al cliente del documento.`);
      if (Number.isFinite(c.qty) && r2(lpn.qty) !== r2(c.qty)) {
        throw httpError(409, `El LPN ${c.lpnId} ya tuvo movimientos (tiene ${Number(lpn.qty)} de ${c.qty}): no se puede anular la recepción.`);
      }
      c.sku = lpn.sku; c.clientId = lpn.client_id; c.qty = Number(lpn.qty);
    }
    for (const c of creados) {
      await client.query('DELETE FROM inventory_lpns WHERE id=$1', [c.lpnId]);
      await client.query(
        `INSERT INTO audit_log (type,sku,qty,glosa,username,client_id) VALUES ('VOID_INBOUND',$1,$2,$3,$4,$5)`,
        [c.sku, c.qty, `Anulación RECEPCIÓN Doc: ${docNum}. LPN eliminado: ${c.lpnId}. Motivo: ${reason}`, executedBy, c.clientId]);
    }
  } else {
    if (items.some(i => i && i.isKit && !i.lpnId)) {
      throw httpError(400, 'Este despacho incluye kits registrados con el formato anterior: corrija el stock con un ajuste.');
    }
    for (const item of items) {
      const qty = Number(item?.qtyToPick);
      if (!item?.lpnId || !(qty > 0)) continue;
      const clientId = String(item.client_id || docClient || '').toUpperCase();
      if (!clientId) throw httpError(400, `No se puede determinar el cliente del LPN ${item.lpnId}.`);
      const updated = await client.query('UPDATE inventory_lpns SET qty = qty + $1 WHERE id = $2 RETURNING client_id', [qty, item.lpnId]);
      if (updated.rowCount && String(updated.rows[0].client_id || '').toUpperCase() !== clientId) {
        throw httpError(409, `El LPN ${item.lpnId} pertenece a otro cliente.`);
      }
      if (updated.rowCount === 0) {
        // El LPN se eliminó al quedar en 0: se recrea con sus datos del despacho.
        const loc = item.location
          ? ((await client.query('SELECT 1 FROM locations_master WHERE location_id=$1', [item.location])).rows.length ? item.location : 'PISO-RECEPCION')
          : 'PISO-RECEPCION';
        await client.query(
          `INSERT INTO inventory_lpns (id,sku,qty,client_id,status,batch_number,expiry_date,serial_number,location_id,glosa)
           VALUES ($1,$2,$3,$4,'DISPONIBLE',$5,$6,$7,$8,$9)`,
          [item.lpnId, String(item.sku).toUpperCase(), qty, clientId, item.batch || null, item.expiry || null, item.serial || null,
           loc, `Restaurado por anulación Doc: ${docNum}`]);
      }
      await client.query(
        `INSERT INTO audit_log (type,sku,qty,glosa,username,client_id) VALUES ('VOID_OUTBOUND',$1,$2,$3,$4,$5)`,
        [String(item.sku).toUpperCase(), qty, `Anulación DESPACHO Doc: ${docNum}. Stock restaurado en LPN ${item.lpnId}. Motivo: ${reason}`, executedBy, clientId]);
    }
  }

  // Marcar documento como ANULADO (una sola vez).
  const marca = await client.query(
    `UPDATE document_history SET status='ANULADO', void_reason=$1, voided_by=$2, voided_at=NOW() WHERE id=$3 AND COALESCE(status,'ACTIVO') <> 'ANULADO'`,
    [reason, executedBy, docHistoryId]
  );
  if (!marca.rowCount) throw httpError(409, 'El documento ya fue anulado anteriormente.');
}

// Anulación directa (ADMIN / SUPERADMIN)
router.post('/document-history/:id/void', requireJefe, async (req, res) => {
  // Anulación directa de despacho/recepción: JEFE_BODEGA+ (gate requireJefe).
  const { reason } = req.body;
  if (!reason || !reason.trim()) return res.status(400).json({ error: 'Debe indicar el motivo de la anulación.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await executeVoid(client, req.params.id, reason.trim(), req.user.username, req.clientScope);
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(err.status || 400).json({ error: userError(err) });
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
    if (!clientAllowed(req.clientScope, doc.client_id)) return res.status(404).json({ error: 'Documento no encontrado.' });
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
    const params = [];
    const conds = [];
    if (status) { params.push(status); conds.push(`ar.status=$${params.length}`); }
    conds.push(scopeCondition(req.clientScope, 'dh.client_id', params));
    const rows = await pool.query(
      `SELECT ar.*, dh.doc_type, dh.glosa, dh.total_qty, dh.client_id, dh.created_at AS doc_created_at
       FROM anulation_requests ar
       LEFT JOIN document_history dh ON dh.id = ar.doc_history_id
       WHERE ${conds.join(' AND ')} ORDER BY ar.created_at DESC LIMIT 200`, params
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
    await executeVoid(client, anulReq.doc_history_id, anulReq.reason, req.user.username, req.clientScope);
    await client.query(
      `UPDATE anulation_requests SET status='APROBADA', authorized_by=$1, resolved_at=NOW() WHERE id=$2`,
      [req.user.username, req.params.id]
    );
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(err.status || 400).json({ error: userError(err) });
  } finally { client.release(); }
});

// Rechazar solicitud de anulación (ADMIN/SUPERADMIN)
router.post('/anulation-requests/:id/reject', requireJefe, async (req, res) => {
  const { reject_reason } = req.body;
  try {
    const params = [req.user.username, reject_reason||'', req.params.id];
    const r = await pool.query(
      `UPDATE anulation_requests ar SET status='RECHAZADA', authorized_by=$1, reject_reason=$2, resolved_at=NOW()
       WHERE ar.id=$3 AND ar.status='PENDIENTE'
         AND EXISTS (SELECT 1 FROM document_history dh WHERE dh.id = ar.doc_history_id AND ${scopeCondition(req.clientScope, 'dh.client_id', params)})
       RETURNING ar.id`,
      params
    );
    if (!r.rowCount) return res.status(404).json({ error: 'Solicitud no encontrada o ya procesada.' });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: mapDbError(err) }); }
});

module.exports = router;
