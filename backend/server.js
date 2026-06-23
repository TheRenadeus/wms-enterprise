require('dotenv').config();
const express = require('express');
const cors = require('cors');
const XLSX = require('xlsx');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

const { pool, mapDbError, sendDbError, isUniqueViolation } = require('./db');
const { getSandboxResponse } = require('./sandbox-data');
const { runMigrations } = require('./migrations');
const migrationList = require('./migrations/list');
const { cached, invalidate: cacheInvalidate } = require('./cache');
const { parsePagination, setPaginationHeaders } = require('./pagination');
const { validateBody, schemas } = require('./schemas');
const { genLpnId: genLpnIdFromHelpers, logStorageEvent } = require('./helpers');
const { consumeComponentTracked } = require('./kitConsumo');
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
const transporteRouter = require('./routes/transporte');
const {
  JWT_SECRET,
  requireAuth,
  requireAdmin,
  requireSuperAdmin,
  requireJefe,
  requireStockWrite,
  requirePicking,
  requireReauth,
  requirePickerOrAbove,
  requireJefeOrAbove,
  checkClientAccess,
  checkBatchSkuClientAccess,
  checkLpnClientAccess,
  getClientesPermitidos,
  globalLimiter,
  apiLimiter,
  loginLimiter,
  portalLoginLimiter,
  stockWriteLimiter,
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
  console.warn('⚠️  [SEGURIDAD] JWT_SECRET no configurado — se usa valor por defecto. Configura la variable de entorno en producción.');
}

const genLpnId = (prefix = 'LPN') => `${prefix}-${uuidv4().replace(/-/g,'').slice(0,10).toUpperCase()}`;

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

const PORTAL_SECRET = process.env.PORTAL_SECRET || (JWT_SECRET + '-portal');

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

// /api/stats (genérico) sigue inline.
app.get('/api/stats', requireAuth, async (req, res) => { try { const stock = await pool.query('SELECT COUNT(id) as total_lpns, COALESCE(SUM(qty), 0) as total_units FROM inventory_lpns WHERE qty > 0'); const skus = await pool.query('SELECT COUNT(*) as total_skus FROM master_skus'); res.json({ lpns: parseInt(stock.rows[0].total_lpns), units: parseFloat(stock.rows[0].total_units), skus: parseInt(skus.rows[0].total_skus) }); } catch (err) { sendDbError(res, err); }});
// /api/inventory, /api/audit, /api/skus, /api/bootstrap → routes/inventory.js, routes/skus.js
// /api/clients (GET/POST/DELETE) → routes/clients.js
// /api/document_types GET → routes/masters.js
// /api/statuses GET → routes/masters.js
// /api/users (GET/POST/DELETE) → routes/users.js
// /api/kits, /api/kit-build, /api/kits/build, /api/kits/direct-dispatch,
// /api/kit-orders, /api/kit-availability, /api/kits/:kit_sku/:client_id/availability
//   → routes/kits.js
// /api/login y /api/login-history → routes/auth.js

app.post('/api/document_types', requireJefe, validateBody(schemas.documentTypeCreate), async (req, res) => {
  const { id, description, flow_type } = req.body;
  if (!id || !String(id).trim()) return res.status(400).json({ error: 'El ID del tipo de documento es requerido' });
  if (!description || !String(description).trim()) return res.status(400).json({ error: 'La descripción es requerida' });
  const normalizedId = String(id).toUpperCase().replace(/[^A-Z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  if (!normalizedId) return res.status(400).json({ error: 'El ID solo contiene caracteres inválidos' });
  try {
    await pool.query(`INSERT INTO document_types (id, description, flow_type) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET description=EXCLUDED.description, flow_type=EXCLUDED.flow_type`, [normalizedId, description.trim(), flow_type || 'BOTH']);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: mapDbError(err) }); }
});
app.delete('/api/document_types/:id', requireJefe, async (req, res) => {
  try {
    const inUse = await pool.query('SELECT COUNT(*) as count FROM document_history WHERE doc_type=$1', [req.params.id]);
    if (parseInt(inUse.rows[0].count) > 0)
      return res.status(400).json({ error: `No se puede eliminar: el tipo '${req.params.id}' está en uso en ${inUse.rows[0].count} documento(s) histórico(s).` });
    const result = await pool.query('DELETE FROM document_types WHERE id=$1', [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Tipo de documento no encontrado' });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: mapDbError(err) }); }
});

app.post('/api/statuses', requireJefe, validateBody(schemas.statusCreate), async (req, res) => {
  const { id, description, color, blocks_outbound } = req.body;
  try { await pool.query(`INSERT INTO statuses (id, description, color, blocks_outbound) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO UPDATE SET description=EXCLUDED.description, color=EXCLUDED.color, blocks_outbound=EXCLUDED.blocks_outbound`, [id.toUpperCase().replace(/\s/g, '_'), description, color || 'slate', blocks_outbound || false]); res.json({ success: true }); } catch (err) { res.status(500).json({ error: mapDbError(err) }); }
});
app.delete('/api/statuses/:id', requireJefe, async (req, res) => {
  try {
    const PROTECTED = ['DISPONIBLE','BLOQUEADO','CUARENTENA','DESPACHADO'];
    if (PROTECTED.includes(req.params.id)) return res.status(400).json({ error: `El estado '${req.params.id}' es un estado base del sistema y no puede eliminarse.` });
    const invCheck = await pool.query('SELECT COUNT(*) as count FROM inventory_lpns WHERE status=$1 AND qty>0', [req.params.id]);
    if (parseInt(invCheck.rows[0].count) > 0) return res.status(400).json({ error: `No se puede eliminar: hay ${invCheck.rows[0].count} LPN(s) activo(s) con este estado.` });
    const histCheck = await pool.query('SELECT COUNT(*) as count FROM document_history WHERE items::text ILIKE $1', [`%${req.params.id}%`]).catch(() => ({ rows: [{ count: 0 }] }));
    const result = await pool.query('DELETE FROM statuses WHERE id=$1', [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Estado no encontrado' });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: mapDbError(err) }); }
});

// /api/clients (POST/DELETE) → routes/clients.js

app.post('/api/skus', requireStockWrite, checkClientAccess('write', { required: true }), async (req, res) => {
  const { sku, desc, category, uom, weight, length, width, height, abc_class, requires_lot, requires_serial, client_id, barcode,
          manufacturer_id, manufacturer_code, manufacturer_sku, brand,
          allow_substitutes, substitute_scope, substitute_threshold } = req.body;
  if (!sku || !String(sku).trim()) return res.status(400).json({ error: 'El código SKU es requerido' });
  if (!desc || !String(desc).trim()) return res.status(400).json({ error: 'La descripción del SKU es requerida' });
  const skuNorm = String(sku).toUpperCase().trim();
  const effectiveClientId = client_id || 'GENERAL';
  const barcodeNorm = barcode && String(barcode).trim() !== '' ? String(barcode).trim() : null;
  try {
    if (barcodeNorm) {
      const bcDup = await pool.query(`SELECT sku, client_id FROM master_skus WHERE barcode=$1 AND NOT (sku=$2 AND client_id=$3) LIMIT 1`, [barcodeNorm, skuNorm, effectiveClientId]);
      if (bcDup.rows.length > 0)
        return res.status(409).json({ error: `El código de barras '${barcodeNorm}' ya está asignado al SKU '${bcDup.rows[0].sku}' (cliente: ${bcDup.rows[0].client_id}).` });
    }
    // Validar manufacturer_id si llega
    let mfId = null;
    if (manufacturer_id !== undefined && manufacturer_id !== null && manufacturer_id !== '') {
      const mfRow = await pool.query(`SELECT id FROM manufacturers WHERE id=$1`, [manufacturer_id]);
      if (!mfRow.rows.length) return res.status(400).json({ error: 'Fabricante no encontrado (manufacturer_id inválido).' });
      mfId = parseInt(manufacturer_id);
    }
    const mfCode = manufacturer_code && String(manufacturer_code).trim() !== '' ? String(manufacturer_code).trim() : null;
    const mfSku  = manufacturer_sku  && String(manufacturer_sku).trim()  !== '' ? String(manufacturer_sku).trim()  : null;
    const brandN = brand && String(brand).trim() !== '' ? String(brand).trim() : null;

    // Validar substitute_scope
    const validScopes = ['any','same_client','same_category','same_manufacturer','manual_only'];
    const scope = validScopes.includes(substitute_scope) ? substitute_scope : 'any';
    // Convertir threshold: si llega como entero (1-100) → guardar como decimal (0.01-1.00)
    let threshold = null;
    if (substitute_threshold !== undefined && substitute_threshold !== null && substitute_threshold !== '') {
      let t = parseFloat(substitute_threshold);
      if (!isNaN(t)) {
        if (t > 1) t = t / 100;
        threshold = Math.max(0, Math.min(1, t));
      }
    }

    await pool.query(`
      INSERT INTO master_skus
        (sku, client_id, "desc", category, uom, weight, length, width, height, abc_class,
         requires_lot, requires_serial, barcode,
         manufacturer_id, manufacturer_code, manufacturer_sku, brand,
         allow_substitutes, substitute_scope, substitute_threshold)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
      ON CONFLICT (sku, client_id) DO UPDATE SET
        "desc"=EXCLUDED."desc", category=EXCLUDED.category, uom=EXCLUDED.uom,
        weight=EXCLUDED.weight, length=EXCLUDED.length, width=EXCLUDED.width,
        height=EXCLUDED.height, abc_class=EXCLUDED.abc_class,
        requires_lot=EXCLUDED.requires_lot, requires_serial=EXCLUDED.requires_serial,
        barcode=EXCLUDED.barcode,
        manufacturer_id=EXCLUDED.manufacturer_id,
        manufacturer_code=EXCLUDED.manufacturer_code,
        manufacturer_sku=EXCLUDED.manufacturer_sku,
        brand=EXCLUDED.brand,
        allow_substitutes=EXCLUDED.allow_substitutes,
        substitute_scope=EXCLUDED.substitute_scope,
        substitute_threshold=EXCLUDED.substitute_threshold
    `, [skuNorm, effectiveClientId, desc.trim(), category || 'General', uom || 'UN',
        parseFloat(weight)||0, parseFloat(length)||0, parseFloat(width)||0, parseFloat(height)||0,
        abc_class === '-' ? null : abc_class,
        requires_lot || false, requires_serial || false, barcodeNorm,
        mfId, mfCode, mfSku, brandN,
        !!allow_substitutes, scope, threshold]);
    // Línea base v1 en historial (idempotente)
    await pool.query(
      `INSERT INTO sku_version_history (sku, version, requires_lot, requires_serial, changed_by, reason)
         SELECT sku, current_version, requires_lot, requires_serial, $1, 'Línea base'
           FROM master_skus WHERE sku = $2
         ON CONFLICT (sku, version) DO NOTHING`,
      [req.user.username, skuNorm]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: mapDbError(err) }); }
});
// PUT /api/skus/:sku — versiona automáticamente si hay cambio crítico con stock.
// Campos críticos: requires_lot, requires_serial.
// Campos no críticos (desc, category, uom, weight, barcode, manufacturer_*, brand)
// se propagan a todas las versiones del mismo SKU base.
// PUT /api/skus/:sku
// El código del SKU NUNCA cambia. Si hay cambio crítico (requires_lot/serial)
// con stock activo → bump de current_version y snapshot en sku_version_history.
// Los cambios no críticos siempre se aplican in-place sobre la misma fila.
app.put('/api/skus/:sku', requireStockWrite, checkClientAccess('write'), async (req, res) => {
  const sku = String(req.params.sku).toUpperCase().trim();
  const { client_id, requires_lot, requires_serial, desc, category, uom, weight, length, width, height,
          abc_class, barcode, manufacturer_id, manufacturer_code, manufacturer_sku, brand,
          version_reason, username } = req.body || {};
  if (!client_id) return res.status(400).json({ error: 'client_id es requerido en el body.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query(
      `SELECT * FROM master_skus WHERE sku = $1 AND client_id = $2 LIMIT 1`,
      [sku, client_id]
    );
    if (!cur.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'SKU no encontrado.' });
    }
    const current = cur.rows[0];

    // Detectar cambio crítico
    const newLot    = typeof requires_lot    === 'boolean' ? requires_lot    : current.requires_lot;
    const newSerial = typeof requires_serial === 'boolean' ? requires_serial : current.requires_serial;
    const criticalChange = (newLot !== current.requires_lot) || (newSerial !== current.requires_serial);

    let versionedResult = null;

    if (criticalChange) {
      const stockRow = await client.query(
        `SELECT COALESCE(SUM(qty), 0)::numeric AS total FROM inventory_lpns WHERE sku = $1 AND qty > 0`,
        [sku]
      );
      const stock = parseFloat(stockRow.rows[0].total) || 0;

      if (stock > 0) {
        // Bump versión + snapshot. El código del SKU no cambia.
        const changes = { requires_lot: newLot, requires_serial: newSerial };
        const versionFn = await client.query(
          `SELECT * FROM create_sku_version($1, $2::jsonb, $3, $4)`,
          [sku, JSON.stringify(changes),
           version_reason || 'Cambio de control de lote/serie con stock activo',
           username || req.user.username]
        );
        versionedResult = {
          versioned: true,
          sku: sku,
          previous_version: current.current_version,
          new_version: versionFn.rows[0].new_version,
          message: `Se registró la versión ${versionFn.rows[0].new_version} de ${sku}. El stock existente (v${current.current_version}) se despacha normalmente. Las nuevas recepciones usarán la configuración v${versionFn.rows[0].new_version}.`,
        };
      } else {
        // Sin stock → actualizar in-place sin bump de versión.
        await client.query(
          `UPDATE master_skus SET requires_lot=$1, requires_serial=$2 WHERE sku=$3 AND client_id=$4`,
          [newLot, newSerial, sku, client_id]
        );
        // Refrescar la entrada del historial para la versión actual.
        await client.query(
          `INSERT INTO sku_version_history (sku, version, requires_lot, requires_serial, changed_by, reason)
           VALUES ($1, $2, $3, $4, $5, 'Cambio sin stock — versión actual actualizada')
           ON CONFLICT (sku, version) DO UPDATE SET
             requires_lot = EXCLUDED.requires_lot,
             requires_serial = EXCLUDED.requires_serial,
             changed_at = NOW(),
             changed_by = EXCLUDED.changed_by,
             reason = EXCLUDED.reason`,
          [sku, current.current_version, newLot, newSerial, username || req.user.username]
        );
      }
    }

    // Cambios no críticos: in-place sobre la misma fila.
    let mfId = current.manufacturer_id;
    if (manufacturer_id !== undefined && manufacturer_id !== null && manufacturer_id !== '') {
      const mfRow = await client.query(`SELECT id FROM manufacturers WHERE id=$1`, [manufacturer_id]);
      if (!mfRow.rows.length) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'manufacturer_id inválido' }); }
      mfId = parseInt(manufacturer_id);
    } else if (manufacturer_id === '') {
      mfId = null;
    }

    await client.query(
      `UPDATE master_skus SET
         "desc"            = COALESCE($1, "desc"),
         category          = COALESCE($2, category),
         uom               = COALESCE($3, uom),
         weight            = COALESCE($4, weight),
         length            = COALESCE($5, length),
         width             = COALESCE($6, width),
         height            = COALESCE($7, height),
         abc_class         = COALESCE($8, abc_class),
         barcode           = COALESCE($9, barcode),
         manufacturer_id   = $10,
         manufacturer_code = COALESCE($11, manufacturer_code),
         manufacturer_sku  = COALESCE($12, manufacturer_sku),
         brand             = COALESCE($13, brand)
       WHERE sku = $14 AND client_id = $15`,
      [desc, category, uom,
       weight !== undefined ? parseFloat(weight) : null,
       length !== undefined ? parseFloat(length) : null,
       width  !== undefined ? parseFloat(width)  : null,
       height !== undefined ? parseFloat(height) : null,
       abc_class, barcode, mfId,
       manufacturer_code, manufacturer_sku, brand,
       sku, client_id]
    );
    await client.query('COMMIT');
    if (versionedResult) return res.json(versionedResult);
    res.json({ success: true, versioned: false, sku });
  } catch (e) { await client.query('ROLLBACK'); res.status(500).json({ error: mapDbError(e) }); }
  finally { client.release(); }
});

// GET /api/skus/:sku/versions — historial completo desde sku_version_history.
app.get('/api/skus/:sku/versions', requireAuth, async (req, res) => {
  const sku = String(req.params.sku).toUpperCase().trim();
  try {
    const r = await pool.query(
      `SELECT h.version, h.requires_lot, h.requires_serial,
              h.changed_at, h.changed_by, h.reason,
              (SELECT COALESCE(SUM(qty), 0)::float FROM inventory_lpns
                 WHERE sku = h.sku AND sku_version = h.version AND qty > 0) AS active_stock,
              (h.version = s.current_version) AS is_current
         FROM sku_version_history h
         JOIN master_skus s ON s.sku = h.sku
        WHERE h.sku = $1
        ORDER BY h.version DESC`,
      [sku]
    );
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

app.delete('/api/skus/:id', requireStockWrite, checkClientAccess('write'), async (req, res) => {
  const { client_id } = req.query;
  if (!client_id) return res.status(400).json({ error: 'Se requiere client_id como query param para identificar el SKU.' });
  try {
    const check = await pool.query('SELECT COUNT(*) as count FROM inventory_lpns WHERE sku=$1 AND client_id=$2 AND qty>0', [req.params.id, client_id]);
    if (parseInt(check.rows[0].count) > 0) return res.status(400).json({ error: 'No se puede eliminar un SKU que tiene stock activo.' });
    // Borrado LÓGICO (nunca físico): marca deleted_at. El código del SKU se conserva
    // y el historial de versiones queda intacto. El borrado físico es solo SUPERADMIN.
    const result = await pool.query('UPDATE master_skus SET deleted_at=NOW() WHERE sku=$1 AND client_id=$2 AND deleted_at IS NULL', [req.params.id, client_id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'SKU no encontrado para ese cliente (o ya estaba eliminado).' });
    res.json({ success: true, deleted: 'logical' });
  } catch (err) { res.status(500).json({ error: mapDbError(err) }); }
});

// Migración dinámica: columnas extra para locations_master (MEJORA 5)
(async () => {
  try {
    await pool.query(`ALTER TABLE locations_master ADD COLUMN IF NOT EXISTS loc_type VARCHAR(20) DEFAULT 'PALLET'`);
    await pool.query(`ALTER TABLE locations_master ADD COLUMN IF NOT EXISTS max_kg NUMERIC DEFAULT 0`);
    await pool.query(`ALTER TABLE locations_master ADD COLUMN IF NOT EXISTS max_pallets INTEGER DEFAULT 0`);
  } catch(e) { /* tabla aún no existe en bootstrap, se reintentará */ }
})();

// /api/locations writes (+ bulk) → routes/locations.js

// Transiciones de estado permitidas
const STATUS_TRANSITIONS = {
  'DISPONIBLE':  ['BLOQUEADO', 'CUARENTENA', 'RETENIDO'],
  'BLOQUEADO':   ['DISPONIBLE', 'CUARENTENA', 'RETENIDO'],
  'CUARENTENA':  ['DISPONIBLE', 'BLOQUEADO', 'RETENIDO'],
  'RETENIDO':    ['DISPONIBLE', 'BLOQUEADO', 'CUARENTENA'],
  'DESPACHADO':  [], // terminal — no se puede cambiar
};

app.post('/api/inventory/status', requireStockWrite, checkLpnClientAccess('id'), async (req, res) => {
  const { id, new_status, glosa, username } = req.body;
  try {
    const check = await pool.query('SELECT * FROM inventory_lpns WHERE id = $1', [id]);
    if (check.rows.length === 0 || parseFloat(check.rows[0].qty) <= 0) return res.status(400).json({ error: 'LPN no disponible.' });
    const old_status = check.rows[0].status || 'DISPONIBLE';

    // Validar que el estado destino existe en la tabla
    const stExists = await pool.query('SELECT id FROM statuses WHERE id = $1', [new_status]);
    if (stExists.rows.length === 0) return res.status(400).json({ error: `Estado '${new_status}' no existe.` });

    // Validar transición permitida
    const allowed = STATUS_TRANSITIONS[old_status];
    if (allowed !== undefined && !allowed.includes(new_status)) {
      return res.status(400).json({ error: `Transición de '${old_status}' → '${new_status}' no permitida. Desde ${old_status} solo puede ir a: ${(STATUS_TRANSITIONS[old_status] || []).join(', ') || 'ningún estado'}.` });
    }

    await pool.query('UPDATE inventory_lpns SET status = $1 WHERE id = $2', [new_status, id]);
    await pool.query(`INSERT INTO audit_log (type, sku, qty, glosa, username) VALUES ('STATUS_CHANGE', $1, $2, $3, $4)`, [check.rows[0].sku, check.rows[0].qty, `LPN [${id}]: de [${old_status}] a [${new_status}]. ${glosa || ''}`, username || 'SYSTEM']);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: mapDbError(err) }); }
});

// ¿Un documento ya fue cerrado/procesado para este cliente+tipo? Permite que el
// frontend impida reiniciar (y agregar movimientos a) un número ya cerrado.
app.get('/api/processed-docs/exists', requireAuth, async (req, res) => {
  const { doc_num, doc_type, client_id } = req.query;
  if (!doc_num) return res.status(400).json({ error: 'doc_num requerido' });
  try {
    const r = await pool.query(
      'SELECT 1 FROM processed_docs WHERE doc_num=$1 AND doc_type=$2 AND client_id=$3 LIMIT 1',
      [String(doc_num).toUpperCase(), String(doc_type || '').toUpperCase(), String(client_id || '').toUpperCase()]
    );
    res.json({ exists: r.rows.length > 0 });
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

app.post('/api/receive_batch', stockWriteLimiter, requireStockWrite, checkClientAccess('write'), checkBatchSkuClientAccess(), async (req, res) => {
  const { items, docNum, glosa, docType, username } = req.body;
  if (!docNum) return res.status(400).json({ error: 'docNum es requerido para trazabilidad.' });
  if (!items || !Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'Se requiere al menos un ítem.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Derivar client_id del primer ítem para aislar la unicidad por cliente
    const firstSkuRow = await client.query('SELECT client_id FROM master_skus WHERE sku=$1 LIMIT 1', [String(items[0].sku)]);
    const docClientId = (firstSkuRow.rows[0]?.client_id || '').toUpperCase();
    // Verificar idempotencia: si este doc ya fue procesado para este cliente, rechazar (LOG-09)
    const already = await client.query('SELECT doc_num FROM processed_docs WHERE doc_num=$1 AND doc_type=$2 AND client_id=$3', [docNum.toUpperCase(), (docType||'REC').toUpperCase(), docClientId]);
    if (already.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `El documento '${docNum}' ya fue procesado previamente para este cliente. No se puede registrar dos veces.` });
    }
    for (let it of items) {
      const lpnId = genLpnId('LPN');
      const sku = String(it.sku);
      const qty = parseFloat(it.qty);
      const batch = it.batch && String(it.batch).trim() !== '' ? String(it.batch).trim() : null;
      const expDate = it.expDate && String(it.expDate).trim() !== '' ? String(it.expDate).trim() : null;
      const serial = it.serial && String(it.serial).trim() !== '' ? String(it.serial).trim() : null;
      const locId = it.location_id || 'PISO-RECEPCION';
      const docGlosa = glosa || '';
      const user = username || 'SYSTEM';

      // Validaciones previas al insert
      if (!sku || isNaN(qty) || qty <= 0) throw new Error(`Fila inválida: SKU y cantidad > 0 son requeridos.`);
      if (expDate) {
        const exp = new Date(expDate);
        if (isNaN(exp.getTime())) throw new Error(`Fecha de expiración inválida: ${expDate}`);
        if (exp < new Date()) throw new Error(`La fecha de expiración '${expDate}' ya está vencida para SKU ${sku}.`);
      }
      if (serial) {
        const dup = await client.query(
          `SELECT id FROM inventory_lpns WHERE sku = $1 AND serial_number = $2 AND qty > 0 LIMIT 1`, [sku, serial]
        );
        if (dup.rows.length > 0) throw new Error(`El número de serie '${serial}' ya existe en stock para SKU ${sku}.`);
      }

      // El código del SKU no cambia con versiones. Leemos current_version directo.
      const skuRow = await client.query(
        `SELECT client_id, current_version FROM master_skus WHERE sku = $1 LIMIT 1`,
        [sku]
      );
      const clientId = skuRow.rows.length > 0 ? (skuRow.rows[0].client_id || 'GENERAL') : 'GENERAL';
      const currentVersion = skuRow.rows.length > 0 ? (skuRow.rows[0].current_version || 1) : 1;

      await client.query(
        `INSERT INTO inventory_lpns (id, sku, sku_version, qty, client_id, status, batch_number, expiry_date, serial_number, location_id, glosa)
         VALUES ($1, $2, $3, $4, $5, 'DISPONIBLE', $6, $7, $8, $9, $10)`,
        [lpnId, sku, currentVersion, qty, clientId, batch, expDate, serial, locId, docGlosa]
      );

      await client.query(
        `INSERT INTO audit_log (type, sku, qty, glosa, username) VALUES ('INBOUND', $1, $2, $3, $4)`,
        [sku, qty, `Doc: [${docType || 'N/A'}] ${docNum || 'S/N'}. LPN: ${lpnId}${currentVersion>1?` (v${currentVersion})`:''}`, user]
      );

      // Cobro 3PL: registrar evento de movimiento de entrada (no-op si cliente propio)
      await logStorageEvent(client, { client_id: clientId, event_type: 'MOVIMIENTO_IN', sku, lpn_id: lpnId, qty, location_id: locId });
    }
    // Registrar documento como procesado para evitar doble ingreso
    await client.query('INSERT INTO processed_docs(doc_num,doc_type,client_id,processed_by) VALUES($1,$2,$3,$4)',
      [docNum.toUpperCase(), (docType||'REC').toUpperCase(), docClientId, username||'SYSTEM']);
    // Cerrar tareas de picking pendientes asociadas a este documento
    await client.query(`UPDATE pick_tasks SET status='COMPLETADA' WHERE doc_num=$1 AND module='receive' AND status IN ('PENDIENTE','EN_PROCESO')`, [docNum.toUpperCase()])
      .catch(e => console.error('[pick_tasks] Error cerrando tareas en receive:', e.message));
    await client.query(`UPDATE pick_task_lines ptl SET status='COMPLETADA', updated_at=NOW() FROM pick_tasks pt WHERE ptl.task_id=pt.id AND pt.doc_num=$1 AND pt.module='receive' AND ptl.status='PENDIENTE'`, [docNum.toUpperCase()])
      .catch(e => console.error('[pick_task_lines] Error cerrando líneas en receive:', e.message));
    await client.query('COMMIT');
    // Respuesta consistente { imported, errors }. Transaccional (todo-o-nada):
    // si llegó aquí, todas las filas válidas se insertaron. `success` se mantiene
    // por compatibilidad con el flujo de recepción manual (handleCommitAPI).
    res.json({ success: true, imported: items.length, errors: [] });
  } catch (err) {
    await client.query('ROLLBACK');
    if (isUniqueViolation(err)) return res.status(409).json({ error: `El documento '${docNum}' ya fue procesado previamente para este cliente. No se puede registrar dos veces.` });
    console.error("Error Receive:", err.message);
    res.status(500).json({ error: mapDbError(err) });
  } finally { client.release(); }
});

// El consumo de componentes de kit (Modo A) usa consumeComponentTracked de
// ./kitConsumo, compartido con el armado de órdenes (routes/kitting.js, Modo B).

app.post('/api/dispatch_batch', stockWriteLimiter, requireStockWrite, checkClientAccess('write'), checkBatchSkuClientAccess(), async (req, res) => {
  const { items, docNum, glosa, docType, username, usePickConfirmations, allow_substitutes: allowSubstFlag } = req.body;
  if (!docNum) return res.status(400).json({ error: 'docNum es requerido para trazabilidad.' });
  if (!items || !Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'Se requiere al menos un ítem.' });

  // M3 — Pre-check de stock por SKU. Si algún SKU del despacho tiene
  // allow_substitutes=TRUE y déficit, devolver 422 para que el frontend
  // ofrezca sustitutos. Solo si el caller NO confirmó allow_substitutes:true.
  if (!allowSubstFlag) {
    const skuTotals = {};
    items.forEach(it => {
      if (it.isKit) return; // los kits no se sustituyen: se validan por componente en la transacción
      const s = String(it.sku || '').toUpperCase();
      const q = parseFloat(it.qtyToPick || it.qty || 0) || 0;
      if (!s) return;
      skuTotals[s] = (skuTotals[s] || 0) + q;
    });
    const itemsConDeficit = [];
    for (const [s, reqQty] of Object.entries(skuTotals)) {
      const skuMeta = await pool.query(
        `SELECT allow_substitutes FROM master_skus WHERE sku = $1 LIMIT 1`, [s]
      );
      if (!skuMeta.rows[0]?.allow_substitutes) continue;
      const avail = await pool.query(
        `SELECT COALESCE(SUM(qty),0)::float AS total FROM inventory_lpns
          WHERE sku=$1 AND qty>0 AND status='DISPONIBLE'`, [s]
      );
      const qtyAvailable = parseFloat(avail.rows[0].total) || 0;
      if (qtyAvailable < reqQty) {
        itemsConDeficit.push({
          sku: s, qty_solicitada: reqQty, qty_disponible: qtyAvailable,
          deficit: reqQty - qtyAvailable,
          substitutes_url: `/api/skus/${encodeURIComponent(s)}/substitutes?qty=${reqQty - qtyAvailable}`,
        });
      }
    }
    if (itemsConDeficit.length > 0) {
      return res.status(422).json({
        error: 'stock_insuficiente',
        items_con_deficit: itemsConDeficit,
      });
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Derivar client_id del primer LPN para aislar la unicidad por cliente.
    // Si el despacho es 100% de kits (líneas sin lpnId), tomar el client_id de la
    // primera línea de kit (el kit pertenece a un cliente).
    let dispClientId = '';
    const firstNormal = items.find(it => !it.isKit && it.lpnId);
    if (firstNormal) {
      const firstLpnRow = await client.query('SELECT client_id FROM inventory_lpns WHERE id=$1 LIMIT 1', [String(firstNormal.lpnId)]);
      dispClientId = (firstLpnRow.rows[0]?.client_id || '').toUpperCase();
    }
    if (!dispClientId) {
      const firstKit = items.find(it => it.isKit && it.client_id);
      if (firstKit) dispClientId = String(firstKit.client_id).toUpperCase();
    }
    // Idempotencia: evitar doble despacho del mismo documento para este cliente
    const alreadyDisp = await client.query('SELECT doc_num FROM processed_docs WHERE doc_num=$1 AND doc_type=$2 AND client_id=$3', [docNum.toUpperCase(), (docType||'DIS').toUpperCase(), dispClientId]);
    if (alreadyDisp.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `El documento '${docNum}' ya fue despachado previamente para este cliente. No se puede despachar dos veces.` });
    }

    // Si hay confirmaciones del picker para este doc, usarlas para ajustar cantidades
    const lpnsToDelete = [];
    let pickConfirmMap = {}; // lpnId → qty_confirmed
    if (usePickConfirmations) {
      const pickConf = await client.query(
        `SELECT ptl.lpn_id, ptl.qty_confirmed, ptl.batch_confirmed, ptl.serial_confirmed
         FROM pick_task_lines ptl
         JOIN pick_tasks pt ON pt.id = ptl.task_id
         WHERE pt.doc_num=$1 AND pt.module='dispatch' AND ptl.status IN ('COMPLETADA','DIFERENCIA') AND ptl.lpn_id IS NOT NULL`,
        [docNum.toUpperCase()]
      );
      pickConf.rows.forEach(r => { pickConfirmMap[r.lpn_id] = r; });
    }

    for (let it of items) {
      const docGlosa = glosa || '';
      const user = username || (req.user?.username) || 'SYSTEM';

      // ── KITTING Modo A: línea de kit explotada al vuelo ──────────────────────
      // El kit es VIRTUAL: no genera stock propio. Se descuenta cada componente de
      // la receta (FEFO 'auto' o LPN elegidos 'manual'), se registra trazabilidad en
      // kit_componente_consumido (origen_tipo='despacho') y un Kardex OUTBOUND por
      // componente. Todo en la MISMA transacción del despacho.
      if (it.isKit) {
        const kitSku = String(it.sku || '').toUpperCase();
        const kitClient = String(it.client_id || dispClientId || '').toUpperCase();
        const qtyKits = parseInt(it.qtyKits ?? it.qty ?? it.qtyToPick);
        if (!kitSku || !kitClient) throw new Error('Línea de kit sin SKU o cliente.');
        if (isNaN(qtyKits) || qtyKits < 1) throw new Error(`Cantidad de kits inválida para ${kitSku}.`);
        const receta = (await client.query(
          `SELECT kc.component_sku, kc.qty,
                  COALESCE(cm.requires_serial,false) AS rs, COALESCE(cm.requires_lot,false) AS rl
             FROM kit_components kc
             LEFT JOIN master_skus cm ON cm.sku=kc.component_sku AND cm.client_id=$2
            WHERE kc.kit_sku=$1 AND kc.kit_client_id=$2`,
          [kitSku, kitClient])).rows;
        if (!receta.length) throw new Error(`El kit ${kitSku} no tiene receta definida para este cliente.`);
        const compInput = {};
        (Array.isArray(it.components) ? it.components : []).forEach(c => { compInput[String(c.component_sku || '').toUpperCase()] = c; });
        for (const comp of receta) {
          const needed = parseFloat(comp.qty) * qtyKits;
          const ci = compInput[comp.component_sku];
          const isManual = !!(ci && ci.mode === 'manual' && Array.isArray(ci.sources) && ci.sources.length);
          const { touched, consumed } = await consumeComponentTracked(client, {
            compSku: comp.component_sku, needed, clientId: kitClient,
            picks: isManual ? ci.sources : null, requiresSerial: comp.rs, requiresLot: comp.rl,
          });
          lpnsToDelete.push(...touched);
          for (const cc of consumed) {
            await client.query(
              `INSERT INTO kit_componente_consumido
                 (componente_sku, cantidad, ubicacion, lote, serie, lpn_origen, origen_tipo, origen_id, modo_origen, client_id)
               VALUES ($1,$2,$3,$4,$5,$6,'despacho',$7,$8,$9)`,
              [comp.component_sku, cc.cantidad, cc.ubicacion, cc.lote, cc.serie, cc.lpn_id, docNum.toUpperCase(), isManual ? 'manual' : 'auto', kitClient]);
            await client.query(
              `INSERT INTO audit_log (type, sku, qty, glosa, username) VALUES ('OUTBOUND', $1, $2, $3, $4)`,
              [comp.component_sku, cc.cantidad,
               `[KIT] Componente de ${qtyKits}x ${kitSku}. Doc: [${docType || 'N/A'}] ${docNum}. LPN origen: ${cc.lpn_id}.${cc.lote ? ` Lote: ${cc.lote}.` : ''}${cc.serie ? ` Serie: ${cc.serie}.` : ''} ${docGlosa}`,
               user]);
            await logStorageEvent(client, { client_id: kitClient || null, event_type: 'MOVIMIENTO_OUT', sku: comp.component_sku, lpn_id: cc.lpn_id, qty: cc.cantidad });
          }
        }
        continue; // el kit no descuenta como SKU normal ni genera stock propio
      }

      const sku = String(it.sku);
      const lpnId = String(it.lpnId);

      // Si hay confirmación del picker para este LPN, usar su cantidad confirmada
      const pickConf = pickConfirmMap[lpnId];
      const qtyToPick = pickConf ? parseFloat(pickConf.qty_confirmed) : parseFloat(it.qtyToPick);
      if (isNaN(qtyToPick) || qtyToPick <= 0) continue; // saltar si picker confirmó 0 (diferencia total)

      // Bloquear solo inventory_lpns (sin JOIN) para evitar error de PG con outer join + FOR UPDATE
      const lpnLock = await client.query(
        `SELECT id, qty, status FROM inventory_lpns WHERE id = $1 FOR UPDATE`, [lpnId]
      );
      if (lpnLock.rows.length === 0) throw new Error(`LPN ${lpnId} no encontrado.`);
      const lpnRow = lpnLock.rows[0];
      // Verificar si el estado bloquea salidas (query separada sin lock)
      const statusCheck = await client.query(
        `SELECT COALESCE(blocks_outbound, FALSE) AS blocks_outbound FROM statuses WHERE id = $1`, [lpnRow.status]
      );
      if (statusCheck.rows[0]?.blocks_outbound) {
        throw new Error(`LPN ${lpnId} está en estado '${lpnRow.status}' y no puede ser despachado.`);
      }
      if (parseFloat(lpnRow.qty) < qtyToPick) {
        throw new Error(`Stock insuficiente en LPN ${lpnId}: disponible ${lpnRow.qty}, solicitado ${qtyToPick}.`);
      }

      const updateRes = await client.query(
        'UPDATE inventory_lpns SET qty = qty - $1 WHERE id = $2 AND qty >= $3 RETURNING id, qty',
        [qtyToPick, lpnId, qtyToPick]
      );
      if (updateRes.rowCount === 0) throw new Error(`Condición de Carrera: Alguien más consumió el LPN ${lpnId}.`);
      if (parseFloat(updateRes.rows[0].qty) <= 0) lpnsToDelete.push(lpnId);

      const batchInfo = pickConf?.batch_confirmed ? ` Lote: ${pickConf.batch_confirmed}.` : '';
      const serialInfo = pickConf?.serial_confirmed ? ` Serie: ${pickConf.serial_confirmed}.` : '';
      await client.query(
        `INSERT INTO audit_log (type, sku, qty, glosa, username) VALUES ('OUTBOUND', $1, $2, $3, $4)`,
        [sku, qtyToPick, `LPN: ${lpnId}. Doc: [${docType || 'N/A'}] ${docNum}.${batchInfo}${serialInfo} ${docGlosa}`, user]
      );

      // Cobro 3PL: registrar evento de movimiento de salida (no-op si cliente propio)
      await logStorageEvent(client, { client_id: dispClientId || null, event_type: 'MOVIMIENTO_OUT', sku, lpn_id: lpnId, qty: qtyToPick });
    }
    // Borrar solo LPNs que este dispatch dejó en 0; evita carrera con otras
    // sesiones que pudieran estar insertando filas con qty=0 transitorio.
    if (lpnsToDelete.length > 0) {
      await client.query('DELETE FROM inventory_lpns WHERE id = ANY($1::varchar[]) AND qty <= 0', [lpnsToDelete]);
    }
    // Registrar documento como procesado para evitar doble despacho
    const dispUser = username || (req.user?.username) || 'SYSTEM';
    await client.query('INSERT INTO processed_docs(doc_num,doc_type,client_id,processed_by) VALUES($1,$2,$3,$4)', [docNum.toUpperCase(), (docType||'DIS').toUpperCase(), dispClientId, dispUser]);
    // Cerrar tareas de picking asociadas a este documento
    await client.query(`UPDATE pick_tasks SET status='COMPLETADA' WHERE doc_num=$1 AND module='dispatch' AND status IN ('PENDIENTE','EN_PROCESO')`, [docNum.toUpperCase()])
      .catch(e => console.error('[pick_tasks] Error cerrando tareas en dispatch:', e.message));
    await client.query(`UPDATE pick_task_lines ptl SET status='COMPLETADA', updated_at=NOW() FROM pick_tasks pt WHERE ptl.task_id=pt.id AND pt.doc_num=$1 AND pt.module='dispatch' AND ptl.status='PENDIENTE'`, [docNum.toUpperCase()])
      .catch(e => console.error('[pick_task_lines] Error cerrando líneas en dispatch:', e.message));
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    if (isUniqueViolation(err)) return res.status(409).json({ error: `El documento '${docNum}' ya fue despachado previamente para este cliente. No se puede despachar dos veces.` });
    res.status(400).json({ error: err.message });
  } finally { client.release(); }
});

app.post('/api/relocate', requireStockWrite, checkClientAccess('write'), checkLpnClientAccess('id'), async (req, res) => {
  const { id, qty, glosa, username } = req.body;
  const new_location_id = req.body.new_location_id ? String(req.body.new_location_id).trim().toUpperCase() : null;
  if (!new_location_id) return res.status(400).json({ error: 'El destino de reubicación es requerido' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const check = await client.query('SELECT * FROM inventory_lpns WHERE id = $1 FOR UPDATE', [id]);
    if (check.rows.length === 0 || parseFloat(check.rows[0].qty) <= 0) throw new Error('Stock no disponible.');
    const originalLpn = check.rows[0];
    // Validar que destino ≠ origen
    const currentLoc = originalLpn.location_id || 'PISO-RECEPCION';
    if (new_location_id === currentLoc) throw new Error('El destino es igual a la ubicación actual.');
    // Validar que el estado no bloquee movimientos
    const stCheck = await client.query('SELECT blocks_outbound FROM statuses WHERE id = $1', [originalLpn.status || 'DISPONIBLE']);
    if (stCheck.rows[0]?.blocks_outbound) throw new Error(`El LPN está en estado '${originalLpn.status}' y no puede ser reubicado.`);
    // Validar existencia del destino
    if (new_location_id !== 'PISO-RECEPCION') {
        const locCheck = await client.query('SELECT location_id FROM locations_master WHERE location_id = $1', [new_location_id]);
        if (locCheck.rows.length === 0) throw new Error('La ubicación de destino no existe.');
    }
    const maxQty = parseFloat(originalLpn.qty);
    const moveQty = (qty !== undefined && qty !== null && qty !== '') ? parseFloat(qty) : maxQty;
    if (isNaN(moveQty) || moveQty <= 0 || moveQty > maxQty) throw new Error('Cantidad inválida.');

    if (moveQty === maxQty) {
      await client.query('UPDATE inventory_lpns SET location_id = $1 WHERE id = $2', [new_location_id, id]);
      await client.query(`INSERT INTO audit_log (type, sku, qty, glosa, username) VALUES ('RELOCATE', $1, $2, $3, $4)`, [originalLpn.sku, moveQty, `Total de [${originalLpn.location_id || 'PISO-RECEPCION'}] a [${new_location_id}]. LPN: ${id}. ${glosa || ''}`, username || 'SYSTEM']);
    } else {
      if(originalLpn.serial_number) throw new Error('Los productos serializados no se pueden dividir.');
      const newLpnId = genLpnId('SPLIT');
      const splitUpd = await client.query('UPDATE inventory_lpns SET qty = qty - $1 WHERE id = $2 AND qty >= $1 RETURNING id', [moveQty, id]);
      if (splitUpd.rowCount === 0) throw new Error(`Condición de carrera: el stock del LPN ${id} cambió durante la reubicación.`);
      await client.query(
        `INSERT INTO inventory_lpns (id, sku, qty, client_id, status, batch_number, expiry_date, serial_number, location_id, glosa) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`, 
        [newLpnId, originalLpn.sku, moveQty, originalLpn.client_id, originalLpn.status, originalLpn.batch_number, originalLpn.expiry_date, originalLpn.serial_number, new_location_id, `Separación de ${id}. ${glosa || ''}`]
      );
      await client.query(`INSERT INTO audit_log (type, sku, qty, glosa, username) VALUES ('RELOCATE', $1, $2, $3, $4)`, [originalLpn.sku, moveQty, `Separación de [${originalLpn.location_id || 'PISO-RECEPCION'}] (LPN Origen: ${id}) a [${new_location_id}] (Nuevo LPN: ${newLpnId}). ${glosa || ''}`, username || 'SYSTEM']);
    }
    await client.query('COMMIT'); res.json({ success: true });
  } catch (err) { await client.query('ROLLBACK'); res.status(400).json({ error: err.message }); } finally { client.release(); }
});

app.post('/api/adjust_batch', stockWriteLimiter, requireJefe, checkClientAccess('write'), checkBatchSkuClientAccess(), async (req, res) => {
  if (!['ADMIN','SUPERADMIN'].includes(req.user.role))
    return res.status(403).json({ error: 'Solo administradores pueden aplicar ajustes directamente. Use /api/adjust-request para solicitar aprobación.' });
  const { items, docNum, glosa, username } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Anti-reúso: el número de hoja de ajuste no se puede reutilizar por cliente.
    const adjType = 'ADJ';
    const firstAdjSku = await client.query('SELECT client_id FROM master_skus WHERE sku=$1 LIMIT 1', [String(items[0]?.sku)]);
    const adjClientId = String(req.body.client_id || firstAdjSku.rows[0]?.client_id || 'GENERAL').toUpperCase();
    if (docNum) {
      const alreadyAdj = await client.query('SELECT 1 FROM processed_docs WHERE doc_num=$1 AND doc_type=$2 AND client_id=$3', [String(docNum).toUpperCase(), adjType, adjClientId]);
      if (alreadyAdj.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: `La hoja de ajuste '${docNum}' ya fue cerrada para este cliente. No se puede reutilizar.` });
      }
    }
    for (let it of items) {
      const sku = String(it.sku);
      const qty = parseFloat(it.qty);
      const batch = it.batch && String(it.batch).trim() !== '' ? String(it.batch).trim() : null;
      const expDate = it.expDate && String(it.expDate).trim() !== '' ? String(it.expDate).trim() : null;
      const serial = it.serial && String(it.serial).trim() !== '' ? String(it.serial).trim() : null;
      const locId = it.location_id || 'PISO-RECEPCION';
      const docGlosa = glosa || '';
      const user = username || 'SYSTEM';

      if (it.action === 'ADD') {
        if (isNaN(qty) || qty <= 0) throw new Error(`La cantidad de ajuste debe ser mayor a 0 para SKU ${sku}.`);
        const lpnId = genLpnId('ADJ');

        // Consulta limpia sin subconsultas
        const skuRow = await client.query('SELECT client_id FROM master_skus WHERE sku = $1 LIMIT 1', [sku]);
        const clientId = skuRow.rows.length > 0 ? (skuRow.rows[0].client_id || 'GENERAL') : 'GENERAL';

        await client.query(
          `INSERT INTO inventory_lpns (id, sku, qty, client_id, status, batch_number, expiry_date, serial_number, location_id, glosa) 
           VALUES ($1, $2, $3, $4, 'DISPONIBLE', $5, $6, $7, $8, $9)`, 
          [lpnId, sku, qty, clientId, batch, expDate, serial, locId, docGlosa]
        );
        await client.query(
          `INSERT INTO audit_log (type, sku, qty, glosa, username) VALUES ('ADJUST_IN', $1, $2, $3, $4)`, 
          [sku, qty, `Ref: ${docNum || 'S/N'}. LPN: ${lpnId}`, user]
        );
      } else {
        if (serial) {
          const resUpd = await client.query(
            'UPDATE inventory_lpns SET qty = 0 WHERE id = (SELECT id FROM inventory_lpns WHERE sku = $1 AND serial_number = $2 AND qty > 0 LIMIT 1) RETURNING id', 
            [sku, serial]
          );
          if(resUpd.rowCount === 0) throw new Error(`Serie ${serial} no disponible para mermar.`);
          await client.query(
            `INSERT INTO audit_log (type, sku, qty, glosa, username) VALUES ('ADJUST_OUT', $1, $2, $3, $4)`, 
            [sku, 1, `Ref: ${docNum || 'S/N'}. Merma Serie ${serial}`, user]
          );
        } else {
          let remaining = qty;
          const check = await client.query(
            'SELECT id, qty FROM inventory_lpns WHERE sku = $1 AND qty > 0 ORDER BY id ASC FOR UPDATE', 
            [sku]
          ); 
          
          let totalAvailable = check.rows.reduce((sum, r) => sum + parseFloat(r.qty), 0);
          if (remaining > totalAvailable) throw new Error(`Stock insuficiente para mermar SKU ${sku}. Se intentó sacar ${remaining}, pero solo quedan ${totalAvailable}.`);

          for (let row of check.rows) {
            if (remaining <= 0) break;
            let deduct = Math.min(parseFloat(row.qty), remaining);
            // Evitamos usar $1 dos veces aquí también
            await client.query(
              'UPDATE inventory_lpns SET qty = qty - $1 WHERE id = $2 AND qty >= $3', 
              [deduct, row.id, deduct]
            );
            remaining -= deduct;
          }
          await client.query(
            `INSERT INTO audit_log (type, sku, qty, glosa, username) VALUES ('ADJUST_OUT', $1, $2, $3, $4)`, 
            [sku, qty, `Ref: ${docNum || 'S/N'}. Merma FIFO`, user]
          );
        }
      }
    }
    await client.query('DELETE FROM inventory_lpns WHERE qty <= 0');
    if (docNum) await client.query('INSERT INTO processed_docs(doc_num,doc_type,client_id,processed_by) VALUES($1,$2,$3,$4)', [String(docNum).toUpperCase(), adjType, adjClientId, username || 'SYSTEM']);
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    if (isUniqueViolation(err)) return res.status(409).json({ error: `La hoja de ajuste '${docNum}' ya fue cerrada para este cliente. No se puede reutilizar.` });
    console.error("Error Adjust:", err.message);
    res.status(400).json({ error: err.message });
  } finally { client.release(); }
});

// ============ CSV EXPORT ============

app.get('/api/export/skus', requireAuth, async (req, res) => {
  try {
    // Columnas explícitas que coinciden con la plantilla de importación (round-trip):
    // export → editar → import. Se excluyen los SKU borrados (soft-delete) y columnas internas.
    const result = await pool.query(`
      SELECT sku, client_id, "desc", category, uom, weight, length, width, height, abc_class,
             requires_lot, requires_serial, barcode, manufacturer_code, manufacturer_sku, brand
        FROM master_skus
       WHERE deleted_at IS NULL
       ORDER BY client_id, sku ASC
    `);
    const rows = result.rows;
    if (rows.length === 0) return res.status(404).json({ error: 'Sin datos' });
    const headers = Object.keys(rows[0]);
    const dataRows = rows.map(r => headers.map(h => {
      const v = r[h];
      if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
      return v ?? '';
    }));
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([headers, ...dataRows]);
    ws['!cols'] = headers.map(() => ({ wch: 18 }));
    applyRowStyles(ws, 0, headers, xlsxHeaderStyle);
    ws['!freeze'] = { xSplit: 0, ySplit: 1 };
    XLSX.utils.book_append_sheet(wb, ws, 'SKUs');
    const date = new Date().toISOString().slice(0, 10);
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=skus_${date}.xlsx`);
    res.send(buf);
  } catch (err) { res.status(500).json({ error: mapDbError(err) }); }
});

app.get('/api/export/clients', requireAuth, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name, contact, email FROM clients ORDER BY name ASC');
    const rows = result.rows;
    if (rows.length === 0) return res.status(404).json({ error: 'Sin datos' });
    const headers = Object.keys(rows[0]).join(',');
    const csv = rows.map(r => Object.values(r).map(v => `"${v ?? ''}"`).join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=clientes.csv');
    res.send(headers + '\n' + csv);
  } catch (err) { res.status(500).json({ error: mapDbError(err) }); }
});

app.get('/api/export/inventory', requireAuth, async (req, res) => {
  try {
    const { client_id, sku, status } = req.query;
    let sql = `
      SELECT i.id AS "LPN ID", i.sku AS "SKU", s.desc AS "Descripción",
             i.client_id AS "Cliente", i.qty AS "Cantidad",
             i.status AS "Estado", i.location_id AS "Ubicación",
             i.batch_number AS "N° Lote", i.expiry_date AS "Vencimiento",
             i.serial_number AS "N° Serie", i.glosa AS "Glosa/Nota",
             i.created_at AS "Fecha Creación"
      FROM inventory_lpns i
      LEFT JOIN master_skus s ON i.sku = s.sku AND i.client_id = s.client_id
      WHERE i.qty > 0
    `;
    const params = [];
    if (client_id) { params.push(client_id); sql += ` AND i.client_id = $${params.length}`; }
    if (sku) { params.push(`%${sku}%`); sql += ` AND i.sku ILIKE $${params.length}`; }
    if (status) { params.push(status); sql += ` AND i.status = $${params.length}`; }
    sql += ' ORDER BY i.client_id, i.sku, i.created_at DESC';
    const result = await pool.query(sql, params);
    const rows = result.rows;
    if (rows.length === 0) return res.status(404).json({ error: 'Sin datos para exportar' });
    const headers = Object.keys(rows[0]);
    const descMap = {
      'LPN ID': 'Identificador único del pallet o caja (License Plate Number)',
      'SKU': 'Código del producto',
      'Descripción': 'Nombre o descripción del producto',
      'Cliente': 'Código del cliente dueño del stock',
      'Cantidad': 'Unidades actualmente en stock',
      'Estado': 'DISPONIBLE = libre para despacho | BLOQUEADO = no se puede despachar | CUARENTENA = en revisión',
      'Ubicación': 'Posición física en la bodega',
      'N° Lote': 'Número de lote o batch del proveedor',
      'Vencimiento': 'Fecha de vencimiento del lote (YYYY-MM-DD)',
      'N° Serie': 'Número de serie único del ítem',
      'Glosa/Nota': 'Observación o referencia interna',
      'Fecha Creación': 'Fecha y hora en que se ingresó el LPN al sistema',
    };
    const descriptions = headers.map(h => descMap[h] || '');
    const dataRows = rows.map(r => headers.map(h => {
      const v = r[h];
      if (v instanceof Date) return v.toISOString().split('T')[0];
      return v ?? '';
    }));
    const wb = XLSX.utils.book_new();
    const aoa = [headers, descriptions, ...dataRows];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = headers.map(() => ({ wch: 22 }));
    applyRowStyles(ws, 0, headers, xlsxHeaderStyle);
    applyRowStyles(ws, 1, headers, xlsxDescStyle);
    // Freeze top 2 rows
    ws['!freeze'] = { xSplit: 0, ySplit: 2 };
    XLSX.utils.book_append_sheet(wb, ws, 'Inventario');
    const date = new Date().toISOString().slice(0, 10);
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=inventario_${date}.xlsx`);
    res.send(buf);
  } catch (err) { res.status(500).json({ error: mapDbError(err) }); }
});

// ============ XLSX / CSV IMPORT ============

// Valida que el payload de importación tenga el tipo correcto
const validateImportBody = (body, res) => {
  if (!body.data || typeof body.data !== 'string') { res.status(400).json({ error: 'El campo data debe ser una cadena base64' }); return false; }
  if (body.filename !== undefined && typeof body.filename !== 'string') { res.status(400).json({ error: 'El campo filename debe ser una cadena' }); return false; }
  return true;
};

const parseFile = (data, filename) => {
  const buffer = Buffer.from(data, 'base64');
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { defval: '', raw: false });
};

// Origen de filas para los imports: el panel editable envía `rows` (array JSON ya
// corregido a mano); el flujo antiguo envía `data` (base64). Se acepta cualquiera
// para no romper retrocompatibilidad.
const getImportRows = (body) => {
  if (body && Array.isArray(body.rows)) return body.rows;
  if (body && typeof body.data === 'string') return parseFile(body.data, body.filename);
  return null;
};

// Valida filas de carga de stock contra el maestro (integridad referencial en la
// capa de aplicación). Pre-carga SKUs activos y ubicaciones en UNA sola query cada
// uno y valida en memoria (sin query por fila). Devuelve { valid, errors }, donde
// errors = [{ row, sku, message }] y cada `valid` queda normalizado para el insert.
//   forceClient:    si se pasa, todas las filas usan ese cliente (modo recepción 1 cliente).
//   defaultClient:  cliente por defecto cuando la fila no trae client_id.
//   defaultLocation: ubicación por defecto cuando la fila no trae location_id.
async function validateStockRows(db, rows, { forceClient = null, defaultClient = 'GENERAL', defaultLocation = 'PISO-RECEPCION' } = {}) {
  const norm = (v) => String(v ?? '').trim();
  const up = (v) => norm(v).toUpperCase();

  const prepared = rows.map((r, i) => ({
    row: i + 2, // +2: la fila 1 del Excel es la cabecera
    sku: up(r.sku),
    qtyRaw: r.qty ?? r.qty_to_pick ?? '',
    qty: parseFloat(r.qty ?? r.qty_to_pick),
    client_id: forceClient ? up(forceClient) : (up(r.client_id) || up(defaultClient)),
    location: norm(r.location_id) || defaultLocation,
    batch: norm(r.batch_number) || null,
    expiry: norm(r.expiry_date) || null,
    serial: norm(r.serial_number) || null,
    glosa: norm(r.glosa) || null,
  }));

  // SKUs activos (clave sku||client_id) + flags de trazabilidad.
  const skus = [...new Set(prepared.map(p => p.sku).filter(Boolean))];
  const skuMap = new Map();
  const skuAnyClient = new Set();
  if (skus.length) {
    const sr = await db.query(
      `SELECT sku, client_id, requires_lot, requires_serial FROM master_skus WHERE sku = ANY($1) AND deleted_at IS NULL`,
      [skus]
    );
    sr.rows.forEach(s => {
      skuMap.set(`${String(s.sku).toUpperCase()}||${String(s.client_id).toUpperCase()}`, s);
      skuAnyClient.add(String(s.sku).toUpperCase());
    });
  }

  // Ubicaciones existentes (PISO-RECEPCION siempre permitida).
  const locs = [...new Set(prepared.map(p => p.location).filter(Boolean))];
  const locSet = new Set(['PISO-RECEPCION']);
  if (locs.length) {
    const lr = await db.query(`SELECT location_id FROM locations_master WHERE location_id = ANY($1)`, [locs]);
    lr.rows.forEach(l => locSet.add(String(l.location_id)));
  }

  const valid = [];
  const errors = [];
  const fail = (p, message) => errors.push({ row: p.row, sku: p.sku || '(vacío)', message });

  for (const p of prepared) {
    if (!p.sku) { fail(p, 'SKU vacío'); continue; }
    if (p.qtyRaw === '' || isNaN(p.qty) || p.qty <= 0) { fail(p, 'La cantidad debe ser un número mayor a 0'); continue; }
    const meta = skuMap.get(`${p.sku}||${p.client_id}`);
    if (!meta) {
      if (skuAnyClient.has(p.sku)) fail(p, `El SKU '${p.sku}' no pertenece al cliente '${p.client_id}'`);
      else fail(p, `El SKU '${p.sku}' no existe o está inactivo`);
      continue;
    }
    if (meta.requires_lot && !p.batch) { fail(p, `El SKU '${p.sku}' requiere número de lote (batch_number)`); continue; }
    if (meta.requires_serial && !p.serial) { fail(p, `El SKU '${p.sku}' requiere número de serie`); continue; }
    if (meta.requires_serial && p.qty !== 1) { fail(p, `El SKU '${p.sku}' es serializado: la cantidad debe ser 1 por serie`); continue; }
    if (!locSet.has(p.location)) { fail(p, `La ubicación '${p.location}' no existe`); continue; }
    valid.push(p);
  }
  return { valid, errors };
}

// Plantillas descargables con fila de descripciones
const TEMPLATES = {
  skus: {
    headers: ['sku','client_id','desc','category','uom','weight','length','width','height','abc_class','requires_lot','requires_serial','barcode','manufacturer_code','manufacturer_sku','brand'],
    desc:    ['Código único del producto (ej: PROD-001)','Código del cliente dueño del SKU (ej: CLI-001)','Descripción o nombre del producto','Categoría (ej: Electrónica, Alimentos)','Unidad de medida: UN=unidad, KG=kilogramo, LT=litro','Peso en kilogramos (ej: 1.5)','Largo en centímetros','Ancho en centímetros','Alto en centímetros','Clasificación ABC: A=alta rotación, B=media, C=baja','¿Requiere lote? TRUE o FALSE','¿Requiere número de serie? TRUE o FALSE','Código de barras del producto (opcional)','Código del fabricante (debe existir en el maestro de fabricantes; opcional)','SKU del fabricante / nº de parte (opcional)','Marca del producto (opcional)'],
    example: ['PROD-001','CLI-001','Ejemplo Producto','General','UN','1.5','30','20','15','A','FALSE','FALSE','7891234567890','MFR-001','MP-9988','Marca Ejemplo'],
  },
  clients: {
    headers: ['id','name','contact','email'],
    desc:    ['Código único del cliente (ej: CLI-001)','Nombre o razón social completa','Nombre del contacto principal','Correo electrónico del contacto'],
    example: ['CLI-001','Empresa Ejemplo S.A.','Juan Pérez','juan@empresa.cl'],
  },
  inventory: {
    headers: ['sku','client_id','qty','location_id','batch_number','expiry_date','serial_number','glosa'],
    desc:    ['Código del producto (debe existir en maestro SKUs)','Código del cliente (debe existir en maestro clientes)','Cantidad a ingresar (número positivo)','Ubicación en bodega (ej: PISO-RECEPCION)','Número de lote (dejar vacío si no aplica)','Fecha de vencimiento en formato YYYY-MM-DD','Número de serie único (dejar vacío si no aplica)','Nota libre o referencia interna (opcional)'],
    example: ['PROD-001','CLI-001','100','PISO-RECEPCION','LOTE-2024-01','2025-12-31','','Ingreso inicial'],
  },
  receive: {
    headers: ['sku','qty','location_id','batch_number','expiry_date','serial_number','glosa'],
    desc:    ['Código del producto a recibir','Cantidad a recibir (número positivo)','Ubicación de destino (ej: PISO-RECEPCION)','Número de lote del proveedor (opcional)','Fecha vencimiento YYYY-MM-DD (opcional)','Número de serie (solo si el SKU lo requiere)','Observación o referencia del proveedor (opcional)'],
    example: ['PROD-001','50','PISO-RECEPCION','LOTE-2024-01','2025-12-31','','OC-12345'],
  },
  dispatch: {
    headers: ['sku','qty_to_pick','lpn_id'],
    desc:    ['Código del producto a despachar','Cantidad a despachar (número positivo)','ID del LPN específico (dejar vacío para selección automática FEFO)'],
    example: ['PROD-001','20',''],
  },
};

// Estilos de celda para xlsx
const xlsxHeaderStyle = { font:{ bold:true, color:{ rgb:'FFFFFF' } }, fill:{ fgColor:{ rgb:'1E293B' } }, alignment:{ horizontal:'center' } };
const xlsxDescStyle  = { font:{ italic:true, color:{ rgb:'475569' } }, fill:{ fgColor:{ rgb:'F1F5F9' } } };
const xlsxExampleStyle = { font:{ color:{ rgb:'166534' } }, fill:{ fgColor:{ rgb:'F0FDF4' } } };

const applyRowStyles = (ws, rowIdx, cols, style) => {
  cols.forEach((_, ci) => {
    const addr = XLSX.utils.encode_cell({ r: rowIdx, c: ci });
    if (!ws[addr]) ws[addr] = { t:'s', v:'' };
    ws[addr].s = style;
  });
};

app.get('/api/templates/:type', (req, res) => {
  const tpl = TEMPLATES[req.params.type];
  if (!tpl) return res.status(404).json({ error: 'Tipo no válido' });
  const wb = XLSX.utils.book_new();
  const aoa = [tpl.headers, tpl.desc, tpl.example];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = tpl.headers.map(() => ({ wch: 28 }));
  // Fila 0: headers oscuros
  applyRowStyles(ws, 0, tpl.headers, xlsxHeaderStyle);
  // Fila 1: descripciones en gris claro
  applyRowStyles(ws, 1, tpl.headers, xlsxDescStyle);
  // Fila 2: ejemplo en verde claro
  applyRowStyles(ws, 2, tpl.headers, xlsxExampleStyle);
  XLSX.utils.book_append_sheet(wb, ws, 'Datos');
  // Hoja de instrucciones
  const instrAoa = [
    ['INSTRUCCIONES DE USO'],
    [''],
    ['1. La fila 1 (gris) contiene las DESCRIPCIONES de cada columna — NO la elimines ni la envíes.'],
    ['2. La fila 2 (verde) es un EJEMPLO — reemplázala o elimínala antes de importar.'],
    ['3. Completa tus datos desde la fila 3 en adelante.'],
    ['4. Guarda como .xlsx o .csv antes de importar.'],
    ['5. El límite máximo es 10.000 filas por importación.'],
  ];
  const wsInstr = XLSX.utils.aoa_to_sheet(instrAoa);
  wsInstr['!cols'] = [{ wch: 70 }];
  wsInstr['A1'].s = { font:{ bold:true, sz:14 } };
  XLSX.utils.book_append_sheet(wb, wsInstr, 'Instrucciones');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename=plantilla_${req.params.type}.xlsx`);
  res.send(buf);
});

// Preview: devuelve primeras 5 filas parseadas
app.post('/api/import/:type/preview', requireAuth, (req, res) => {
  const { data, filename } = req.body;
  if (!data) return res.status(400).json({ error: 'Sin datos' });
  try {
    const rows = parseFile(data, filename);
    const headers = rows.length > 0 ? Object.keys(rows[0]) : (TEMPLATES[req.params.type] || []);
    res.json({ headers, rows: rows.slice(0, 5), total: rows.length });
  } catch (e) { res.status(400).json({ error: 'No se pudo parsear el archivo: ' + e.message }); }
});

// Dry-run de duplicados contra la BD (no inserta nada). Devuelve, por fila,
// errores/advertencias de serie/lote repetido y a nivel documento si ya fue
// procesado. Usado por el panel de previsualización antes de confirmar.
//  - receive: serie ya en stock (error), serie repetida en archivo (error),
//             lote ya con stock para el SKU (advertencia), documento procesado.
//  - dispatch: LPN inexistente o sin stock (error), documento procesado.
app.post('/api/import/:type/validate', requireAuth, async (req, res) => {
  const type = req.params.type;
  const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
  const docNum = req.body.doc_num ? String(req.body.doc_num).toUpperCase().trim() : null;
  const out = { doc_duplicate: false, rows: rows.map((_, i) => ({ index: i, warnings: [], errors: [] })) };
  try {
    if (docNum) {
      const dq = await pool.query('SELECT 1 FROM processed_docs WHERE doc_num=$1 LIMIT 1', [docNum]);
      out.doc_duplicate = dq.rows.length > 0;
    }

    if (type === 'receive') {
      const norm = (v) => String(v ?? '').trim();
      const upper = (v) => norm(v).toUpperCase();
      // Series existentes en stock (clave sku||serie).
      const serials = [...new Set(rows.map(r => norm(r.serial_number)).filter(Boolean))];
      const existingSerial = new Set();
      if (serials.length) {
        const sq = await pool.query('SELECT DISTINCT sku, serial_number FROM inventory_lpns WHERE serial_number = ANY($1) AND qty>0', [serials]);
        sq.rows.forEach(r => existingSerial.add(`${String(r.sku).toUpperCase()}||${r.serial_number}`));
      }
      // Lotes existentes en stock (clave sku||lote).
      const batches = [...new Set(rows.map(r => norm(r.batch_number)).filter(Boolean))];
      const existingBatch = new Set();
      if (batches.length) {
        const skusForBatch = [...new Set(rows.map(r => upper(r.sku)).filter(Boolean))];
        const bq = await pool.query('SELECT DISTINCT sku, batch_number FROM inventory_lpns WHERE batch_number = ANY($1) AND sku = ANY($2) AND qty>0', [batches, skusForBatch]);
        bq.rows.forEach(r => existingBatch.add(`${String(r.sku).toUpperCase()}||${r.batch_number}`));
      }
      // Series repetidas dentro del mismo archivo.
      const fileSerialCount = {};
      rows.forEach(r => { const s = norm(r.serial_number); if (s) fileSerialCount[s] = (fileSerialCount[s] || 0) + 1; });

      out.rows = rows.map((r, i) => {
        const sku = upper(r.sku), serial = norm(r.serial_number), batch = norm(r.batch_number);
        const errors = [], warnings = [];
        if (serial && existingSerial.has(`${sku}||${serial}`)) errors.push(`Serie '${serial}' ya existe en stock para ${sku}`);
        if (serial && fileSerialCount[serial] > 1) errors.push(`Serie '${serial}' repetida en el archivo`);
        if (batch && existingBatch.has(`${sku}||${batch}`)) warnings.push(`Lote '${batch}' ya tiene stock para ${sku} (se sumará al existente)`);
        return { index: i, warnings, errors };
      });
    } else if (type === 'dispatch') {
      const lpnIds = [...new Set(rows.map(r => String(r.lpn_id ?? '').trim()).filter(Boolean))];
      const withStock = new Set();
      if (lpnIds.length) {
        const lq = await pool.query('SELECT id FROM inventory_lpns WHERE id = ANY($1) AND qty>0', [lpnIds]);
        lq.rows.forEach(r => withStock.add(String(r.id)));
      }
      out.rows = rows.map((r, i) => {
        const lpn = String(r.lpn_id ?? '').trim();
        const errors = [];
        if (lpn && !withStock.has(lpn)) errors.push(`LPN '${lpn}' no existe o no tiene stock`);
        return { index: i, warnings: [], errors };
      });
    }
    res.json(out);
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

app.post('/api/import/skus', requireStockWrite, async (req, res) => {
  const { username } = req.body;
  const rows = getImportRows(req.body);
  if (!rows) return res.status(400).json({ error: 'Se requiere `rows` (filas) o `data` (base64).' });
  if (rows.length > 10000) return res.status(400).json({ error: 'Máximo 10.000 filas por importación' });
  // success = total procesados; inserted = nuevos; updated = existentes modificados;
  // versioned = SKUs cuyo control de lote/serie cambió con stock activo → bump de versión.
  const results = { success: 0, inserted: 0, updated: 0, versioned: [], errors: [] };
  const truthy = (v) => v === true || v === 'true' || v === 'TRUE' || v === '1' || v === 1;
  const seenKeys = new Set();
  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');
    // Mapa código de fabricante (mayúsculas) → id, para resolver manufacturer_code de cada fila.
    const mfMap = new Map();
    (await dbClient.query(`SELECT id, code FROM manufacturers`)).rows.forEach(m => mfMap.set(String(m.code).toUpperCase(), m.id));
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!r.sku || !r.desc) { results.errors.push(`Fila ${i+2}: SKU y descripción son obligatorios`); continue; }
      const skuNorm = String(r.sku).toUpperCase().trim();
      const clientNorm = (r.client_id || 'GENERAL').trim();
      const key = `${skuNorm}||${clientNorm}`;
      if (seenKeys.has(key)) { results.errors.push(`Fila ${i+2}: SKU '${skuNorm}' duplicado en este archivo — solo se procesará la primera aparición`); continue; }
      seenKeys.add(key);
      const newLot = truthy(r.requires_lot);
      const newSerial = truthy(r.requires_serial);
      // Fabricante / marca: el código se resuelve a manufacturer_id si existe en el maestro.
      const mfCode = (r.manufacturer_code != null && String(r.manufacturer_code).trim() !== '') ? String(r.manufacturer_code).trim() : null;
      const mfId = mfCode ? (mfMap.get(mfCode.toUpperCase()) ?? null) : null;
      if (mfCode && mfId === null) results.errors.push(`Fila ${i+2}: fabricante '${mfCode}' no existe en el maestro — se guardó el código sin vincular`);
      const mfSku = (r.manufacturer_sku != null && String(r.manufacturer_sku).trim() !== '') ? String(r.manufacturer_sku).trim() : null;
      const brandN = (r.brand != null && String(r.brand).trim() !== '') ? String(r.brand).trim() : null;
      const baseParams = [
        r.desc, r.category || 'General', r.uom || 'UN',
        parseFloat(r.weight) || 0, parseFloat(r.length) || 0,
        parseFloat(r.width) || 0, parseFloat(r.height) || 0,
        r.abc_class || null, r.barcode || null,
      ];

      const exists = await dbClient.query(`SELECT requires_lot, requires_serial, current_version FROM master_skus WHERE sku=$1 AND client_id=$2 LIMIT 1`, [skuNorm, clientNorm]);

      if (!exists.rows.length) {
        // Nuevo SKU
        await dbClient.query(`
          INSERT INTO master_skus (sku, client_id, "desc", category, uom, weight, length, width, height, abc_class, requires_lot, requires_serial, barcode, manufacturer_id, manufacturer_code, manufacturer_sku, brand)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
        `, [skuNorm, clientNorm, ...baseParams.slice(0, 8), newLot, newSerial, baseParams[8], mfId, mfCode, mfSku, brandN]);
        results.inserted++;
      } else {
        const cur = exists.rows[0];
        // Actualizar siempre los campos no versionados.
        await dbClient.query(`
          UPDATE master_skus SET "desc"=$1, category=$2, uom=$3, weight=$4, length=$5, width=$6, height=$7, abc_class=$8, barcode=$9, manufacturer_id=$12, manufacturer_code=$13, manufacturer_sku=$14, brand=$15
          WHERE sku=$10 AND client_id=$11
        `, [...baseParams, skuNorm, clientNorm, mfId, mfCode, mfSku, brandN]);

        const criticalChange = (newLot !== cur.requires_lot) || (newSerial !== cur.requires_serial);
        if (criticalChange) {
          const stockRow = await dbClient.query(`SELECT COALESCE(SUM(qty),0)::numeric AS total FROM inventory_lpns WHERE sku=$1 AND qty>0`, [skuNorm]);
          const stock = parseFloat(stockRow.rows[0].total) || 0;
          if (stock > 0) {
            // Cambio crítico con stock → bump de versión de control + snapshot.
            const vr = await dbClient.query(`SELECT * FROM create_sku_version($1, $2::jsonb, $3, $4)`,
              [skuNorm, JSON.stringify({ requires_lot: newLot, requires_serial: newSerial }), 'Cambio de control de lote/serie por importación masiva', username || 'IMPORT']);
            results.versioned.push({ sku: skuNorm, client_id: clientNorm, from: cur.current_version, to: vr.rows[0].new_version });
          } else {
            // Sin stock → actualizar in-place sin bump.
            await dbClient.query(`UPDATE master_skus SET requires_lot=$1, requires_serial=$2 WHERE sku=$3 AND client_id=$4`, [newLot, newSerial, skuNorm, clientNorm]);
            await dbClient.query(`
              INSERT INTO sku_version_history (sku, version, requires_lot, requires_serial, changed_by, reason)
              VALUES ($1,$2,$3,$4,$5,'Cambio sin stock — importación masiva')
              ON CONFLICT (sku, version) DO UPDATE SET requires_lot=EXCLUDED.requires_lot, requires_serial=EXCLUDED.requires_serial, changed_at=NOW(), changed_by=EXCLUDED.changed_by, reason=EXCLUDED.reason
            `, [skuNorm, cur.current_version, newLot, newSerial, username || 'IMPORT']);
          }
        }
        results.updated++;
      }
      results.success++;
    }
    await dbClient.query('COMMIT');
  } catch(err) {
    await dbClient.query('ROLLBACK');
    return res.status(500).json({ error: mapDbError(err) });
  } finally { dbClient.release(); }
  res.json(results);
});

app.post('/api/import/clients', requireJefe, async (req, res) => {
  const rows = getImportRows(req.body);
  if (!rows) return res.status(400).json({ error: 'Se requiere `rows` (filas) o `data` (base64).' });
  if (rows.length > 10000) return res.status(400).json({ error: 'Máximo 10.000 filas por importación' });
  const results = { success: 0, errors: [] };
  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!r.id || !r.name) { results.errors.push(`Fila ${i+2}: ID y nombre son obligatorios`); continue; }
      await dbClient.query(`INSERT INTO clients (id, name, contact, email) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, contact=EXCLUDED.contact, email=EXCLUDED.email`,
        [r.id, r.name, r.contact || '', r.email || '']);
      results.success++;
    }
    await dbClient.query('COMMIT');
  } catch(err) {
    await dbClient.query('ROLLBACK');
    return res.status(500).json({ error: mapDbError(err) });
  } finally { dbClient.release(); }
  res.json(results);
});

app.post('/api/import/inventory', requireStockWrite, async (req, res) => {
  const { username } = req.body;
  const rows = getImportRows(req.body);
  if (!rows) return res.status(400).json({ error: 'Se requiere `rows` (filas) o `data` (base64).' });
  if (rows.length > 10000) return res.status(400).json({ error: 'Máximo 10.000 filas por importación' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Integridad: validar cada fila contra el maestro (existe+activo, pertenece al
    // cliente, lote/serie, ubicación). Solo las válidas se insertan.
    const { valid, errors } = await validateStockRows(client, rows, { defaultClient: 'GENERAL', defaultLocation: 'PISO-RECEPCION' });
    if (valid.length > 0) {
      const validRows = valid.map(v => ({ ...v, lpnId: genLpnId('IMP') }));
      const invValues = validRows.map((_, idx) => `($${idx*9+1},$${idx*9+2},$${idx*9+3},$${idx*9+4},'DISPONIBLE',$${idx*9+5},$${idx*9+6},$${idx*9+7},$${idx*9+8},$${idx*9+9})`).join(',');
      const invParams = validRows.flatMap(r => [r.lpnId, r.sku, r.qty, r.client_id, r.batch, r.expiry, r.serial, r.location, r.glosa || 'Carga masiva']);
      await client.query(`INSERT INTO inventory_lpns (id,sku,qty,client_id,status,batch_number,expiry_date,serial_number,location_id,glosa) VALUES ${invValues}`, invParams);
      const audValues = validRows.map((_, idx) => `('INBOUND',$${idx*4+1},$${idx*4+2},$${idx*4+3},$${idx*4+4})`).join(',');
      const audParams = validRows.flatMap(r => [r.sku, r.qty, `Importación masiva. LPN: ${r.lpnId}`, username || 'IMPORT']);
      await client.query(`INSERT INTO audit_log (type,sku,qty,glosa,username) VALUES ${audValues}`, audParams);
    }
    await client.query('COMMIT');
    res.json({ imported: valid.length, success: valid.length, errors });
  } catch(err) {
    await client.query('ROLLBACK');
    return res.status(500).json({ error: mapDbError(err) });
  } finally { client.release(); }
});

app.post('/api/import/receive', stockWriteLimiter, requireStockWrite, checkClientAccess('write'), checkBatchSkuClientAccess(), async (req, res) => {
  const { username, client_id, doc_num } = req.body;
  const rows = getImportRows(req.body);
  if (!rows) return res.status(400).json({ error: 'Se requiere `rows` (filas) o `data` (base64).' });
  if (rows.length > 10000) return res.status(400).json({ error: 'Máximo 10.000 filas por importación' });
  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');
    // Integridad: si la recepción especifica client_id, todas las filas se validan
    // contra ese cliente (forceClient). Solo las válidas se insertan.
    const { valid, errors } = await validateStockRows(dbClient, rows, { forceClient: client_id || null, defaultClient: 'GENERAL', defaultLocation: 'PISO-RECEPCION' });
    for (const v of valid) {
      const lpnId = genLpnId('REC');
      await dbClient.query(`INSERT INTO inventory_lpns (id, sku, qty, client_id, status, batch_number, expiry_date, serial_number, location_id, glosa) VALUES ($1,$2,$3,$4,'DISPONIBLE',$5,$6,$7,$8,$9)`,
        [lpnId, v.sku, v.qty, v.client_id, v.batch, v.expiry, v.serial, v.location, v.glosa || `Recepción masiva ${doc_num || ''}`]);
      await dbClient.query(`INSERT INTO audit_log (type, sku, qty, glosa, username) VALUES ('INBOUND', $1, $2, $3, $4)`,
        [v.sku, v.qty, `Recepción masiva Doc:${doc_num || 'N/A'} LPN:${lpnId}`, username || 'IMPORT']);
      await logStorageEvent(dbClient, { client_id: v.client_id, event_type: 'MOVIMIENTO_IN', sku: v.sku, lpn_id: lpnId, qty: v.qty, location_id: v.location });
    }
    await dbClient.query('COMMIT');
    res.json({ imported: valid.length, success: valid.length, errors });
  } catch(err) {
    await dbClient.query('ROLLBACK');
    return res.status(500).json({ error: mapDbError(err) });
  } finally { dbClient.release(); }
});

app.post('/api/import/dispatch', stockWriteLimiter, requireStockWrite, checkClientAccess('write'), checkBatchSkuClientAccess(), async (req, res) => {
  const { username, doc_num } = req.body;
  const rows = getImportRows(req.body);
  if (!rows) return res.status(400).json({ error: 'Se requiere `rows` (filas) o `data` (base64).' });
  if (rows.length > 10000) return res.status(400).json({ error: 'Máximo 10.000 filas por importación' });
  const results = { success: 0, errors: [] };
  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!r.sku || !r.qty_to_pick || parseFloat(r.qty_to_pick) <= 0) { results.errors.push(`Fila ${i+2}: sku y qty_to_pick > 0 son obligatorios`); continue; }
      const qty = parseFloat(r.qty_to_pick);
      let remaining = qty;
      // lpn_id opcional: celda vacía, espacios o "NaN" → null (selección FEFO automática).
      const lpnRaw = r.lpn_id == null ? '' : String(r.lpn_id).trim();
      const lpnId = (lpnRaw === '' || lpnRaw.toLowerCase() === 'nan') ? null : lpnRaw;
      // Obtener IDs elegibles (con JOIN para filtro de estado, sin FOR UPDATE)
      const eligibleIds = (await dbClient.query(
        `SELECT i.id FROM inventory_lpns i
         LEFT JOIN statuses st ON i.status = st.id
         WHERE i.sku=$1 AND i.qty>0 AND COALESCE(st.blocks_outbound, FALSE) = FALSE
         ${lpnId ? 'AND i.id=$2' : ''}
         ORDER BY i.created_at ASC`,
        lpnId ? [r.sku, lpnId] : [r.sku]
      )).rows.map(row => row.id);
      // Bloquear solo inventory_lpns (sin JOIN) para evitar error PG con outer join + FOR UPDATE
      const lpns = eligibleIds.length === 0 ? [] : (await dbClient.query(
        `SELECT id, qty FROM inventory_lpns WHERE id = ANY($1::varchar[]) FOR UPDATE ORDER BY created_at ASC`,
        [eligibleIds]
      )).rows;
      for (const lpn of lpns) {
        if (remaining <= 0) break;
        const take = Math.min(remaining, parseFloat(lpn.qty));
        await dbClient.query(`UPDATE inventory_lpns SET qty=qty-$1 WHERE id=$2`, [take, lpn.id]);
        remaining -= take;
      }
      if (remaining > 0) { results.errors.push(`Fila ${i+2}: Stock insuficiente para ${r.sku} (faltan ${remaining})`); continue; }
      await dbClient.query(`INSERT INTO audit_log (type, sku, qty, glosa, username) VALUES ('OUTBOUND', $1, $2, $3, $4)`,
        [r.sku, qty, `Despacho masivo Doc:${doc_num || 'N/A'}`, username || 'IMPORT']);
      // Cobro 3PL: registrar movimiento de salida. Resolver client_id por SKU.
      const skuClient = (await dbClient.query('SELECT client_id FROM master_skus WHERE sku=$1 LIMIT 1', [r.sku])).rows[0]?.client_id;
      await logStorageEvent(dbClient, { client_id: skuClient, event_type: 'MOVIMIENTO_OUT', sku: r.sku, qty });
      results.success++;
    }
    await dbClient.query('DELETE FROM inventory_lpns WHERE qty <= 0');
    await dbClient.query('COMMIT');
  } catch(err) {
    await dbClient.query('ROLLBACK');
    return res.status(500).json({ error: mapDbError(err) });
  } finally { dbClient.release(); }
  res.json(results);
});

// ============ HISTORIAL STOCK ============
app.get('/api/inventory/history', requireAuth, async (req, res) => {
  try {
    const { date_from, date_to, sku, client_id, location_id } = req.query;
    let conditions = ['1=1'];
    let params = [];
    let idx = 1;
    if (date_from) { conditions.push(`i.created_at >= $${idx++}`); params.push(date_from); }
    if (date_to) { conditions.push(`i.created_at <= $${idx++}`); params.push(date_to + 'T23:59:59'); }
    if (sku) { conditions.push(`i.sku = $${idx++}`); params.push(sku); }
    if (client_id) { conditions.push(`i.client_id = $${idx++}`); params.push(client_id); }
    if (location_id) { conditions.push(`i.location_id ILIKE $${idx++}`); params.push(`%${location_id}%`); }
    const result = await pool.query(`
      SELECT i.*, s."desc", s.uom
      FROM inventory_lpns i
      LEFT JOIN master_skus s ON i.sku = s.sku
      WHERE ${conditions.join(' AND ')}
      ORDER BY i.created_at DESC NULLS LAST
      LIMIT 1000
    `, params);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: mapDbError(err) }); }
});
// ============ FIN CSV ============

// ============ MODO OPERACIÓN (3PL / PROPIO / HÍBRIDO) ============
// Defaults de modo bootstrap → cubiertos por migración 001_initial.

// Registrar eventos de almacenaje automáticamente
app.post('/api/storage/register-event', requireJefeOrAbove, async (req, res) => {
  const { client_id, event_type, sku, lpn_id, qty, weight_kg, location_id, unit_price } = req.body;
  try {
    await pool.query(`INSERT INTO storage_events (client_id,event_type,sku,lpn_id,qty,weight_kg,location_id,unit_price,total_amount)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$5*$8)`,
      [client_id, event_type, sku, lpn_id, parseFloat(qty)||0, parseFloat(weight_kg)||0, location_id, parseFloat(unit_price)||0]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});

// ── Helpers de cálculo de cobro 3PL ──────────────────────────────────────────
async function calcBillingCharges(clientId, month, year) {
  const y = parseInt(year) || new Date().getFullYear();
  const m = parseInt(month) || new Date().getMonth() + 1;
  const daysInMonth = new Date(y, m, 0).getDate();
  const dateFrom = `${y}-${String(m).padStart(2,'0')}-01`;
  const dateTo   = `${y}-${String(m).padStart(2,'0')}-${daysInMonth}`;

  // Tarifas del cliente (key → row)
  const tariffRows = await pool.query(`SELECT * FROM client_tariffs WHERE client_id=$1 AND active=TRUE`, [clientId]);
  const ct = {};
  tariffRows.rows.forEach(r => { ct[r.tariff_type] = r; });

  // Tarifas globales de sistema
  const gtRows = await pool.query(`SELECT key,value FROM system_config WHERE key IN ('3pl_pallet_day_price','3pl_movement_in_price','3pl_movement_out_price','3pl_currency','3pl_tax_rate')`);
  const gt = {};
  gtRows.rows.forEach(r => { gt[r.key] = r.value; });
  const currency = ct['MONEDA']?.description || gt['3pl_currency'] || 'CLP';

  const price = (type, globalKey, def) => parseFloat(ct[type]?.unit_price ?? gt[globalKey] ?? def);

  // Stock actual del cliente
  const stockQ = await pool.query(`
    SELECT COUNT(*) as lpn_count, SUM(i.qty) as total_qty,
      SUM(i.qty * COALESCE(s.weight,0)) as total_kg,
      COUNT(DISTINCT i.location_id) as locations_used
    FROM inventory_lpns i LEFT JOIN master_skus s ON i.sku=s.sku AND s.client_id=i.client_id
    WHERE i.client_id=$1 AND i.qty>0`, [clientId]);
  const stock = stockQ.rows[0];

  // Recepciones y despachos del período (document_history — más preciso)
  const docQ = await pool.query(`
    SELECT module, COUNT(*) as doc_count,
      SUM(total_qty) as total_qty
    FROM document_history
    WHERE client_id=$1 AND status='ACTIVO'
      AND created_at::date BETWEEN $2 AND $3
    GROUP BY module`, [clientId, dateFrom, dateTo]);
  const docMap = {};
  docQ.rows.forEach(r => { docMap[r.module] = r; });

  const lpnCount = parseInt(stock.lpn_count) || 0;
  const totalKg  = parseFloat(stock.total_kg) || 0;
  const locsUsed = parseInt(stock.locations_used) || 0;
  const receives = parseInt(docMap['receive']?.doc_count) || 0;
  const dispatches = parseInt(docMap['dispatch']?.doc_count) || 0;
  const recvQty  = parseFloat(docMap['receive']?.total_qty) || 0;
  const dispQty  = parseFloat(docMap['dispatch']?.total_qty) || 0;

  const charges = [];

  // Almacenaje — prioridad: LPN×día → KG×día → Ubicación×día
  if (ct['ALMACENAJE_LPN_DIA'] || (!ct['ALMACENAJE_KG_DIA'] && !ct['ALMACENAJE_UBICACION_DIA'])) {
    const p = price('ALMACENAJE_LPN_DIA','3pl_pallet_day_price',500);
    const subtotal = lpnCount * daysInMonth * p;
    charges.push({ type:'ALMACENAJE_LPN_DIA', label:'Almacenaje (LPN × día)', units:lpnCount, days:daysInMonth, unit_price:p, subtotal });
  }
  if (ct['ALMACENAJE_KG_DIA']) {
    const p = parseFloat(ct['ALMACENAJE_KG_DIA'].unit_price);
    charges.push({ type:'ALMACENAJE_KG_DIA', label:'Almacenaje (kg × día)', units:totalKg, days:daysInMonth, unit_price:p, subtotal:totalKg*daysInMonth*p });
  }
  if (ct['ALMACENAJE_UBICACION_DIA']) {
    const p = parseFloat(ct['ALMACENAJE_UBICACION_DIA'].unit_price);
    charges.push({ type:'ALMACENAJE_UBICACION_DIA', label:'Almacenaje (ubicación × día)', units:locsUsed, days:daysInMonth, unit_price:p, subtotal:locsUsed*daysInMonth*p });
  }

  // Recepciones
  const recvPrice = price('RECEPCION_DOC','3pl_movement_in_price',1500);
  if (receives > 0) charges.push({ type:'RECEPCION_DOC', label:'Recepciones (documentos)', units:receives, unit_price:recvPrice, subtotal:receives*recvPrice, detail:`${recvQty.toFixed(0)} unidades recibidas` });

  // Despachos
  const dispPrice = price('DESPACHO_DOC','3pl_movement_out_price',2000);
  if (dispatches > 0) charges.push({ type:'DESPACHO_DOC', label:'Despachos (documentos)', units:dispatches, unit_price:dispPrice, subtotal:dispatches*dispPrice, detail:`${dispQty.toFixed(0)} unidades despachadas` });

  // Maquila
  if (ct['MAQUILA_HORA']) {
    const p = parseFloat(ct['MAQUILA_HORA'].unit_price);
    const hrs = parseFloat(ct['MAQUILA_HORA'].description) || 0;
    if (hrs > 0) charges.push({ type:'MAQUILA_HORA', label:'Maquila / Valor Agregado', units:hrs, unit_price:p, subtotal:hrs*p });
  }

  // Cargos y créditos adicionales (AJUSTE_*)
  tariffRows.rows.filter(r=>r.tariff_type.startsWith('AJUSTE')).forEach(r => {
    charges.push({ type:r.tariff_type, label:r.description||r.tariff_type, units:1, unit_price:parseFloat(r.unit_price), subtotal:parseFloat(r.unit_price) });
  });

  let subtotal = charges.reduce((a,c) => a + (c.subtotal||0), 0);

  // Mínimo mensual
  let minimoAplicado = false;
  if (ct['MINIMO_MENSUAL']) {
    const minVal = parseFloat(ct['MINIMO_MENSUAL'].unit_price);
    if (subtotal < minVal) { subtotal = minVal; minimoAplicado = true; }
  }

  // IVA
  const taxRate = parseFloat(ct['IVA']?.unit_price ?? gt['3pl_tax_rate'] ?? 0);
  const taxAmount = subtotal * taxRate / 100;
  const total = subtotal + taxAmount;

  return {
    client_id: clientId, period: `${String(m).padStart(2,'0')}/${y}`,
    month: m, year: y, days_in_month: daysInMonth,
    stock: { lpn_count:lpnCount, total_qty:stock.total_qty, total_kg:totalKg, locations_used:locsUsed },
    movements: { receives, dispatches, recv_qty:recvQty, disp_qty:dispQty },
    charges, subtotal, tax_rate:taxRate, tax_amount:taxAmount, total,
    minimo_aplicado: minimoAplicado,
    minimo_mensual: ct['MINIMO_MENSUAL'] ? parseFloat(ct['MINIMO_MENSUAL'].unit_price) : null,
    currency
  };
}

app.get('/api/report/billing/:client_id', requireAuth, async (req, res) => {
  try {
    const data = await calcBillingCharges(req.params.client_id, req.query.month, req.query.year);
    res.json(data);
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});

// ============ ANÁLISIS DE INVENTARIO ============

// Ingresos de SKU: agrupa inventory_lpns por SKU con totales y fecha último ingreso
app.get('/api/analytics/sku-entries', requireAuth, async (req, res) => {
  const { client_id, date_from, date_to, search } = req.query;
  let conditions = ['1=1']; let params = []; let idx = 1;
  if (client_id) { conditions.push(`il.client_id = $${idx++}`); params.push(client_id); }
  if (date_from) { conditions.push(`il.created_at >= $${idx++}`); params.push(date_from); }
  if (date_to)   { conditions.push(`il.created_at <= $${idx++}`); params.push(date_to + 'T23:59:59'); }
  if (search)    { conditions.push(`(il.sku ILIKE $${idx} OR ms."desc" ILIKE $${idx})`); params.push(`%${search}%`); idx++; }
  try {
    const result = await pool.query(`
      SELECT
        il.sku,
        il.client_id,
        ms."desc"                                  AS descripcion,
        ms.uom,
        COUNT(il.id)::int                          AS num_lpns,
        COALESCE(SUM(il.qty), 0)::float            AS qty_total,
        MIN(il.created_at)                         AS primer_ingreso,
        MAX(il.created_at)                         AS ultimo_ingreso,
        COUNT(DISTINCT il.batch_number)::int       AS num_lotes,
        COUNT(DISTINCT il.location_id)::int        AS num_ubicaciones
      FROM inventory_lpns il
      LEFT JOIN master_skus ms ON ms.sku = il.sku
      WHERE ${conditions.join(' AND ')}
      GROUP BY il.sku, il.client_id, ms."desc", ms.uom
      ORDER BY ultimo_ingreso DESC NULLS LAST
      LIMIT 500
    `, params);
    res.json(result.rows);
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});

// Últimos movimientos por cliente: desde document_history (tiene client_id, module, total_qty)
app.get('/api/analytics/client-movements', requireAuth, async (req, res) => {
  const { client_id, date_from, date_to, module: modFilter } = req.query;
  let conditions = ["dh.status != 'ANULADO'"]; let params = []; let idx = 1;
  if (client_id)  { conditions.push(`dh.client_id = $${idx++}`); params.push(client_id); }
  if (date_from)  { conditions.push(`dh.created_at >= $${idx++}`); params.push(date_from); }
  if (date_to)    { conditions.push(`dh.created_at <= $${idx++}`); params.push(date_to + 'T23:59:59'); }
  if (modFilter)  { conditions.push(`dh.module = $${idx++}`); params.push(modFilter); }
  try {
    const result = await pool.query(`
      SELECT
        dh.client_id,
        c.name                                     AS cliente_nombre,
        dh.module,
        dh.doc_type,
        dh.doc_num,
        dh.status,
        dh.username,
        dh.glosa,
        COALESCE(dh.total_qty, 0)::float           AS total_qty,
        dh.created_at
      FROM document_history dh
      LEFT JOIN clients c ON c.id = dh.client_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY dh.created_at DESC
      LIMIT 500
    `, params);
    res.json(result.rows);
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});

// ── Guardar factura ────────────────────────────────────────────────────────────
app.post('/api/billing/invoices', requireJefeOrAbove, checkClientAccess('write', { required: true }), async (req, res) => {
  const { client_id, month, year, notes, due_date } = req.body;
  if (!client_id) return res.status(400).json({ error: 'client_id requerido.' });
  try {
    const data = await calcBillingCharges(client_id, month, year);
    const id = `INV-${client_id}-${String(data.month).padStart(2,'0')}${data.year}-${Date.now().toString(36).toUpperCase()}`;
    await pool.query(
      `INSERT INTO billing_invoices (id,client_id,period,month,year,subtotal,tax_rate,tax_amount,total,currency,status,notes,charges_json,issued_by,due_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'EMITIDA',$11,$12,$13,$14)`,
      [id, client_id, data.period, data.month, data.year, data.subtotal, data.tax_rate, data.tax_amount, data.total,
       data.currency, notes||null, JSON.stringify(data.charges), req.user.username, due_date||null]
    );
    res.json({ success:true, id, data });
  } catch(e) {
    if (isUniqueViolation(e)) return res.status(409).json({ error: `Ya existe una factura para el cliente '${client_id}' en ese período (${month||'?'}/${year||'?'}).` });
    res.status(500).json({ error: mapDbError(e) });
  }
});

app.get('/api/billing/invoices', requireAuth, async (req, res) => {
  const { client_id, month, year, status } = req.query;
  try {
    let conds = ['1=1']; let params = []; let idx = 1;
    if (client_id) { conds.push(`client_id=$${idx++}`); params.push(client_id); }
    if (month)     { conds.push(`month=$${idx++}`); params.push(parseInt(month)); }
    if (year)      { conds.push(`year=$${idx++}`); params.push(parseInt(year)); }
    if (status)    { conds.push(`status=$${idx++}`); params.push(status); }
    const result = await pool.query(`SELECT * FROM billing_invoices WHERE ${conds.join(' AND ')} ORDER BY issued_at DESC LIMIT 500`, params);
    res.json(result.rows);
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});

app.patch('/api/billing/invoices/:id/status', requireJefeOrAbove, async (req, res) => {
  const { status, notes } = req.body;
  const allowed = ['EMITIDA','PAGADA','ANULADA','VENCIDA'];
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Estado inválido.' });
  try {
    const paidAt = status === 'PAGADA' ? 'NOW()' : 'paid_at';
    await pool.query(
      `UPDATE billing_invoices SET status=$1, paid_at=${status==='PAGADA'?'NOW()':'paid_at'}, notes=COALESCE($2,notes) WHERE id=$3`,
      [status, notes||null, req.params.id]
    );
    res.json({ success:true });
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});

// Resumen de todos los clientes para un período
app.get('/api/billing/summary', requireJefeOrAbove, async (req, res) => {
  const { month, year } = req.query;
  try {
    const clientsQ = await pool.query(`SELECT id, name FROM clients ORDER BY name`);
    const invoicesQ = await pool.query(
      `SELECT client_id, status, total, currency FROM billing_invoices WHERE month=$1 AND year=$2`,
      [parseInt(month)||new Date().getMonth()+1, parseInt(year)||new Date().getFullYear()]
    );
    const invMap = {};
    invoicesQ.rows.forEach(r => { invMap[r.client_id] = r; });

    const BATCH = 5;
    const results = [];
    for (let i = 0; i < clientsQ.rows.length; i += BATCH) {
      const batch = clientsQ.rows.slice(i, i + BATCH);
      const batchResults = await Promise.all(batch.map(async c => {
        try {
          const d = await calcBillingCharges(c.id, month, year);
          return { client_id:c.id, client_name:c.name, total:d.total, currency:d.currency,
            lpn_count:d.stock.lpn_count, receives:d.movements.receives, dispatches:d.movements.dispatches,
            invoice: invMap[c.id] || null };
        } catch { return { client_id:c.id, client_name:c.name, total:0, currency:'CLP', error:true }; }
      }));
      results.push(...batchResults);
    }
    res.json(results);
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});

// Guardar tarifas personalizadas por cliente
app.post('/api/client-tariffs', requireJefe, checkClientAccess('write', { required: true }), async (req, res) => {
  const { client_id, tariff_type, unit_price, currency, description } = req.body;
  if (!client_id || !tariff_type) return res.status(400).json({ error: 'client_id y tariff_type son requeridos.' });
  try {
    // UPSERT: si ya existe la tarifa para ese cliente+tipo, actualiza el precio
    await pool.query(
      `INSERT INTO client_tariffs (client_id,tariff_type,unit_price,currency,description)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (client_id, tariff_type)
       DO UPDATE SET unit_price=EXCLUDED.unit_price, currency=EXCLUDED.currency, description=EXCLUDED.description`,
      [client_id, tariff_type, parseFloat(unit_price)||0, currency||'CLP', description||'']);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});

app.delete('/api/client-tariffs/:id', requireJefe, async (req, res) => {
  try {
    await pool.query(`DELETE FROM client_tariffs WHERE id = $1`, [req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});

app.get('/api/client-tariffs/:client_id', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM client_tariffs WHERE client_id = $1 ORDER BY created_at DESC`, [req.params.client_id]);
    res.json(result.rows);
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});

// ============ CONFIGURACIÓN GLOBAL SISTEMA ============
// Defaults de system_config bootstrap → cubiertos por migración 001_initial.

app.get('/api/system/config', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM system_config`);
    const config = {};
    result.rows.forEach(r => { config[r.key] = r.value; });
    res.json(config);
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});

app.post('/api/system/config', requireSuperAdmin, async (req, res) => {
  const { configs } = req.body;
  const requester = req.user.username; // usar req.user, no el body (SEC-07)
  if (!configs || typeof configs !== 'object') return res.status(400).json({ error: 'configs debe ser un objeto' });
  try {
    for (const [key, value] of Object.entries(configs)) {
      await pool.query(`INSERT INTO system_config (key, value, updated_by, updated_at) VALUES ($1,$2,$3,NOW()) ON CONFLICT (key) DO UPDATE SET value=$2, updated_by=$3, updated_at=NOW()`,
        [key, String(value), requester]);
    }
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});

// Middleware mantenimiento — agregar verificación en login
app.post('/api/system/maintenance/check', async (req, res) => {
  try {
    const result = await pool.query(`SELECT value FROM system_config WHERE key='maintenance_mode'`).catch(()=>({rows:[{value:'false'}]}));
    const msg = await pool.query(`SELECT value FROM system_config WHERE key='maintenance_message'`).catch(()=>({rows:[{value:'Sistema en mantenimiento.'}]}));
    res.json({
      maintenance: result.rows[0]?.value === 'true',
      message: msg.rows[0]?.value || 'Sistema en mantenimiento.'
    });
  } catch(e) { res.json({ maintenance: false, message: '' }); }
});

// ============ ÓRDENES DE COMPRA ============

// ============ HISTORIAL DOCUMENTOS CERRADOS ============
app.post('/api/document-history', requireAuth, async (req, res) => {
  const { id, module, doc_num, doc_type, glosa, username, items, doc_date, doc_ref, entered_at, client_id } = req.body;
  try {
    const totalQty = items.reduce((sum, i) => sum + parseFloat(i.qty || i.qtyToPick || 0), 0);
    await pool.query(
      `INSERT INTO document_history (id,module,doc_num,doc_type,glosa,username,items_json,total_qty,doc_date,doc_ref,entered_at,client_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (id) DO NOTHING`,
      [id, module, doc_num, doc_type||'', glosa||'', username, JSON.stringify(items), totalQty,
       doc_date||null, doc_ref||null, entered_at||null, client_id||'']
    );
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});

app.get('/api/document-history', requireAuth, async (req, res) => {
  const { module, search, date_from, date_to, limit: qLimit, offset: qOffset } = req.query;
  try {
    let conds = ['1=1']; let params = []; let idx = 1;
    if (module) { conds.push(`module = $${idx++}`); params.push(module); }
    if (search) { conds.push(`(doc_num ILIKE $${idx} OR glosa ILIKE $${idx} OR username ILIKE $${idx})`); params.push(`%${search}%`); idx++; }
    if (date_from) { conds.push(`created_at >= $${idx++}`); params.push(date_from); }
    if (date_to) { conds.push(`created_at <= $${idx++}`); params.push(date_to + 'T23:59:59'); }
    const limit = Math.min(parseInt(qLimit) || 500, 2000);
    const offset = Math.max(parseInt(qOffset) || 0, 0);
    params.push(limit); params.push(offset);
    const result = await pool.query(`SELECT * FROM document_history WHERE ${conds.join(' AND ')} ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`, params);
    res.json(result.rows);
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});

// ============ BARCODE LOOKUP ============
app.get('/api/skus/barcode/:barcode', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM master_skus WHERE barcode = $1 LIMIT 1`, [req.params.barcode]);
    if (result.rows.length > 0) res.json({ found: true, sku: result.rows[0] });
    else res.json({ found: false });
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});

// ============ MATERIALES Y HH ============
app.get('/api/sku-resources', requireAuth, async (req, res) => {
  const { sku, client_id } = req.query;
  if (!sku || !client_id) return res.status(400).json({ error: 'Se requieren sku y client_id.' });
  try {
    const result = await pool.query(
      `SELECT * FROM sku_resources WHERE sku=$1 AND client_id=$2 ORDER BY resource_type, resource_name`,
      [sku, client_id]
    );
    res.json(result.rows);
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});

app.post('/api/sku-resources', requireJefeOrAbove, async (req, res) => {
  const { sku, client_id, resource_type, resource_name, qty_per_unit, unit, hours_per_unit, time_unit, personnel_count, notes } = req.body;
  if (!sku || !client_id) return res.status(400).json({ error: 'Se requieren sku y client_id.' });
  if (!resource_name || !String(resource_name).trim()) return res.status(400).json({ error: 'Nombre del recurso es requerido.' });
  const rType = (resource_type === 'HH') ? 'HH' : 'MATERIAL';
  const qtyVal = parseFloat(qty_per_unit) || 1;
  const hrsVal = parseFloat(hours_per_unit) || 0;
  const tUnit = (time_unit === 'MINUTOS') ? 'MINUTOS' : 'HORAS';
  const persVal = parseInt(personnel_count) || 1;
  if (qtyVal <= 0) return res.status(400).json({ error: 'qty_per_unit debe ser mayor a 0.' });
  try {
    const result = await pool.query(
      `INSERT INTO sku_resources (sku, client_id, resource_type, resource_name, qty_per_unit, unit, hours_per_unit, time_unit, personnel_count, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (sku, client_id, resource_type, resource_name)
       DO UPDATE SET qty_per_unit=EXCLUDED.qty_per_unit, unit=EXCLUDED.unit,
         hours_per_unit=EXCLUDED.hours_per_unit, time_unit=EXCLUDED.time_unit,
         personnel_count=EXCLUDED.personnel_count, notes=EXCLUDED.notes
       RETURNING *`,
      [sku, client_id, rType, String(resource_name).trim(), qtyVal, unit || 'UN', hrsVal, tUnit, persVal, notes || null]
    );
    res.json(result.rows[0]);
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});

app.delete('/api/sku-resources/:id', requireJefeOrAbove, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('DELETE FROM sku_resources WHERE id=$1', [id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Recurso no encontrado.' });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});

app.post('/api/skus/alerts', requireJefeOrAbove, async (req, res) => {
  const { sku, client_id, stock_min, stock_max } = req.body;
  if (!sku) return res.status(400).json({ error: 'SKU es requerido.' });
  const minVal = parseFloat(stock_min) || 0;
  const maxVal = parseFloat(stock_max) || 0;
  if (minVal < 0 || maxVal < 0) return res.status(400).json({ error: 'Los valores de alerta no pueden ser negativos.' });
  if (maxVal > 0 && minVal > maxVal) return res.status(400).json({ error: `stock_min (${minVal}) no puede ser mayor que stock_max (${maxVal}).` });
  try {
    const result = await pool.query(`UPDATE master_skus SET stock_min=$1, stock_max=$2 WHERE sku=$3 AND client_id=$4`,
      [minVal, maxVal, sku, client_id||'GENERAL']);
    if (result.rowCount === 0) return res.status(404).json({ error: 'SKU no encontrado para ese cliente.' });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});

app.get('/api/alerts/stock', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT s.sku, s."desc", s.client_id, s.uom, s.stock_min, s.stock_max,
        COALESCE(SUM(i.qty),0) as current_stock
      FROM master_skus s
      LEFT JOIN inventory_lpns i ON s.sku = i.sku AND i.qty > 0
      WHERE s.stock_min > 0 OR s.stock_max > 0
      GROUP BY s.sku, s."desc", s.client_id, s.uom, s.stock_min, s.stock_max
      HAVING (s.stock_min > 0 AND COALESCE(SUM(i.qty),0) < s.stock_min)
          OR (s.stock_max > 0 AND COALESCE(SUM(i.qty),0) > s.stock_max)
      ORDER BY s.sku
    `);
    res.json(result.rows);
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});

// ============ HISTORIAL LPN ============
app.get('/api/lpn/search', requireAuth, async (req, res) => {
  const { sku, from, to, client_id } = req.query;
  if (!sku && !from && !to) return res.status(400).json({ error: 'Se requiere al menos un filtro: sku, from o to' });
  try {
    const conds = ['1=1'];
    const params = [];
    if (sku) { params.push(`%${sku.toUpperCase()}%`); conds.push(`i.sku ILIKE $${params.length}`); }
    if (client_id) { params.push(client_id); conds.push(`i.client_id = $${params.length}`); }
    if (from) { params.push(from); conds.push(`i.created_at >= $${params.length}::date`); }
    if (to) { params.push(to); conds.push(`i.created_at <= $${params.length}::date + INTERVAL '1 day'`); }
    const q = `SELECT i.id, i.sku, i.qty, i.status, i.location_id, i.client_id, i.batch_number, i.expiry_date, i.created_at
               FROM inventory_lpns i WHERE ${conds.join(' AND ')}
               ORDER BY i.created_at DESC LIMIT 200`;
    res.json({ lpns: (await pool.query(q, params)).rows });
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});

app.get('/api/lpn/history/:lpnId', requireAuth, async (req, res) => {
  try {
    const safeId = req.params.lpnId.replace(/[%_\\]/g, '\\$&');
    const logs = await pool.query(
      `SELECT * FROM audit_log WHERE glosa ILIKE $1 ESCAPE '\\' ORDER BY created_at ASC`,
      [`%${safeId}%`]
    );
    const current = await pool.query(`SELECT * FROM inventory_lpns WHERE id = $1`, [req.params.lpnId]);
    res.json({ logs: logs.rows, current: current.rows[0] || null });
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});

// ============ STOCK SNAPSHOT POR FECHA ============
app.get('/api/inventory/snapshot', requireAuth, async (req, res) => {
  const { date, sku, client_id } = req.query;
  if (!date) return res.status(400).json({ error: 'Se requiere fecha' });
  try {
    const snapshotDate = new Date(date);
    snapshotDate.setHours(23, 59, 59, 999);

    let conditions = [`i.created_at <= $1`];
    let params = [snapshotDate.toISOString()];
    let idx = 2;
    if (sku) { conditions.push(`i.sku = $${idx++}`); params.push(sku); }
    if (client_id) { conditions.push(`i.client_id = $${idx++}`); params.push(client_id); }

    // Calcular qty al momento de la fecha usando audit_log
    const result = await pool.query(`
      WITH lpn_created AS (
        SELECT i.id, i.sku, i.client_id, i.location_id, i.status,
               i.batch_number, i.expiry_date, i.serial_number, i.created_at,
               s."desc", s.uom
        FROM inventory_lpns i
        LEFT JOIN master_skus s ON i.sku = s.sku
        WHERE ${conditions.join(' AND ')}
      ),
      inbound_qty AS (
        SELECT a.glosa, SUM(a.qty) as qty_in
        FROM audit_log a
        WHERE a.type IN ('INBOUND','ADJUST_IN')
          AND a.created_at <= $1
        GROUP BY a.glosa
      ),
      outbound_qty AS (
        SELECT a.glosa, SUM(a.qty) as qty_out
        FROM audit_log a
        WHERE a.type IN ('OUTBOUND','ADJUST_OUT')
          AND a.created_at <= $1
        GROUP BY a.glosa
      )
      SELECT lc.*, lc.id as lpn_id
      FROM lpn_created lc
      ORDER BY lc.created_at DESC
    `, params);

    // Una sola query agrupa inbound y outbound (REN-06)
    const lpns = result.rows;
    const auditLogs = await pool.query(`
      SELECT glosa,
        SUM(CASE WHEN type IN ('INBOUND','ADJUST_IN')  THEN qty ELSE 0 END) AS qty_in,
        SUM(CASE WHEN type IN ('OUTBOUND','ADJUST_OUT') THEN qty ELSE 0 END) AS qty_out
      FROM audit_log
      WHERE type IN ('INBOUND','ADJUST_IN','OUTBOUND','ADJUST_OUT') AND created_at <= $1
      GROUP BY glosa
    `, [snapshotDate.toISOString()]);

    const movMap = {};
    auditLogs.rows.forEach(r => {
      const match = r.glosa.match(/LPN[:\s]+([A-Z0-9\-]+)/i);
      if (match) {
        const lpnId = match[1];
        if (!movMap[lpnId]) movMap[lpnId] = { in: 0, out: 0 };
        movMap[lpnId].in  += parseFloat(r.qty_in);
        movMap[lpnId].out += parseFloat(r.qty_out);
      }
    });

    const withQty = lpns.map(lpn => {
      const qtyIn  = movMap[lpn.id]?.in  || 0;
      const qtyOut = movMap[lpn.id]?.out || 0;
      const estimatedQty = Math.max(0, qtyIn - qtyOut);
      return { ...lpn, qty: estimatedQty, qty_in: qtyIn, qty_out: qtyOut };
    }).filter(l => l.qty > 0);

    res.json(withQty);
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});

// ============ CONTEOS CÍCLICOS → routes/cycle-count.js ============

// ============ REPORTE OCUPACIÓN POR ZONA ============

// ============ DEVOLUCIONES → routes/returns.js ============

// ============ SUPERADMIN ============

// Middleware verificar superadmin
const isSuperAdmin = async (req, res, next) => {
  const { username } = req.body.auth || req.query;
  if (!username) return res.status(403).json({ error: 'No autorizado' });
  try {
    const u = await pool.query("SELECT role FROM users WHERE username = $1", [username]);
    if (u.rows.length === 0 || u.rows[0].role !== 'SUPERADMIN') return res.status(403).json({ error: 'Requiere SUPERADMIN' });
    next();
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
};

// Métricas del sistema
app.get('/api/system/metrics', requireAdmin, async (req, res) => {
  try {
    const [invCount, skuCount, clientCount, auditCount, userCount, topSkus, recentActivity] = await Promise.all([
      pool.query("SELECT COUNT(*) as total, COALESCE(SUM(qty),0) as units FROM inventory_lpns WHERE qty > 0"),
      pool.query("SELECT COUNT(*) as total FROM master_skus"),
      pool.query("SELECT COUNT(*) as total FROM clients"),
      pool.query("SELECT COUNT(*) as total FROM audit_log"),
      pool.query("SELECT COUNT(*) as total, role, COUNT(*) FROM users GROUP BY role"),
      pool.query("SELECT sku, SUM(qty) as total_qty FROM inventory_lpns WHERE qty > 0 GROUP BY sku ORDER BY total_qty DESC LIMIT 5"),
      pool.query("SELECT type, COUNT(*) as count FROM audit_log WHERE created_at >= NOW() - INTERVAL '7 days' GROUP BY type ORDER BY count DESC")
    ]);
    res.json({
      inventory: { lpns: parseInt(invCount.rows[0].total), units: parseFloat(invCount.rows[0].units) },
      skus: parseInt(skuCount.rows[0].total),
      clients: parseInt(clientCount.rows[0].total),
      auditLogs: parseInt(auditCount.rows[0].total),
      usersByRole: userCount.rows,
      topSkus: topSkus.rows,
      recentActivity: recentActivity.rows
    });
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});

// Endpoint de contraseñas eliminado por seguridad (SEC-07)
app.post('/api/system/users/passwords', (req, res) => {
  res.status(410).json({ error: 'Endpoint eliminado por políticas de seguridad. Las contraseñas se almacenan con bcrypt.' });
});

// Eliminar registro de inventario directo
app.delete('/api/system/inventory/:id', requireSuperAdmin, async (req, res) => {
  const requester = req.user.username; // SEC: usar JWT verificado, no body
  try {
    const inv = await pool.query("SELECT * FROM inventory_lpns WHERE id = $1", [req.params.id]);
    if (!inv.rows.length) return res.status(404).json({ error: 'LPN no encontrado' });
    await pool.query("DELETE FROM inventory_lpns WHERE id = $1", [req.params.id]);
    await pool.query("INSERT INTO audit_log (type, sku, qty, glosa, username) VALUES ('ADJUST_OUT', $1, $2, $3, $4)",
      [inv.rows[0].sku, inv.rows[0].qty, `[SUPERADMIN] Eliminación directa de LPN ${req.params.id}`, requester]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});

// Eliminar log de auditoría
app.delete('/api/system/audit/:id', requireSuperAdmin, async (req, res) => {
  try {
    await pool.query("DELETE FROM audit_log WHERE id = $1", [req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});

// Limpiar todos los logs de auditoría
app.delete('/api/system/audit', requireSuperAdmin, async (req, res) => {
  try {
    await pool.query("TRUNCATE audit_log RESTART IDENTITY");
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});

// FORMATEO DE FÁBRICA: deja el sistema "como recién instalado".
// Borra TODOS los datos de negocio pero PRESERVA: el esqueleto base (statuses,
// document_types, system_config = licencia/config) y los usuarios SUPERADMIN
// (para no quedar bloqueado). Hace un backup de seguridad ANTES (reversible con
// recover.js o el restore). Requiere confirm:'FORMATEAR' (también valida el server,
// no solo el front). IRREVERSIBLE salvo por el backup previo.
const FACTORY_PRESERVE = ['statuses', 'document_types', 'system_config'];
app.post('/api/system/factory-reset', requireSuperAdmin, async (req, res) => {
  if (req.body?.confirm !== 'FORMATEAR') return res.status(400).json({ error: "Confirmación inválida: envía confirm:'FORMATEAR'." });
  let backupName = null;
  try {
    // 1) Backup de seguridad ANTES de borrar. Si falla, abortar (no borrar sin red).
    try {
      const b = await backupsRouter.ejecutarBackup('PRE_FORMAT', req.user.username);
      backupName = b?.filename || null;
    } catch (e) {
      return res.status(500).json({ error: 'No se pudo crear el backup de seguridad previo; formateo abortado: ' + e.message });
    }

    // 2) Capturar el esqueleto a preservar (antes del wipe).
    const supers = (await pool.query(`SELECT * FROM users WHERE role='SUPERADMIN'`)).rows;
    const preserved = {};
    for (const t of FACTORY_PRESERVE) preserved[t] = (await pool.query(`SELECT * FROM ${t}`)).rows;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // 3) Vaciar TODO menos la tabla de migraciones.
      const tbls = (await client.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> 'schema_migrations'`))
        .rows.map(r => `"${r.tablename}"`);
      await client.query(`TRUNCATE TABLE ${tbls.join(', ')} RESTART IDENTITY CASCADE`);
      // 4) Re-insertar el esqueleto (superadmins + catálogos/config base).
      const reinsert = async (table, rows) => {
        for (const row of rows) {
          const cols = Object.keys(row);
          const colList = cols.map(c => `"${c}"`).join(',');
          const ph = cols.map((_, i) => `$${i + 1}`).join(',');
          await client.query(`INSERT INTO ${table} (${colList}) VALUES (${ph})`, cols.map(c => row[c]));
        }
      };
      await reinsert('users', supers);
      for (const t of FACTORY_PRESERVE) await reinsert(t, preserved[t]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally { client.release(); }

    // 5) Registrar el formateo en el (ahora vacío) audit_log.
    await pool.query(`INSERT INTO audit_log (type,sku,qty,glosa,username) VALUES ('SYSTEM','N/A',0,$1,$2)`,
      [`Formateo de fábrica. Backup de seguridad: ${backupName || '(sin nombre)'}`, req.user.username]).catch(() => {});

    res.json({
      success: true,
      backup: backupName,
      preserved: { superadmins: supers.length, statuses: preserved.statuses.length, document_types: preserved.document_types.length, system_config: preserved.system_config.length },
    });
  } catch (err) {
    res.status(500).json({ error: 'Error durante el formateo: ' + (err.message || err) + (backupName ? ` — el backup de seguridad '${backupName}' SÍ se creó.` : '') });
  }
});

// Proteger creación de ADMIN - solo SUPERADMIN puede crear/eliminar admins
app.post('/api/system/promote', requireSuperAdmin, async (req, res) => {
  const { username, newRole } = req.body;
  try {
    const target = await pool.query("SELECT role FROM users WHERE username = $1", [username]);
    if (!target.rows.length) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (target.rows[0].role === 'SUPERADMIN') return res.status(400).json({ error: 'No se puede modificar al SUPERADMIN' });
    await pool.query("UPDATE users SET role = $1 WHERE username = $2", [newRole, username]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});

// Editar log de auditoría
app.put('/api/system/audit/:id', requireSuperAdmin, async (req, res) => {
  const { glosa } = req.body;
  try {
    await pool.query("UPDATE audit_log SET glosa = $1 WHERE id = $2", [glosa, req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── PORTAL DE CLIENTES ─────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

const requirePortalAuth = (req, res, next) => {
  const token = req.headers['x-portal-token'];
  if (!token) return res.status(401).json({ error: 'Portal token requerido' });
  try { req.portal = jwt.verify(token, PORTAL_SECRET); next(); }
  catch(e) { return res.status(401).json({ error: 'Token de portal inválido o expirado' }); }
};

app.post('/api/portal/login', portalLoginLimiter, async (req, res) => {
  const { client_id, password } = req.body;
  if (!client_id || !password) return res.status(400).json({ error: 'Cliente y contraseña requeridos' });
  try {
    const r = await pool.query('SELECT * FROM clients WHERE id=$1', [client_id]);
    if (!r.rows.length) return res.status(401).json({ error: 'Credenciales inválidas' });
    const c = r.rows[0];
    if (!c.portal_enabled) return res.status(403).json({ error: 'Portal no habilitado para este cliente' });
    let valid = false;
    if (c.portal_password && (c.portal_password.startsWith('$2b$') || c.portal_password.startsWith('$2a$'))) {
      valid = await bcrypt.compare(password, c.portal_password);
    } else {
      valid = c.portal_password === password;
      // Migrar contraseña en texto plano a bcrypt
      if (valid) {
        const hashed = await bcrypt.hash(password, 12);
        await pool.query('UPDATE clients SET portal_password=$1 WHERE id=$2', [hashed, c.id]);
      }
    }
    if (!valid) return res.status(401).json({ error: 'Credenciales inválidas' });
    const token = jwt.sign({ client_id: c.id, client_name: c.name }, PORTAL_SECRET, { expiresIn: '12h' });
    res.json({ success: true, token, client: { id: c.id, name: c.name, email: c.email } });
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});

app.get('/api/portal/inventory/:client_id', requirePortalAuth, async (req, res) => {
  if (req.portal.client_id !== req.params.client_id) return res.status(403).json({ error: 'Acceso denegado' });
  try {
    const { sku } = req.query;
    let inv;
    const portalLimit = 5000;
    if (sku) {
      inv = await pool.query(
        `SELECT i.*, s."desc", s.uom FROM inventory_lpns i LEFT JOIN master_skus s ON i.sku=s.sku AND i.client_id=s.client_id WHERE i.client_id=$1 AND i.qty>0 AND i.sku ILIKE $2 ORDER BY i.created_at DESC LIMIT $3`,
        [req.params.client_id, `%${sku}%`, portalLimit]
      );
    } else {
      inv = await pool.query(
        `SELECT i.*, s."desc", s.uom FROM inventory_lpns i LEFT JOIN master_skus s ON i.sku=s.sku AND i.client_id=s.client_id WHERE i.client_id=$1 AND i.qty>0 ORDER BY i.created_at DESC LIMIT $2`,
        [req.params.client_id, portalLimit]
      );
    }
    const stats = { total_lpns: inv.rows.length, total_units: inv.rows.reduce((s,r)=>s+parseFloat(r.qty),0), total_skus: new Set(inv.rows.map(r=>r.sku)).size };
    res.json({ inventory: inv.rows, stats });
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});

app.get('/api/portal/movements/:client_id', requirePortalAuth, async (req, res) => {
  if (req.portal.client_id !== req.params.client_id) return res.status(403).json({ error: 'Acceso denegado' });
  try {
    const skus = await pool.query('SELECT sku FROM master_skus WHERE client_id=$1', [req.params.client_id]);
    const skuList = skus.rows.map(r=>r.sku);
    if (!skuList.length) return res.json([]);
    const logs = await pool.query(`SELECT * FROM audit_log WHERE sku=ANY($1) ORDER BY created_at DESC LIMIT 100`, [skuList]);
    res.json(logs.rows);
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});

app.get('/api/portal/reports/:client_id', requirePortalAuth, async (req, res) => {
  if (req.portal.client_id !== req.params.client_id) return res.status(403).json({ error: 'Acceso denegado' });
  const cid = req.params.client_id;
  try {
    const [invAgg, receipts30d, topSkus, monthly] = await Promise.all([
      pool.query(`SELECT COALESCE(SUM(qty),0)::float AS total_units,
                          COUNT(*) FILTER (WHERE qty>0)::int AS total_lpns,
                          COUNT(DISTINCT sku) FILTER (WHERE qty>0)::int AS total_skus
                   FROM inventory_lpns WHERE client_id=$1`, [cid]),
      pool.query(`SELECT COUNT(*)::int AS receipts_30d
                   FROM audit_log al
                   JOIN master_skus ms ON ms.sku=al.sku AND ms.client_id=$1
                   WHERE al.type='INBOUND' AND al.created_at >= NOW() - INTERVAL '30 days'`, [cid]),
      pool.query(`SELECT al.sku, ms."desc" AS sku_desc,
                          COALESCE(SUM(al.qty),0)::float AS dispatched_qty
                   FROM audit_log al
                   JOIN master_skus ms ON ms.sku=al.sku AND ms.client_id=$1
                   WHERE al.type IN ('OUTBOUND','ADJUST_OUT')
                     AND al.created_at >= NOW() - INTERVAL '30 days'
                   GROUP BY al.sku, ms."desc"
                   ORDER BY dispatched_qty DESC LIMIT 10`, [cid]),
      pool.query(`SELECT to_char(al.created_at,'YYYY-MM') AS month, al.type,
                          COUNT(*)::int AS operations, COALESCE(SUM(al.qty),0)::float AS total_qty
                   FROM audit_log al
                   JOIN master_skus ms ON ms.sku=al.sku AND ms.client_id=$1
                   WHERE al.created_at >= NOW() - INTERVAL '6 months'
                   GROUP BY month, al.type ORDER BY month DESC`, [cid]),
    ]);
    res.json({
      total_units: invAgg.rows[0].total_units,
      total_lpns:  invAgg.rows[0].total_lpns,
      total_skus:  invAgg.rows[0].total_skus,
      receipts_30d: receipts30d.rows[0].receipts_30d,
      top_skus: topSkus.rows,
      monthly: monthly.rows,
      current_stock: invAgg.rows[0].total_units,
    });
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});

app.put('/api/clients/:id/portal', requireJefe, async (req, res) => {
  const { portal_enabled, portal_password, portal_email } = req.body;
  try {
    // Verificar que el cliente existe
    const exists = await pool.query('SELECT id FROM clients WHERE id=$1', [req.params.id]);
    if (!exists.rows.length) return res.status(404).json({ error: 'Cliente no encontrado' });
    // Si se activa portal, contraseña es obligatoria la primera vez y debe tener >= 8 chars
    if (portal_enabled && portal_password && portal_password.length < 8)
      return res.status(400).json({ error: 'La contraseña del portal debe tener al menos 8 caracteres' });
    // Verificar que el portal_email no esté en uso por otro cliente
    if (portal_email && portal_email.trim() !== '') {
      const peDup = await pool.query(`SELECT id FROM clients WHERE portal_email=$1 AND id<>$2 LIMIT 1`, [portal_email.trim(), req.params.id]);
      if (peDup.rows.length > 0)
        return res.status(409).json({ error: `El email de portal '${portal_email.trim()}' ya está en uso por el cliente '${peDup.rows[0].id}'.` });
    }
    const parts = ['portal_enabled=$2'];
    const params = [req.params.id, portal_enabled ?? false];
    if (portal_email !== undefined) { parts.push(`portal_email=$${params.length+1}`); params.push(portal_email); }
    if (portal_password) {
      const hashed = await bcrypt.hash(portal_password, 12);
      parts.push(`portal_password=$${params.length+1}`); params.push(hashed);
    }
    await pool.query(`UPDATE clients SET ${parts.join(',')} WHERE id=$1`, params);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});

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
// ── TRANSPORTE ─────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

app.get('/api/carriers', requireAuth, async (req, res) => {
  try { res.json((await pool.query('SELECT * FROM carriers WHERE active=TRUE ORDER BY name ASC')).rows); }
  catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});
app.post('/api/carriers', requireAuth, async (req, res) => {
  const { id, name, rut, contact, phone, email } = req.body;
  if (!name) return res.status(400).json({ error: 'Nombre requerido' });
  const carrierId = id || `CAR-${uuidv4().slice(0,8).toUpperCase()}`;
  const rutNorm = rut && String(rut).trim() !== '' ? String(rut).trim() : null;
  try {
    if (rutNorm) {
      const rutDup = await pool.query(`SELECT id, name FROM carriers WHERE rut=$1 AND id<>$2 LIMIT 1`, [rutNorm, carrierId]);
      if (rutDup.rows.length > 0)
        return res.status(409).json({ error: `El RUT '${rutNorm}' ya está registrado en el transportista '${rutDup.rows[0].name}'.` });
    }
    await pool.query(`INSERT INTO carriers(id,name,rut,contact,phone,email) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET name=$2,rut=$3,contact=$4,phone=$5,email=$6`,
      [carrierId, name, rutNorm||'', contact||'', phone||'', email||'']);
    res.json({ success: true, id: carrierId });
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});
app.put('/api/carriers/:id', requireAuth, async (req, res) => {
  const { name, rut, contact, phone, email } = req.body;
  if (!name) return res.status(400).json({ error: 'Nombre requerido' });
  const rutNorm = rut && String(rut).trim() !== '' ? String(rut).trim() : null;
  try {
    if (rutNorm) {
      const rutDup = await pool.query(`SELECT id, name FROM carriers WHERE rut=$1 AND id<>$2 LIMIT 1`, [rutNorm, req.params.id]);
      if (rutDup.rows.length > 0)
        return res.status(409).json({ error: `El RUT '${rutNorm}' ya está registrado en el transportista '${rutDup.rows[0].name}'.` });
    }
    await pool.query(`UPDATE carriers SET name=$1,rut=$2,contact=$3,phone=$4,email=$5 WHERE id=$6`,
      [name, rutNorm||'', contact||'', phone||'', email||'', req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});
app.delete('/api/carriers/:id', requireAuth, async (req, res) => {
  try { await pool.query('UPDATE carriers SET active=FALSE WHERE id=$1', [req.params.id]); res.json({ success: true }); }
  catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});

app.get('/api/shipments', requireAuth, async (req, res) => {
  try {
    const r = await pool.query(`SELECT s.*,c.name as carrier_name,
      COALESCE(s.destination, s.destination_address) as destination
      FROM shipments s LEFT JOIN carriers c ON s.carrier_id=c.id ORDER BY s.created_at DESC LIMIT 200`);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});
app.post('/api/shipments', requireAuth, checkClientAccess('write'), async (req, res) => {
  // Acepta tanto el formato legacy (dispatch_doc_id) como el simplificado del frontend (doc_num, client_id, destination)
  const { dispatch_doc_id, doc_num, carrier_id, client_id, driver_name, driver_rut, plate, scheduled_date, destination_address, destination, notes, created_by, username } = req.body;
  const id = `SHP-${uuidv4().slice(0,8).toUpperCase()}`;
  try {
    await pool.query(`INSERT INTO shipments(id,dispatch_doc_id,doc_num,client_id,carrier_id,driver_name,driver_rut,plate,scheduled_date,destination_address,destination,notes,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [id, dispatch_doc_id||doc_num||null, doc_num||dispatch_doc_id||null, client_id||null, carrier_id||null,
       driver_name||'', driver_rut||'', plate||'', scheduled_date||null,
       destination_address||destination||'', destination||destination_address||'',
       notes||'', created_by||username||'']);
    res.json({ success: true, id });
  } catch(e) {
    if (isUniqueViolation(e)) return res.status(409).json({ error: `Ya existe un envío con el documento '${doc_num||dispatch_doc_id}' para este cliente.` });
    res.status(500).json({ error: mapDbError(e) });
  }
});
app.put('/api/shipments/:id/status', requireStockWrite, async (req, res) => {
  const { status } = req.body;
  const VALID = ['PENDING','ASSIGNED','IN_TRANSIT','DELIVERED','RETURNED'];
  if (!VALID.includes(status)) return res.status(400).json({ error: 'Estado inválido' });
  try {
    const extra = status==='IN_TRANSIT' ? ',pickup_date=NOW()' : status==='DELIVERED' ? ',delivery_date=NOW()' : '';
    await pool.query(`UPDATE shipments SET status=$1${extra} WHERE id=$2`, [status, req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});
app.get('/api/shipments/doc/:docId', requireAuth, async (req, res) => {
  try {
    const r = await pool.query('SELECT s.*,c.name as carrier_name FROM shipments s LEFT JOIN carriers c ON s.carrier_id=c.id WHERE s.dispatch_doc_id=$1', [req.params.docId]);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── API KEYS ───────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

const generateApiKey = () => {
  const raw = 'wms_' + crypto.randomBytes(24).toString('hex');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  const prefix = raw.slice(0, 12);
  return { raw, hash, prefix };
};

const requireApiKey = async (req, res, next) => {
  const key = req.headers['x-api-key'];
  if (!key) return res.status(401).json({ error: 'API Key requerida — header X-API-Key' });
  const hash = crypto.createHash('sha256').update(key).digest('hex');
  try {
    const r = await pool.query('SELECT * FROM api_keys WHERE key_hash=$1 AND active=TRUE', [hash]);
    if (!r.rows.length) return res.status(401).json({ error: 'API Key inválida o revocada' });
    await pool.query('UPDATE api_keys SET last_used=NOW() WHERE id=$1', [r.rows[0].id]);
    req.apiKey = r.rows[0];
    next();
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
};

app.get('/api/keys', requireJefe, async (req, res) => {
  try { res.json((await pool.query('SELECT id,key_prefix,name,client_id,permissions,active,last_used,created_by,created_at FROM api_keys ORDER BY created_at DESC')).rows); }
  catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});
app.post('/api/keys', requireJefe, async (req, res) => {
  const { name, client_id, permissions, created_by } = req.body;
  if (!name) return res.status(400).json({ error: 'Nombre requerido' });
  const { raw, hash, prefix } = generateApiKey();
  try {
    await pool.query('INSERT INTO api_keys(key_hash,key_prefix,name,client_id,permissions,created_by) VALUES($1,$2,$3,$4,$5,$6)',
      [hash, prefix, name, client_id||null, permissions||'read', created_by||'']);
    res.json({ success: true, key: raw, prefix });
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});
app.delete('/api/keys/:id', requireJefe, async (req, res) => {
  try { await pool.query('UPDATE api_keys SET active=FALSE WHERE id=$1', [req.params.id]); res.json({ success: true }); }
  catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});

// API v1 pública con API Key
app.get('/api/v1/inventory', requireApiKey, async (req, res) => {
  const { sku, client_id, location } = req.query;
  const keyClient = req.apiKey.client_id;
  try {
    const conds = ['i.qty>0']; const params = []; let idx = 1;
    if (sku) { conds.push(`i.sku ILIKE $${idx++}`); params.push(`%${sku}%`); }
    if (keyClient) { conds.push(`i.client_id=$${idx++}`); params.push(keyClient); }
    else if (client_id) { conds.push(`i.client_id=$${idx++}`); params.push(client_id); }
    if (location) { conds.push(`i.location_id ILIKE $${idx++}`); params.push(`%${location}%`); }
    const invLimit = Math.min(Math.max(parseInt(req.query.limit) || 500, 1), 1000);
    params.push(invLimit);
    const r = await pool.query(`SELECT i.*,s."desc",s.uom FROM inventory_lpns i LEFT JOIN master_skus s ON i.sku=s.sku AND i.client_id=s.client_id WHERE ${conds.join(' AND ')} ORDER BY i.sku LIMIT $${idx}`, params);
    res.set('X-WMS-Version','1.0').json(r.rows);
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});
app.get('/api/v1/inventory/:sku/stock', requireApiKey, async (req, res) => {
  const keyClient = req.apiKey.client_id;
  try {
    const params = [req.params.sku]; let cond = 'sku=$1 AND qty>0';
    if (keyClient) { cond += ' AND client_id=$2'; params.push(keyClient); }
    const r = await pool.query(`SELECT COALESCE(SUM(qty),0) as total FROM inventory_lpns WHERE ${cond}`, params);
    res.set('X-WMS-Version','1.0').json({ sku: req.params.sku, total_stock: parseFloat(r.rows[0].total) });
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});
app.get('/api/v1/skus', requireApiKey, async (req, res) => {
  const keyClient = req.apiKey.client_id;
  try {
    const r = keyClient
      ? await pool.query('SELECT * FROM master_skus WHERE client_id=$1 ORDER BY sku', [keyClient])
      : await pool.query('SELECT * FROM master_skus ORDER BY sku LIMIT 1000');
    res.set('X-WMS-Version','1.0').json(r.rows);
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});
app.get('/api/v1/movements', requireApiKey, async (req, res) => {
  try {
    // Aislar por client_id de la API Key si está configurada
    const keyClientId = req.apiKey.client_id;
    // Clamp de limit/offset para evitar escaneos de tabla completa
    const limit  = Math.min(Math.max(parseInt(req.query.limit)  || 200, 1), 1000);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);
    let r;
    if (keyClientId) {
      r = await pool.query(
        'SELECT * FROM audit_log WHERE client_id=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
        [keyClientId, limit, offset]
      );
    } else {
      r = await pool.query(
        'SELECT * FROM audit_log ORDER BY created_at DESC LIMIT $1 OFFSET $2',
        [limit, offset]
      );
    }
    res.set('X-WMS-Version','1.0').json(r.rows);
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── KITTING — BUILD Y DISPONIBILIDAD → routes/kits.js ──────────────────────
// ═══════════════════════════════════════════════════════════════════════════
// (Bloque movido a routes/kits.js — se mantiene un placeholder para que el
//  diff sea legible, eliminar en próxima limpieza.)

// ── KPIs DE DESPACHO ──────────────────────────────────────────────────────────

// ═══════════════════════════════════════════════════════════════════════════
// SOLICITUDES DE REUBICACIÓN CON APROBACIÓN
// ═══════════════════════════════════════════════════════════════════════════

// ── Picker solicita una reubicación (no mueve stock) ─────────────────────
app.post('/api/relocate-requests', requirePickerOrAbove, checkLpnClientAccess('lpn_id'), async (req, res) => {
  const { lpn_id, location_to, qty, glosa } = req.body;
  if (!lpn_id || !location_to) return res.status(400).json({ error: 'lpn_id y location_to son requeridos.' });
  try {
    const lpn = await pool.query('SELECT id, sku, qty, location_id FROM inventory_lpns WHERE id=$1 AND qty>0', [lpn_id]);
    if (!lpn.rows.length) return res.status(404).json({ error: 'LPN no encontrado o sin stock.' });
    const { sku, qty: maxQty, location_id } = lpn.rows[0];
    const moveQty = qty ? parseFloat(qty) : parseFloat(maxQty);
    if (isNaN(moveQty) || moveQty <= 0 || moveQty > parseFloat(maxQty))
      return res.status(400).json({ error: `Cantidad inválida. Disponible: ${maxQty}` });
    if (location_to === (location_id || 'PISO-RECEPCION'))
      return res.status(400).json({ error: 'El destino es igual a la ubicación actual.' });
    // Validar que la ubicación destino existe en locations_master (excepto PISO-RECEPCION)
    if (location_to !== 'PISO-RECEPCION') {
      const locCheck = await pool.query('SELECT location_id FROM locations_master WHERE location_id=$1', [location_to]);
      if (!locCheck.rows.length) return res.status(400).json({ error: `Ubicación destino "${location_to}" no existe en el diseño de bodega. Genérala primero en "Diseño Bodega".` });
    }
    const id = genLpnId('RELREQ');
    await pool.query(
      `INSERT INTO relocation_requests (id, lpn_id, sku, qty, location_from, location_to, glosa, requested_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, lpn_id, sku, moveQty, location_id||'PISO-RECEPCION', location_to, glosa||null, req.user.username]
    );
    await pool.query(`INSERT INTO audit_log (type,sku,qty,glosa,username) VALUES ('RELOC_REQUEST',$1,$2,$3,$4)`,
      [sku, moveQty, `Solicitud de reubicación ${id}: LPN ${lpn_id} de ${location_id||'PISO-RECEPCION'} → ${location_to}`, req.user.username]);
    res.json({ success: true, request_id: id });
  } catch (err) { res.status(500).json({ error: mapDbError(err) }); }
});

// ── Listar solicitudes (supervisor: todas; picker: solo las suyas) ────────
app.get('/api/relocate-requests', requirePickerOrAbove, async (req, res) => {
  try {
    const { status } = req.query;
    const isPicker = req.user.role === 'PICKER';
    const conditions = [];
    const params = [];
    if (isPicker) { conditions.push(`requested_by=$${params.length+1}`); params.push(req.user.username); }
    if (status) { conditions.push(`status=$${params.length+1}`); params.push(status); }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const rows = await pool.query(
      `SELECT r.*, i.qty as lpn_qty_current, i.batch_number, i.serial_number
       FROM relocation_requests r
       LEFT JOIN inventory_lpns i ON i.id = r.lpn_id
       ${where} ORDER BY r.requested_at DESC LIMIT 200`, params
    );
    res.json(rows.rows);
  } catch (err) { res.status(500).json({ error: mapDbError(err) }); }
});

// ── Supervisor aprueba → ejecuta la reubicación real ─────────────────────
// PASO 5.5: la reubicación es la excepción — aprueba EJECUTIVO_CUENTA+ (no requiere JEFE).
app.post('/api/relocate-requests/:id/approve', requireStockWrite, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const reqRow = await client.query(
      `SELECT * FROM relocation_requests WHERE id=$1 AND status='PENDIENTE' FOR UPDATE`, [req.params.id]
    );
    if (!reqRow.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Solicitud no encontrada o ya resuelta.' });
    }
    const r = reqRow.rows[0];
    // Validar que el LPN aún existe y tiene stock
    const lpn = await client.query('SELECT * FROM inventory_lpns WHERE id=$1 FOR UPDATE', [r.lpn_id]);
    if (!lpn.rows.length || parseFloat(lpn.rows[0].qty) <= 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'El LPN ya no tiene stock disponible.' });
    }
    if (parseFloat(lpn.rows[0].qty) < parseFloat(r.qty)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `Stock insuficiente: disponible ${lpn.rows[0].qty}, solicitado ${r.qty}.` });
    }
    // Verificar estado no bloquea
    const stCheck = await client.query('SELECT blocks_outbound FROM statuses WHERE id=$1', [lpn.rows[0].status||'DISPONIBLE']);
    if (stCheck.rows[0]?.blocks_outbound) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `El LPN está en estado '${lpn.rows[0].status}' y no puede reubicarse.` });
    }
    // Verificar destino existe o crear
    if (r.location_to !== 'PISO-RECEPCION') {
      const locCheck = await client.query('SELECT location_id FROM locations_master WHERE location_id=$1', [r.location_to]);
      if (!locCheck.rows.length) {
        await client.query('INSERT INTO locations_master (location_id, zone_code) VALUES ($1,$2)', [r.location_to, r.location_to.split('-')[0]||'GENERAL']);
      }
    }
    // Ejecutar reubicación (total o parcial)
    const originalQty = parseFloat(lpn.rows[0].qty);
    const moveQty = parseFloat(r.qty);
    if (moveQty === originalQty) {
      await client.query('UPDATE inventory_lpns SET location_id=$1 WHERE id=$2', [r.location_to, r.lpn_id]);
    } else {
      if (lpn.rows[0].serial_number) throw new Error('Los productos serializados no se pueden dividir.');
      const newLpnId = genLpnId('SPLIT');
      await client.query('UPDATE inventory_lpns SET qty=qty-$1 WHERE id=$2', [moveQty, r.lpn_id]);
      await client.query(
        `INSERT INTO inventory_lpns (id,sku,qty,client_id,status,batch_number,expiry_date,serial_number,location_id,glosa)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [newLpnId, lpn.rows[0].sku, moveQty, lpn.rows[0].client_id, lpn.rows[0].status,
         lpn.rows[0].batch_number, lpn.rows[0].expiry_date, lpn.rows[0].serial_number,
         r.location_to, `Aprobado desde solicitud ${r.id}`]
      );
    }
    // Marcar solicitud como aprobada
    await client.query(
      `UPDATE relocation_requests SET status='APROBADA', resolved_by=$1, resolved_at=NOW() WHERE id=$2`,
      [req.user.username, req.params.id]
    );
    await client.query(
      `INSERT INTO audit_log (type,sku,qty,glosa,username) VALUES ('RELOCATE',$1,$2,$3,$4)`,
      [r.sku, moveQty, `Aprobado por ${req.user.username}. Solicitud ${r.id}: LPN ${r.lpn_id} de ${r.location_from} → ${r.location_to}. ${r.glosa||''}`, req.user.username]
    );
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: mapDbError(err) });
  } finally { client.release(); }
});

// ── Supervisor rechaza ────────────────────────────────────────────────────
app.post('/api/relocate-requests/:id/reject', requireStockWrite, async (req, res) => {
  const { reason } = req.body;
  if (!reason) return res.status(400).json({ error: 'reason es requerida para rechazar.' });
  try {
    const r = await pool.query(
      `UPDATE relocation_requests SET status='RECHAZADA', resolved_by=$1, resolved_at=NOW(), reject_reason=$2
       WHERE id=$3 AND status='PENDIENTE' RETURNING id`,
      [req.user.username, reason, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Solicitud no encontrada o ya resuelta.' });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: mapDbError(err) }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// SISTEMA 1 — PROVEEDORES + ASN → routes/asns.js
// SISTEMA 2 — OLAS DE PICKING → routes/pick-waves.js
// ══════════════════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════════════════
// SISTEMA 4 — DEVOLUCIONES MEJORADAS → routes/returns.js
// ══════════════════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════════════════
// SISTEMA 6 — FACTURACIÓN 3PL
// ══════════════════════════════════════════════════════════════════════════════
app.get('/api/invoices', requireJefeOrAbove, async (req, res) => {
  const { client_id } = req.query;
  try {
    let q = `SELECT i.*, i.invoice_num as invoice_number, i.total as total_amount, c.name as client_name,
             COALESCE(json_agg(il ORDER BY il.id) FILTER (WHERE il.id IS NOT NULL),'[]') as lines
             FROM invoices i LEFT JOIN clients c ON c.id=i.client_id LEFT JOIN invoice_lines il ON il.invoice_id=i.id
             WHERE 1=1`;
    const params = [];
    if (client_id) { q += ` AND i.client_id=$${params.length+1}`; params.push(client_id); }
    q += ' GROUP BY i.id, c.name ORDER BY i.created_at DESC LIMIT 200';
    res.json((await pool.query(q, params)).rows);
  } catch(e){ res.status(500).json({ error: mapDbError(e) }); }
});
// Generar factura automática desde actividad del período
app.post('/api/invoices/generate', requireJefe, checkClientAccess('write', { required: true }), async (req, res) => {
  const { client_id, period_start, period_end, tax_rate, manual_lines } = req.body;
  if (!client_id || !period_start || !period_end) return res.status(400).json({ error: 'cliente, período inicio y fin son requeridos.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const id = genLpnId('INV');
    // Correlativo de factura POR CLIENTE (atómico, a prueba de concurrencia).
    const seq = await client.query(
      `INSERT INTO invoice_counters (client_id, last_num) VALUES ($1, 1)
       ON CONFLICT (client_id) DO UPDATE SET last_num = invoice_counters.last_num + 1
       RETURNING last_num`,
      [client_id]
    );
    const invNum = `F-${client_id}-${String(seq.rows[0].last_num).padStart(5, '0')}`;
    await client.query(`INSERT INTO invoices (id,invoice_num,client_id,period_start,period_end,tax_rate,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, invNum, client_id, period_start, period_end, parseFloat(tax_rate)||19, req.user.username]);

    const lines = [];
    // Línea: recepciones del período
    const recv = await client.query(`SELECT COUNT(*) as cnt FROM document_history WHERE module='receive' AND status='ACTIVO' AND client_id=$1 AND created_at BETWEEN $2 AND $3`,
      [client_id, period_start, period_end]);
    if (parseInt(recv.rows[0].cnt)>0) lines.push({ concept:`Recepciones (${recv.rows[0].cnt} docs)`, unit:'DOC', qty:parseInt(recv.rows[0].cnt), unit_price:5000 });
    // Línea: despachos del período
    const disp = await client.query(`SELECT COUNT(*) as cnt FROM document_history WHERE module='dispatch' AND status='ACTIVO' AND client_id=$1 AND created_at BETWEEN $2 AND $3`,
      [client_id, period_start, period_end]);
    if (parseInt(disp.rows[0].cnt)>0) lines.push({ concept:`Despachos (${disp.rows[0].cnt} docs)`, unit:'DOC', qty:parseInt(disp.rows[0].cnt), unit_price:7000 });
    // Línea: almacenaje (LPNs activos promedio)
    const storage = await client.query(`SELECT COUNT(*) as cnt FROM inventory_lpns WHERE client_id=$1 AND qty>0`, [client_id]);
    if (parseInt(storage.rows[0].cnt)>0) lines.push({ concept:`Almacenaje (${storage.rows[0].cnt} LPNs activos)`, unit:'LPN', qty:parseInt(storage.rows[0].cnt), unit_price:1500 });
    // Líneas manuales adicionales
    for (const ml of (manual_lines||[])) { if(ml.concept && ml.qty>0) lines.push(ml); }

    let subtotal = 0;
    for (const l of lines) {
      const total = parseFloat(l.qty)*parseFloat(l.unit_price);
      subtotal += total;
      await client.query(`INSERT INTO invoice_lines (invoice_id,concept,unit,qty,unit_price,total) VALUES ($1,$2,$3,$4,$5,$6)`,
        [id, l.concept, l.unit||'UN', parseFloat(l.qty), parseFloat(l.unit_price), total]);
    }
    const taxAmt = subtotal * (parseFloat(tax_rate)||19) / 100;
    await client.query(`UPDATE invoices SET subtotal=$1, tax_amount=$2, total=$3 WHERE id=$4`,
      [subtotal, taxAmt, subtotal+taxAmt, id]);
    await client.query('COMMIT');
    res.json({ success: true, id, invoice_num: invNum, subtotal, total: subtotal+taxAmt });
  } catch(e){
    await client.query('ROLLBACK');
    if (isUniqueViolation(e)) return res.status(409).json({ error: `Ya existe una factura con ese número para el cliente '${client_id}'.` });
    res.status(500).json({ error: mapDbError(e) });
  }
  finally { client.release(); }
});
app.post('/api/invoices/:id/issue', requireJefe, async (req, res) => {
  try {
    await pool.query(`UPDATE invoices SET status='EMITIDA', issued_at=NOW() WHERE id=$1 AND status='BORRADOR'`, [req.params.id]);
    res.json({ success: true });
  } catch(e){ res.status(500).json({ error: mapDbError(e) }); }
});
app.post('/api/invoices/:id/pay', requireJefe, async (req, res) => {
  try {
    await pool.query(`UPDATE invoices SET status='PAGADA', paid_at=NOW() WHERE id=$1 AND status='EMITIDA'`, [req.params.id]);
    res.json({ success: true });
  } catch(e){ res.status(500).json({ error: mapDbError(e) }); }
});
app.delete('/api/invoices/:id', requireJefe, async (req, res) => {
  try { await pool.query(`DELETE FROM invoices WHERE id=$1 AND status='BORRADOR'`, [req.params.id]); res.json({ success: true }); }
  catch(e){ res.status(500).json({ error: mapDbError(e) }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// SISTEMA 7 — REPORTERÍA AVANZADA
// ══════════════════════════════════════════════════════════════════════════════
// Antigüedad de inventario (días en bodega por LPN)

// ══════════════════════════════════════════════════════════════════════════════
// FEFO: sugerencia de LPNs ordenados por vencimiento (para despacho)
// ══════════════════════════════════════════════════════════════════════════════
app.get('/api/inventory/fefo/:sku', requireAuth, async (req, res) => {
  const { client_id } = req.query;
  try {
    let q = `SELECT id, sku, qty, location_id, batch_number, expiry_date, serial_number, status, created_at
             FROM inventory_lpns WHERE sku=$1 AND qty>0 AND status NOT IN ('BLOQUEADO','CUARENTENA','RETENIDO')`;
    const params = [req.params.sku.toUpperCase()];
    if (client_id) { q += ` AND client_id=$${params.length+1}`; params.push(client_id); }
    q += ' ORDER BY expiry_date ASC NULLS LAST, created_at ASC LIMIT 100';
    res.json((await pool.query(q, params)).rows);
  } catch(e){ res.status(500).json({ error: mapDbError(e) }); }
});

// ── SOLICITUDES DE AJUSTE → routes/cycle-count.js ────────────────────────────

// ── DEMO SANDBOX → routes/demo.js ────────────────────────────────────────────

// Resetear contraseña de usuario (solo SUPERADMIN)
app.post('/api/system/users/reset-password', requireSuperAdmin, async (req, res) => {
  const { username, new_password } = req.body;
  if (!username || !new_password) return res.status(400).json({ error: 'username y new_password requeridos.' });
  if (new_password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });
  try {
    const check = await pool.query('SELECT role FROM users WHERE username=$1', [username]);
    if (!check.rows.length) return res.status(404).json({ error: 'Usuario no encontrado.' });
    const hashed = await bcrypt.hash(new_password, 12);
    await pool.query('UPDATE users SET password=$1 WHERE username=$2', [hashed, username]);
    await pool.query(`INSERT INTO audit_log (type,sku,qty,glosa,username) VALUES ('SYSTEM','N/A',0,$1,$2)`, [`[SUPERADMIN] Reset de contraseña del usuario ${username}`, req.user.username]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

// ── PROGRAMACIÓN DE SALIDAS ───────────────────────────────────────────────────

app.get('/api/dispatch-schedules', requireAuth, async (req, res) => {
  try {
    const { status, date_from, date_to } = req.query;
    const conditions = [];
    const params = [];
    let idx = 1;
    if (status) { conditions.push(`status=$${idx++}`); params.push(status); }
    if (date_from) { conditions.push(`scheduled_date>=$${idx++}`); params.push(date_from); }
    if (date_to) { conditions.push(`scheduled_date<=$${idx++}`); params.push(date_to); }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const rows = await pool.query(
      `SELECT * FROM dispatch_schedules ${where} ORDER BY scheduled_date ASC, scheduled_time ASC NULLS LAST, created_at DESC`,
      params
    );
    res.json(rows.rows);
  } catch (err) { res.status(500).json({ error: mapDbError(err) }); }
});

app.post('/api/dispatch-schedules', requireJefeOrAbove, checkClientAccess('write'), async (req, res) => {
  const { doc_num, client_id, doc_type, glosa, scheduled_date, scheduled_time, carrier, destination, notes } = req.body;
  if (!doc_num || !scheduled_date) return res.status(400).json({ error: 'doc_num y scheduled_date son requeridos.' });
  try {
    const id = genLpnId('DS');
    await pool.query(
      `INSERT INTO dispatch_schedules (id, doc_num, client_id, doc_type, glosa, scheduled_date, scheduled_time, carrier, destination, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [id, doc_num.toUpperCase(), client_id||null, doc_type||null, glosa||null,
       scheduled_date, scheduled_time||null, carrier||null, destination||null, notes||null, req.user.username]
    );
    res.json({ success: true, id });
  } catch (err) {
    if (isUniqueViolation(err)) return res.status(409).json({ error: `Ya existe una programación con el documento '${doc_num}' para este cliente y tipo.` });
    res.status(500).json({ error: mapDbError(err) });
  }
});

app.patch('/api/dispatch-schedules/:id', requireJefeOrAbove, async (req, res) => {
  const { doc_num, client_id, doc_type, glosa, scheduled_date, scheduled_time, carrier, destination, notes, status } = req.body;
  try {
    const current = await pool.query('SELECT * FROM dispatch_schedules WHERE id=$1', [req.params.id]);
    if (!current.rows.length) return res.status(404).json({ error: 'Programación no encontrada.' });
    const r = current.rows[0];
    const newStatus = status || r.status;
    const confirmedBy = (newStatus === 'CONFIRMADO' && r.status !== 'CONFIRMADO') ? req.user.username : r.confirmed_by;
    const confirmedAt = (newStatus === 'CONFIRMADO' && r.status !== 'CONFIRMADO') ? 'NOW()' : null;
    await pool.query(
      `UPDATE dispatch_schedules SET
         doc_num=$1, client_id=$2, doc_type=$3, glosa=$4, scheduled_date=$5, scheduled_time=$6,
         carrier=$7, destination=$8, notes=$9, status=$10, confirmed_by=$11,
         confirmed_at=CASE WHEN $12 THEN NOW() ELSE confirmed_at END
       WHERE id=$13`,
      [doc_num||r.doc_num, client_id||r.client_id, doc_type||r.doc_type, glosa!==undefined?glosa:r.glosa,
       scheduled_date||r.scheduled_date, scheduled_time!==undefined?scheduled_time:r.scheduled_time,
       carrier!==undefined?carrier:r.carrier, destination!==undefined?destination:r.destination,
       notes!==undefined?notes:r.notes, newStatus, confirmedBy,
       (newStatus === 'CONFIRMADO' && r.status !== 'CONFIRMADO'), req.params.id]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: mapDbError(err) }); }
});

app.delete('/api/dispatch-schedules/:id', requireJefeOrAbove, async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM dispatch_schedules WHERE id=$1 RETURNING id', [req.params.id]);
    if (!r.rowCount) return res.status(404).json({ error: 'Programación no encontrada.' });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: mapDbError(err) }); }
});

// ── ANULACIONES DE DOCUMENTOS ─────────────────────────────────────────────────

// Función compartida que ejecuta la reversión de stock
async function executeVoid(client, docHistoryId, reason, executedBy) {
  const docRow = await client.query('SELECT * FROM document_history WHERE id=$1', [docHistoryId]);
  if (!docRow.rows.length) throw new Error('Documento no encontrado en historial.');
  const doc = docRow.rows[0];
  if (doc.status === 'ANULADO') throw new Error('El documento ya fue anulado anteriormente.');
  if (!['receive','dispatch'].includes(doc.module)) throw new Error('Solo se pueden anular recepciones y despachos.');

  const items = JSON.parse(doc.items_json || '[]');
  const docNum = doc.doc_num;
  const module = doc.module;

  if (module === 'receive') {
    // Buscar LPNs creados por esta recepción en el audit_log
    const auditRows = await client.query(
      `SELECT glosa FROM audit_log WHERE type='INBOUND' AND glosa LIKE $1`,
      [`%] ${docNum}. LPN: %`]
    );
    const lpnIds = [];
    for (const row of auditRows.rows) {
      const m = row.glosa.match(/LPN:\s+([A-Z0-9-]+)/);
      if (m && m[1]) lpnIds.push(m[1]);
    }
    if (lpnIds.length === 0) throw new Error('No se encontraron LPNs asociados a esta recepción en el audit log.');
    for (const lpnId of lpnIds) {
      await client.query('DELETE FROM inventory_lpns WHERE id=$1', [lpnId]);
    }
    await client.query(
      `INSERT INTO audit_log (type,sku,qty,glosa,username) VALUES ('VOID_INBOUND','N/A',0,$1,$2)`,
      [`Anulación RECEPCIÓN Doc: ${docNum}. LPNs eliminados: ${lpnIds.join(', ')}. Motivo: ${reason}`, executedBy]
    );
  } else if (module === 'dispatch') {
    // Restaurar qty de cada LPN despachado
    for (const item of items) {
      if (!item.lpnId || !(item.qtyToPick > 0)) continue;
      const qty = parseFloat(item.qtyToPick);
      const updated = await client.query(
        'UPDATE inventory_lpns SET qty = qty + $1 WHERE id = $2 RETURNING id',
        [qty, item.lpnId]
      );
      if (updated.rowCount === 0) {
        // LPN fue eliminado por completo (qty=0) — re-insertar
        const skuRow = await client.query('SELECT client_id FROM master_skus WHERE sku=$1 LIMIT 1', [item.sku]);
        const clientId = skuRow.rows[0]?.client_id || 'GENERAL';
        await client.query(
          `INSERT INTO inventory_lpns (id,sku,qty,client_id,status,serial_number,location_id,glosa)
           VALUES ($1,$2,$3,$4,'DISPONIBLE',$5,$6,$7)`,
          [item.lpnId, item.sku, qty, clientId, item.serial||null,
           item.location||'PISO-RECEPCION', `Restaurado por anulación Doc: ${docNum}`]
        );
      }
    }
    await client.query(
      `INSERT INTO audit_log (type,sku,qty,glosa,username) VALUES ('VOID_OUTBOUND','N/A',0,$1,$2)`,
      [`Anulación DESPACHO Doc: ${docNum}. Stock restaurado. Motivo: ${reason}`, executedBy]
    );
  }

  // Marcar documento como ANULADO
  await client.query(
    `UPDATE document_history SET status='ANULADO', void_reason=$1, voided_by=$2, voided_at=NOW() WHERE id=$3`,
    [reason, executedBy, docHistoryId]
  );
}

// Anulación directa (ADMIN / SUPERADMIN)
app.post('/api/document-history/:id/void', requireJefe, async (req, res) => {
  // Anulación directa de despacho/recepción: JEFE_BODEGA+ (gate requireJefe).
  const { reason } = req.body;
  if (!reason || !reason.trim()) return res.status(400).json({ error: 'Debe indicar el motivo de la anulación.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await executeVoid(client, req.params.id, reason.trim(), req.user.username);
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally { client.release(); }
});

// Solicitar anulación (usuarios no-admin)
app.post('/api/document-history/:id/void-request', requireStockWrite, async (req, res) => {
  // EJECUTIVO_CUENTA solicita; JEFE_BODEGA+ anula directamente (no necesita solicitar).
  if (['JEFE_BODEGA','ADMIN','SUPERADMIN'].includes(req.user.role)) return res.status(400).json({ error: 'Tu rol puede anular directamente; no necesitas solicitarlo.' });
  const { reason } = req.body;
  if (!reason || !reason.trim()) return res.status(400).json({ error: 'Debe indicar el motivo de la anulación.' });
  try {
    const docRow = await pool.query('SELECT * FROM document_history WHERE id=$1', [req.params.id]);
    if (!docRow.rows.length) return res.status(404).json({ error: 'Documento no encontrado.' });
    const doc = docRow.rows[0];
    if (doc.status === 'ANULADO') return res.status(409).json({ error: 'El documento ya fue anulado.' });
    if (!['receive','dispatch'].includes(doc.module)) return res.status(400).json({ error: 'Solo se pueden anular recepciones y despachos.' });
    // Verificar que no haya solicitud pendiente para este doc
    const existing = await pool.query(`SELECT id FROM anulation_requests WHERE doc_history_id=$1 AND status='PENDIENTE'`, [req.params.id]);
    if (existing.rows.length) return res.status(409).json({ error: 'Ya existe una solicitud de anulación pendiente para este documento.' });
    const reqId = genLpnId('ANUL');
    await pool.query(
      `INSERT INTO anulation_requests (id,doc_history_id,doc_num,module,reason,requested_by) VALUES ($1,$2,$3,$4,$5,$6)`,
      [reqId, req.params.id, doc.doc_num, doc.module, reason.trim(), req.user.username]
    );
    res.json({ success: true, id: reqId });
  } catch (err) { res.status(500).json({ error: mapDbError(err) }); }
});

// Listar solicitudes de anulación (ADMIN/SUPERADMIN)
app.get('/api/anulation-requests', requireJefe, async (req, res) => {
  try {
    const { status } = req.query;
    const where = status ? `WHERE ar.status=$1` : '';
    const params = status ? [status] : [];
    const rows = await pool.query(
      `SELECT ar.*, dh.doc_type, dh.glosa, dh.total_qty, dh.created_at AS doc_created_at
       FROM anulation_requests ar
       LEFT JOIN document_history dh ON dh.id = ar.doc_history_id
       ${where} ORDER BY ar.created_at DESC LIMIT 200`, params
    );
    res.json(rows.rows);
  } catch (err) { res.status(500).json({ error: mapDbError(err) }); }
});

// Aprobar solicitud de anulación (ADMIN/SUPERADMIN)
app.post('/api/anulation-requests/:id/approve', requireJefe, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const reqRow = await client.query(`SELECT * FROM anulation_requests WHERE id=$1 FOR UPDATE`, [req.params.id]);
    if (!reqRow.rows.length) throw new Error('Solicitud no encontrada.');
    const anulReq = reqRow.rows[0];
    if (anulReq.status !== 'PENDIENTE') throw new Error('La solicitud ya fue procesada.');
    await executeVoid(client, anulReq.doc_history_id, anulReq.reason, req.user.username);
    await client.query(
      `UPDATE anulation_requests SET status='APROBADA', authorized_by=$1, resolved_at=NOW() WHERE id=$2`,
      [req.user.username, req.params.id]
    );
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally { client.release(); }
});

// Rechazar solicitud de anulación (ADMIN/SUPERADMIN)
app.post('/api/anulation-requests/:id/reject', requireJefe, async (req, res) => {
  const { reject_reason } = req.body;
  try {
    const r = await pool.query(
      `UPDATE anulation_requests SET status='RECHAZADA', authorized_by=$1, reject_reason=$2, resolved_at=NOW()
       WHERE id=$3 AND status='PENDIENTE' RETURNING id`,
      [req.user.username, reject_reason||'', req.params.id]
    );
    if (!r.rowCount) return res.status(404).json({ error: 'Solicitud no encontrada o ya procesada.' });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: mapDbError(err) }); }
});

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
