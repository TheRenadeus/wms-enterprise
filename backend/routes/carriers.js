// Transporte: maestro de transportistas (carriers) + envíos (shipments).
// Extraído de server.js (COD-02).
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { pool, mapDbError, isUniqueViolation } = require('../db');
const { requireAuth, requireStockWrite, checkClientAccess } = require('../middleware');

const router = express.Router();

router.get('/carriers', requireAuth, async (req, res) => {
  try { res.json((await pool.query('SELECT * FROM carriers WHERE active=TRUE ORDER BY name ASC')).rows); }
  catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});
router.post('/carriers', requireAuth, async (req, res) => {
  const { id, name, rut, contact, phone, email } = req.body;
  if (!name) return res.status(400).json({ error: 'Nombre requerido' });
  const carrierId = id || `CAR-${uuidv4().slice(0,8).toUpperCase()}`;
  const rutNorm = rut && String(rut).trim() !== '' ? String(rut).trim() : null;
  try {
    if (rutNorm) {
      const rutDup = await pool.query(`SELECT id, name FROM carriers WHERE rut=$1 AND id<>$2 LIMIT 1`, [rutNorm, carrierId]);
      if (rutDup.rows.length > 0)
        return res.status(409).json({ error: `El RUT '${rutNorm}' ya está registrado en el transportista '${rutDup.rows[0].name}'.` });
    }
    await pool.query(`INSERT INTO carriers(id,name,rut,contact,phone,email) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET name=$2,rut=$3,contact=$4,phone=$5,email=$6`,
      [carrierId, name, rutNorm||'', contact||'', phone||'', email||'']);
    res.json({ success: true, id: carrierId });
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});
router.put('/carriers/:id', requireAuth, async (req, res) => {
  const { name, rut, contact, phone, email } = req.body;
  if (!name) return res.status(400).json({ error: 'Nombre requerido' });
  const rutNorm = rut && String(rut).trim() !== '' ? String(rut).trim() : null;
  try {
    if (rutNorm) {
      const rutDup = await pool.query(`SELECT id, name FROM carriers WHERE rut=$1 AND id<>$2 LIMIT 1`, [rutNorm, req.params.id]);
      if (rutDup.rows.length > 0)
        return res.status(409).json({ error: `El RUT '${rutNorm}' ya está registrado en el transportista '${rutDup.rows[0].name}'.` });
    }
    await pool.query(`UPDATE carriers SET name=$1,rut=$2,contact=$3,phone=$4,email=$5 WHERE id=$6`,
      [name, rutNorm||'', contact||'', phone||'', email||'', req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});
router.delete('/carriers/:id', requireAuth, async (req, res) => {
  try { await pool.query('UPDATE carriers SET active=FALSE WHERE id=$1', [req.params.id]); res.json({ success: true }); }
  catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});

router.get('/shipments', requireAuth, async (req, res) => {
  try {
    const r = await pool.query(`SELECT s.*,c.name as carrier_name,
      COALESCE(s.destination, s.destination_address) as destination
      FROM shipments s LEFT JOIN carriers c ON s.carrier_id=c.id ORDER BY s.created_at DESC LIMIT 200`);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});
router.post('/shipments', requireAuth, checkClientAccess('write'), async (req, res) => {
  // Acepta tanto el formato legacy (dispatch_doc_id) como el simplificado del frontend (doc_num, client_id, destination)
  const { dispatch_doc_id, doc_num, carrier_id, client_id, driver_name, driver_rut, plate, scheduled_date, destination_address, destination, notes, created_by, username } = req.body;
  const id = `SHP-${uuidv4().slice(0,8).toUpperCase()}`;
  try {
    await pool.query(`INSERT INTO shipments(id,dispatch_doc_id,doc_num,client_id,carrier_id,driver_name,driver_rut,plate,scheduled_date,destination_address,destination,notes,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [id, dispatch_doc_id||doc_num||null, doc_num||dispatch_doc_id||null, client_id||null, carrier_id||null,
       driver_name||'', driver_rut||'', plate||'', scheduled_date||null,
       destination_address||destination||'', destination||destination_address||'',
       notes||'', created_by||username||'']);
    res.json({ success: true, id });
  } catch(e) {
    if (isUniqueViolation(e)) return res.status(409).json({ error: `Ya existe un envío con el documento '${doc_num||dispatch_doc_id}' para este cliente.` });
    res.status(500).json({ error: mapDbError(e) });
  }
});
router.put('/shipments/:id/status', requireStockWrite, async (req, res) => {
  const { status } = req.body;
  const VALID = ['PENDING','ASSIGNED','IN_TRANSIT','DELIVERED','RETURNED'];
  if (!VALID.includes(status)) return res.status(400).json({ error: 'Estado inválido' });
  try {
    const extra = status==='IN_TRANSIT' ? ',pickup_date=NOW()' : status==='DELIVERED' ? ',delivery_date=NOW()' : '';
    await pool.query(`UPDATE shipments SET status=$1${extra} WHERE id=$2`, [status, req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});
router.get('/shipments/doc/:docId', requireAuth, async (req, res) => {
  try {
    const r = await pool.query('SELECT s.*,c.name as carrier_name FROM shipments s LEFT JOIN carriers c ON s.carrier_id=c.id WHERE s.dispatch_doc_id=$1', [req.params.docId]);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});

module.exports = router;
