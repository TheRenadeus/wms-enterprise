// Versionado de SKU por cliente. La PK de master_skus es (sku, client_id): dos
// clientes pueden usar el mismo código. El historial y create_sku_version() solo
// miraban el código, así que versionar el SKU de un cliente alteraba el del otro.
//   - sku_version_history gana client_id y la unicidad pasa a (sku, client_id, version).
//   - Las filas existentes se asignan a cada cliente que tiene ese código (hasta hoy
//     un cambio de versión se aplicaba a todos ellos, así que la historia les vale).
//   - create_sku_version() recibe el cliente; la firma anterior se elimina para que
//     ninguna llamada vieja siga funcionando sin cliente.
// Idempotente.
module.exports = {
  id: '036_sku_version_cliente',
  async run(pool) {
    // Todo en una transacción: si algo falla no queda el historial a medio migrar.
    const db = await pool.connect();
    try {
    await db.query('BEGIN');
    await db.query(`ALTER TABLE sku_version_history ADD COLUMN IF NOT EXISTS client_id VARCHAR(50)`);
    await db.query(`ALTER TABLE sku_version_history DROP CONSTRAINT IF EXISTS sku_version_history_sku_version_key`);
    await db.query(`
      INSERT INTO sku_version_history (sku, client_id, version, requires_lot, requires_serial, changed_at, changed_by, reason)
      SELECT h.sku, ms.client_id, h.version, h.requires_lot, h.requires_serial, h.changed_at, h.changed_by, h.reason
        FROM sku_version_history h
        JOIN master_skus ms ON ms.sku = h.sku
       WHERE h.client_id IS NULL
         AND h.version <= ms.current_version`); // solo versiones que ese cliente alcanzó
    await db.query(`DELETE FROM sku_version_history h WHERE h.client_id IS NULL AND EXISTS (SELECT 1 FROM master_skus ms WHERE ms.sku = h.sku)`);
    await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_sku_version_history_cliente ON sku_version_history (sku, client_id, version)`);
    await db.query(`DROP INDEX IF EXISTS idx_sku_version_history`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_sku_version_history_cliente ON sku_version_history (sku, client_id, version DESC)`);

    await db.query(`DROP FUNCTION IF EXISTS create_sku_version(TEXT, JSONB, TEXT, TEXT)`);
    await db.query(`
      CREATE OR REPLACE FUNCTION create_sku_version(
        p_sku       TEXT,
        p_client_id TEXT,
        p_changes   JSONB,
        p_reason    TEXT,
        p_username  TEXT
      ) RETURNS TABLE(result_sku TEXT, new_version INT) AS $$
      DECLARE
        v_current  master_skus%ROWTYPE;
        v_next_ver INTEGER;
      BEGIN
        SELECT * INTO v_current FROM master_skus ms
         WHERE ms.sku = p_sku AND ms.client_id = p_client_id
         FOR UPDATE;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'SKU % no encontrado para el cliente %', p_sku, p_client_id;
        END IF;

        v_next_ver := v_current.current_version + 1;

        INSERT INTO sku_version_history
          (sku, client_id, version, requires_lot, requires_serial, changed_at, changed_by, reason)
        VALUES
          (p_sku, p_client_id, v_current.current_version,
           v_current.requires_lot, v_current.requires_serial,
           NOW(), p_username, p_reason)
        ON CONFLICT (sku, client_id, version) DO NOTHING;

        UPDATE master_skus ms2 SET
          requires_lot    = COALESCE((p_changes->>'requires_lot')::boolean,    ms2.requires_lot),
          requires_serial = COALESCE((p_changes->>'requires_serial')::boolean, ms2.requires_serial),
          current_version = v_next_ver
        WHERE ms2.sku = p_sku AND ms2.client_id = p_client_id;

        INSERT INTO sku_version_history
          (sku, client_id, version, requires_lot, requires_serial, changed_at, changed_by, reason)
        SELECT p_sku, p_client_id, v_next_ver, ms3.requires_lot, ms3.requires_serial,
               NOW(), p_username, 'Versión activa tras cambio'
          FROM master_skus ms3 WHERE ms3.sku = p_sku AND ms3.client_id = p_client_id
        ON CONFLICT (sku, client_id, version) DO NOTHING;

        RETURN QUERY SELECT p_sku AS result_sku, v_next_ver AS new_version;
      END;
      $$ LANGUAGE plpgsql
    `);
    await db.query('COMMIT');
    } catch (e) {
      await db.query('ROLLBACK').catch(() => {});
      throw e;
    } finally { db.release(); }
    console.log('[migr-036] versionado de SKU por cliente OK');
  },
};
