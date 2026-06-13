// Kits router: definición, disponibilidad, armado y despacho directo.
// Las transacciones de armado/despacho usan BEGIN/COMMIT/ROLLBACK con finally release
// (P2). NO descontar stock fuera de la transacción para no dejar saldos inconsistentes.

const express = require('express');
const { v4: uuidv4 } = require('uuid');

const { pool, mapDbError } = require('../db');
const { requireAuth, requireAdmin, requireJefeOrAbove, checkClientAccess } = require('../middleware');
const { validateBody, schemas } = require('../schemas');
const { genLpnId } = require('../helpers');

const router = express.Router();

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

router.post('/kits', requireAdmin, async (req, res) => {
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

router.delete('/kits/:kit_sku/:client_id', requireAdmin, async (req, res) => {
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
      const s = await pool.query(
        `SELECT COALESCE(SUM(i.qty),0) as total FROM inventory_lpns i
         LEFT JOIN statuses st ON i.status = st.id
         WHERE i.sku=$1 AND i.client_id=$2 AND i.qty>0 AND COALESCE(st.blocks_outbound, FALSE) = FALSE`,
        [comp.component_sku, client_id]
      );
      const available = parseFloat(s.rows[0].total);
      const needed = parseFloat(comp.qty) * qtyN;
      const possible = comp.qty > 0 ? Math.floor(available / comp.qty) : 0;
      maxKits = Math.min(maxKits, possible);
      result.push({ component_sku: comp.component_sku, required_per_kit: parseFloat(comp.qty), needed, available, kits_possible: possible });
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
router.post('/kit-build', requireJefeOrAbove, checkClientAccess('write'), validateBody(schemas.kitBuild), async (req, res) => {
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
    for (const comp of components.rows) {
      let remaining = comp.qty * qtyN;
      const eligibleIds = (await client.query(
        `SELECT i.id FROM inventory_lpns i
         LEFT JOIN statuses st ON i.status = st.id
         WHERE i.sku=$1 AND i.client_id=$2 AND i.qty>0 AND COALESCE(st.blocks_outbound, FALSE) = FALSE
         ORDER BY i.expiry_date ASC NULLS LAST, i.created_at ASC`,
        [comp.component_sku, client_id]
      )).rows.map(r => r.id);
      const lpns = eligibleIds.length === 0 ? { rows: [] } : await client.query(
        `SELECT id, qty FROM inventory_lpns WHERE id = ANY($1::varchar[]) FOR UPDATE
         ORDER BY expiry_date ASC NULLS LAST, created_at ASC`,
        [eligibleIds]
      );
      for (const lpn of lpns.rows) {
        if (remaining <= 0) break;
        const take = Math.min(parseFloat(lpn.qty), remaining);
        await client.query('UPDATE inventory_lpns SET qty=qty-$1 WHERE id=$2', [take, lpn.id]);
        await client.query('INSERT INTO audit_log(type,sku,qty,glosa,username) VALUES($1,$2,$3,$4,$5)',
          ['ADJUST_OUT', comp.component_sku, take, `[KIT] Componente para armar ${qtyN}x ${kit_sku}`, username]);
        remaining -= take;
      }
    }
    await client.query('DELETE FROM inventory_lpns WHERE qty <= 0');
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
  } catch(e) { await client.query('ROLLBACK'); res.status(500).json({ error: mapDbError(e) }); }
  finally { client.release(); }
});

router.post('/kits/direct-dispatch', requireJefeOrAbove, async (req, res) => {
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

    const consumed = [];
    for (const comp of components.rows) {
      let remaining = comp.qty * qtyN;
      const eligibleIds = (await client.query(
        `SELECT i.id FROM inventory_lpns i
         LEFT JOIN statuses st ON i.status = st.id
         WHERE i.sku=$1 AND i.client_id=$2 AND i.qty>0 AND COALESCE(st.blocks_outbound, FALSE) = FALSE
         ORDER BY i.expiry_date ASC NULLS LAST, i.created_at ASC`,
        [comp.component_sku, client_id]
      )).rows.map(r => r.id);
      const lpns = eligibleIds.length === 0 ? { rows: [] } : await client.query(
        `SELECT id, qty FROM inventory_lpns WHERE id = ANY($1::varchar[]) FOR UPDATE
         ORDER BY expiry_date ASC NULLS LAST, created_at ASC`,
        [eligibleIds]
      );
      for (const lpn of lpns.rows) {
        if (remaining <= 0) break;
        const take = Math.min(parseFloat(lpn.qty), remaining);
        await client.query('UPDATE inventory_lpns SET qty=qty-$1 WHERE id=$2', [take, lpn.id]);
        await client.query('INSERT INTO audit_log(type,sku,qty,glosa,username) VALUES($1,$2,$3,$4,$5)',
          ['OUTBOUND', comp.component_sku, take,
           `[KIT DIRECTO] ${qtyN}x ${kit_sku} | Doc: ${doc_num || 'S/N'} | ${glosa || ''}`, username]);
        remaining -= take;
      }
      consumed.push({ sku: comp.component_sku, qty_consumed: comp.qty * qtyN });
    }

    await client.query('INSERT INTO audit_log(type,sku,qty,glosa,username) VALUES($1,$2,$3,$4,$5)',
      ['OUTBOUND', kit_sku, qtyN,
       `[KIT DIRECTO] ${doc_type || 'DESPACHO'} ${doc_num || 'S/N'} | ${glosa || ''}`, username]);

    await client.query('DELETE FROM inventory_lpns WHERE qty <= 0');

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
    res.status(400).json({ error: e.message || mapDbError(e) });
  } finally { client.release(); }
});

module.exports = router;
