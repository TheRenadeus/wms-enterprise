// Conteos cíclicos por cliente: cada línea guarda el dueño del stock contado y el
// stock que tenía el sistema al momento de contarla. La aprobación compara contra
// el stock actual y exige recontar si hubo movimientos entre medio.
// Idempotente.
module.exports = {
  id: '037_conteo_cliente',
  async run(pool) {
    await pool.query(`ALTER TABLE cycle_count_lines ADD COLUMN IF NOT EXISTS client_id VARCHAR(50)`);
    await pool.query(`ALTER TABLE cycle_count_lines ADD COLUMN IF NOT EXISTS stock_at_count NUMERIC(12,2)`);
    // Líneas existentes: el cliente del filtro del conteo o, si no hay, el único
    // dueño del SKU. Si el código es de varios clientes queda NULL (no se adivina).
    await pool.query(`
      UPDATE cycle_count_lines l SET client_id = cc.client_filter
        FROM cycle_counts cc
       WHERE cc.id = l.count_id AND l.client_id IS NULL AND cc.client_filter IS NOT NULL AND cc.client_filter <> ''`);
    await pool.query(`
      UPDATE cycle_count_lines l SET client_id = sub.cid
        FROM (SELECT sku, MIN(client_id) AS cid FROM master_skus GROUP BY sku HAVING COUNT(DISTINCT client_id) = 1) sub
       WHERE sub.sku = l.sku AND l.client_id IS NULL`);
    console.log('[migr-037] cycle_count_lines.client_id + stock_at_count OK');
  },
};
