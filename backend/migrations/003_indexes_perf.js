// Índices de performance + limpieza de duplicados.
//
// inventory_lpns y audit_log: ya tenían varios índices; aquí se cubre el faltante
// (compuesto created_at,type,sku) y se eliminan duplicados que solo agregan costo
// de escritura sin beneficio (existían dos índices idénticos sobre las mismas cols).
// notifications: solo tenía PK. Se agregan los índices que cubren las queries
// del badge "no leídas por cliente" y el listado ordenado por fecha.

module.exports = {
  id: '003_indexes_perf',
  run: async (pool) => {
    const log = (msg) => console.log('[migr-003]', msg);

    // ── inventory_lpns ────────────────────────────────────────────────────
    // (sku,client_id) y (location_id) ya existen. Solo limpio duplicado.
    await pool.query(`DROP INDEX IF EXISTS idx_inv_client`);
    log('drop idx_inv_client (duplicado de idx_inventory_client_id parcial)');

    // ── audit_log ─────────────────────────────────────────────────────────
    // Compuesto para queries con rango de fecha + filtros por tipo/sku.
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_audit_created_type_sku
        ON audit_log (created_at DESC, type, sku)
    `);
    log('idx_audit_created_type_sku creado');

    // idx_audit_created e idx_audit_created_at son idénticos; preservo el _at.
    await pool.query(`DROP INDEX IF EXISTS idx_audit_created`);
    log('drop idx_audit_created (duplicado de idx_audit_created_at)');

    // ── notifications ─────────────────────────────────────────────────────
    // Compuesto pedido (type, sku, read, client_id) — útil cuando se filtra por type.
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_notif_type_sku_read_client
        ON notifications (type, sku, read, client_id)
    `);

    // Cubre el caso real más frecuente: badge de no leídas por cliente.
    // Parcial (WHERE read=false) → mucho más chico y rápido.
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_notif_client_unread
        ON notifications (client_id, read, created_at DESC)
        WHERE read = false
    `);

    // Listado general ordenado por fecha (paginación reciente).
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_notif_created
        ON notifications (created_at DESC)
    `);
    log('3 índices notifications creados');
  },
};
