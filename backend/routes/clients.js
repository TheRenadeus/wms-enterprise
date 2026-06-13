// Clients router: CRUD básico de clientes 3PL.
// /clients/:id/portal (config de portal) y /client-tariffs siguen en server.js
// hasta su propio router de portal/tariffs.

const express = require('express');
const { pool, mapDbError } = require('../db');
const { requireAuth, requireAdmin } = require('../middleware');

const router = express.Router();

router.get('/clients', requireAuth, async (req, res) => {
  try {
    const { limit, offset = 0, search } = req.query;
    const conditions = [];
    const params = [];
    let idx = 1;
    if (search) { conditions.push(`(id ILIKE $${idx} OR name ILIKE $${idx})`); params.push(`%${search}%`); idx++; }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    let sql = `SELECT id, name, contact, email, portal_enabled, portal_email FROM clients ${where} ORDER BY name ASC`;
    if (limit !== undefined) {
      sql += ` LIMIT $${idx++} OFFSET $${idx++}`;
      params.push(Math.min(parseInt(limit) || 100, 5000), parseInt(offset) || 0);
    }
    res.json((await pool.query(sql, params)).rows);
  } catch (err) { res.status(500).json({ error: mapDbError(err) }); }
});

router.post('/clients', requireAdmin, async (req, res) => {
  const { id, name, contact, email } = req.body;
  if (!id || !name) return res.status(400).json({ error: 'ID y nombre del cliente son requeridos' });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Formato de email inválido' });
  try {
    const clientId = id.trim().toUpperCase();
    if (email && email.trim() !== '') {
      const emailDup = await pool.query(`SELECT id FROM clients WHERE email=$1 AND id<>$2 LIMIT 1`, [email.trim(), clientId]);
      if (emailDup.rows.length > 0)
        return res.status(409).json({ error: `El email '${email.trim()}' ya está registrado en el cliente '${emailDup.rows[0].id}'.` });
    }
    const existing = await pool.query('SELECT id FROM clients WHERE id=$1', [clientId]);
    const created = existing.rows.length === 0;
    await pool.query(`INSERT INTO clients (id, name, contact, email) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, contact=EXCLUDED.contact, email=EXCLUDED.email`, [clientId, name.trim(), contact || '', email || '']);
    res.json({ success: true, created, message: created ? 'Cliente creado correctamente' : 'Cliente actualizado correctamente' });
  } catch (err) { res.status(500).json({ error: mapDbError(err) }); }
});

router.delete('/clients/:id', requireAdmin, async (req, res) => {
  try {
    const skuCheck = await pool.query('SELECT COUNT(*) as count FROM master_skus WHERE client_id=$1', [req.params.id]);
    if (parseInt(skuCheck.rows[0].count) > 0)
      return res.status(400).json({ error: 'No se puede eliminar: el cliente tiene SKUs registrados en el maestro.' });
    const invCheck = await pool.query('SELECT COUNT(*) as count FROM inventory_lpns WHERE client_id=$1 AND qty>0', [req.params.id]);
    if (parseInt(invCheck.rows[0].count) > 0)
      return res.status(400).json({ error: 'No se puede eliminar: el cliente tiene stock físico activo en el inventario.' });
    const result = await pool.query('DELETE FROM clients WHERE id=$1', [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Cliente no encontrado' });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: mapDbError(err) }); }
});

module.exports = router;
