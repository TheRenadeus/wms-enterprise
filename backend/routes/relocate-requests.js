// Solicitudes de reubicación con aprobación: el picker solicita, el supervisor
// aprueba (ejecuta el movimiento real) o rechaza. Extraído de server.js (COD-02).
const express = require('express');
const { pool, mapDbError } = require('../db');
const { requirePickerOrAbove, requireStockWrite, checkLpnClientAccess } = require('../middleware');
const { genLpnId } = require('../helpers');

const router = express.Router();

// ── Picker solicita una reubicación (no mueve stock) ─────────────────────
router.post('/relocate-requests', requirePickerOrAbove, checkLpnClientAccess('lpn_id'), async (req, res) => {
  const { lpn_id, location_to, qty, glosa } = req.body;
  if (!lpn_id || !location_to) return res.status(400).json({ error: 'lpn_id y location_to son requeridos.' });
  try {
    const lpn = await pool.query('SELECT id, sku, qty, location_id FROM inventory_lpns WHERE id=$1 AND qty>0', [lpn_id]);
    if (!lpn.rows.length) return res.status(404).json({ error: 'LPN no encontrado o sin stock.' });
    const { sku, qty: maxQty, location_id } = lpn.rows[0];
    const moveQty = qty ? parseFloat(qty) : parseFloat(maxQty);
    if (isNaN(moveQty) || moveQty <= 0 || moveQty > parseFloat(maxQty))
      return res.status(400).json({ error: `Cantidad inválida. Disponible: ${maxQty}` });
    if (location_to === (location_id || 'PISO-RECEPCION'))
      return res.status(400).json({ error: 'El destino es igual a la ubicación actual.' });
    // Validar que la ubicación destino existe en locations_master (excepto PISO-RECEPCION)
    if (location_to !== 'PISO-RECEPCION') {
      const locCheck = await pool.query('SELECT location_id FROM locations_master WHERE location_id=$1', [location_to]);
      if (!locCheck.rows.length) return res.status(400).json({ error: `Ubicación destino "${location_to}" no existe en el diseño de bodega. Genérala primero en "Diseño Bodega".` });
    }
    const id = genLpnId('RELREQ');
    await pool.query(
      `INSERT INTO relocation_requests (id, lpn_id, sku, qty, location_from, location_to, glosa, requested_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, lpn_id, sku, moveQty, location_id||'PISO-RECEPCION', location_to, glosa||null, req.user.username]
    );
    await pool.query(`INSERT INTO audit_log (type,sku,qty,glosa,username) VALUES ('RELOC_REQUEST',$1,$2,$3,$4)`,
      [sku, moveQty, `Solicitud de reubicación ${id}: LPN ${lpn_id} de ${location_id||'PISO-RECEPCION'} → ${location_to}`, req.user.username]);
    res.json({ success: true, request_id: id });
  } catch (err) { res.status(500).json({ error: mapDbError(err) }); }
});

// ── Listar solicitudes (supervisor: todas; picker: solo las suyas) ────────
router.get('/relocate-requests', requirePickerOrAbove, async (req, res) => {
  try {
    const { status } = req.query;
    const isPicker = req.user.role === 'PICKER';
    const conditions = [];
    const params = [];
    if (isPicker) { conditions.push(`requested_by=$${params.length+1}`); params.push(req.user.username); }
    if (status) { conditions.push(`status=$${params.length+1}`); params.push(status); }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const rows = await pool.query(
      `SELECT r.*, i.qty as lpn_qty_current, i.batch_number, i.serial_number
       FROM relocation_requests r
       LEFT JOIN inventory_lpns i ON i.id = r.lpn_id
       ${where} ORDER BY r.requested_at DESC LIMIT 200`, params
    );
    res.json(rows.rows);
  } catch (err) { res.status(500).json({ error: mapDbError(err) }); }
});

// ── Supervisor aprueba → ejecuta la reubicación real ─────────────────────
// PASO 5.5: la reubicación es la excepción — aprueba EJECUTIVO_CUENTA+ (no requiere JEFE).
router.post('/relocate-requests/:id/approve', requireStockWrite, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const reqRow = await client.query(
      `SELECT * FROM relocation_requests WHERE id=$1 AND status='PENDIENTE' FOR UPDATE`, [req.params.id]
    );
    if (!reqRow.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Solicitud no encontrada o ya resuelta.' });
    }
    const r = reqRow.rows[0];
    // Validar que el LPN aún existe y tiene stock
    const lpn = await client.query('SELECT * FROM inventory_lpns WHERE id=$1 FOR UPDATE', [r.lpn_id]);
    if (!lpn.rows.length || parseFloat(lpn.rows[0].qty) <= 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'El LPN ya no tiene stock disponible.' });
    }
    if (parseFloat(lpn.rows[0].qty) < parseFloat(r.qty)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `Stock insuficiente: disponible ${lpn.rows[0].qty}, solicitado ${r.qty}.` });
    }
    // Verificar estado no bloquea
    const stCheck = await client.query('SELECT blocks_outbound FROM statuses WHERE id=$1', [lpn.rows[0].status||'DISPONIBLE']);
    if (stCheck.rows[0]?.blocks_outbound) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `El LPN está en estado '${lpn.rows[0].status}' y no puede reubicarse.` });
    }
    // Verificar destino existe o crear
    if (r.location_to !== 'PISO-RECEPCION') {
      const locCheck = await client.query('SELECT location_id FROM locations_master WHERE location_id=$1', [r.location_to]);
      if (!locCheck.rows.length) {
        await client.query('INSERT INTO locations_master (location_id, zone_code) VALUES ($1,$2)', [r.location_to, r.location_to.split('-')[0]||'GENERAL']);
      }
    }
    // Ejecutar reubicación (total o parcial)
    const originalQty = parseFloat(lpn.rows[0].qty);
    const moveQty = parseFloat(r.qty);
    if (moveQty === originalQty) {
      await client.query('UPDATE inventory_lpns SET location_id=$1 WHERE id=$2', [r.location_to, r.lpn_id]);
    } else {
      if (lpn.rows[0].serial_number) throw new Error('Los productos serializados no se pueden dividir.');
      const newLpnId = genLpnId('SPLIT');
      await client.query('UPDATE inventory_lpns SET qty=qty-$1 WHERE id=$2', [moveQty, r.lpn_id]);
      await client.query(
        `INSERT INTO inventory_lpns (id,sku,qty,client_id,status,batch_number,expiry_date,serial_number,location_id,glosa)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [newLpnId, lpn.rows[0].sku, moveQty, lpn.rows[0].client_id, lpn.rows[0].status,
         lpn.rows[0].batch_number, lpn.rows[0].expiry_date, lpn.rows[0].serial_number,
         r.location_to, `Aprobado desde solicitud ${r.id}`]
      );
    }
    // Marcar solicitud como aprobada
    await client.query(
      `UPDATE relocation_requests SET status='APROBADA', resolved_by=$1, resolved_at=NOW() WHERE id=$2`,
      [req.user.username, req.params.id]
    );
    await client.query(
      `INSERT INTO audit_log (type,sku,qty,glosa,username) VALUES ('RELOCATE',$1,$2,$3,$4)`,
      [r.sku, moveQty, `Aprobado por ${req.user.username}. Solicitud ${r.id}: LPN ${r.lpn_id} de ${r.location_from} → ${r.location_to}. ${r.glosa||''}`, req.user.username]
    );
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: mapDbError(err) });
  } finally { client.release(); }
});

// ── Supervisor rechaza ────────────────────────────────────────────────────
router.post('/relocate-requests/:id/reject', requireStockWrite, async (req, res) => {
  const { reason } = req.body;
  if (!reason) return res.status(400).json({ error: 'reason es requerida para rechazar.' });
  try {
    const r = await pool.query(
      `UPDATE relocation_requests SET status='RECHAZADA', resolved_by=$1, resolved_at=NOW(), reject_reason=$2
       WHERE id=$3 AND status='PENDIENTE' RETURNING id`,
      [req.user.username, reason, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Solicitud no encontrada o ya resuelta.' });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: mapDbError(err) }); }
});

module.exports = router;
