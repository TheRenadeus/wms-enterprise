// Users router: alta/baja/listado de usuarios.
// El login y el reset-password de SUPERADMIN siguen en sus routers
// (auth.js y system.js respectivamente).

const express = require('express');
const bcrypt = require('bcryptjs');

const { pool, mapDbError } = require('../db');
const { requireAuth, requireAdmin, requireResetPassword } = require('../middleware');

const router = express.Router();

// PASO 2: JEFE_BODEGA+ puede resetear SOLO la contraseña de usuarios de rango
// inferior (no toca rol ni scope). El gate requireResetPassword valida el rango.
router.post('/users/:username/reset-password', requireResetPassword, async (req, res) => {
  const { password } = req.body || {};
  if (!password || String(password).length < 4) return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 4 caracteres.' });
  try {
    const hashed = await bcrypt.hash(String(password), 12);
    const r = await pool.query('UPDATE users SET password=$1 WHERE username=$2 RETURNING username', [hashed, req.params.username]);
    if (!r.rowCount) return res.status(404).json({ error: 'Usuario no encontrado.' });
    await pool.query(
      `INSERT INTO audit_log (type, sku, qty, glosa, username) VALUES ('SYSTEM','N/A',0,$1,$2)`,
      [`Reset de contraseña de '${req.params.username}' (rol ${req.resetTargetRole})`, req.user.username]
    ).catch(() => {});
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

router.get('/users', requireAuth, async (req, res) => {
  try {
    const isSA = req.user.role === 'SUPERADMIN';
    const q = isSA
      ? `SELECT u.username, u.full_name, u.role, u.status, u.allowed_clients, u.allowed_modules,
                u.client_scope,
                COALESCE(array_agg(uc.client_id ORDER BY uc.client_id) FILTER (WHERE uc.client_id IS NOT NULL), '{}') AS assigned_clients
           FROM users u
           LEFT JOIN user_clients uc ON uc.username = u.username
           GROUP BY u.username
           ORDER BY u.username ASC`
      : `SELECT u.username, u.full_name, u.role, u.status, u.allowed_clients, u.allowed_modules,
                u.client_scope,
                COALESCE(array_agg(uc.client_id ORDER BY uc.client_id) FILTER (WHERE uc.client_id IS NOT NULL), '{}') AS assigned_clients
           FROM users u
           LEFT JOIN user_clients uc ON uc.username = u.username
           WHERE u.role != 'SUPERADMIN'
           GROUP BY u.username
           ORDER BY u.username ASC`;
    res.json((await pool.query(q)).rows);
  } catch (err) { res.status(500).json({ error: mapDbError(err) }); }
});

// ── ASIGNACIÓN DE CLIENTES POR USUARIO ───────────────────────────────────────
router.get('/users/:username/clients', requireAdmin, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT uc.id, uc.username, uc.client_id, uc.assigned_by, uc.assigned_at,
              c.name AS client_name
         FROM user_clients uc
         JOIN clients c ON c.id = uc.client_id
        WHERE uc.username = $1
        ORDER BY c.name`,
      [req.params.username]
    );
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

// POST: agrega (upsert) — no elimina los que ya existen
router.post('/users/:username/clients', requireAdmin, async (req, res) => {
  const { client_ids } = req.body || {};
  if (!Array.isArray(client_ids)) return res.status(400).json({ error: 'client_ids debe ser un array' });
  try {
    for (const cid of client_ids) {
      await pool.query(
        `INSERT INTO user_clients (username, client_id, assigned_by) VALUES ($1, $2, $3)
         ON CONFLICT (username, client_id) DO NOTHING`,
        [req.params.username, String(cid).toUpperCase(), req.user.username]
      );
    }
    const updated = await pool.query(
      `SELECT uc.*, c.name AS client_name FROM user_clients uc
         JOIN clients c ON c.id = uc.client_id
        WHERE uc.username = $1 ORDER BY c.name`,
      [req.params.username]
    );
    res.json(updated.rows);
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

// PUT: reemplaza TODA la asignación
router.put('/users/:username/clients', requireAdmin, async (req, res) => {
  const { client_ids } = req.body || {};
  if (!Array.isArray(client_ids)) return res.status(400).json({ error: 'client_ids debe ser un array' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM user_clients WHERE username = $1`, [req.params.username]);
    for (const cid of client_ids) {
      await client.query(
        `INSERT INTO user_clients (username, client_id, assigned_by)
         VALUES ($1, $2, $3) ON CONFLICT (username, client_id) DO NOTHING`,
        [req.params.username, String(cid).toUpperCase(), req.user.username]
      );
    }
    await client.query('COMMIT');
    const updated = await pool.query(
      `SELECT uc.*, c.name AS client_name FROM user_clients uc
         JOIN clients c ON c.id = uc.client_id
        WHERE uc.username = $1 ORDER BY c.name`,
      [req.params.username]
    );
    res.json(updated.rows);
  } catch (e) { await client.query('ROLLBACK'); res.status(500).json({ error: mapDbError(e) }); }
  finally { client.release(); }
});

router.delete('/users/:username/clients/:client_id', requireAdmin, async (req, res) => {
  try {
    const r = await pool.query(
      `DELETE FROM user_clients WHERE username = $1 AND client_id = $2 RETURNING id`,
      [req.params.username, String(req.params.client_id).toUpperCase()]
    );
    if (!r.rowCount) return res.status(404).json({ error: 'Asignación no encontrada' });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

router.delete('/users/:username/clients', requireAdmin, async (req, res) => {
  if (req.body?.confirm !== true) return res.status(400).json({ error: 'Confirme la operación con { confirm: true }' });
  try {
    await pool.query(`DELETE FROM user_clients WHERE username = $1`, [req.params.username]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

router.patch('/users/:username/client-scope', requireAdmin, async (req, res) => {
  const { client_scope } = req.body || {};
  if (!['all','assigned','none'].includes(client_scope)) return res.status(400).json({ error: "client_scope debe ser 'all' | 'assigned' | 'none'" });
  if (req.params.username === req.user.username) return res.status(400).json({ error: 'Un usuario no puede cambiar su propio scope.' });
  try {
    const r = await pool.query(
      `UPDATE users SET client_scope = $1 WHERE username = $2 RETURNING role`,
      [client_scope, req.params.username]
    );
    if (!r.rowCount) return res.status(404).json({ error: 'Usuario no encontrado' });
    // Forzar 'all' para ADMIN/SUPERADMIN
    if (['ADMIN','SUPERADMIN'].includes(r.rows[0].role) && client_scope !== 'all') {
      await pool.query(`UPDATE users SET client_scope = 'all' WHERE username = $1`, [req.params.username]);
      return res.json({ success: true, forced: 'all', reason: 'Los administradores siempre acceden a todos los clientes.' });
    }
    res.json({ success: true, client_scope });
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

router.post('/users', requireAdmin, async (req, res) => {
  const { username, full_name, password, role, status, allowed_clients, allowed_modules } = req.body;
  if (!username) return res.status(400).json({ error: 'El usuario es requerido' });
  if (password && password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
  const VALID_ROLES = ['CLIENTE','PICKER','AUDITOR','EJECUTIVO_CUENTA','JEFE_BODEGA','ADMIN','SUPERADMIN'];
  if (role && !VALID_ROLES.includes(role)) return res.status(400).json({ error: `Rol inválido: ${role}` });
  // Solo SUPERADMIN puede crear/editar usuarios SUPERADMIN
  if (role === 'SUPERADMIN' && req.user.role !== 'SUPERADMIN') return res.status(403).json({ error: 'No se puede asignar el rol SUPERADMIN' });
  const newStatus = status || 'ACTIVE';
  const willBeActive = newStatus !== 'SUSPENDED';
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Serializa altas/reactivaciones para que el conteo de licencia no tenga carrera
    // (dos creaciones simultáneas no pueden ambas pasar el chequeo). Se libera al COMMIT/ROLLBACK.
    await client.query('SELECT pg_advisory_xact_lock(778899)');

    const check = await client.query('SELECT * FROM users WHERE username = $1', [username]);
    if (check.rows.length > 0 && check.rows[0].role === 'SUPERADMIN' && req.user.role !== 'SUPERADMIN') {
      await client.query('ROLLBACK'); return res.status(403).json({ error: 'No se puede modificar un usuario SUPERADMIN' });
    }

    // ── Límite de licencia ──────────────────────────────────────────────────
    // Solo aplica cuando la operación deja un usuario ACTIVO que antes no contaba:
    // alta nueva activa, o reactivación de un suspendido. Editar un activo o
    // suspender a alguien NO consume licencia. Los suspendidos no cuentan.
    // SUPERADMIN es cuenta técnica: queda EXCLUIDO del cupo (ni cuenta ni lo consume).
    const targetRole = role || (check.rows[0] && check.rows[0].role) || 'EJECUTIVO_CUENTA';
    const wasActive = check.rows.length > 0 && (check.rows[0].status || 'ACTIVE') !== 'SUSPENDED';
    const consumeLicense = willBeActive && targetRole !== 'SUPERADMIN' && (check.rows.length === 0 || !wasActive);
    if (consumeLicense) {
      const cfg = await client.query("SELECT value FROM system_config WHERE key = 'license_max_users'");
      const max = parseInt(cfg.rows[0]?.value, 10);
      if (Number.isFinite(max) && max > 0) { // 0 / vacío = sin límite
        const cnt = await client.query("SELECT COUNT(*)::int AS n FROM users WHERE COALESCE(status,'ACTIVE') <> 'SUSPENDED' AND role <> 'SUPERADMIN'");
        if (cnt.rows[0].n >= max) {
          await client.query('ROLLBACK');
          return res.status(403).json({ error: `Límite de licencia alcanzado (${cnt.rows[0].n} de ${max} usuarios activos). Suspenda o elimine un usuario, o amplíe la licencia.`, license_limit: true });
        }
      }
    }

    if (check.rows.length > 0) {
      let q = 'UPDATE users SET full_name=$2, role=$3, status=$4, allowed_clients=$5, allowed_modules=$6 WHERE username=$1';
      let p = [username, full_name, role || 'EJECUTIVO_CUENTA', newStatus, allowed_clients || 'ALL', allowed_modules || 'ALL'];
      if (password) {
        const hashedPw = await bcrypt.hash(password, 12);
        q = 'UPDATE users SET full_name=$2, password=$3, role=$4, status=$5, allowed_clients=$6, allowed_modules=$7 WHERE username=$1';
        p = [username, full_name, hashedPw, role || 'EJECUTIVO_CUENTA', newStatus, allowed_clients || 'ALL', allowed_modules || 'ALL'];
      }
      await client.query(q, p);
    } else {
      if (!password) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Contraseña requerida' }); }
      const hashedNew = await bcrypt.hash(password, 12);
      await client.query(
        `INSERT INTO users (username, full_name, password, role, status, allowed_clients, allowed_modules) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [username, full_name, hashedNew, role || 'EJECUTIVO_CUENTA', newStatus, allowed_clients || 'ALL', allowed_modules || 'ALL']
      );
    }
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: mapDbError(err) });
  } finally { client.release(); }
});

router.delete('/users/:id', requireAdmin, async (req, res) => {
  try {
    const target = await pool.query('SELECT role FROM users WHERE username = $1', [req.params.id]);
    if (!target.rows.length) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (target.rows[0].role === 'SUPERADMIN') return res.status(403).json({ error: 'No se puede eliminar un usuario SUPERADMIN' });
    await pool.query('DELETE FROM users WHERE username = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: mapDbError(err) }); }
});

module.exports = router;
