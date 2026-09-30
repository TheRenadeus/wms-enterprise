// Gestión de API Keys + API pública v1 (autenticada con X-API-Key en vez de JWT).
// Extraído de server.js (COD-02).
const express = require('express');
const crypto = require('crypto');
const { pool, mapDbError } = require('../db');
const { requireJefe } = require('../middleware');

const router = express.Router();

const generateApiKey = () => {
  const raw = 'wms_' + crypto.randomBytes(24).toString('hex');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  const prefix = raw.slice(0, 12);
  return { raw, hash, prefix };
};

const requireApiKey = async (req, res, next) => {
  const key = req.headers['x-api-key'];
  if (!key) return res.status(401).json({ error: 'API Key requerida — header X-API-Key' });
  const hash = crypto.createHash('sha256').update(key).digest('hex');
  try {
    const r = await pool.query('SELECT * FROM api_keys WHERE key_hash=$1 AND active=TRUE', [hash]);
    if (!r.rows.length) return res.status(401).json({ error: 'API Key inválida o revocada' });
    await pool.query('UPDATE api_keys SET last_used=NOW() WHERE id=$1', [r.rows[0].id]);
    req.apiKey = r.rows[0];
    next();
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
};

router.get('/keys', requireJefe, async (req, res) => {
  try { res.json((await pool.query('SELECT id,key_prefix,name,client_id,permissions,active,last_used,created_by,created_at FROM api_keys ORDER BY created_at DESC')).rows); }
  catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});
router.post('/keys', requireJefe, async (req, res) => {
  const { name, client_id, permissions, created_by } = req.body;
  if (!name) return res.status(400).json({ error: 'Nombre requerido' });
  const { raw, hash, prefix } = generateApiKey();
  try {
    await pool.query('INSERT INTO api_keys(key_hash,key_prefix,name,client_id,permissions,created_by) VALUES($1,$2,$3,$4,$5,$6)',
      [hash, prefix, name, client_id||null, permissions||'read', created_by||'']);
    res.json({ success: true, key: raw, prefix });
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});
router.delete('/keys/:id', requireJefe, async (req, res) => {
  try { await pool.query('UPDATE api_keys SET active=FALSE WHERE id=$1', [req.params.id]); res.json({ success: true }); }
  catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});

// API v1 pública con API Key
router.get('/v1/inventory', requireApiKey, async (req, res) => {
  const { sku, client_id, location } = req.query;
  const keyClient = req.apiKey.client_id;
  try {
    const conds = ['i.qty>0']; const params = []; let idx = 1;
    if (sku) { conds.push(`i.sku ILIKE $${idx++}`); params.push(`%${sku}%`); }
    if (keyClient) { conds.push(`i.client_id=$${idx++}`); params.push(keyClient); }
    else if (client_id) { conds.push(`i.client_id=$${idx++}`); params.push(client_id); }
    if (location) { conds.push(`i.location_id ILIKE $${idx++}`); params.push(`%${location}%`); }
    const invLimit = Math.min(Math.max(parseInt(req.query.limit) || 500, 1), 1000);
    params.push(invLimit);
    const r = await pool.query(`SELECT i.*,s."desc",s.uom FROM inventory_lpns i LEFT JOIN master_skus s ON i.sku=s.sku AND i.client_id=s.client_id WHERE ${conds.join(' AND ')} ORDER BY i.sku LIMIT $${idx}`, params);
    res.set('X-WMS-Version','1.0').json(r.rows);
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});
router.get('/v1/inventory/:sku/stock', requireApiKey, async (req, res) => {
  const keyClient = req.apiKey.client_id;
  try {
    const params = [req.params.sku]; let cond = 'sku=$1 AND qty>0';
    if (keyClient) { cond += ' AND client_id=$2'; params.push(keyClient); }
    const r = await pool.query(`SELECT COALESCE(SUM(qty),0) as total FROM inventory_lpns WHERE ${cond}`, params);
    res.set('X-WMS-Version','1.0').json({ sku: req.params.sku, total_stock: parseFloat(r.rows[0].total) });
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});
router.get('/v1/skus', requireApiKey, async (req, res) => {
  const keyClient = req.apiKey.client_id;
  try {
    const r = keyClient
      ? await pool.query('SELECT * FROM master_skus WHERE client_id=$1 ORDER BY sku', [keyClient])
      : await pool.query('SELECT * FROM master_skus ORDER BY sku LIMIT 1000');
    res.set('X-WMS-Version','1.0').json(r.rows);
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});
router.get('/v1/movements', requireApiKey, async (req, res) => {
  try {
    // Aislar por client_id de la API Key si está configurada
    const keyClientId = req.apiKey.client_id;
    // Clamp de limit/offset para evitar escaneos de tabla completa
    const limit  = Math.min(Math.max(parseInt(req.query.limit)  || 200, 1), 1000);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);
    let r;
    if (keyClientId) {
      r = await pool.query(
        'SELECT * FROM audit_log WHERE client_id=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
        [keyClientId, limit, offset]
      );
    } else {
      r = await pool.query(
        'SELECT * FROM audit_log ORDER BY created_at DESC LIMIT $1 OFFSET $2',
        [limit, offset]
      );
    }
    res.set('X-WMS-Version','1.0').json(r.rows);
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});

module.exports = router;
