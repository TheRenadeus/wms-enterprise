// Auth router: login + login-history.
//
// Nota: /api/users y endpoints de usuarios siguen en server.js por ahora (mover
// en un próximo paso). El login está aquí porque es el endpoint más sensible:
// concentra rate-limit, hash, login_history y emisión de JWT.

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const { pool, mapDbError } = require('../db');
const { JWT_SECRET, requireAuth, loginLimiter } = require('../middleware');
const { validateBody, schemas } = require('../schemas');

const router = express.Router();

router.get('/login', (req, res) => {
  res.status(405).json({ error: 'Usa POST /api/login con { username, password } en el body.' });
});

router.post('/login', loginLimiter, validateBody(schemas.login), async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    // SEC-09: dummy compare iguala tiempos para evitar enumeración por timing.
    const DUMMY_HASH = '$2b$12$invalidhashusedfortimingprotectiononly000000000000000';
    if (result.rows.length === 0) {
      await bcrypt.compare(password, DUMMY_HASH).catch(() => {});
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }
    const u = result.rows[0];
    if (u.status === 'SUSPENDED') return res.status(403).json({ error: 'Cuenta Suspendida.' });

    let valid = false;
    if (u.password && (u.password.startsWith('$2b$') || u.password.startsWith('$2a$'))) {
      valid = await bcrypt.compare(password, u.password);
    } else {
      valid = u.password === password;
      if (valid) {
        const hashed = await bcrypt.hash(password, 12);
        await pool.query('UPDATE users SET password = $1 WHERE username = $2', [hashed, u.username]);
      }
    }
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    if (!valid) {
      pool.query(`INSERT INTO login_history(username,ip,success) VALUES($1,$2,FALSE)`, [username, ip]).catch(() => {});
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    pool.query(`INSERT INTO login_history(username,ip,success) VALUES($1,$2,TRUE)`, [u.username, ip]).catch(() => {});

    // Resolver scope y assigned_clients
    const isAdminRole = ['ADMIN','SUPERADMIN'].includes(u.role);
    const effectiveScope = isAdminRole ? 'all' : (u.client_scope || 'all');
    let assignedIds = [];
    let assignedClients = [];
    if (effectiveScope === 'all') {
      const allRes = await pool.query(`SELECT id, name FROM clients WHERE active = TRUE OR active IS NULL ORDER BY name`);
      assignedClients = allRes.rows;
      assignedIds = assignedClients.map(c => c.id);
    } else if (effectiveScope === 'assigned') {
      const r = await pool.query(
        `SELECT c.id, c.name FROM user_clients uc
           JOIN clients c ON c.id = uc.client_id
          WHERE uc.username = $1 ORDER BY c.name`,
        [u.username]
      );
      assignedClients = r.rows;
      assignedIds = assignedClients.map(c => c.id);
    } // 'none' → arrays vacíos

    const token = jwt.sign(
      {
        username: u.username, role: u.role,
        allowed_clients: u.allowed_clients, allowed_modules: u.allowed_modules,
        client_scope: effectiveScope,
        assigned_clients: assignedIds,
      },
      JWT_SECRET,
      { expiresIn: '12h' }
    );
    res.json({
      success: true,
      token,
      user: {
        username: u.username, full_name: u.full_name, role: u.role,
        allowed_clients: u.allowed_clients, allowed_modules: u.allowed_modules,
        client_scope: effectiveScope,
        assigned_clients: assignedClients,
      },
    });
  } catch (err) { res.status(500).json({ error: mapDbError(err) }); }
});

router.get('/login-history', requireAuth, async (req, res) => {
  if (!['ADMIN', 'SUPERADMIN'].includes(req.user.role)) return res.status(403).json({ error: 'Acceso restringido' });
  const isSA = req.user.role === 'SUPERADMIN';
  const { username, ip, success, from, to } = req.query;
  const limit = Math.min(parseInt(req.query.limit) || 200, 1000);
  const offset = parseInt(req.query.offset) || 0;
  // Si el caller NO es SUPERADMIN, ocultar todo acceso de usuarios SUPERADMIN.
  // (LEFT JOIN: u.role IS NULL → usuario eliminado, lo mostramos igualmente)
  const hideSAClause = isSA ? '' : `AND (u.role IS NULL OR u.role <> 'SUPERADMIN')`;
  try {
    const conds = ['1=1'];
    const params = [];
    if (username) { params.push(`%${username}%`); conds.push(`lh.username ILIKE $${params.length}`); }
    if (ip)       { params.push(`%${ip}%`);       conds.push(`lh.ip ILIKE $${params.length}`); }
    if (success === 'true')  conds.push(`lh.success = TRUE`);
    if (success === 'false') conds.push(`lh.success = FALSE`);
    if (from) { params.push(from); conds.push(`lh.created_at >= $${params.length}::date`); }
    if (to)   { params.push(to);   conds.push(`lh.created_at <= $${params.length}::date + INTERVAL '1 day'`); }
    const where = conds.join(' AND ');

    const [rows, countRow, statsRow] = await Promise.all([
      pool.query(
        `SELECT lh.id, lh.username, lh.ip, lh.success, lh.created_at,
                u.role, u.full_name
         FROM login_history lh
         LEFT JOIN users u ON u.username = lh.username
         WHERE ${where} ${hideSAClause}
         ORDER BY lh.created_at DESC
         LIMIT ${limit} OFFSET ${offset}`,
        params
      ),
      pool.query(
        `SELECT COUNT(*)::int AS n
         FROM login_history lh
         LEFT JOIN users u ON u.username = lh.username
         WHERE ${where} ${hideSAClause}`,
        params
      ),
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE lh.success = TRUE)::int  AS ok_total,
          COUNT(*) FILTER (WHERE lh.success = FALSE)::int AS fail_total,
          COUNT(*) FILTER (WHERE lh.success = TRUE AND lh.created_at::date = CURRENT_DATE)::int  AS ok_today,
          COUNT(*) FILTER (WHERE lh.success = FALSE AND lh.created_at::date = CURRENT_DATE)::int AS fail_today,
          COUNT(DISTINCT lh.username) FILTER (WHERE lh.success = TRUE AND lh.created_at >= NOW() - INTERVAL '24 hours')::int AS active_24h,
          COUNT(DISTINCT lh.ip)::int AS distinct_ips
        FROM login_history lh
        LEFT JOIN users u ON u.username = lh.username
        WHERE 1=1 ${hideSAClause}
      `),
    ]);
    res.json({
      rows: rows.rows,
      total: countRow.rows[0].n,
      limit, offset,
      stats: statsRow.rows[0],
    });
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

module.exports = router;
