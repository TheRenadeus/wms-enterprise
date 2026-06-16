// Módulo INSUMOS — materiales propios de la bodega (globales, no por cliente).
// Fase 1: maestro de materiales (CRUD con borrado lógico).
const express = require('express');
const { pool, mapDbError, isUniqueViolation } = require('../db');
const { requireAuth, requireJefe, requireStockWrite } = require('../middleware');

const router = express.Router();

const CATEGORIAS = ['embalaje', 'etiquetado', 'pallets', 'epp', 'otros'];

// Aplica un movimiento de stock dentro de una transacción YA ABIERTA (client).
// delta: +entrada / -consumo / signed en ajuste. Bloquea la fila de stock con
// FOR UPDATE para que stock_antes/despues sean exactos bajo concurrencia y nunca
// quede negativo. Devuelve el resumen { tipo, insumo, cantidad, stock_antes, stock_despues }.
async function aplicarMovimiento(client, { insumoId, tipo, delta, meta = {} }) {
  const ins = await client.query('SELECT id, codigo, nombre, unidad, activo FROM insumos WHERE id = $1', [insumoId]);
  if (!ins.rows.length) { const e = new Error('Insumo no encontrado.'); e.status = 404; throw e; }
  if (!ins.rows[0].activo) { const e = new Error('El insumo está desactivado.'); e.status = 400; throw e; }
  // Bloquea (o crea) la fila de stock.
  let lock = await client.query('SELECT cantidad FROM insumo_stock WHERE insumo_id = $1 FOR UPDATE', [insumoId]);
  if (!lock.rows.length) {
    await client.query('INSERT INTO insumo_stock (insumo_id, cantidad) VALUES ($1, 0) ON CONFLICT DO NOTHING', [insumoId]);
    lock = await client.query('SELECT cantidad FROM insumo_stock WHERE insumo_id = $1 FOR UPDATE', [insumoId]);
  }
  const antes = parseFloat(lock.rows[0].cantidad);
  const despues = antes + delta;
  if (despues < 0) { const e = new Error(`Stock insuficiente: disponible ${antes}, se intentó descontar ${Math.abs(delta)}.`); e.status = 409; throw e; }
  await client.query('UPDATE insumo_stock SET cantidad = $2, updated_at = NOW() WHERE insumo_id = $1', [insumoId, despues]);
  await client.query(
    `INSERT INTO insumo_movimientos (insumo_id, tipo, cantidad, stock_antes, stock_despues, documento_tipo, documento_id, client_id, usuario)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [insumoId, tipo, Math.abs(delta), antes, despues, meta.documento_tipo || null, meta.documento_id || null, meta.client_id || null, meta.usuario || null]
  );
  return {
    tipo,
    insumo: { id: ins.rows[0].id, codigo: ins.rows[0].codigo, nombre: ins.rows[0].nombre, unidad: ins.rows[0].unidad },
    cantidad: Math.abs(delta),
    stock_antes: antes,
    stock_despues: despues,
  };
}

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

// ── POST /insumos/:id/entrada ── reposición (+stock). JEFE_BODEGA+.
router.post('/insumos/:id/entrada', requireJefe, async (req, res) => {
  const cantidad = parseFloat(req.body.cantidad);
  if (!(cantidad > 0)) return res.status(400).json({ error: 'La cantidad debe ser mayor a 0.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await aplicarMovimiento(client, { insumoId: req.params.id, tipo: 'entrada', delta: cantidad, meta: { usuario: req.user.username } });
    await client.query('COMMIT');
    res.json({ success: true, resumen: out });
  } catch (e) { await client.query('ROLLBACK'); res.status(e.status || 500).json({ error: e.message || mapDbError(e) }); }
  finally { client.release(); }
});

// ── POST /insumos/:id/ajuste ── recuento: fija el stock a nueva_cantidad. JEFE_BODEGA+.
router.post('/insumos/:id/ajuste', requireJefe, async (req, res) => {
  const nueva = parseFloat(req.body.nueva_cantidad);
  if (isNaN(nueva) || nueva < 0) return res.status(400).json({ error: 'La nueva cantidad debe ser 0 o mayor.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query('SELECT cantidad FROM insumo_stock WHERE insumo_id = $1 FOR UPDATE', [req.params.id]);
    const antes = cur.rows.length ? parseFloat(cur.rows[0].cantidad) : 0;
    const out = await aplicarMovimiento(client, { insumoId: req.params.id, tipo: 'ajuste', delta: nueva - antes, meta: { usuario: req.user.username } });
    await client.query('COMMIT');
    res.json({ success: true, resumen: out });
  } catch (e) { await client.query('ROLLBACK'); res.status(e.status || 500).json({ error: e.message || mapDbError(e) }); }
  finally { client.release(); }
});

// ── POST /insumos/:id/consumo ── consumo genérico (-stock). EJECUTIVO_CUENTA+.
// (El consumo LIGADO a un documento/cliente se agrega en la Fase 4.)
router.post('/insumos/:id/consumo', requireStockWrite, async (req, res) => {
  const cantidad = parseFloat(req.body.cantidad);
  if (!(cantidad > 0)) return res.status(400).json({ error: 'La cantidad debe ser mayor a 0.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await aplicarMovimiento(client, { insumoId: req.params.id, tipo: 'consumo', delta: -cantidad, meta: { usuario: req.user.username } });
    await client.query('COMMIT');
    res.json({ success: true, resumen: out });
  } catch (e) { await client.query('ROLLBACK'); res.status(e.status || 500).json({ error: e.message || mapDbError(e) }); }
  finally { client.release(); }
});

// ── GET /insumos/:id/movimientos ── historial de un insumo.
router.get('/insumos/:id/movimientos', requireAuth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT * FROM insumo_movimientos WHERE insumo_id = $1 ORDER BY fecha DESC LIMIT 200`, [req.params.id]
    );
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

module.exports = router;
// Se expone el helper para reutilizarlo en el consumo ligado a documentos (Fase 4).
module.exports.aplicarMovimiento = aplicarMovimiento;
