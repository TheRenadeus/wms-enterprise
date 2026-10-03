require('dotenv').config();
const express = require('express');
const cors = require('cors');

const { pool } = require('./db');
const { getSandboxResponse } = require('./sandbox-data');
const { runMigrations } = require('./migrations');
const migrationList = require('./migrations/list');
const { invalidate: cacheInvalidate } = require('./cache');
const { apiErrorHandler } = require('./errorHandler');
const authRouter = require('./routes/auth');
const notificationsRouter = require('./routes/notifications');
const inventoryRouter = require('./routes/inventory');
const skusRouter = require('./routes/skus');
const mastersRouter = require('./routes/masters');
const usersRouter = require('./routes/users');
const clientsRouter = require('./routes/clients');
const returnsRouter = require('./routes/returns');
const asnsRouter = require('./routes/asns');
const pickWavesRouter = require('./routes/pick-waves');
const demoRouter = require('./routes/demo');
const locationsRouter = require('./routes/locations');
const cycleCountRouter = require('./routes/cycle-count');
const pickTasksRouter = require('./routes/pick-tasks');
const docksRouter = require('./routes/docks');
const reportsRouter = require('./routes/reports');
const purchaseOrdersRouter = require('./routes/purchase-orders');
const backupsRouter = require('./routes/backups');
const feedbackRouter = require('./routes/feedback');
const manufacturersRouter = require('./routes/manufacturers');
const substitutesRouter = require('./routes/substitutes');
const insumosRouter = require('./routes/insumos');
const kittingRouter = require('./routes/kitting');
const exportsRouter = require('./routes/exports');
const importsRouter = require('./routes/imports');
const inventoryOpsRouter = require('./routes/inventory-ops');
const billingRouter = require('./routes/billing');
const systemRouter = require('./routes/system');
const portalRouter = require('./routes/portal');
const carriersRouter = require('./routes/carriers');
const apiKeysRouter = require('./routes/api-keys');
const relocateRequestsRouter = require('./routes/relocate-requests');
const dispatchSchedulesRouter = require('./routes/dispatch-schedules');
const docHistoryRouter = require('./routes/doc-history');
const transporteRouter = require('./routes/transporte');
const {
  globalLimiter,
  apiLimiter,
  apiAuthGate,
  apiLicenseGate,
  apiClientScope,
  apiDemoBlock,
  apiClienteReadOnly,
} = require('./middleware');

const path = require('path');
const fs = require('fs');
const app = express();
app.set('trust proxy', 1); // Necesario para rate-limit detrás de ngrok/nginx

// JWT_SECRET: fatal en producción, advertencia en desarrollo
if (!process.env.JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    console.error('❌ [SEGURIDAD] JWT_SECRET no configurado. Abortando inicio en modo producción.');
    process.exit(1);
  }
  console.warn('⚠️  [SEGURIDAD] JWT_SECRET no configurado — se usa un secreto aleatorio temporal (las sesiones se cierran al reiniciar). Defínelo en el .env.');
}

app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || '*',
  methods: ['GET','POST','PUT','PATCH','DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Portal-Token', 'X-API-Key']
}));
app.use(express.json({ limit: '20mb' }));
app.use((req, res, next) => { res.setHeader('ngrok-skip-browser-warning', 'true'); next(); });

// /health: liveness + readiness para orchestrators (docker-compose, k8s, ngrok).
// Va antes del rate limiter para que healthchecks frecuentes no se bloqueen.
// 200 = OK, 503 = degradado/sin BD.
const APP_STARTED_AT = Date.now();
app.get('/health', async (req, res) => {
  const out = { status: 'ok', uptime_s: Math.round((Date.now() - APP_STARTED_AT) / 1000), db: 'unknown', version: process.env.APP_VERSION || 'dev' };
  try {
    const t0 = Date.now();
    await pool.query('SELECT 1');
    out.db = 'ok';
    out.db_latency_ms = Date.now() - t0;
    return res.status(200).json(out);
  } catch (err) {
    out.status = 'degraded';
    out.db = 'down';
    out.db_error = err.code || err.message;
    return res.status(503).json(out);
  }
});

app.use(globalLimiter);
// apiLimiter (100/min) antes del auth gate: protege también el verificador de JWT.
app.use('/api', apiLimiter);
app.use('/api', apiAuthGate);
// Bloqueo por licencia vencida (escrituras de no-SUPERADMIN). Va tras el auth gate
// (necesita req.user). El SUPERADMIN pasa para poder renovar.
app.use('/api', apiLicenseGate);

// Invalidación automática de cache de maestros tras writes exitosos (P9).
// Se evalúa al cierre de la respuesta para no invalidar si la operación falló.
const CACHE_INVALIDATION_MAP = [
  { match: (path) => path.startsWith('/api/locations'),       key: 'locations:all' },
  { match: (path) => path.startsWith('/api/statuses'),        key: 'statuses:all' },
  { match: (path) => path.startsWith('/api/document_types'),  key: 'document_types:all' },
];
app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  res.on('finish', () => {
    if (res.statusCode >= 400) return;
    // req.path en este middleware ya incluye el prefijo /api (depende del setup); usamos originalUrl sin query.
    const fullPath = (req.originalUrl || req.path).split('?')[0];
    for (const rule of CACHE_INVALIDATION_MAP) {
      if (rule.match(fullPath)) cacheInvalidate(rule.key);
    }
  });
  next();
});
app.use('/api', apiClientScope);
app.use('/api', apiDemoBlock);
// Sandbox: interceptar GETs de usuarios demo y devolver datos simulados (con overlay
// de mutaciones registradas por POST/PUT/DELETE de la misma sesión).
app.use('/api', (req, res, next) => {
  if (req.method !== 'GET') return next();
  if (!req.user || !req.user.is_demo) return next();
  const fullPath = '/api' + req.path;
  const data = getSandboxResponse(fullPath, req.user.sandbox_scenario, req.user);
  if (data !== null) return res.json(data);
  next();
});
app.use('/api', apiClienteReadOnly);

// ── BOOTSTRAP: migraciones versionadas + arranque de alertas ─────────────────
// El schema vive en backend/migrations/*.js. Añadir una migración nueva es
// crear un archivo 00N_nombre.js y registrarlo en migrations/list.js.
// Recuperación ante fallo total: si tras migrar la tabla `users` está vacía y
// existe un backup en disco, se avisa (con el comando de restore) o, si
// AUTO_RECOVER=1, se restaura automáticamente el backup más reciente. Esto cubre
// el caso en que la BD se perdió/recreó y no se puede usar el restore por la UI.
const checkDisasterRecovery = async () => {
  try {
    const u = await pool.query('SELECT COUNT(*)::int AS n FROM users');
    if (u.rows[0].n > 0) return; // hay datos → nada que recuperar
    const { BACKUPS_DIR, aplicarRestore } = backupsRouter;
    if (!BACKUPS_DIR || !fs.existsSync(BACKUPS_DIR)) return;
    const backups = fs.readdirSync(BACKUPS_DIR)
      .filter(f => /^wms_backup_.*\.json$/.test(f))
      .map(f => ({ f, m: fs.statSync(path.join(BACKUPS_DIR, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m);
    if (!backups.length) return; // sin backups, nada que hacer
    const latest = backups[0].f;

    if (process.env.AUTO_RECOVER === '1') {
      console.warn(`⚠️  [RECOVERY] users vacía y AUTO_RECOVER=1 → restaurando ${latest}...`);
      const payload = JSON.parse(fs.readFileSync(path.join(BACKUPS_DIR, latest), 'utf8'));
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rowsInserted } = await aplicarRestore(client, payload.tables || {});
        await client.query('COMMIT');
        console.log(`✅ [RECOVERY] Restauración automática completa desde ${latest} (${rowsInserted} filas).`);
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('❌ [RECOVERY] Falló la restauración automática:', e.message);
      } finally { client.release(); }
    } else {
      console.warn('────────────────────────────────────────────────────────');
      console.warn('⚠️  [RECOVERY] La tabla `users` está VACÍA — posible fallo total de datos.');
      console.warn(`   Backup disponible: ${latest}`);
      console.warn('   Restaurar:  cd backend && node recover.js --yes');
      console.warn('   (o arranca con AUTO_RECOVER=1 para restaurar solo al iniciar)');
      console.warn('────────────────────────────────────────────────────────');
    }
  } catch (e) { /* users puede no existir en el primerísimo arranque; ignorar */ }
};

// SUPERADMIN fijo: garantiza que la cuenta de superadmin definida en .env
// (SUPERADMIN_USER/HASH) exista SIEMPRE. Se re-crea automáticamente tras un
// formateo/wipe de la BD, así que el acceso de superadmin nunca se pierde.
// Idempotente: si ya existe, no la toca (respeta cambios de contraseña hechos
// luego desde la app — solo re-siembra cuando falta por completo).
const ensureSuperadmin = async () => {
  const user = process.env.SUPERADMIN_USER;
  const hash = process.env.SUPERADMIN_HASH;
  if (!user || !hash) return; // no configurado → nada que sembrar
  try {
    const exists = await pool.query('SELECT 1 FROM users WHERE username=$1', [user]);
    if (exists.rows.length) return;
    await pool.query(
      `INSERT INTO users (username, password, role, status, full_name, allowed_clients, allowed_modules, client_scope)
       VALUES ($1, $2, 'SUPERADMIN', 'ACTIVE', $3, $4, $5, 'all')`,
      [user, hash, process.env.SUPERADMIN_FULLNAME || 'Administrador del Sistema',
       process.env.SUPERADMIN_ALLOWED_CLIENTS || 'ALL', process.env.SUPERADMIN_ALLOWED_MODULES || 'ALL']
    );
    console.log(`🔐 [SUPERADMIN] Cuenta fija '${user}' re-creada (no existía tras formateo/arranque).`);
  } catch (e) { console.error('[SUPERADMIN] No se pudo asegurar la cuenta fija:', e.message); }
};

const bootstrap = async (retries = 6, delay = 3000) => {
  try {
    await pool.query('SELECT 1');
    await runMigrations(pool, migrationList);
    await checkDisasterRecovery();
    await ensureSuperadmin();
    console.log('✅ Base de Datos V11.0 iniciada correctamente');
    setTimeout(generateAlerts, 5000);
    setInterval(generateAlerts, 60 * 60 * 1000);
  } catch (err) {
    if (retries > 0) {
      console.log(`⏳ DB no disponible, reintentando en ${Math.round(delay/1000)}s... (${retries} intentos restantes): ${err.message}`);
      await new Promise(r => setTimeout(r, delay));
      return bootstrap(retries - 1, Math.min(delay * 1.5, 15000));
    }
    console.error('❌ No se pudo conectar a la BD después de varios intentos:', err.message);
    process.exit(1);
  }
};

// ── ROUTERS EXTRAÍDOS (P7) ──────────────────────────────────────────────────
// El resto de endpoints sigue inline en este archivo (TODO router: docks,
// shipments, reports, system, demo, portal, v1, pick-tasks, kit, returns, etc).
app.use('/api', authRouter);          // /login, /login-history
app.use('/api', notificationsRouter); // /notifications/*
app.use('/api', inventoryRouter);     // /inventory, /audit
app.use('/api', skusRouter);          // /skus, /bootstrap
app.use('/api', mastersRouter);       // /locations GET, /statuses GET, /document_types GET
app.use('/api', usersRouter);         // /users (GET/POST/DELETE)
app.use('/api', clientsRouter);       // /clients (GET/POST/DELETE)
app.use('/api', returnsRouter);       // /returns (POST/GET), /returns/:id/inspect, /returns/create
app.use('/api', asnsRouter);          // /suppliers, /asns (+ /asns/:id/receive)
app.use('/api', pickWavesRouter);     // /pick-waves (+ release/close/available-lines)
app.use('/api', demoRouter);          // /demo/* (sandbox-config, login, switch-role, switch-scenario, feedback)
app.use('/api', locationsRouter);     // /locations (POST/PUT/DELETE + bulk)
app.use('/api', cycleCountRouter);    // /cycle-count/*, /adjust-request, /adjust-requests/*
app.use('/api', pickTasksRouter);     // /pick-tasks/*, /picker/* (queue, start, confirm, skip)
app.use('/api', docksRouter);         // /docks, /dock-appointments
app.use('/api', reportsRouter);       // /reports/*, /report/occupation, /report/resources, /stats/dispatch-kpis, /stats/weekly-dispatch
app.use('/api', purchaseOrdersRouter); // /purchase-orders/*
app.use('/api', backupsRouter);        // /system/backup, /system/backups/*
app.use('/api', feedbackRouter);       // /feedback (sugerencias del staff)
app.use('/api', manufacturersRouter);  // /manufacturers (CRUD)
app.use('/api', substitutesRouter);    // /skus/:sku/substitutes + /skus/substitutes
app.use('/api', insumosRouter);        // /insumos (maestro), /insumos/* (movimientos, consumo)
app.use('/api', kittingRouter);        // /kitting/receta, /kitting/recetas, /kitting/ordenes (v2)
app.use('/api', transporteRouter);     // /transporte/* (maestros: transportistas, vehiculos, choferes, pionetas, clientes)
app.use('/api', exportsRouter);        // /export/skus, /export/clients, /export/inventory
app.use('/api', importsRouter);        // /templates/:type, /import/* (preview, validate, skus, clients, inventory, receive, dispatch)
app.use('/api', inventoryOpsRouter);    // /inventory/status, /receive_batch, /dispatch_batch, /adjust_batch, /relocate, /inventory/bulk-load, /inventory/history, /inventory/snapshot, /inventory/fefo, /processed-docs/exists
app.use('/api', billingRouter);         // /storage/register-event, /report/billing, /analytics/*, /billing/*, /client-tariffs, /invoices/*
app.use('/api', systemRouter);          // /system/config, /system/maintenance/check, /system/metrics, /system/users/*, /system/inventory, /system/audit, /system/factory-reset, /system/promote
app.use('/api', portalRouter);          // /portal/*, /clients/:id/portal
app.use('/api', carriersRouter);        // /carriers, /shipments
app.use('/api', apiKeysRouter);         // /keys, /v1/*
app.use('/api', relocateRequestsRouter); // /relocate-requests
app.use('/api', dispatchSchedulesRouter); // /dispatch-schedules
app.use('/api', docHistoryRouter);        // /document-history, /anulation-requests

// /api/stats (genérico) sigue inline.
// GET /stats -> routes/reports.js (COD-02)
// /api/inventory, /api/audit, /api/skus, /api/bootstrap → routes/inventory.js, routes/skus.js
// /api/clients (GET/POST/DELETE) → routes/clients.js
// /api/document_types GET → routes/masters.js
// /api/statuses GET → routes/masters.js
// /api/users (GET/POST/DELETE) → routes/users.js
// /api/kits, /api/kit-build, /api/kits/build, /api/kits/direct-dispatch,
// /api/kit-orders, /api/kit-availability, /api/kits/:kit_sku/:client_id/availability
//   → routes/kits.js
// /api/login y /api/login-history → routes/auth.js

// Escrituras de document_types/statuses -> routes/masters.js (COD-02)

// /api/clients (POST/DELETE) → routes/clients.js

// Escrituras de SKU (POST/PUT/DELETE, versiones) -> routes/skus.js (COD-02)

// /api/locations writes (+ bulk) → routes/locations.js

// Transiciones de estado permitidas
// Escrituras de inventario (status, receive/dispatch/adjust_batch, relocate, bulk-load) -> routes/inventory-ops.js (COD-02)

// ============ CSV EXPORT / IMPORT MASIVO -> routes/exports.js, routes/imports.js (COD-02) ============


// GET /inventory/history -> routes/inventory-ops.js (COD-02)

// ============ MODO OPERACIÓN (3PL / PROPIO / HÍBRIDO) ============
// Defaults de modo bootstrap → cubiertos por migración 001_initial.

// Registrar eventos de almacenaje automáticamente
// Storage events, reporte de cobro 3PL, analytics, facturas/invoices -> routes/billing.js (COD-02)

// ============ CONFIGURACIÓN GLOBAL SISTEMA ============
// Defaults de system_config bootstrap → cubiertos por migración 001_initial.

// GET/POST /system/config, POST /system/maintenance/check -> routes/system.js (COD-02)

// ============ ÓRDENES DE COMPRA ============

// ============ HISTORIAL DOCUMENTOS CERRADOS ============
// POST/GET /document-history -> routes/doc-history.js (COD-02)

// Barcode lookup, sku-resources, alertas de stock, historial de LPN -> routes/skus.js e inventory-ops.js (COD-02)

// ============ STOCK SNAPSHOT POR FECHA ============
// GET /inventory/snapshot -> routes/inventory-ops.js (COD-02)


// ============ CONTEOS CÍCLICOS → routes/cycle-count.js ============

// ============ REPORTE OCUPACIÓN POR ZONA ============

// ============ DEVOLUCIONES → routes/returns.js ============

// ============ SUPERADMIN ============

// Métricas del sistema
// Operaciones SUPERADMIN (metrics, passwords stub, borrado directo, factory-reset, promote, audit edit) -> routes/system.js (COD-02)

// Portal de clientes (login propio + inventario/movimientos/reportes) -> routes/portal.js (COD-02)
// ═══════════════════════════════════════════════════════════════════════════
// ── NOTIFICACIONES ─────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

const generateAlerts = async () => {
  try {
    const lowStock = await pool.query(
      `SELECT m.sku,m.client_id,m."desc",m.stock_min,COALESCE(SUM(i.qty),0) as current_stock FROM master_skus m LEFT JOIN inventory_lpns i ON m.sku=i.sku AND m.client_id=i.client_id AND i.qty>0 WHERE m.stock_min IS NOT NULL AND m.stock_min>0 GROUP BY m.sku,m.client_id,m."desc",m.stock_min HAVING COALESCE(SUM(i.qty),0)<m.stock_min`
    );
    for (const r of lowStock.rows) {
      const ex = await pool.query(`SELECT id FROM notifications WHERE type='STOCK_MIN' AND sku=$1 AND client_id=$2 AND read=FALSE`, [r.sku, r.client_id]);
      if (!ex.rows.length) await pool.query(`INSERT INTO notifications(type,title,message,client_id,sku,severity) VALUES($1,$2,$3,$4,$5,$6)`,
        ['STOCK_MIN', `Stock mínimo: ${r.sku}`, `Stock actual ${r.current_stock} < mínimo ${r.stock_min} — ${r.desc||r.sku}`, r.client_id, r.sku, 'WARNING']);
    }
    const exp30 = await pool.query(`SELECT DISTINCT sku,client_id,expiry_date FROM inventory_lpns WHERE expiry_date IS NOT NULL AND expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE+30 AND qty>0`);
    for (const r of exp30.rows) {
      const ex = await pool.query(`SELECT id FROM notifications WHERE type='EXPIRY_30' AND sku=$1 AND read=FALSE`, [r.sku]);
      if (!ex.rows.length) await pool.query(`INSERT INTO notifications(type,title,message,client_id,sku,severity) VALUES($1,$2,$3,$4,$5,$6)`,
        ['EXPIRY_30', `Vencimiento próximo: ${r.sku}`, `Lote vence el ${r.expiry_date} (dentro de 30 días)`, r.client_id, r.sku, 'WARNING']);
    }
    const exp7 = await pool.query(`SELECT DISTINCT sku,client_id,expiry_date FROM inventory_lpns WHERE expiry_date IS NOT NULL AND expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE+7 AND qty>0`);
    for (const r of exp7.rows) {
      const ex = await pool.query(`SELECT id FROM notifications WHERE type='EXPIRY_7' AND sku=$1 AND read=FALSE`, [r.sku]);
      if (!ex.rows.length) await pool.query(`INSERT INTO notifications(type,title,message,client_id,sku,severity) VALUES($1,$2,$3,$4,$5,$6)`,
        ['EXPIRY_7', `URGENTE vencimiento: ${r.sku}`, `Lote vence el ${r.expiry_date} — quedan 7 días o menos`, r.client_id, r.sku, 'CRITICAL']);
    }
    const expired = await pool.query(`SELECT DISTINCT sku,client_id,expiry_date FROM inventory_lpns WHERE expiry_date IS NOT NULL AND expiry_date<CURRENT_DATE AND qty>0`);
    for (const r of expired.rows) {
      const ex = await pool.query(`SELECT id FROM notifications WHERE type='EXPIRED' AND sku=$1 AND read=FALSE`, [r.sku]);
      if (!ex.rows.length) await pool.query(`INSERT INTO notifications(type,title,message,client_id,sku,severity) VALUES($1,$2,$3,$4,$5,$6)`,
        ['EXPIRED', `VENCIDO: ${r.sku}`, `Lote venció el ${r.expiry_date} — requiere atención urgente`, r.client_id, r.sku, 'CRITICAL']);
    }
  } catch(e) { console.error('generateAlerts:', e.message); }
};

// /api/notifications/* → routes/notifications.js

// ═══════════════════════════════════════════════════════════════════════════
// Transporte: carriers + shipments -> routes/carriers.js (COD-02)

// Gestion de API Keys + API publica v1 -> routes/api-keys.js (COD-02)


// ═══════════════════════════════════════════════════════════════════════════
// ── KITTING — BUILD Y DISPONIBILIDAD → routes/kits.js ──────────────────────
// ═══════════════════════════════════════════════════════════════════════════
// (Bloque movido a routes/kits.js — se mantiene un placeholder para que el
//  diff sea legible, eliminar en próxima limpieza.)

// ── KPIs DE DESPACHO ──────────────────────────────────────────────────────────

// ═══════════════════════════════════════════════════════════════════════════
// Solicitudes de reubicacion con aprobacion -> routes/relocate-requests.js (COD-02)

// ══════════════════════════════════════════════════════════════════════════════
// SISTEMA 1 — PROVEEDORES + ASN → routes/asns.js
// SISTEMA 2 — OLAS DE PICKING → routes/pick-waves.js
// ══════════════════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════════════════
// SISTEMA 4 — DEVOLUCIONES MEJORADAS → routes/returns.js
// ══════════════════════════════════════════════════════════════════════════════

// Invoices (facturas 3PL): GET/generate/issue/pay/DELETE -> routes/billing.js (COD-02, ya movido, esto era codigo duplicado)

// ══════════════════════════════════════════════════════════════════════════════
// SISTEMA 7 — REPORTERÍA AVANZADA
// ══════════════════════════════════════════════════════════════════════════════
// Antigüedad de inventario (días en bodega por LPN)

// ══════════════════════════════════════════════════════════════════════════════
// FEFO: sugerencia de LPNs ordenados por vencimiento (para despacho)
// ══════════════════════════════════════════════════════════════════════════════
// GET /inventory/fefo/:sku -> routes/inventory-ops.js (COD-02)

// ── SOLICITUDES DE AJUSTE → routes/cycle-count.js ────────────────────────────

// ── DEMO SANDBOX → routes/demo.js ────────────────────────────────────────────

// POST /system/users/reset-password -> routes/system.js (COD-02)

// Programacion de salidas (calendario de despachos) -> routes/dispatch-schedules.js (COD-02)

// Anulaciones de documentos (void directo + solicitud con aprobacion) -> routes/doc-history.js (COD-02)

// 404 JSON limpio para rutas /api/* no implementadas (antes del catch-all estático)
app.all('/api/*', (req, res) => {
  res.status(404).json({ error: `Endpoint no encontrado: ${req.method} ${req.path}` });
});

// Error handler centralizado (P7): captura excepciones no manejadas.
// Express identifica handlers de error por la firma (4 args, err primero).
app.use(apiErrorHandler);

// Servir frontend estático desde el build (solo si existe)
const frontendPath = path.join(__dirname, '..', 'frontend', 'build');
app.use(express.static(frontendPath, {
  maxAge: '1y',
  etag: true,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  },
}));
app.get('*', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(frontendPath, 'index.html'), (err) => {
    if (err) res.status(404).send('Not found');
  });
});

bootstrap().then(() => {
  app.listen(3000, '0.0.0.0', () => console.log('🚀 API V10.0 ONLINE'));
});
