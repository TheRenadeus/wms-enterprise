// Reinicio manual de la instancia de demostración (ver demo-instance.js y docs/demo.md).
//   node demo-reset.js                    → vista previa, no cambia nada
//   node demo-reset.js --yes              → vacía la base demo y recarga los datos ficticios
//   node demo-reset.js --yes --primera-carga
//                                         → igual, en una base que aún no tiene la marca
//                                           de demo. BORRA TODO: solo en una base dedicada.
require('dotenv').config();
const { pool } = require('./db');
const { runMigrations } = require('./migrations');
const migrationList = require('./migrations/list');
const { resetDemo, DEMO_USERS } = require('./demo-instance');

const has = (f) => process.argv.includes(f);

async function main() {
  if (!has('--yes')) {
    console.log('Vista previa: este comando vacía la base de demostración y carga datos ficticios.');
    console.log(`Usuarios que se crean: ${DEMO_USERS.map((u) => u.username).join(', ')}`);
    console.log('Para ejecutarlo: node demo-reset.js --yes');
    return;
  }
  await runMigrations(pool, migrationList);
  await resetDemo(pool, { force: has('--primera-carga') });
  console.log('✅ Demo reiniciada con datos ficticios.');
}

main()
  .catch((e) => { console.error('❌', e.message); process.exitCode = 1; })
  .finally(async () => {
    await pool.end().catch(() => {});
    process.exit(process.exitCode || 0);
  });
