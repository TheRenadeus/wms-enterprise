// Datos maestros (statuses, locations, document_types): GETs cacheados.
// Las escrituras de cada maestro siguen en server.js para no mover demasiado
// código de golpe; el middleware de invalidación de cache en server.js sigue
// funcionando porque invalida por path, no por router.

const express = require('express');
const { pool, mapDbError } = require('../db');
const { requireAuth } = require('../middleware');
const { cached } = require('../cache');

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

module.exports = router;
