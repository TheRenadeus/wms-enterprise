// Fase 2 — Maestros del módulo de Transporte y Logística.
//
// Tablas nuevas (no se reutilizan carriers/shipments viejos, por decisión de diseño):
//   tipos_vehiculo            lista parametrizable (camioneta, camión, furgón…)
//   transportistas            flota propia y externa
//   vehiculos                 con dimensiones del ÁREA DE CARGA y volumen_util calculado
//   choferes                  por transportista
//   pionetas                  por transportista
//   clientes_transporte       clientes propios del coordinador (carga NO en bodega)
//   destinos_cliente_transporte  direcciones de cada cliente de transporte
//
// volumen_util es una COLUMNA GENERADA (PostgreSQL 15) = area_largo*area_ancho*area_alto.
// Idempotente: CREATE TABLE IF NOT EXISTS + seeds ON CONFLICT DO NOTHING.
module.exports = {
  id: '027_transporte_maestros',
  async run(pool) {
    // ── Tipos de vehículo (parametrizable) ──────────────────────────────────
    await pool.query(`CREATE TABLE IF NOT EXISTS tipos_vehiculo (
      id      SERIAL PRIMARY KEY,
      nombre  VARCHAR(80) UNIQUE NOT NULL,
      activo  BOOLEAN DEFAULT TRUE
    )`);
    await pool.query(`INSERT INTO tipos_vehiculo (nombre) VALUES
      ('Camioneta'), ('Camión cerrado'), ('Camión abierto'), ('Furgón'),
      ('Camión rampa'), ('Tracto camión')
      ON CONFLICT (nombre) DO NOTHING`);

    // ── Transportistas (flota propia y externa) ─────────────────────────────
    await pool.query(`CREATE TABLE IF NOT EXISTS transportistas (
      id                  VARCHAR(50) PRIMARY KEY,
      nombre_razon_social VARCHAR(200) NOT NULL,
      tipo                VARCHAR(20) NOT NULL CHECK (tipo IN ('PROPIO','EXTERNO')),
      rut                 VARCHAR(20),
      contacto            VARCHAR(150),
      activo              BOOLEAN DEFAULT TRUE,
      created_at          TIMESTAMP DEFAULT NOW()
    )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_transportistas_activo ON transportistas(activo)`);

    // ── Vehículos ───────────────────────────────────────────────────────────
    await pool.query(`CREATE TABLE IF NOT EXISTS vehiculos (
      id                 VARCHAR(50) PRIMARY KEY,
      transportista_id   VARCHAR(50) REFERENCES transportistas(id) ON DELETE CASCADE,
      tipo_vehiculo      VARCHAR(80),
      matricula          VARCHAR(20),
      capacidad_carga_kg NUMERIC(12,2) DEFAULT 0,
      area_largo         NUMERIC(10,2) DEFAULT 0,
      area_ancho         NUMERIC(10,2) DEFAULT 0,
      area_alto          NUMERIC(10,2) DEFAULT 0,
      volumen_util       NUMERIC(16,3) GENERATED ALWAYS AS (area_largo * area_ancho * area_alto) STORED,
      activo             BOOLEAN DEFAULT TRUE,
      created_at         TIMESTAMP DEFAULT NOW()
    )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_vehiculos_transportista ON vehiculos(transportista_id)`);

    // ── Choferes ──────────────────────────────────────────────────────────────
    await pool.query(`CREATE TABLE IF NOT EXISTS choferes (
      id               VARCHAR(50) PRIMARY KEY,
      transportista_id VARCHAR(50) REFERENCES transportistas(id) ON DELETE CASCADE,
      nombre           VARCHAR(150) NOT NULL,
      contacto         VARCHAR(150),
      rut              VARCHAR(20),
      correo           VARCHAR(150),
      activo           BOOLEAN DEFAULT TRUE,
      created_at       TIMESTAMP DEFAULT NOW()
    )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_choferes_transportista ON choferes(transportista_id)`);

    // ── Pionetas ──────────────────────────────────────────────────────────────
    await pool.query(`CREATE TABLE IF NOT EXISTS pionetas (
      id               VARCHAR(50) PRIMARY KEY,
      transportista_id VARCHAR(50) REFERENCES transportistas(id) ON DELETE CASCADE,
      nombre           VARCHAR(150) NOT NULL,
      rut              VARCHAR(20),
      activo           BOOLEAN DEFAULT TRUE,
      created_at       TIMESTAMP DEFAULT NOW()
    )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_pionetas_transportista ON pionetas(transportista_id)`);

    // ── Clientes de transporte (carga que NO está en bodega) ───────────────────
    await pool.query(`CREATE TABLE IF NOT EXISTS clientes_transporte (
      id         VARCHAR(50) PRIMARY KEY,
      nombre     VARCHAR(200) NOT NULL,
      rut        VARCHAR(20),
      contacto   VARCHAR(150),
      activo     BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT NOW()
    )`);

    // ── Destinos de cada cliente de transporte ─────────────────────────────────
    await pool.query(`CREATE TABLE IF NOT EXISTS destinos_cliente_transporte (
      id                    SERIAL PRIMARY KEY,
      cliente_transporte_id VARCHAR(50) REFERENCES clientes_transporte(id) ON DELETE CASCADE,
      nombre                VARCHAR(150) NOT NULL,
      direccion             TEXT
    )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_destinos_cliente ON destinos_cliente_transporte(cliente_transporte_id)`);

    console.log('[migr-027] maestros de transporte creados OK');
  },
};
