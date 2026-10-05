// Alcance efectivo de clientes y vigencia de la sesión, resueltos contra la base.
//
// El JWT dura 12 h y no se consulta la base al validarlo, así que los permisos que
// trae pueden estar desactualizados. Aquí se lee el usuario (con caché corta) para:
//   - cortar sesiones de usuarios eliminados, suspendidos o con rol cambiado;
//   - calcular a qué clientes puede acceder, combinando los dos mecanismos que
//     conviven: users.client_scope + user_clients (v2) y users.allowed_clients (CSV).
//     El resultado es la intersección: si cualquiera de los dos restringe, restringe.
const { pool } = require('./db');

const TTL_MS = 15_000;
const cache = new Map(); // username → { at, value }

const FULL_ACCESS_ROLES = ['ADMIN', 'SUPERADMIN'];
// Clientes "propios" de la bodega: stock sin dueño externo (mismos que helpers.js
// excluye del cobro 3PL).
const OWN_CLIENTS = ['GENERAL', 'PROPIO'];

const norm = (c) => String(c ?? '').trim().toUpperCase();

// users.allowed_clients: 'ALL', un arreglo JSON (lo que guarda la pantalla de
// Usuarios: '["CLI-A","CLI-B"]') o una lista separada por comas (datos antiguos).
// null = sin restricción. Un JSON inválido no da acceso (falla cerrado).
function parseAllowedClients(raw) {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim();
  if (!s || s.toUpperCase() === 'ALL') return null;
  if (s.startsWith('[')) {
    try {
      const arr = JSON.parse(s);
      return Array.isArray(arr) ? arr.map(norm).filter(Boolean) : [];
    } catch { return []; }
  }
  return s.split(',').map(norm).filter(Boolean);
}

function computeScope(row, assigned) {
  if (FULL_ACCESS_ROLES.includes(row.role)) return { all: true, clients: [] };
  // 'none' (Sin acceso): ningún cliente, tampoco el stock propio de la bodega.
  if (row.client_scope === 'none') return { all: false, clients: [] };
  const v2 = row.client_scope === 'assigned' ? assigned.map(norm) : null;
  const csv = parseAllowedClients(row.allowed_clients);
  let eff;
  if (v2 === null && csv === null) eff = null;
  else if (v2 === null) eff = csv;
  else if (csv === null) eff = v2;
  else eff = v2.filter((c) => csv.includes(c));

  if (eff === null) {
    // Un usuario de cliente sin cliente asignado no ve nada (falla cerrado).
    if (row.role === 'CLIENTE') return { all: false, clients: [] };
    return { all: true, clients: [] };
  }
  const clients = [...new Set(eff)];
  // Una restricción explícita sin clientes no da acceso a nada.
  if (!clients.length) return { all: false, clients: [] };
  // El personal interno con alcance acotado opera también el stock propio de la bodega.
  if (row.role !== 'CLIENTE') for (const own of OWN_CLIENTS) if (!clients.includes(own)) clients.push(own);
  return { all: false, clients };
}

async function loadUserAuthz(username, db = pool) {
  const hit = cache.get(username);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const u = await db.query(
    `SELECT username, role, COALESCE(status, 'ACTIVE') AS status, client_scope, allowed_clients
       FROM users WHERE username = $1`,
    [username],
  );
  let value;
  if (!u.rows[0]) {
    value = { exists: false };
  } else {
    const row = u.rows[0];
    let assigned = [];
    if (row.client_scope === 'assigned') {
      const a = await db.query('SELECT client_id FROM user_clients WHERE username = $1', [username]);
      assigned = a.rows.map((r) => r.client_id);
    }
    value = { exists: true, role: row.role, status: row.status, scope: computeScope(row, assigned) };
  }
  cache.set(username, { at: Date.now(), value });
  return value;
}

/** Llamar al crear, editar, suspender o eliminar un usuario, o al cambiar sus clientes. */
function invalidateUser(username) {
  if (username) cache.delete(username);
  else cache.clear();
}

function clientAllowed(scope, clientId) {
  if (!scope || scope.all) return true;
  if (clientId === undefined || clientId === null || clientId === '') return false;
  return scope.clients.includes(norm(clientId));
}

/**
 * Agrega a una consulta el filtro de clientes del usuario. Devuelve el fragmento
 * SQL (vacío si ve todo) y deja el parámetro en `params`.
 *   const where = ['i.qty > 0']; const params = [];
 *   where.push(scopeCondition(req.clientScope, 'i.client_id', params));
 */
function scopeCondition(scope, column, params) {
  if (!scope || scope.all) return 'TRUE';
  params.push(scope.clients);
  return `${column} = ANY($${params.length}::text[])`;
}

/**
 * Filtro para audit_log (kardex). Muchas filas no traen client_id: se muestran solo
 * si el SKU es exclusivo de los clientes del usuario. Si el mismo código existe en
 * otro cliente, la fila sin dueño no se puede atribuir y queda oculta.
 */
function auditScopeCondition(scope, alias, params) {
  if (!scope || scope.all) return 'TRUE';
  params.push(scope.clients);
  const p = `$${params.length}::text[]`;
  return `(${alias}.client_id = ANY(${p}) OR (${alias}.client_id IS NULL AND ${alias}.sku IN (
            SELECT sku FROM master_skus WHERE client_id = ANY(${p})
            EXCEPT
            SELECT sku FROM master_skus WHERE NOT (client_id = ANY(${p})))))`;
}

module.exports = { parseAllowedClients, loadUserAuthz, invalidateUser, clientAllowed, scopeCondition, auditScopeCondition, computeScope, OWN_CLIENTS };
