// Borrado lógico de SKU (PASO 6 del refactor RBAC).
// master_skus.deleted_at: NULL = activo; con fecha = eliminado lógicamente.
// El borrado físico irreversible queda solo para SUPERADMIN (system/inventory/:id).
module.exports = {
  id: '016_sku_soft_delete',
  async run(pool) {
    await pool.query(`ALTER TABLE master_skus ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP`);
    // Índice parcial para acelerar los listados de SKUs activos.
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_master_skus_active ON master_skus (sku) WHERE deleted_at IS NULL`);
    console.log('[migr-016] master_skus.deleted_at + índice activos OK');
  },
};
