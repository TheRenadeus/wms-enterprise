// Fase 7 — Cierre del despacho por POD.
//
// SOLO afecta a despachos (dispatch_schedules) con requiere_transporte=TRUE. El flujo
// de cierre de despachos SIN transporte (PROGRAMADO→CONFIRMADO y el despacho físico
// dispatch_batch) NO se altera.
//
// Estados nuevos del despacho de Origen A (status es VARCHAR libre, sin ENUM):
//   en_transito             → al asignarse el envío (Fase 5)
//   habilitado_para_cierre  → al confirmarse el POD de su parada (Fase 6)
//   CERRADO                 → cierre MANUAL por bodega (EJECUTIVO_CUENTA+)
//
// Columnas nuevas para trazabilidad del cierre. Idempotente.
module.exports = {
  id: '030_despacho_cierre_pod',
  async run(pool) {
    await pool.query(`ALTER TABLE dispatch_schedules ADD COLUMN IF NOT EXISTS pod_confirmado_at TIMESTAMP`);
    await pool.query(`ALTER TABLE dispatch_schedules ADD COLUMN IF NOT EXISTS closed_by VARCHAR(50)`);
    await pool.query(`ALTER TABLE dispatch_schedules ADD COLUMN IF NOT EXISTS closed_at TIMESTAMP`);
    console.log('[migr-030] dispatch_schedules: pod_confirmado_at, closed_by, closed_at OK');
  },
};
