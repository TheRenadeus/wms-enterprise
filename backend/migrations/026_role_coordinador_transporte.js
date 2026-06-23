// Fase 1 — Módulo de Transporte y Logística.
// Agrega el rol COORDINADOR_TRANSPORTE a la allowlist del modelo de roles.
//
// El rol es un especialista paralelo a la jerarquía de bodega: escribe SOLO en
// el módulo de transporte (gate requireTransporte) y tiene lectura sobre
// inventario, SKUs y despachos. NO toca stock ni confirma/cierra despachos.
//
// role es VARCHAR(50) sin ENUM → solo hay que recrear el CHECK users_role_chk.
// Idempotente: el CHECK se elimina y se vuelve a crear con los 8 roles asignables.
module.exports = {
  id: '026_role_coordinador_transporte',
  async run(pool) {
    await pool.query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_chk`);
    await pool.query(`
      ALTER TABLE users ADD CONSTRAINT users_role_chk CHECK (
        role IN ('SUPERADMIN','ADMIN','JEFE_BODEGA','EJECUTIVO_CUENTA','COORDINADOR_TRANSPORTE','PICKER','AUDITOR','CLIENTE')
      )
    `);
    console.log('[migr-026] CHECK users_role_chk recreado con COORDINADOR_TRANSPORTE OK');
  },
};
