// Tabla de líneas de Órdenes de Compra (faltaba: el módulo routes/purchase-orders.js
// la referencia en listado, alta, /:id/lines y /:id/receive, pero ninguna migración
// la creaba → GET /api/purchase-orders y POST de líneas daban 42P01 "relation does
// not exist"). Esquema derivado de los 4 usos del router.
module.exports = {
  id: '033_purchase_order_lines',
  async run(pool) {
    await pool.query(`CREATE TABLE IF NOT EXISTS purchase_order_lines (
      id            SERIAL PRIMARY KEY,
      po_id         VARCHAR(100) REFERENCES purchase_orders(id) ON DELETE CASCADE,
      sku           VARCHAR(100) NOT NULL,
      expected_qty  NUMERIC(12,2) DEFAULT 0,
      received_qty  NUMERIC(12,2) DEFAULT 0,
      difference    NUMERIC(12,2) DEFAULT 0,
      status        VARCHAR(20) DEFAULT 'PENDING'
    )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_po_lines_po ON purchase_order_lines(po_id)`);
    console.log('[migr-033] purchase_order_lines OK');
  },
};
