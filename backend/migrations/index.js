// Runner de migraciones versionadas.
//
// Cada migración es `{ id: string, run: async (pool) => void }`. Las migraciones
// se aplican en orden y se registran en la tabla `schema_migrations`. Una
// migración nunca se ejecuta dos veces.
//
// Para añadir una migración nueva:
//   1. Crear `migrations/00N_nombre.js` que exporte `{ id, run }`.
//   2. Añadirlo al array en `migrations/list.js`.
//
// Las migraciones deben ser idempotentes cuando sea posible (usar
// `CREATE TABLE IF NOT EXISTS`, `ON CONFLICT DO NOTHING`, etc.) porque si se
// interrumpen a mitad de camino, la próxima ejecución las reintentará.

async function runMigrations(pool, migrations) {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id VARCHAR(100) PRIMARY KEY,
    applied_at TIMESTAMP DEFAULT NOW()
  )`);

  const applied = await pool.query('SELECT id FROM schema_migrations');
  const appliedSet = new Set(applied.rows.map(r => r.id));

  for (const m of migrations) {
    if (appliedSet.has(m.id)) {
      console.log(`[migrations] ${m.id} ya aplicada, saltando`);
      continue;
    }
    console.log(`[migrations] aplicando ${m.id}...`);
    const t0 = Date.now();
    await m.run(pool);
    await pool.query('INSERT INTO schema_migrations (id) VALUES ($1) ON CONFLICT DO NOTHING', [m.id]);
    console.log(`[migrations] ${m.id} completada en ${Date.now() - t0}ms`);
  }
}

module.exports = { runMigrations };
