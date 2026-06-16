// Insumos (Fase 2): bitácora de movimientos de stock.
// Registra entrada (+), consumo (-) y ajuste (recuento). stock_antes/stock_despues
// se calculan DENTRO de la transacción (SELECT ... FOR UPDATE) para ser exactos
// bajo concurrencia. documento_*/client_id se usan en la Fase 4 (consumo ligado a
// despacho/recepción).
module.exports = {
  id: '020_insumo_movimientos',
  async run(pool) {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS insumo_movimientos (
        id             SERIAL PRIMARY KEY,
        insumo_id      INTEGER NOT NULL REFERENCES insumos(id),
        tipo           VARCHAR(12) NOT NULL CHECK (tipo IN ('entrada','consumo','ajuste')),
        cantidad       NUMERIC(14,3) NOT NULL,
        stock_antes    NUMERIC(14,3) NOT NULL,
        stock_despues  NUMERIC(14,3) NOT NULL,
        documento_tipo VARCHAR(20),
        documento_id   VARCHAR(80),
        client_id      VARCHAR(100),
        usuario        VARCHAR(100),
        fecha          TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_insumo_mov_insumo ON insumo_movimientos (insumo_id, fecha DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_insumo_mov_doc ON insumo_movimientos (documento_tipo, documento_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_insumo_mov_client ON insumo_movimientos (client_id)`);
    console.log('[migr-020] tabla insumo_movimientos creada');
  },
};
