// Asignación de clientes por usuario para modo 3PL.
// users.client_scope: 'all' | 'assigned' | 'none'
// user_clients: relación N:M con UNIQUE(username, client_id)

module.exports = {
  id: '010_user_clients',
  run: async (pool) => {
    const log = (m) => console.log('[migr-010]', m);

    // clients.active (si no existe) para listar solo activos en getClientesPermitidos
    await pool.query(`
      ALTER TABLE clients
        ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE
    `);

    await pool.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS client_scope TEXT NOT NULL DEFAULT 'all'
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_clients (
        id          SERIAL PRIMARY KEY,
        username    TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
        client_id   TEXT NOT NULL REFERENCES clients(id)    ON DELETE CASCADE,
        assigned_by TEXT,
        assigned_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(username, client_id)
      )
    `);

    await pool.query(`CREATE INDEX IF NOT EXISTS idx_user_clients_username ON user_clients(username)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_user_clients_client   ON user_clients(client_id)`);

    log('user_clients + client_scope OK');
  }
};
