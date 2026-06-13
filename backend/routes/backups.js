// Sistema de backups. Solo SUPERADMIN.
// - POST   /api/system/backup                → crea snapshot manual
// - GET    /api/system/backups               → lista
// - GET    /api/system/backups/:id/download  → descarga el JSON
// - POST   /api/system/backups/:id/restore   → restaura (auto-genera PRE_RESTORE)
// - DELETE /api/system/backups/:id           → borra (excepto el más reciente)
//
// Cron 03:00 diario + retención 30 días / 30 archivos.

const express = require('express');
const fs = require('fs');
const path = require('path');
const { pool, mapDbError } = require('../db');
const { requireSuperAdmin } = require('../middleware');

const router = express.Router();

// Tablas críticas en orden seguro de restauración (sin FKs huérfanas).
const BACKUP_TABLES = [
  'clients', 'users', 'master_skus', 'locations_master', 'statuses', 'document_types',
  'kits', 'kit_components', 'inventory_lpns', 'audit_log',
  'pick_tasks', 'pick_task_lines',
  'notifications', 'billing_invoices',
  'dispatch_schedules', 'purchase_orders', 'carriers', 'shipments',
];

const BACKUPS_DIR = path.resolve(__dirname, '..', 'backups');
if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true });

const tableExists = async (db, name) => {
  const r = await db.query(`SELECT to_regclass($1) AS t`, [`public.${name}`]);
  return !!r.rows[0].t;
};

const stamp = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`;
};

// Ejecuta un snapshot. Devuelve la fila insertada en system_backups.
async function ejecutarBackup(trigger, createdBy) {
  const filename = `wms_backup_${stamp()}.json`;
  const filepath = path.join(BACKUPS_DIR, filename);
  const dump = {};
  const tableCounts = {};
  const t0 = Date.now();

  for (const tbl of BACKUP_TABLES) {
    if (!(await tableExists(pool, tbl))) { dump[tbl] = []; tableCounts[tbl] = 0; continue; }
    const r = await pool.query(`SELECT * FROM ${tbl}`);
    dump[tbl] = r.rows;
    tableCounts[tbl] = r.rows.length;
  }
  const payload = JSON.stringify({ version: 1, generated_at: new Date().toISOString(), tables: dump });
  fs.writeFileSync(filepath, payload);
  const sizeBytes = fs.statSync(filepath).size;
  const ins = await pool.query(
    `INSERT INTO system_backups (filename, size_bytes, tables, trigger, status, created_by)
     VALUES ($1,$2,$3,$4,'OK',$5) RETURNING *`,
    [filename, sizeBytes, JSON.stringify(tableCounts), trigger, createdBy]
  );
  console.log(`[BACKUP] OK — ${filename} — ${(sizeBytes/1024/1024).toFixed(2)} MB — ${Date.now()-t0}ms`);
  return ins.rows[0];
}

async function purgarBackupsViejos() {
  // Retención: 30 días o máximo 30 archivos. Nunca borra el más reciente.
  const all = (await pool.query(
    `SELECT id, filename, created_at FROM system_backups ORDER BY created_at DESC`
  )).rows;
  const toDelete = [];
  all.forEach((b, idx) => {
    if (idx === 0) return;
    const ageDays = (Date.now() - new Date(b.created_at).getTime()) / 86400000;
    if (ageDays > 30 || idx >= 30) toDelete.push(b);
  });
  for (const b of toDelete) {
    try { fs.unlinkSync(path.join(BACKUPS_DIR, b.filename)); } catch(e) {}
    await pool.query(`DELETE FROM system_backups WHERE id=$1`, [b.id]);
  }
  if (toDelete.length) console.log(`[BACKUP] Purgados ${toDelete.length} backups antiguos`);
}

// ── ENDPOINTS ────────────────────────────────────────────────────────────────

router.post('/system/backup', requireSuperAdmin, async (req, res) => {
  try {
    const row = await ejecutarBackup('MANUAL', req.user.username);
    await purgarBackupsViejos();
    res.json({
      id: row.id,
      filename: row.filename,
      size_bytes: parseInt(row.size_bytes),
      tables: row.tables,
      created_at: row.created_at,
    });
  } catch (e) {
    console.error('[BACKUP] ERROR:', e.message);
    try {
      await pool.query(
        `INSERT INTO system_backups (filename, size_bytes, tables, trigger, status, notes, created_by)
         VALUES ($1,0,'{}',$2,'ERROR',$3,$4)`,
        [`failed_${stamp()}.json`, 'MANUAL', e.message, req.user.username]
      );
    } catch(_) {}
    res.status(500).json({ error: mapDbError(e) });
  }
});

router.get('/system/backups', requireSuperAdmin, async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT id, filename, size_bytes, tables, trigger, status, notes, created_by, created_at,
             EXTRACT(EPOCH FROM (NOW() - created_at))/3600 AS age_hours
      FROM system_backups ORDER BY created_at DESC
    `);
    res.json(r.rows.map(b => ({
      ...b,
      size_bytes: parseInt(b.size_bytes) || 0,
      age_hours: parseFloat(b.age_hours) || 0,
    })));
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

// POST /system/backups/upload — carga un backup externo (JSON) y lo registra.
// Usa express.text() en esta ruta para aceptar el cuerpo sin importar Content-Type.
router.post(
  '/system/backups/upload',
  requireSuperAdmin,
  express.text({ type: '*/*', limit: '100mb' }),
  async (req, res) => {
    try {
      let data;
      try { data = JSON.parse(req.body); }
      catch { return res.status(400).json({ error: 'El archivo no es JSON válido.' }); }

      if (!data.tables || typeof data.tables !== 'object') {
        return res.status(400).json({ error: 'Formato inválido: falta el campo "tables".' });
      }

      const filename = `wms_backup_upload_${stamp()}.json`;
      const filepath = path.join(BACKUPS_DIR, filename);
      fs.writeFileSync(filepath, req.body);          // guarda el JSON original tal cual
      const sizeBytes = fs.statSync(filepath).size;

      const tableCounts = {};
      for (const [tbl, rows] of Object.entries(data.tables)) {
        tableCounts[tbl] = Array.isArray(rows) ? rows.length : 0;
      }

      const ins = await pool.query(
        `INSERT INTO system_backups (filename, size_bytes, tables, trigger, status, created_by)
         VALUES ($1,$2,$3,'UPLOAD','OK',$4) RETURNING *`,
        [filename, sizeBytes, JSON.stringify(tableCounts), req.user.username]
      );
      const row = ins.rows[0];
      console.log(`[BACKUP] Upload OK — ${filename} — ${(sizeBytes/1024/1024).toFixed(2)} MB`);
      res.json({
        id: row.id,
        filename: row.filename,
        size_bytes: sizeBytes,
        tables: tableCounts,
        created_at: row.created_at,
      });
    } catch (e) {
      console.error('[BACKUP] Upload ERROR:', e.message);
      res.status(500).json({ error: mapDbError(e) });
    }
  }
);

router.get('/system/backups/:id/download', requireSuperAdmin, async (req, res) => {
  try {
    const r = await pool.query(`SELECT filename FROM system_backups WHERE id=$1`, [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Backup no encontrado' });
    const filepath = path.join(BACKUPS_DIR, r.rows[0].filename);
    if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'Archivo físico no existe' });
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${r.rows[0].filename}"`);
    fs.createReadStream(filepath).pipe(res);
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

router.post('/system/backups/:id/restore', requireSuperAdmin, async (req, res) => {
  const t0 = Date.now();
  try {
    const meta = await pool.query(`SELECT * FROM system_backups WHERE id=$1`, [req.params.id]);
    if (!meta.rows.length) return res.status(404).json({ error: 'Backup no encontrado' });
    const target = meta.rows[0];
    const filepath = path.join(BACKUPS_DIR, target.filename);
    if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'Archivo físico no existe' });

    // 1. Backup automático de seguridad ANTES de restaurar
    await ejecutarBackup('PRE_RESTORE', req.user.username);

    // 2. Marcar el target como RESTORING
    await pool.query(`UPDATE system_backups SET status='RESTORING' WHERE id=$1`, [req.params.id]);

    // 3. Leer y aplicar en transacción
    const data = JSON.parse(fs.readFileSync(filepath, 'utf8'));
    const tables = data.tables || {};
    const restoredTables = [];
    let rowsInserted = 0;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Orden inverso para TRUNCATE (respetar FKs). CASCADE para limpiar dependencias.
      for (let i = BACKUP_TABLES.length - 1; i >= 0; i--) {
        const tbl = BACKUP_TABLES[i];
        if (!(await tableExists(client, tbl))) continue;
        await client.query(`TRUNCATE TABLE ${tbl} CASCADE`);
      }
      // Reinsertar en orden directo.
      for (const tbl of BACKUP_TABLES) {
        if (!(await tableExists(client, tbl))) continue;
        const rows = tables[tbl] || [];
        if (!rows.length) { restoredTables.push(tbl); continue; }
        const cols = Object.keys(rows[0]);
        const colList = cols.map(c => `"${c}"`).join(',');
        for (const row of rows) {
          const placeholders = cols.map((_, i) => `$${i+1}`).join(',');
          const values = cols.map(c => row[c]);
          await client.query(`INSERT INTO ${tbl} (${colList}) VALUES (${placeholders})`, values);
          rowsInserted++;
        }
        restoredTables.push(tbl);
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      await pool.query(`UPDATE system_backups SET status='OK' WHERE id=$1`, [req.params.id]);
      throw e;
    } finally { client.release(); }

    await pool.query(`UPDATE system_backups SET status='OK' WHERE id=$1`, [req.params.id]);
    res.json({ restored_tables: restoredTables, rows_inserted: rowsInserted, duration_ms: Date.now() - t0 });
  } catch (e) {
    console.error('[RESTORE] ERROR:', e.message);
    res.status(500).json({ error: e.message });
  }
});

router.delete('/system/backups/:id', requireSuperAdmin, async (req, res) => {
  try {
    const latest = await pool.query(`SELECT id FROM system_backups ORDER BY created_at DESC LIMIT 1`);
    if (latest.rows[0]?.id === parseInt(req.params.id)) {
      return res.status(400).json({ error: 'No se puede eliminar el backup más reciente.' });
    }
    const row = await pool.query(`SELECT filename FROM system_backups WHERE id=$1`, [req.params.id]);
    if (!row.rows.length) return res.status(404).json({ error: 'Backup no encontrado' });
    try { fs.unlinkSync(path.join(BACKUPS_DIR, row.rows[0].filename)); } catch(_) {}
    await pool.query(`DELETE FROM system_backups WHERE id=$1`, [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

// Cron 03:00 diario. Se inicializa una sola vez al cargar el router.
let cronStarted = false;
function startCron() {
  if (cronStarted) return;
  cronStarted = true;
  // Comprueba cada minuto si llegó la hora programada (sin dep externa).
  setInterval(async () => {
    const now = new Date();
    if (now.getHours() === 3 && now.getMinutes() === 0) {
      try {
        await ejecutarBackup('SCHEDULED', 'system');
        await purgarBackupsViejos();
      } catch (e) { console.error('[BACKUP][CRON] ERROR:', e.message); }
    }
  }, 60 * 1000);
  console.log('[BACKUP] Cron diario activo — disparará a las 03:00');
}
startCron();

module.exports = router;
module.exports.ejecutarBackup = ejecutarBackup;
module.exports.purgarBackupsViejos = purgarBackupsViejos;
