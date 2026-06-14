// Cycle-count + adjust-requests router.
// Flujo nuevo: crear → contar → submit → (approve|reject).
// Stock se ajusta SOLO en /approve, nunca antes.

const express = require('express');
const { pool, mapDbError } = require('../db');
const { requireAuth, requireAdmin, requireStaff, requireJefeOrAbove, checkClientAccess , requireStockWrite, requireJefe } = require('../middleware');
const { genLpnId } = require('../helpers');

const router = express.Router();

// ── helpers ──────────────────────────────────────────────────────────────────
function buildScopeLabel({ zone_code, client_id, sku, location_id }) {
  const parts = [];
  if (client_id)   parts.push(`Cliente: ${client_id}`);
  if (sku)         parts.push(`SKU: ${sku}`);
  if (zone_code)   parts.push(`Zona: ${zone_code}`);
  if (location_id) parts.push(`Ubic: ${location_id}`);
  return parts.length ? parts.join(' · ') : 'Inventario completo';
}

// ── CYCLE COUNT ──────────────────────────────────────────────────────────────

router.post('/cycle-count/create', requireStaff, async (req, res) => {
  try {
    const { zone_code, client_id, sku, location_id, username, notes, blind } = req.body;

    // Clave única = label para el índice: una combinación activa bloquea otra igual
    const scopeKey = buildScopeLabel({ zone_code, client_id, sku, location_id });

    const activeCount = await pool.query(
      `SELECT id FROM cycle_counts WHERE zone_code=$1 AND status IN ('PENDING','EN_PROCESO','PENDIENTE_APROBACION') LIMIT 1`,
      [scopeKey]
    );
    if (activeCount.rows.length > 0)
      return res.status(409).json({ error: `Ya existe un conteo activo para '${scopeKey}' (ID: ${activeCount.rows[0].id}).` });

    const countId = genLpnId('CC');
    await pool.query(
      `INSERT INTO cycle_counts (id, zone_code, status, created_by, notes, blind, location_filter, scope_label, client_filter, sku_filter)
       VALUES ($1,$2,'PENDING',$3,$4,$5,$6,$7,$8,$9)`,
      [countId, scopeKey, username, notes || '', Boolean(blind),
       location_id || null, scopeKey,
       client_id || null, sku || null]
    );

    // ── Seeding dinámico ─────────────────────────────────────────────────────
    const conditions = ['il.qty > 0'];
    const params = [countId];
    let idx = 2;

    if (zone_code) {
      conditions.push(`TRIM(lm.zone_code) = TRIM($${idx++})`);
      params.push(zone_code);
    }
    if (client_id) {
      conditions.push(`il.client_id = $${idx++}`);
      params.push(client_id);
    }
    if (sku) {
      conditions.push(`il.sku = $${idx++}`);
      params.push(sku.toUpperCase());
    }
    if (location_id) {
      conditions.push(`il.location_id = $${idx++}`);
      params.push(location_id.toUpperCase());
    }

    const joinClause = zone_code
      ? 'JOIN locations_master lm ON lm.location_id = il.location_id'
      : 'LEFT JOIN locations_master lm ON lm.location_id = il.location_id';

    const inserted = await pool.query(`
      INSERT INTO cycle_count_lines (count_id, sku, location_id, expected_qty, status, line_type)
      SELECT $1, il.sku, il.location_id, SUM(il.qty), 'PENDING', 'NORMAL'
      FROM inventory_lpns il
      ${joinClause}
      WHERE ${conditions.join(' AND ')}
      GROUP BY il.sku, il.location_id
    `, params);

    res.json({ success: true, countId, lines: inserted.rowCount, scopeLabel: scopeKey });
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

// Vista previa de cuántas líneas se generarían (sin crear el conteo)
router.post('/cycle-count/preview', requireStaff, async (req, res) => {
  try {
    const { zone_code, client_id, sku, location_id } = req.body;
    const conditions = ['il.qty > 0'];
    const params = [];
    let idx = 1;
    if (zone_code)   { conditions.push(`TRIM(lm.zone_code) = TRIM($${idx++})`); params.push(zone_code); }
    if (client_id)   { conditions.push(`il.client_id = $${idx++}`); params.push(client_id); }
    if (sku)         { conditions.push(`il.sku = $${idx++}`); params.push(sku.toUpperCase()); }
    if (location_id) { conditions.push(`il.location_id = $${idx++}`); params.push(location_id.toUpperCase()); }
    const joinClause = zone_code
      ? 'JOIN locations_master lm ON lm.location_id = il.location_id'
      : 'LEFT JOIN locations_master lm ON lm.location_id = il.location_id';
    const r = await pool.query(`
      SELECT COUNT(DISTINCT il.sku || '|' || il.location_id)::int AS lines,
             COALESCE(SUM(il.qty),0)::float AS total_units
      FROM inventory_lpns il ${joinClause}
      WHERE ${conditions.join(' AND ')}
    `, params);
    res.json({ lines: r.rows[0].lines, total_units: r.rows[0].total_units, scopeLabel: buildScopeLabel({zone_code,client_id,sku,location_id}) });
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

router.get('/cycle-count', requireStaff, async (req, res) => {
  try {
    const counts = await pool.query(`
      SELECT cc.*,
        (SELECT COUNT(*) FROM cycle_count_lines WHERE count_id=cc.id)::int              AS total_lines,
        (SELECT COUNT(*) FROM cycle_count_lines WHERE count_id=cc.id AND status='COUNTED')::int AS counted_lines,
        (SELECT COUNT(*) FROM cycle_count_lines WHERE count_id=cc.id AND difference != 0 AND status='COUNTED')::int AS diff_lines
      FROM cycle_counts cc
      ORDER BY cc.created_at DESC LIMIT 50
    `);
    res.json(counts.rows);
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

router.get('/cycle-count/:id/lines', requireStaff, async (req, res) => {
  try {
    const ccRow = await pool.query(`SELECT * FROM cycle_counts WHERE id=$1`, [req.params.id]);
    if (!ccRow.rows.length) return res.status(404).json({ error: 'Conteo no encontrado.' });
    const cc = ccRow.rows[0];
    const lines = await pool.query(
      `SELECT * FROM cycle_count_lines WHERE count_id=$1 ORDER BY location_id, sku`,
      [req.params.id]
    );
    const rows = lines.rows.map(l => ({
      ...l,
      expected_qty: (cc.blind && cc.status !== 'COMPLETED') ? null : l.expected_qty,
    }));
    res.json({ blind: cc.blind, status: cc.status, scopeLabel: cc.scope_label, lines: rows });
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

router.post('/cycle-count/:id/count', requireStaff, async (req, res) => {
  const { lineId, counted_qty, username } = req.body;
  try {
    const line = await pool.query(`SELECT * FROM cycle_count_lines WHERE id=$1`, [lineId]);
    if (!line.rows.length) return res.status(404).json({ error: 'Línea no encontrada.' });
    const diff = parseFloat(counted_qty) - parseFloat(line.rows[0].expected_qty || 0);
    await pool.query(
      `UPDATE cycle_count_lines SET counted_qty=$1, difference=$2, status='COUNTED', counted_by=$3, counted_at=NOW() WHERE id=$4`,
      [parseFloat(counted_qty), diff, username, lineId]
    );
    // Marcar conteo en proceso
    await pool.query(`UPDATE cycle_counts SET status='EN_PROCESO' WHERE id=$1 AND status='PENDING'`, [req.params.id]);
    res.json({ success: true, difference: diff });
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

// Agregar hallazgo (stock en ubicación no listada)
router.post('/cycle-count/:id/add-line', requireStaff, async (req, res) => {
  const { location_id, sku, counted_qty, username, note } = req.body;
  if (!location_id || !sku) return res.status(400).json({ error: 'location_id y sku son requeridos.' });
  const qty = parseFloat(counted_qty);
  if (isNaN(qty) || qty < 0) return res.status(400).json({ error: 'counted_qty debe ser >= 0.' });
  try {
    const existing = await pool.query(
      `SELECT id FROM cycle_count_lines WHERE count_id=$1 AND location_id=$2 AND sku=$3`,
      [req.params.id, location_id.toUpperCase(), sku.toUpperCase()]
    );
    if (existing.rows.length > 0) {
      await pool.query(
        `UPDATE cycle_count_lines SET counted_qty=$1, difference=$1, status='COUNTED', counted_by=$2, counted_at=NOW(), note=$3 WHERE id=$4`,
        [qty, username, note || null, existing.rows[0].id]
      );
    } else {
      await pool.query(
        `INSERT INTO cycle_count_lines (count_id,sku,location_id,expected_qty,counted_qty,difference,status,counted_by,counted_at,note,line_type)
         VALUES ($1,$2,$3,0,$4,$4,'COUNTED',$5,NOW(),$6,'ENCONTRADO')`,
        [req.params.id, sku.toUpperCase(), location_id.toUpperCase(), qty, username, note || null]
      );
    }
    await pool.query(`UPDATE cycle_counts SET status='EN_PROCESO' WHERE id=$1 AND status='PENDING'`, [req.params.id]);
    const lines = await pool.query(`SELECT * FROM cycle_count_lines WHERE count_id=$1 ORDER BY location_id, sku`, [req.params.id]);
    res.json({ success: true, lines: lines.rows });
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

// Enviar a aprobación
router.post('/cycle-count/:id/submit', requireStaff, async (req, res) => {
  const { username } = req.body;
  try {
    const cc = await pool.query(`SELECT * FROM cycle_counts WHERE id=$1`, [req.params.id]);
    if (!cc.rows.length) return res.status(404).json({ error: 'Conteo no encontrado.' });
    if (!['PENDING','EN_PROCESO'].includes(cc.rows[0].status))
      return res.status(409).json({ error: `El conteo está en estado '${cc.rows[0].status}', no se puede enviar.` });

    const diffs = await pool.query(
      `SELECT COUNT(*) AS diff_count FROM cycle_count_lines WHERE count_id=$1 AND status='COUNTED' AND difference != 0`,
      [req.params.id]
    );
    const hasDiffs = parseInt(diffs.rows[0].diff_count) > 0;

    if (!hasDiffs) {
      // Sin diferencias: completar directo sin ajustar stock
      await pool.query(
        `UPDATE cycle_counts SET status='COMPLETED', completed_at=NOW(), approved_by=$1, approved_at=NOW() WHERE id=$2`,
        [username, req.params.id]
      );
      return res.json({ success: true, status: 'COMPLETED', requires_approval: false });
    }

    await pool.query(`UPDATE cycle_counts SET status='PENDIENTE_APROBACION' WHERE id=$1`, [req.params.id]);
    res.json({ success: true, status: 'PENDIENTE_APROBACION', requires_approval: true, diff_lines: parseInt(diffs.rows[0].diff_count) });
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

// Aprobar y aplicar ajustes
router.post('/cycle-count/:id/approve', requireJefeOrAbove, async (req, res) => {
  const { username } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cc = await client.query(`SELECT * FROM cycle_counts WHERE id=$1 FOR UPDATE`, [req.params.id]);
    if (!cc.rows.length) throw new Error('Conteo no encontrado.');
    if (cc.rows[0].status !== 'PENDIENTE_APROBACION')
      throw new Error(`El conteo está en estado '${cc.rows[0].status}', no se puede aprobar.`);

    const lines = await client.query(
      `SELECT * FROM cycle_count_lines WHERE count_id=$1 AND status='COUNTED' AND difference != 0`,
      [req.params.id]
    );

    for (const line of lines.rows) {
      const diff     = parseFloat(line.difference);
      const expected = parseFloat(line.expected_qty) || 0;
      const skuRow   = await client.query('SELECT client_id FROM master_skus WHERE sku=$1 LIMIT 1', [line.sku]);
      const clientId = skuRow.rows[0]?.client_id || 'GENERAL';

      if (diff > 0) {
        const lpnId = genLpnId(expected === 0 ? 'CC-NEW' : 'CC-ADJ');
        const glosa = expected === 0
          ? `Hallazgo CC ${req.params.id}: stock encontrado en ${line.location_id}`
          : `Sobrante CC ${req.params.id}: ajuste en ${line.location_id}`;
        await client.query(
          `INSERT INTO inventory_lpns (id,sku,qty,client_id,status,location_id,glosa) VALUES ($1,$2,$3,$4,'DISPONIBLE',$5,$6)`,
          [lpnId, line.sku, diff, clientId, line.location_id, glosa]
        );
        await client.query(
          `INSERT INTO audit_log (type,sku,qty,glosa,username,client_id) VALUES ('ADJUST_IN',$1,$2,$3,$4,$5)`,
          [line.sku, diff, glosa, username, clientId]
        );
      } else if (diff < 0) {
        const absDiff = Math.abs(diff);
        // Mermar del stock existente en esa ubicación (FIFO)
        const available = await client.query(
          `SELECT id, qty FROM inventory_lpns WHERE sku=$1 AND location_id=$2 AND qty>0 ORDER BY created_at ASC`,
          [line.sku, line.location_id]
        );
        let remaining = absDiff;
        for (const lpn of available.rows) {
          if (remaining <= 0) break;
          const take = Math.min(parseFloat(lpn.qty), remaining);
          await client.query(`UPDATE inventory_lpns SET qty=qty-$1 WHERE id=$2`, [take, lpn.id]);
          remaining -= take;
        }
        await client.query(
          `INSERT INTO audit_log (type,sku,qty,glosa,username,client_id) VALUES ('ADJUST_OUT',$1,$2,$3,$4,$5)`,
          [line.sku, absDiff, `Merma CC ${req.params.id}: ajuste en ${line.location_id}`, username, clientId]
        );
      }
    }

    await client.query(
      `UPDATE cycle_counts SET status='COMPLETED', completed_at=NOW(), approved_by=$1, approved_at=NOW() WHERE id=$2`,
      [username, req.params.id]
    );
    await client.query('COMMIT');
    res.json({ success: true, adjustments_applied: lines.rows.length });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message || mapDbError(e) });
  } finally { client.release(); }
});

// Rechazar
router.post('/cycle-count/:id/reject', requireJefeOrAbove, async (req, res) => {
  const { username, reason } = req.body;
  try {
    const r = await pool.query(
      `UPDATE cycle_counts SET status='RECHAZADO', rejected_by=$1, rejected_at=NOW(), notes=CONCAT(COALESCE(notes,''), ' | Rechazado: ', $2)
       WHERE id=$3 AND status='PENDIENTE_APROBACION' RETURNING id`,
      [username, reason || '', req.params.id]
    );
    if (!r.rowCount) return res.status(404).json({ error: 'Conteo no encontrado o no está pendiente de aprobación.' });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

// Alias legacy /complete → redirige a submit
router.post('/cycle-count/:id/complete', requireStaff, async (req, res) => {
  req.url = `/${req.params.id}/submit`;
  return router.handle({ ...req, url: `/cycle-count/${req.params.id}/submit`, method: 'POST' }, res, () => {});
});

// ── ADJUSTMENT REQUESTS ──────────────────────────────────────────────────────
router.post('/adjust-request', requireStockWrite, async (req, res) => {
  if (['ADMIN','SUPERADMIN'].includes(req.user.role))
    return res.status(400).json({ error: 'Los administradores aplican ajustes directamente.' });
  const { items, docNum, glosa } = req.body;
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'Items requeridos.' });
  if (!docNum) return res.status(400).json({ error: 'Número de documento requerido.' });
  try {
    const id = genLpnId('ADJREQ');
    await pool.query(
      `INSERT INTO adjustment_requests (id, doc_num, glosa, items, requested_by) VALUES ($1,$2,$3,$4,$5)`,
      [id, docNum.toUpperCase(), glosa || '', JSON.stringify(items), req.user.username]
    );
    res.json({ success: true, id });
  } catch (err) { res.status(500).json({ error: mapDbError(err) }); }
});

router.post('/adjust-requests', requireStockWrite, checkClientAccess('write'), async (req, res) => {
  if (['ADMIN','SUPERADMIN'].includes(req.user.role))
    return res.status(400).json({ error: 'Los administradores aplican ajustes directamente.' });
  const { lpn_id, sku, type, qty, reason, username } = req.body || {};
  if (!sku || qty === undefined || qty === null) return res.status(400).json({ error: 'sku y qty son requeridos.' });
  const q = parseFloat(qty);
  if (isNaN(q) || q <= 0) return res.status(400).json({ error: 'qty debe ser > 0.' });
  try {
    const id = genLpnId('ADJREQ');
    const items = [{ lpn_id: lpn_id || null, sku: String(sku).toUpperCase(), type: type || 'ADJUST', qty: q, reason: reason || '' }];
    const docNum = `ADJ-${Date.now()}`;
    await pool.query(
      `INSERT INTO adjustment_requests (id, doc_num, glosa, items, requested_by) VALUES ($1,$2,$3,$4,$5)`,
      [id, docNum, reason || `Ajuste ${type||'ADJUST'} sobre ${lpn_id||sku}`, JSON.stringify(items), username || req.user.username]
    );
    res.json({ success: true, id, doc_num: docNum });
  } catch (err) { res.status(500).json({ error: mapDbError(err) }); }
});

router.get('/adjust-requests', requireAuth, async (req, res) => {
  const { status } = req.query;
  const isAdmin = ['ADMIN','SUPERADMIN'].includes(req.user.role);
  try {
    let q = `SELECT * FROM adjustment_requests`;
    const params = []; const conds = [];
    if (!isAdmin) { conds.push(`requested_by=$${params.length+1}`); params.push(req.user.username); }
    if (status)   { conds.push(`status=$${params.length+1}`); params.push(status); }
    if (conds.length) q += ' WHERE ' + conds.join(' AND ');
    q += ' ORDER BY created_at DESC LIMIT 200';
    res.json((await pool.query(q, params)).rows);
  } catch (err) { res.status(500).json({ error: mapDbError(err) }); }
});

router.post('/adjust-requests/:id/approve', requireJefe, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(`SELECT * FROM adjustment_requests WHERE id=$1 FOR UPDATE`, [req.params.id]);
    if (!r.rows.length) throw new Error('Solicitud no encontrada.');
    const adjReq = r.rows[0];
    if (adjReq.status !== 'PENDIENTE') throw new Error('La solicitud ya fue procesada.');
    const items = Array.isArray(adjReq.items) ? adjReq.items : JSON.parse(adjReq.items);
    for (const it of items) {
      const sku = String(it.sku); const qty = parseFloat(it.qty);
      const locId = it.location_id || 'PISO-RECEPCION';
      if (it.action === 'ADD') {
        if (isNaN(qty) || qty <= 0) throw new Error(`Cantidad inválida para SKU ${sku}.`);
        const lpnId = genLpnId('ADJ');
        const skuRow = await client.query('SELECT client_id FROM master_skus WHERE sku=$1 LIMIT 1', [sku]);
        const clientId = skuRow.rows[0]?.client_id || 'GENERAL';
        await client.query(
          `INSERT INTO inventory_lpns (id,sku,qty,client_id,status,batch_number,expiry_date,serial_number,location_id,glosa) VALUES ($1,$2,$3,$4,'DISPONIBLE',$5,$6,$7,$8,$9)`,
          [lpnId, sku, qty, clientId, it.batch?.trim()||null, it.expDate?.trim()||null, it.serial?.trim()||null, locId, adjReq.glosa||'']
        );
        await client.query(`INSERT INTO audit_log (type,sku,qty,glosa,username) VALUES ('ADJUST_IN',$1,$2,$3,$4)`, [sku, qty, adjReq.glosa||'', req.user.username]);
      } else if (it.action === 'SUBTRACT') {
        if (isNaN(qty) || qty <= 0) throw new Error(`Cantidad inválida para SKU ${sku}.`);
        const available = await client.query(`SELECT id, qty FROM inventory_lpns WHERE sku=$1 AND qty>0 AND location_id=$2 ORDER BY created_at ASC`, [sku, locId]);
        let remaining = qty;
        for (const lpn of available.rows) {
          if (remaining <= 0) break;
          const take = Math.min(parseFloat(lpn.qty), remaining);
          await client.query(`UPDATE inventory_lpns SET qty=qty-$1 WHERE id=$2`, [take, lpn.id]);
          remaining -= take;
        }
        if (remaining > 0) throw new Error(`Stock insuficiente para mermar ${sku}.`);
        await client.query(`INSERT INTO audit_log (type,sku,qty,glosa,username) VALUES ('ADJUST_OUT',$1,$2,$3,$4)`, [sku, qty, adjReq.glosa||'', req.user.username]);
      }
    }
    await client.query(`UPDATE adjustment_requests SET status='APROBADA', authorized_by=$1, resolved_at=NOW() WHERE id=$2`, [req.user.username, req.params.id]);
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) { await client.query('ROLLBACK'); res.status(400).json({ error: err.message }); }
  finally { client.release(); }
});

router.post('/adjust-requests/:id/reject', requireJefe, async (req, res) => {
  const { reject_reason } = req.body;
  try {
    const r = await pool.query(
      `UPDATE adjustment_requests SET status='RECHAZADA', authorized_by=$1, reject_reason=$2, resolved_at=NOW() WHERE id=$3 AND status='PENDIENTE' RETURNING id`,
      [req.user.username, reject_reason||'', req.params.id]
    );
    if (!r.rowCount) return res.status(404).json({ error: 'Solicitud no encontrada o ya procesada.' });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: mapDbError(err) }); }
});

module.exports = router;
