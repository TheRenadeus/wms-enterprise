// Gestión de API Keys + API pública v1 (autenticada con X-API-Key en vez de JWT).
// Extraído de server.js (COD-02).
const express = require('express');
const crypto = require('crypto');
const { pool, mapDbError } = require('../db');
const { requireJefe } = require('../middleware');
const { clientAllowed, scopeCondition } = require('../scope');

const KEY_PERMISSIONS = ['read', 'write'];
const canManageGlobalKeys = (user) => ['ADMIN', 'SUPERADMIN'].includes(user?.role);

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

// Una key sin cliente lee los datos de todos los clientes: solo ADMIN+ la crea,
// la ve o la revoca. El resto gestiona solo keys de clientes dentro de su alcance.
router.get('/keys', requireJefe, async (req, res) => {
  try {
    const params = [];
    const where = canManageGlobalKeys(req.user) ? 'TRUE' : scopeCondition(req.clientScope, 'client_id', params).replace(/^TRUE$/, 'client_id IS NOT NULL');
    res.json((await pool.query(`SELECT id,key_prefix,name,client_id,permissions,active,last_used,created_by,created_at FROM api_keys WHERE ${where} ORDER BY created_at DESC`, params)).rows);
  }
  catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});
router.post('/keys', requireJefe, async (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  const client_id = req.body?.client_id ? String(req.body.client_id).trim() : null;
  const permissions = req.body?.permissions ?? 'read';
  if (!name || name.length > 100) return res.status(400).json({ error: 'Nombre requerido (máximo 100 caracteres)' });
  if (!KEY_PERMISSIONS.includes(permissions)) return res.status(400).json({ error: `Permiso inválido: use ${KEY_PERMISSIONS.join(' o ')}` });
  if (!client_id && !canManageGlobalKeys(req.user)) return res.status(403).json({ error: 'Debes asociar la API Key a un cliente. Solo un administrador puede crear keys sin cliente.' });
  if (client_id && !clientAllowed(req.clientScope, client_id)) return res.status(403).json({ error: `Acceso denegado al cliente '${client_id}'.` });
  try {
    if (client_id) {
      const c = await pool.query('SELECT 1 FROM clients WHERE id=$1', [client_id]);
      if (!c.rows.length) return res.status(400).json({ error: `El cliente '${client_id}' no existe` });
    }
    const { raw, hash, prefix } = generateApiKey();
    await pool.query('INSERT INTO api_keys(key_hash,key_prefix,name,client_id,permissions,created_by) VALUES($1,$2,$3,$4,$5,$6)',
      [hash, prefix, name, client_id, permissions, req.user.username]);
    res.json({ success: true, key: raw, raw_key: raw, prefix });
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});
router.delete('/keys/:id', requireJefe, async (req, res) => {
  try {
    const k = await pool.query('SELECT client_id FROM api_keys WHERE id=$1', [req.params.id]);
    const key = k.rows[0];
    const allowed = key && (canManageGlobalKeys(req.user) || (key.client_id && clientAllowed(req.clientScope, key.client_id)));
    if (!allowed) return res.status(404).json({ error: 'API Key no encontrada' });
    await pool.query('UPDATE api_keys SET active=FALSE WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  }
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
        `SELECT * FROM audit_log WHERE client_id=$1 AND type <> 'SYSTEM' ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
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
