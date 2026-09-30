// Módulo de Transporte y Logística — Fase 2 (Maestros).
//
// CRUD de transportistas, vehículos, choferes, pionetas, clientes de transporte
// y sus destinos, más la lista parametrizable de tipos de vehículo.
//
// Gates: lectura con requireAuth (otros roles consultan flota para contexto);
// escritura SOLO con requireTransporte (COORDINADOR_TRANSPORTE + ADMIN/SUPERADMIN).
// El RUT chileno se valida con dígito verificador en transportistas, choferes,
// pionetas y clientes_transporte (no en vehículos: usan matrícula).

const express = require('express');

const { pool, mapDbError, isUniqueViolation } = require('../db');
const { requireAuth, requireTransporte, requireStockWrite, checkClientAccess } = require('../middleware');
const { genLpnId, normalizeRut, isValidRut } = require('../helpers');

const router = express.Router();

// Valida un RUT opcional. Devuelve { ok, value, error }. Vacío → ok con value null.
function checkRut(rut) {
  if (rut === undefined || rut === null || String(rut).trim() === '') return { ok: true, value: null };
  if (!isValidRut(rut)) return { ok: false, error: `RUT inválido: '${rut}'. Verifique el dígito verificador.` };
  return { ok: true, value: normalizeRut(rut) };
}

// ── TIPOS DE VEHÍCULO (parametrizable) ─────────────────────────────────────────
router.get('/transporte/tipos-vehiculo', requireAuth, async (req, res) => {
  try { res.json((await pool.query('SELECT * FROM tipos_vehiculo WHERE activo=TRUE ORDER BY nombre ASC')).rows); }
  catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});
router.post('/transporte/tipos-vehiculo', requireTransporte, async (req, res) => {
  const { nombre } = req.body;
  if (!nombre || !String(nombre).trim()) return res.status(400).json({ error: 'Nombre requerido.' });
  try {
    const r = await pool.query(
      `INSERT INTO tipos_vehiculo (nombre) VALUES ($1)
       ON CONFLICT (nombre) DO UPDATE SET activo=TRUE RETURNING *`, [String(nombre).trim()]);
    res.json({ success: true, tipo: r.rows[0] });
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});
router.delete('/transporte/tipos-vehiculo/:id', requireTransporte, async (req, res) => {
  try { await pool.query('UPDATE tipos_vehiculo SET activo=FALSE WHERE id=$1', [req.params.id]); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

// ── TRANSPORTISTAS ─────────────────────────────────────────────────────────────
router.get('/transporte/transportistas', requireAuth, async (req, res) => {
  try {
    const { tipo, activo } = req.query;
    const cond = [], params = []; let i = 1;
    if (tipo) { cond.push(`tipo=$${i++}`); params.push(tipo); }
    if (activo === undefined) cond.push('activo=TRUE');
    else if (activo === 'false') cond.push('activo=FALSE');
    const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
    res.json((await pool.query(`SELECT * FROM transportistas ${where} ORDER BY nombre_razon_social ASC`, params)).rows);
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});
router.post('/transporte/transportistas', requireTransporte, async (req, res) => {
  const { nombre_razon_social, tipo, rut, contacto } = req.body;
  if (!nombre_razon_social) return res.status(400).json({ error: 'Razón social requerida.' });
  if (!['PROPIO', 'EXTERNO'].includes(tipo)) return res.status(400).json({ error: "Tipo debe ser 'PROPIO' o 'EXTERNO'." });
  const rc = checkRut(rut);
  if (!rc.ok) return res.status(400).json({ error: rc.error });
  const id = genLpnId('TRP');
  try {
    await pool.query(
      `INSERT INTO transportistas (id, nombre_razon_social, tipo, rut, contacto) VALUES ($1,$2,$3,$4,$5)`,
      [id, nombre_razon_social, tipo, rc.value, contacto || null]);
    res.json({ success: true, id });
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});
router.put('/transporte/transportistas/:id', requireTransporte, async (req, res) => {
  const { nombre_razon_social, tipo, rut, contacto, activo } = req.body;
  if (tipo && !['PROPIO', 'EXTERNO'].includes(tipo)) return res.status(400).json({ error: "Tipo debe ser 'PROPIO' o 'EXTERNO'." });
  const rc = checkRut(rut);
  if (!rc.ok) return res.status(400).json({ error: rc.error });
  try {
    const cur = await pool.query('SELECT * FROM transportistas WHERE id=$1', [req.params.id]);
    if (!cur.rows.length) return res.status(404).json({ error: 'Transportista no encontrado.' });
    const r = cur.rows[0];
    await pool.query(
      `UPDATE transportistas SET nombre_razon_social=$1, tipo=$2, rut=$3, contacto=$4, activo=$5 WHERE id=$6`,
      [nombre_razon_social || r.nombre_razon_social, tipo || r.tipo,
       rut !== undefined ? rc.value : r.rut, contacto !== undefined ? contacto : r.contacto,
       activo !== undefined ? !!activo : r.activo, req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});
router.delete('/transporte/transportistas/:id', requireTransporte, async (req, res) => {
  try { await pool.query('UPDATE transportistas SET activo=FALSE WHERE id=$1', [req.params.id]); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

// ── VEHÍCULOS ──────────────────────────────────────────────────────────────────
router.get('/transporte/vehiculos', requireAuth, async (req, res) => {
  try {
    const { transportista_id, activo } = req.query;
    const cond = [], params = []; let i = 1;
    if (transportista_id) { cond.push(`v.transportista_id=$${i++}`); params.push(transportista_id); }
    if (activo === undefined) cond.push('v.activo=TRUE');
    else if (activo === 'false') cond.push('v.activo=FALSE');
    const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
    res.json((await pool.query(
      `SELECT v.*, t.nombre_razon_social AS transportista_nombre, t.tipo AS transportista_tipo
       FROM vehiculos v LEFT JOIN transportistas t ON v.transportista_id=t.id
       ${where} ORDER BY v.matricula ASC`, params)).rows);
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});
router.post('/transporte/vehiculos', requireTransporte, async (req, res) => {
  const { transportista_id, tipo_vehiculo, matricula, capacidad_carga_kg, area_largo, area_ancho, area_alto } = req.body;
  if (!transportista_id) return res.status(400).json({ error: 'transportista_id requerido.' });
  if (!matricula) return res.status(400).json({ error: 'Matrícula requerida.' });
  const id = genLpnId('VEH');
  try {
    await pool.query(
      `INSERT INTO vehiculos (id, transportista_id, tipo_vehiculo, matricula, capacidad_carga_kg, area_largo, area_ancho, area_alto)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, transportista_id, tipo_vehiculo || null, String(matricula).toUpperCase(),
       parseFloat(capacidad_carga_kg) || 0, parseFloat(area_largo) || 0, parseFloat(area_ancho) || 0, parseFloat(area_alto) || 0]);
    res.json({ success: true, id });
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});
router.put('/transporte/vehiculos/:id', requireTransporte, async (req, res) => {
  const { transportista_id, tipo_vehiculo, matricula, capacidad_carga_kg, area_largo, area_ancho, area_alto, activo } = req.body;
  try {
    const cur = await pool.query('SELECT * FROM vehiculos WHERE id=$1', [req.params.id]);
    if (!cur.rows.length) return res.status(404).json({ error: 'Vehículo no encontrado.' });
    const r = cur.rows[0];
    const num = (v, d) => v !== undefined && v !== null && v !== '' ? parseFloat(v) : d;
    await pool.query(
      `UPDATE vehiculos SET transportista_id=$1, tipo_vehiculo=$2, matricula=$3, capacidad_carga_kg=$4,
         area_largo=$5, area_ancho=$6, area_alto=$7, activo=$8 WHERE id=$9`,
      [transportista_id || r.transportista_id, tipo_vehiculo !== undefined ? tipo_vehiculo : r.tipo_vehiculo,
       matricula ? String(matricula).toUpperCase() : r.matricula, num(capacidad_carga_kg, r.capacidad_carga_kg),
       num(area_largo, r.area_largo), num(area_ancho, r.area_ancho), num(area_alto, r.area_alto),
       activo !== undefined ? !!activo : r.activo, req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});
router.delete('/transporte/vehiculos/:id', requireTransporte, async (req, res) => {
  try { await pool.query('UPDATE vehiculos SET activo=FALSE WHERE id=$1', [req.params.id]); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

// ── CHOFERES ───────────────────────────────────────────────────────────────────
router.get('/transporte/choferes', requireAuth, async (req, res) => {
  try {
    const { transportista_id, activo } = req.query;
    const cond = [], params = []; let i = 1;
    if (transportista_id) { cond.push(`transportista_id=$${i++}`); params.push(transportista_id); }
    if (activo === undefined) cond.push('activo=TRUE');
    else if (activo === 'false') cond.push('activo=FALSE');
    const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
    res.json((await pool.query(`SELECT * FROM choferes ${where} ORDER BY nombre ASC`, params)).rows);
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});
router.post('/transporte/choferes', requireTransporte, async (req, res) => {
  const { transportista_id, nombre, contacto, rut, correo } = req.body;
  if (!transportista_id) return res.status(400).json({ error: 'transportista_id requerido.' });
  if (!nombre) return res.status(400).json({ error: 'Nombre requerido.' });
  const rc = checkRut(rut);
  if (!rc.ok) return res.status(400).json({ error: rc.error });
  const id = genLpnId('CHO');
  try {
    await pool.query(
      `INSERT INTO choferes (id, transportista_id, nombre, contacto, rut, correo) VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, transportista_id, nombre, contacto || null, rc.value, correo || null]);
    res.json({ success: true, id });
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});
router.put('/transporte/choferes/:id', requireTransporte, async (req, res) => {
  const { transportista_id, nombre, contacto, rut, correo, activo } = req.body;
  const rc = checkRut(rut);
  if (!rc.ok) return res.status(400).json({ error: rc.error });
  try {
    const cur = await pool.query('SELECT * FROM choferes WHERE id=$1', [req.params.id]);
    if (!cur.rows.length) return res.status(404).json({ error: 'Chofer no encontrado.' });
    const r = cur.rows[0];
    await pool.query(
      `UPDATE choferes SET transportista_id=$1, nombre=$2, contacto=$3, rut=$4, correo=$5, activo=$6 WHERE id=$7`,
      [transportista_id || r.transportista_id, nombre || r.nombre, contacto !== undefined ? contacto : r.contacto,
       rut !== undefined ? rc.value : r.rut, correo !== undefined ? correo : r.correo,
       activo !== undefined ? !!activo : r.activo, req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});
router.delete('/transporte/choferes/:id', requireTransporte, async (req, res) => {
  try { await pool.query('UPDATE choferes SET activo=FALSE WHERE id=$1', [req.params.id]); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

// ── PIONETAS ───────────────────────────────────────────────────────────────────
router.get('/transporte/pionetas', requireAuth, async (req, res) => {
  try {
    const { transportista_id, activo } = req.query;
    const cond = [], params = []; let i = 1;
    if (transportista_id) { cond.push(`transportista_id=$${i++}`); params.push(transportista_id); }
    if (activo === undefined) cond.push('activo=TRUE');
    else if (activo === 'false') cond.push('activo=FALSE');
    const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
    res.json((await pool.query(`SELECT * FROM pionetas ${where} ORDER BY nombre ASC`, params)).rows);
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});
router.post('/transporte/pionetas', requireTransporte, async (req, res) => {
  const { transportista_id, nombre, rut } = req.body;
  if (!transportista_id) return res.status(400).json({ error: 'transportista_id requerido.' });
  if (!nombre) return res.status(400).json({ error: 'Nombre requerido.' });
  const rc = checkRut(rut);
  if (!rc.ok) return res.status(400).json({ error: rc.error });
  const id = genLpnId('PIO');
  try {
    await pool.query(`INSERT INTO pionetas (id, transportista_id, nombre, rut) VALUES ($1,$2,$3,$4)`,
      [id, transportista_id, nombre, rc.value]);
    res.json({ success: true, id });
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});
router.put('/transporte/pionetas/:id', requireTransporte, async (req, res) => {
  const { transportista_id, nombre, rut, activo } = req.body;
  const rc = checkRut(rut);
  if (!rc.ok) return res.status(400).json({ error: rc.error });
  try {
    const cur = await pool.query('SELECT * FROM pionetas WHERE id=$1', [req.params.id]);
    if (!cur.rows.length) return res.status(404).json({ error: 'Pioneta no encontrado.' });
    const r = cur.rows[0];
    await pool.query(
      `UPDATE pionetas SET transportista_id=$1, nombre=$2, rut=$3, activo=$4 WHERE id=$5`,
      [transportista_id || r.transportista_id, nombre || r.nombre,
       rut !== undefined ? rc.value : r.rut, activo !== undefined ? !!activo : r.activo, req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});
router.delete('/transporte/pionetas/:id', requireTransporte, async (req, res) => {
  try { await pool.query('UPDATE pionetas SET activo=FALSE WHERE id=$1', [req.params.id]); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

// ── CLIENTES DE TRANSPORTE (+ destinos) ────────────────────────────────────────
router.get('/transporte/clientes', requireAuth, async (req, res) => {
  try {
    const { activo } = req.query;
    const where = activo === 'false' ? 'WHERE activo=FALSE' : (activo === undefined ? 'WHERE activo=TRUE' : '');
    const clientes = (await pool.query(`SELECT * FROM clientes_transporte ${where} ORDER BY nombre ASC`)).rows;
    const dest = (await pool.query('SELECT * FROM destinos_cliente_transporte ORDER BY nombre ASC')).rows;
    const byCliente = {};
    for (const d of dest) (byCliente[d.cliente_transporte_id] ||= []).push(d);
    res.json(clientes.map(c => ({ ...c, destinos: byCliente[c.id] || [] })));
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});
router.post('/transporte/clientes', requireTransporte, async (req, res) => {
  const { nombre, rut, contacto } = req.body;
  if (!nombre) return res.status(400).json({ error: 'Nombre requerido.' });
  const rc = checkRut(rut);
  if (!rc.ok) return res.status(400).json({ error: rc.error });
  const id = genLpnId('CLT');
  try {
    await pool.query(`INSERT INTO clientes_transporte (id, nombre, rut, contacto) VALUES ($1,$2,$3,$4)`,
      [id, nombre, rc.value, contacto || null]);
    res.json({ success: true, id });
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});
router.put('/transporte/clientes/:id', requireTransporte, async (req, res) => {
  const { nombre, rut, contacto, activo } = req.body;
  const rc = checkRut(rut);
  if (!rc.ok) return res.status(400).json({ error: rc.error });
  try {
    const cur = await pool.query('SELECT * FROM clientes_transporte WHERE id=$1', [req.params.id]);
    if (!cur.rows.length) return res.status(404).json({ error: 'Cliente de transporte no encontrado.' });
    const r = cur.rows[0];
    await pool.query(
      `UPDATE clientes_transporte SET nombre=$1, rut=$2, contacto=$3, activo=$4 WHERE id=$5`,
      [nombre || r.nombre, rut !== undefined ? rc.value : r.rut,
       contacto !== undefined ? contacto : r.contacto, activo !== undefined ? !!activo : r.activo, req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});
router.delete('/transporte/clientes/:id', requireTransporte, async (req, res) => {
  try { await pool.query('UPDATE clientes_transporte SET activo=FALSE WHERE id=$1', [req.params.id]); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

// Destinos de un cliente de transporte
router.post('/transporte/clientes/:id/destinos', requireTransporte, async (req, res) => {
  const { nombre, direccion } = req.body;
  if (!nombre) return res.status(400).json({ error: 'Nombre del destino requerido.' });
  try {
    const cli = await pool.query('SELECT id FROM clientes_transporte WHERE id=$1', [req.params.id]);
    if (!cli.rows.length) return res.status(404).json({ error: 'Cliente de transporte no encontrado.' });
    const r = await pool.query(
      `INSERT INTO destinos_cliente_transporte (cliente_transporte_id, nombre, direccion) VALUES ($1,$2,$3) RETURNING *`,
      [req.params.id, nombre, direccion || null]);
    res.json({ success: true, destino: r.rows[0] });
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});
router.put('/transporte/destinos/:destId', requireTransporte, async (req, res) => {
  const { nombre, direccion } = req.body;
  try {
    const cur = await pool.query('SELECT * FROM destinos_cliente_transporte WHERE id=$1', [req.params.destId]);
    if (!cur.rows.length) return res.status(404).json({ error: 'Destino no encontrado.' });
    const r = cur.rows[0];
    await pool.query(`UPDATE destinos_cliente_transporte SET nombre=$1, direccion=$2 WHERE id=$3`,
      [nombre || r.nombre, direccion !== undefined ? direccion : r.direccion, req.params.destId]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});
router.delete('/transporte/destinos/:destId', requireTransporte, async (req, res) => {
  try { await pool.query('DELETE FROM destinos_cliente_transporte WHERE id=$1', [req.params.destId]); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── SOLICITUDES DE TRANSPORTE (Fase 3) ──────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// Calcula peso/volumen de un conjunto de líneas {sku, qty} contra master_skus.
// volumen por línea = largo×ancho×alto × qty. dims_incompletas = true si algún
// SKU tiene alguna dimensión en 0 (volumen incompleto).
async function calcularCargaDesdeLineas(items, clientHint) {
  let peso_total = 0, volumen_total = 0, dims_incompletas = false;
  const skuSinDims = [];
  const skus = [...new Set((items || []).map(it => String(it.sku || '').toUpperCase()).filter(Boolean))];
  if (skus.length === 0) return { peso_total, volumen_total, dims_incompletas, skuSinDims };
  const r = await pool.query(
    `SELECT sku, client_id, weight, length, width, height FROM master_skus WHERE UPPER(sku) = ANY($1)`, [skus]);
  // Mapa sku → fila (prefiere la del client_id resuelto si hay varias).
  const bySku = {};
  for (const row of r.rows) {
    const k = String(row.sku).toUpperCase();
    if (!bySku[k] || (clientHint && row.client_id === clientHint)) bySku[k] = row;
  }
  for (const it of items) {
    const k = String(it.sku || '').toUpperCase();
    const qty = parseFloat(it.qty ?? it.qtyToPick ?? 0) || 0;
    if (!k || qty <= 0) continue;
    const m = bySku[k];
    const w = parseFloat(m?.weight) || 0;
    const l = parseFloat(m?.length) || 0, an = parseFloat(m?.width) || 0, al = parseFloat(m?.height) || 0;
    peso_total += w * qty;
    const volUnit = l * an * al;
    volumen_total += volUnit * qty;
    if (volUnit === 0) { dims_incompletas = true; if (!skuSinDims.includes(k)) skuSinDims.push(k); }
  }
  return {
    peso_total: Math.round(peso_total * 1000) / 1000,
    volumen_total: Math.round(volumen_total * 10000) / 10000,
    dims_incompletas, skuSinDims,
  };
}

// GET listado con filtros. requireAuth (el coordinador y bodega lo consultan).
router.get('/transporte/solicitudes', requireAuth, async (req, res) => {
  try {
    const { estado, origen, sentido, despacho_id } = req.query;
    const cond = [], params = []; let i = 1;
    if (estado) { cond.push(`s.estado=$${i++}`); params.push(estado); }
    if (origen) { cond.push(`s.origen=$${i++}`); params.push(origen); }
    if (sentido) { cond.push(`s.sentido=$${i++}`); params.push(sentido); }
    if (despacho_id) { cond.push(`s.despacho_id=$${i++}`); params.push(despacho_id); }
    const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
    const rows = await pool.query(
      `SELECT s.*, c.name AS cliente_nombre, ct.nombre AS cliente_transporte_nombre,
              ds.doc_num AS despacho_doc_num,
              e.id AS envio_id, e.estado AS envio_estado, e.fecha_hora_confirmada,
              tr.nombre_razon_social AS transportista_nombre,
              v.matricula AS vehiculo_matricula, v.tipo_vehiculo AS vehiculo_tipo,
              ch.nombre AS chofer_nombre
       FROM solicitud_transporte s
       LEFT JOIN clients c ON s.client_id = c.id
       LEFT JOIN clientes_transporte ct ON s.cliente_transporte_id = ct.id
       LEFT JOIN dispatch_schedules ds ON s.despacho_id = ds.id
       LEFT JOIN envio_paradas ep ON ep.solicitud_transporte_id = s.id
       LEFT JOIN envios e ON e.id = ep.envio_id
       LEFT JOIN transportistas tr ON tr.id = e.transportista_id
       LEFT JOIN vehiculos v ON v.id = e.vehiculo_id
       LEFT JOIN choferes ch ON ch.id = e.chofer_id
       ${where} ORDER BY s.created_at DESC LIMIT 500`, params);
    res.json(rows.rows);
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

// ORIGEN A — desde un despacho. El EJECUTIVO (requireStockWrite) pide transporte:
// indica cajas/cajones/pallets, tipo sugerido, destino, horas y sentido; el backend
// CALCULA client_id (del despacho), peso_total y volumen_total desde las líneas.
router.post('/transporte/solicitudes/desde-despacho', requireStockWrite, checkClientAccess('write'), async (req, res) => {
  const {
    despacho_id, client_id, items,
    n_cajas, n_cajones, n_pallets, tipo_vehiculo_sugerido, destino,
    hora_carga_habilitada, fecha_hora_recepcion_destino, sentido,
  } = req.body;
  if (sentido && !['SALIDA', 'REGRESO'].includes(sentido)) return res.status(400).json({ error: "sentido debe ser 'SALIDA' o 'REGRESO'." });
  try {
    // Resolver client_id y destino: si hay despacho, mandan sus datos.
    let resolvedClient = client_id || null;
    let resolvedDestino = destino || null;
    if (despacho_id) {
      const ds = await pool.query('SELECT id, client_id, destination FROM dispatch_schedules WHERE id=$1', [despacho_id]);
      if (!ds.rows.length) return res.status(404).json({ error: 'Despacho (programación) no encontrado.' });
      resolvedClient = ds.rows[0].client_id || resolvedClient;
      if (!resolvedDestino) resolvedDestino = ds.rows[0].destination || null;
    }
    const carga = await calcularCargaDesdeLineas(items || [], resolvedClient);
    const id = genLpnId('SOL');
    await pool.query(
      `INSERT INTO solicitud_transporte
        (id, origen, despacho_id, client_id, sentido, tipo_operacion, peso_total, volumen_total, dims_incompletas,
         n_cajas, n_cajones, n_pallets, tipo_vehiculo_sugerido, destino, hora_carga_habilitada,
         fecha_hora_recepcion_destino, estado, usuario_solicita)
       VALUES ($1,'DESPACHO',$2,$3,$4,'DIRECTA',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'pendiente',$15)`,
      [id, despacho_id || null, resolvedClient, sentido || 'SALIDA',
       carga.peso_total, carga.volumen_total, carga.dims_incompletas,
       parseInt(n_cajas) || 0, parseInt(n_cajones) || 0, parseInt(n_pallets) || 0,
       tipo_vehiculo_sugerido || null, resolvedDestino, hora_carga_habilitada || null,
       fecha_hora_recepcion_destino || null, req.user.username]);
    // Marcar el despacho como "requiere transporte" (lo que el ejecutivo prepara).
    if (despacho_id) await pool.query('UPDATE dispatch_schedules SET requiere_transporte=TRUE WHERE id=$1', [despacho_id]);
    res.json({
      success: true, id,
      peso_total: carga.peso_total, volumen_total: carga.volumen_total,
      dims_incompletas: carga.dims_incompletas,
      aviso: carga.dims_incompletas
        ? `Volumen incompleto: hay SKU sin dimensiones (${carga.skuSinDims.join(', ')}).`
        : null,
    });
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

// ORIGEN B — solo transporte. El COORDINADOR (requireTransporte) ingresa todo a mano;
// la carga NO está en bodega, así que no cuelga de despacho.
router.post('/transporte/solicitudes', requireTransporte, async (req, res) => {
  const {
    cliente_transporte_id, origen_texto, destino, sentido, tipo_operacion,
    peso_total, volumen_total, n_cajas, n_cajones, n_pallets, tipo_vehiculo_sugerido,
    hora_carga_habilitada, fecha_hora_recepcion_destino,
  } = req.body;
  if (sentido && !['SALIDA', 'REGRESO'].includes(sentido)) return res.status(400).json({ error: "sentido debe ser 'SALIDA' o 'REGRESO'." });
  if (tipo_operacion && !['DIRECTA', 'TRANSITO', 'TRASVASIJE'].includes(tipo_operacion)) return res.status(400).json({ error: "tipo_operacion inválido." });
  if (!destino && !origen_texto && !cliente_transporte_id) return res.status(400).json({ error: 'Indique al menos cliente de transporte, origen o destino.' });
  const id = genLpnId('SOL');
  try {
    if (cliente_transporte_id) {
      const ct = await pool.query('SELECT id FROM clientes_transporte WHERE id=$1', [cliente_transporte_id]);
      if (!ct.rows.length) return res.status(404).json({ error: 'Cliente de transporte no encontrado.' });
    }
    await pool.query(
      `INSERT INTO solicitud_transporte
        (id, origen, cliente_transporte_id, sentido, tipo_operacion, peso_total, volumen_total, dims_incompletas,
         n_cajas, n_cajones, n_pallets, tipo_vehiculo_sugerido, origen_texto, destino,
         hora_carga_habilitada, fecha_hora_recepcion_destino, estado, usuario_solicita)
       VALUES ($1,'SOLO_TRANSPORTE',$2,$3,$4,$5,$6,FALSE,$7,$8,$9,$10,$11,$12,$13,$14,'pendiente',$15)`,
      [id, cliente_transporte_id || null, sentido || 'SALIDA', tipo_operacion || 'DIRECTA',
       parseFloat(peso_total) || 0, parseFloat(volumen_total) || 0,
       parseInt(n_cajas) || 0, parseInt(n_cajones) || 0, parseInt(n_pallets) || 0,
       tipo_vehiculo_sugerido || null, origen_texto || null, destino || null,
       hora_carga_habilitada || null, fecha_hora_recepcion_destino || null, req.user.username]);
    res.json({ success: true, id });
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

// PATCH — el coordinador ajusta la solicitud pendiente (incluida la fecha/hora de
// recepción en destino, permitida en ambos orígenes) o la anula.
router.patch('/transporte/solicitudes/:id', requireTransporte, async (req, res) => {
  const { fecha_hora_recepcion_destino, hora_carga_habilitada, tipo_vehiculo_sugerido, destino, estado } = req.body;
  if (estado && !['pendiente', 'anulada'].includes(estado)) return res.status(400).json({ error: "estado solo puede pasar a 'anulada' (o seguir 'pendiente'); la asignación se hace en Fase 5." });
  try {
    const cur = await pool.query('SELECT * FROM solicitud_transporte WHERE id=$1', [req.params.id]);
    if (!cur.rows.length) return res.status(404).json({ error: 'Solicitud no encontrada.' });
    const r = cur.rows[0];
    if (r.estado === 'asignada') return res.status(409).json({ error: 'La solicitud ya está asignada; gestione cambios desde el envío (Fase 5).' });
    await pool.query(
      `UPDATE solicitud_transporte SET fecha_hora_recepcion_destino=$1, hora_carga_habilitada=$2,
         tipo_vehiculo_sugerido=$3, destino=$4, estado=$5 WHERE id=$6`,
      [fecha_hora_recepcion_destino !== undefined ? (fecha_hora_recepcion_destino || null) : r.fecha_hora_recepcion_destino,
       hora_carga_habilitada !== undefined ? (hora_carga_habilitada || null) : r.hora_carga_habilitada,
       tipo_vehiculo_sugerido !== undefined ? tipo_vehiculo_sugerido : r.tipo_vehiculo_sugerido,
       destino !== undefined ? destino : r.destino,
       estado || r.estado, req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── DASHBOARD DE TRANSPORTE (Fase 4) ────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// Existencia de tabla (envios y sus dependientes llegan en Fase 6). Permite que el
// dashboard funcione antes de Fase 6 (KPIs de envío en 0) y se "encienda" solo
// cuando la tabla exista, sin refactor.
async function tableExists(name) {
  const r = await pool.query('SELECT to_regclass($1) AS t', [name]);
  return !!r.rows[0].t;
}

// Dashboard propio del coordinador (separado del de bodega). requireAuth: lo ven
// COORDINADOR_TRANSPORTE y ADMIN+. Filtros: fecha, transportista, estado, origen,
// sentido, buscar (despacho/cliente).
router.get('/transporte/dashboard', requireAuth, async (req, res) => {
  const { fecha, transportista, estado, origen, sentido, buscar } = req.query;
  try {
    // ── Cola de solicitudes (filtrable) ──────────────────────────────────────
    const cond = [], params = []; let i = 1;
    cond.push(`s.estado = $${i++}`); params.push(estado || 'pendiente');
    if (origen) { cond.push(`s.origen = $${i++}`); params.push(origen); }
    if (sentido) { cond.push(`s.sentido = $${i++}`); params.push(sentido); }
    if (fecha) { cond.push(`s.created_at::date = $${i++}`); params.push(fecha); }
    if (buscar) {
      cond.push(`(ds.doc_num ILIKE $${i} OR c.name ILIKE $${i} OR ct.nombre ILIKE $${i})`);
      params.push(`%${buscar}%`); i++;
    }
    const where = 'WHERE ' + cond.join(' AND ');
    const solicitudes = (await pool.query(
      `SELECT s.*, c.name AS cliente_nombre, ct.nombre AS cliente_transporte_nombre, ds.doc_num AS despacho_doc_num
       FROM solicitud_transporte s
       LEFT JOIN clients c ON s.client_id = c.id
       LEFT JOIN clientes_transporte ct ON s.cliente_transporte_id = ct.id
       LEFT JOIN dispatch_schedules ds ON s.despacho_id = ds.id
       ${where} ORDER BY s.created_at DESC LIMIT 300`, params)).rows;

    // ── Flota disponible ──────────────────────────────────────────────────────
    const flotaWhere = transportista ? 'AND transportista_id = $1' : '';
    const fp = transportista ? [transportista] : [];
    const vehiculos = (await pool.query(
      `SELECT v.*, t.nombre_razon_social AS transportista_nombre, t.tipo AS transportista_tipo
       FROM vehiculos v LEFT JOIN transportistas t ON v.transportista_id = t.id
       WHERE v.activo = TRUE ${transportista ? 'AND v.transportista_id = $1' : ''}
       ORDER BY v.matricula ASC`, fp)).rows;
    const choferes = (await pool.query(`SELECT * FROM choferes WHERE activo = TRUE ${flotaWhere} ORDER BY nombre`, fp)).rows;
    const pionetas = (await pool.query(`SELECT * FROM pionetas WHERE activo = TRUE ${flotaWhere} ORDER BY nombre`, fp)).rows;

    // ── Envíos (Fase 6): defensivo mientras no exista la tabla ────────────────
    let envios_hoy = [], enRuta = 0, esperanPod = 0;
    if (await tableExists('envios')) {
      const ec = [], ep = []; let j = 1;
      if (transportista) { ec.push(`e.transportista_id = $${j++}`); ep.push(transportista); }
      const ewhere = ec.length ? 'WHERE ' + ec.join(' AND ') : '';
      envios_hoy = (await pool.query(
        `SELECT e.*, t.nombre_razon_social AS transportista_nombre, v.matricula
         FROM envios e
         LEFT JOIN transportistas t ON e.transportista_id = t.id
         LEFT JOIN vehiculos v ON e.vehiculo_id = v.id
         ${ewhere} ORDER BY e.created_at DESC LIMIT 200`, ep)).rows;
      enRuta = envios_hoy.filter(e => e.estado === 'en_ruta').length;
      // "esperan POD": en ruta con alguna parada pendiente (si existe shipment_paradas).
      if (await tableExists('envio_paradas')) {
        const r = await pool.query(`SELECT COUNT(DISTINCT e.id)::int AS n FROM envios e
          JOIN envio_paradas p ON p.envio_id = e.id
          WHERE e.estado = 'en_ruta' AND p.estado = 'pendiente'`);
        esperanPod = r.rows[0].n;
      }
    }

    // ── KPIs + alertas ────────────────────────────────────────────────────────
    const pendientesCount = (await pool.query(`SELECT COUNT(*)::int AS n FROM solicitud_transporte WHERE estado='pendiente'`)).rows[0].n;
    const alertas = {
      volumen_incompleto: solicitudes.filter(s => s.dims_incompletas).map(s => ({ id: s.id, despacho_doc_num: s.despacho_doc_num, cliente: s.cliente_nombre || s.cliente_transporte_nombre })),
      en_transito_esperando_pod: esperanPod,
    };

    res.json({
      kpis: {
        pendientes: pendientesCount,
        en_ruta: enRuta,
        esperan_pod: esperanPod,
        vehiculos_disponibles: vehiculos.length,
      },
      solicitudes_pendientes: solicitudes,
      envios_hoy,
      flota: { vehiculos, choferes, pionetas },
      alertas,
    });
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── ENVÍOS: ASIGNAR / REASIGNAR (Fase 5) ────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// Avisos de capacidad (NO bloqueantes). Compara la carga (peso/volumen) contra el
// vehículo. El volumen solo se evalúa si el vehículo tiene volumen_util > 0 (puede
// venir incompleto). Devuelve un array de mensajes.
function avisosCapacidad(vehiculo, peso, volumen) {
  const avisos = [];
  const cap = parseFloat(vehiculo?.capacidad_carga_kg) || 0;
  const vol = parseFloat(vehiculo?.volumen_util) || 0;
  if (cap > 0 && peso > cap) avisos.push(`Peso ${peso.toLocaleString('es-CL')} kg supera la capacidad del vehículo (${cap.toLocaleString('es-CL')} kg).`);
  if (vol > 0 && volumen > vol) avisos.push(`Volumen ${volumen.toLocaleString('es-CL')} m³ supera el volumen útil del vehículo (${vol.toLocaleString('es-CL')} m³).`);
  return avisos;
}

// ASIGNAR una solicitud → crea el envío (estado 'asignado') con vehículo/chofer/
// pioneta(s), una parada (orden 1) y un tramo base; la solicitud pasa a 'asignada'.
// La validación de capacidad es un AVISO: si se supera y no viene confirmar=true,
// responde requiere_confirmacion sin crear nada.
router.post('/transporte/solicitudes/:id/asignar', requireTransporte, async (req, res) => {
  const { transportista_id, vehiculo_id, chofer_id, pioneta_ids, fecha_hora_confirmada, confirmar } = req.body;
  if (!transportista_id || !vehiculo_id || !chofer_id) return res.status(400).json({ error: 'Transportista, vehículo y chofer son requeridos.' });
  const pionetas = Array.isArray(pioneta_ids) ? pioneta_ids.filter(Boolean) : [];
  try {
    const sq = await pool.query('SELECT * FROM solicitud_transporte WHERE id=$1', [req.params.id]);
    if (!sq.rows.length) return res.status(404).json({ error: 'Solicitud no encontrada.' });
    const sol = sq.rows[0];
    if (sol.estado !== 'pendiente') return res.status(409).json({ error: `La solicitud está '${sol.estado}', no se puede asignar.` });

    const vq = await pool.query('SELECT * FROM vehiculos WHERE id=$1', [vehiculo_id]);
    if (!vq.rows.length) return res.status(404).json({ error: 'Vehículo no encontrado.' });

    const avisos = avisosCapacidad(vq.rows[0], parseFloat(sol.peso_total) || 0, parseFloat(sol.volumen_total) || 0);
    if (avisos.length && !confirmar) {
      return res.json({ requiere_confirmacion: true, avisos });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const envioId = genLpnId('ENV');
      await client.query(
        `INSERT INTO envios (id, transportista_id, vehiculo_id, chofer_id, fecha_hora_confirmada, estado, usuario_asigna)
         VALUES ($1,$2,$3,$4,$5,'asignado',$6)`,
        [envioId, transportista_id, vehiculo_id, chofer_id, fecha_hora_confirmada || null, req.user.username]);
      for (const pid of pionetas) {
        await client.query('INSERT INTO envio_pionetas (envio_id, pioneta_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [envioId, pid]);
      }
      const clienteRef = sol.client_id || sol.cliente_transporte_id || null;
      await client.query(
        `INSERT INTO envio_paradas (envio_id, orden, solicitud_transporte_id, cliente_ref, destino, carga_desc)
         VALUES ($1,1,$2,$3,$4,$5)`,
        [envioId, sol.id, clienteRef, sol.destino,
         `${sol.n_cajas || 0} cajas, ${sol.n_cajones || 0} cajones, ${sol.n_pallets || 0} pallets`]);
      await client.query(
        `INSERT INTO envio_tramos (envio_id, orden, vehiculo_id, chofer_id, desde, hasta)
         VALUES ($1,1,$2,$3,$4,$5)`,
        [envioId, vehiculo_id, chofer_id, sol.origen_texto || null, sol.destino || null]);
      await client.query(`UPDATE solicitud_transporte SET estado='asignada' WHERE id=$1`, [sol.id]);
      // Fase 7: el despacho de Origen A queda ABIERTO ('en_transito') al asignarse;
      // NO se cierra aquí. Solo aplica a despachos con requiere_transporte=TRUE.
      if (sol.despacho_id) {
        await client.query(`UPDATE dispatch_schedules SET status='en_transito' WHERE id=$1 AND requiere_transporte=TRUE`, [sol.despacho_id]);
      }
      await client.query('COMMIT');
      res.json({ success: true, envio_id: envioId, avisos });
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

// REASIGNAR (flexible mientras el envío no esté 'entregado'/'anulado'). Queda en el
// MISMO envío, con historial y motivo OBLIGATORIO.
//   SIMPLE     → cambia vehículo/chofer del resto del viaje.
//   TRASVASIJE → la carga pasa a otro camión en un punto intermedio: crea un tramo
//                nuevo y actualiza el vehículo/chofer vigente del envío.
router.post('/transporte/envios/:id/reasignar', requireTransporte, async (req, res) => {
  const { tipo, motivo, vehiculo_nuevo, chofer_nuevo, desde, hasta } = req.body;
  if (!['SIMPLE', 'TRASVASIJE'].includes(tipo)) return res.status(400).json({ error: "tipo debe ser 'SIMPLE' o 'TRASVASIJE'." });
  if (!motivo || !String(motivo).trim()) return res.status(400).json({ error: 'El motivo de la reasignación es obligatorio.' });
  if (!vehiculo_nuevo && !chofer_nuevo) return res.status(400).json({ error: 'Indique el vehículo y/o chofer nuevo.' });
  try {
    const eq = await pool.query('SELECT * FROM envios WHERE id=$1', [req.params.id]);
    if (!eq.rows.length) return res.status(404).json({ error: 'Envío no encontrado.' });
    const env = eq.rows[0];
    if (['entregado', 'anulado'].includes(env.estado)) return res.status(409).json({ error: `El envío está '${env.estado}'; no se puede reasignar.` });

    const vehNuevo = vehiculo_nuevo || env.vehiculo_id;
    const choNuevo = chofer_nuevo || env.chofer_id;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO envio_reasignaciones (envio_id, tipo, motivo, vehiculo_anterior, chofer_anterior, vehiculo_nuevo, chofer_nuevo, usuario)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [env.id, tipo, motivo, env.vehiculo_id, env.chofer_id, vehNuevo, choNuevo, req.user.username]);
      if (tipo === 'TRASVASIJE') {
        const ord = await client.query('SELECT COALESCE(MAX(orden),0)+1 AS n FROM envio_tramos WHERE envio_id=$1', [env.id]);
        await client.query(
          `INSERT INTO envio_tramos (envio_id, orden, vehiculo_id, chofer_id, desde, hasta, motivo) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [env.id, ord.rows[0].n, vehNuevo, choNuevo, desde || null, hasta || null, motivo]);
      }
      // Tanto SIMPLE como TRASVASIJE dejan el vehículo/chofer vigente = el nuevo.
      await client.query('UPDATE envios SET vehiculo_id=$1, chofer_id=$2 WHERE id=$3', [vehNuevo, choNuevo, env.id]);
      await client.query('COMMIT');
      res.json({ success: true });
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

// GET envíos (listado con joins).
router.get('/transporte/envios', requireAuth, async (req, res) => {
  try {
    const { estado, transportista_id } = req.query;
    const cond = [], params = []; let i = 1;
    if (estado) { cond.push(`e.estado=$${i++}`); params.push(estado); }
    if (transportista_id) { cond.push(`e.transportista_id=$${i++}`); params.push(transportista_id); }
    const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
    const rows = await pool.query(
      `SELECT e.*, t.nombre_razon_social AS transportista_nombre, v.matricula, ch.nombre AS chofer_nombre,
              (SELECT COUNT(*)::int FROM envio_paradas p WHERE p.envio_id=e.id) AS n_paradas
       FROM envios e
       LEFT JOIN transportistas t ON e.transportista_id=t.id
       LEFT JOIN vehiculos v ON e.vehiculo_id=v.id
       LEFT JOIN choferes ch ON e.chofer_id=ch.id
       ${where} ORDER BY e.created_at DESC LIMIT 300`, params);
    res.json(rows.rows);
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

// GET detalle de un envío (pionetas, tramos, paradas, reasignaciones).
router.get('/transporte/envios/:id', requireAuth, async (req, res) => {
  try {
    const eq = await pool.query(
      `SELECT e.*, t.nombre_razon_social AS transportista_nombre, v.matricula, ch.nombre AS chofer_nombre
       FROM envios e LEFT JOIN transportistas t ON e.transportista_id=t.id
       LEFT JOIN vehiculos v ON e.vehiculo_id=v.id LEFT JOIN choferes ch ON e.chofer_id=ch.id WHERE e.id=$1`, [req.params.id]);
    if (!eq.rows.length) return res.status(404).json({ error: 'Envío no encontrado.' });
    const [pionetas, tramos, paradas, reasig] = await Promise.all([
      pool.query(`SELECT p.* FROM envio_pionetas ep JOIN pionetas p ON ep.pioneta_id=p.id WHERE ep.envio_id=$1`, [req.params.id]),
      pool.query(`SELECT tr.*, v.matricula, ch.nombre AS chofer_nombre FROM envio_tramos tr
                  LEFT JOIN vehiculos v ON tr.vehiculo_id=v.id LEFT JOIN choferes ch ON tr.chofer_id=ch.id
                  WHERE tr.envio_id=$1 ORDER BY tr.orden`, [req.params.id]),
      pool.query(`SELECT * FROM envio_paradas WHERE envio_id=$1 ORDER BY orden`, [req.params.id]),
      pool.query(`SELECT * FROM envio_reasignaciones WHERE envio_id=$1 ORDER BY fecha DESC`, [req.params.id]),
    ]);
    res.json({ ...eq.rows[0], pionetas: pionetas.rows, tramos: tramos.rows, paradas: paradas.rows, reasignaciones: reasig.rows });
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── ENVÍO: ESTADOS, CONSOLIDACIÓN, RUTA Y POD (Fase 6) ──────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// Suma la carga (peso/volumen) de las solicitudes ligadas a las paradas del envío.
// extraSolicitudId permite previsualizar el total al consolidar una nueva.
async function cargaConsolidada(envioId, extraSolicitudId) {
  const q = await pool.query(
    `SELECT COALESCE(SUM(s.peso_total),0) AS peso, COALESCE(SUM(s.volumen_total),0) AS vol
     FROM envio_paradas p JOIN solicitud_transporte s ON p.solicitud_transporte_id = s.id
     WHERE p.envio_id = $1`, [envioId]);
  let peso = parseFloat(q.rows[0].peso) || 0;
  let vol = parseFloat(q.rows[0].vol) || 0;
  if (extraSolicitudId) {
    const e = await pool.query('SELECT peso_total, volumen_total FROM solicitud_transporte WHERE id=$1', [extraSolicitudId]);
    if (e.rows[0]) { peso += parseFloat(e.rows[0].peso_total) || 0; vol += parseFloat(e.rows[0].volumen_total) || 0; }
  }
  return { peso, vol };
}

// Transiciones válidas (no retroceder; solo avanzar o anular).
const TRANSICIONES_ENVIO = { asignado: ['en_ruta', 'anulado'], en_ruta: ['entregado', 'anulado'], entregado: [], anulado: [] };

// PATCH estado del envío. asignado → en_ruta → entregado (o anular). Para 'entregado'
// exige que todas las paradas estén entregadas (POD registrado).
router.patch('/transporte/envios/:id/estado', requireTransporte, async (req, res) => {
  const { estado } = req.body;
  if (!['en_ruta', 'entregado', 'anulado'].includes(estado)) return res.status(400).json({ error: 'Estado destino inválido.' });
  try {
    const eq = await pool.query('SELECT * FROM envios WHERE id=$1', [req.params.id]);
    if (!eq.rows.length) return res.status(404).json({ error: 'Envío no encontrado.' });
    const env = eq.rows[0];
    if (!TRANSICIONES_ENVIO[env.estado].includes(estado))
      return res.status(409).json({ error: `Transición inválida: '${env.estado}' → '${estado}'.` });
    if (estado === 'entregado') {
      const pend = await pool.query("SELECT COUNT(*)::int AS n FROM envio_paradas WHERE envio_id=$1 AND estado<>'entregada'", [req.params.id]);
      if (pend.rows[0].n > 0) return res.status(409).json({ error: `Faltan ${pend.rows[0].n} parada(s) por entregar (POD) antes de cerrar el envío.` });
    }
    await pool.query('UPDATE envios SET estado=$1 WHERE id=$2', [estado, req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

// POST consolidar: agrega una parada al envío (de una solicitud pendiente o carga
// suelta). El aviso de capacidad suma la carga consolidada de TODAS las paradas.
router.post('/transporte/envios/:id/paradas', requireTransporte, async (req, res) => {
  const { solicitud_transporte_id, cliente_ref, destino, carga_desc, confirmar } = req.body;
  try {
    const eq = await pool.query('SELECT * FROM envios WHERE id=$1', [req.params.id]);
    if (!eq.rows.length) return res.status(404).json({ error: 'Envío no encontrado.' });
    const env = eq.rows[0];
    if (['entregado', 'anulado'].includes(env.estado)) return res.status(409).json({ error: `El envío está '${env.estado}'; no admite nuevas paradas.` });

    let sol = null;
    if (solicitud_transporte_id) {
      const sq = await pool.query('SELECT * FROM solicitud_transporte WHERE id=$1', [solicitud_transporte_id]);
      if (!sq.rows.length) return res.status(404).json({ error: 'Solicitud no encontrada.' });
      sol = sq.rows[0];
      if (sol.estado !== 'pendiente') return res.status(409).json({ error: `La solicitud está '${sol.estado}', no se puede consolidar.` });
    } else if (!destino && !cliente_ref && !carga_desc) {
      return res.status(400).json({ error: 'Indique una solicitud o los datos de la carga suelta.' });
    }

    const vq = await pool.query('SELECT * FROM vehiculos WHERE id=$1', [env.vehiculo_id]);
    const carga = await cargaConsolidada(req.params.id, solicitud_transporte_id);
    const avisos = avisosCapacidad(vq.rows[0] || {}, carga.peso, carga.vol);
    if (avisos.length && !confirmar) return res.json({ requiere_confirmacion: true, avisos, carga_consolidada: carga });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const ord = await client.query('SELECT COALESCE(MAX(orden),0)+1 AS n FROM envio_paradas WHERE envio_id=$1', [req.params.id]);
      const dest = destino || sol?.destino || null;
      const cargaD = carga_desc || (sol ? `${sol.n_cajas || 0} cajas, ${sol.n_cajones || 0} cajones, ${sol.n_pallets || 0} pallets` : null);
      const cliRef = cliente_ref || sol?.client_id || sol?.cliente_transporte_id || null;
      await client.query(
        `INSERT INTO envio_paradas (envio_id, orden, solicitud_transporte_id, cliente_ref, destino, carga_desc)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [req.params.id, ord.rows[0].n, solicitud_transporte_id || null, cliRef, dest, cargaD]);
      if (sol) await client.query(`UPDATE solicitud_transporte SET estado='asignada' WHERE id=$1`, [sol.id]);
      await client.query('COMMIT');
      res.json({ success: true, avisos });
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

// PATCH reordenar paradas (ruta). orden = arreglo de ids de parada en el orden deseado.
router.patch('/transporte/envios/:id/paradas/reordenar', requireTransporte, async (req, res) => {
  const { orden } = req.body;
  if (!Array.isArray(orden) || orden.length === 0) return res.status(400).json({ error: 'orden debe ser un arreglo de ids de parada.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (let idx = 0; idx < orden.length; idx++) {
      const item = orden[idx];
      const pid = typeof item === 'object' ? item.id : item;
      const ord = (typeof item === 'object' && item.orden != null) ? item.orden : idx + 1;
      await client.query('UPDATE envio_paradas SET orden=$1 WHERE id=$2 AND envio_id=$3', [ord, pid, req.params.id]);
    }
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (e) { await client.query('ROLLBACK'); res.status(500).json({ error: mapDbError(e) }); }
  finally { client.release(); }
});

// POST POD de una parada (SOLO TEXTO: receptor + observaciones + fecha/hora auto).
// Exige envío 'en_ruta' y entrega EN SECUENCIA (no saltar paradas anteriores).
router.post('/transporte/envios/:id/paradas/:paradaId/pod', requireTransporte, async (req, res) => {
  const { pod_receptor, pod_observaciones } = req.body;
  if (!pod_receptor || !String(pod_receptor).trim()) return res.status(400).json({ error: 'El receptor del POD es obligatorio.' });
  try {
    const eq = await pool.query('SELECT * FROM envios WHERE id=$1', [req.params.id]);
    if (!eq.rows.length) return res.status(404).json({ error: 'Envío no encontrado.' });
    if (eq.rows[0].estado !== 'en_ruta') return res.status(409).json({ error: "Marque el envío 'en ruta' antes de registrar entregas (POD)." });
    const pq = await pool.query('SELECT * FROM envio_paradas WHERE id=$1 AND envio_id=$2', [req.params.paradaId, req.params.id]);
    if (!pq.rows.length) return res.status(404).json({ error: 'Parada no encontrada.' });
    const parada = pq.rows[0];
    if (parada.estado === 'entregada') return res.status(409).json({ error: 'La parada ya tiene POD registrado.' });
    const prev = await pool.query("SELECT COUNT(*)::int AS n FROM envio_paradas WHERE envio_id=$1 AND orden<$2 AND estado<>'entregada'", [req.params.id, parada.orden]);
    if (prev.rows[0].n > 0) return res.status(409).json({ error: 'Hay paradas anteriores sin POD. Las paradas se entregan en secuencia.' });
    await pool.query(
      `UPDATE envio_paradas SET estado='entregada', pod_receptor=$1, pod_observaciones=$2, pod_fecha_hora=NOW() WHERE id=$3`,
      [pod_receptor, pod_observaciones || null, req.params.paradaId]);
    // Fase 7: si la parada viene de un despacho (Origen A), el POD lo habilita para
    // cierre. El cierre en sí es MANUAL por bodega (EJECUTIVO_CUENTA+).
    let despacho_habilitado = null;
    if (parada.solicitud_transporte_id) {
      const sol = await pool.query('SELECT despacho_id FROM solicitud_transporte WHERE id=$1', [parada.solicitud_transporte_id]);
      const despachoId = sol.rows[0]?.despacho_id;
      if (despachoId) {
        const upd = await pool.query(
          `UPDATE dispatch_schedules SET status='habilitado_para_cierre', pod_confirmado_at=NOW()
           WHERE id=$1 AND requiere_transporte=TRUE AND status<>'CERRADO' RETURNING id`, [despachoId]);
        if (upd.rowCount) despacho_habilitado = despachoId;
      }
    }
    res.json({ success: true, despacho_habilitado });
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── CIERRE DEL DESPACHO POR POD (Fase 7) ────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// Despachos (Origen A) gestionados por transporte — para que bodega vea el estado
// y cierre los que tengan POD confirmado. requireAuth (lo ven bodega y coordinador).
router.get('/transporte/despachos', requireAuth, async (req, res) => {
  try {
    const { status } = req.query;
    const cond = ['requiere_transporte = TRUE'], params = []; let i = 1;
    if (status) { cond.push(`status = $${i++}`); params.push(status); }
    const rows = await pool.query(
      `SELECT ds.*, c.name AS cliente_nombre,
              a.envio_id, a.envio_estado, a.fecha_hora_confirmada,
              a.transportista_nombre, a.vehiculo_matricula, a.vehiculo_tipo, a.chofer_nombre
       FROM dispatch_schedules ds
       LEFT JOIN clients c ON ds.client_id = c.id
       LEFT JOIN LATERAL (
         SELECT e.id AS envio_id, e.estado AS envio_estado, e.fecha_hora_confirmada,
                tr.nombre_razon_social AS transportista_nombre,
                v.matricula AS vehiculo_matricula, v.tipo_vehiculo AS vehiculo_tipo,
                ch.nombre AS chofer_nombre
         FROM solicitud_transporte s
         JOIN envio_paradas ep ON ep.solicitud_transporte_id = s.id
         JOIN envios e ON e.id = ep.envio_id
         LEFT JOIN transportistas tr ON tr.id = e.transportista_id
         LEFT JOIN vehiculos v ON v.id = e.vehiculo_id
         LEFT JOIN choferes ch ON ch.id = e.chofer_id
         WHERE s.despacho_id = ds.id
         ORDER BY e.created_at DESC LIMIT 1
       ) a ON TRUE
       WHERE ${cond.join(' AND ')} ORDER BY ds.scheduled_date DESC, ds.created_at DESC LIMIT 300`, params);
    res.json(rows.rows);
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

// Cierre MANUAL del despacho por bodega (EJECUTIVO_CUENTA+). Solo si el POD ya está
// confirmado (status='habilitado_para_cierre'); de lo contrario 409. El COORDINADOR
// de transporte NO cierra (requireStockWrite no lo incluye).
router.post('/transporte/despachos/:id/cerrar', requireStockWrite, async (req, res) => {
  try {
    const dq = await pool.query('SELECT * FROM dispatch_schedules WHERE id=$1', [req.params.id]);
    if (!dq.rows.length) return res.status(404).json({ error: 'Despacho no encontrado.' });
    const ds = dq.rows[0];
    if (!ds.requiere_transporte) return res.status(409).json({ error: 'Este despacho no es gestionado por transporte; ciérrelo por el flujo normal de bodega.' });
    if (ds.status === 'CERRADO') return res.status(409).json({ error: 'El despacho ya está cerrado.' });
    if (ds.status !== 'habilitado_para_cierre')
      return res.status(409).json({ error: 'No se puede cerrar: el POD de transporte aún no está confirmado para este despacho.' });
    await pool.query(`UPDATE dispatch_schedules SET status='CERRADO', closed_by=$1, closed_at=NOW() WHERE id=$2`, [req.user.username, req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── AVISO DE LLEGADA INBOUND (Fase 8) ───────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// GET avisos — bodega y coordinador. Filtro por estado.
router.get('/transporte/avisos-llegada', requireAuth, async (req, res) => {
  try {
    const { estado } = req.query;
    const cond = [], params = []; let i = 1;
    if (estado) { cond.push(`a.estado=$${i++}`); params.push(estado); }
    const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
    const rows = await pool.query(
      `SELECT a.*, t.nombre_razon_social AS transportista_nombre, c.name AS cliente_nombre
       FROM aviso_llegada a
       LEFT JOIN transportistas t ON a.transportista_id = t.id
       LEFT JOIN clients c ON a.client_id = c.id
       ${where} ORDER BY a.hora_estimada_llegada ASC NULLS LAST, a.created_at DESC LIMIT 300`, params);
    res.json(rows.rows);
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

// POST aviso — lo crea el COORDINADOR (carga que se almacenará en bodega).
router.post('/transporte/avisos-llegada', requireTransporte, async (req, res) => {
  const { vehiculo_desc, transportista_id, carga_desc, client_id, hora_estimada_llegada, contenedor_id } = req.body;
  if (!carga_desc && !vehiculo_desc) return res.status(400).json({ error: 'Indique al menos la carga o el vehículo.' });
  const id = genLpnId('AVL');
  try {
    await pool.query(
      `INSERT INTO aviso_llegada (id, vehiculo_desc, transportista_id, carga_desc, client_id, hora_estimada_llegada, contenedor_id, usuario_coordinador)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, vehiculo_desc || null, transportista_id || null, carga_desc || null, client_id || null,
       hora_estimada_llegada || null, contenedor_id || null, req.user.username]);
    res.json({ success: true, id });
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

// PATCH aviso (coordinador edita mientras está 'avisado').
router.patch('/transporte/avisos-llegada/:id', requireTransporte, async (req, res) => {
  const { vehiculo_desc, transportista_id, carga_desc, client_id, hora_estimada_llegada, contenedor_id } = req.body;
  try {
    const cur = await pool.query('SELECT * FROM aviso_llegada WHERE id=$1', [req.params.id]);
    if (!cur.rows.length) return res.status(404).json({ error: 'Aviso no encontrado.' });
    const r = cur.rows[0];
    if (r.estado !== 'avisado') return res.status(409).json({ error: 'El aviso ya fue recibido/almacenado por bodega; no se puede editar.' });
    await pool.query(
      `UPDATE aviso_llegada SET vehiculo_desc=$1, transportista_id=$2, carga_desc=$3, client_id=$4, hora_estimada_llegada=$5, contenedor_id=$6 WHERE id=$7`,
      [vehiculo_desc !== undefined ? vehiculo_desc : r.vehiculo_desc,
       transportista_id !== undefined ? (transportista_id || null) : r.transportista_id,
       carga_desc !== undefined ? carga_desc : r.carga_desc,
       client_id !== undefined ? (client_id || null) : r.client_id,
       hora_estimada_llegada !== undefined ? (hora_estimada_llegada || null) : r.hora_estimada_llegada,
       contenedor_id !== undefined ? (contenedor_id || null) : r.contenedor_id, req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

// PATCH estado — BODEGA avanza avisado→recibido→almacenado (requireStockWrite).
router.patch('/transporte/avisos-llegada/:id/estado', requireStockWrite, async (req, res) => {
  const { estado } = req.body;
  if (!['recibido', 'almacenado'].includes(estado)) return res.status(400).json({ error: 'Estado destino inválido.' });
  const TR = { avisado: ['recibido'], recibido: ['almacenado'], almacenado: [] };
  try {
    const cur = await pool.query('SELECT * FROM aviso_llegada WHERE id=$1', [req.params.id]);
    if (!cur.rows.length) return res.status(404).json({ error: 'Aviso no encontrado.' });
    if (!TR[cur.rows[0].estado].includes(estado))
      return res.status(409).json({ error: `Transición inválida: '${cur.rows[0].estado}' → '${estado}'.` });
    await pool.query('UPDATE aviso_llegada SET estado=$1 WHERE id=$2', [estado, req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

// DELETE aviso (coordinador, solo mientras está 'avisado').
router.delete('/transporte/avisos-llegada/:id', requireTransporte, async (req, res) => {
  try {
    const r = await pool.query("DELETE FROM aviso_llegada WHERE id=$1 AND estado='avisado' RETURNING id", [req.params.id]);
    if (!r.rowCount) return res.status(409).json({ error: 'Solo se puede eliminar un aviso aún no recibido.' });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── CONTENEDORES (Fase 9) ───────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

const ESTADOS_CONTENEDOR = ['en_puerto', 'en_transito', 'en_bodega', 'devuelto_naviera'];

router.get('/transporte/contenedores', requireAuth, async (req, res) => {
  try {
    const { sentido, estado } = req.query;
    const cond = [], params = []; let i = 1;
    if (sentido) { cond.push(`co.sentido=$${i++}`); params.push(sentido); }
    if (estado) { cond.push(`co.estado=$${i++}`); params.push(estado); }
    const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
    const rows = await pool.query(
      `SELECT co.*, a.vehiculo_desc AS aviso_desc
       FROM contenedores co LEFT JOIN aviso_llegada a ON co.aviso_llegada_id = a.id
       ${where} ORDER BY co.created_at DESC LIMIT 300`, params);
    res.json(rows.rows);
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

router.get('/transporte/contenedores/:id', requireAuth, async (req, res) => {
  try {
    const co = await pool.query('SELECT * FROM contenedores WHERE id=$1', [req.params.id]);
    if (!co.rows.length) return res.status(404).json({ error: 'Contenedor no encontrado.' });
    const hist = await pool.query('SELECT * FROM contenedor_estados WHERE contenedor_id=$1 ORDER BY fecha DESC', [req.params.id]);
    res.json({ ...co.rows[0], historial: hist.rows });
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

router.post('/transporte/contenedores', requireTransporte, async (req, res) => {
  const { numero, tipo, sello, naviera, sentido, estado } = req.body;
  if (!numero) return res.status(400).json({ error: 'Número de contenedor requerido.' });
  if (!['EXPORT', 'IMPORT'].includes(sentido)) return res.status(400).json({ error: "sentido debe ser 'EXPORT' o 'IMPORT'." });
  if (tipo && !['20', '40', '40HC', 'REEFER'].includes(tipo)) return res.status(400).json({ error: 'Tipo de contenedor inválido.' });
  const est = estado && ESTADOS_CONTENEDOR.includes(estado) ? estado : 'en_puerto';
  const id = genLpnId('CNT');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO contenedores (id, numero, tipo, sello, naviera, sentido, estado, usuario) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, numero, tipo || null, sello || null, naviera || null, sentido, est, req.user.username]);
    await client.query(`INSERT INTO contenedor_estados (contenedor_id, estado, usuario) VALUES ($1,$2,$3)`, [id, est, req.user.username]);
    await client.query('COMMIT');
    res.json({ success: true, id });
  } catch (e) { await client.query('ROLLBACK'); res.status(500).json({ error: mapDbError(e) }); }
  finally { client.release(); }
});

// Cambiar estado del contenedor (registra historial; no se cambia tras devolución).
router.patch('/transporte/contenedores/:id/estado', requireTransporte, async (req, res) => {
  const { estado } = req.body;
  if (!ESTADOS_CONTENEDOR.includes(estado)) return res.status(400).json({ error: 'Estado inválido.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const co = await client.query('SELECT * FROM contenedores WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (!co.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Contenedor no encontrado.' }); }
    if (co.rows[0].estado === 'devuelto_naviera') { await client.query('ROLLBACK'); return res.status(409).json({ error: 'El contenedor ya fue devuelto a la naviera.' }); }
    await client.query('UPDATE contenedores SET estado=$1 WHERE id=$2', [estado, req.params.id]);
    await client.query(`INSERT INTO contenedor_estados (contenedor_id, estado, usuario) VALUES ($1,$2,$3)`, [req.params.id, estado, req.user.username]);
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (e) { await client.query('ROLLBACK'); res.status(500).json({ error: mapDbError(e) }); }
  finally { client.release(); }
});

// Asociar el contenedor a un envío (EXPORT) o a un aviso de llegada (IMPORT).
router.patch('/transporte/contenedores/:id/asociar', requireTransporte, async (req, res) => {
  const { envio_id, aviso_llegada_id } = req.body;
  try {
    const co = await pool.query('SELECT * FROM contenedores WHERE id=$1', [req.params.id]);
    if (!co.rows.length) return res.status(404).json({ error: 'Contenedor no encontrado.' });
    const cont = co.rows[0];
    if (envio_id) {
      if (cont.sentido !== 'EXPORT') return res.status(409).json({ error: 'Solo un contenedor EXPORT se asocia a un envío.' });
      const e = await pool.query('SELECT id FROM envios WHERE id=$1', [envio_id]);
      if (!e.rows.length) return res.status(404).json({ error: 'Envío no encontrado.' });
      await pool.query('UPDATE contenedores SET envio_id=$1 WHERE id=$2', [envio_id, req.params.id]);
    } else if (aviso_llegada_id) {
      if (cont.sentido !== 'IMPORT') return res.status(409).json({ error: 'Solo un contenedor IMPORT se asocia a un aviso de llegada.' });
      const a = await pool.query('SELECT id FROM aviso_llegada WHERE id=$1', [aviso_llegada_id]);
      if (!a.rows.length) return res.status(404).json({ error: 'Aviso de llegada no encontrado.' });
      await pool.query('UPDATE contenedores SET aviso_llegada_id=$1 WHERE id=$2', [aviso_llegada_id, req.params.id]);
      // Reflejar el contenedor en el aviso (trazabilidad inbound).
      await pool.query('UPDATE aviso_llegada SET contenedor_id=$1 WHERE id=$2', [req.params.id, aviso_llegada_id]);
    } else {
      return res.status(400).json({ error: 'Indique envio_id (EXPORT) o aviso_llegada_id (IMPORT).' });
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

module.exports = router;
