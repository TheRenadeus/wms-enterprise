// Modelo de roles v2 (refactor RBAC).
//
// Renombrado con choque de nombres → ORDEN ESTRICTO:
//   1) EJECUTIVO_CUENTA (antes "Jefe de Bodega")  → JEFE_BODEGA   (libera el nombre)
//   2) OPERARIO (operario de piso)                → EJECUTIVO_CUENTA (reasigna)
//   3) SUPERVISOR (rol muerto/legacy)             → EJECUTIVO_CUENTA
//
// role es VARCHAR(50) (texto libre, sin ENUM): no hace falta ALTER TYPE.
// Se fija default = AUDITOR (mínimo privilegio) y un CHECK con los 7 roles
// asignables (DEMO no es asignable a users; solo se emite por /demo/login).
//
// Idempotente: los UPDATE no afectan filas ya renombradas; el CHECK se recrea.
module.exports = {
  id: '015_role_model_v2',
  async run(pool) {
    // Quitar cualquier CHECK previo de role para no bloquear los renames.
    await pool.query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_chk`);

    // 1) Renombrado en orden estricto.
    const r1 = await pool.query(`UPDATE users SET role='JEFE_BODEGA'      WHERE role='EJECUTIVO_CUENTA'`);
    const r2 = await pool.query(`UPDATE users SET role='EJECUTIVO_CUENTA' WHERE role='OPERARIO'`);
    const r3 = await pool.query(`UPDATE users SET role='EJECUTIVO_CUENTA' WHERE role='SUPERVISOR'`);
    console.log(`[migr-015] roles renombrados → EJEC→JEFE=${r1.rowCount}, OPER→EJEC=${r2.rowCount}, SUPERVISOR→EJEC=${r3.rowCount}`);

    // 2) Default de mínimo privilegio para usuarios nuevos sin rol explícito.
    await pool.query(`ALTER TABLE users ALTER COLUMN role SET DEFAULT 'AUDITOR'`);

    // 3) CHECK con los 7 roles asignables (barrera a nivel BD).
    await pool.query(`
      ALTER TABLE users ADD CONSTRAINT users_role_chk CHECK (
        role IN ('SUPERADMIN','ADMIN','JEFE_BODEGA','EJECUTIVO_CUENTA','PICKER','AUDITOR','CLIENTE')
      )
    `);
    console.log('[migr-015] default=AUDITOR + CHECK users_role_chk OK');
  },
};
