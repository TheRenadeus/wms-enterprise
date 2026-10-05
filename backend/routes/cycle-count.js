// Cycle-count + adjust-requests router.
// Flujo nuevo: crear → contar → submit → (approve|reject).
// Stock se ajusta SOLO en /approve, nunca antes.

const express = require('express');
const { pool, mapDbError, userError } = require('../db');
const { requireAuth, requireAdmin, requireStaff, requireJefeOrAbove, checkClientAccess , requireStockWrite, requireJefe } = require('../middleware');
const { genLpnId } = require('../helpers');
const { scopeCondition, clientAllowed } = require('../scope');
const { httpError, clienteDelDocumento, r2 } = require('../stock-entrante');

// En un conteo ciego, mientras se cuenta no se revela lo esperado ni la diferencia.
// En aprobación y después, quien aprueba sí necesita verlo.
const ocultarEsperado = (cc) => Boolean(cc.blind) && ['PENDING', 'EN_PROCESO'].includes(cc.status);
const lineaVisible = (cc) => (l) => (ocultarEsperado(cc) ? { ...l, expected_qty: null, stock_at_count: null, difference: null } : l);

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

// Filtro de inventario de un conteo (create y preview), dentro del alcance del usuario.
function filtroDeConteo(req, { zone_code, client_id, sku, location_id }, params) {
  const conditions = ['il.qty > 0'];
  if (zone_code)   { params.push(zone_code); conditions.push(`TRIM(lm.zone_code) = TRIM($${params.length})`); }
  if (client_id)   { params.push(String(client_id).toUpperCase()); conditions.push(`il.client_id = $${params.length}`); }
  if (sku)         { params.push(String(sku).toUpperCase()); conditions.push(`il.sku = $${params.length}`); }
  if (location_id) { params.push(String(location_id).toUpperCase()); conditions.push(`il.location_id = $${params.length}`); }
  conditions.push(scopeCondition(req.clientScope, 'il.client_id', params));
  const joinClause = zone_code
    ? 'JOIN locations_master lm ON lm.location_id = il.location_id'
    : 'LEFT JOIN locations_master lm ON lm.location_id = il.location_id';
  return { conditions, params, joinClause };
}

// Stock del sistema para una línea (SKU + ubicación + cliente). Con lock, bloquea los LPN.
async function stockActual(db, { sku, location_id, client_id }, lock = false) {
  const r = await db.query(
    `SELECT id, qty FROM inventory_lpns WHERE sku=$1 AND location_id=$2 AND client_id=$3 AND qty>0 ORDER BY created_at ASC${lock ? ' FOR UPDATE' : ''}`,
    [sku, location_id, client_id]);
  return { lpns: r.rows, total: r2(r.rows.reduce((s, l) => s + Number(l.qty), 0)) };
}

// Un conteo se puede editar mientras está pendiente o en proceso.
async function conteoEditable(db, id) {
  const cc = (await db.query(`SELECT * FROM cycle_counts WHERE id=$1 FOR UPDATE`, [id])).rows[0];
  if (!cc) throw httpError(404, 'Conteo no encontrado.');
  if (!['PENDING', 'EN_PROCESO'].includes(cc.status)) throw httpError(409, `El conteo está en estado '${cc.status}' y ya no se puede modificar.`);
  return cc;
}

// ── CYCLE COUNT ──────────────────────────────────────────────────────────────

router.post('/cycle-count/create', requireStaff, checkClientAccess('write'), async (req, res) => {
  const { zone_code, client_id, sku, location_id, notes, blind } = req.body;
  const username = req.user.username;
  // Clave única = label para el índice: una combinación activa bloquea otra igual
  const scopeKey = buildScopeLabel({ zone_code, client_id, sku, location_id });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const activeCount = await client.query(
      `SELECT id FROM cycle_counts WHERE zone_code=$1 AND status IN ('PENDING','EN_PROCESO','PENDIENTE_APROBACION') LIMIT 1 FOR UPDATE`,
      [scopeKey]
    );
    if (activeCount.rows.length > 0) throw httpError(409, `Ya existe un conteo activo para '${scopeKey}' (ID: ${activeCount.rows[0].id}).`);

    const countId = genLpnId('CC');
    await client.query(
      `INSERT INTO cycle_counts (id, zone_code, status, created_by, notes, blind, location_filter, scope_label, client_filter, sku_filter)
       VALUES ($1,$2,'PENDING',$3,$4,$5,$6,$7,$8,$9)`,
      [countId, scopeKey, username, notes || '', Boolean(blind),
       location_id || null, scopeKey,
       client_id || null, sku || null]
    );

    // ── Seeding dinámico: una línea por SKU, ubicación y cliente ─────────────
    const { conditions, params, joinClause } = filtroDeConteo(req, { zone_code, client_id, sku, location_id }, [countId]);
    const inserted = await client.query(`
      INSERT INTO cycle_count_lines (count_id, sku, location_id, client_id, expected_qty, status, line_type)
      SELECT $1, il.sku, il.location_id, il.client_id, SUM(il.qty), 'PENDING', 'NORMAL'
      FROM inventory_lpns il
      ${joinClause}
      WHERE ${conditions.join(' AND ')}
      GROUP BY il.sku, il.location_id, il.client_id
    `, params);
    await client.query('COMMIT');
    res.json({ success: true, countId, lines: inserted.rowCount, scopeLabel: scopeKey });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(e.status || 500).json({ error: userError(e) });
  } finally { client.release(); }
});

// Vista previa de cuántas líneas se generarían (sin crear el conteo)
router.post('/cycle-count/preview', requireStaff, async (req, res) => {
  try {
    const { zone_code, client_id, sku, location_id } = req.body;
    const { conditions, params, joinClause } = filtroDeConteo(req, { zone_code, client_id, sku, location_id }, []);
    const r = await pool.query(`
      SELECT COUNT(DISTINCT il.sku || '|' || il.location_id || '|' || COALESCE(il.client_id,''))::int AS lines,
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
    res.json(counts.rows.map(cc => (ocultarEsperado(cc) ? { ...cc, diff_lines: null } : cc)));
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

router.get('/cycle-count/:id/lines', requireStaff, async (req, res) => {
  try {
    const ccRow = await pool.query(`SELECT * FROM cycle_counts WHERE id=$1`, [req.params.id]);
    if (!ccRow.rows.length) return res.status(404).json({ error: 'Conteo no encontrado.' });
    const cc = ccRow.rows[0];
    const params = [req.params.id];
    const lines = await pool.query(
      `SELECT * FROM cycle_count_lines WHERE count_id=$1 AND (client_id IS NULL OR ${scopeCondition(req.clientScope, 'client_id', params)}) ORDER BY location_id, sku`,
      params
    );
    const rows = lines.rows.map(lineaVisible(cc));
    res.json({ blind: cc.blind, status: cc.status, scopeLabel: cc.scope_label, lines: rows });
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

// Registra lo contado en una línea del conteo. La diferencia se calcula contra el
// stock del sistema en ese momento (no contra el esperado al crear el conteo).
router.post('/cycle-count/:id/count', requireStaff, async (req, res) => {
  const { lineId } = req.body;
  const counted = Number(req.body.counted_qty);
  if (!Number.isFinite(counted) || counted < 0) return res.status(400).json({ error: 'counted_qty debe ser un número mayor o igual a 0.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cc = await conteoEditable(client, req.params.id);
    const line = (await client.query(`SELECT * FROM cycle_count_lines WHERE id=$1 AND count_id=$2 FOR UPDATE`, [lineId, cc.id])).rows[0];
    if (!line || (line.client_id && !clientAllowed(req.clientScope, line.client_id))) throw httpError(404, 'Línea no encontrada en este conteo.');
    const actual = line.client_id ? (await stockActual(client, line)).total : null;
    const diff = r2(counted - (actual ?? Number(line.expected_qty || 0)));
    await client.query(
      `UPDATE cycle_count_lines SET counted_qty=$1, difference=$2, stock_at_count=$3, status='COUNTED', counted_by=$4, counted_at=NOW() WHERE id=$5`,
      [counted, diff, actual, req.user.username, line.id]
    );
    await client.query(`UPDATE cycle_counts SET status='EN_PROCESO' WHERE id=$1 AND status='PENDING'`, [cc.id]);
    await client.query('COMMIT');
    res.json(ocultarEsperado(cc) ? { success: true } : { success: true, difference: diff });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(e.status || 500).json({ error: userError(e) });
  } finally { client.release(); }
});

// Agregar hallazgo (stock en ubicación no listada)
router.post('/cycle-count/:id/add-line', requireStaff, async (req, res) => {
  const { location_id, sku, note } = req.body;
  if (!location_id || !sku) return res.status(400).json({ error: 'location_id y sku son requeridos.' });
  const qty = Number(req.body.counted_qty);
  if (!Number.isFinite(qty) || qty < 0) return res.status(400).json({ error: 'counted_qty debe ser >= 0.' });
  const loc = String(location_id).trim().toUpperCase();
  const skuU = String(sku).trim().toUpperCase();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cc = await conteoEditable(client, req.params.id);
    // Dueño del stock encontrado: el indicado, el del filtro del conteo o el único dueño del SKU.
    const clientId = await clienteDelDocumento(client, req.body.client_id || cc.client_filter, [skuU]);
    if (!clientAllowed(req.clientScope, clientId)) throw httpError(403, `Acceso denegado al cliente '${clientId}'.`);
    if (!(await client.query('SELECT 1 FROM master_skus WHERE sku=$1 AND client_id=$2 AND deleted_at IS NULL', [skuU, clientId])).rows.length) {
      throw httpError(400, `El SKU ${skuU} no existe para el cliente ${clientId}.`);
    }
    if (!(await client.query('SELECT 1 FROM locations_master WHERE location_id=$1', [loc])).rows.length) throw httpError(400, `La ubicación '${loc}' no existe.`);
    const actual = (await stockActual(client, { sku: skuU, location_id: loc, client_id: clientId })).total;
    const existing = await client.query(
      `SELECT id FROM cycle_count_lines WHERE count_id=$1 AND location_id=$2 AND sku=$3 AND client_id=$4 FOR UPDATE`,
      [cc.id, loc, skuU, clientId]
    );
    if (existing.rows.length > 0) {
      await client.query(
        `UPDATE cycle_count_lines SET counted_qty=$1, difference=$2, stock_at_count=$3, status='COUNTED', counted_by=$4, counted_at=NOW(), note=$5 WHERE id=$6`,
        [qty, r2(qty - actual), actual, req.user.username, note || null, existing.rows[0].id]
      );
    } else {
      await client.query(
        `INSERT INTO cycle_count_lines (count_id,sku,location_id,client_id,expected_qty,counted_qty,difference,stock_at_count,status,counted_by,counted_at,note,line_type)
         VALUES ($1,$2,$3,$4,0,$5,$6,$7,'COUNTED',$8,NOW(),$9,'ENCONTRADO')`,
        [cc.id, skuU, loc, clientId, qty, r2(qty - actual), actual, req.user.username, note || null]
      );
    }
    await client.query(`UPDATE cycle_counts SET status='EN_PROCESO' WHERE id=$1 AND status='PENDING'`, [cc.id]);
    await client.query('COMMIT');
    const params = [cc.id];
    const lines = await pool.query(
      `SELECT * FROM cycle_count_lines WHERE count_id=$1 AND (client_id IS NULL OR ${scopeCondition(req.clientScope, 'client_id', params)}) ORDER BY location_id, sku`,
      params);
    res.json({ success: true, lines: lines.rows.map(lineaVisible(cc)) });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(e.status || 500).json({ error: userError(e) });
  } finally { client.release(); }
});

// Enviar a aprobación
router.post('/cycle-count/:id/submit', requireStaff, async (req, res) => {
  const username = req.user.username;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cc = await conteoEditable(client, req.params.id);
    const diffs = await client.query(
      `SELECT COUNT(*) AS diff_count FROM cycle_count_lines WHERE count_id=$1 AND status='COUNTED' AND difference != 0`,
      [cc.id]
    );
    const hasDiffs = parseInt(diffs.rows[0].diff_count) > 0;
    if (!hasDiffs) {
      // Sin diferencias: completar directo sin ajustar stock
      await client.query(
        `UPDATE cycle_counts SET status='COMPLETED', completed_at=NOW(), approved_by=$1, approved_at=NOW() WHERE id=$2`,
        [username, cc.id]
      );
      await client.query('COMMIT');
      return res.json({ success: true, status: 'COMPLETED', requires_approval: false });
    }
    await client.query(`UPDATE cycle_counts SET status='PENDIENTE_APROBACION' WHERE id=$1`, [cc.id]);
    await client.query('COMMIT');
    res.json({ success: true, status: 'PENDIENTE_APROBACION', requires_approval: true, diff_lines: parseInt(diffs.rows[0].diff_count) });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(e.status || 500).json({ error: userError(e) });
  } finally { client.release(); }
});

// Aprobar y aplicar ajustes. El ajuste se calcula contra el stock ACTUAL bloqueado
// (por SKU, ubicación y cliente); si el stock cambió desde que se contó la línea,
// no se aplica nada y se pide recontar.
router.post('/cycle-count/:id/approve', requireJefeOrAbove, async (req, res) => {
  const username = req.user.username;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cc = await client.query(`SELECT * FROM cycle_counts WHERE id=$1 FOR UPDATE`, [req.params.id]);
    if (!cc.rows.length) throw httpError(404, 'Conteo no encontrado.');
    if (cc.rows[0].status !== 'PENDIENTE_APROBACION')
      throw httpError(409, `El conteo está en estado '${cc.rows[0].status}', no se puede aprobar.`);

    const lines = await client.query(
      `SELECT * FROM cycle_count_lines WHERE count_id=$1 AND status='COUNTED' ORDER BY id FOR UPDATE`,
      [req.params.id]
    );
    const recontar = [];
    const sinCliente = [];
    const plan = [];
    for (const line of lines.rows) {
      // Líneas antiguas sin dueño (código compartido entre clientes): no se ajustan solas.
      if (!line.client_id) { sinCliente.push(`${line.sku} en ${line.location_id}`); continue; }
      if (!clientAllowed(req.clientScope, line.client_id)) throw httpError(403, `Acceso denegado al cliente '${line.client_id}'.`);
      const { lpns, total } = await stockActual(client, line, true);
      if (line.stock_at_count !== null && r2(line.stock_at_count) !== total) {
        recontar.push(line);
        continue;
      }
      const delta = r2(Number(line.counted_qty) - total);
      if (delta !== 0) plan.push({ line, lpns, delta });
    }
    if (recontar.length) {
      await client.query(
        `UPDATE cycle_count_lines SET status='PENDING', counted_qty=NULL, difference=NULL, stock_at_count=NULL, counted_by=NULL, counted_at=NULL
          WHERE id = ANY($1::int[])`, [recontar.map(l => l.id)]);
      await client.query(`UPDATE cycle_counts SET status='EN_PROCESO' WHERE id=$1`, [req.params.id]);
      await client.query('COMMIT');
      return res.status(409).json({
        error: `El stock cambió desde el conteo. Se reabrió el conteo para recontar: ${recontar.map(l => `${l.sku} en ${l.location_id}`).join(', ')}.`,
        recontar: true,
      });
    }

    for (const { line, lpns, delta } of plan) {
      if (delta > 0) {
        const lpnId = genLpnId(Number(line.expected_qty) === 0 ? 'CC-NEW' : 'CC-ADJ');
        const glosa = Number(line.expected_qty) === 0
          ? `Hallazgo CC ${req.params.id}: stock encontrado en ${line.location_id}`
          : `Sobrante CC ${req.params.id}: ajuste en ${line.location_id}`;
        await client.query(
          `INSERT INTO inventory_lpns (id,sku,sku_version,qty,client_id,status,location_id,glosa)
           VALUES ($1,$2,COALESCE((SELECT current_version FROM master_skus WHERE sku=$7 AND client_id=$8),1),$3,$4,'DISPONIBLE',$5,$6)`,
          [lpnId, line.sku, delta, line.client_id, line.location_id, glosa, line.sku, line.client_id]
        );
        await client.query(
          `INSERT INTO audit_log (type,sku,qty,glosa,username,client_id) VALUES ('ADJUST_IN',$1,$2,$3,$4,$5)`,
          [line.sku, delta, glosa, username, line.client_id]
        );
      } else {
        // Merma FIFO sobre el stock de ese cliente en esa ubicación (ya bloqueado).
        let remaining = -delta;
        for (const lpn of lpns) {
          if (remaining <= 0) break;
          const take = Math.min(Number(lpn.qty), remaining);
          await client.query(`UPDATE inventory_lpns SET qty=qty-$1 WHERE id=$2`, [take, lpn.id]);
          remaining -= take;
        }
        await client.query(`DELETE FROM inventory_lpns WHERE id = ANY($1::varchar[]) AND qty <= 0`, [lpns.map(l => l.id)]);
        await client.query(
          `INSERT INTO audit_log (type,sku,qty,glosa,username,client_id) VALUES ('ADJUST_OUT',$1,$2,$3,$4,$5)`,
          [line.sku, -delta, `Merma CC ${req.params.id}: ajuste en ${line.location_id}`, username, line.client_id]
        );
      }
      await client.query(`UPDATE cycle_count_lines SET difference=$1 WHERE id=$2`, [delta, line.id]);
    }

    await client.query(
      `UPDATE cycle_counts SET status='COMPLETED', completed_at=NOW(), approved_by=$1, approved_at=NOW() WHERE id=$2`,
      [username, req.params.id]
    );
    await client.query('COMMIT');
    res.json({ success: true, adjustments_applied: plan.length, ...(sinCliente.length ? { lineas_sin_cliente: sinCliente } : {}) });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(e.status || 500).json({ error: userError(e) });
  } finally { client.release(); }
});

// Rechazar
router.post('/cycle-count/:id/reject', requireJefeOrAbove, async (req, res) => {
  const { reason } = req.body;
  try {
    const r = await pool.query(
      `UPDATE cycle_counts SET status='RECHAZADO', rejected_by=$1, rejected_at=NOW(), notes=CONCAT(COALESCE(notes,''), ' | Rechazado: ', $2::text)
       WHERE id=$3 AND status='PENDIENTE_APROBACION' RETURNING id`,
      [req.user.username, reason || '', req.params.id]
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
  if (['JEFE_BODEGA','ADMIN','SUPERADMIN'].includes(req.user.role))
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
  if (['JEFE_BODEGA','ADMIN','SUPERADMIN'].includes(req.user.role))
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
  const isAdmin = ['JEFE_BODEGA','ADMIN','SUPERADMIN'].includes(req.user.role);
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
  } catch (err) { await client.query('ROLLBACK'); res.status(400).json({ error: userError(err) }); }
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
