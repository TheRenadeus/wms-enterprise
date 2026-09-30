// Configuración global del sistema + operaciones SUPERADMIN (métricas, borrado
// directo de inventario/auditoría, formateo de fábrica, promoción de roles,
// reset de contraseña). Extraído de server.js (COD-02).
const express = require('express');
const bcrypt = require('bcryptjs');
const { pool, mapDbError } = require('../db');
const { requireAuth, requireAdmin, requireSuperAdmin } = require('../middleware');
const backupsRouter = require('./backups');

const router = express.Router();

router.get('/system/config', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM system_config`);
    const config = {};
    result.rows.forEach(r => { config[r.key] = r.value; });
    res.json(config);
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});

router.post('/system/config', requireSuperAdmin, async (req, res) => {
  const { configs } = req.body;
  const requester = req.user.username; // usar req.user, no el body (SEC-07)
  if (!configs || typeof configs !== 'object') return res.status(400).json({ error: 'configs debe ser un objeto' });
  try {
    for (const [key, value] of Object.entries(configs)) {
      await pool.query(`INSERT INTO system_config (key, value, updated_by, updated_at) VALUES ($1,$2,$3,NOW()) ON CONFLICT (key) DO UPDATE SET value=$2, updated_by=$3, updated_at=NOW()`,
        [key, String(value), requester]);
    }
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});

// Middleware mantenimiento — agregar verificación en login
router.post('/system/maintenance/check', async (req, res) => {
  try {
    const result = await pool.query(`SELECT value FROM system_config WHERE key='maintenance_mode'`).catch(()=>({rows:[{value:'false'}]}));
    const msg = await pool.query(`SELECT value FROM system_config WHERE key='maintenance_message'`).catch(()=>({rows:[{value:'Sistema en mantenimiento.'}]}));
    res.json({
      maintenance: result.rows[0]?.value === 'true',
      message: msg.rows[0]?.value || 'Sistema en mantenimiento.'
    });
  } catch(e) { res.json({ maintenance: false, message: '' }); }
});

router.get('/system/metrics', requireAdmin, async (req, res) => {
  try {
    const [invCount, skuCount, clientCount, auditCount, userCount, topSkus, recentActivity] = await Promise.all([
      pool.query("SELECT COUNT(*) as total, COALESCE(SUM(qty),0) as units FROM inventory_lpns WHERE qty > 0"),
      pool.query("SELECT COUNT(*) as total FROM master_skus"),
      pool.query("SELECT COUNT(*) as total FROM clients"),
      pool.query("SELECT COUNT(*) as total FROM audit_log"),
      pool.query("SELECT COUNT(*) as total, role, COUNT(*) FROM users GROUP BY role"),
      pool.query("SELECT sku, SUM(qty) as total_qty FROM inventory_lpns WHERE qty > 0 GROUP BY sku ORDER BY total_qty DESC LIMIT 5"),
      pool.query("SELECT type, COUNT(*) as count FROM audit_log WHERE created_at >= NOW() - INTERVAL '7 days' GROUP BY type ORDER BY count DESC")
    ]);
    res.json({
      inventory: { lpns: parseInt(invCount.rows[0].total), units: parseFloat(invCount.rows[0].units) },
      skus: parseInt(skuCount.rows[0].total),
      clients: parseInt(clientCount.rows[0].total),
      auditLogs: parseInt(auditCount.rows[0].total),
      usersByRole: userCount.rows,
      topSkus: topSkus.rows,
      recentActivity: recentActivity.rows
    });
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});

// Acceso remoto vía ngrok (túnel público al puerto de la app). Solo SUPERADMIN
// puede prenderlo/apagarlo — controla el proceso pm2 "ngrok" (mismo usuario del
// sistema, sin sudo). execFile con args fijos: sin interpolación de shell.
const { execFile } = require('child_process');

function pm2Ngrok(action) {
  return new Promise((resolve, reject) => {
    execFile('pm2', [action, 'ngrok'], { timeout: 15000 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve(stdout);
    });
  });
}

function ngrokPm2Status() {
  return new Promise((resolve, reject) => {
    execFile('pm2', ['jlist'], { timeout: 15000 }, (err, stdout) => {
      if (err) return reject(new Error(err.message));
      try {
        const list = JSON.parse(stdout);
        const proc = list.find(p => p.name === 'ngrok');
        resolve(proc ? proc.pm2_env.status : 'not_found');
      } catch (e) { reject(e); }
    });
  });
}

router.get('/system/ngrok/status', requireSuperAdmin, async (req, res) => {
  try {
    const status = await ngrokPm2Status();
    let public_url = null;
    if (status === 'online') {
      try {
        const r = await fetch('http://127.0.0.1:4040/api/tunnels');
        if (r.ok) {
          const d = await r.json();
          public_url = d.tunnels?.[0]?.public_url || null;
        }
      } catch (e) { /* ngrok recién iniciando: su API local aún no responde */ }
    }
    res.json({ status, public_url });
  } catch (e) { res.status(500).json({ error: 'No se pudo consultar el estado de ngrok: ' + e.message }); }
});

router.post('/system/ngrok/toggle', requireSuperAdmin, async (req, res) => {
  const { enable } = req.body;
  if (typeof enable !== 'boolean') return res.status(400).json({ error: 'enable debe ser true o false' });
  try {
    await pm2Ngrok(enable ? 'start' : 'stop');
    const status = await ngrokPm2Status();
    await pool.query(`INSERT INTO audit_log (type,sku,qty,glosa,username) VALUES ('SYSTEM','N/A',0,$1,$2)`,
      [`[SUPERADMIN] Acceso remoto (ngrok) ${enable ? 'ACTIVADO' : 'DESACTIVADO'}`, req.user.username]).catch(() => {});
    res.json({ success: true, status });
  } catch (e) { res.status(500).json({ error: 'No se pudo cambiar el estado de ngrok: ' + e.message }); }
});

// Endpoint de contraseñas eliminado por seguridad (SEC-07)
router.post('/system/users/passwords', (req, res) => {
  res.status(410).json({ error: 'Endpoint eliminado por políticas de seguridad. Las contraseñas se almacenan con bcrypt.' });
});

// Eliminar registro de inventario directo
router.delete('/system/inventory/:id', requireSuperAdmin, async (req, res) => {
  const requester = req.user.username; // SEC: usar JWT verificado, no body
  try {
    const inv = await pool.query("SELECT * FROM inventory_lpns WHERE id = $1", [req.params.id]);
    if (!inv.rows.length) return res.status(404).json({ error: 'LPN no encontrado' });
    await pool.query("DELETE FROM inventory_lpns WHERE id = $1", [req.params.id]);
    await pool.query("INSERT INTO audit_log (type, sku, qty, glosa, username) VALUES ('ADJUST_OUT', $1, $2, $3, $4)",
      [inv.rows[0].sku, inv.rows[0].qty, `[SUPERADMIN] Eliminación directa de LPN ${req.params.id}`, requester]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});

// Eliminar log de auditoría
router.delete('/system/audit/:id', requireSuperAdmin, async (req, res) => {
  try {
    await pool.query("DELETE FROM audit_log WHERE id = $1", [req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});

// Limpiar todos los logs de auditoría
router.delete('/system/audit', requireSuperAdmin, async (req, res) => {
  try {
    await pool.query("TRUNCATE audit_log RESTART IDENTITY");
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});

// FORMATEO DE FÁBRICA: deja el sistema "como recién instalado".
// Borra TODOS los datos de negocio pero PRESERVA: el esqueleto base (statuses,
// document_types, system_config = licencia/config) y los usuarios SUPERADMIN
// (para no quedar bloqueado). Hace un backup de seguridad ANTES (reversible con
// recover.js o el restore). Requiere confirm:'FORMATEAR' (también valida el server,
// no solo el front). IRREVERSIBLE salvo por el backup previo.
const FACTORY_PRESERVE = ['statuses', 'document_types', 'system_config'];
router.post('/system/factory-reset', requireSuperAdmin, async (req, res) => {
  if (req.body?.confirm !== 'FORMATEAR') return res.status(400).json({ error: "Confirmación inválida: envía confirm:'FORMATEAR'." });
  let backupName = null;
  try {
    // 1) Backup de seguridad ANTES de borrar. Si falla, abortar (no borrar sin red).
    try {
      const b = await backupsRouter.ejecutarBackup('PRE_FORMAT', req.user.username);
      backupName = b?.filename || null;
    } catch (e) {
      return res.status(500).json({ error: 'No se pudo crear el backup de seguridad previo; formateo abortado: ' + e.message });
    }

    // 2) Capturar el esqueleto a preservar (antes del wipe).
    const supers = (await pool.query(`SELECT * FROM users WHERE role='SUPERADMIN'`)).rows;
    const preserved = {};
    for (const t of FACTORY_PRESERVE) preserved[t] = (await pool.query(`SELECT * FROM ${t}`)).rows;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // 3) Vaciar TODO menos la tabla de migraciones.
      const tbls = (await client.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> 'schema_migrations'`))
        .rows.map(r => `"${r.tablename}"`);
      await client.query(`TRUNCATE TABLE ${tbls.join(', ')} RESTART IDENTITY CASCADE`);
      // 4) Re-insertar el esqueleto (superadmins + catálogos/config base).
      const reinsert = async (table, rows) => {
        for (const row of rows) {
          const cols = Object.keys(row);
          const colList = cols.map(c => `"${c}"`).join(',');
          const ph = cols.map((_, i) => `$${i + 1}`).join(',');
          await client.query(`INSERT INTO ${table} (${colList}) VALUES (${ph})`, cols.map(c => row[c]));
        }
      };
      await reinsert('users', supers);
      for (const t of FACTORY_PRESERVE) await reinsert(t, preserved[t]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally { client.release(); }

    // 5) Registrar el formateo en el (ahora vacío) audit_log.
    await pool.query(`INSERT INTO audit_log (type,sku,qty,glosa,username) VALUES ('SYSTEM','N/A',0,$1,$2)`,
      [`Formateo de fábrica. Backup de seguridad: ${backupName || '(sin nombre)'}`, req.user.username]).catch(() => {});

    res.json({
      success: true,
      backup: backupName,
      preserved: { superadmins: supers.length, statuses: preserved.statuses.length, document_types: preserved.document_types.length, system_config: preserved.system_config.length },
    });
  } catch (err) {
    res.status(500).json({ error: 'Error durante el formateo: ' + (err.message || err) + (backupName ? ` — el backup de seguridad '${backupName}' SÍ se creó.` : '') });
  }
});

// Proteger creación de ADMIN - solo SUPERADMIN puede crear/eliminar admins
router.post('/system/promote', requireSuperAdmin, async (req, res) => {
  const { username, newRole } = req.body;
  try {
    const target = await pool.query("SELECT role FROM users WHERE username = $1", [username]);
    if (!target.rows.length) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (target.rows[0].role === 'SUPERADMIN') return res.status(400).json({ error: 'No se puede modificar al SUPERADMIN' });
    await pool.query("UPDATE users SET role = $1 WHERE username = $2", [newRole, username]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});

// Editar log de auditoría
router.put('/system/audit/:id', requireSuperAdmin, async (req, res) => {
  const { glosa } = req.body;
  try {
    await pool.query("UPDATE audit_log SET glosa = $1 WHERE id = $2", [glosa, req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});

// Resetear contraseña de usuario (solo SUPERADMIN)
router.post('/system/users/reset-password', requireSuperAdmin, async (req, res) => {
  const { username, new_password } = req.body;
  if (!username || !new_password) return res.status(400).json({ error: 'username y new_password requeridos.' });
  if (new_password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });
  try {
    const check = await pool.query('SELECT role FROM users WHERE username=$1', [username]);
    if (!check.rows.length) return res.status(404).json({ error: 'Usuario no encontrado.' });
    const hashed = await bcrypt.hash(new_password, 12);
    await pool.query('UPDATE users SET password=$1 WHERE username=$2', [hashed, username]);
    await pool.query(`INSERT INTO audit_log (type,sku,qty,glosa,username) VALUES ('SYSTEM','N/A',0,$1,$2)`, [`[SUPERADMIN] Reset de contraseña del usuario ${username}`, req.user.username]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

module.exports = router;
