// Fase 5 — Envíos (shipments del módulo) + asignación/reasignación.
//
// Tablas NUEVAS con prefijo `envio*` (NO se reutiliza la tabla legacy `shipments`,
// por decisión de diseño en Fase 0). El vínculo solicitud↔envío es vía envio_paradas
// (cada parada referencia opcionalmente una solicitud), lo que habilita la
// consolidación de varias solicitudes/clientes en un mismo envío (Fase 6).
//
//   envios               cabecera del envío (transportista/vehículo/chofer + estado)
//   envio_pionetas       varias pionetas por envío
//   envio_tramos         segmentos del viaje (trasvasije crea un tramo nuevo)
//   envio_paradas        ruta ordenada + POD por parada (POD se usa en Fase 6/7)
//   envio_reasignaciones historial de reasignaciones (SIMPLE/TRASVASIJE) con motivo
//
// Idempotente.
module.exports = {
  id: '029_envios',
  async run(pool) {
    await pool.query(`CREATE TABLE IF NOT EXISTS envios (
      id                    VARCHAR(50) PRIMARY KEY,
      transportista_id      VARCHAR(50) REFERENCES transportistas(id),
      vehiculo_id           VARCHAR(50) REFERENCES vehiculos(id),
      chofer_id             VARCHAR(50) REFERENCES choferes(id),
      fecha_hora_confirmada TIMESTAMP,
      estado                VARCHAR(20) NOT NULL DEFAULT 'asignado'
                            CHECK (estado IN ('asignado','en_ruta','entregado','anulado')),
      usuario_asigna        VARCHAR(50),
      created_at            TIMESTAMP DEFAULT NOW()
    )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_envios_estado ON envios(estado)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_envios_transportista ON envios(transportista_id)`);

    await pool.query(`CREATE TABLE IF NOT EXISTS envio_pionetas (
      envio_id   VARCHAR(50) REFERENCES envios(id) ON DELETE CASCADE,
      pioneta_id VARCHAR(50) REFERENCES pionetas(id),
      PRIMARY KEY (envio_id, pioneta_id)
    )`);

    await pool.query(`CREATE TABLE IF NOT EXISTS envio_tramos (
      id          SERIAL PRIMARY KEY,
      envio_id    VARCHAR(50) REFERENCES envios(id) ON DELETE CASCADE,
      orden       INTEGER DEFAULT 1,
      vehiculo_id VARCHAR(50) REFERENCES vehiculos(id),
      chofer_id   VARCHAR(50) REFERENCES choferes(id),
      desde       TEXT,
      hasta       TEXT,
      motivo      TEXT,
      created_at  TIMESTAMP DEFAULT NOW()
    )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_envio_tramos_envio ON envio_tramos(envio_id)`);

    await pool.query(`CREATE TABLE IF NOT EXISTS envio_paradas (
      id                      SERIAL PRIMARY KEY,
      envio_id                VARCHAR(50) REFERENCES envios(id) ON DELETE CASCADE,
      orden                   INTEGER DEFAULT 1,
      solicitud_transporte_id VARCHAR(50) REFERENCES solicitud_transporte(id) ON DELETE SET NULL,
      cliente_ref             VARCHAR(200),
      destino                 TEXT,
      carga_desc              TEXT,
      estado                  VARCHAR(20) NOT NULL DEFAULT 'pendiente'
                              CHECK (estado IN ('pendiente','entregada')),
      pod_receptor            VARCHAR(150),
      pod_observaciones       TEXT,
      pod_fecha_hora          TIMESTAMP
    )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_envio_paradas_envio ON envio_paradas(envio_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_envio_paradas_solicitud ON envio_paradas(solicitud_transporte_id)`);

    await pool.query(`CREATE TABLE IF NOT EXISTS envio_reasignaciones (
      id                SERIAL PRIMARY KEY,
      envio_id          VARCHAR(50) REFERENCES envios(id) ON DELETE CASCADE,
      fecha             TIMESTAMP DEFAULT NOW(),
      tipo              VARCHAR(20) NOT NULL CHECK (tipo IN ('SIMPLE','TRASVASIJE')),
      motivo            TEXT NOT NULL,
      vehiculo_anterior VARCHAR(50),
      chofer_anterior   VARCHAR(50),
      vehiculo_nuevo    VARCHAR(50),
      chofer_nuevo      VARCHAR(50),
      usuario           VARCHAR(50)
    )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_envio_reasig_envio ON envio_reasignaciones(envio_id)`);

    console.log('[migr-029] envios + envio_pionetas/tramos/paradas/reasignaciones OK');
  },
};
