// KITTING v2 — flujo de ÓRDENES de armado (FASE 2: crear receta + orden).
// Receta = kits + kit_components (reutilizadas). Orden = kit_orden (pendiente→armado→desarmado).
//  - Crear/editar receta y crear orden: EJECUTIVO_CUENTA+ (requireStockWrite) dentro de sus clientes.
//  - Listar órdenes/detalle: PICKER+ (requirePicking) — el picker necesita ver lo pendiente.
const express = require('express');
const { pool, mapDbError, isUniqueViolation } = require('../db');
const { requireAuth, requireStockWrite, requirePicking, checkClientAccess, getClientesPermitidos } = require('../middleware');
const { genLpnId } = require('../helpers');
const { consumeComponentTracked } = require('../kitConsumo');

const router = express.Router();

// Scope de clientes del usuario: {} sin límite | {clients:[...]} | {block:true}.
async function scopeFilter(req) {
  if (['ADMIN', 'SUPERADMIN'].includes(req.user.role) || req.user.is_demo) return {};
  const perm = await getClientesPermitidos(req.user.username);
  if (perm.scope === 'all') return {};
  if (perm.scope === 'none' || !perm.clients?.length) return { block: true };
  return { clients: perm.clients };
}

// ¿La sugerencia calza con lo consumido? Solo se exigen los campos sugeridos no nulos.
function suggestionMatches(s, cc) {
  if (s.ubicacion && s.ubicacion !== cc.ubicacion) return false;
  if (s.lote && s.lote !== cc.lote) return false;
  if (s.serie && s.serie !== cc.serie) return false;
  return true;
}

// consumeComponentTracked vive ahora en ../kitConsumo (compartido con el Modo A).

// ── POST /kitting/receta ── define/edita la receta del kit + marca es_kit.
router.post('/kitting/receta', requireStockWrite, checkClientAccess('write', { required: true }), async (req, res) => {
  const { kit_sku, client_id, description, components } = req.body;
  if (!kit_sku || !client_id) return res.status(400).json({ error: 'kit_sku y client_id son requeridos.' });
  if (!Array.isArray(components) || components.length === 0) return res.status(400).json({ error: 'La receta debe tener al menos un componente.' });
  const kitU = String(kit_sku).trim().toUpperCase();
  const comps = [];
  for (let i = 0; i < components.length; i++) {
    const sku = String(components[i].sku || '').trim().toUpperCase();
    const qty = parseFloat(components[i].qty);
    if (!sku) return res.status(400).json({ error: `Componente ${i + 1}: SKU requerido.` });
    if (sku === kitU) return res.status(400).json({ error: 'Un kit no puede contener su propio SKU como componente.' });
    if (isNaN(qty) || qty <= 0) return res.status(400).json({ error: `Componente ${i + 1} (${sku}): la cantidad debe ser mayor a 0.` });
    comps.push({ sku, qty });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Los componentes SÍ deben existir como SKU del cliente (se arma con stock real).
    const compSkus = [...new Set(comps.map(c => c.sku))];
    const found = await client.query('SELECT sku FROM master_skus WHERE sku = ANY($1) AND client_id=$2 AND deleted_at IS NULL', [compSkus, client_id]);
    const foundSet = new Set(found.rows.map(r => r.sku));
    const missing = compSkus.filter(s => !foundSet.has(s));
    if (missing.length) { await client.query('ROLLBACK'); return res.status(400).json({ error: `Componente(s) inexistente(s) para el cliente: ${missing.join(', ')}` }); }
    // El SKU del kit se CREA aquí si no existe (es parte de definir el kit): se da de
    // alta en el maestro marcado es_kit. Si existía, solo se marca es_kit (y se reactiva).
    await client.query(
      `INSERT INTO master_skus (sku, client_id, "desc", uom, es_kit)
       VALUES ($1,$2,$3,'UN',TRUE)
       ON CONFLICT (sku, client_id) DO UPDATE SET es_kit=TRUE, deleted_at=NULL,
         "desc" = COALESCE(NULLIF(EXCLUDED."desc",''), master_skus."desc")`,
      [kitU, client_id, description || kitU]);
    await client.query(`INSERT INTO kits (kit_sku, client_id, description) VALUES ($1,$2,$3)
       ON CONFLICT (kit_sku, client_id) DO UPDATE SET description=EXCLUDED.description`, [kitU, client_id, description || null]);
    await client.query('DELETE FROM kit_components WHERE kit_sku=$1 AND kit_client_id=$2', [kitU, client_id]);
    for (const c of comps) {
      await client.query('INSERT INTO kit_components (kit_sku, kit_client_id, component_sku, qty) VALUES ($1,$2,$3,$4)', [kitU, client_id, c.sku, c.qty]);
    }
    await client.query('COMMIT');
    res.json({ success: true, kit_sku: kitU, client_id });
  } catch (e) { await client.query('ROLLBACK'); res.status(500).json({ error: mapDbError(e) }); }
  finally { client.release(); }
});

// ── GET /kitting/recetas ── lista de recetas (kits con componentes), con metadatos
// de cada componente (requiere serie/lote) para el armado. Scope por cliente.
router.get('/kitting/recetas', requireAuth, async (req, res) => {
  try {
    const sc = await scopeFilter(req);
    if (sc.block) return res.json([]);
    const conds = ['EXISTS (SELECT 1 FROM kit_components kc WHERE kc.kit_sku=k.kit_sku AND kc.kit_client_id=k.client_id)'];
    const params = [];
    let idx = 1;
    if (req.query.client_id) { conds.push(`k.client_id = $${idx++}`); params.push(String(req.query.client_id)); }
    if (sc.clients) { conds.push(`k.client_id = ANY($${idx++})`); params.push(sc.clients); }
    const rows = (await pool.query(
      `SELECT k.kit_sku, k.client_id, k.description, km.desc AS kit_desc,
              COALESCE(json_agg(json_build_object(
                'component_sku', kc.component_sku, 'qty', kc.qty, 'desc', cm.desc,
                'requires_serial', COALESCE(cm.requires_serial,false), 'requires_lot', COALESCE(cm.requires_lot,false)
              ) ORDER BY kc.component_sku) FILTER (WHERE kc.id IS NOT NULL), '[]') AS components
         FROM kits k
         JOIN kit_components kc ON kc.kit_sku=k.kit_sku AND kc.kit_client_id=k.client_id
         LEFT JOIN master_skus km ON km.sku=k.kit_sku AND km.client_id=k.client_id
         LEFT JOIN master_skus cm ON cm.sku=kc.component_sku AND cm.client_id=k.client_id
        WHERE ${conds.join(' AND ')}
        GROUP BY k.kit_sku, k.client_id, k.description, km.desc
        ORDER BY k.kit_sku ASC`,
      params
    )).rows;
    res.json(rows);
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

// ── DELETE /kitting/receta/:kit_sku/:client_id ── elimina la receta. Borra los
// componentes y la fila de kits, y quita la marca es_kit del maestro (el SKU NO se
// borra). Reemplaza al viejo DELETE /kits. No cascada sobre órdenes ya creadas.
router.delete('/kitting/receta/:kit_sku/:client_id', requireStockWrite, async (req, res) => {
  const kitU = String(req.params.kit_sku).trim().toUpperCase();
  const clientId = String(req.params.client_id);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const sc = await scopeFilter(req);
    if (sc.block || (sc.clients && !sc.clients.includes(clientId))) { await client.query('ROLLBACK'); return res.status(403).json({ error: 'Sin permiso sobre el cliente.' }); }
    await client.query('DELETE FROM kit_components WHERE kit_sku=$1 AND kit_client_id=$2', [kitU, clientId]);
    const del = await client.query('DELETE FROM kits WHERE kit_sku=$1 AND client_id=$2', [kitU, clientId]);
    if (del.rowCount === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Kit no encontrado.' }); }
    await client.query('UPDATE master_skus SET es_kit=FALSE WHERE sku=$1 AND client_id=$2', [kitU, clientId]);
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (e) { await client.query('ROLLBACK'); res.status(500).json({ error: mapDbError(e) }); }
  finally { client.release(); }
});

// ── GET /kitting/disponibilidad ── disponibilidad de un kit (Modo A: agregar una línea
// de kit a un despacho normal). Por componente devuelve stock y LPN (FEFO) para elegir
// origen. Reemplaza al viejo GET /kit-availability.
router.get('/kitting/disponibilidad', requireAuth, async (req, res) => {
  const { kit_sku, client_id, qty } = req.query;
  if (!kit_sku || !client_id) return res.status(400).json({ error: 'kit_sku y client_id requeridos.' });
  try {
    const qtyN = parseInt(qty) || 1;
    const components = await pool.query('SELECT * FROM kit_components WHERE kit_sku=$1 AND kit_client_id=$2', [kit_sku, client_id]);
    // Una sola query para todos los componentes en vez de una por componente.
    const compSkus = components.rows.map(c => c.component_sku);
    const allLpns = compSkus.length ? (await pool.query(
      `SELECT i.sku, i.id, i.location_id, i.batch_number, i.serial_number, i.expiry_date, i.qty
         FROM inventory_lpns i LEFT JOIN statuses st ON i.status = st.id
        WHERE i.sku = ANY($1) AND i.client_id=$2 AND i.qty>0 AND COALESCE(st.blocks_outbound, FALSE) = FALSE
        ORDER BY i.expiry_date ASC NULLS LAST, i.created_at ASC`,
      [compSkus, client_id])).rows : [];
    const lpnsBySku = new Map();
    for (const r of allLpns) {
      if (!lpnsBySku.has(r.sku)) lpnsBySku.set(r.sku, []);
      lpnsBySku.get(r.sku).push({ id: r.id, location_id: r.location_id, batch_number: r.batch_number, serial_number: r.serial_number, expiry_date: r.expiry_date, qty: r.qty });
    }
    let maxKits = Infinity;
    const result = [];
    for (const comp of components.rows) {
      const lpnRows = lpnsBySku.get(comp.component_sku) || [];
      const available = lpnRows.reduce((s, r) => s + parseFloat(r.qty), 0);
      const needed = parseFloat(comp.qty) * qtyN;
      const possible = comp.qty > 0 ? Math.floor(available / comp.qty) : 0;
      maxKits = Math.min(maxKits, possible);
      result.push({ component_sku: comp.component_sku, required_per_kit: parseFloat(comp.qty), needed, available, kits_possible: possible, lpns: lpnRows });
    }
    const canBuild = result.length > 0 && result.every(c => c.available >= c.needed);
    res.json({ components: result, max_kits: maxKits === Infinity ? 0 : maxKits, can_build: canBuild });
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

// ── POST /kitting/ordenes ── crea orden de armado 'pendiente' (+ origen sugerido).
router.post('/kitting/ordenes', requireStockWrite, checkClientAccess('write', { required: true }), async (req, res) => {
  const { kit_sku, client_id, cantidad_kits, sugeridos, notas } = req.body;
  if (!kit_sku || !client_id) return res.status(400).json({ error: 'kit_sku y client_id son requeridos.' });
  const n = parseInt(cantidad_kits);
  if (isNaN(n) || n < 1) return res.status(400).json({ error: 'cantidad_kits debe ser un entero ≥ 1.' });
  const kitU = String(kit_sku).trim().toUpperCase();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const comps = await client.query('SELECT component_sku FROM kit_components WHERE kit_sku=$1 AND kit_client_id=$2', [kitU, client_id]);
    if (!comps.rows.length) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'El kit no tiene receta definida para este cliente.' }); }
    const id = genLpnId('KOR');
    await client.query(
      `INSERT INTO kit_orden (id, kit_sku, client_id, cantidad_kits, estado, usuario_creador, notas)
       VALUES ($1,$2,$3,$4,'pendiente',$5,$6)`,
      [id, kitU, client_id, n, req.user.username, notas || null]
    );
    if (Array.isArray(sugeridos)) {
      const recetaSkus = new Set(comps.rows.map(r => r.component_sku));
      for (const s of sugeridos) {
        const cs = String(s.componente_sku || '').trim().toUpperCase();
        if (!cs || !recetaSkus.has(cs)) continue; // ignora sugerencias fuera de la receta
        if (!s.ubicacion && !s.lote && !s.serie && s.cantidad == null) continue; // fila vacía
        await client.query(
          `INSERT INTO kit_origen_sugerido (kit_orden_id, componente_sku, ubicacion, lote, serie, cantidad)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [id, cs, s.ubicacion || null, s.lote || null, s.serie || null, s.cantidad != null && s.cantidad !== '' ? parseFloat(s.cantidad) : null]
        );
      }
    }
    await client.query('COMMIT');
    res.json({ success: true, id });
  } catch (e) {
    await client.query('ROLLBACK');
    if (isUniqueViolation(e)) return res.status(409).json({ error: 'La orden ya existe.' });
    res.status(500).json({ error: mapDbError(e) });
  } finally { client.release(); }
});

// ── GET /kitting/ordenes ── lista de órdenes (scope por cliente). PICKER+.
router.get('/kitting/ordenes', requirePicking, async (req, res) => {
  try {
    const sc = await scopeFilter(req);
    if (sc.block) return res.json([]);
    const conds = [];
    const params = [];
    let idx = 1;
    if (req.query.estado) { conds.push(`o.estado = $${idx++}`); params.push(String(req.query.estado)); }
    if (req.query.client_id) { conds.push(`o.client_id = $${idx++}`); params.push(String(req.query.client_id)); }
    if (sc.clients) { conds.push(`o.client_id = ANY($${idx++})`); params.push(sc.clients); }
    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
    const rows = (await pool.query(
      `SELECT o.*, km.desc AS kit_desc, cl.name AS client_name
         FROM kit_orden o
         LEFT JOIN master_skus km ON km.sku=o.kit_sku AND km.client_id=o.client_id
         LEFT JOIN clients cl ON cl.id=o.client_id
         ${where}
        ORDER BY o.created_at DESC LIMIT 200`,
      params
    )).rows;
    res.json(rows);
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

// ── GET /kitting/ordenes/:id ── detalle: receta (necesario por componente),
// origen sugerido, consumido (si armado) y stock del kit. PICKER+ con scope.
router.get('/kitting/ordenes/:id', requirePicking, async (req, res) => {
  try {
    const ord = (await pool.query(
      `SELECT o.*, km.desc AS kit_desc, cl.name AS client_name
         FROM kit_orden o
         LEFT JOIN master_skus km ON km.sku=o.kit_sku AND km.client_id=o.client_id
         LEFT JOIN clients cl ON cl.id=o.client_id
        WHERE o.id=$1`, [req.params.id])).rows[0];
    if (!ord) return res.status(404).json({ error: 'Orden no encontrada.' });
    const sc = await scopeFilter(req);
    if (sc.block || (sc.clients && !sc.clients.includes(ord.client_id))) return res.status(403).json({ error: 'Sin permiso sobre el cliente de la orden.' });

    const receta = (await pool.query(
      `SELECT kc.component_sku, kc.qty AS qty_por_kit, (kc.qty * $3) AS qty_necesaria,
              cm.desc, COALESCE(cm.requires_serial,false) AS requires_serial, COALESCE(cm.requires_lot,false) AS requires_lot
         FROM kit_components kc
         LEFT JOIN master_skus cm ON cm.sku=kc.component_sku AND cm.client_id=$2
        WHERE kc.kit_sku=$1 AND kc.kit_client_id=$2
        ORDER BY kc.component_sku`,
      [ord.kit_sku, ord.client_id, ord.cantidad_kits])).rows;
    // LPN disponibles por componente (FEFO) para que el picker elija/escanee.
    // Una sola query para todos los componentes en vez de una por componente.
    const recetaSkus = receta.map(r => r.component_sku);
    const allLpns = recetaSkus.length ? (await pool.query(
      `SELECT i.sku, i.id, i.location_id, i.batch_number, i.serial_number, i.expiry_date, i.qty
         FROM inventory_lpns i LEFT JOIN statuses st ON i.status = st.id
        WHERE i.sku = ANY($1) AND i.client_id=$2 AND i.qty>0 AND COALESCE(st.blocks_outbound, FALSE) = FALSE
        ORDER BY i.expiry_date ASC NULLS LAST, i.created_at ASC`,
      [recetaSkus, ord.client_id])).rows : [];
    const lpnsBySku = new Map();
    for (const l of allLpns) {
      if (!lpnsBySku.has(l.sku)) lpnsBySku.set(l.sku, []);
      lpnsBySku.get(l.sku).push({ id: l.id, location_id: l.location_id, batch_number: l.batch_number, serial_number: l.serial_number, expiry_date: l.expiry_date, qty: l.qty });
    }
    for (const r of receta) {
      r.lpns = lpnsBySku.get(r.component_sku) || [];
      r.disponible = r.lpns.reduce((s, l) => s + parseFloat(l.qty), 0);
    }
    const sugeridos = (await pool.query('SELECT * FROM kit_origen_sugerido WHERE kit_orden_id=$1 ORDER BY componente_sku', [ord.id])).rows;
    const consumidos = (await pool.query('SELECT * FROM kit_componente_consumido WHERE kit_orden_id=$1 ORDER BY componente_sku', [ord.id])).rows;
    const stock = (await pool.query('SELECT * FROM kit_stock WHERE kit_orden_id=$1', [ord.id])).rows;
    res.json({ orden: ord, receta, sugeridos, consumidos, kit_stock: stock });
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

// ── POST /kitting/ordenes/:id/armar ── el PICKER arma la orden 'pendiente'.
// body: { consumos: { [componente_sku]: [{ lpn_id, qty }] }, kit_ubicacion, kit_lote, kit_serie }.
// Un componente sin picks se arma por FEFO. Descuenta (FOR UPDATE, sin negativo),
// registra origen FINAL (marcando difiere_de_sugerido), crea un LPN REAL del kit en
// inventory_lpns (despachable por el flujo normal) + registro histórico en kit_stock,
// y pasa a 'armado'.
router.post('/kitting/ordenes/:id/armar', requirePicking, async (req, res) => {
  const { consumos, kit_ubicacion, kit_lote, kit_serie } = req.body || {};
  const src = (consumos && typeof consumos === 'object') ? consumos : {};
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ordRes = await client.query('SELECT * FROM kit_orden WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (!ordRes.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Orden no encontrada.' }); }
    const ord = ordRes.rows[0];
    const sc = await scopeFilter(req);
    if (sc.block || (sc.clients && !sc.clients.includes(ord.client_id))) { await client.query('ROLLBACK'); return res.status(403).json({ error: 'Sin permiso sobre el cliente de la orden.' }); }
    if (ord.estado !== 'pendiente') { await client.query('ROLLBACK'); return res.status(409).json({ error: `La orden está '${ord.estado}'; solo se puede armar una 'pendiente'.` }); }

    const receta = (await client.query(
      `SELECT kc.component_sku, kc.qty,
              COALESCE(cm.requires_serial,false) AS rs, COALESCE(cm.requires_lot,false) AS rl
         FROM kit_components kc
         LEFT JOIN master_skus cm ON cm.sku=kc.component_sku AND cm.client_id=$2
        WHERE kc.kit_sku=$1 AND kc.kit_client_id=$2`,
      [ord.kit_sku, ord.client_id])).rows;
    if (!receta.length) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'El kit no tiene receta.' }); }

    const sug = (await client.query('SELECT * FROM kit_origen_sugerido WHERE kit_orden_id=$1', [ord.id])).rows;
    const sugByComp = {};
    sug.forEach(s => { (sugByComp[s.componente_sku] = sugByComp[s.componente_sku] || []).push(s); });

    const touchedAll = [];
    const resumen = [];
    for (const comp of receta) {
      const needed = parseFloat(comp.qty) * ord.cantidad_kits;
      const picks = src[comp.component_sku];
      const isManual = Array.isArray(picks) && picks.length > 0;
      const { touched, consumed } = await consumeComponentTracked(client, {
        compSku: comp.component_sku, needed, clientId: ord.client_id,
        picks, requiresSerial: comp.rs, requiresLot: comp.rl,
      });
      touchedAll.push(...touched);
      for (const cc of consumed) {
        const sl = sugByComp[comp.component_sku];
        const difiere = (sl && sl.length) ? !sl.some(s => suggestionMatches(s, cc)) : false;
        await client.query(
          `INSERT INTO kit_componente_consumido
             (kit_orden_id, componente_sku, cantidad, ubicacion, lote, serie, lpn_origen, difiere_de_sugerido, origen_tipo, origen_id, modo_origen, client_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'orden_armado',$9,$10,$11)`,
          [ord.id, comp.component_sku, cc.cantidad, cc.ubicacion, cc.lote, cc.serie, cc.lpn_id, difiere, ord.id, isManual ? 'manual' : 'auto', ord.client_id]);
        // Kardex: un movimiento de salida por línea de componente consumida.
        await client.query(
          `INSERT INTO audit_log(type,sku,qty,glosa,username) VALUES('ADJUST_OUT',$1,$2,$3,$4)`,
          [comp.component_sku, cc.cantidad, `[KIT ARMADO] Orden ${ord.id} (${ord.cantidad_kits}x ${ord.kit_sku}) | LPN origen: ${cc.lpn_id}`, req.user.username]);
      }
      resumen.push({ componente_sku: comp.component_sku, consumido: consumed });
    }
    if (touchedAll.length) await client.query('DELETE FROM inventory_lpns WHERE id = ANY($1::varchar[]) AND qty <= 0', [touchedAll]);

    // El kit armado entra como LPN REAL de inventario (sku = kit_sku, marcado es_kit en el
    // maestro), por lo que se despacha por el flujo normal sin lógica extra. kit_stock queda
    // como registro histórico de la orden, con el MISMO id que el LPN para poder cruzarlos.
    const ubic = (kit_ubicacion && String(kit_ubicacion).toUpperCase()) || 'PISO-RECEPCION';
    const ksId = genLpnId('KIT');
    await client.query(
      `INSERT INTO inventory_lpns(id,client_id,sku,qty,status,location_id,batch_number,serial_number,glosa)
       VALUES($1,$2,$3,$4,'DISPONIBLE',$5,$6,$7,$8)`,
      [ksId, ord.client_id, ord.kit_sku, ord.cantidad_kits, ubic, kit_lote || null, kit_serie || null, `Kit armado | Orden ${ord.id}`]);
    await client.query(
      `INSERT INTO kit_stock (id, kit_orden_id, kit_sku, client_id, cantidad, ubicacion, lote, serie, estado)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'disponible')`,
      [ksId, ord.id, ord.kit_sku, ord.client_id, ord.cantidad_kits, ubic, kit_lote || null, kit_serie || null]);
    await client.query(
      `INSERT INTO audit_log(type,sku,qty,glosa,username) VALUES('ADJUST_IN',$1,$2,$3,$4)`,
      [ord.kit_sku, ord.cantidad_kits, `[KIT ARMADO] Orden ${ord.id} | LPN ${ksId}`, req.user.username]);

    await client.query(`UPDATE kit_orden SET estado='armado', armado_por=$2, armado_at=NOW() WHERE id=$1`, [ord.id, req.user.username]);
    await client.query('COMMIT');
    res.json({ success: true, kit_stock_id: ksId, lpn_id: ksId, resumen });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(e.status || 500).json({ error: e.status ? e.message : mapDbError(e) });
  } finally { client.release(); }
});

// ── POST /kitting/ordenes/:id/desarmar ── EJECUTIVO_CUENTA+ revierte un armado.
// body: { destino_ubicacion } opcional (si no, reintegra a la ubicación de origen).
// Valida que la orden esté 'armado' y que el LPN del kit siga intacto en inventario (no
// despachado ni movido); consume ese LPN, reintegra cada componente con su lote/serie,
// marca el kit_stock 'desarmado', Kardex inverso, orden → 'desarmado'. Transacción + FOR UPDATE.
router.post('/kitting/ordenes/:id/desarmar', requireStockWrite, async (req, res) => {
  const dest = req.body && req.body.destino_ubicacion ? String(req.body.destino_ubicacion).trim().toUpperCase() : null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ordRes = await client.query('SELECT * FROM kit_orden WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (!ordRes.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Orden no encontrada.' }); }
    const ord = ordRes.rows[0];
    const sc = await scopeFilter(req);
    if (sc.block || (sc.clients && !sc.clients.includes(ord.client_id))) { await client.query('ROLLBACK'); return res.status(403).json({ error: 'Sin permiso sobre el cliente de la orden.' }); }
    if (ord.estado !== 'armado') { await client.query('ROLLBACK'); return res.status(409).json({ error: `La orden está '${ord.estado}'; solo se puede desarmar una 'armado'.` }); }

    const ks = (await client.query('SELECT * FROM kit_stock WHERE kit_orden_id=$1 FOR UPDATE', [ord.id])).rows;
    if (!ks.length) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'La orden no tiene stock de kit asociado.' }); }
    // El LPN del kit (mismo id que kit_stock) debe seguir intacto: si falta o tiene menos
    // cantidad, fue despachado o movido. kit_stock.estado puede estar desactualizado (el
    // despacho normal no lo toca), así que la verdad la da el inventario real.
    for (const k of ks) {
      const lpn = (await client.query('SELECT qty FROM inventory_lpns WHERE id=$1 FOR UPDATE', [k.id])).rows[0];
      if (!lpn || parseFloat(lpn.qty) < parseFloat(k.cantidad)) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'El kit ya fue despachado o movido; no se puede desarmar.' });
      }
    }

    const cons = (await client.query('SELECT * FROM kit_componente_consumido WHERE kit_orden_id=$1', [ord.id])).rows;
    if (!cons.length) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'No hay componentes consumidos para reintegrar.' }); }

    const reintegros = [];
    for (const cc of cons) {
      const target = dest || cc.ubicacion || 'PISO-RECEPCION';
      const newId = genLpnId('DESARM');
      await client.query(
        `INSERT INTO inventory_lpns(id,client_id,sku,qty,status,location_id,batch_number,serial_number,glosa)
         VALUES($1,$2,$3,$4,'DISPONIBLE',$5,$6,$7,$8)`,
        [newId, ord.client_id, cc.componente_sku, cc.cantidad, target, cc.lote || null, cc.serie || null, `Reintegro por desarme de orden ${ord.id}`]);
      await client.query(
        `INSERT INTO audit_log(type,sku,qty,glosa,username) VALUES('ADJUST_IN',$1,$2,$3,$4)`,
        [cc.componente_sku, cc.cantidad, `[KIT DESARMADO] Orden ${ord.id} | reintegro ${newId} → ${target}${cc.lote ? ` L:${cc.lote}` : ''}${cc.serie ? ` S/N:${cc.serie}` : ''}`, req.user.username]);
      reintegros.push({ componente_sku: cc.componente_sku, cantidad: parseFloat(cc.cantidad), ubicacion: target, lote: cc.lote, serie: cc.serie, lpn: newId });
    }
    // Consumir el LPN del kit, marcar el kit_stock 'desarmado' + Kardex de salida del kit.
    for (const k of ks) {
      await client.query('DELETE FROM inventory_lpns WHERE id=$1', [k.id]);
      await client.query(`UPDATE kit_stock SET estado='desarmado' WHERE id=$1`, [k.id]);
      await client.query(
        `INSERT INTO audit_log(type,sku,qty,glosa,username) VALUES('ADJUST_OUT',$1,$2,$3,$4)`,
        [ord.kit_sku, k.cantidad, `[KIT DESARMADO] Orden ${ord.id} | kit_stock ${k.id} consumido`, req.user.username]);
    }
    await client.query(`UPDATE kit_orden SET estado='desarmado', desarmado_por=$2, desarmado_at=NOW() WHERE id=$1`, [ord.id, req.user.username]);
    await client.query('COMMIT');
    res.json({ success: true, reintegros });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(e.status || 500).json({ error: e.status ? e.message : mapDbError(e) });
  } finally { client.release(); }
});

module.exports = router;
