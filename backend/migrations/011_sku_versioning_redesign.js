// Rediseño del versionado de SKUs.
// El código del SKU no cambia jamás. La versión es un campo numérico interno
// (current_version) y el historial vive en una tabla aparte (sku_version_history).
// La función create_sku_version() ahora actualiza la fila existente y guarda
// snapshots en el historial.

module.exports = {
  id: '011_sku_versioning_redesign',
  run: async (pool) => {
    const log = (m) => console.log('[migr-011]', m);

    // 1) Quitar columnas del diseño anterior (si la migración 007 las creó).
    //    DROP IF EXISTS no falla si no existen.
    await pool.query(`
      ALTER TABLE master_skus
        DROP COLUMN IF EXISTS version,
        DROP COLUMN IF EXISTS version_status,
        DROP COLUMN IF EXISTS parent_sku,
        DROP COLUMN IF EXISTS frozen_at,
        DROP COLUMN IF EXISTS frozen_reason,
        DROP COLUMN IF EXISTS change_log
    `);
    log('columnas legacy DROP OK');

    // 2) Agregar columnas del nuevo diseño.
    await pool.query(`
      ALTER TABLE master_skus
        ADD COLUMN IF NOT EXISTS current_version   INTEGER NOT NULL DEFAULT 1,
        ADD COLUMN IF NOT EXISTS requires_lot_v1   BOOLEAN,
        ADD COLUMN IF NOT EXISTS requires_serial_v1 BOOLEAN
    `);
    log('columnas current_version + requires_*_v1 OK');

    // 3) Tabla de historial.
    // Nota: master_skus.sku NO es UNIQUE por sí solo (la PK es (sku, client_id)),
    // así que no podemos crear FK directa. La integridad se mantiene a nivel
    // de aplicación: solo inserta create_sku_version() y el PUT /api/skus/:sku.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sku_version_history (
        id              SERIAL PRIMARY KEY,
        sku             TEXT NOT NULL,
        version         INTEGER NOT NULL,
        requires_lot    BOOLEAN NOT NULL,
        requires_serial BOOLEAN NOT NULL,
        changed_at      TIMESTAMPTZ DEFAULT NOW(),
        changed_by      TEXT,
        reason          TEXT,
        UNIQUE(sku, version)
      )
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_sku_version_history
        ON sku_version_history (sku, version DESC)
    `);
    log('sku_version_history OK');

    // 4) Eliminar la función vieja y crear la nueva (firma distinta).
    await pool.query(`DROP FUNCTION IF EXISTS create_sku_version(TEXT, JSONB, TEXT, TEXT)`);
    await pool.query(`
      CREATE OR REPLACE FUNCTION create_sku_version(
        p_sku      TEXT,
        p_changes  JSONB,
        p_reason   TEXT,
        p_username TEXT
      ) RETURNS TABLE(result_sku TEXT, new_version INT) AS $$
      DECLARE
        v_current  master_skus%ROWTYPE;
        v_next_ver INTEGER;
      BEGIN
        SELECT * INTO v_current FROM master_skus ms WHERE ms.sku = p_sku;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'SKU % no encontrado', p_sku;
        END IF;

        v_next_ver := v_current.current_version + 1;

        INSERT INTO sku_version_history
          (sku, version, requires_lot, requires_serial, changed_at, changed_by, reason)
        VALUES
          (p_sku, v_current.current_version,
           v_current.requires_lot, v_current.requires_serial,
           NOW(), p_username, p_reason)
        ON CONFLICT (sku, version) DO NOTHING;

        UPDATE master_skus ms2 SET
          requires_lot = COALESCE((p_changes->>'requires_lot')::boolean,    ms2.requires_lot),
          requires_serial = COALESCE((p_changes->>'requires_serial')::boolean, ms2.requires_serial),
          current_version = v_next_ver
        WHERE ms2.sku = p_sku;

        INSERT INTO sku_version_history
          (sku, version, requires_lot, requires_serial, changed_at, changed_by, reason)
        SELECT
          p_sku, v_next_ver,
          ms3.requires_lot, ms3.requires_serial,
          NOW(), p_username, 'Versión activa tras cambio'
        FROM master_skus ms3 WHERE ms3.sku = p_sku
        ON CONFLICT (sku, version) DO NOTHING;

        RETURN QUERY SELECT p_sku AS result_sku, v_next_ver AS new_version;
      END;
      $$ LANGUAGE plpgsql
    `);
    log('función create_sku_version() redefinida');

    // 5) Asegurar que inventory_lpns.sku_version sigue existiendo (creada por 007).
    await pool.query(`
      ALTER TABLE inventory_lpns
        ADD COLUMN IF NOT EXISTS sku_version INTEGER NOT NULL DEFAULT 1
    `);

    // 6) Backfill: registrar la versión actual de cada SKU como v1 en el historial
    //    si no tiene ningún registro. Esto da una línea base para todos los SKUs.
    await pool.query(`
      INSERT INTO sku_version_history (sku, version, requires_lot, requires_serial, changed_at, changed_by, reason)
      SELECT s.sku, COALESCE(s.current_version, 1), COALESCE(s.requires_lot, FALSE), COALESCE(s.requires_serial, FALSE),
             NOW(), 'system', 'Línea base (backfill 011)'
        FROM master_skus s
        WHERE NOT EXISTS (SELECT 1 FROM sku_version_history h WHERE h.sku = s.sku)
      ON CONFLICT (sku, version) DO NOTHING
    `);
    log('backfill historial OK');
  }
};
