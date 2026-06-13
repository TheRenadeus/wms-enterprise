// Docks + dock-appointments router (Sistema 5 — Yard Management).
// Las citas usan tsrange overlap (&&) para detectar conflictos en el mismo muelle.

const express = require('express');

const { pool, mapDbError } = require('../db');
const { requireAuth, requireJefeOrAbove } = require('../middleware');
const { genLpnId } = require('../helpers');

const router = express.Router();

// ── Docks ───────────────────────────────────────────────────────────────────
router.get('/docks', requireAuth, async (req, res) => {
  try { res.json((await pool.query('SELECT * FROM docks ORDER BY name ASC')).rows); }
  catch(e){ res.status(500).json({ error: mapDbError(e) }); }
});

router.post('/docks', requireJefeOrAbove, async (req, res) => {
  const id = (req.body.id || req.body.dock_code || '').toUpperCase();
  const name = req.body.name || '';
  const type = req.body.type || req.body.dock_type || 'BOTH';
  const capacity = parseInt(req.body.capacity) || 1;
  const notes = req.body.notes || null;
  if (!id || !name) return res.status(400).json({ error: 'Código y nombre son requeridos.' });
  try {
    await pool.query(`INSERT INTO docks (id,name,type,capacity,notes) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO UPDATE SET name=$2,type=$3,capacity=$4,notes=$5`,
      [id, name, type, capacity, notes]);
    res.json({ success: true, id });
  } catch(e){ res.status(500).json({ error: mapDbError(e) }); }
});

router.put('/docks/:id', requireJefeOrAbove, async (req, res) => {
  const name = req.body.name || '';
  const type = req.body.type || req.body.dock_type || 'BOTH';
  const capacity = parseInt(req.body.capacity) || 1;
  const notes = req.body.notes || null;
  if (!name) return res.status(400).json({ error: 'Nombre es requerido.' });
  try {
    await pool.query(`UPDATE docks SET name=$1,type=$2,capacity=$3,notes=$4 WHERE id=$5`, [name, type, capacity, notes, req.params.id]);
    res.json({ success: true });
  } catch(e){ res.status(500).json({ error: mapDbError(e) }); }
});

router.delete('/docks/:id', requireJefeOrAbove, async (req, res) => {
  try { await pool.query('DELETE FROM docks WHERE id=$1', [req.params.id]); res.json({ success: true }); }
  catch(e){ res.status(500).json({ error: mapDbError(e) }); }
});

// ── Dock appointments ───────────────────────────────────────────────────────
router.get('/dock-appointments', requireAuth, async (req, res) => {
  const { date } = req.query;
  try {
    let q = `SELECT da.*, d.id as dock_code, d.name as dock_name
             FROM dock_appointments da LEFT JOIN docks d ON d.id=da.dock_id`;
    const params = [];
    if (date) { q += ' WHERE DATE(da.scheduled_at)=$1'; params.push(date); }
    q += ' ORDER BY da.scheduled_at ASC LIMIT 500';
    res.json((await pool.query(q, params)).rows);
  } catch(e){ res.status(500).json({ error: mapDbError(e) }); }
});

router.post('/dock-appointments', requireJefeOrAbove, async (req, res) => {
  const dock_id = req.body.dock_id;
  const doc_num = req.body.doc_num || req.body.doc_reference || null;
  const module = req.body.module || req.body.direction || null;
  const carrier_name = req.body.carrier_name || req.body.carrier || null;
  const driver_name = req.body.driver_name || null;
  const plate = req.body.plate || null;
  const duration_mins = parseInt(req.body.duration_mins) || 60;
  const notes = req.body.notes || null;
  const scheduled_at = req.body.scheduled_at ||
    (req.body.appt_date ? `${req.body.appt_date}T${req.body.appt_time || '08:00'}:00` : null);
  if (!dock_id || !scheduled_at) return res.status(400).json({ error: 'dock_id y fecha son requeridos.' });
  const id = genLpnId('DOCK');
  try {
    const conflict = await pool.query(
      `SELECT id FROM dock_appointments WHERE dock_id=$1 AND status NOT IN ('CANCELADA','COMPLETADA')
       AND tsrange(scheduled_at, scheduled_at + ($2 || ' minutes')::interval) && tsrange($3::timestamp, $3::timestamp + ($2 || ' minutes')::interval)`,
      [dock_id, duration_mins||60, scheduled_at]
    );
    if (conflict.rows.length) return res.status(409).json({ error: 'El muelle ya tiene una cita en ese horario.' });
    await pool.query(`INSERT INTO dock_appointments (id,dock_id,doc_num,module,carrier_name,driver_name,plate,scheduled_at,duration_mins,notes,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [id, dock_id, doc_num||null, module||null, carrier_name||null, driver_name||null, plate||null, scheduled_at, duration_mins||60, notes||null, req.user.username]);
    res.json({ success: true, id });
  } catch(e){ res.status(500).json({ error: mapDbError(e) }); }
});

router.put('/dock-appointments/:id/status', requireJefeOrAbove, async (req, res) => {
  const { status } = req.body;
  try {
    await pool.query(`UPDATE dock_appointments SET status=$1 WHERE id=$2`, [status, req.params.id]);
    res.json({ success: true });
  } catch(e){ res.status(500).json({ error: mapDbError(e) }); }
});

router.delete('/dock-appointments/:id', requireJefeOrAbove, async (req, res) => {
  try { await pool.query(`UPDATE dock_appointments SET status='CANCELADA' WHERE id=$1`, [req.params.id]); res.json({ success: true }); }
  catch(e){ res.status(500).json({ error: mapDbError(e) }); }
});

module.exports = router;
