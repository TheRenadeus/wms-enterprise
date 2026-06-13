const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');

const JWT_SECRET = process.env.JWT_SECRET || 'wms-dev-secret-cambiar-en-produccion';

// ── AUTENTICACIÓN ────────────────────────────────────────────────────────────
const requireAuth = (req, res, next) => {
  const auth = req.headers['authorization'];
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'No autorizado — token requerido' });
  try { req.user = jwt.verify(auth.slice(7), JWT_SECRET); next(); }
  catch (e) { return res.status(401).json({ error: 'Token inválido o expirado. Vuelva a iniciar sesión.' }); }
};

const requireAdmin = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'No autorizado' });
  if (!['ADMIN', 'SUPERADMIN'].includes(req.user.role)) return res.status(403).json({ error: 'Requiere rol ADMIN o superior.' });
  next();
};

const requireSuperAdmin = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'No autorizado' });
  if (req.user.role !== 'SUPERADMIN') return res.status(403).json({ error: 'Requiere rol SUPERADMIN.' });
  next();
};

const requirePickerOrAbove = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'No autorizado' });
  if (!['CLIENTE', 'PICKER', 'OPERARIO', 'SUPERVISOR', 'EJECUTIVO_CUENTA', 'AUDITOR', 'ADMIN', 'SUPERADMIN'].includes(req.user.role))
    return res.status(403).json({ error: 'Requiere rol PICKER o superior.' });
  next();
};

// Staff: todos los roles internos EXCEPTO CLIENTE. Usar en conteos cíclicos.
const requireStaff = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'No autorizado' });
  if (!['PICKER', 'OPERARIO', 'SUPERVISOR', 'EJECUTIVO_CUENTA', 'AUDITOR', 'ADMIN', 'SUPERADMIN'].includes(req.user.role))
    return res.status(403).json({ error: 'Acceso restringido a personal interno.' });
  next();
};

const requireJefeOrAbove = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'No autorizado' });
  if (!['SUPERVISOR', 'EJECUTIVO_CUENTA', 'ADMIN', 'SUPERADMIN'].includes(req.user.role))
    return res.status(403).json({ error: 'Requiere rol EJECUTIVO DE CUENTA o superior.' });
  next();
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

// Bloqueo CLIENTE: solo lectura para el rol CLIENTE.
const apiClienteReadOnly = (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (!req.user || req.user.role !== 'CLIENTE') return next();
  return res.status(403).json({ error: 'Acceso de solo lectura. Los usuarios CLIENTE no pueden realizar modificaciones.' });
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

// checkClientAccess(mode): middleware que bloquea operaciones de escritura sobre
// clientes que el usuario no tiene asignados. Si mode='read' pasa siempre.
// Extrae el client_id desde body, items[0], params o query.
const checkClientAccess = (mode = 'write') => async (req, res, next) => {
  if (mode === 'read') return next();
  if (!req.user) return res.status(401).json({ error: 'No autenticado' });
  // SUPERADMIN/ADMIN siempre pasan sin tocar DB.
  if (['ADMIN', 'SUPERADMIN'].includes(req.user.role)) return next();
  // Demo: respeta su sandbox-state pero no aplica restricción de clientes.
  if (req.user.is_demo) return next();

  try {
    const perm = await getClientesPermitidos(req.user.username);
    req.permitidosClientes = perm;
    if (perm.scope === 'all') return next();
    if (perm.scope === 'none') {
      return res.status(403).json({ error: 'Sin clientes asignados. Contactar al administrador.' });
    }
    // Detectar client_id desde varias fuentes
    let clientId =
      req.body?.client_id ||
      (Array.isArray(req.body?.items) && req.body.items[0]?.client_id) ||
      (Array.isArray(req.body?.items) && req.body.items[0]?.clientId) ||
      req.params?.client_id ||
      req.query?.client_id ||
      null;
    if (!clientId) return next(); // sin client_id explícito → no aplica
    if (!perm.clients.includes(String(clientId).toUpperCase()) && !perm.clients.includes(clientId)) {
      return res.status(403).json({
        error: `No tienes permiso para operar con el cliente ${clientId}.`,
        tus_clientes: perm.clients,
      });
    }
    next();
  } catch (e) {
    console.error('[checkClientAccess]', e.message);
    return res.status(500).json({ error: 'Error al verificar permisos de cliente.' });
  }
};

module.exports = {
  JWT_SECRET,
  requireAuth,
  requireAdmin,
  requireSuperAdmin,
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
  checkClientAccess,
};
