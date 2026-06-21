// KITTING — FASE 1: trazabilidad de origen COMÚN para Modo A y Modo B.
//
// La 023 creó kit_componente_consumido atada SOLO a kit_orden (Modo B). Para que
// la MISMA tabla sirva también al Modo A (kit explotado al vuelo en un despacho),
// la volvemos POLIMÓRFICA:
//   - origen_tipo  : 'despacho' | 'orden_armado'
//   - origen_id    : doc_num del despacho (Modo A) | id de kit_orden (Modo B)
//   - modo_origen  : 'auto' (FEFO) | 'manual' (el usuario eligió ubicación/lote/serie)
//   - client_id    : cliente del componente (master_skus se llavea por (sku, client_id))
// kit_orden_id pasa a NULLABLE (en Modo A no hay orden). Backfill de filas previas
// (todas son Modo B) a origen_tipo='orden_armado', origen_id=kit_orden_id.
// 100% aditivo (ADD COLUMN IF NOT EXISTS / DROP NOT NULL idempotente).
module.exports = {
  id: '024_kitting_traza_origen',
  async run(pool) {
    // Nuevas columnas polimórficas (idempotentes).
    await pool.query(`ALTER TABLE kit_componente_consumido ADD COLUMN IF NOT EXISTS origen_tipo VARCHAR(20)`);
    await pool.query(`ALTER TABLE kit_componente_consumido ADD COLUMN IF NOT EXISTS origen_id   VARCHAR(100)`);
    await pool.query(`ALTER TABLE kit_componente_consumido ADD COLUMN IF NOT EXISTS modo_origen VARCHAR(10)`);
    await pool.query(`ALTER TABLE kit_componente_consumido ADD COLUMN IF NOT EXISTS client_id   VARCHAR(50)`);

    // kit_orden_id deja de ser obligatorio (Modo A no tiene orden).
    await pool.query(`ALTER TABLE kit_componente_consumido ALTER COLUMN kit_orden_id DROP NOT NULL`);

    // Backfill de filas previas: todas provienen del armado (Modo B).
    await pool.query(`
      UPDATE kit_componente_consumido
         SET origen_tipo = 'orden_armado',
             origen_id   = kit_orden_id
       WHERE origen_tipo IS NULL AND kit_orden_id IS NOT NULL
    `);

    // Validación de dominios (permite NULL para no romper transiciones).
    await pool.query(`
      DO $$ BEGIN
        ALTER TABLE kit_componente_consumido
          ADD CONSTRAINT kit_consumido_origen_tipo_chk
          CHECK (origen_tipo IS NULL OR origen_tipo IN ('despacho','orden_armado'));
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);
    await pool.query(`
      DO $$ BEGIN
        ALTER TABLE kit_componente_consumido
          ADD CONSTRAINT kit_consumido_modo_origen_chk
          CHECK (modo_origen IS NULL OR modo_origen IN ('auto','manual'));
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);

    // Índice para consultar trazabilidad por origen (ej: todos los consumos de un despacho).
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_kit_consumido_origen ON kit_componente_consumido (origen_tipo, origen_id)`);

    console.log('[migr-024] kit_componente_consumido ahora es polimórfica (despacho|orden_armado)');
  },
};
