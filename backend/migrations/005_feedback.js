// Tabla de sugerencias / mejoras enviadas por usuarios admin/operativos.
// Cada fila es un comentario del staff sobre el sistema.

module.exports = {
  id: '005_feedback',
  run: async (pool) => {
    const log = (m) => console.log('[migr-005]', m);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS feedback (
        id          SERIAL PRIMARY KEY,
        username    VARCHAR(50),
        role        VARCHAR(50),
        category    VARCHAR(30) DEFAULT 'MEJORA',
        message     TEXT NOT NULL,
        page        TEXT,
        status      VARCHAR(20) DEFAULT 'NUEVO',
        created_at  TIMESTAMPTZ DEFAULT NOW(),
        resolved_at TIMESTAMPTZ,
        resolved_by VARCHAR(50)
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback (created_at DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback (status)`);
    log('feedback creada');
  }
};
