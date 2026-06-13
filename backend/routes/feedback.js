// Feedback / sugerencias del staff.
// POST   /api/feedback              → cualquier usuario autenticado (no PICKER ni CLIENTE).
// GET    /api/feedback              → SUPERADMIN lista todos.
// PATCH  /api/feedback/:id/status   → SUPERADMIN cambia status (NUEVO|EN_REVISION|RESUELTO).
// DELETE /api/feedback/:id          → SUPERADMIN elimina.

const express = require('express');
const { pool, mapDbError } = require('../db');
const { requireAuth, requireSuperAdmin } = require('../middleware');

const router = express.Router();

const VALID_CATEGORIES = ['BUG', 'MEJORA', 'IDEA'];
const VALID_STATUSES   = ['NUEVO', 'EN_REVISION', 'RESUELTO'];

router.post('/feedback', requireAuth, async (req, res) => {
  if (['PICKER', 'CLIENTE'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Tu rol no puede enviar feedback por este canal.' });
  }
  const { message, category, page } = req.body || {};
  if (!message || typeof message !== 'string' || message.trim().length < 5) {
    return res.status(400).json({ error: 'El mensaje debe tener al menos 5 caracteres.' });
  }
  if (message.length > 4000) {
    return res.status(400).json({ error: 'El mensaje no puede exceder 4000 caracteres.' });
  }
  const cat = VALID_CATEGORIES.includes(category) ? category : 'MEJORA';
  try {
    const r = await pool.query(
      `INSERT INTO feedback (username, role, category, message, page, status)
       VALUES ($1, $2, $3, $4, $5, 'NUEVO') RETURNING *`,
      [req.user.username, req.user.role, cat, message.trim(), page || null]
    );
    res.json({ success: true, feedback: r.rows[0] });
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

router.get('/feedback', requireSuperAdmin, async (req, res) => {
  const { status, category } = req.query;
  try {
    const conds = ['1=1'];
    const params = [];
    if (status && VALID_STATUSES.includes(status)) {
      params.push(status); conds.push(`status = $${params.length}`);
    }
    if (category && VALID_CATEGORIES.includes(category)) {
      params.push(category); conds.push(`category = $${params.length}`);
    }
    const r = await pool.query(
      `SELECT * FROM feedback WHERE ${conds.join(' AND ')} ORDER BY created_at DESC LIMIT 500`,
      params
    );
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

router.patch('/feedback/:id/status', requireSuperAdmin, async (req, res) => {
  const { status } = req.body || {};
  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: `Status inválido. Use: ${VALID_STATUSES.join(', ')}` });
  }
  try {
    if (status === 'RESUELTO') {
      await pool.query(
        `UPDATE feedback SET status='RESUELTO', resolved_at=NOW(), resolved_by=$1 WHERE id=$2`,
        [req.user.username, req.params.id]
      );
    } else {
      await pool.query(
        `UPDATE feedback SET status=$1, resolved_at=NULL, resolved_by=NULL WHERE id=$2`,
        [status, req.params.id]
      );
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

router.delete('/feedback/:id', requireSuperAdmin, async (req, res) => {
  try {
    await pool.query(`DELETE FROM feedback WHERE id = $1`, [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

module.exports = router;
