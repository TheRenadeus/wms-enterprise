// PASO 4 — Defensa en profundidad: FK de inventory_lpns hacia master_skus.
//
// ⚠️ NO REGISTRADA en migrations/list.js a propósito. La relación correcta es
// COMPUESTA (sku, client_id) porque la PK de master_skus es (sku, client_id).
//
// RIESGO conocido (por eso no se aplica sin tu OK): hay rutas que insertan stock
// con fallback a client_id='GENERAL' cuando el SKU no está en el maestro
// (returns.js, cycle-count.js) y kits.js inserta el kit_sku, que puede no existir
// en master_skus. Con esta FK estricta, esos inserts fallarían en runtime.
//
// Recomendación: aplicarla SOLO después de endurecer esas rutas (validar que el
// SKU exista antes de insertar). El bug de carga masiva ya queda cubierto por la
// validación de aplicación (validateStockRows). Para activarla: añadir este
// archivo a migrations/list.js y reiniciar.
module.exports = {
  id: '017_inventory_sku_fk',
  async run(pool) {
    // Aborta si hay huérfanos (no debería tras la validación de app).
    const orphans = await pool.query(`
      SELECT COUNT(*)::int AS n FROM inventory_lpns i
      LEFT JOIN master_skus s ON s.sku = i.sku AND s.client_id = i.client_id
      WHERE s.sku IS NULL
    `);
    if (orphans.rows[0].n > 0) {
      throw new Error(`No se puede agregar la FK: hay ${orphans.rows[0].n} filas huérfanas en inventory_lpns. Revisar/limpiar antes.`);
    }
    await pool.query(`
      ALTER TABLE inventory_lpns
        ADD CONSTRAINT fk_inventory_sku
        FOREIGN KEY (sku, client_id) REFERENCES master_skus (sku, client_id)
    `);
    console.log('[migr-017] FK fk_inventory_sku (sku, client_id) → master_skus OK');
  },
};
