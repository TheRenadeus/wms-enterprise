// Tabla de respaldos del sistema.
// Cada fila corresponde a un snapshot JSON del estado completo de las tablas críticas.

module.exports = {
  id: '004_system_backups',
  run: async (pool) => {
    const log = (m) => console.log('[migr-004]', m);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS system_backups (
        id          SERIAL PRIMARY KEY,
        filename    TEXT NOT NULL,
        size_bytes  BIGINT,
        tables      JSONB,
        trigger     TEXT,
        status      TEXT,
        notes       TEXT,
        created_by  TEXT,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_backups_created ON system_backups (created_at DESC)`);
    log('system_backups creada');
  }
};
