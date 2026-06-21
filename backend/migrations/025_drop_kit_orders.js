// KITTING — consolidación Fase 2: elimina la tabla del sistema VIEJO de kitting.
//
// kit_orders pertenecía al router routes/kits.js (kit-build / direct-dispatch), ya
// retirado. El sistema vigente (routes/kitting.js) usa kit_orden / kit_stock /
// kit_componente_consumido. Los kits ya armados con el sistema viejo siguen como LPN
// reales en inventory_lpns y sus movimientos en audit_log; solo se descarta la tabla
// de metadatos de órdenes viejas. Cambio destructivo pero acotado a datos obsoletos.
module.exports = {
  id: '025_drop_kit_orders',
  async run(pool) {
    await pool.query(`DROP TABLE IF EXISTS kit_orders`);
    console.log('[migr-025] tabla kit_orders (kitting viejo) eliminada');
  },
};
