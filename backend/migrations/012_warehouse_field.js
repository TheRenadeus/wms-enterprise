// Agrega columna warehouse a locations_master.
// warehouse = bodega física (número/texto, p.ej. "1", "2").
// zone_code se reutiliza como glosa (etiqueta descriptiva) de la bodega.

module.exports = {
  id: '012_warehouse_field',
  run: async (pool) => {
    await pool.query(`
      ALTER TABLE locations_master
        ADD COLUMN IF NOT EXISTS warehouse TEXT
    `);
    console.log('[migr-012] columna warehouse en locations_master OK');
  }
};
