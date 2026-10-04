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
const { randomUUID } = require('crypto');
const { pool, mapDbError, userError } = require('../db');
const { requireSuperAdmin } = require('../middleware');

const router = express.Router();

// Se respaldan TODAS las tablas del esquema, salvo el registro de migraciones (lo
// gestiona el arranque) y el propio catálogo de respaldos. Respaldar solo una lista
// fija dejaba fuera tablas que el restore igual vaciaba o dejaba desalineadas.
const EXCLUDED_TABLES = new Set(['schema_migrations', 'system_backups']);
const BACKUP_FORMAT_VERSION = 2;

const badBackup = (message) => Object.assign(new Error(message), { status: 400 });

async function tablasDelEsquema(db) {
  const r = await db.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`);
  return r.rows.map((x) => x.tablename).filter((t) => !EXCLUDED_TABLES.has(t));
}

// Orden de carga: primero las tablas referenciadas por claves foráneas.
async function ordenPorDependencias(db, tablas) {
  const r = await db.query(`
    SELECT DISTINCT tc.relname AS hija, tp.relname AS madre
      FROM pg_constraint c
      JOIN pg_class tc ON tc.oid = c.conrelid
      JOIN pg_class tp ON tp.oid = c.confrelid
      JOIN pg_namespace n ON n.oid = tc.relnamespace
     WHERE c.contype = 'f' AND n.nspname = 'public' AND tc.relname <> tp.relname`);
  const deps = new Map(tablas.map((t) => [t, new Set()]));
  for (const { hija, madre } of r.rows) if (deps.has(hija) && deps.has(madre)) deps.get(hija).add(madre);
  const orden = [];
  const hecho = new Set();
  const enCurso = new Set();
  const visitar = (t) => {
    if (hecho.has(t) || enCurso.has(t)) return; // un ciclo se deja en el orden en que venga
    enCurso.add(t);
    for (const m of deps.get(t)) visitar(m);
    enCurso.delete(t);
    hecho.add(t);
    orden.push(t);
  };
  tablas.forEach(visitar);
  return orden;
}

// Un respaldo se puede restaurar solo si es del formato completo, trae listas por
// tabla y deja al menos un administrador activo (si no, el sistema queda sin acceso).
function validarRespaldo(payload) {
  if (!payload || typeof payload !== 'object' || !payload.tables || typeof payload.tables !== 'object' || Array.isArray(payload.tables)) {
    throw badBackup('Formato inválido: falta el campo "tables".');
  }
  if (!(Number(payload.version) >= BACKUP_FORMAT_VERSION)) {
    throw badBackup('Respaldo de formato antiguo (incompleto): restaure uno generado por esta versión o use los respaldos de la base de datos (pg_dump).');
  }
  for (const [t, rows] of Object.entries(payload.tables)) {
    if (!Array.isArray(rows)) throw badBackup(`La tabla "${t}" del respaldo no es una lista.`);
  }
  const users = payload.tables.users || [];
  if (!users.some((u) => ['ADMIN', 'SUPERADMIN'].includes(u?.role) && (u?.status || 'ACTIVE') !== 'SUSPENDED')) {
    throw badBackup('El respaldo no tiene ningún administrador activo: restaurarlo dejaría el sistema sin acceso.');
  }
}

const BACKUPS_DIR = process.env.BACKUPS_DIR ? path.resolve(process.env.BACKUPS_DIR) : path.resolve(__dirname, '..', 'backups');
if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true });

const tableExists = async (db, name) => {
  const r = await db.query(`SELECT to_regclass($1) AS t`, [`public.${name}`]);
  return !!r.rows[0].t;
};

const stamp = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
};
// Nombre único por respaldo: dos respaldos en el mismo minuto (p. ej. el de
// seguridad previo a un restore) no pueden pisar el archivo de otro.
const uniqueName = (prefix) => `${prefix}_${stamp()}_${randomUUID().slice(0, 8)}.json`;

// Ejecuta un snapshot. Devuelve la fila insertada en system_backups.
async function ejecutarBackup(trigger, createdBy) {
  const filename = uniqueName('wms_backup');
  const filepath = path.join(BACKUPS_DIR, filename);
  const dump = {};
  const tableCounts = {};
  const t0 = Date.now();

  // Todas las tablas leídas en una sola transacción de solo lectura: el respaldo
  // es una foto consistente aunque el sistema siga operando.
  const db = await pool.connect();
  try {
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    for (const tbl of await tablasDelEsquema(db)) {
      const r = await db.query(`SELECT * FROM "${tbl}"`);
      dump[tbl] = r.rows;
      tableCounts[tbl] = r.rows.length;
    }
    await db.query('COMMIT');
  } catch (e) {
    await db.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { db.release(); }
  const payload = JSON.stringify({ version: BACKUP_FORMAT_VERSION, generated_at: new Date().toISOString(), tables: dump });
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

      try { validarRespaldo(data); }
      catch (e) { return res.status(400).json({ error: e.message }); }

      const filename = uniqueName('wms_backup_upload');
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

// Aplica un restore sobre un cliente de BD ya en transacción. Reutilizado por el
// endpoint, la recuperación automática del arranque y recover.js.
// `payload` es el JSON completo del respaldo ({ version, tables }).
//  - Se vacían todas las tablas del esquema de una vez, sin CASCADE (si una clave
//    foránea alcanzara una tabla fuera del conjunto, el TRUNCATE falla y no se
//    pierde nada). Una tabla que no estaba en el respaldo queda vacía, como estaba
//    entonces.
//  - Se cargan en orden de dependencias y se reajustan las secuencias al final.
async function aplicarRestore(client, payload) {
  validarRespaldo(payload);
  const tables = payload.tables;
  const vivas = await tablasDelEsquema(client);
  const restoredTables = [];
  let rowsInserted = 0;
  await client.query(`TRUNCATE TABLE ${vivas.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY`);
  for (const tbl of await ordenPorDependencias(client, vivas)) {
    const rows = tables[tbl] || [];
    restoredTables.push(tbl);
    if (!rows.length) continue;
    // Resiliencia ante drift de schema: insertar SOLO las columnas que existen hoy
    // en la tabla. Columnas eliminadas en el backup se ignoran; columnas nuevas
    // del schema actual toman su DEFAULT.
    const colRes = await client.query(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`,
      [tbl]
    );
    const liveCols = new Set(colRes.rows.map(r => r.column_name));
    // Las columnas json/jsonb se envían como texto JSON: un arreglo de JS pasado tal
    // cual se convertiría en un arreglo de PostgreSQL y el INSERT fallaría.
    const jsonCols = new Set(colRes.rows.filter(r => r.data_type === 'json' || r.data_type === 'jsonb').map(r => r.column_name));
    const valor = (row, c) => (jsonCols.has(c) && row[c] !== null && row[c] !== undefined ? JSON.stringify(row[c]) : row[c]);
    const cols = Object.keys(rows[0]).filter(c => liveCols.has(c));
    if (!cols.length) continue;
    const colList = cols.map(c => `"${c}"`).join(',');
    // Por tramos: una sola sentencia por bloque, dentro del límite de parámetros.
    const porTramo = Math.max(1, Math.floor(60000 / cols.length));
    for (let i = 0; i < rows.length; i += porTramo) {
      const tramo = rows.slice(i, i + porTramo);
      const values = tramo.map((_, r) => `(${cols.map((__, c) => `$${r * cols.length + c + 1}`).join(',')})`).join(',');
      await client.query(`INSERT INTO "${tbl}" (${colList}) VALUES ${values}`, tramo.flatMap(row => cols.map(c => valor(row, c))));
      rowsInserted += tramo.length;
    }
  }
  await reajustarSecuencias(client, vivas);
  return { restoredTables, rowsInserted };
}

// Tras recargar filas con su id explícito, cada secuencia queda en el máximo
// usado; si no, el siguiente INSERT chocaría con un id existente.
async function reajustarSecuencias(client, tablas) {
  const r = await client.query(`
    SELECT table_name, column_name, pg_get_serial_sequence(format('%I', table_name), column_name) AS seq
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = ANY($1)
       AND (column_default LIKE 'nextval(%' OR is_identity = 'YES')`, [tablas]);
  for (const { table_name: t, column_name: c, seq } of r.rows) {
    if (!seq) continue;
    await client.query(`SELECT setval($1, COALESCE((SELECT MAX("${c}") FROM "${t}"), 1), (SELECT MAX("${c}") FROM "${t}") IS NOT NULL)`, [seq]);
  }
}

router.post('/system/backups/:id/restore', requireSuperAdmin, async (req, res) => {
  const t0 = Date.now();
  try {
    const meta = await pool.query(`SELECT * FROM system_backups WHERE id=$1`, [req.params.id]);
    if (!meta.rows.length) return res.status(404).json({ error: 'Backup no encontrado' });
    const target = meta.rows[0];
    const filepath = path.join(BACKUPS_DIR, target.filename);
    if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'Archivo físico no existe' });

    // 1. Leer y validar el respaldo; luego uno de seguridad ANTES de restaurar.
    let data;
    try { data = JSON.parse(fs.readFileSync(filepath, 'utf8')); validarRespaldo(data); }
    catch (e) { return res.status(400).json({ error: e.status ? e.message : 'El archivo del respaldo no es JSON válido.' }); }
    await ejecutarBackup('PRE_RESTORE', req.user.username);

    // 2. Marcar el target como RESTORING
    await pool.query(`UPDATE system_backups SET status='RESTORING' WHERE id=$1`, [req.params.id]);

    // 3. Aplicar en transacción
    let restoredTables = [];
    let rowsInserted = 0;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      ({ restoredTables, rowsInserted } = await aplicarRestore(client, data));
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
    res.status(e.status || 500).json({ error: userError(e) });
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
module.exports.aplicarRestore = aplicarRestore;
module.exports.tableExists = tableExists;
module.exports.validarRespaldo = validarRespaldo;
module.exports.BACKUPS_DIR = BACKUPS_DIR;
