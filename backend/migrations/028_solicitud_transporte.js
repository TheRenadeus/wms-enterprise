// Fase 3 — Solicitud de transporte (dos orígenes: DESPACHO y SOLO_TRANSPORTE).
//
// - solicitud_transporte: la cola de pedidos que el coordinador asignará (Fase 5).
// - dispatch_schedules.requiere_transporte: flag que marca el EJECUTIVO al preparar
//   un despacho que necesita transporte (Origen A). El "despacho" del módulo es la
//   programación de despacho (dispatch_schedules), donde luego se gestiona el cierre
//   por POD (Fase 7).
//
// Idempotente.
module.exports = {
  id: '028_solicitud_transporte',
  async run(pool) {
    // Flag en el despacho (programación) — lo activa el ejecutivo al pedir transporte.
    await pool.query(`ALTER TABLE dispatch_schedules ADD COLUMN IF NOT EXISTS requiere_transporte BOOLEAN DEFAULT FALSE`);

    await pool.query(`CREATE TABLE IF NOT EXISTS solicitud_transporte (
      id                         VARCHAR(50) PRIMARY KEY,
      origen                     VARCHAR(20) NOT NULL CHECK (origen IN ('DESPACHO','SOLO_TRANSPORTE')),
      despacho_id                VARCHAR(100) REFERENCES dispatch_schedules(id) ON DELETE SET NULL,
      client_id                  VARCHAR(50),
      cliente_transporte_id      VARCHAR(50) REFERENCES clientes_transporte(id) ON DELETE SET NULL,
      sentido                    VARCHAR(20) NOT NULL DEFAULT 'SALIDA' CHECK (sentido IN ('SALIDA','REGRESO')),
      tipo_operacion             VARCHAR(20) NOT NULL DEFAULT 'DIRECTA' CHECK (tipo_operacion IN ('DIRECTA','TRANSITO','TRASVASIJE')),
      peso_total                 NUMERIC(14,3) DEFAULT 0,
      volumen_total              NUMERIC(16,4) DEFAULT 0,
      dims_incompletas           BOOLEAN DEFAULT FALSE,
      n_cajas                    INTEGER DEFAULT 0,
      n_cajones                  INTEGER DEFAULT 0,
      n_pallets                  INTEGER DEFAULT 0,
      tipo_vehiculo_sugerido     VARCHAR(80),
      origen_texto               TEXT,
      destino                    TEXT,
      hora_carga_habilitada      TIMESTAMP,
      fecha_hora_recepcion_destino TIMESTAMP,
      estado                     VARCHAR(20) NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','asignada','anulada')),
      usuario_solicita           VARCHAR(50),
      created_at                 TIMESTAMP DEFAULT NOW()
    )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_solicitud_estado ON solicitud_transporte(estado)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_solicitud_origen ON solicitud_transporte(origen)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_solicitud_despacho ON solicitud_transporte(despacho_id)`);

    console.log('[migr-028] solicitud_transporte + dispatch_schedules.requiere_transporte OK');
  },
};
