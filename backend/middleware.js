const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { pool } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'wms-dev-secret-cambiar-en-produccion';

// ── AUTENTICACIÓN ────────────────────────────────────────────────────────────
const requireAuth = (req, res, next) => {
  const auth = req.headers['authorization'];
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'No autorizado — token requerido' });
  try { req.user = jwt.verify(auth.slice(7), JWT_SECRET); next(); }
  catch (e) { return res.status(401).json({ error: 'Token inválido o expirado. Vuelva a iniciar sesión.' }); }
};

// ── MODELO DE ROLES v2 — allowlist por gate (default DENEGAR) ─────────────────
// Jerarquía: SUPERADMIN > ADMIN > JEFE_BODEGA > EJECUTIVO_CUENTA > PICKER > {AUDITOR, CLIENTE}
// AUDITOR y CLIENTE son SOLO LECTURA: no figuran en ningún gate de escritura.
const requireRole = (allow, label) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'No autorizado' });
  if (!allow.includes(req.user.role))
    return res.status(403).json({ error: `Acción no permitida para el rol ${req.user.role}. Requiere: ${label}.` });
  next();
};

const requireSuperAdmin = requireRole(['SUPERADMIN'], 'SUPERADMIN');
const requireAdmin       = requireRole(['ADMIN', 'SUPERADMIN'], 'ADMIN+');
const requireJefe        = requireRole(['JEFE_BODEGA', 'ADMIN', 'SUPERADMIN'], 'JEFE_BODEGA+');
const requireStockWrite  = requireRole(['EJECUTIVO_CUENTA', 'JEFE_BODEGA', 'ADMIN', 'SUPERADMIN'], 'EJECUTIVO_CUENTA+');
const requirePicking     = requireRole(['PICKER', 'EJECUTIVO_CUENTA', 'JEFE_BODEGA', 'ADMIN', 'SUPERADMIN'], 'PICKER+');
// requireTransporte: escritura del MÓDULO DE TRANSPORTE. Rol especialista paralelo
// (COORDINADOR_TRANSPORTE) + ADMIN/SUPERADMIN. NO toca stock (ausente de
// requireStockWrite) ni confirma/cierra despachos (ausente de requireJefe).
const requireTransporte  = requireRole(['COORDINADOR_TRANSPORTE', 'ADMIN', 'SUPERADMIN'], 'COORDINADOR_TRANSPORTE+');
const requireReadOnly    = requireAuth; // cualquiera autenticado (lectura, sujeta a scope)

// Aliases de transición: las rutas aún no re-cableadas siguen importando estos
// nombres. Se eliminan en el PASO 2/3 cuando cada ruta apunte a su gate preciso.
//   requireJefeOrAbove   → requireJefe     (aprobaciones, ASN, docks, billing)
//   requireStaff         → requirePicking  (conteo cíclico)
//   requirePickerOrAbove → requirePicking  (cola de picking, solicitudes)
const requireJefeOrAbove = requireJefe;
const requireStaff = requirePicking;
const requirePickerOrAbove = requirePicking;

// Rango numérico de roles (para reglas "solo sobre rango estrictamente inferior").
// COORDINADOR_TRANSPORTE: especialista paralelo, rango 3 (como EJECUTIVO) para que
// JEFE_BODEGA+ pueda resetear su contraseña; lo gestionan/crean ADMIN+.
const ROLE_RANK = { CLIENTE: 1, AUDITOR: 1, PICKER: 2, EJECUTIVO_CUENTA: 3, COORDINADOR_TRANSPORTE: 3, JEFE_BODEGA: 4, ADMIN: 5, SUPERADMIN: 6 };
const rankOf = (role) => ROLE_RANK[role] || 0;

// requireResetPassword: JEFE_BODEGA+ puede resetear SOLO la contraseña de usuarios
// de rango ESTRICTAMENTE inferior (no toca rol ni scope). ADMIN/SUPERADMIN gestionan
// usuarios por completo vía requireAdmin.
const requireResetPassword = async (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'No autorizado' });
  if (!['JEFE_BODEGA', 'ADMIN', 'SUPERADMIN'].includes(req.user.role))
    return res.status(403).json({ error: 'Requiere rol JEFE_BODEGA o superior.' });
  const target = req.params.username || req.body?.username;
  if (!target) return res.status(400).json({ error: 'Falta el usuario objetivo.' });
  try {
    const t = await pool.query('SELECT role FROM users WHERE username=$1', [target]);
    if (!t.rows.length) return res.status(404).json({ error: 'Usuario no encontrado.' });
    if (rankOf(t.rows[0].role) >= rankOf(req.user.role))
      return res.status(403).json({ error: 'Solo puedes resetear contraseñas de usuarios de rango inferior al tuyo.' });
    req.resetTargetRole = t.rows[0].role;
    next();
  } catch (e) { return res.status(500).json({ error: 'Error al verificar el usuario objetivo.' }); }
};

// requireReauth (step-up): antes de una operación crítica (recepción/despacho) el
// usuario reingresa SU contraseña, validada contra su hash bcrypt. No emite token
// nuevo, solo confirma intención. Los usuarios demo se interceptan antes en
// apiDemoBlock, así que nunca llegan a este middleware.
const requireReauth = async (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'No autorizado' });
  const pw = req.body?.reauth_password || req.headers['x-reauth-password'];
  if (!pw) return res.status(401).json({ error: 'Re-autenticación requerida: ingresa tu contraseña para confirmar.', reauth: true });
  try {
    const u = await pool.query('SELECT password FROM users WHERE username=$1', [req.user.username]);
    if (!u.rows.length) return res.status(401).json({ error: 'Usuario no encontrado.', reauth: true });
    const ok = await bcrypt.compare(pw, u.rows[0].password || '');
    if (!ok) return res.status(401).json({ error: 'Contraseña incorrecta. Operación cancelada.', reauth: true });
    next();
  } catch (e) { return res.status(500).json({ error: 'Error al re-autenticar.' }); }
};

// ── RATE LIMITERS ────────────────────────────────────────────────────────────
// LOAD_TEST=1 bypassa todos los limiters (solo para pruebas internas, NUNCA en prod).
const LOAD_TEST = process.env.LOAD_TEST === '1';
const passthrough = (req, res, next) => next();
const mkLimiter = (opts) => LOAD_TEST ? passthrough : rateLimit(opts);
if (LOAD_TEST) console.warn('⚠️  [LOAD_TEST] Rate limiters DESACTIVADOS. No usar esta config en producción.');

// Limiters diferenciados por tipo de operación (ventana de 1 min, salvo login).
// - readLimiter:    800 req/min → GETs de consulta (inventory, stats, audit, listados).
// - writeLimiter:   400 req/min → POST/PUT/PATCH/DELETE genéricos.
// - stockWriteLimiter: 400 req/min → receive_batch, dispatch_batch, import masivos.
// - globalLimiter:  800 req/min → fallback para cualquier método/ruta no clasificada.
// - loginLimiter:    30 / 15 min → /api/login (mantiene ventana larga para forzar back-off).
const globalLimiter    = mkLimiter({ windowMs: 60 * 1000,      max: 800, standardHeaders: true, legacyHeaders: false, message: { error: 'Límite global superado (800 req/min). Espere unos segundos.' } });
const readLimiter      = mkLimiter({ windowMs: 60 * 1000,      max: 800, standardHeaders: true, legacyHeaders: false, message: { error: 'Límite de lecturas superado (800 req/min).' } });
const writeLimiter     = mkLimiter({ windowMs: 60 * 1000,      max: 400, standardHeaders: true, legacyHeaders: false, message: { error: 'Límite de escrituras superado (400 req/min). Espere antes de continuar.' } });
const loginLimiter     = mkLimiter({ windowMs: 15 * 60 * 1000, max: 30,  message: { error: 'Demasiados intentos de inicio de sesión.' } });
const portalLoginLimiter = mkLimiter({ windowMs: 15 * 60 * 1000, max: 20, message: { error: 'Demasiados intentos en el portal.' } });
const stockWriteLimiter = mkLimiter({ windowMs: 60 * 1000,      max: 400, message: { error: 'Demasiadas operaciones de stock (400 req/min). Espere unos segundos.' } });
// apiLimiter: alias retrocompatible para `app.use('/api', apiLimiter)` existente.
// Despacha al readLimiter o writeLimiter según el método HTTP de la request.
const apiLimiter = (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return readLimiter(req, res, next);
  return writeLimiter(req, res, next);
};

// ── MIDDLEWARE DE AUTORIZACIÓN PARA RUTAS /api ───────────────────────────────
// Rutas públicas que no requieren token. El resto pasa por requireAuth.
const apiAuthGate = (req, res, next) => {
  if (req.path === '/login') return next();
  if (req.method === 'GET' && req.path.startsWith('/templates/')) return next();
  if (req.path === '/portal/login') return next();
  if (req.path.startsWith('/portal/')) return next();
  if (req.path.startsWith('/v1/')) return next();
  if (req.path === '/demo/login') return next();
  if (req.method === 'GET' && req.path === '/demo/personas') return next();
  if (req.method === 'GET' && req.path === '/demo/sandbox-config') return next();
  // Banner pre-login: el frontend lo consulta antes de autenticarse.
  if (req.path === '/system/maintenance/check') return next();
  requireAuth(req, res, next);
};

// Validación allowed_clients: evita acceso cross-cliente.
// allowed_clients se guarda como string CSV: "CLIENTE_A,CLIENTE_B" o "ALL".
const apiClientScope = (req, res, next) => {
  if (!req.user) return next();
  if (['ADMIN', 'SUPERADMIN', 'DEMO'].includes(req.user.role)) return next();
  const ac = req.user.allowed_clients;
  if (!ac || ac === 'ALL') return next();
  const clientId = req.query.client_id || req.body?.client_id;
  if (clientId) {
    const allowed = ac.split(',').map(s => s.trim()).filter(Boolean);
    if (!allowed.includes(clientId)) {
      return res.status(403).json({ error: `Acceso denegado al cliente '${clientId}'.` });
    }
  }
  next();
};

// Bloqueo DEMO: intercepta escrituras del rol DEMO y devuelve respuesta simulada.
// Para endpoints conocidos, aplica una mutación a `sandbox-state` (sesión en memoria)
// para que el GET subsiguiente refleje el cambio.
const { getState, findWriteHandler } = require('./sandbox-state');
const apiDemoBlock = (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (!req.user || (req.user.role !== 'DEMO' && !req.user.is_demo)) return next();
  if (req.path === '/demo/feedback') return next();
  if (req.path === '/demo/reset') return next();
  if (req.path === '/demo/tutorial-progress') return next();
  // Control del propio sandbox (emiten un JWT nuevo, no mutan datos): deben llegar
  // al handler real en routes/demo.js, no a la respuesta de "acción simulada".
  if (req.path === '/demo/switch-role') return next();
  if (req.path === '/demo/switch-scenario') return next();
  // Intentar resolver un handler específico que mute el overlay
  const fullPath = '/api' + req.path;
  const handler = findWriteHandler(req.method, fullPath);
  if (handler) {
    const state = getState(req.user);
    const out = handler.fn(state, req.body || {}, handler.params);
    return res.json(out);
  }
  // Fallback: respuesta genérica de éxito simulado
  const fakeId = 'DEMO-' + Date.now();
  return res.json({
    demo: true, success: true,
    id: fakeId, returnId: fakeId, lpn: 'DEMO-LPN',
    raw_key: 'demo_key_••••••••_not_real',
    message: 'Modo demo: acción simulada, no se guardó nada.',
  });
};

// Roles de SOLO LECTURA (allowlist invertida explícita): CLIENTE y AUDITOR no
// pueden ejecutar NINGUNA escritura, sea cual sea la ruta. Reemplaza el filtro
// negativo `!== 'CLIENTE'` por una lista positiva de roles de solo lectura, y
// cierra de raíz la brecha por la que AUDITOR podía modificar stock.
const READ_ONLY_ROLES = ['CLIENTE', 'AUDITOR'];
const apiClienteReadOnly = (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (!req.user || !READ_ONLY_ROLES.includes(req.user.role)) return next();
  return res.status(403).json({ error: 'Acceso de solo lectura: tu rol no puede realizar modificaciones.' });
};

// ── Asignación de clientes por usuario (modo 3PL) ───────────────────────────
// getClientesPermitidos lee el scope del usuario y devuelve el set de clients
// permitidos. Cacheado en req.permitidosClientes para no consultar 2 veces.
const { pool: _pool } = require('./db');
async function getClientesPermitidos(username, db = _pool) {
  if (!username) return { scope: 'none', clients: [] };
  const u = await db.query(`SELECT role, client_scope FROM users WHERE username = $1`, [username]);
  if (!u.rows[0]) return { scope: 'none', clients: [] };
  const { role, client_scope } = u.rows[0];
  // ADMIN / SUPERADMIN siempre ven todo
  if (['ADMIN', 'SUPERADMIN'].includes(role) || client_scope === 'all') {
    const all = await db.query(`SELECT id FROM clients WHERE active = TRUE OR active IS NULL`);
    return { scope: 'all', clients: all.rows.map(r => r.id) };
  }
  if (client_scope === 'none') return { scope: 'none', clients: [] };
  // assigned
  const assigned = await db.query(`SELECT client_id FROM user_clients WHERE username = $1`, [username]);
  return { scope: 'assigned', clients: assigned.rows.map(r => r.client_id) };
}

// Helper: ¿el set de clientes permitidos incluye este id? (tolera mayúsc/minúsc).
function permIncludes(perm, cid) {
  if (!cid) return true;
  return perm.clients.includes(cid) || perm.clients.includes(String(cid).toUpperCase());
}

// checkClientAccess(mode, opts): middleware que bloquea operaciones de escritura
// sobre clientes que el usuario no tiene asignados. Si mode='read' pasa siempre.
//   opts.required: si true, rechaza la escritura cuando NO viene client_id
//                  específico (no se puede crear "para todos los clientes").
// Valida TODOS los client_id presentes (body.client_id + cada items[].client_id),
// no solo el primero, para cerrar la manipulación de peticiones por lote.
const checkClientAccess = (mode = 'write', opts = {}) => async (req, res, next) => {
  const { required = false } = opts;
  if (mode === 'read') return next();
  if (!req.user) return res.status(401).json({ error: 'No autenticado' });
  // SUPERADMIN/ADMIN siempre pasan sin tocar DB.
  if (['ADMIN', 'SUPERADMIN'].includes(req.user.role)) return next();
  // Demo: respeta su sandbox-state pero no aplica restricción de clientes.
  if (req.user.is_demo) return next();

  try {
    const perm = await getClientesPermitidos(req.user.username);
    req.permitidosClientes = perm;
    if (perm.scope === 'none') {
      return res.status(403).json({ error: 'Sin clientes asignados. Contactar al administrador.' });
    }
    // Recolectar todos los client_id explícitos de la petición.
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    const clientIds = [
      req.body?.client_id,
      req.params?.client_id,
      req.query?.client_id,
      ...items.map(it => it?.client_id || it?.clientId),
    ].filter(Boolean);
    if (clientIds.length === 0) {
      if (required) {
        return res.status(403).json({ error: 'Debes seleccionar un cliente específico para esta operación.' });
      }
      return next(); // sin client_id explícito → la validación fina queda a guardas por SKU/LPN
    }
    if (perm.scope === 'all') return next();
    const bad = [...new Set(clientIds)].filter(cid => !permIncludes(perm, cid));
    if (bad.length) {
      return res.status(403).json({
        error: `No tienes permiso para operar con el cliente ${bad.join(', ')}.`,
        tus_clientes: perm.clients,
      });
    }
    next();
  } catch (e) {
    console.error('[checkClientAccess]', e.message);
    return res.status(500).json({ error: 'Error al verificar permisos de cliente.' });
  }
};

// checkBatchSkuClientAccess: para lotes (recepción/despacho/ajuste/import) donde el
// cliente se deriva del SKU. Resuelve los client_id de los SKUs del body.items y
// valida que TODOS estén dentro del scope del usuario. ADMIN/JEFE(all) pasan.
const checkBatchSkuClientAccess = () => async (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'No autenticado' });
  if (['ADMIN', 'SUPERADMIN'].includes(req.user.role) || req.user.is_demo) return next();
  try {
    const perm = req.permitidosClientes || await getClientesPermitidos(req.user.username);
    req.permitidosClientes = perm;
    if (perm.scope === 'all') return next();
    if (perm.scope === 'none') return res.status(403).json({ error: 'Sin clientes asignados. Contactar al administrador.' });
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    const skus = [...new Set(items.map(it => it?.sku).filter(Boolean).map(String))];
    if (skus.length === 0) return next();
    const r = await pool.query('SELECT DISTINCT client_id FROM master_skus WHERE sku = ANY($1)', [skus]);
    const cids = r.rows.map(x => x.client_id || 'GENERAL');
    const bad = [...new Set(cids)].filter(c => c !== 'GENERAL' && !permIncludes(perm, c));
    if (bad.length) {
      return res.status(403).json({ error: `No tienes permiso para operar con SKUs del cliente ${bad.join(', ')}.`, tus_clientes: perm.clients });
    }
    next();
  } catch (e) {
    console.error('[checkBatchSkuClientAccess]', e.message);
    return res.status(500).json({ error: 'Error al verificar permisos de cliente (SKU).' });
  }
};

// checkLpnClientAccess: para operaciones por-LPN (reubicación, cambio de estado)
// donde el cliente se deriva del LPN (body.id). Valida que el LPN pertenezca a un
// cliente dentro del scope del usuario.
const checkLpnClientAccess = (idField = 'id') => async (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'No autenticado' });
  if (['ADMIN', 'SUPERADMIN'].includes(req.user.role) || req.user.is_demo) return next();
  try {
    const perm = req.permitidosClientes || await getClientesPermitidos(req.user.username);
    req.permitidosClientes = perm;
    if (perm.scope === 'all') return next();
    if (perm.scope === 'none') return res.status(403).json({ error: 'Sin clientes asignados. Contactar al administrador.' });
    const lpnId = req.body?.[idField] || req.params?.[idField];
    if (!lpnId) return next();
    const r = await pool.query('SELECT client_id FROM inventory_lpns WHERE id = $1 LIMIT 1', [lpnId]);
    const cid = r.rows[0]?.client_id || 'GENERAL';
    if (cid !== 'GENERAL' && !permIncludes(perm, cid)) {
      return res.status(403).json({ error: `No tienes permiso para operar con el LPN ${lpnId} (cliente ${cid}).`, tus_clientes: perm.clients });
    }
    next();
  } catch (e) {
    console.error('[checkLpnClientAccess]', e.message);
    return res.status(500).json({ error: 'Error al verificar permisos de cliente (LPN).' });
  }
};

// ── LICENCIA: expiración ─────────────────────────────────────────────────────
// Estado de la licencia cacheado 60s (la fecha la fija el SUPERADMIN en system_config
// como `license_expiry` = 'YYYY-MM-DD'). Vence al FINAL del día indicado.
let _licCache = { at: 0, val: null };
async function getLicenseStatus() {
  if (_licCache.val && Date.now() - _licCache.at < 60000) return _licCache.val;
  let val = { expiry: null, expired: false, daysLeft: null };
  try {
    const r = await pool.query("SELECT value FROM system_config WHERE key = 'license_expiry'");
    const raw = r.rows[0]?.value;
    if (raw) {
      const exp = new Date(raw + 'T23:59:59');
      if (!isNaN(exp.getTime())) {
        const now = new Date();
        val = { expiry: raw, expired: now > exp, daysLeft: Math.ceil((exp - now) / 86400000) };
      }
    }
  } catch (e) { /* ante error de lectura, no bloquear */ }
  _licCache = { at: Date.now(), val };
  return val;
}

// Bloqueo por licencia vencida: con la licencia vencida, los no-SUPERADMIN no pueden
// ESCRIBIR (sistema en solo lectura) hasta renovar. SUPERADMIN sí, para renovarla.
const apiLicenseGate = async (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (!req.user || req.user.role === 'SUPERADMIN') return next();
  try {
    const lic = await getLicenseStatus();
    if (lic.expired) return res.status(403).json({ error: `Licencia vencida el ${lic.expiry}. El sistema está en solo lectura hasta renovarla; contacte al proveedor.`, license_expired: true });
  } catch (e) { /* no bloquear ante error */ }
  next();
};

module.exports = {
  JWT_SECRET,
  getLicenseStatus,
  apiLicenseGate,
  requireAuth,
  requireReadOnly,
  requireAdmin,
  requireSuperAdmin,
  // Gates v2 (allowlist)
  requireJefe,
  requireStockWrite,
  requirePicking,
  requireTransporte,
  requireResetPassword,
  requireReauth,
  // Aliases de transición (se retiran al re-cablear rutas)
  requirePickerOrAbove,
  requireStaff,
  requireJefeOrAbove,
  globalLimiter,
  apiLimiter,
  readLimiter,
  writeLimiter,
  loginLimiter,
  portalLoginLimiter,
  stockWriteLimiter,
  apiAuthGate,
  apiClientScope,
  apiDemoBlock,
  apiClienteReadOnly,
  getClientesPermitidos,
  permIncludes,
  checkClientAccess,
  checkBatchSkuClientAccess,
  checkLpnClientAccess,
};
