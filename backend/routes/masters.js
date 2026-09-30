// Datos maestros (statuses, locations, document_types): GETs cacheados +
// escrituras de document_types/statuses (COD-02). El middleware de invalidación
// de cache en server.js sigue funcionando porque invalida por path, no por router.

const express = require('express');
const { pool, mapDbError } = require('../db');
const { requireAuth, requireJefe } = require('../middleware');
const { cached } = require('../cache');
const { validateBody, schemas } = require('../schemas');

const router = express.Router();

router.get('/locations', requireAuth, async (req, res) => {
  try {
    const rows = await cached('locations:all', async () =>
      (await pool.query('SELECT * FROM locations_master ORDER BY location_id ASC')).rows
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: mapDbError(err) }); }
});

router.get('/statuses', requireAuth, async (req, res) => {
  try {
    const rows = await cached('statuses:all', async () =>
      (await pool.query('SELECT * FROM statuses ORDER BY id ASC')).rows
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: mapDbError(err) }); }
});

router.get('/document_types', requireAuth, async (req, res) => {
  try {
    const rows = await cached('document_types:all', async () =>
      (await pool.query('SELECT * FROM document_types ORDER BY id ASC')).rows
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: mapDbError(err) }); }
});

router.post('/document_types', requireJefe, validateBody(schemas.documentTypeCreate), async (req, res) => {
  const { id, description, flow_type } = req.body;
  if (!id || !String(id).trim()) return res.status(400).json({ error: 'El ID del tipo de documento es requerido' });
  if (!description || !String(description).trim()) return res.status(400).json({ error: 'La descripción es requerida' });
  const normalizedId = String(id).toUpperCase().replace(/[^A-Z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  if (!normalizedId) return res.status(400).json({ error: 'El ID solo contiene caracteres inválidos' });
  try {
    await pool.query(`INSERT INTO document_types (id, description, flow_type) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET description=EXCLUDED.description, flow_type=EXCLUDED.flow_type`, [normalizedId, description.trim(), flow_type || 'BOTH']);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: mapDbError(err) }); }
});
router.delete('/document_types/:id', requireJefe, async (req, res) => {
  try {
    const inUse = await pool.query('SELECT COUNT(*) as count FROM document_history WHERE doc_type=$1', [req.params.id]);
    if (parseInt(inUse.rows[0].count) > 0)
      return res.status(400).json({ error: `No se puede eliminar: el tipo '${req.params.id}' está en uso en ${inUse.rows[0].count} documento(s) histórico(s).` });
    const result = await pool.query('DELETE FROM document_types WHERE id=$1', [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Tipo de documento no encontrado' });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: mapDbError(err) }); }
});

router.post('/statuses', requireJefe, validateBody(schemas.statusCreate), async (req, res) => {
  const { id, description, color, blocks_outbound } = req.body;
  try { await pool.query(`INSERT INTO statuses (id, description, color, blocks_outbound) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO UPDATE SET description=EXCLUDED.description, color=EXCLUDED.color, blocks_outbound=EXCLUDED.blocks_outbound`, [id.toUpperCase().replace(/\s/g, '_'), description, color || 'slate', blocks_outbound || false]); res.json({ success: true }); } catch (err) { res.status(500).json({ error: mapDbError(err) }); }
});
router.delete('/statuses/:id', requireJefe, async (req, res) => {
  try {
    const PROTECTED = ['DISPONIBLE','BLOQUEADO','CUARENTENA','DESPACHADO'];
    if (PROTECTED.includes(req.params.id)) return res.status(400).json({ error: `El estado '${req.params.id}' es un estado base del sistema y no puede eliminarse.` });
    const invCheck = await pool.query('SELECT COUNT(*) as count FROM inventory_lpns WHERE status=$1 AND qty>0', [req.params.id]);
    if (parseInt(invCheck.rows[0].count) > 0) return res.status(400).json({ error: `No se puede eliminar: hay ${invCheck.rows[0].count} LPN(s) activo(s) con este estado.` });
    const result = await pool.query('DELETE FROM statuses WHERE id=$1', [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Estado no encontrado' });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: mapDbError(err) }); }
});

module.exports = router;
