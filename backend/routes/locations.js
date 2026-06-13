// Locations router: writes de master de ubicaciones.
// GET /locations sigue en routes/masters.js (cacheado).
// La invalidación del cache 'locations:all' la dispara el middleware en server.js
// al cierre de cualquier write con path /api/locations*.

const express = require('express');
const { pool, mapDbError } = require('../db');
const { requireAdmin, requireSuperAdmin } = require('../middleware');
const { validateBody, schemas } = require('../schemas');

const router = express.Router();

const VALID_LOC_TYPES = ['RACK', 'SHELF', 'FLOOR', 'DOCK', 'PALLET'];

// Calcula x/y/z automáticamente a partir de aisle/row_num/level.
// Patrón espaciado: 2.5m entre pasillos, 1.5m entre columnas, 2.2m entre niveles.
// Acepta pasillo en minúscula, mayúscula o número.
function autoCoords(aisle, row_num, level) {
  if (!aisle) return { x: 0, y: 0, z: 0 };
  const asNum = parseInt(String(aisle).replace(/\D/g, ''), 10);
  // toUpperCase para normalizar a-z → A-Z antes de calcular índice
  const asLetter = String(aisle).toUpperCase().charCodeAt(0) - 65;
  const aisleIdx = isNaN(asNum) || /^[A-Za-z]/.test(String(aisle)) ? Math.max(0, asLetter) : (asNum - 1);
  return {
    x: aisleIdx * 2.5,
    y: ((parseInt(level) || 1) - 1) * 2.2,
    z: ((parseInt(row_num) || 1) - 1) * 1.5,
  };
}

// Construye el location_id con el nuevo formato de 4 segmentos.
// NO aplica toUpperCase — preserva el case del pasillo tal como lo envía el cliente.
function buildLocId(warehouse, aisle, row_num, level) {
  return `${warehouse}-${aisle}-${String(row_num).padStart(2, '0')}-${level}`;
}

router.post('/locations', requireAdmin, async (req, res) => {
  const b = req.body || {};

  // Validar campos estructurales del nuevo formato de 4 segmentos
  const warehouse = b.warehouse != null ? String(b.warehouse).trim() : null;
  const aisle     = b.aisle     != null ? String(b.aisle).trim()     : null;
  const rowNum    = b.row_num   != null ? parseInt(b.row_num)        : null;
  const lvl       = b.level     != null ? parseInt(b.level)          : null;

  if (!warehouse) return res.status(400).json({ error: 'warehouse (bodega física) es requerido.' });
  if (!aisle)     return res.status(400).json({ error: 'aisle (pasillo) es requerido.' });
  if (rowNum == null || isNaN(rowNum)) return res.status(400).json({ error: 'row_num (columna) debe ser un número.' });
  if (lvl    == null || isNaN(lvl))    return res.status(400).json({ error: 'level (fila) debe ser un número.' });

  // location_id explícito o auto-generado — SIN toUpperCase para preservar case del pasillo
  let locId = b.location_id ? String(b.location_id).trim() : buildLocId(warehouse, aisle, rowNum, lvl);
  if (locId.length > 50) return res.status(400).json({ error: 'El ID de ubicación supera 50 caracteres.' });

  const locType = (b.loc_type && VALID_LOC_TYPES.includes(String(b.loc_type).toUpperCase()))
    ? String(b.loc_type).toUpperCase() : 'RACK';

  // Coordenadas 3D — calcular siempre desde aisle/row/level si no vienen explícitas
  const auto = autoCoords(aisle, rowNum, lvl);
  const x = b.x != null ? parseFloat(b.x) : auto.x;
  const y = b.y != null ? parseFloat(b.y) : auto.y;
  const z = b.z != null ? parseFloat(b.z) : auto.z;

  try {
    const dup = await pool.query(`SELECT 1 FROM locations_master WHERE location_id = $1`, [locId]);
    if (dup.rows.length) return res.status(409).json({ error: `Ya existe una ubicación con código '${locId}'.` });

    await pool.query(
      `INSERT INTO locations_master
         (location_id, warehouse, zone_code, loc_type, max_kg, max_pallets,
          aisle, row_num, level, x, y, z, width, depth, height, color_hex, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [locId,
       warehouse,
       b.zone_code != null ? String(b.zone_code) : null,   // glosa libre — sin toUpperCase
       locType,
       b.max_kg    != null ? parseFloat(b.max_kg)    : 0,
       b.max_pallets != null ? parseInt(b.max_pallets) : 0,
       aisle,   // sin toUpperCase
       rowNum,
       lvl,
       x, y, z,
       b.width  != null ? parseFloat(b.width)  : 1.0,
       b.depth  != null ? parseFloat(b.depth)  : 1.0,
       b.height != null ? parseFloat(b.height) : 1.0,
       b.color_hex || null,
       b.active === false ? false : true]
    );
    res.json({ success: true, location_id: locId, x, y, z });
  } catch (err) { res.status(500).json({ error: mapDbError(err) }); }
});

// PUT /locations/:id — actualizar campos (incluye 3D).
// Busca el ID tal como llega (case-sensitive) para soportar pasillos en minúscula.
router.put('/locations/:id', requireAdmin, async (req, res) => {
  const b = req.body || {};
  const locId = String(req.params.id);  // sin toUpperCase
  try {
    const cur = await pool.query(`SELECT * FROM locations_master WHERE location_id=$1`, [locId]);
    if (!cur.rows.length) return res.status(404).json({ error: 'Ubicación no encontrada' });
    const c = cur.rows[0];

    const newWarehouse = b.warehouse !== undefined ? String(b.warehouse).trim() : c.warehouse;
    const newAisle     = b.aisle     !== undefined ? String(b.aisle).trim()     : c.aisle;
    const newRow       = b.row_num   !== undefined ? parseInt(b.row_num)        : c.row_num;
    const newLvl       = b.level     !== undefined ? parseInt(b.level)          : c.level;

    // Re-calcular coords si cambian aisle/row/level y no llegan x/y/z explícitos
    let x = b.x !== undefined ? parseFloat(b.x) : parseFloat(c.x);
    let y = b.y !== undefined ? parseFloat(b.y) : parseFloat(c.y);
    let z = b.z !== undefined ? parseFloat(b.z) : parseFloat(c.z);
    if (b.x === undefined && b.y === undefined && b.z === undefined &&
        (b.aisle !== undefined || b.row_num !== undefined || b.level !== undefined)) {
      const auto = autoCoords(newAisle, newRow, newLvl);
      x = auto.x; y = auto.y; z = auto.z;
    }

    await pool.query(
      `UPDATE locations_master SET
         warehouse   = COALESCE($1, warehouse),
         zone_code   = $2,
         loc_type    = COALESCE($3, loc_type),
         max_kg      = COALESCE($4, max_kg),
         max_pallets = COALESCE($5, max_pallets),
         aisle       = $6, row_num = $7, level = $8,
         x = $9, y = $10, z = $11,
         width       = COALESCE($12, width),
         depth       = COALESCE($13, depth),
         height      = COALESCE($14, height),
         color_hex   = $15,
         active      = COALESCE($16, active)
       WHERE location_id = $17`,
      [newWarehouse || null,
       b.zone_code !== undefined ? (b.zone_code != null ? String(b.zone_code) : null) : c.zone_code,
       b.loc_type ? (VALID_LOC_TYPES.includes(String(b.loc_type).toUpperCase()) ? String(b.loc_type).toUpperCase() : null) : null,
       b.max_kg      !== undefined ? parseFloat(b.max_kg)      : null,
       b.max_pallets !== undefined ? parseInt(b.max_pallets)    : null,
       newAisle || null,   // sin toUpperCase
       newRow   || null,
       newLvl   || null,
       x != null && !isNaN(x) ? x : null,
       y != null && !isNaN(y) ? y : null,
       z != null && !isNaN(z) ? z : null,
       b.width  !== undefined ? parseFloat(b.width)  : null,
       b.depth  !== undefined ? parseFloat(b.depth)  : null,
       b.height !== undefined ? parseFloat(b.height) : null,
       b.color_hex !== undefined ? (b.color_hex || null) : c.color_hex,
       typeof b.active === 'boolean' ? b.active : null,
       locId]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: mapDbError(err) }); }
});

// GET /locations/audit-3d — detecta ubicaciones sin posición 3D, duplicados y huérfanos.
router.get('/locations/audit-3d', requireAdmin, async (req, res) => {
  try {
    const [counts, dupes, withoutCoords, orphans] = await Promise.all([
      pool.query(`
        SELECT
          COUNT(*)::int AS total_in_db,
          COUNT(*) FILTER (WHERE x IS NOT NULL AND y IS NOT NULL AND z IS NOT NULL)::int AS with_3d_coords,
          COUNT(*) FILTER (WHERE (x IS NULL OR y IS NULL OR z IS NULL)
                                AND aisle IS NULL)::int AS without_3d_coords
        FROM locations_master
      `),
      pool.query(`
        SELECT x, y, z, array_agg(location_id ORDER BY location_id) AS location_ids
        FROM locations_master
        WHERE x IS NOT NULL AND y IS NOT NULL AND z IS NOT NULL
        GROUP BY x, y, z HAVING COUNT(*) > 1
        ORDER BY COUNT(*) DESC LIMIT 50
      `),
      pool.query(`
        SELECT l.location_id, l.zone_code, l.loc_type,
               (SELECT COUNT(*) FROM inventory_lpns i WHERE i.location_id = l.location_id AND i.qty > 0)::int AS qty_lpns
        FROM locations_master l
        WHERE (l.x IS NULL OR l.y IS NULL OR l.z IS NULL) AND l.aisle IS NULL
        ORDER BY l.location_id ASC LIMIT 500
      `),
      pool.query(`
        SELECT i.location_id, COUNT(*)::int AS lpn_count
        FROM inventory_lpns i
        WHERE i.qty > 0 AND i.location_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM locations_master l WHERE l.location_id = i.location_id)
        GROUP BY i.location_id ORDER BY lpn_count DESC LIMIT 100
      `),
    ]);
    res.json({
      total_in_db:         counts.rows[0].total_in_db,
      with_3d_coords:      counts.rows[0].with_3d_coords,
      without_3d_coords:   counts.rows[0].without_3d_coords,
      duplicate_positions: dupes.rows.map(r => ({ x: parseFloat(r.x), y: parseFloat(r.y), z: parseFloat(r.z), location_ids: r.location_ids })),
      orphan_inventory:    orphans.rows.map(r => ({ location_id: r.location_id, lpn_count: r.lpn_count })),
      locations_without_3d: withoutCoords.rows,
    });
  } catch (err) { res.status(500).json({ error: mapDbError(err) }); }
});

// POST /locations/migrate-3d — deriva coords desde location_id para legacy.
// Body: { dry_run: boolean }
router.post('/locations/migrate-3d', requireSuperAdmin, async (req, res) => {
  const dryRun = !!req.body?.dry_run;
  try {
    // Solo procesar las que no tienen coords NI aisle
    const rows = (await pool.query(
      `SELECT * FROM locations_master WHERE (x IS NULL OR y IS NULL OR z IS NULL) AND aisle IS NULL`
    )).rows;

    const details = [];
    let migrated = 0, skipped = 0;

    // Helper: replica autoCoords del POST
    const autoCoords = (aisle, row_num, level) => {
      if (!aisle) return { x: 0, y: 0, z: 0 };
      const asNum = parseInt(String(aisle).replace(/\D/g, ''), 10);
      const asLetter = String(aisle).charCodeAt(0) - 65;
      const aisleIdx = isNaN(asNum) || /^[A-Za-z]/.test(String(aisle)) ? Math.max(0, asLetter) : (asNum - 1);
      return {
        x: aisleIdx * 2.5,
        y: ((parseInt(level) || 1) - 1) * 2.2,
        z: ((parseInt(row_num) || 1) - 1) * 1.5,
      };
    };

    for (const loc of rows) {
      const id = loc.location_id;
      let parsed = null;
      let pattern = 'unknown';

      // Patrón especial PISO-*
      if (/^PISO[-_]/.test(id)) {
        parsed = { aisle: null, row_num: null, level: null, x: 0, y: 0, z: 0 };
        pattern = 'piso';
      }
      // Patrón B1-RES-A-01-01 o B1-PCK-A-01-01 (5 partes)
      else {
        const m5 = id.match(/^([A-Z0-9]+)-([A-Z0-9]+)-([A-Z0-9]+)-(\d+)-(\d+)$/);
        if (m5) {
          const aisle = m5[3], row_num = parseInt(m5[4]), level = parseInt(m5[5]);
          const c = autoCoords(aisle, row_num, level);
          parsed = { aisle, row_num, level, ...c };
          pattern = 'B1-ZONE-AISLE-ROW-LEVEL';
        } else {
          // Patrón RACK-A-01 (3 partes con prefijo)
          const m3 = id.match(/^([A-Z]+)-([A-Z]+)-(\d+)$/);
          if (m3) {
            const aisle = m3[2], row_num = parseInt(m3[3]), level = 1;
            const c = autoCoords(aisle, row_num, level);
            parsed = { aisle, row_num, level, ...c };
            pattern = 'PREFIX-AISLE-ROW';
          }
        }
      }

      if (!parsed) {
        skipped++;
        details.push({ location_id: id, derived_x: null, derived_y: null, derived_z: null, pattern: 'no_match' });
        continue;
      }

      details.push({ location_id: id, derived_x: parsed.x, derived_y: parsed.y, derived_z: parsed.z, pattern });
      migrated++;

      if (!dryRun) {
        await pool.query(
          `UPDATE locations_master
              SET aisle = $1, row_num = $2, level = $3, x = $4, y = $5, z = $6
            WHERE location_id = $7`,
          [parsed.aisle, parsed.row_num, parsed.level, parsed.x, parsed.y, parsed.z, id]
        );
      }
    }
    res.json({
      processed: rows.length,
      migrated,
      skipped,
      dry_run: dryRun,
      details: details.slice(0, 500),
    });
  } catch (err) { res.status(500).json({ error: mapDbError(err) }); }
});

// Inserción masiva — evita N peticiones desde el frontend (REN-05)
router.post('/locations/bulk', requireAdmin, async (req, res) => {
  const { locations, overwrite } = req.body;
  if (!Array.isArray(locations) || locations.length === 0) return res.status(400).json({ error: 'Enviar array locations.' });
  if (locations.length > 5000) return res.status(400).json({ error: 'Máximo 5.000 ubicaciones por operación.' });
  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');
    let generated = 0; let skipped = 0;
    for (const loc of locations) {
      // Generar location_id si no viene explícito
      let locId = loc.location_id
        ? String(loc.location_id).trim()  // sin toUpperCase
        : (loc.warehouse && loc.aisle != null && loc.row_num != null && loc.level != null
            ? buildLocId(loc.warehouse, loc.aisle, loc.row_num, loc.level)
            : null);
      if (!locId) continue;

      // Coordenadas 3D
      const auto = autoCoords(loc.aisle, loc.row_num, loc.level);
      const x = loc.x != null ? parseFloat(loc.x) : auto.x;
      const y = loc.y != null ? parseFloat(loc.y) : auto.y;
      const z = loc.z != null ? parseFloat(loc.z) : auto.z;

      const sql = overwrite
        ? `INSERT INTO locations_master
             (location_id, warehouse, zone_code, loc_type, max_kg, max_pallets,
              aisle, row_num, level, x, y, z, width, depth, height, color_hex)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
           ON CONFLICT (location_id) DO UPDATE SET
             warehouse=EXCLUDED.warehouse, zone_code=EXCLUDED.zone_code,
             loc_type=EXCLUDED.loc_type, max_kg=EXCLUDED.max_kg, max_pallets=EXCLUDED.max_pallets,
             aisle=EXCLUDED.aisle, row_num=EXCLUDED.row_num, level=EXCLUDED.level,
             x=EXCLUDED.x, y=EXCLUDED.y, z=EXCLUDED.z,
             width=EXCLUDED.width, depth=EXCLUDED.depth, height=EXCLUDED.height,
             color_hex=EXCLUDED.color_hex`
        : `INSERT INTO locations_master
             (location_id, warehouse, zone_code, loc_type, max_kg, max_pallets,
              aisle, row_num, level, x, y, z, width, depth, height, color_hex)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
           ON CONFLICT DO NOTHING`;
      const r = await dbClient.query(sql, [
        locId,
        loc.warehouse != null ? String(loc.warehouse) : null,
        loc.zone_code != null ? String(loc.zone_code) : null,  // glosa — sin toUpperCase
        (loc.loc_type || 'RACK').toUpperCase(),
        loc.max_kg  || 0,
        loc.max_pallets || 0,
        loc.aisle   != null ? String(loc.aisle)   : null,  // sin toUpperCase
        loc.row_num != null ? parseInt(loc.row_num) : null,
        loc.level   != null ? parseInt(loc.level)   : null,
        x, y, z,
        loc.width  != null ? parseFloat(loc.width)  : 1.0,
        loc.depth  != null ? parseFloat(loc.depth)  : 1.0,
        loc.height != null ? parseFloat(loc.height) : 1.0,
        loc.color_hex || null,
      ]);
      if (r.rowCount > 0) generated++; else skipped++;
    }
    await dbClient.query('COMMIT');
    res.json({ success: true, generated, skipped });
  } catch(err) {
    await dbClient.query('ROLLBACK');
    res.status(500).json({ error: mapDbError(err) });
  } finally { dbClient.release(); }
});

// Update masivo de zona/tipo
router.put('/locations/bulk', requireAdmin, async (req, res) => {
  const { location_ids, zone_code, loc_type } = req.body;
  if (!Array.isArray(location_ids) || location_ids.length === 0) return res.status(400).json({ error: 'Enviar array location_ids.' });
  try {
    const sets = []; const params = []; let idx = 1;
    if (zone_code !== undefined) { sets.push(`zone_code = $${idx++}`); params.push(zone_code); }
    if (loc_type !== undefined) { sets.push(`loc_type = $${idx++}`); params.push(loc_type); }
    if (sets.length === 0) return res.status(400).json({ error: 'Nada que actualizar.' });
    params.push(location_ids);
    await pool.query(`UPDATE locations_master SET ${sets.join(', ')} WHERE location_id = ANY($${idx})`, params);
    res.json({ success: true, updated: location_ids.length });
  } catch(err) { res.status(500).json({ error: mapDbError(err) }); }
});

// Delete masivo por IDs (no toca PISO-RECEPCION ni ubicaciones con stock)
router.post('/locations/bulk-delete', requireAdmin, async (req, res) => {
  const { location_ids } = req.body;
  if (!Array.isArray(location_ids) || location_ids.length === 0) return res.status(400).json({ error: 'Enviar array location_ids.' });
  try {
    const result = await pool.query(
      `DELETE FROM locations_master WHERE location_id = ANY($1) AND location_id != 'PISO-RECEPCION' AND location_id NOT IN (SELECT DISTINCT location_id FROM inventory_lpns WHERE qty > 0)`,
      [location_ids]
    );
    res.json({ success: true, deleted: result.rowCount });
  } catch(err) { res.status(500).json({ error: mapDbError(err) }); }
});

// Delete masivo de TODAS las vacías (REN-09)
router.delete('/locations/bulk', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM locations_master WHERE location_id != 'PISO-RECEPCION'
       AND location_id NOT IN (SELECT DISTINCT location_id FROM inventory_lpns WHERE qty > 0)
       RETURNING location_id`
    );
    res.json({ success: true, deleted: result.rowCount });
  } catch(err) { res.status(500).json({ error: mapDbError(err) }); }
});

router.delete('/locations/:id', requireAdmin, async (req, res) => {
  try {
    if (req.params.id === 'PISO-RECEPCION') return res.status(400).json({ error: "'PISO-RECEPCION' es la ubicación base del sistema y no puede eliminarse." });
    const check = await pool.query('SELECT COUNT(*) as count FROM inventory_lpns WHERE location_id=$1 AND qty>0', [req.params.id]);
    if (parseInt(check.rows[0].count) > 0) return res.status(400).json({ error: `No se puede eliminar: la ubicación tiene ${check.rows[0].count} LPN(s) con stock activo.` });
    const result = await pool.query('DELETE FROM locations_master WHERE location_id=$1', [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Ubicación no encontrada.' });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: mapDbError(err) }); }
});

// POST /locations/move-orphans-to-reception
// Mueve todos los LPNs en ubicaciones huérfanas (no existen en locations_master)
// a PISO-RECEPCION. Requiere admin.
router.post('/locations/move-orphans-to-reception', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      UPDATE inventory_lpns
      SET location_id = 'PISO-RECEPCION'
      WHERE qty > 0
        AND location_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM locations_master l WHERE l.location_id = inventory_lpns.location_id
        )
      RETURNING id, sku, location_id AS nueva_ubicacion
    `);
    res.json({ moved: result.rowCount, lpns: result.rows });
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

module.exports = router;
