// Versionado de SKUs: columnas + función create_sku_version.
// Hereda los campos de fabricante (módulo 1) al crear una versión nueva.

module.exports = {
  id: '007_sku_versioning',
  run: async (pool) => {
    const log = (m) => console.log('[migr-007]', m);

    await pool.query(`
      ALTER TABLE master_skus
        ADD COLUMN IF NOT EXISTS version        INTEGER      NOT NULL DEFAULT 1,
        ADD COLUMN IF NOT EXISTS version_status TEXT         NOT NULL DEFAULT 'ACTIVE',
        ADD COLUMN IF NOT EXISTS parent_sku     TEXT,
        ADD COLUMN IF NOT EXISTS frozen_at      TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS frozen_reason  TEXT,
        ADD COLUMN IF NOT EXISTS change_log     JSONB        DEFAULT '[]'::jsonb
    `);
    // No agregamos FK a parent_sku → sku porque sku no es PK (la PK es (sku,client_id))
    // y la spec original asume sku único. Validamos a mano en la función.

    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_skus_active_version
        ON master_skus(parent_sku, version_status)
        WHERE version_status = 'ACTIVE' AND parent_sku IS NOT NULL
    `);

    await pool.query(`
      ALTER TABLE inventory_lpns
        ADD COLUMN IF NOT EXISTS sku_version INTEGER NOT NULL DEFAULT 1
    `);

    await pool.query(`
      CREATE OR REPLACE FUNCTION create_sku_version(
        p_base_sku TEXT, p_changes JSONB,
        p_reason TEXT, p_username TEXT
      ) RETURNS TABLE(new_sku TEXT, new_version INT) AS $$
      DECLARE
        v_current master_skus%ROWTYPE;
        v_new_version INT;
        v_new_sku TEXT;
      BEGIN
        SELECT * INTO v_current FROM master_skus
        WHERE (sku = p_base_sku OR parent_sku = p_base_sku)
          AND version_status = 'ACTIVE'
        ORDER BY version DESC LIMIT 1;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'SKU % no encontrado', p_base_sku;
        END IF;

        v_new_version := v_current.version + 1;
        v_new_sku     := p_base_sku || '-V' || v_new_version;

        UPDATE master_skus SET
          version_status = 'FROZEN',
          frozen_at      = NOW(),
          frozen_reason  = p_reason
        WHERE sku = v_current.sku AND client_id = v_current.client_id;

        INSERT INTO master_skus (
          sku, client_id, "desc", category, uom, weight, length, width, height,
          abc_class, barcode, requires_lot, requires_serial, stock_min, stock_max,
          manufacturer_id, manufacturer_code, manufacturer_sku, brand,
          version, version_status, parent_sku, change_log
        ) VALUES (
          v_new_sku, v_current.client_id, v_current."desc",
          v_current.category, v_current.uom, v_current.weight,
          v_current.length, v_current.width, v_current.height,
          v_current.abc_class, v_current.barcode,
          COALESCE((p_changes->>'requires_lot')::boolean,    v_current.requires_lot),
          COALESCE((p_changes->>'requires_serial')::boolean, v_current.requires_serial),
          v_current.stock_min, v_current.stock_max,
          v_current.manufacturer_id, v_current.manufacturer_code,
          v_current.manufacturer_sku, v_current.brand,
          v_new_version, 'ACTIVE', p_base_sku,
          jsonb_build_array(jsonb_build_object(
            'version',    v_new_version,
            'changed_at', NOW(),
            'changed_by', p_username,
            'reason',     p_reason,
            'changes',    p_changes
          ))
        );
        RETURN QUERY SELECT v_new_sku, v_new_version;
      END;
      $$ LANGUAGE plpgsql
    `);
    log('versionado de SKUs OK');
  }
};
