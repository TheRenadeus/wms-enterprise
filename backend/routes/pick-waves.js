// Pick-waves router: agrupación de líneas de picking en olas.
// El flujo es BORRADOR → ACTIVA (release) → COMPLETADA (close).
// Las líneas se sacan del pool de pick_task_lines pendientes sin ola asignada.

const express = require('express');

const { pool, mapDbError } = require('../db');
const { requireJefeOrAbove } = require('../middleware');
const { validateBody, schemas } = require('../schemas');
const { genLpnId } = require('../helpers');

const router = express.Router();

router.get('/pick-waves', requireJefeOrAbove, async (req, res) => {
  try {
    const r = await pool.query(`SELECT w.*, COALESCE(json_agg(wl ORDER BY wl.id) FILTER (WHERE wl.id IS NOT NULL),'[]') as wave_lines
      FROM pick_waves w LEFT JOIN pick_wave_lines wl ON wl.wave_id=w.id GROUP BY w.id ORDER BY w.created_at DESC LIMIT 100`);
    res.json(r.rows);
  } catch(e){ res.status(500).json({ error: mapDbError(e) }); }
});

router.post('/pick-waves', requireJefeOrAbove, validateBody(schemas.pickWaveCreate), async (req, res) => {
  const { name, zone_filter, line_ids } = req.body;
  if (!Array.isArray(line_ids) || line_ids.length===0) return res.status(400).json({ error: 'Seleccione al menos una línea.' });
  const id = genLpnId('WAVE');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`INSERT INTO pick_waves (id,name,zone_filter,line_count,created_by) VALUES ($1,$2,$3,$4,$5)`,
      [id, name||`Ola-${new Date().toISOString().slice(0,10)}`, zone_filter||null, line_ids.length, req.user.username]);
    for (const lid of line_ids) {
      await client.query(`INSERT INTO pick_wave_lines (wave_id,task_line_id) VALUES ($1,$2)`, [id, lid]);
    }
    await client.query('COMMIT');
    res.json({ success: true, id });
  } catch(e){ await client.query('ROLLBACK'); res.status(500).json({ error: mapDbError(e) }); }
  finally { client.release(); }
});

router.post('/pick-waves/:id/release', requireJefeOrAbove, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(`UPDATE pick_waves SET status='ACTIVA', released_at=NOW() WHERE id=$1 AND status='BORRADOR' RETURNING id`, [req.params.id]);
    if (!r.rowCount) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'La ola no está en estado BORRADOR.' });
    }
    await client.query('COMMIT');
    res.json({ success: true });
  } catch(e){ await client.query('ROLLBACK'); res.status(500).json({ error: mapDbError(e) }); }
  finally { client.release(); }
});

router.post('/pick-waves/:id/close', requireJefeOrAbove, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`UPDATE pick_waves SET status='COMPLETADA', completed_at=NOW() WHERE id=$1`, [req.params.id]);
    await client.query('COMMIT');
    res.json({ success: true });
  } catch(e){ await client.query('ROLLBACK'); res.status(500).json({ error: mapDbError(e) }); }
  finally { client.release(); }
});

router.get('/pick-waves/available-lines', requireJefeOrAbove, async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT ptl.id as line_id, ptl.sku, ptl.sku_desc, ptl.lpn_id, ptl.location_from, ptl.qty_requested, ptl.assigned_to,
             pt.doc_num, pt.module, pt.priority
      FROM pick_task_lines ptl
      JOIN pick_tasks pt ON pt.id=ptl.task_id
      WHERE ptl.status='PENDIENTE'
        AND ptl.id NOT IN (SELECT task_line_id FROM pick_wave_lines WHERE task_line_id IS NOT NULL)
      ORDER BY pt.priority ASC, ptl.location_from ASC NULLS LAST
      LIMIT 500`);
    res.json(r.rows);
  } catch(e){ res.status(500).json({ error: mapDbError(e) }); }
});

module.exports = router;
