// Módulo INSUMOS (materiales propios de la bodega: cajas, cinta, etiquetas,
// pallets, film, EPP). Independiente del inventario de productos de clientes.
//
// - insumos: maestro de materiales (codigo único global, borrado lógico).
// - insumo_stock: stock actual por insumo (1 fila por insumo). El stock se
//   modifica siempre dentro de transacción con SELECT ... FOR UPDATE para evitar
//   negativos en concurrencia (ver routes/insumos.js, Fase 2).
module.exports = {
  id: '019_insumos',
  async run(pool) {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS insumos (
        id             SERIAL PRIMARY KEY,
        codigo         VARCHAR(60)  NOT NULL,
        nombre         VARCHAR(200) NOT NULL,
        categoria      VARCHAR(20)  NOT NULL DEFAULT 'otros'
                       CHECK (categoria IN ('embalaje','etiquetado','pallets','epp','otros')),
        unidad         VARCHAR(20)  NOT NULL DEFAULT 'UN',
        costo_unitario NUMERIC(14,2) NOT NULL DEFAULT 0,
        stock_minimo   NUMERIC(14,3) NOT NULL DEFAULT 0,
        activo         BOOLEAN      NOT NULL DEFAULT TRUE,
        created_by     VARCHAR(100),
        created_at     TIMESTAMP    DEFAULT NOW()
      )
    `);
    // Código único GLOBAL (los insumos son de la bodega, no por cliente).
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_insumos_codigo ON insumos (UPPER(codigo))`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS insumo_stock (
        insumo_id   INTEGER PRIMARY KEY REFERENCES insumos(id) ON DELETE CASCADE,
        cantidad    NUMERIC(14,3) NOT NULL DEFAULT 0,
        updated_at  TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('[migr-019] tablas insumos + insumo_stock creadas');
  },
};
