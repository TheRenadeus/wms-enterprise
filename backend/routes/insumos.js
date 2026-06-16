// Módulo INSUMOS — materiales propios de la bodega (globales, no por cliente).
// Fase 1: maestro de materiales (CRUD con borrado lógico).
const express = require('express');
const { pool, mapDbError, isUniqueViolation } = require('../db');
const { requireAuth, requireJefe } = require('../middleware');

const router = express.Router();

const CATEGORIAS = ['embalaje', 'etiquetado', 'pallets', 'epp', 'otros'];

// ── GET /insumos ── lista del maestro con su stock. Lectura para cualquier rol
// autenticado (AUDITOR incluido). ?all=1 incluye los desactivados.
router.get('/insumos', requireAuth, async (req, res) => {
  try {
    const incluirInactivos = req.query.all === '1' || req.query.all === 'true';
    const r = await pool.query(
      `SELECT i.*, COALESCE(s.cantidad, 0) AS stock_actual
         FROM insumos i
         LEFT JOIN insumo_stock s ON s.insumo_id = i.id
        ${incluirInactivos ? '' : 'WHERE i.activo = TRUE'}
        ORDER BY i.activo DESC, i.nombre ASC`
    );
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

// ── POST /insumos ── crear material (JEFE_BODEGA+). Crea fila de stock en 0.
router.post('/insumos', requireJefe, async (req, res) => {
  const { codigo, nombre, categoria, unidad, costo_unitario, stock_minimo } = req.body;
  if (!codigo || !String(codigo).trim()) return res.status(400).json({ error: 'El código es requerido.' });
  if (!nombre || !String(nombre).trim()) return res.status(400).json({ error: 'El nombre es requerido.' });
  const cat = CATEGORIAS.includes(categoria) ? categoria : 'otros';
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ins = await client.query(
      `INSERT INTO insumos (codigo, nombre, categoria, unidad, costo_unitario, stock_minimo, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [String(codigo).trim(), String(nombre).trim(), cat, (unidad || 'UN').trim(),
       parseFloat(costo_unitario) || 0, parseFloat(stock_minimo) || 0, req.user.username]
    );
    await client.query('INSERT INTO insumo_stock (insumo_id, cantidad) VALUES ($1, 0)', [ins.rows[0].id]);
    await client.query('COMMIT');
    res.json({ success: true, insumo: { ...ins.rows[0], stock_actual: 0 } });
  } catch (e) {
    await client.query('ROLLBACK');
    if (isUniqueViolation(e)) return res.status(409).json({ error: `Ya existe un insumo con el código '${codigo}'.` });
    res.status(500).json({ error: mapDbError(e) });
  } finally { client.release(); }
});

// ── PUT /insumos/:id ── editar material (JEFE_BODEGA+). No cambia el stock.
router.put('/insumos/:id', requireJefe, async (req, res) => {
  const { codigo, nombre, categoria, unidad, costo_unitario, stock_minimo, activo } = req.body;
  const cat = categoria !== undefined ? (CATEGORIAS.includes(categoria) ? categoria : 'otros') : undefined;
  try {
    const r = await pool.query(
      `UPDATE insumos SET
         codigo = COALESCE($2, codigo),
         nombre = COALESCE($3, nombre),
         categoria = COALESCE($4, categoria),
         unidad = COALESCE($5, unidad),
         costo_unitario = COALESCE($6, costo_unitario),
         stock_minimo = COALESCE($7, stock_minimo),
         activo = COALESCE($8, activo)
       WHERE id = $1 RETURNING *`,
      [req.params.id,
       codigo !== undefined ? String(codigo).trim() : null,
       nombre !== undefined ? String(nombre).trim() : null,
       cat ?? null,
       unidad !== undefined ? String(unidad).trim() : null,
       costo_unitario !== undefined ? parseFloat(costo_unitario) : null,
       stock_minimo !== undefined ? parseFloat(stock_minimo) : null,
       typeof activo === 'boolean' ? activo : null]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Insumo no encontrado.' });
    res.json({ success: true, insumo: r.rows[0] });
  } catch (e) {
    if (isUniqueViolation(e)) return res.status(409).json({ error: `Ya existe un insumo con el código '${codigo}'.` });
    res.status(500).json({ error: mapDbError(e) });
  }
});

// ── DELETE /insumos/:id ── borrado LÓGICO (activo=false), nunca físico.
router.delete('/insumos/:id', requireJefe, async (req, res) => {
  try {
    const r = await pool.query('UPDATE insumos SET activo = FALSE WHERE id = $1 RETURNING id', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Insumo no encontrado.' });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

module.exports = router;
