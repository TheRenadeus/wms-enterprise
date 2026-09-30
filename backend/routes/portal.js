// Portal de clientes: login propio (JWT separado) + inventario/movimientos/reportes
// de solo lectura para el cliente autenticado. Extraído de server.js (COD-02).
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { pool, mapDbError } = require('../db');
const { JWT_SECRET, requireJefe, portalLoginLimiter } = require('../middleware');

const router = express.Router();

const PORTAL_SECRET = process.env.PORTAL_SECRET || (JWT_SECRET + '-portal');

const requirePortalAuth = (req, res, next) => {
  const token = req.headers['x-portal-token'];
  if (!token) return res.status(401).json({ error: 'Portal token requerido' });
  try { req.portal = jwt.verify(token, PORTAL_SECRET); next(); }
  catch(e) { return res.status(401).json({ error: 'Token de portal inválido o expirado' }); }
};

router.post('/portal/login', portalLoginLimiter, async (req, res) => {
  const { client_id, password } = req.body;
  if (!client_id || !password) return res.status(400).json({ error: 'Cliente y contraseña requeridos' });
  try {
    const r = await pool.query('SELECT * FROM clients WHERE id=$1', [client_id]);
    if (!r.rows.length) return res.status(401).json({ error: 'Credenciales inválidas' });
    const c = r.rows[0];
    if (!c.portal_enabled) return res.status(403).json({ error: 'Portal no habilitado para este cliente' });
    let valid = false;
    if (c.portal_password && (c.portal_password.startsWith('$2b$') || c.portal_password.startsWith('$2a$'))) {
      valid = await bcrypt.compare(password, c.portal_password);
    } else {
      valid = c.portal_password === password;
      // Migrar contraseña en texto plano a bcrypt
      if (valid) {
        const hashed = await bcrypt.hash(password, 12);
        await pool.query('UPDATE clients SET portal_password=$1 WHERE id=$2', [hashed, c.id]);
      }
    }
    if (!valid) return res.status(401).json({ error: 'Credenciales inválidas' });
    const token = jwt.sign({ client_id: c.id, client_name: c.name }, PORTAL_SECRET, { expiresIn: '12h' });
    res.json({ success: true, token, client: { id: c.id, name: c.name, email: c.email } });
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});

router.get('/portal/inventory/:client_id', requirePortalAuth, async (req, res) => {
  if (req.portal.client_id !== req.params.client_id) return res.status(403).json({ error: 'Acceso denegado' });
  try {
    const { sku } = req.query;
    let inv;
    const portalLimit = 5000;
    if (sku) {
      inv = await pool.query(
        `SELECT i.*, s."desc", s.uom FROM inventory_lpns i LEFT JOIN master_skus s ON i.sku=s.sku AND i.client_id=s.client_id WHERE i.client_id=$1 AND i.qty>0 AND i.sku ILIKE $2 ORDER BY i.created_at DESC LIMIT $3`,
        [req.params.client_id, `%${sku}%`, portalLimit]
      );
    } else {
      inv = await pool.query(
        `SELECT i.*, s."desc", s.uom FROM inventory_lpns i LEFT JOIN master_skus s ON i.sku=s.sku AND i.client_id=s.client_id WHERE i.client_id=$1 AND i.qty>0 ORDER BY i.created_at DESC LIMIT $2`,
        [req.params.client_id, portalLimit]
      );
    }
    const stats = { total_lpns: inv.rows.length, total_units: inv.rows.reduce((s,r)=>s+parseFloat(r.qty),0), total_skus: new Set(inv.rows.map(r=>r.sku)).size };
    res.json({ inventory: inv.rows, stats });
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});

router.get('/portal/movements/:client_id', requirePortalAuth, async (req, res) => {
  if (req.portal.client_id !== req.params.client_id) return res.status(403).json({ error: 'Acceso denegado' });
  try {
    const skus = await pool.query('SELECT sku FROM master_skus WHERE client_id=$1', [req.params.client_id]);
    const skuList = skus.rows.map(r=>r.sku);
    if (!skuList.length) return res.json([]);
    const logs = await pool.query(`SELECT * FROM audit_log WHERE sku=ANY($1) ORDER BY created_at DESC LIMIT 100`, [skuList]);
    res.json(logs.rows);
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});

router.get('/portal/reports/:client_id', requirePortalAuth, async (req, res) => {
  if (req.portal.client_id !== req.params.client_id) return res.status(403).json({ error: 'Acceso denegado' });
  const cid = req.params.client_id;
  try {
    const [invAgg, receipts30d, topSkus, monthly] = await Promise.all([
      pool.query(`SELECT COALESCE(SUM(qty),0)::float AS total_units,
                          COUNT(*) FILTER (WHERE qty>0)::int AS total_lpns,
                          COUNT(DISTINCT sku) FILTER (WHERE qty>0)::int AS total_skus
                   FROM inventory_lpns WHERE client_id=$1`, [cid]),
      pool.query(`SELECT COUNT(*)::int AS receipts_30d
                   FROM audit_log al
                   JOIN master_skus ms ON ms.sku=al.sku AND ms.client_id=$1
                   WHERE al.type='INBOUND' AND al.created_at >= NOW() - INTERVAL '30 days'`, [cid]),
      pool.query(`SELECT al.sku, ms."desc" AS sku_desc,
                          COALESCE(SUM(al.qty),0)::float AS dispatched_qty
                   FROM audit_log al
                   JOIN master_skus ms ON ms.sku=al.sku AND ms.client_id=$1
                   WHERE al.type IN ('OUTBOUND','ADJUST_OUT')
                     AND al.created_at >= NOW() - INTERVAL '30 days'
                   GROUP BY al.sku, ms."desc"
                   ORDER BY dispatched_qty DESC LIMIT 10`, [cid]),
      pool.query(`SELECT to_char(al.created_at,'YYYY-MM') AS month, al.type,
                          COUNT(*)::int AS operations, COALESCE(SUM(al.qty),0)::float AS total_qty
                   FROM audit_log al
                   JOIN master_skus ms ON ms.sku=al.sku AND ms.client_id=$1
                   WHERE al.created_at >= NOW() - INTERVAL '6 months'
                   GROUP BY month, al.type ORDER BY month DESC`, [cid]),
    ]);
    res.json({
      total_units: invAgg.rows[0].total_units,
      total_lpns:  invAgg.rows[0].total_lpns,
      total_skus:  invAgg.rows[0].total_skus,
      receipts_30d: receipts30d.rows[0].receipts_30d,
      top_skus: topSkus.rows,
      monthly: monthly.rows,
      current_stock: invAgg.rows[0].total_units,
    });
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});

router.put('/clients/:id/portal', requireJefe, async (req, res) => {
  const { portal_enabled, portal_password, portal_email } = req.body;
  try {
    // Verificar que el cliente existe
    const exists = await pool.query('SELECT id FROM clients WHERE id=$1', [req.params.id]);
    if (!exists.rows.length) return res.status(404).json({ error: 'Cliente no encontrado' });
    // Si se activa portal, contraseña es obligatoria la primera vez y debe tener >= 8 chars
    if (portal_enabled && portal_password && portal_password.length < 8)
      return res.status(400).json({ error: 'La contraseña del portal debe tener al menos 8 caracteres' });
    // Verificar que el portal_email no esté en uso por otro cliente
    if (portal_email && portal_email.trim() !== '') {
      const peDup = await pool.query(`SELECT id FROM clients WHERE portal_email=$1 AND id<>$2 LIMIT 1`, [portal_email.trim(), req.params.id]);
      if (peDup.rows.length > 0)
        return res.status(409).json({ error: `El email de portal '${portal_email.trim()}' ya está en uso por el cliente '${peDup.rows[0].id}'.` });
    }
    const parts = ['portal_enabled=$2'];
    const params = [req.params.id, portal_enabled ?? false];
    if (portal_email !== undefined) { parts.push(`portal_email=$${params.length+1}`); params.push(portal_email); }
    if (portal_password) {
      const hashed = await bcrypt.hash(portal_password, 12);
      parts.push(`portal_password=$${params.length+1}`); params.push(hashed);
    }
    await pool.query(`UPDATE clients SET ${parts.join(',')} WHERE id=$1`, params);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});

module.exports = router;
