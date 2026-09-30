// SKUs router: GET /skus paginado + /bootstrap (consolidado) + escrituras
// (POST/PUT/DELETE, versiones, barcode, sku-resources, alertas) (COD-02).

const express = require('express');
const { pool, mapDbError } = require('../db');
const { requireAuth, requireStockWrite, requireJefeOrAbove, checkClientAccess } = require('../middleware');
const { cached } = require('../cache');
const { parsePagination, setPaginationHeaders } = require('../pagination');

const router = express.Router();

// Helper: aplica scope por allowed_clients.
function scopedSkusWhere(req, startIdx = 1) {
  const ac = req.user.allowed_clients;
  const fullAccess = !ac || ac === 'ALL' || ['EJECUTIVO_CUENTA', 'ADMIN', 'SUPERADMIN', 'DEMO'].includes(req.user.role);
  if (fullAccess) return { conditions: [], params: [], idx: startIdx, emptyAllowed: false };
  const clientList = ac.split(',').map(s => s.trim()).filter(Boolean);
  if (clientList.length === 0) return { conditions: [], params: [], idx: startIdx, emptyAllowed: true };
  let idx = startIdx;
  const ph = clientList.map(() => `$${idx++}`).join(',');
  return { conditions: [`client_id IN (${ph})`], params: clientList, idx, emptyAllowed: false };
}

router.get('/skus', requireAuth, async (req, res) => {
  try {
    const { search, client_id, manufacturer_id } = req.query;
    const scope = scopedSkusWhere(req);
    if (scope.emptyAllowed) {
      setPaginationHeaders(res, { total: 0, limit: 50, offset: 0 });
      return res.json([]);
    }

    const conditions = scope.conditions.map(c => c.replace(/\bclient_id\b/g, 's.client_id'));
    const params = [...scope.params];
    let idx = scope.idx;
    conditions.push('s.deleted_at IS NULL'); // excluir SKUs eliminados lógicamente
    if (client_id) { conditions.push(`s.client_id = $${idx++}`); params.push(client_id); }
    if (search)    { conditions.push(`(s.sku ILIKE $${idx} OR s."desc" ILIKE $${idx})`); params.push(`%${search}%`); idx++; }
    if (manufacturer_id === 'none') conditions.push(`s.manufacturer_id IS NULL`);
    else if (manufacturer_id)       { conditions.push(`s.manufacturer_id = $${idx++}`); params.push(manufacturer_id); }

    const { limit, offset } = parsePagination(req);
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const baseQuery = `
      SELECT s.*,
             mf.id   AS mf_id,
             mf.code AS mf_code,
             mf.name AS mf_name,
             COALESCE(inv.total_qty, 0)::float AS stock_total,
             COALESCE(vh.version_count, 1)::int AS version_count,
             COALESCE(vh.has_old_stock, FALSE) AS has_old_stock
        FROM master_skus s
        LEFT JOIN manufacturers mf ON mf.id = s.manufacturer_id
        LEFT JOIN (
          SELECT sku, SUM(qty) AS total_qty FROM inventory_lpns
           WHERE qty > 0 GROUP BY sku
        ) inv ON inv.sku = s.sku
        LEFT JOIN (
          SELECT h.sku, COUNT(*)::int AS version_count
            FROM sku_version_history h GROUP BY h.sku
        ) vc ON vc.sku = s.sku
        LEFT JOIN LATERAL (
          SELECT
            (SELECT COUNT(*)::int FROM sku_version_history h2 WHERE h2.sku = s.sku) AS version_count,
            EXISTS(
              SELECT 1 FROM inventory_lpns i2
               WHERE i2.sku = s.sku AND i2.qty > 0
                 AND i2.sku_version < s.current_version
            ) AS has_old_stock
        ) vh ON TRUE
        ${where}
        ORDER BY s.sku ASC
        LIMIT $${idx++} OFFSET $${idx++}`;
    const [countRes, dataRes] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS n FROM master_skus s ${where}`, params),
      pool.query(baseQuery, [...params, limit, offset]),
    ]);
    setPaginationHeaders(res, { total: countRes.rows[0].n, limit, offset });
    // Estructurar manufacturer en objeto anidado.
    const rows = dataRes.rows.map(r => {
      const code = r.mf_code || r.manufacturer_code || null;
      const name = r.mf_name || r.manufacturer_code || null;
      const mfId = r.mf_id || null;
      const out = { ...r };
      delete out.mf_id; delete out.mf_code; delete out.mf_name;
      out.manufacturer = (mfId || code || name) ? { id: mfId, code, name } : null;
      return out;
    });
    res.json(rows);
  } catch (err) { res.status(500).json({ error: mapDbError(err) }); }
});

// /bootstrap: consolida 4 maestros en una respuesta. Reutiliza cache.
router.get('/bootstrap', requireAuth, async (req, res) => {
  try {
    const scope = scopedSkusWhere(req);
    const skusPromise = (async () => {
      if (scope.emptyAllowed) return [];
      const conds = [...scope.conditions, 'deleted_at IS NULL']; // excluir SKUs eliminados lógicamente
      const where = `WHERE ${conds.join(' AND ')}`;
      return (await pool.query(`SELECT * FROM master_skus ${where} ORDER BY sku ASC LIMIT 1000`, scope.params)).rows;
    })();

    const [locations, statuses, document_types, skus] = await Promise.all([
      cached('locations:all',      async () => (await pool.query('SELECT * FROM locations_master ORDER BY location_id ASC')).rows),
      cached('statuses:all',       async () => (await pool.query('SELECT * FROM statuses ORDER BY id ASC')).rows),
      cached('document_types:all', async () => (await pool.query('SELECT * FROM document_types ORDER BY id ASC')).rows),
      skusPromise,
    ]);
    res.json({ locations, statuses, document_types, skus, skus_truncated: skus.length === 1000 });
  } catch (err) { res.status(500).json({ error: mapDbError(err) }); }
});

router.post('/skus', requireStockWrite, checkClientAccess('write', { required: true }), async (req, res) => {
  const { sku, desc, category, uom, weight, length, width, height, abc_class, requires_lot, requires_serial, client_id, barcode,
          manufacturer_id, manufacturer_code, manufacturer_sku, brand,
          allow_substitutes, substitute_scope, substitute_threshold } = req.body;
  if (!sku || !String(sku).trim()) return res.status(400).json({ error: 'El código SKU es requerido' });
  if (!desc || !String(desc).trim()) return res.status(400).json({ error: 'La descripción del SKU es requerida' });
  const skuNorm = String(sku).toUpperCase().trim();
  const effectiveClientId = client_id || 'GENERAL';
  const barcodeNorm = barcode && String(barcode).trim() !== '' ? String(barcode).trim() : null;
  try {
    if (barcodeNorm) {
      const bcDup = await pool.query(`SELECT sku, client_id FROM master_skus WHERE barcode=$1 AND NOT (sku=$2 AND client_id=$3) LIMIT 1`, [barcodeNorm, skuNorm, effectiveClientId]);
      if (bcDup.rows.length > 0)
        return res.status(409).json({ error: `El código de barras '${barcodeNorm}' ya está asignado al SKU '${bcDup.rows[0].sku}' (cliente: ${bcDup.rows[0].client_id}).` });
    }
    // Validar manufacturer_id si llega
    let mfId = null;
    if (manufacturer_id !== undefined && manufacturer_id !== null && manufacturer_id !== '') {
      const mfRow = await pool.query(`SELECT id FROM manufacturers WHERE id=$1`, [manufacturer_id]);
      if (!mfRow.rows.length) return res.status(400).json({ error: 'Fabricante no encontrado (manufacturer_id inválido).' });
      mfId = parseInt(manufacturer_id);
    }
    const mfCode = manufacturer_code && String(manufacturer_code).trim() !== '' ? String(manufacturer_code).trim() : null;
    const mfSku  = manufacturer_sku  && String(manufacturer_sku).trim()  !== '' ? String(manufacturer_sku).trim()  : null;
    const brandN = brand && String(brand).trim() !== '' ? String(brand).trim() : null;

    // Validar substitute_scope
    const validScopes = ['any','same_client','same_category','same_manufacturer','manual_only'];
    const scope = validScopes.includes(substitute_scope) ? substitute_scope : 'any';
    // Convertir threshold: si llega como entero (1-100) → guardar como decimal (0.01-1.00)
    let threshold = null;
    if (substitute_threshold !== undefined && substitute_threshold !== null && substitute_threshold !== '') {
      let t = parseFloat(substitute_threshold);
      if (!isNaN(t)) {
        if (t > 1) t = t / 100;
        threshold = Math.max(0, Math.min(1, t));
      }
    }

    await pool.query(`
      INSERT INTO master_skus
        (sku, client_id, "desc", category, uom, weight, length, width, height, abc_class,
         requires_lot, requires_serial, barcode,
         manufacturer_id, manufacturer_code, manufacturer_sku, brand,
         allow_substitutes, substitute_scope, substitute_threshold)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
      ON CONFLICT (sku, client_id) DO UPDATE SET
        "desc"=EXCLUDED."desc", category=EXCLUDED.category, uom=EXCLUDED.uom,
        weight=EXCLUDED.weight, length=EXCLUDED.length, width=EXCLUDED.width,
        height=EXCLUDED.height, abc_class=EXCLUDED.abc_class,
        requires_lot=EXCLUDED.requires_lot, requires_serial=EXCLUDED.requires_serial,
        barcode=EXCLUDED.barcode,
        manufacturer_id=EXCLUDED.manufacturer_id,
        manufacturer_code=EXCLUDED.manufacturer_code,
        manufacturer_sku=EXCLUDED.manufacturer_sku,
        brand=EXCLUDED.brand,
        allow_substitutes=EXCLUDED.allow_substitutes,
        substitute_scope=EXCLUDED.substitute_scope,
        substitute_threshold=EXCLUDED.substitute_threshold
    `, [skuNorm, effectiveClientId, desc.trim(), category || 'General', uom || 'UN',
        parseFloat(weight)||0, parseFloat(length)||0, parseFloat(width)||0, parseFloat(height)||0,
        abc_class === '-' ? null : abc_class,
        requires_lot || false, requires_serial || false, barcodeNorm,
        mfId, mfCode, mfSku, brandN,
        !!allow_substitutes, scope, threshold]);
    // Línea base v1 en historial (idempotente)
    await pool.query(
      `INSERT INTO sku_version_history (sku, version, requires_lot, requires_serial, changed_by, reason)
         SELECT sku, current_version, requires_lot, requires_serial, $1, 'Línea base'
           FROM master_skus WHERE sku = $2
         ON CONFLICT (sku, version) DO NOTHING`,
      [req.user.username, skuNorm]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: mapDbError(err) }); }
});

// PUT /api/skus/:sku — versiona automáticamente si hay cambio crítico con stock.
// Campos críticos: requires_lot, requires_serial.
// Campos no críticos (desc, category, uom, weight, barcode, manufacturer_*, brand)
// se propagan a todas las versiones del mismo SKU base.
// El código del SKU NUNCA cambia. Si hay cambio crítico (requires_lot/serial)
// con stock activo → bump de current_version y snapshot en sku_version_history.
// Los cambios no críticos siempre se aplican in-place sobre la misma fila.
router.put('/skus/:sku', requireStockWrite, checkClientAccess('write'), async (req, res) => {
  const sku = String(req.params.sku).toUpperCase().trim();
  const { client_id, requires_lot, requires_serial, desc, category, uom, weight, length, width, height,
          abc_class, barcode, manufacturer_id, manufacturer_code, manufacturer_sku, brand,
          version_reason, username } = req.body || {};
  if (!client_id) return res.status(400).json({ error: 'client_id es requerido en el body.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query(
      `SELECT * FROM master_skus WHERE sku = $1 AND client_id = $2 LIMIT 1`,
      [sku, client_id]
    );
    if (!cur.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'SKU no encontrado.' });
    }
    const current = cur.rows[0];

    // Detectar cambio crítico
    const newLot    = typeof requires_lot    === 'boolean' ? requires_lot    : current.requires_lot;
    const newSerial = typeof requires_serial === 'boolean' ? requires_serial : current.requires_serial;
    const criticalChange = (newLot !== current.requires_lot) || (newSerial !== current.requires_serial);

    let versionedResult = null;

    if (criticalChange) {
      const stockRow = await client.query(
        `SELECT COALESCE(SUM(qty), 0)::numeric AS total FROM inventory_lpns WHERE sku = $1 AND qty > 0`,
        [sku]
      );
      const stock = parseFloat(stockRow.rows[0].total) || 0;

      if (stock > 0) {
        // Bump versión + snapshot. El código del SKU no cambia.
        const changes = { requires_lot: newLot, requires_serial: newSerial };
        const versionFn = await client.query(
          `SELECT * FROM create_sku_version($1, $2::jsonb, $3, $4)`,
          [sku, JSON.stringify(changes),
           version_reason || 'Cambio de control de lote/serie con stock activo',
           username || req.user.username]
        );
        versionedResult = {
          versioned: true,
          sku: sku,
          previous_version: current.current_version,
          new_version: versionFn.rows[0].new_version,
          message: `Se registró la versión ${versionFn.rows[0].new_version} de ${sku}. El stock existente (v${current.current_version}) se despacha normalmente. Las nuevas recepciones usarán la configuración v${versionFn.rows[0].new_version}.`,
        };
      } else {
        // Sin stock → actualizar in-place sin bump de versión.
        await client.query(
          `UPDATE master_skus SET requires_lot=$1, requires_serial=$2 WHERE sku=$3 AND client_id=$4`,
          [newLot, newSerial, sku, client_id]
        );
        // Refrescar la entrada del historial para la versión actual.
        await client.query(
          `INSERT INTO sku_version_history (sku, version, requires_lot, requires_serial, changed_by, reason)
           VALUES ($1, $2, $3, $4, $5, 'Cambio sin stock — versión actual actualizada')
           ON CONFLICT (sku, version) DO UPDATE SET
             requires_lot = EXCLUDED.requires_lot,
             requires_serial = EXCLUDED.requires_serial,
             changed_at = NOW(),
             changed_by = EXCLUDED.changed_by,
             reason = EXCLUDED.reason`,
          [sku, current.current_version, newLot, newSerial, username || req.user.username]
        );
      }
    }

    // Cambios no críticos: in-place sobre la misma fila.
    let mfId = current.manufacturer_id;
    if (manufacturer_id !== undefined && manufacturer_id !== null && manufacturer_id !== '') {
      const mfRow = await client.query(`SELECT id FROM manufacturers WHERE id=$1`, [manufacturer_id]);
      if (!mfRow.rows.length) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'manufacturer_id inválido' }); }
      mfId = parseInt(manufacturer_id);
    } else if (manufacturer_id === '') {
      mfId = null;
    }

    await client.query(
      `UPDATE master_skus SET
         "desc"            = COALESCE($1, "desc"),
         category          = COALESCE($2, category),
         uom               = COALESCE($3, uom),
         weight            = COALESCE($4, weight),
         length            = COALESCE($5, length),
         width             = COALESCE($6, width),
         height            = COALESCE($7, height),
         abc_class         = COALESCE($8, abc_class),
         barcode           = COALESCE($9, barcode),
         manufacturer_id   = $10,
         manufacturer_code = COALESCE($11, manufacturer_code),
         manufacturer_sku  = COALESCE($12, manufacturer_sku),
         brand             = COALESCE($13, brand)
       WHERE sku = $14 AND client_id = $15`,
      [desc, category, uom,
       weight !== undefined ? parseFloat(weight) : null,
       length !== undefined ? parseFloat(length) : null,
       width  !== undefined ? parseFloat(width)  : null,
       height !== undefined ? parseFloat(height) : null,
       abc_class, barcode, mfId,
       manufacturer_code, manufacturer_sku, brand,
       sku, client_id]
    );
    await client.query('COMMIT');
    if (versionedResult) return res.json(versionedResult);
    res.json({ success: true, versioned: false, sku });
  } catch (e) { await client.query('ROLLBACK'); res.status(500).json({ error: mapDbError(e) }); }
  finally { client.release(); }
});

// GET /api/skus/:sku/versions — historial completo desde sku_version_history.
router.get('/skus/:sku/versions', requireAuth, async (req, res) => {
  const sku = String(req.params.sku).toUpperCase().trim();
  try {
    const r = await pool.query(
      `SELECT h.version, h.requires_lot, h.requires_serial,
              h.changed_at, h.changed_by, h.reason,
              (SELECT COALESCE(SUM(qty), 0)::float FROM inventory_lpns
                 WHERE sku = h.sku AND sku_version = h.version AND qty > 0) AS active_stock,
              (h.version = s.current_version) AS is_current
         FROM sku_version_history h
         JOIN master_skus s ON s.sku = h.sku
        WHERE h.sku = $1
        ORDER BY h.version DESC`,
      [sku]
    );
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

router.delete('/skus/:id', requireStockWrite, checkClientAccess('write'), async (req, res) => {
  const { client_id } = req.query;
  if (!client_id) return res.status(400).json({ error: 'Se requiere client_id como query param para identificar el SKU.' });
  try {
    const check = await pool.query('SELECT COUNT(*) as count FROM inventory_lpns WHERE sku=$1 AND client_id=$2 AND qty>0', [req.params.id, client_id]);
    if (parseInt(check.rows[0].count) > 0) return res.status(400).json({ error: 'No se puede eliminar un SKU que tiene stock activo.' });
    // Borrado LÓGICO (nunca físico): marca deleted_at. El código del SKU se conserva
    // y el historial de versiones queda intacto. El borrado físico es solo SUPERADMIN.
    const result = await pool.query('UPDATE master_skus SET deleted_at=NOW() WHERE sku=$1 AND client_id=$2 AND deleted_at IS NULL', [req.params.id, client_id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'SKU no encontrado para ese cliente (o ya estaba eliminado).' });
    res.json({ success: true, deleted: 'logical' });
  } catch (err) { res.status(500).json({ error: mapDbError(err) }); }
});

router.get('/skus/barcode/:barcode', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM master_skus WHERE barcode = $1 LIMIT 1`, [req.params.barcode]);
    if (result.rows.length > 0) res.json({ found: true, sku: result.rows[0] });
    else res.json({ found: false });
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});

// ============ MATERIALES Y HH ============
router.get('/sku-resources', requireAuth, async (req, res) => {
  const { sku, client_id } = req.query;
  if (!sku || !client_id) return res.status(400).json({ error: 'Se requieren sku y client_id.' });
  try {
    const result = await pool.query(
      `SELECT * FROM sku_resources WHERE sku=$1 AND client_id=$2 ORDER BY resource_type, resource_name`,
      [sku, client_id]
    );
    res.json(result.rows);
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});

router.post('/sku-resources', requireJefeOrAbove, async (req, res) => {
  const { sku, client_id, resource_type, resource_name, qty_per_unit, unit, hours_per_unit, time_unit, personnel_count, notes } = req.body;
  if (!sku || !client_id) return res.status(400).json({ error: 'Se requieren sku y client_id.' });
  if (!resource_name || !String(resource_name).trim()) return res.status(400).json({ error: 'Nombre del recurso es requerido.' });
  const rType = (resource_type === 'HH') ? 'HH' : 'MATERIAL';
  const qtyVal = parseFloat(qty_per_unit) || 1;
  const hrsVal = parseFloat(hours_per_unit) || 0;
  const tUnit = (time_unit === 'MINUTOS') ? 'MINUTOS' : 'HORAS';
  const persVal = parseInt(personnel_count) || 1;
  if (qtyVal <= 0) return res.status(400).json({ error: 'qty_per_unit debe ser mayor a 0.' });
  try {
    const result = await pool.query(
      `INSERT INTO sku_resources (sku, client_id, resource_type, resource_name, qty_per_unit, unit, hours_per_unit, time_unit, personnel_count, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (sku, client_id, resource_type, resource_name)
       DO UPDATE SET qty_per_unit=EXCLUDED.qty_per_unit, unit=EXCLUDED.unit,
         hours_per_unit=EXCLUDED.hours_per_unit, time_unit=EXCLUDED.time_unit,
         personnel_count=EXCLUDED.personnel_count, notes=EXCLUDED.notes
       RETURNING *`,
      [sku, client_id, rType, String(resource_name).trim(), qtyVal, unit || 'UN', hrsVal, tUnit, persVal, notes || null]
    );
    res.json(result.rows[0]);
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});

router.delete('/sku-resources/:id', requireJefeOrAbove, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('DELETE FROM sku_resources WHERE id=$1', [id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Recurso no encontrado.' });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});

router.post('/skus/alerts', requireJefeOrAbove, async (req, res) => {
  const { sku, client_id, stock_min, stock_max } = req.body;
  if (!sku) return res.status(400).json({ error: 'SKU es requerido.' });
  const minVal = parseFloat(stock_min) || 0;
  const maxVal = parseFloat(stock_max) || 0;
  if (minVal < 0 || maxVal < 0) return res.status(400).json({ error: 'Los valores de alerta no pueden ser negativos.' });
  if (maxVal > 0 && minVal > maxVal) return res.status(400).json({ error: `stock_min (${minVal}) no puede ser mayor que stock_max (${maxVal}).` });
  try {
    const result = await pool.query(`UPDATE master_skus SET stock_min=$1, stock_max=$2 WHERE sku=$3 AND client_id=$4`,
      [minVal, maxVal, sku, client_id||'GENERAL']);
    if (result.rowCount === 0) return res.status(404).json({ error: 'SKU no encontrado para ese cliente.' });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});

router.get('/alerts/stock', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT s.sku, s."desc", s.client_id, s.uom, s.stock_min, s.stock_max,
        COALESCE(SUM(i.qty),0) as current_stock
      FROM master_skus s
      LEFT JOIN inventory_lpns i ON s.sku = i.sku AND i.qty > 0
      WHERE s.stock_min > 0 OR s.stock_max > 0
      GROUP BY s.sku, s."desc", s.client_id, s.uom, s.stock_min, s.stock_max
      HAVING (s.stock_min > 0 AND COALESCE(SUM(i.qty),0) < s.stock_min)
          OR (s.stock_max > 0 AND COALESCE(SUM(i.qty),0) > s.stock_max)
      ORDER BY s.sku
    `);
    res.json(result.rows);
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});

module.exports = router;
