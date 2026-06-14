// ASNs + suppliers router.
// La recepción contra ASN actualiza qty_received y derive el status (PARCIAL/RECIBIDO).
// El consumo real de stock lo hace /api/import/receive o /api/receive_batch, no este.

const express = require('express');

const { pool, mapDbError } = require('../db');
const { requireAuth, requireJefe, requireJefeOrAbove, requireStockWrite, checkClientAccess } = require('../middleware');
const { validateBody, schemas } = require('../schemas');
const { genLpnId, logStorageEvent } = require('../helpers');

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
    const r = await pool.query(`SELECT a.*, COALESCE(json_agg(l ORDER BY l.id) FILTER (WHERE l.id IS NOT NULL),'[]') as lines
      FROM asns a LEFT JOIN asn_lines l ON l.asn_id=a.id GROUP BY a.id ORDER BY a.created_at DESC LIMIT 200`);
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
    await client.query(`INSERT INTO asns (id,supplier_id,supplier_name,expected_date,reference,notes,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, supplier_id||null, resolvedSupplierName, expected_date||null, reference||null, notes||null, req.user.username]);
    if (Array.isArray(lines)) {
      for (const l of lines) {
        if (l.sku && parseFloat(l.qty_expected)>0)
          await client.query(`INSERT INTO asn_lines (asn_id,sku,qty_expected,lot,notes) VALUES ($1,$2,$3,$4,$5)`,
            [id, l.sku.toUpperCase(), parseFloat(l.qty_expected), l.lot||null, l.notes||null]);
      }
    }
    await client.query('COMMIT');
    res.json({ success: true, id });
  } catch(e){ await client.query('ROLLBACK'); res.status(500).json({ error: mapDbError(e) }); }
  finally { client.release(); }
});

router.post('/asns/:id/receive', requireStockWrite, validateBody(schemas.asnReceive), async (req, res) => {
  const rawLines = req.body.received || req.body.lines || [];
  const received = rawLines.map(r => ({
    asn_line_id: r.asn_line_id || r.line_id,
    qty_received: parseFloat(r.qty_received) || 0,
    location_id: r.location_id || 'PISO-RECEPCION',
    serial_number: r.serial_number || null,
  }));
  const defaultClientId = req.body.client_id || null;
  const username = req.user.username;
  const client = await pool.connect();
  const createdLpns = [];
  try {
    await client.query('BEGIN');
    for (const r of received) {
      if (!r.asn_line_id || r.qty_received <= 0) continue;
      const lineQ = await client.query(
        `SELECT id, sku, lot, qty_expected, qty_received FROM asn_lines WHERE id=$1 AND asn_id=$2 FOR UPDATE`,
        [r.asn_line_id, req.params.id]
      );
      if (!lineQ.rows.length) continue;
      const line = lineQ.rows[0];
      await client.query(`UPDATE asn_lines SET qty_received = qty_received + $1 WHERE id=$2`,
        [r.qty_received, r.asn_line_id]);
      // Resolver client_id: cuerpo > master_skus.client_id por SKU > 'GENERAL'
      let clientId = defaultClientId;
      if (!clientId) {
        const ms = await client.query(`SELECT client_id FROM master_skus WHERE sku=$1 LIMIT 1`, [line.sku]);
        clientId = ms.rows[0]?.client_id || 'GENERAL';
      }
      const lpnId = genLpnId('ASN');
      await client.query(
        `INSERT INTO inventory_lpns (id, sku, qty, client_id, status, batch_number, serial_number, location_id, glosa)
         VALUES ($1,$2,$3,$4,'DISPONIBLE',$5,$6,$7,$8)`,
        [lpnId, line.sku, r.qty_received, clientId, line.lot || null, r.serial_number, r.location_id, `Recepción ASN ${req.params.id}`]
      );
      await client.query(
        `INSERT INTO audit_log (type, sku, qty, glosa, username) VALUES ('INBOUND', $1, $2, $3, $4)`,
        [line.sku, r.qty_received, `Recepción ASN ${req.params.id} LPN:${lpnId}`, username]
      );
      // Cobro 3PL: evento de movimiento de entrada
      await logStorageEvent(client, { client_id: clientId, event_type: 'MOVIMIENTO_IN', sku: line.sku, lpn_id: lpnId, qty: r.qty_received, location_id: r.location_id });
      createdLpns.push({ lpn_id: lpnId, sku: line.sku, qty: r.qty_received, client_id: clientId });
    }
    const pending = await client.query(
      `SELECT COUNT(*) AS cnt FROM asn_lines WHERE asn_id=$1 AND qty_received < qty_expected`,
      [req.params.id]
    );
    const newStatus = parseInt(pending.rows[0].cnt) === 0 ? 'RECIBIDO' : 'PARCIAL';
    await client.query(
      `UPDATE asns SET status=$1, received_at=CASE WHEN $1='RECIBIDO' THEN NOW() ELSE received_at END WHERE id=$2`,
      [newStatus, req.params.id]
    );
    await client.query('COMMIT');
    res.json({ success: true, status: newStatus, lpns_created: createdLpns });
  } catch(e){ await client.query('ROLLBACK'); res.status(500).json({ error: mapDbError(e) }); }
  finally { client.release(); }
});

router.delete('/asns/:id', requireJefeOrAbove, async (req, res) => {
  try { await pool.query(`DELETE FROM asns WHERE id=$1 AND status='ESPERANDO'`, [req.params.id]); res.json({ success: true }); }
  catch(e){ res.status(500).json({ error: mapDbError(e) }); }
});

module.exports = router;
