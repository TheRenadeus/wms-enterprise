// Fase 9 — Contenedores (entidad propia, recepción y despacho).
//
//   EXPORT/despacho:  se consolida carga en el contenedor → se asocia al ENVÍO
//                     (envio_id) → viaja en camión + chasis.
//   IMPORT/recepción: el contenedor llega → se asocia al AVISO de llegada
//                     (aviso_llegada_id) → bodega desconsolida → almacena.
//
// Historial de estados hasta 'devuelto_naviera' en contenedor_estados.
// Un contenedor puede consolidar varios despachos: se asocia a un envío, y el envío
// consolida varias paradas/despachos (decisión Fase 0: permitir varios).
module.exports = {
  id: '032_contenedores',
  async run(pool) {
    await pool.query(`CREATE TABLE IF NOT EXISTS contenedores (
      id               VARCHAR(50) PRIMARY KEY,
      numero           VARCHAR(50) NOT NULL,
      tipo             VARCHAR(10) CHECK (tipo IN ('20','40','40HC','REEFER')),
      sello            VARCHAR(50),
      naviera          VARCHAR(100),
      sentido          VARCHAR(10) NOT NULL CHECK (sentido IN ('EXPORT','IMPORT')),
      estado           VARCHAR(20) NOT NULL DEFAULT 'en_puerto'
                       CHECK (estado IN ('en_puerto','en_transito','en_bodega','devuelto_naviera')),
      envio_id         VARCHAR(50) REFERENCES envios(id) ON DELETE SET NULL,
      aviso_llegada_id VARCHAR(50) REFERENCES aviso_llegada(id) ON DELETE SET NULL,
      usuario          VARCHAR(50),
      created_at       TIMESTAMP DEFAULT NOW()
    )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_contenedores_sentido ON contenedores(sentido)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_contenedores_estado ON contenedores(estado)`);

    await pool.query(`CREATE TABLE IF NOT EXISTS contenedor_estados (
      id            SERIAL PRIMARY KEY,
      contenedor_id VARCHAR(50) REFERENCES contenedores(id) ON DELETE CASCADE,
      estado        VARCHAR(20),
      fecha         TIMESTAMP DEFAULT NOW(),
      usuario       VARCHAR(50)
    )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_contenedor_estados_cont ON contenedor_estados(contenedor_id)`);

    console.log('[migr-032] contenedores + contenedor_estados OK');
  },
};
