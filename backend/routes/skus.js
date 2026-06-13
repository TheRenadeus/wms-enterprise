// SKUs router: GET /skus paginado + /bootstrap (consolidado).
// POST/DELETE /skus siguen en server.js (mover en próximo paso).

const express = require('express');
const { pool, mapDbError } = require('../db');
const { requireAuth } = require('../middleware');
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
      const where = scope.conditions.length ? `WHERE ${scope.conditions.join(' AND ')}` : '';
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

module.exports = router;
