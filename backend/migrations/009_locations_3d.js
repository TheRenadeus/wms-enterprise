// Columnas 3D para locations_master: aisle/row_num/level + coords absolutas + dimensiones.
// La tabla del proyecto se llama locations_master (no "locations").

module.exports = {
  id: '009_locations_3d',
  run: async (pool) => {
    const log = (m) => console.log('[migr-009]', m);

    await pool.query(`
      ALTER TABLE locations_master
        ADD COLUMN IF NOT EXISTS aisle     TEXT,
        ADD COLUMN IF NOT EXISTS row_num   INTEGER,
        ADD COLUMN IF NOT EXISTS level     INTEGER,
        ADD COLUMN IF NOT EXISTS x         NUMERIC(8,2),
        ADD COLUMN IF NOT EXISTS y         NUMERIC(8,2),
        ADD COLUMN IF NOT EXISTS z         NUMERIC(8,2),
        ADD COLUMN IF NOT EXISTS width     NUMERIC(8,2) DEFAULT 1.0,
        ADD COLUMN IF NOT EXISTS depth     NUMERIC(8,2) DEFAULT 1.0,
        ADD COLUMN IF NOT EXISTS height    NUMERIC(8,2) DEFAULT 1.0,
        ADD COLUMN IF NOT EXISTS color_hex TEXT,
        ADD COLUMN IF NOT EXISTS active    BOOLEAN NOT NULL DEFAULT TRUE
    `);

    // Índice por (aisle, row_num, level) para queries del gemelo 3D.
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_locations_3d_pos
        ON locations_master (aisle, row_num, level)
        WHERE aisle IS NOT NULL
    `);

    log('columnas 3D OK');
  }
};
