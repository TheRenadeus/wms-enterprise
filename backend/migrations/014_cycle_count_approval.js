module.exports = {
  id: '014_cycle_count_approval',
  async run(pool) {
    await pool.query(`
      ALTER TABLE cycle_counts
        ADD COLUMN IF NOT EXISTS scope_label   TEXT,
        ADD COLUMN IF NOT EXISTS client_filter VARCHAR(50),
        ADD COLUMN IF NOT EXISTS sku_filter    VARCHAR(100),
        ADD COLUMN IF NOT EXISTS approved_by   VARCHAR(50),
        ADD COLUMN IF NOT EXISTS approved_at   TIMESTAMP,
        ADD COLUMN IF NOT EXISTS rejected_by   VARCHAR(50),
        ADD COLUMN IF NOT EXISTS rejected_at   TIMESTAMP
    `);
    await pool.query(`
      ALTER TABLE cycle_count_lines
        ADD COLUMN IF NOT EXISTS note      TEXT,
        ADD COLUMN IF NOT EXISTS line_type VARCHAR(20) DEFAULT 'NORMAL'
    `);
    await pool.query(`DROP INDEX IF EXISTS idx_cycle_counts_zone_active`);
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_cycle_counts_zone_active
        ON cycle_counts(zone_code)
        WHERE status IN ('PENDING','EN_PROCESO','PENDIENTE_APROBACION')
    `);
  },
};
