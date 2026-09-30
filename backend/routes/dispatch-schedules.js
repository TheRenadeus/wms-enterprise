// Programación de salidas (calendario de despachos). Extraído de server.js (COD-02).
const express = require('express');
const { pool, mapDbError, isUniqueViolation } = require('../db');
const { requireAuth, requireJefeOrAbove, checkClientAccess } = require('../middleware');
const { genLpnId } = require('../helpers');

const router = express.Router();

router.get('/dispatch-schedules', requireAuth, async (req, res) => {
  try {
    const { status, date_from, date_to } = req.query;
    const conditions = [];
    const params = [];
    let idx = 1;
    if (status) { conditions.push(`status=$${idx++}`); params.push(status); }
    if (date_from) { conditions.push(`scheduled_date>=$${idx++}`); params.push(date_from); }
    if (date_to) { conditions.push(`scheduled_date<=$${idx++}`); params.push(date_to); }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const rows = await pool.query(
      `SELECT * FROM dispatch_schedules ${where} ORDER BY scheduled_date ASC, scheduled_time ASC NULLS LAST, created_at DESC`,
      params
    );
    res.json(rows.rows);
  } catch (err) { res.status(500).json({ error: mapDbError(err) }); }
});

router.post('/dispatch-schedules', requireJefeOrAbove, checkClientAccess('write'), async (req, res) => {
  const { doc_num, client_id, doc_type, glosa, scheduled_date, scheduled_time, carrier, destination, notes } = req.body;
  if (!doc_num || !scheduled_date) return res.status(400).json({ error: 'doc_num y scheduled_date son requeridos.' });
  try {
    const id = genLpnId('DS');
    await pool.query(
      `INSERT INTO dispatch_schedules (id, doc_num, client_id, doc_type, glosa, scheduled_date, scheduled_time, carrier, destination, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [id, doc_num.toUpperCase(), client_id||null, doc_type||null, glosa||null,
       scheduled_date, scheduled_time||null, carrier||null, destination||null, notes||null, req.user.username]
    );
    res.json({ success: true, id });
  } catch (err) {
    if (isUniqueViolation(err)) return res.status(409).json({ error: `Ya existe una programación con el documento '${doc_num}' para este cliente y tipo.` });
    res.status(500).json({ error: mapDbError(err) });
  }
});

router.patch('/dispatch-schedules/:id', requireJefeOrAbove, async (req, res) => {
  const { doc_num, client_id, doc_type, glosa, scheduled_date, scheduled_time, carrier, destination, notes, status } = req.body;
  try {
    const current = await pool.query('SELECT * FROM dispatch_schedules WHERE id=$1', [req.params.id]);
    if (!current.rows.length) return res.status(404).json({ error: 'Programación no encontrada.' });
    const r = current.rows[0];
    const newStatus = status || r.status;
    const confirmedBy = (newStatus === 'CONFIRMADO' && r.status !== 'CONFIRMADO') ? req.user.username : r.confirmed_by;
    await pool.query(
      `UPDATE dispatch_schedules SET
         doc_num=$1, client_id=$2, doc_type=$3, glosa=$4, scheduled_date=$5, scheduled_time=$6,
         carrier=$7, destination=$8, notes=$9, status=$10, confirmed_by=$11,
         confirmed_at=CASE WHEN $12 THEN NOW() ELSE confirmed_at END
       WHERE id=$13`,
      [doc_num||r.doc_num, client_id||r.client_id, doc_type||r.doc_type, glosa!==undefined?glosa:r.glosa,
       scheduled_date||r.scheduled_date, scheduled_time!==undefined?scheduled_time:r.scheduled_time,
       carrier!==undefined?carrier:r.carrier, destination!==undefined?destination:r.destination,
       notes!==undefined?notes:r.notes, newStatus, confirmedBy,
       (newStatus === 'CONFIRMADO' && r.status !== 'CONFIRMADO'), req.params.id]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: mapDbError(err) }); }
});

router.delete('/dispatch-schedules/:id', requireJefeOrAbove, async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM dispatch_schedules WHERE id=$1 RETURNING id', [req.params.id]);
    if (!r.rowCount) return res.status(404).json({ error: 'Programación no encontrada.' });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: mapDbError(err) }); }
});

module.exports = router;
