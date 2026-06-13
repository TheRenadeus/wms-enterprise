// Tabla de fabricantes + extensión columnas en master_skus.
// Crea pg_trgm para búsquedas por similitud (también usado por M3 sustitutos).

module.exports = {
  id: '006_manufacturers',
  run: async (pool) => {
    const log = (m) => console.log('[migr-006]', m);

    await pool.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
    log('extensión pg_trgm OK');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS manufacturers (
        id          SERIAL PRIMARY KEY,
        code        TEXT UNIQUE NOT NULL,
        name        TEXT NOT NULL,
        country     TEXT,
        contact     TEXT,
        email       TEXT,
        phone       TEXT,
        website     TEXT,
        notes       TEXT,
        active      BOOLEAN NOT NULL DEFAULT TRUE,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_manufacturers_name
        ON manufacturers USING GIN (name gin_trgm_ops)
    `);
    log('tabla manufacturers OK');

    await pool.query(`
      ALTER TABLE master_skus
        ADD COLUMN IF NOT EXISTS manufacturer_id   INTEGER REFERENCES manufacturers(id),
        ADD COLUMN IF NOT EXISTS manufacturer_code TEXT,
        ADD COLUMN IF NOT EXISTS manufacturer_sku  TEXT,
        ADD COLUMN IF NOT EXISTS brand             TEXT
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_skus_manufacturer
        ON master_skus(manufacturer_id)
        WHERE manufacturer_id IS NOT NULL
    `);
    log('columnas master_skus.manufacturer_* OK');

    // Seed
    const seedRes = await pool.query(`
      INSERT INTO manufacturers (code, name, country) VALUES
        ('FAB-001', 'Embalajes del Sur S.A.',    'Chile'),
        ('FAB-002', 'Embalajes Norte Ltda.',     'Chile'),
        ('FAB-003', 'PackCorp International',    'Brasil'),
        ('FAB-004', 'Fábrica Central Cartones',  'Chile'),
        ('FAB-005', 'Global Pack S.A.',          'Argentina')
      ON CONFLICT (code) DO NOTHING
      RETURNING id
    `);
    log(`seed insertados: ${seedRes.rowCount}`);
  }
};
