// Fabricantes: CRUD con soft-delete y validación de stock vinculado.
const express = require('express');
const { pool, mapDbError } = require('../db');
const { requireAuth, requireAdmin } = require('../middleware');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// GET /api/manufacturers?search=texto&include_inactive=false
router.get('/manufacturers', requireAuth, async (req, res) => {
  const { search, include_inactive } = req.query;
  try {
    const params = [];
    const conds = [];
    if (!include_inactive || include_inactive === 'false') conds.push(`active = TRUE`);
    if (search && search.trim()) {
      params.push(`%${search.trim()}%`);
      conds.push(`(name ILIKE $${params.length} OR code ILIKE $${params.length})`);
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const r = await pool.query(
      `SELECT m.*,
              (SELECT COUNT(*)::int FROM master_skus s WHERE s.manufacturer_id = m.id) AS sku_count
         FROM manufacturers m ${where} ORDER BY name ASC`,
      params
    );
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

// GET /api/manufacturers/:id (con SKUs vinculados y stock)
router.get('/manufacturers/:id', requireAuth, async (req, res) => {
  try {
    const mfr = await pool.query(`SELECT * FROM manufacturers WHERE id = $1`, [req.params.id]);
    if (!mfr.rows.length) return res.status(404).json({ error: 'Fabricante no encontrado' });
    const skus = await pool.query(
      `SELECT s.sku, s."desc", s.category, s.uom, s.client_id,
              s.manufacturer_sku, s.brand,
              COALESCE(inv.total_qty, 0)::float AS stock
         FROM master_skus s
         LEFT JOIN (
           SELECT sku, SUM(qty) AS total_qty FROM inventory_lpns
            WHERE qty > 0 GROUP BY sku
         ) inv ON inv.sku = s.sku
        WHERE s.manufacturer_id = $1
        ORDER BY s.sku ASC`,
      [req.params.id]
    );
    res.json({ ...mfr.rows[0], skus: skus.rows });
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

// POST /api/manufacturers
router.post('/manufacturers', requireAdmin, async (req, res) => {
  let { code, name, country, contact, email, phone, website, notes } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'El nombre es requerido' });
  if (email && !EMAIL_RE.test(String(email).trim())) return res.status(400).json({ error: 'Email inválido' });
  name = String(name).trim();
  try {
    // Auto-generar code si llega vacío
    if (!code || !String(code).trim()) {
      const last = await pool.query(
        `SELECT code FROM manufacturers WHERE code ~ '^FAB-[0-9]+$'
         ORDER BY (regexp_replace(code,'[^0-9]','','g'))::int DESC LIMIT 1`
      );
      let nextN = 1;
      if (last.rows[0]) {
        const m = /FAB-(\d+)/.exec(last.rows[0].code);
        if (m) nextN = parseInt(m[1]) + 1;
      }
      code = `FAB-${String(nextN).padStart(3, '0')}`;
    } else {
      code = String(code).trim().toUpperCase();
    }
    // Verificar unicidad
    const dup = await pool.query(`SELECT id FROM manufacturers WHERE code = $1`, [code]);
    if (dup.rows.length) return res.status(409).json({ error: `Ya existe un fabricante con código '${code}'.` });

    const r = await pool.query(
      `INSERT INTO manufacturers (code, name, country, contact, email, phone, website, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [code, name, country || null, contact || null, email || null, phone || null, website || null, notes || null]
    );
    res.json({ success: true, manufacturer: r.rows[0] });
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

// PUT /api/manufacturers/:id
router.put('/manufacturers/:id', requireAdmin, async (req, res) => {
  const { code, name, country, contact, email, phone, website, notes, active } = req.body || {};
  if (email && !EMAIL_RE.test(String(email).trim())) return res.status(400).json({ error: 'Email inválido' });
  try {
    const cur = await pool.query(`SELECT * FROM manufacturers WHERE id=$1`, [req.params.id]);
    if (!cur.rows.length) return res.status(404).json({ error: 'Fabricante no encontrado' });
    const newCode = code ? String(code).trim().toUpperCase() : cur.rows[0].code;
    if (newCode !== cur.rows[0].code) {
      const dup = await pool.query(`SELECT id FROM manufacturers WHERE code=$1 AND id<>$2`, [newCode, req.params.id]);
      if (dup.rows.length) return res.status(409).json({ error: `Ya existe un fabricante con código '${newCode}'.` });
    }
    await pool.query(
      `UPDATE manufacturers
          SET code=$1, name=$2, country=$3, contact=$4, email=$5,
              phone=$6, website=$7, notes=$8,
              active=COALESCE($9, active)
        WHERE id=$10`,
      [newCode, (name && String(name).trim()) || cur.rows[0].name,
       country ?? cur.rows[0].country, contact ?? cur.rows[0].contact,
       email ?? cur.rows[0].email, phone ?? cur.rows[0].phone,
       website ?? cur.rows[0].website, notes ?? cur.rows[0].notes,
       typeof active === 'boolean' ? active : null,
       req.params.id]
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

// DELETE /api/manufacturers/:id — soft delete con bloqueo si tiene stock
router.delete('/manufacturers/:id', requireAdmin, async (req, res) => {
  try {
    const stockRow = await pool.query(
      `SELECT COUNT(*)::int AS n
         FROM master_skus m
         JOIN inventory_lpns i ON i.sku = m.sku
        WHERE m.manufacturer_id = $1 AND i.qty > 0`,
      [req.params.id]
    );
    if (stockRow.rows[0].n > 0) {
      return res.status(409).json({
        error: 'El fabricante tiene SKUs con stock activo. Despache o transfiera el stock antes de desactivar.'
      });
    }
    const r = await pool.query(`UPDATE manufacturers SET active=FALSE WHERE id=$1 RETURNING id`, [req.params.id]);
    if (!r.rowCount) return res.status(404).json({ error: 'Fabricante no encontrado' });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

module.exports = router;
