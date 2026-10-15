// asns.client_id: dueño de la mercancía de cada aviso de llegada, para filtrar los
// listados por cliente. Para los ASN existentes se completa solo cuando todos sus
// SKU pertenecen a un único cliente; si no, queda NULL (no se adivina).
// Idempotente.
module.exports = {
  id: '035_asn_client',
  async run(pool) {
    await pool.query(`ALTER TABLE asns ADD COLUMN IF NOT EXISTS client_id VARCHAR(50)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_asns_client ON asns(client_id)`);
    const r = await pool.query(`
      UPDATE asns a SET client_id = sub.cid
        FROM (SELECT l.asn_id, MIN(ms.client_id) AS cid
                FROM asn_lines l
                JOIN master_skus ms ON ms.sku = l.sku
               GROUP BY l.asn_id
              HAVING COUNT(DISTINCT ms.client_id) = 1) sub
       WHERE a.id = sub.asn_id AND a.client_id IS NULL`);
    console.log(`[migr-035] asns.client_id OK (${r.rowCount} ASN existentes con cliente asignado)`);
  },
};
