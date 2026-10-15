// Inventory + audit log router (lecturas paginadas).
// Las escrituras de inventario (adjust, change-status, receive_batch, etc) siguen
// en server.js hasta su propio router de operaciones.

const express = require('express');
const { pool, mapDbError, sendDbError } = require('../db');
const { requireAuth } = require('../middleware');
const { parsePagination, setPaginationHeaders } = require('../pagination');
const { scopeCondition, auditScopeCondition } = require('../scope');

const router = express.Router();

router.get('/inventory', requireAuth, async (req, res) => {
  try {
    const { sku, location_id, status, client_id } = req.query;
    const conditions = ['i.qty > 0'];
    const params = [];
    if (sku)         { params.push(`%${sku}%`);         conditions.push(`i.sku ILIKE $${params.length}`); }
    if (location_id) { params.push(`%${location_id}%`); conditions.push(`i.location_id ILIKE $${params.length}`); }
    if (status)      { params.push(status);             conditions.push(`i.status = $${params.length}`); }
    if (client_id)   { params.push(client_id);          conditions.push(`i.client_id = $${params.length}`); }
    // Siempre dentro del alcance del usuario, venga o no client_id.
    conditions.push(scopeCondition(req.clientScope, 'i.client_id', params));
    let idx = params.length + 1;

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
    const params = [];
    const where = auditScopeCondition(req.clientScope, 'al', params);
    const [countRes, dataRes] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS n FROM audit_log al WHERE ${where}`, params),
      pool.query(
        `SELECT al.* FROM audit_log al WHERE ${where}
          ORDER BY al.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset],
      ),
    ]);
    setPaginationHeaders(res, { total: countRes.rows[0].n, limit, offset });
    res.json(dataRes.rows);
  } catch (err) { sendDbError(res, err); }
});

module.exports = router;
