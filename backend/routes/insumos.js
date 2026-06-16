// Módulo INSUMOS — materiales propios de la bodega (globales, no por cliente).
// Fase 1: maestro de materiales (CRUD con borrado lógico).
const express = require('express');
const { pool, mapDbError, isUniqueViolation } = require('../db');
const { requireAuth, requireJefe, requireStockWrite, getClientesPermitidos } = require('../middleware');

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

// ── GET /insumos/documentos ── busca despachos/recepciones CONFIRMADOS por número
// O por cliente (parcial, case-insensitive), filtrable por tipo. Respeta scope:
// EJECUTIVO_CUENTA solo ve documentos de sus clientes asignados; JEFE/ADMIN todos.
router.get('/insumos/documentos', requireAuth, async (req, res) => {
  const { tipo, q } = req.query;
  try {
    const conds = ["dh.status = 'ACTIVO'", "dh.module IN ('receive','dispatch')"];
    const params = [];
    let idx = 1;
    if (tipo === 'dispatch' || tipo === 'receive') { conds.push(`dh.module = $${idx++}`); params.push(tipo); }
    if (q && String(q).trim()) {
      conds.push(`(dh.doc_num ILIKE $${idx} OR dh.client_id ILIKE $${idx} OR c.name ILIKE $${idx})`);
      params.push(`%${String(q).trim()}%`); idx++;
    }
    // Scope por cliente (no admin): limitar a clientes asignados.
    if (!['ADMIN', 'SUPERADMIN'].includes(req.user.role) && !req.user.is_demo) {
      const perm = await getClientesPermitidos(req.user.username);
      if (perm.scope === 'none') return res.json([]);
      if (perm.scope === 'assigned') {
        if (!perm.clients.length) return res.json([]);
        conds.push(`dh.client_id = ANY($${idx++})`); params.push(perm.clients);
      }
    }
    params.push(50);
    const r = await pool.query(
      `SELECT dh.id, dh.module, dh.doc_num, dh.doc_type, dh.client_id,
              COALESCE(c.name, dh.client_id) AS client_name, dh.created_at, dh.status, dh.total_qty
         FROM document_history dh
         LEFT JOIN clients c ON c.id = dh.client_id
        WHERE ${conds.join(' AND ')}
        ORDER BY dh.created_at DESC LIMIT $${idx}`,
      params
    );
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

// ── Helpers de la Fase 4 ──
const TIPO_MODULE = { dispatch: 'dispatch', receive: 'receive' };
// ¿El usuario puede operar el cliente del documento? (scope)
async function userCanAccessClient(req, clientId) {
  if (['ADMIN', 'SUPERADMIN'].includes(req.user.role) || req.user.is_demo) return true;
  const perm = await getClientesPermitidos(req.user.username);
  if (perm.scope === 'all') return true;
  if (perm.scope === 'none') return false;
  return perm.clients.includes(clientId) || perm.clients.includes(String(clientId || '').toUpperCase());
}
// ¿El documento (por su cliente y fecha) ya quedó facturado? Bloquea el reintegro.
async function documentoFacturado(db, clientId, fecha) {
  if (!clientId) return false;
  const r = await db.query(
    `SELECT 1 FROM invoices WHERE client_id = $1 AND $2::timestamp BETWEEN period_start AND period_end LIMIT 1`,
    [clientId, fecha]
  );
  return r.rows.length > 0;
}

// ── POST /documentos/:tipo/:id/insumos ── asocia consumo de insumos a un documento
// CONFIRMADO. Descuenta stock (sin negativo) y liga el movimiento al doc + cliente.
// EJECUTIVO_CUENTA+ y solo sobre clientes de su scope.
router.post('/documentos/:tipo/:id/insumos', requireStockWrite, async (req, res) => {
  const { tipo, id } = req.params;
  const lineas = Array.isArray(req.body.lineas) ? req.body.lineas : (Array.isArray(req.body) ? req.body : []);
  if (!TIPO_MODULE[tipo]) return res.status(400).json({ error: 'Tipo de documento inválido (dispatch|receive).' });
  if (!lineas.length) return res.status(400).json({ error: 'Debe indicar al menos un insumo.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const doc = await client.query('SELECT id, client_id, status FROM document_history WHERE id = $1 AND module = $2', [id, TIPO_MODULE[tipo]]);
    if (!doc.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Documento no encontrado.' }); }
    if (doc.rows[0].status !== 'ACTIVO') { await client.query('ROLLBACK'); return res.status(400).json({ error: 'El documento no está confirmado (ACTIVO).' }); }
    const docClientId = doc.rows[0].client_id;
    if (!(await userCanAccessClient(req, docClientId))) { await client.query('ROLLBACK'); return res.status(403).json({ error: `No tienes permiso para operar con el cliente ${docClientId}.` }); }
    const resumenes = [];
    for (const l of lineas) {
      const cantidad = parseFloat(l.cantidad);
      if (!l.insumo_id || !(cantidad > 0)) throw Object.assign(new Error('Línea inválida: insumo y cantidad > 0.'), { status: 400 });
      const out = await aplicarMovimiento(client, {
        insumoId: l.insumo_id, tipo: 'consumo', delta: -cantidad,
        meta: { documento_tipo: tipo, documento_id: id, client_id: docClientId, usuario: req.user.username },
      });
      resumenes.push(out);
    }
    await client.query('COMMIT');
    res.json({ success: true, documento: { tipo, id, client_id: docClientId }, resumenes });
  } catch (e) { await client.query('ROLLBACK'); res.status(e.status || 500).json({ error: e.message || mapDbError(e) }); }
  finally { client.release(); }
});

// ── GET /documentos/:tipo/:id/insumos ── insumos ya asociados a un documento.
router.get('/documentos/:tipo/:id/insumos', requireAuth, async (req, res) => {
  const { tipo, id } = req.params;
  try {
    const r = await pool.query(
      `SELECT m.id, m.insumo_id, m.cantidad, m.fecha, m.usuario, m.client_id,
              i.codigo, i.nombre, i.unidad, i.costo_unitario
         FROM insumo_movimientos m
         JOIN insumos i ON i.id = m.insumo_id
        WHERE m.tipo = 'consumo' AND m.documento_tipo = $1 AND m.documento_id = $2
        ORDER BY m.fecha DESC`,
      [tipo, id]
    );
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

// ── DELETE /documentos/:tipo/:id/insumos/:movId ── quita una línea de consumo y
// REINTEGRA el stock. Solo si el documento NO está facturado. EJECUTIVO_CUENTA+ (scope).
router.delete('/documentos/:tipo/:id/insumos/:movId', requireStockWrite, async (req, res) => {
  const { tipo, id, movId } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const mov = await client.query(
      `SELECT m.id, m.insumo_id, m.cantidad, m.client_id, dh.created_at
         FROM insumo_movimientos m
         LEFT JOIN document_history dh ON dh.id = m.documento_id
        WHERE m.id = $1 AND m.tipo = 'consumo' AND m.documento_tipo = $2 AND m.documento_id = $3 FOR UPDATE`,
      [movId, tipo, id]
    );
    if (!mov.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Línea de consumo no encontrada.' }); }
    const row = mov.rows[0];
    if (!(await userCanAccessClient(req, row.client_id))) { await client.query('ROLLBACK'); return res.status(403).json({ error: 'Sin permiso sobre el cliente del documento.' }); }
    if (await documentoFacturado(client, row.client_id, row.created_at)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'El documento ya está facturado; no se puede quitar el consumo.' });
    }
    // Reintegrar stock (lock de la fila) y borrar la línea.
    const lock = await client.query('SELECT cantidad FROM insumo_stock WHERE insumo_id = $1 FOR UPDATE', [row.insumo_id]);
    const antes = lock.rows.length ? parseFloat(lock.rows[0].cantidad) : 0;
    await client.query('UPDATE insumo_stock SET cantidad = $2, updated_at = NOW() WHERE insumo_id = $1', [row.insumo_id, antes + parseFloat(row.cantidad)]);
    await client.query('DELETE FROM insumo_movimientos WHERE id = $1', [movId]);
    await client.query('COMMIT');
    res.json({ success: true, reintegrado: parseFloat(row.cantidad), stock_despues: antes + parseFloat(row.cantidad) });
  } catch (e) { await client.query('ROLLBACK'); res.status(e.status || 500).json({ error: e.message || mapDbError(e) }); }
  finally { client.release(); }
});

// ── GET /insumos/alertas ── insumos activos con stock por debajo del mínimo.
router.get('/insumos/alertas', requireAuth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT i.id, i.codigo, i.nombre, i.unidad, i.stock_minimo, COALESCE(s.cantidad,0) AS stock_actual
         FROM insumos i LEFT JOIN insumo_stock s ON s.insumo_id = i.id
        WHERE i.activo = TRUE AND COALESCE(s.cantidad,0) < i.stock_minimo
        ORDER BY (i.stock_minimo - COALESCE(s.cantidad,0)) DESC`
    );
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

// ── GET /insumos/reportes/consumo?from=&to= ── detalle de consumos en el período
// (con costo = cantidad × costo_unitario), respetando scope. El frontend agrupa
// por insumo / por cliente y exporta.
router.get('/insumos/reportes/consumo', requireAuth, async (req, res) => {
  const { from, to } = req.query;
  try {
    const conds = ["m.tipo = 'consumo'"];
    const params = [];
    let idx = 1;
    if (from) { conds.push(`m.fecha >= $${idx++}`); params.push(from); }
    if (to)   { conds.push(`m.fecha <= $${idx++}`); params.push(to + 'T23:59:59'); }
    if (!['ADMIN', 'SUPERADMIN'].includes(req.user.role) && !req.user.is_demo) {
      const perm = await getClientesPermitidos(req.user.username);
      if (perm.scope === 'none') return res.json([]);
      if (perm.scope === 'assigned') {
        if (!perm.clients.length) return res.json([]);
        conds.push(`m.client_id = ANY($${idx++})`); params.push(perm.clients);
      }
    }
    const r = await pool.query(
      `SELECT m.id, m.fecha, m.cantidad, m.documento_tipo, m.documento_id, m.client_id, m.usuario,
              i.codigo, i.nombre, i.unidad, i.costo_unitario,
              (m.cantidad * i.costo_unitario) AS costo,
              COALESCE(c.name, m.client_id) AS client_name
         FROM insumo_movimientos m
         JOIN insumos i ON i.id = m.insumo_id
         LEFT JOIN clients c ON c.id = m.client_id
        WHERE ${conds.join(' AND ')}
        ORDER BY m.fecha DESC LIMIT 5000`,
      params
    );
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

module.exports = router;
// Se expone el helper para reutilizarlo en el consumo ligado a documentos (Fase 4).
module.exports.aplicarMovimiento = aplicarMovimiento;
