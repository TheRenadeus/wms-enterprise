// Insumos (Histórico permanente): en vez de BORRAR un consumo asociado a un
// documento, se ANULA (soft-delete) para conservar la trazabilidad. Las
// agregaciones de consumo (reportes/análisis) excluyen los anulados; el
// histórico por insumo los muestra con su marca de anulación. Cambio aditivo.
module.exports = {
  id: '022_insumo_mov_anulado',
  async run(pool) {
    await pool.query(`ALTER TABLE insumo_movimientos ADD COLUMN IF NOT EXISTS anulado BOOLEAN NOT NULL DEFAULT FALSE`);
    await pool.query(`ALTER TABLE insumo_movimientos ADD COLUMN IF NOT EXISTS anulado_at TIMESTAMP`);
    await pool.query(`ALTER TABLE insumo_movimientos ADD COLUMN IF NOT EXISTS anulado_by VARCHAR(100)`);
    console.log('[migr-022] insumo_movimientos: columnas de anulación agregadas');
  },
};
