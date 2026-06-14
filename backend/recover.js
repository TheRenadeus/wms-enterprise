#!/usr/bin/env node
/**
 * Recuperación ante fallo total — herramienta STANDALONE.
 *
 * A diferencia del restore por la UI (que necesita la app corriendo, login de
 * SUPERADMIN y la tabla system_backups intacta), este script restaura directamente
 * desde un archivo de backup JSON en disco, conectándose a Postgres con las
 * credenciales del .env. Sirve cuando la BD está vacía/corrupta o la app no arranca.
 *
 * Si la BD está vacía, primero crea el schema (corre las migraciones) y luego
 * carga los datos del último backup bueno.
 *
 * USO:
 *   node recover.js                      Vista previa del backup más reciente (no toca nada)
 *   node recover.js --list               Lista los backups disponibles
 *   node recover.js --yes                Restaura el backup más reciente (DESTRUCTIVO)
 *   node recover.js <archivo.json> --yes Restaura un backup específico
 *   node recover.js --yes --no-migrate   Restaura sin recrear el schema
 *
 * El flag --yes es OBLIGATORIO para ejecutar (el restore hace TRUNCATE de las tablas).
 */
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const { pool } = require('./db');
const { runMigrations } = require('./migrations');
const migrationList = require('./migrations/list');
const { aplicarRestore, BACKUP_TABLES, BACKUPS_DIR } = require('./routes/backups');

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const fileArg = args.find(a => !a.startsWith('--'));

const log = (...m) => console.log(...m);
const fail = (msg) => { console.error('❌ ' + msg); process.exitCode = 1; };

// Lista los backups (wms_backup_*.json) ordenados por fecha de modificación desc.
function listarBackups() {
  if (!fs.existsSync(BACKUPS_DIR)) return [];
  return fs.readdirSync(BACKUPS_DIR)
    .filter(f => /^wms_backup_.*\.json$/.test(f))
    .map(f => ({ file: f, full: path.join(BACKUPS_DIR, f), mtime: fs.statSync(path.join(BACKUPS_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
}

function resolverArchivo() {
  if (fileArg) {
    const p = path.isAbsolute(fileArg) ? fileArg : path.join(BACKUPS_DIR, fileArg);
    if (!fs.existsSync(p)) { fail(`No existe el archivo: ${p}`); return null; }
    return p;
  }
  const all = listarBackups();
  if (!all.length) { fail(`No hay backups en ${BACKUPS_DIR}`); return null; }
  return all[0].full;
}

async function main() {
  // Modo --list
  if (has('--list')) {
    const all = listarBackups();
    if (!all.length) { log('(sin backups en ' + BACKUPS_DIR + ')'); return; }
    log(`Backups disponibles en ${BACKUPS_DIR}:\n`);
    all.forEach((b, i) => log(`  ${i === 0 ? '→' : ' '} ${b.file}   (${new Date(b.mtime).toISOString()})`));
    log(`\nEl más reciente (→) se usa por defecto.`);
    return;
  }

  const filepath = resolverArchivo();
  if (!filepath) return;

  // Cargar y validar el payload.
  let payload;
  try { payload = JSON.parse(fs.readFileSync(filepath, 'utf8')); }
  catch (e) { return fail(`No se pudo leer/parsear el backup: ${e.message}`); }
  const tables = payload.tables || {};
  const counts = BACKUP_TABLES.map(t => [t, Array.isArray(tables[t]) ? tables[t].length : 0]);
  const totalRows = counts.reduce((s, [, n]) => s + n, 0);

  log('────────────────────────────────────────────────────────');
  log(`  Backup:    ${path.basename(filepath)}`);
  log(`  Generado:  ${payload.generated_at || '(desconocido)'}`);
  log(`  Tablas:    ${counts.filter(([, n]) => n > 0).length} con datos · ${totalRows} filas en total`);
  log('────────────────────────────────────────────────────────');
  counts.filter(([, n]) => n > 0).forEach(([t, n]) => log(`    ${t.padEnd(22)} ${n}`));
  log('────────────────────────────────────────────────────────');

  if (!has('--yes')) {
    log('\n⚠️  VISTA PREVIA — no se modificó nada.');
    log('   Para restaurar de verdad (TRUNCATE + recarga de las tablas de arriba):');
    log(`     node recover.js ${fileArg ? path.basename(filepath) + ' ' : ''}--yes\n`);
    return;
  }

  // Ejecución real.
  try {
    await pool.query('SELECT 1');
  } catch (e) {
    return fail(`No hay conexión con la BD (${process.env.DB_HOST}:5432). ¿Postgres está arriba? — ${e.message}`);
  }

  if (!has('--no-migrate')) {
    log('\n▶ Asegurando el schema (migraciones)...');
    await runMigrations(pool, migrationList);
  }

  log('▶ Restaurando datos en una transacción (todo o nada)...');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { restoredTables, rowsInserted } = await aplicarRestore(client, tables);
    await client.query('COMMIT');
    log(`\n✅ Recuperación completa: ${rowsInserted} filas restauradas en ${restoredTables.length} tablas.`);
    log('   Reinicia la app (pm2 restart wms) y verifica el acceso.');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    fail(`Restore abortado y revertido (ROLLBACK): ${e.message}`);
  } finally {
    client.release();
  }
}

// Solo auto-ejecuta como CLI (`node recover.js`); seguro de require() desde otros módulos.
if (require.main === module) {
  main()
    .catch(e => fail(e.message))
    .finally(async () => {
      await pool.end().catch(() => {});
      // Salida explícita: requerir backups.js arranca el setInterval del cron, que
      // de otro modo mantendría vivo el proceso CLI indefinidamente.
      process.exit(process.exitCode || 0);
    });
}

module.exports = { listarBackups };
