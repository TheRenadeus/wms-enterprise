// Columnas de capacidad de locations_master (tipo, kg y pallets máximos) que usan routes/locations.js y la
// carga masiva de ubicaciones. Antes se agregaban al cargar server.js, antes de correr las migraciones: en una
// base nueva la tabla aún no existía, el ALTER fallaba en silencio y las columnas recién aparecían al reiniciar.
// Idempotente (ADD COLUMN IF NOT EXISTS).
module.exports = {
  id: '034_locations_capacidad',
  async run(pool) {
    await pool.query(`ALTER TABLE locations_master ADD COLUMN IF NOT EXISTS loc_type VARCHAR(20) DEFAULT 'PALLET'`);
    await pool.query(`ALTER TABLE locations_master ADD COLUMN IF NOT EXISTS max_kg NUMERIC DEFAULT 0`);
    await pool.query(`ALTER TABLE locations_master ADD COLUMN IF NOT EXISTS max_pallets INTEGER DEFAULT 0`);
    console.log('[migr-034] columnas de capacidad de locations_master OK');
  },
};
