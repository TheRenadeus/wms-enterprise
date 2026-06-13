// Notifications router: badge de alertas del dashboard.

const express = require('express');
const { pool, mapDbError } = require('../db');
const { requireAuth } = require('../middleware');

const router = express.Router();

router.get('/notifications', requireAuth, async (req, res) => {
  try { res.json((await pool.query('SELECT * FROM notifications ORDER BY created_at DESC LIMIT 50')).rows); }
  catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

router.get('/notifications/count', requireAuth, async (req, res) => {
  try {
    const r = await pool.query('SELECT COUNT(*) FROM notifications WHERE read=FALSE');
    res.json({ count: parseInt(r.rows[0].count) });
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

router.put('/notifications/read-all', requireAuth, async (req, res) => {
  try { await pool.query('UPDATE notifications SET read=TRUE'); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

router.put('/notifications/:id/read', requireAuth, async (req, res) => {
  try { await pool.query('UPDATE notifications SET read=TRUE WHERE id=$1', [req.params.id]); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

router.delete('/notifications/:id', requireAuth, async (req, res) => {
  try { await pool.query('DELETE FROM notifications WHERE id=$1', [req.params.id]); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

module.exports = router;
