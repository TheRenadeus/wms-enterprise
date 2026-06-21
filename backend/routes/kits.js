// Kits router: definición, disponibilidad, armado y despacho directo.
// Las transacciones de armado/despacho usan BEGIN/COMMIT/ROLLBACK con finally release
// (P2). NO descontar stock fuera de la transacción para no dejar saldos inconsistentes.
//
// ⚠️ DEPRECADO (consolidación Kitting → v2, Fase 1 · 2026-06-21).
// Este router es el sistema "viejo" de kitting. El sistema vigente es routes/kitting.js
// (recetas/órdenes con trazabilidad) + Modo A en server.js (kit explotado en el despacho).
// Equivalencias y plan de retiro (Fase 2):
//   GET  /kits             → GET  /kitting/recetas      (ya migrado el frontend)
//   POST /kits             → POST /kitting/receta
//   DELETE /kits/:k/:c     → DELETE /kitting/receta/:k/:c (ya migrado el frontend)
//   GET  /kit-availability → (disponibilidad la calcula GET /kitting/ordenes/:id)
//   POST /kit-build        → POST /kitting/ordenes + .../armar (arma a LPN real)
//   POST /kits/direct-dispatch → línea de kit (isKit) en POST /dispatch_batch (Modo A)
//   GET  /kit-orders       → GET  /kitting/ordenes
// Se mantiene operativo solo mientras las sub-tabs viejas (Armar/Despacho directo/
// Historial) sigan en la UI. Eliminar router + tablas kit_orders en Fase 2.

const express = require('express');
const { v4: uuidv4 } = require('uuid');

const { pool, mapDbError } = require('../db');
const { requireAuth, requireStockWrite, checkClientAccess } = require('../middleware');
const { validateBody, schemas } = require('../schemas');
const { genLpnId } = require('../helpers');

const router = express.Router();

// Consume `comp.qty * qtyN` del componente, dentro de una transacción YA ABIERTA.
//  - manualSources = [{ lpn_id, qty }]  → toma exactamente de esos LPN (el operador
//    eligió ubicación/lote/serie, porque el LPN ya las lleva). La suma debe ser exacta.
//  - sin manualSources → FEFO automático (expiry ASC, created ASC), como siempre.
// Bloquea filas con FOR UPDATE, nunca deja negativos y devuelve los ids de LPN que
// quedaron en 0 (para borrarlos de forma acotada). Lanza Error con .status si falla.
async function consumeComponent(client, { comp, qtyN, clientId, manualSources, auditType, glosaFor, username }) {
  const needed = parseFloat(comp.qty) * qtyN;
  const touched = [];

  if (Array.isArray(manualSources) && manualSources.length) {
    const sumSel = manualSources.reduce((s, x) => s + (parseFloat(x.qty) || 0), 0);
    if (Math.abs(sumSel - needed) > 1e-6) {
      const e = new Error(`Selección de origen inválida para ${comp.component_sku}: debe sumar exactamente ${needed} (seleccionaste ${sumSel}).`); e.status = 400; throw e;
    }
    for (const src of manualSources) {
      const take = parseFloat(src.qty);
      if (!(take > 0)) continue;
      const lock = await client.query(
        `SELECT i.id, i.qty, i.sku, i.client_id, COALESCE(st.blocks_outbound, FALSE) AS blocked
           FROM inventory_lpns i LEFT JOIN statuses st ON i.status = st.id
          WHERE i.id = $1 FOR UPDATE OF i`, [src.lpn_id]);
      if (!lock.rows.length) { const e = new Error(`LPN ${src.lpn_id} no encontrado.`); e.status = 404; throw e; }
      const row = lock.rows[0];
      if (row.sku !== comp.component_sku || (row.client_id || '') !== clientId) {
        const e = new Error(`LPN ${src.lpn_id} no corresponde al componente ${comp.component_sku} de este cliente.`); e.status = 400; throw e;
      }
      if (row.blocked) { const e = new Error(`LPN ${src.lpn_id} está en un estado que bloquea la salida.`); e.status = 400; throw e; }
      if (parseFloat(row.qty) < take) { const e = new Error(`LPN ${src.lpn_id}: stock insuficiente (${row.qty} < ${take}).`); e.status = 400; throw e; }
      const upd = await client.query('UPDATE inventory_lpns SET qty=qty-$1 WHERE id=$2 RETURNING qty', [take, src.lpn_id]);
      if (parseFloat(upd.rows[0].qty) <= 0) touched.push(src.lpn_id);
      await client.query('INSERT INTO audit_log(type,sku,qty,glosa,username) VALUES($1,$2,$3,$4,$5)',
        [auditType, comp.component_sku, take, glosaFor(src.lpn_id), username]);
    }
    return touched;
  }

  // Auto FEFO
  let remaining = needed;
  const eligibleIds = (await client.query(
    `SELECT i.id FROM inventory_lpns i LEFT JOIN statuses st ON i.status = st.id
      WHERE i.sku=$1 AND i.client_id=$2 AND i.qty>0 AND COALESCE(st.blocks_outbound, FALSE) = FALSE
      ORDER BY i.expiry_date ASC NULLS LAST, i.created_at ASC`,
    [comp.component_sku, clientId]
  )).rows.map(r => r.id);
  const lpns = eligibleIds.length === 0 ? { rows: [] } : await client.query(
    `SELECT id, qty FROM inventory_lpns WHERE id = ANY($1::varchar[])
      ORDER BY expiry_date ASC NULLS LAST, created_at ASC FOR UPDATE`,
    [eligibleIds]
  );
  for (const lpn of lpns.rows) {
    if (remaining <= 0) break;
    const take = Math.min(parseFloat(lpn.qty), remaining);
    const upd = await client.query('UPDATE inventory_lpns SET qty=qty-$1 WHERE id=$2 RETURNING qty', [take, lpn.id]);
    if (parseFloat(upd.rows[0].qty) <= 0) touched.push(lpn.id);
    await client.query('INSERT INTO audit_log(type,sku,qty,glosa,username) VALUES($1,$2,$3,$4,$5)',
      [auditType, comp.component_sku, take, glosaFor(lpn.id), username]);
    remaining -= take;
  }
  if (remaining > 0) {
    const e = new Error(`Stock insuficiente para ${comp.component_sku} al confirmar (condición de carrera). Reintente.`); e.status = 409; throw e;
  }
  return touched;
}

// ── CRUD básico de kits ─────────────────────────────────────────────────────
router.get('/kits', requireAuth, async (req, res) => {
  try {
    const rows = (await pool.query(`
      SELECT k.kit_sku, k.client_id, k.description,
        COALESCE(json_agg(json_build_object('id',kc.id,'kit_sku',kc.kit_sku,'kit_client_id',kc.kit_client_id,'component_sku',kc.component_sku,'qty',kc.qty) ORDER BY kc.component_sku) FILTER (WHERE kc.id IS NOT NULL), '[]') AS components
      FROM kits k
      LEFT JOIN kit_components kc ON kc.kit_sku = k.kit_sku AND kc.kit_client_id = k.client_id
      GROUP BY k.kit_sku, k.client_id, k.description
      ORDER BY k.kit_sku ASC
    `)).rows;
    res.json(rows);
  } catch (err) { res.status(500).json({ error: mapDbError(err) }); }
});

router.post('/kits', requireStockWrite, checkClientAccess('write', { required: true }), async (req, res) => {
  const { kit_sku, client_id, description, components } = req.body;
  if (!kit_sku || !client_id) return res.status(400).json({ error: 'kit_sku y client_id son requeridos' });
  if (!components || components.length === 0) return res.status(400).json({ error: 'El kit debe tener al menos un componente' });
  for (let i = 0; i < components.length; i++) {
    const qty = parseFloat(components[i].qty);
    if (isNaN(qty) || qty <= 0) return res.status(400).json({ error: `Componente ${i+1} (${components[i].sku || '?'}): la cantidad debe ser mayor a 0` });
    if (!components[i].sku || !String(components[i].sku).trim()) return res.status(400).json({ error: `Componente ${i+1}: SKU es requerido` });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`INSERT INTO kits (kit_sku, client_id, description) VALUES ($1, $2, $3) ON CONFLICT (kit_sku, client_id) DO UPDATE SET description=EXCLUDED.description`, [kit_sku.toUpperCase(), client_id, description]);
    await client.query('DELETE FROM kit_components WHERE kit_sku=$1 AND kit_client_id=$2', [kit_sku.toUpperCase(), client_id]);
    for (const c of components) {
      await client.query(`INSERT INTO kit_components (kit_sku, kit_client_id, component_sku, qty) VALUES ($1, $2, $3, $4)`, [kit_sku.toUpperCase(), client_id, c.sku, parseFloat(c.qty)]);
    }
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) { await client.query('ROLLBACK'); res.status(500).json({ error: mapDbError(err) }); }
  finally { client.release(); }
});

router.delete('/kits/:kit_sku/:client_id', requireStockWrite, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM kit_components WHERE kit_sku=$1 AND kit_client_id=$2', [req.params.kit_sku, req.params.client_id]);
    const result = await client.query('DELETE FROM kits WHERE kit_sku=$1 AND client_id=$2', [req.params.kit_sku, req.params.client_id]);
    if (result.rowCount === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Kit no encontrado' }); }
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) { await client.query('ROLLBACK'); res.status(500).json({ error: mapDbError(err) }); }
  finally { client.release(); }
});

// ── Disponibilidad ──────────────────────────────────────────────────────────
router.get('/kit-availability', requireAuth, async (req, res) => {
  const { kit_sku, client_id, qty } = req.query;
  if (!kit_sku || !client_id) return res.status(400).json({ error: 'kit_sku y client_id requeridos' });
  try {
    const qtyN = parseInt(qty) || 1;
    const components = await pool.query('SELECT * FROM kit_components WHERE kit_sku=$1 AND kit_client_id=$2', [kit_sku, client_id]);
    let maxKits = Infinity;
    const result = [];
    for (const comp of components.rows) {
      // Detalle por LPN (FEFO) para poder elegir origen: cada LPN lleva ubicación,
      // lote y serie. El SUM de disponibilidad se deriva de aquí.
      const lpnRows = (await pool.query(
        `SELECT i.id, i.location_id, i.batch_number, i.serial_number, i.expiry_date, i.qty
           FROM inventory_lpns i LEFT JOIN statuses st ON i.status = st.id
          WHERE i.sku=$1 AND i.client_id=$2 AND i.qty>0 AND COALESCE(st.blocks_outbound, FALSE) = FALSE
          ORDER BY i.expiry_date ASC NULLS LAST, i.created_at ASC`,
        [comp.component_sku, client_id]
      )).rows;
      const available = lpnRows.reduce((s, r) => s + parseFloat(r.qty), 0);
      const needed = parseFloat(comp.qty) * qtyN;
      const possible = comp.qty > 0 ? Math.floor(available / comp.qty) : 0;
      maxKits = Math.min(maxKits, possible);
      result.push({ component_sku: comp.component_sku, required_per_kit: parseFloat(comp.qty), needed, available, kits_possible: possible, lpns: lpnRows });
    }
    const canBuild = result.length > 0 && result.every(c => c.available >= c.needed);
    res.json({ components: result, max_kits: maxKits === Infinity ? 0 : maxKits, can_build: canBuild });
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});

router.get('/kit-orders', requireAuth, async (req, res) => {
  try { res.json((await pool.query('SELECT * FROM kit_orders ORDER BY created_at DESC LIMIT 200')).rows); }
  catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});

// ── Armado de kits ──────────────────────────────────────────────────────────
router.post('/kit-build', requireStockWrite, checkClientAccess('write'), validateBody(schemas.kitBuild), async (req, res) => {
  const { kit_sku, client_id, qty, location, username } = req.body;
  if (!kit_sku || !client_id || !qty || !username) return res.status(400).json({ error: 'Faltan parámetros' });
  const qtyN = parseInt(qty);
  if (qtyN < 1) return res.status(400).json({ error: 'Cantidad inválida' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const kit = await client.query('SELECT * FROM kits WHERE kit_sku=$1 AND client_id=$2', [kit_sku, client_id]);
    if (!kit.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Kit no encontrado' }); }
    const components = await client.query('SELECT * FROM kit_components WHERE kit_sku=$1 AND kit_client_id=$2', [kit_sku, client_id]);
    for (const comp of components.rows) {
      const s = await client.query(
        `SELECT COALESCE(SUM(i.qty),0) as total FROM inventory_lpns i
         LEFT JOIN statuses st ON i.status = st.id
         WHERE i.sku=$1 AND i.client_id=$2 AND i.qty>0 AND COALESCE(st.blocks_outbound, FALSE) = FALSE`,
        [comp.component_sku, client_id]
      );
      const needed = comp.qty * qtyN;
      if (parseFloat(s.rows[0].total) < needed) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Stock insuficiente: ${comp.component_sku} (disponible: ${s.rows[0].total}, requerido: ${needed})` });
      }
    }
    // sources: { [component_sku]: [{ lpn_id, qty }] } — opcional, por componente.
    // El que no venga en sources se arma por FEFO automático (mezcla permitida).
    const sources = (req.body && typeof req.body.sources === 'object' && req.body.sources) || {};
    const touchedLpns = [];
    for (const comp of components.rows) {
      const t = await consumeComponent(client, {
        comp, qtyN, clientId: client_id, manualSources: sources[comp.component_sku],
        auditType: 'ADJUST_OUT',
        glosaFor: (lpnId) => `[KIT] Componente para armar ${qtyN}x ${kit_sku} | LPN origen: ${lpnId}`,
        username,
      });
      touchedLpns.push(...t);
    }
    // Borrar SOLO los LPN que este armado dejó en 0 (no un DELETE global).
    if (touchedLpns.length > 0) await client.query('DELETE FROM inventory_lpns WHERE id = ANY($1::varchar[]) AND qty <= 0', [touchedLpns]);
    const newLpn = genLpnId('KIT');
    const loc = location || 'PISO-RECEPCION';
    await client.query('INSERT INTO inventory_lpns(id,client_id,sku,qty,status,location_id,glosa) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [newLpn, client_id, kit_sku, qtyN, 'DISPONIBLE', loc, `Kit armado por ${username}`]);
    await client.query('INSERT INTO audit_log(type,sku,qty,glosa,username) VALUES($1,$2,$3,$4,$5)',
      ['ADJUST_IN', kit_sku, qtyN, `[KIT] Armado ${qtyN}x ${kit_sku}`, username]);
    const orderId = `KO-${uuidv4().slice(0,8).toUpperCase()}`;
    await client.query('INSERT INTO kit_orders(id,kit_sku,client_id,qty_to_build,status,location_output,created_by,type,result_lpn) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [orderId, kit_sku, client_id, qtyN, 'COMPLETED', loc, username, 'BUILT', newLpn]);
    await client.query('COMMIT');
    res.json({ success: true, lpn: newLpn, order_id: orderId });
  } catch(e) { await client.query('ROLLBACK'); res.status(e.status || 500).json({ error: e.status ? e.message : mapDbError(e) }); }
  finally { client.release(); }
});

router.post('/kits/direct-dispatch', requireStockWrite, checkClientAccess('write', { required: true }), async (req, res) => {
  const { kit_sku, client_id, qty, doc_num, doc_type, glosa, username } = req.body;
  if (!kit_sku || !client_id || !qty || !username) return res.status(400).json({ error: 'Faltan parámetros' });
  const qtyN = parseInt(qty);
  if (qtyN < 1) return res.status(400).json({ error: 'Cantidad inválida' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const kit = await client.query('SELECT * FROM kits WHERE kit_sku=$1 AND client_id=$2', [kit_sku, client_id]);
    if (!kit.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Kit no encontrado' }); }
    const components = await client.query('SELECT * FROM kit_components WHERE kit_sku=$1 AND kit_client_id=$2', [kit_sku, client_id]);
    if (!components.rows.length) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'El kit no tiene componentes definidos' }); }

    for (const comp of components.rows) {
      const s = await client.query(
        `SELECT COALESCE(SUM(i.qty),0) as total FROM inventory_lpns i
         LEFT JOIN statuses st ON i.status = st.id
         WHERE i.sku=$1 AND i.client_id=$2 AND i.qty>0 AND COALESCE(st.blocks_outbound, FALSE) = FALSE`,
        [comp.component_sku, client_id]
      );
      const needed = comp.qty * qtyN;
      if (parseFloat(s.rows[0].total) < needed) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Stock insuficiente para componente ${comp.component_sku} (disponible: ${s.rows[0].total}, requerido: ${needed})` });
      }
    }

    // sources opcional por componente (igual que el armado): elegir LPN de origen o FEFO.
    const sources = (req.body && typeof req.body.sources === 'object' && req.body.sources) || {};
    const consumed = [];
    const touchedLpns = [];
    for (const comp of components.rows) {
      const t = await consumeComponent(client, {
        comp, qtyN, clientId: client_id, manualSources: sources[comp.component_sku],
        auditType: 'OUTBOUND',
        glosaFor: (lpnId) => `[KIT DIRECTO] ${qtyN}x ${kit_sku} | Doc: ${doc_num || 'S/N'} | LPN origen: ${lpnId} | ${glosa || ''}`,
        username,
      });
      touchedLpns.push(...t);
      consumed.push({ sku: comp.component_sku, qty_consumed: parseFloat(comp.qty) * qtyN });
    }

    await client.query('INSERT INTO audit_log(type,sku,qty,glosa,username) VALUES($1,$2,$3,$4,$5)',
      ['OUTBOUND', kit_sku, qtyN,
       `[KIT DIRECTO] ${doc_type || 'DESPACHO'} ${doc_num || 'S/N'} | ${glosa || ''}`, username]);

    // Borrar SOLO los LPN que este despacho dejó en 0 (no global).
    if (touchedLpns.length > 0) await client.query('DELETE FROM inventory_lpns WHERE id = ANY($1::varchar[]) AND qty <= 0', [touchedLpns]);

    const orderId = `KD-${uuidv4().slice(0,8).toUpperCase()}`;
    await client.query(
      `INSERT INTO kit_orders(id,kit_sku,client_id,qty_to_build,status,location_output,created_by,notes,type,result_lpn)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [orderId, kit_sku, client_id, qtyN, 'DISPATCHED', 'DESPACHO-DIRECTO', username,
       `Doc: ${doc_num || 'S/N'} | ${glosa || ''}`, 'DISPATCHED', null]
    );

    await client.query('COMMIT');
    res.json({ success: true, order_id: orderId, consumed });
  } catch(e) {
    await client.query('ROLLBACK');
    res.status(e.status || 400).json({ error: e.message || mapDbError(e) });
  } finally { client.release(); }
});

module.exports = router;
