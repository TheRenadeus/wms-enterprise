// Sustitutos de SKU.
// GET /api/skus/:sku/substitutes?qty=N&client_id=X
// POST /api/skus/substitutes
// DELETE /api/skus/substitutes/:id

const express = require('express');
const { pool, mapDbError } = require('../db');
const { requireAuth, requireAdmin } = require('../middleware');

const router = express.Router();

// Helper: lee config global de sustitutos.
async function loadSubstituteConfig() {
  const r = await pool.query(`
    SELECT key, value FROM system_config
     WHERE key IN ('substitute_similarity_threshold','substitute_max_results',
                   'substitute_require_same_uom','substitute_require_same_category',
                   'substitute_cross_client')
  `);
  const cfg = {};
  r.rows.forEach(row => { cfg[row.key] = row.value; });
  return {
    threshold:           parseFloat(cfg.substitute_similarity_threshold) || 0.35,
    maxResults:          parseInt(cfg.substitute_max_results) || 10,
    requireSameUom:      cfg.substitute_require_same_uom !== 'false',
    requireSameCategory: cfg.substitute_require_same_category === 'true',
    crossClient:         cfg.substitute_cross_client === 'true',
  };
}

// GET /api/skus/:sku/substitutes?qty=&client_id=
router.get('/skus/:sku/substitutes', requireAuth, async (req, res) => {
  const sku = String(req.params.sku).toUpperCase().trim();
  const qty = parseFloat(req.query.qty) || 0;
  try {
    const refRow = await pool.query(
      `SELECT s.sku, s."desc", s.category, s.uom, s.client_id,
              s.allow_substitutes, s.substitute_scope, s.substitute_threshold,
              s.manufacturer_id
         FROM master_skus s WHERE s.sku = $1 LIMIT 1`,
      [sku]
    );
    if (!refRow.rows.length) return res.status(404).json({ error: 'SKU no encontrado' });
    const ref = refRow.rows[0];

    // Verificar disponibilidad actual del SKU original
    const stockRow = await pool.query(
      `SELECT COALESCE(SUM(qty), 0)::float AS total
         FROM inventory_lpns WHERE sku = $1 AND qty > 0 AND status = 'DISPONIBLE'`,
      [sku]
    );
    const qtyAvailable = parseFloat(stockRow.rows[0].total) || 0;
    const deficit = Math.max(0, qty - qtyAvailable);

    if (!ref.allow_substitutes) {
      return res.json({
        sku_original: sku,
        desc_original: ref.desc,
        qty_available: qtyAvailable,
        qty_requested: qty,
        deficit,
        substitutes_enabled: false,
        substitutes: [],
        reason: 'disabled',
        message: 'Este SKU no tiene habilitada la oferta de sustitutos.'
      });
    }

    const cfg = await loadSubstituteConfig();
    const threshold = ref.substitute_threshold !== null ? parseFloat(ref.substitute_threshold) : cfg.threshold;
    const scope = ref.substitute_scope || 'any';

    // PASO 1 — sustitutos manuales
    const manuals = await pool.query(
      `SELECT ss.sku_subst AS sku, s."desc", s.category, s.uom, s.client_id,
              COALESCE(inv.total_qty,0)::float AS available_qty,
              1.0 AS similarity_score, 'manual' AS match_type,
              ss.priority, ss.notes,
              mf.id   AS manufacturer_id,
              COALESCE(mf.name, s.manufacturer_code) AS manufacturer_name,
              mf.code AS manufacturer_code,
              s.manufacturer_sku, s.brand
         FROM sku_substitutes ss
         JOIN master_skus s ON s.sku = ss.sku_subst
         LEFT JOIN manufacturers mf ON mf.id = s.manufacturer_id
         LEFT JOIN (
           SELECT sku, SUM(qty) AS total_qty FROM inventory_lpns
            WHERE qty > 0 AND status = 'DISPONIBLE' GROUP BY sku
         ) inv ON inv.sku = s.sku
        WHERE ss.sku_original = $1 AND COALESCE(inv.total_qty,0) > 0
        ORDER BY ss.priority ASC`,
      [sku]
    );

    // PASO 2 — similitud automática
    let autos = { rows: [] };
    if (scope !== 'manual_only') {
      const conds = [
        `s.sku <> $1`,
        // excluir versiones congeladas
        `(s.version_status IS NULL OR s.version_status = 'ACTIVE')`,
        `s.sku NOT IN (SELECT sku_subst FROM sku_substitutes WHERE sku_original = $1)`,
        `similarity(s."desc", ref."desc") >= $2`,
        `COALESCE(inv.total_qty, 0) > 0`,
      ];
      if (cfg.requireSameUom)      conds.push(`s.uom = ref.uom`);
      if (cfg.requireSameCategory) conds.push(`s.category = ref.category`);
      if (!cfg.crossClient && scope !== 'same_client') {
        // por defecto solo mismo client_id salvo override de scope explícito
      }
      if (scope === 'same_client')      conds.push(`s.client_id = ref.client_id`);
      if (scope === 'same_category')    conds.push(`s.category  = ref.category`);
      if (scope === 'same_manufacturer')conds.push(`s.manufacturer_id = ref.manufacturer_id AND ref.manufacturer_id IS NOT NULL`);

      autos = await pool.query(
        `SELECT s.sku, s."desc", s.category, s.uom, s.client_id,
                COALESCE(inv.total_qty,0)::float AS available_qty,
                similarity(s."desc", ref."desc")::float AS similarity_score,
                CASE
                  WHEN s.manufacturer_id = ref.manufacturer_id
                       AND ref.manufacturer_id IS NOT NULL THEN 'same_manufacturer'
                  WHEN similarity(s."desc", ref."desc") >= 0.85 THEN 'high_match'
                  ELSE 'auto'
                END AS match_type,
                mf.id   AS manufacturer_id,
                COALESCE(mf.name, s.manufacturer_code) AS manufacturer_name,
                mf.code AS manufacturer_code,
                s.manufacturer_sku, s.brand
           FROM master_skus s
           JOIN master_skus ref ON ref.sku = $1
           LEFT JOIN manufacturers mf ON mf.id = s.manufacturer_id
           LEFT JOIN (
             SELECT sku, SUM(qty) AS total_qty FROM inventory_lpns
              WHERE qty > 0 AND status = 'DISPONIBLE' GROUP BY sku
           ) inv ON inv.sku = s.sku
          WHERE ${conds.join(' AND ')}
          ORDER BY
            CASE WHEN s.manufacturer_id = ref.manufacturer_id
                      AND ref.manufacturer_id IS NOT NULL THEN 0 ELSE 1 END,
            similarity_score DESC,
            available_qty DESC
          LIMIT $3`,
        [sku, threshold, cfg.maxResults]
      );
    }

    // Combinar y rankear (manuales primero, luego autos)
    const combine = (row) => ({
      sku: row.sku, desc: row.desc, category: row.category, uom: row.uom,
      client_id: row.client_id,
      available_qty: parseFloat(row.available_qty) || 0,
      similarity_score: parseFloat(row.similarity_score) || 0,
      match_type: row.match_type,
      priority: row.priority || null,
      notes: row.notes || null,
      covers_deficit: deficit > 0 ? (parseFloat(row.available_qty) >= deficit) : true,
      manufacturer: (row.manufacturer_id || row.manufacturer_code) ? {
        id: row.manufacturer_id || null,
        code: row.manufacturer_code || null,
        name: row.manufacturer_name || null,
      } : null,
      manufacturer_sku: row.manufacturer_sku || null,
      brand: row.brand || null,
    });
    const substitutes = [
      ...manuals.rows.map(combine),
      ...autos.rows.map(combine),
    ];

    res.json({
      sku_original: sku,
      desc_original: ref.desc,
      qty_available: qtyAvailable,
      qty_requested: qty,
      deficit,
      substitutes_enabled: true,
      substitutes,
    });
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

// POST /api/skus/substitutes — upsert
router.post('/skus/substitutes', requireAdmin, async (req, res) => {
  const { sku_original, sku_subst, priority, notes, confirmed_by } = req.body || {};
  if (!sku_original || !sku_subst) return res.status(400).json({ error: 'sku_original y sku_subst son requeridos.' });
  if (sku_original === sku_subst) return res.status(400).json({ error: 'No se puede sustituir un SKU por sí mismo.' });
  try {
    const r = await pool.query(
      `INSERT INTO sku_substitutes (sku_original, sku_subst, priority, notes, confirmed_by)
         VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (sku_original, sku_subst) DO UPDATE SET
         priority     = EXCLUDED.priority,
         notes        = EXCLUDED.notes,
         confirmed_by = EXCLUDED.confirmed_by,
         confirmed_at = NOW()
       RETURNING *`,
      [String(sku_original).toUpperCase(), String(sku_subst).toUpperCase(),
       parseInt(priority) || 1, notes || null, confirmed_by || req.user.username]
    );
    res.json({ success: true, substitute: r.rows[0] });
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

// DELETE /api/skus/substitutes/:id
router.delete('/skus/substitutes/:id', requireAdmin, async (req, res) => {
  try {
    const r = await pool.query(`DELETE FROM sku_substitutes WHERE id = $1 RETURNING id`, [req.params.id]);
    if (!r.rowCount) return res.status(404).json({ error: 'Sustituto no encontrado' });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

module.exports = router;
