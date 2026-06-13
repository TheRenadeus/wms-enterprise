// Inventory + audit log router (lecturas paginadas).
// Las escrituras de inventario (adjust, change-status, receive_batch, etc) siguen
// en server.js hasta su propio router de operaciones.

const express = require('express');
const { pool, mapDbError, sendDbError } = require('../db');
const { requireAuth } = require('../middleware');
const { parsePagination, setPaginationHeaders } = require('../pagination');

const router = express.Router();

router.get('/inventory', requireAuth, async (req, res) => {
  try {
    const { sku, location_id, status, client_id } = req.query;
    const conditions = ['i.qty > 0'];
    const params = [];
    let idx = 1;
    if (sku)         { conditions.push(`i.sku ILIKE $${idx++}`);         params.push(`%${sku}%`); }
    if (location_id) { conditions.push(`i.location_id ILIKE $${idx++}`); params.push(`%${location_id}%`); }
    if (status)      { conditions.push(`i.status = $${idx++}`);          params.push(status); }
    if (client_id)   { conditions.push(`i.client_id = $${idx++}`);       params.push(client_id); }

    const { limit, offset } = parsePagination(req);
    const whereSql = conditions.join(' AND ');

    const [countRes, dataRes] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS n FROM inventory_lpns i WHERE ${whereSql}`, params),
      pool.query(
        `SELECT i.*, s."desc", s.uom, s.requires_lot, s.requires_serial
         FROM inventory_lpns i
         LEFT JOIN master_skus s ON i.sku = s.sku AND i.client_id = s.client_id
         WHERE ${whereSql}
         ORDER BY i.created_at DESC NULLS LAST, i.id DESC
         LIMIT $${idx++} OFFSET $${idx++}`,
        [...params, limit, offset]
      ),
    ]);
    setPaginationHeaders(res, { total: countRes.rows[0].n, limit, offset });
    res.json(dataRes.rows);
  } catch (err) { sendDbError(res, err); }
});

router.get('/audit', requireAuth, async (req, res) => {
  try {
    const { limit, offset } = parsePagination(req);
    const [countRes, dataRes] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS n FROM audit_log'),
      pool.query('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT $1 OFFSET $2', [limit, offset]),
    ]);
    setPaginationHeaders(res, { total: countRes.rows[0].n, limit, offset });
    res.json(dataRes.rows);
  } catch (err) { sendDbError(res, err); }
});

module.exports = router;
