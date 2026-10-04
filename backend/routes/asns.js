// ASNs + suppliers router.
// La recepción contra ASN actualiza qty_received y derive el status (PARCIAL/RECIBIDO).
// El consumo real de stock lo hace /api/import/receive o /api/receive_batch, no este.

const express = require('express');

const { pool, mapDbError, isUniqueViolation, userError } = require('../db');
const { requireAuth, requireJefe, requireJefeOrAbove, requireStockWrite, checkClientAccess } = require('../middleware');
const { validateBody, schemas } = require('../schemas');
const { genLpnId, logStorageEvent } = require('../helpers');
const { scopeCondition, clientAllowed } = require('../scope');
const { clienteDelDocumento, validarEntrada, rechazoEntrada, crearLpnsEntrada, httpError } = require('../stock-entrante');

const router = express.Router();

// ── SUPPLIERS ────────────────────────────────────────────────────────────────
router.get('/suppliers', requireAuth, async (req, res) => {
  try { res.json((await pool.query('SELECT * FROM suppliers ORDER BY name ASC')).rows); }
  catch(e){ res.status(500).json({ error: mapDbError(e) }); }
});

router.post('/suppliers', requireJefeOrAbove, async (req, res) => {
  const { name, rut, notes, status } = req.body;
  const contact_name = req.body.contact_name || req.body.contact || null;
  const contact_email = req.body.contact_email || req.body.email || null;
  const contact_phone = req.body.contact_phone || req.body.phone || null;
  const address = req.body.address || null;
  const lead_time_days = req.body.lead_time_days || 5;
  const id = req.body.id ? req.body.id.toUpperCase() : `SUP-${Date.now().toString(36).toUpperCase().slice(-6)}`;
  if (!name) return res.status(400).json({ error: 'Nombre es requerido.' });
  try {
    await pool.query(
      `INSERT INTO suppliers (id,name,rut,contact_name,contact_email,contact_phone,address,lead_time_days,notes,status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (id) DO UPDATE SET name=$2,rut=$3,contact_name=$4,contact_email=$5,contact_phone=$6,address=$7,lead_time_days=$8,notes=$9,status=$10`,
      [id, name, rut||null, contact_name, contact_email, contact_phone, address, lead_time_days, notes||null, status||'ACTIVE']
    );
    res.json({ success: true, id });
  } catch(e){ res.status(500).json({ error: mapDbError(e) }); }
});

router.put('/suppliers/:id', requireJefeOrAbove, async (req, res) => {
  const { name, rut, notes, status } = req.body;
  const contact_name = req.body.contact_name || req.body.contact || null;
  const contact_email = req.body.contact_email || req.body.email || null;
  const contact_phone = req.body.contact_phone || req.body.phone || null;
  if (!name) return res.status(400).json({ error: 'Nombre es requerido.' });
  try {
    await pool.query(`UPDATE suppliers SET name=$1,rut=$2,contact_name=$3,contact_email=$4,contact_phone=$5,notes=$6,status=$7 WHERE id=$8`,
      [name, rut||null, contact_name, contact_email, contact_phone, notes||null, status||'ACTIVE', req.params.id]);
    res.json({ success: true });
  } catch(e){ res.status(500).json({ error: mapDbError(e) }); }
});

router.delete('/suppliers/:id', requireJefeOrAbove, async (req, res) => {
  try { await pool.query('DELETE FROM suppliers WHERE id=$1', [req.params.id]); res.json({ success: true }); }
  catch(e){ res.status(500).json({ error: mapDbError(e) }); }
});

// ── ASNs ─────────────────────────────────────────────────────────────────────
router.get('/asns', requireAuth, async (req, res) => {
  try {
    const params = [];
    const r = await pool.query(`SELECT a.*, COALESCE(json_agg(l ORDER BY l.id) FILTER (WHERE l.id IS NOT NULL),'[]') as lines
      FROM asns a LEFT JOIN asn_lines l ON l.asn_id=a.id
      WHERE ${scopeCondition(req.clientScope, 'a.client_id', params)}
      GROUP BY a.id ORDER BY a.created_at DESC LIMIT 200`, params);
    res.json(r.rows);
  } catch(e){ res.status(500).json({ error: mapDbError(e) }); }
});

router.post('/asns', requireJefeOrAbove, checkClientAccess('write'), async (req, res) => {
  const { supplier_id, supplier_name, expected_date, reference, notes, lines } = req.body;
  const id = genLpnId('ASN');
  let resolvedSupplierName = supplier_name || null;
  if (supplier_id && !resolvedSupplierName) {
    try { const sr = await pool.query('SELECT name FROM suppliers WHERE id=$1', [supplier_id]); resolvedSupplierName = sr.rows[0]?.name || null; } catch(e){}
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Dueño de la mercancía: el indicado, o el único cliente de los SKU del aviso.
    const lineas = Array.isArray(lines) ? lines.filter(l => l?.sku && parseFloat(l.qty_expected) > 0) : [];
    const asnClientId = await clienteDelDocumento(client, req.body.client_id, lineas.map(l => l.sku));
    if (!clientAllowed(req.clientScope, asnClientId)) throw httpError(403, `Acceso denegado al cliente '${asnClientId}'.`);
    const skus = [...new Set(lineas.map(l => String(l.sku).trim().toUpperCase()))];
    const existentes = new Set((await client.query('SELECT sku FROM master_skus WHERE sku = ANY($1) AND client_id=$2 AND deleted_at IS NULL', [skus, asnClientId])).rows.map(r => r.sku));
    const faltan = skus.filter(s => !existentes.has(s));
    if (faltan.length) throw httpError(400, `SKU que no existen para el cliente ${asnClientId}: ${faltan.join(', ')}`);
    await client.query(`INSERT INTO asns (id,supplier_id,supplier_name,expected_date,reference,notes,created_by,client_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, supplier_id||null, resolvedSupplierName, expected_date||null, reference||null, notes||null, req.user.username, asnClientId]);
    for (const l of lineas) {
      await client.query(`INSERT INTO asn_lines (asn_id,sku,qty_expected,lot,notes) VALUES ($1,$2,$3,$4,$5)`,
        [id, String(l.sku).trim().toUpperCase(), parseFloat(l.qty_expected), l.lot||null, l.notes||null]);
    }
    await client.query('COMMIT');
    res.json({ success: true, id });
  } catch(e){
    await client.query('ROLLBACK').catch(() => {});
    if (isUniqueViolation(e)) return res.status(409).json({ error: `Ya existe un ASN con la referencia '${reference}' para este proveedor.` });
    res.status(e.status || (e.severity ? 500 : 400)).json({ error: userError(e) });
  }
  finally { client.release(); }
});

// Recepción contra ASN: el stock es del cliente del aviso; no se recibe un aviso ya
// completo ni por encima de lo esperado en cada línea.
router.post('/asns/:id/receive', requireStockWrite, validateBody(schemas.asnReceive), async (req, res) => {
  const rawLines = req.body.received || req.body.lines || [];
  const received = rawLines
    .map(r => ({ ...r, asn_line_id: r.asn_line_id || r.line_id, qty_received: Number(r.qty_received) || 0 }))
    .filter(r => r.asn_line_id && r.qty_received > 0);
  if (!received.length) return res.status(400).json({ error: 'Ingrese al menos una cantidad a recibir.' });
  const ids = received.map(r => String(r.asn_line_id));
  if (new Set(ids).size !== ids.length) return res.status(400).json({ error: 'Cada línea del ASN puede venir una sola vez.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const asn = (await client.query(`SELECT * FROM asns WHERE id=$1 FOR UPDATE`, [req.params.id])).rows[0];
    if (!asn) throw httpError(404, 'ASN no encontrado.');
    const lineasAsn = (await client.query(`SELECT id, sku, lot, qty_expected, qty_received FROM asn_lines WHERE asn_id=$1 ORDER BY id FOR UPDATE`, [asn.id])).rows;
    const clientId = asn.client_id || await clienteDelDocumento(client, req.body.client_id, lineasAsn.map(l => l.sku));
    if (!clientAllowed(req.clientScope, clientId)) throw httpError(404, 'ASN no encontrado.');
    if (asn.status === 'RECIBIDO') throw httpError(409, 'Este ASN ya fue recibido completo.');
    const porId = new Map(lineasAsn.map(l => [String(l.id), l]));
    const filas = [];
    for (const r of received) {
      const line = porId.get(String(r.asn_line_id));
      if (!line) throw httpError(400, `La línea ${r.asn_line_id} no pertenece a este ASN.`);
      const pendiente = Number(line.qty_expected) - Number(line.qty_received || 0);
      if (r.qty_received > pendiente) throw httpError(400, `${line.sku}: se intenta recibir ${r.qty_received} y solo quedan ${pendiente} por recibir.`);
      filas.push({ sku: line.sku, qty: r.qty_received, location_id: r.location_id, batch_number: r.batch_number || line.lot,
        expiry_date: r.expiry_date, serial_number: r.serial_number, lineId: line.id });
    }
    const { valid, errors } = await validarEntrada(client, filas, clientId);
    if (errors.length) throw rechazoEntrada(errors);
    for (const r of received) {
      await client.query(`UPDATE asn_lines SET qty_received = qty_received + $1 WHERE id=$2`, [r.qty_received, r.asn_line_id]);
    }
    const creados = await crearLpnsEntrada(client, valid, {
      prefijo: 'ASN', glosaLpn: `Recepción ASN ${asn.id}`, username: req.user.username,
      glosaKardex: (lpnId) => `Recepción ASN ${asn.id} LPN:${lpnId}`,
    });
    const pending = await client.query(`SELECT COUNT(*)::int AS n FROM asn_lines WHERE asn_id=$1 AND qty_received < qty_expected`, [asn.id]);
    const newStatus = pending.rows[0].n === 0 ? 'RECIBIDO' : 'PARCIAL';
    await client.query(
      `UPDATE asns SET status=$1, client_id=COALESCE(client_id, $3), received_at=CASE WHEN $2 THEN NOW() ELSE received_at END WHERE id=$4`,
      [newStatus, newStatus === 'RECIBIDO', clientId, asn.id]
    );
    await client.query('COMMIT');
    res.json({ success: true, status: newStatus, lpns_created: creados.map(c => ({ lpn_id: c.lpnId, sku: c.sku, qty: c.qty, client_id: c.client_id })) });
  } catch(e) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(e.status || (e.severity ? 500 : 400)).json({ error: userError(e), ...(e.errors ? { errors: e.errors } : {}) });
  } finally { client.release(); }
});

router.delete('/asns/:id', requireJefeOrAbove, async (req, res) => {
  try { await pool.query(`DELETE FROM asns WHERE id=$1 AND status='ESPERANDO'`, [req.params.id]); res.json({ success: true }); }
  catch(e){ res.status(500).json({ error: mapDbError(e) }); }
});

module.exports = router;
