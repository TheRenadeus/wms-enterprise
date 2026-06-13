// Sustitutos de SKU por similitud + manuales.
// pg_trgm ya está creado en la migración 006.

module.exports = {
  id: '008_sku_substitutes',
  run: async (pool) => {
    const log = (m) => console.log('[migr-008]', m);

    // Índice trigram sobre desc para búsqueda por similitud.
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_skus_desc_trgm
        ON master_skus USING GIN ("desc" gin_trgm_ops)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_lpns_sku_qty
        ON inventory_lpns(sku) WHERE qty > 0
    `);

    await pool.query(`
      ALTER TABLE master_skus
        ADD COLUMN IF NOT EXISTS allow_substitutes    BOOLEAN      NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS substitute_scope     TEXT         NOT NULL DEFAULT 'any',
        ADD COLUMN IF NOT EXISTS substitute_threshold NUMERIC(3,2) DEFAULT NULL
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS sku_substitutes (
        id           SERIAL PRIMARY KEY,
        sku_original TEXT NOT NULL,
        sku_subst    TEXT NOT NULL,
        priority     INTEGER DEFAULT 1,
        notes        TEXT,
        confirmed_by TEXT,
        confirmed_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(sku_original, sku_subst)
      )
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_subst_original
        ON sku_substitutes(sku_original)
    `);

    // Parámetros globales en system_config
    const cfg = [
      ['substitute_similarity_threshold',  '0.35'],
      ['substitute_max_results',           '10'],
      ['substitute_cross_client',          'false'],
      ['substitute_require_same_uom',      'true'],
      ['substitute_require_same_category', 'false'],
    ];
    for (const [k, v] of cfg) {
      await pool.query(
        `INSERT INTO system_config (key, value, updated_by) VALUES ($1, $2, 'SYSTEM')
         ON CONFLICT (key) DO NOTHING`,
        [k, v]
      );
    }
    log('sku_substitutes + config OK');
  }
};
