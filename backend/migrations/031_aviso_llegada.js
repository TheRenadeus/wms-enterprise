// Fase 8 — Aviso de llegada de carga (INBOUND → bodega).
//
// Lo crea el COORDINADOR (requireTransporte) para carga que SÍ se almacenará (entra
// a stock) — distinto de la carga de tránsito. Es una NOTIFICACIÓN: bodega la ve,
// prepara la recepción y, al llegar, almacena (genera stock/LPN) por el flujo normal
// de recepción. Aquí solo se lleva el estado avisado→recibido→almacenado.
//
// contenedor_id queda como columna nullable (la tabla contenedores llega en Fase 9).
module.exports = {
  id: '031_aviso_llegada',
  async run(pool) {
    await pool.query(`CREATE TABLE IF NOT EXISTS aviso_llegada (
      id                    VARCHAR(50) PRIMARY KEY,
      vehiculo_desc         VARCHAR(150),
      transportista_id      VARCHAR(50) REFERENCES transportistas(id),
      carga_desc            TEXT,
      client_id             VARCHAR(50),
      hora_estimada_llegada TIMESTAMP,
      contenedor_id         VARCHAR(50),
      estado                VARCHAR(20) NOT NULL DEFAULT 'avisado'
                            CHECK (estado IN ('avisado','recibido','almacenado')),
      usuario_coordinador   VARCHAR(50),
      created_at            TIMESTAMP DEFAULT NOW()
    )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_aviso_llegada_estado ON aviso_llegada(estado)`);
    console.log('[migr-031] aviso_llegada OK');
  },
};
