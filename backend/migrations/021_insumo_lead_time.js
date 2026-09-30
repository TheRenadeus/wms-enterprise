// Insumos (Análisis de inventario): tiempo de reposición OPCIONAL por insumo.
// lead_time_dias = días estimados entre que se pide reposición y llega. Se usa
// para clasificar un insumo como 'critico' cuando sus días de cobertura caen por
// debajo del lead time. NULL = no definido (el análisis usa un fallback basado en
// el stock_minimo). Cambio aditivo y reversible (no toca datos existentes).
module.exports = {
  id: '021_insumo_lead_time',
  async run(pool) {
    await pool.query(`ALTER TABLE insumos ADD COLUMN IF NOT EXISTS lead_time_dias INTEGER`);
    console.log('[migr-021] insumos.lead_time_dias agregado (opcional)');
  },
};
