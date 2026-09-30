// KITTING v2 — flujo de ÓRDENES de armado con trazabilidad de origen y desarmado.
// Reutiliza la receta existente (kits + kit_components). Agrega:
//  - master_skus.es_kit: marca el SKU como kit.
//  - kit_orden: orden de armado (pendiente → armado → desarmado).
//  - kit_origen_sugerido: origen sugerido por el ejecutivo (por componente).
//  - kit_componente_consumido: origen FINAL que tomó el picker (trazabilidad).
//  - kit_stock: stock resultante del kit armado (tabla dedicada, ligada a la orden).
// Identificamos SKUs por (sku, client_id) porque master_skus se llavea así (sin id numérico).
// Cambio 100% aditivo (ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS).
module.exports = {
  id: '023_kitting_ordenes',
  async run(pool) {
    // Marca de kit en el maestro de SKUs.
    await pool.query(`ALTER TABLE master_skus ADD COLUMN IF NOT EXISTS es_kit BOOLEAN NOT NULL DEFAULT FALSE`);

    // Orden de armado.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS kit_orden (
        id              VARCHAR(100) PRIMARY KEY,
        kit_sku         VARCHAR(100) NOT NULL,
        client_id       VARCHAR(50)  NOT NULL,
        cantidad_kits   INTEGER      NOT NULL CHECK (cantidad_kits > 0),
        estado          VARCHAR(20)  NOT NULL DEFAULT 'pendiente'
                         CHECK (estado IN ('pendiente','armado','desarmado','cancelado')),
        usuario_creador VARCHAR(100),
        notas           TEXT,
        created_at      TIMESTAMP DEFAULT NOW(),
        armado_por      VARCHAR(100),
        armado_at       TIMESTAMP,
        desarmado_por   VARCHAR(100),
        desarmado_at    TIMESTAMP
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_kit_orden_cli_estado ON kit_orden (client_id, estado)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_kit_orden_kit ON kit_orden (kit_sku, client_id)`);

    // Origen SUGERIDO por componente (lo indica el ejecutivo, opcional).
    await pool.query(`
      CREATE TABLE IF NOT EXISTS kit_origen_sugerido (
        id              SERIAL PRIMARY KEY,
        kit_orden_id    VARCHAR(100) NOT NULL REFERENCES kit_orden(id) ON DELETE CASCADE,
        componente_sku  VARCHAR(100) NOT NULL,
        ubicacion       VARCHAR(50),
        lote            VARCHAR(100),
        serie           VARCHAR(100),
        cantidad        NUMERIC(12,2)
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_kit_sugerido_orden ON kit_origen_sugerido (kit_orden_id)`);

    // Origen FINAL consumido (trazabilidad real; marca diferencia vs sugerido).
    await pool.query(`
      CREATE TABLE IF NOT EXISTS kit_componente_consumido (
        id                   SERIAL PRIMARY KEY,
        kit_orden_id         VARCHAR(100) NOT NULL REFERENCES kit_orden(id) ON DELETE CASCADE,
        componente_sku       VARCHAR(100) NOT NULL,
        cantidad             NUMERIC(12,2) NOT NULL,
        ubicacion            VARCHAR(50),
        lote                 VARCHAR(100),
        serie                VARCHAR(100),
        lpn_origen           VARCHAR(100),
        difiere_de_sugerido  BOOLEAN NOT NULL DEFAULT FALSE,
        created_at           TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_kit_consumido_orden ON kit_componente_consumido (kit_orden_id)`);

    // Stock resultante del kit armado (tabla dedicada, ligada a la orden).
    await pool.query(`
      CREATE TABLE IF NOT EXISTS kit_stock (
        id            VARCHAR(100) PRIMARY KEY,
        kit_orden_id  VARCHAR(100) NOT NULL REFERENCES kit_orden(id) ON DELETE CASCADE,
        kit_sku       VARCHAR(100) NOT NULL,
        client_id     VARCHAR(50)  NOT NULL,
        cantidad      NUMERIC(12,2) NOT NULL CHECK (cantidad >= 0),
        ubicacion     VARCHAR(50),
        lote          VARCHAR(100),
        serie         VARCHAR(100),
        estado        VARCHAR(20)  NOT NULL DEFAULT 'disponible'
                       CHECK (estado IN ('disponible','despachado','desarmado')),
        created_at    TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_kit_stock_orden ON kit_stock (kit_orden_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_kit_stock_sku ON kit_stock (kit_sku, client_id, estado)`);

    console.log('[migr-023] kitting v2: es_kit + kit_orden/sugerido/consumido/stock creados');
  },
};
