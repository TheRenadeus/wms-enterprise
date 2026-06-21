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
  const movIns = await client.query(
    `INSERT INTO insumo_movimientos (insumo_id, tipo, cantidad, stock_antes, stock_despues, documento_tipo, documento_id, client_id, usuario, fecha)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, COALESCE($10::timestamp, NOW())) RETURNING fecha`,
    [insumoId, tipo, Math.abs(delta), antes, despues, meta.documento_tipo || null, meta.documento_id || null, meta.client_id || null, meta.usuario || null, meta.fecha || null]
  );
  return {
    tipo,
    insumo: { id: ins.rows[0].id, codigo: ins.rows[0].codigo, nombre: ins.rows[0].nombre, unidad: ins.rows[0].unidad },
    cantidad: Math.abs(delta),
    stock_antes: antes,
    stock_despues: despues,
    fecha: movIns.rows[0].fecha,
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
  const { codigo, nombre, categoria, unidad, costo_unitario, stock_minimo, lead_time_dias } = req.body;
  if (!codigo || !String(codigo).trim()) return res.status(400).json({ error: 'El código es requerido.' });
  if (!nombre || !String(nombre).trim()) return res.status(400).json({ error: 'El nombre es requerido.' });
  const cat = CATEGORIAS.includes(categoria) ? categoria : 'otros';
  // lead_time_dias es opcional: vacío/null = sin definir; si viene, entero >= 0.
  const lead = (lead_time_dias === undefined || lead_time_dias === null || lead_time_dias === '') ? null : parseInt(lead_time_dias);
  if (lead !== null && (isNaN(lead) || lead < 0)) return res.status(400).json({ error: 'El tiempo de reposición (días) debe ser un entero ≥ 0.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ins = await client.query(
      `INSERT INTO insumos (codigo, nombre, categoria, unidad, costo_unitario, stock_minimo, lead_time_dias, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [String(codigo).trim(), String(nombre).trim(), cat, (unidad || 'UN').trim(),
       parseFloat(costo_unitario) || 0, parseFloat(stock_minimo) || 0, lead, req.user.username]
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
  const { codigo, nombre, categoria, unidad, costo_unitario, stock_minimo, activo, lead_time_dias } = req.body;
  const cat = categoria !== undefined ? (CATEGORIAS.includes(categoria) ? categoria : 'otros') : undefined;
  // lead_time_dias opcional: '' o null lo limpia (NULL); un número lo fija (entero ≥ 0).
  let lead; // undefined = no tocar
  if (lead_time_dias !== undefined) {
    if (lead_time_dias === null || lead_time_dias === '') lead = null;
    else { lead = parseInt(lead_time_dias); if (isNaN(lead) || lead < 0) return res.status(400).json({ error: 'El tiempo de reposición (días) debe ser un entero ≥ 0.' }); }
  }
  try {
    const r = await pool.query(
      `UPDATE insumos SET
         codigo = COALESCE($2, codigo),
         nombre = COALESCE($3, nombre),
         categoria = COALESCE($4, categoria),
         unidad = COALESCE($5, unidad),
         costo_unitario = COALESCE($6, costo_unitario),
         stock_minimo = COALESCE($7, stock_minimo),
         activo = COALESCE($8, activo),
         lead_time_dias = CASE WHEN $10::boolean THEN $9 ELSE lead_time_dias END
       WHERE id = $1 RETURNING *`,
      [req.params.id,
       codigo !== undefined ? String(codigo).trim() : null,
       nombre !== undefined ? String(nombre).trim() : null,
       cat ?? null,
       unidad !== undefined ? String(unidad).trim() : null,
       costo_unitario !== undefined ? parseFloat(costo_unitario) : null,
       stock_minimo !== undefined ? parseFloat(stock_minimo) : null,
       typeof activo === 'boolean' ? activo : null,
       lead ?? null,                       // $9: valor (NULL incluido)
       lead_time_dias !== undefined]       // $10: ¿se debe actualizar el campo?
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
  // Fecha de ingreso OPCIONAL: permite registrar una entrada con fecha real (no la
  // de captura). Si no viene, queda NOW(). No se admite fecha futura.
  let fecha = null;
  if (req.body.fecha) {
    const d = new Date(req.body.fecha);
    if (isNaN(d.getTime())) return res.status(400).json({ error: 'La fecha de ingreso no es válida.' });
    if (d.getTime() > Date.now() + 60000) return res.status(400).json({ error: 'La fecha de ingreso no puede ser futura.' });
    fecha = d.toISOString();
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await aplicarMovimiento(client, { insumoId: req.params.id, tipo: 'entrada', delta: cantidad, meta: { usuario: req.user.username, fecha } });
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
        WHERE m.tipo = 'consumo' AND m.documento_tipo = $1 AND m.documento_id = $2 AND m.anulado = FALSE
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
        WHERE m.id = $1 AND m.tipo = 'consumo' AND m.documento_tipo = $2 AND m.documento_id = $3 AND m.anulado = FALSE FOR UPDATE OF m`,
      [movId, tipo, id]
    );
    if (!mov.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Línea de consumo no encontrada.' }); }
    const row = mov.rows[0];
    if (!(await userCanAccessClient(req, row.client_id))) { await client.query('ROLLBACK'); return res.status(403).json({ error: 'Sin permiso sobre el cliente del documento.' }); }
    if (await documentoFacturado(client, row.client_id, row.created_at)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'El documento ya está facturado; no se puede quitar el consumo.' });
    }
    // Reintegrar stock (lock de la fila) y ANULAR la línea (no se borra: queda en el
    // histórico con su marca de anulación para conservar la trazabilidad).
    const lock = await client.query('SELECT cantidad FROM insumo_stock WHERE insumo_id = $1 FOR UPDATE', [row.insumo_id]);
    const antes = lock.rows.length ? parseFloat(lock.rows[0].cantidad) : 0;
    await client.query('UPDATE insumo_stock SET cantidad = $2, updated_at = NOW() WHERE insumo_id = $1', [row.insumo_id, antes + parseFloat(row.cantidad)]);
    await client.query('UPDATE insumo_movimientos SET anulado = TRUE, anulado_at = NOW(), anulado_by = $2 WHERE id = $1', [movId, req.user.username]);
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
    const conds = ["m.tipo = 'consumo'", 'm.anulado = FALSE'];
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
              COALESCE(c.name, m.client_id) AS client_name,
              dh.doc_num, dh.doc_type
         FROM insumo_movimientos m
         JOIN insumos i ON i.id = m.insumo_id
         LEFT JOIN clients c ON c.id = m.client_id
         LEFT JOIN document_history dh ON dh.id = m.documento_id
        WHERE ${conds.join(' AND ')}
        ORDER BY m.fecha DESC LIMIT 5000`,
      params
    );
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

// ════════════════ ANÁLISIS DE INVENTARIO (solo lectura) ════════════════
// Vista derivada de los movimientos de consumo ya registrados. No escribe nada.
// Permiso: cualquier staff autenticado EXCEPTO CLIENTE (AUDITOR sí, es solo lectura).
// Para roles no-admin se aplica el mismo scope por cliente que /reportes/consumo.
const denyCliente = (req, res, next) => {
  if (req.user?.role === 'CLIENTE') return res.status(403).json({ error: 'Tu rol no tiene acceso al análisis de inventario.' });
  next();
};

// Resuelve el scope de clientes del usuario. Devuelve:
//   { block:true }              → no debe ver nada (responder vacío)
//   { clients:[...] }           → limitar a estos client_id (scope 'assigned')
//   {}                          → sin límite (admin / demo / scope 'all')
async function scopeClientes(req) {
  if (['ADMIN', 'SUPERADMIN'].includes(req.user.role) || req.user.is_demo) return {};
  const perm = await getClientesPermitidos(req.user.username);
  if (perm.scope === 'all') return {};
  if (perm.scope === 'none') return { block: true };
  if (!perm.clients.length) return { block: true };
  return { clients: perm.clients };
}

// ── GET /insumos/analisis?dias=30&client_id=&umbral_dias=15 ──
// Resumen por insumo + KPIs del período. Agregación (SUM/GROUP BY) en SQL.
router.get('/insumos/analisis', requireAuth, denyCliente, async (req, res) => {
  const dias = Math.min(Math.max(parseInt(req.query.dias) || 30, 1), 365);
  const umbral = Math.min(Math.max(parseInt(req.query.umbral_dias) || 15, 1), 365);
  const clientId = req.query.client_id ? String(req.query.client_id).trim() : null;
  try {
    const sc = await scopeClientes(req);
    if (sc.block) return res.json({ periodo: { dias, umbral_dias: umbral, client_id: clientId }, kpis: { en_riesgo: 0, consumo_total_periodo: 0, insumo_mas_consumido: null }, items: [] });

    // $1=dias, $2=umbral; los opcionales empiezan en $3.
    const params = [dias, umbral];
    let idx = 3;
    const cc = ["m.tipo = 'consumo'", 'm.anulado = FALSE', `m.fecha >= NOW() - ($1::int * INTERVAL '1 day')`];
    if (clientId) { cc.push(`m.client_id = $${idx++}`); params.push(clientId); }
    if (sc.clients) { cc.push(`m.client_id = ANY($${idx++})`); params.push(sc.clients); }

    const sql = `
      WITH consumo AS (
        SELECT m.insumo_id, SUM(m.cantidad) AS consumo_total
          FROM insumo_movimientos m
         WHERE ${cc.join(' AND ')}
         GROUP BY m.insumo_id
      ),
      base AS (
        SELECT i.id, i.codigo, i.nombre, i.unidad, i.categoria,
               i.costo_unitario, i.stock_minimo, i.lead_time_dias,
               COALESCE(s.cantidad,0)::numeric          AS stock_actual,
               COALESCE(c.consumo_total,0)::numeric     AS consumo_total_periodo,
               (COALESCE(c.consumo_total,0)::numeric / $1::numeric) AS consumo_prom_diario
          FROM insumos i
          LEFT JOIN insumo_stock s ON s.insumo_id = i.id
          LEFT JOIN consumo c      ON c.insumo_id = i.id
         WHERE i.activo = TRUE
      ),
      calc AS (
        SELECT b.*,
               CASE WHEN consumo_prom_diario > 0 THEN stock_actual / consumo_prom_diario END AS dias_cobertura,
               CASE WHEN consumo_prom_diario > 0
                    THEN COALESCE(lead_time_dias::numeric, stock_minimo / consumo_prom_diario) END AS umbral_critico
          FROM base b
      )
      SELECT id, codigo, nombre, unidad, categoria, costo_unitario, stock_minimo, lead_time_dias,
             stock_actual, consumo_total_periodo,
             ROUND(consumo_prom_diario, 3) AS consumo_prom_diario,
             CASE WHEN dias_cobertura IS NOT NULL THEN ROUND(dias_cobertura, 1) END AS dias_cobertura,
             CASE WHEN dias_cobertura IS NOT NULL
                  THEN (CURRENT_DATE + LEAST(FLOOR(dias_cobertura), 3650)::int) END AS quiebre_estimado,
             CASE
               WHEN consumo_prom_diario = 0       THEN 'ok'
               WHEN dias_cobertura <= umbral_critico THEN 'critico'
               WHEN dias_cobertura <= $2::numeric    THEN 'por_quebrar'
               ELSE 'ok'
             END AS estado
        FROM calc
       ORDER BY
         CASE WHEN consumo_prom_diario = 0 THEN 2
              WHEN dias_cobertura <= umbral_critico THEN 0
              WHEN dias_cobertura <= $2::numeric THEN 1 ELSE 2 END,
         dias_cobertura ASC NULLS LAST, nombre ASC`;

    const r = await pool.query(sql, params);
    const items = r.rows;
    // KPIs derivados del resultado (conjunto pequeño: 1 fila por insumo activo).
    const enRiesgo = items.filter(i => i.estado === 'critico' || i.estado === 'por_quebrar').length;
    const consumoTotal = items.reduce((s, i) => s + parseFloat(i.consumo_total_periodo || 0), 0);
    const top = items.reduce((best, i) =>
      parseFloat(i.consumo_total_periodo || 0) > parseFloat(best?.consumo_total_periodo || 0) ? i : best, null);
    const insumoMasConsumido = (top && parseFloat(top.consumo_total_periodo) > 0)
      ? { id: top.id, codigo: top.codigo, nombre: top.nombre, unidad: top.unidad, consumo_total_periodo: parseFloat(top.consumo_total_periodo) }
      : null;

    res.json({
      periodo: { dias, umbral_dias: umbral, client_id: clientId },
      kpis: { en_riesgo: enRiesgo, consumo_total_periodo: consumoTotal, insumo_mas_consumido: insumoMasConsumido },
      items,
    });
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

// ── GET /insumos/:id/consumo-clientes?dias=30 ──
// Consumo de UN insumo desglosado por cliente (mayor a menor). Agregación en SQL.
router.get('/insumos/:id/consumo-clientes', requireAuth, denyCliente, async (req, res) => {
  const dias = Math.min(Math.max(parseInt(req.query.dias) || 30, 1), 365);
  try {
    const sc = await scopeClientes(req);
    if (sc.block) return res.json([]);
    const params = [req.params.id, dias];
    let idx = 3;
    const cc = ["m.tipo = 'consumo'", 'm.anulado = FALSE', 'm.insumo_id = $1', `m.fecha >= NOW() - ($2::int * INTERVAL '1 day')`];
    if (sc.clients) { cc.push(`m.client_id = ANY($${idx++})`); params.push(sc.clients); }
    const r = await pool.query(
      `SELECT m.client_id,
              COALESCE(cl.name, m.client_id, 'Sin cliente') AS client_name,
              SUM(m.cantidad)                    AS consumo_total,
              SUM(m.cantidad * i.costo_unitario) AS costo
         FROM insumo_movimientos m
         JOIN insumos i  ON i.id = m.insumo_id
         LEFT JOIN clients cl ON cl.id = m.client_id
        WHERE ${cc.join(' AND ')}
        GROUP BY m.client_id, cl.name
        ORDER BY consumo_total DESC`,
      params
    );
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

module.exports = router;
// Se expone el helper para reutilizarlo en el consumo ligado a documentos (Fase 4).
module.exports.aplicarMovimiento = aplicarMovimiento;
