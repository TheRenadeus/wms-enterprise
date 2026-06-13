// Migración inicial: schema v11.0 completo al momento de introducir el
// sistema de migraciones. Equivalente al `initDB` monolítico original.
//
// IMPORTANTE: Esta migración es INMUTABLE. Los cambios de schema futuros deben
// ir en archivos nuevos (002_*, 003_*, …), nunca editando este.
//
// El cuerpo conserva los `.catch(...)` inline para tolerar reejecuciones en
// bases de datos preexistentes (IF NOT EXISTS / ON CONFLICT), pero cuando el
// runner de migraciones funciona correctamente, solo se ejecuta una vez.

const bcrypt = require('bcryptjs');

const silentExists = (prefix) => (e) => {
  if (!String(e.message).includes('already exists')) console.error(`[${prefix}]`, e.message);
};

async function run(pool) {
  // ── Esquema base ─────────────────────────────────────────────────────────
  await pool.query(`CREATE TABLE IF NOT EXISTS statuses (id VARCHAR(50) PRIMARY KEY, description VARCHAR(255), color VARCHAR(20) DEFAULT 'slate', blocks_outbound BOOLEAN DEFAULT FALSE)`);
  await pool.query(`ALTER TABLE statuses ADD COLUMN IF NOT EXISTS color VARCHAR(20) DEFAULT 'slate'`).catch(silentExists('schema-init'));
  await pool.query(`ALTER TABLE statuses ADD COLUMN IF NOT EXISTS blocks_outbound BOOLEAN DEFAULT FALSE`).catch(silentExists('schema-init'));
  await pool.query(`INSERT INTO statuses (id, description, color, blocks_outbound) VALUES
    ('DISPONIBLE', 'Disponible', 'green', false),
    ('BLOQUEADO', 'Bloqueado', 'red', true),
    ('CUARENTENA', 'En Cuarentena', 'yellow', true),
    ('RETENIDO', 'Retenido - En revisión', 'orange', true),
    ('DESPACHADO', 'Despachado', 'blue', true)
    ON CONFLICT (id) DO NOTHING`).catch(silentExists('schema-init'));

  await pool.query(`CREATE TABLE IF NOT EXISTS document_types (id VARCHAR(50) PRIMARY KEY, description VARCHAR(255), flow_type VARCHAR(20) DEFAULT 'BOTH')`);
  await pool.query(`INSERT INTO document_types (id, description, flow_type) VALUES ('GUIA_DESPACHO', 'Guía de Despacho', 'BOTH'), ('FACTURA', 'Factura Electrónica', 'BOTH'), ('ORDEN_COMPRA', 'Orden de Compra', 'INBOUND') ON CONFLICT DO NOTHING`);

  await pool.query(`CREATE TABLE IF NOT EXISTS clients (id VARCHAR(50) PRIMARY KEY, name VARCHAR(150), contact VARCHAR(150), email VARCHAR(150))`);

  await pool.query(`CREATE TABLE IF NOT EXISTS master_skus (sku VARCHAR(100), client_id VARCHAR(50), "desc" VARCHAR(255), PRIMARY KEY (sku, client_id))`);
  const skuCols = ["category VARCHAR(100) DEFAULT 'General'", "uom VARCHAR(20) DEFAULT 'UN'", "weight NUMERIC(10,2) DEFAULT 0", "length NUMERIC(10,2) DEFAULT 0", "width NUMERIC(10,2) DEFAULT 0", "height NUMERIC(10,2) DEFAULT 0", "abc_class VARCHAR(1)", "requires_lot BOOLEAN DEFAULT FALSE", "requires_serial BOOLEAN DEFAULT FALSE", "barcode VARCHAR(100)"];
  for (const c of skuCols) { await pool.query(`ALTER TABLE master_skus ADD COLUMN IF NOT EXISTS ${c}`).catch(silentExists('schema-init')); }

  await pool.query(`CREATE TABLE IF NOT EXISTS locations_master (location_id VARCHAR(50) PRIMARY KEY, zone_code VARCHAR(50))`);
  await pool.query(`INSERT INTO locations_master (location_id, zone_code) VALUES ('PISO-RECEPCION', 'INBOUND') ON CONFLICT DO NOTHING`);

  await pool.query(`CREATE TABLE IF NOT EXISTS inventory_lpns (id VARCHAR(100) PRIMARY KEY, client_id VARCHAR(50), sku VARCHAR(100), qty NUMERIC(12,2) CHECK (qty >= 0), status VARCHAR(50) DEFAULT 'DISPONIBLE')`);
  const invCols = ["location_id VARCHAR(50)", "batch_number VARCHAR(100)", "expiry_date DATE", "serial_number VARCHAR(100)", "glosa TEXT", "created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP"];
  for (const c of invCols) { await pool.query(`ALTER TABLE inventory_lpns ADD COLUMN IF NOT EXISTS ${c}`).catch(silentExists('schema-init')); }

  await pool.query(`CREATE TABLE IF NOT EXISTS audit_log (id SERIAL PRIMARY KEY, type VARCHAR(20), sku VARCHAR(100), qty NUMERIC(12,2), glosa TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
  await pool.query(`ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS username VARCHAR(50) DEFAULT 'SYSTEM'`).catch(silentExists('schema-init'));
  await pool.query(`ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS client_id VARCHAR(50)`).catch(silentExists('schema-init'));

  await pool.query(`CREATE TABLE IF NOT EXISTS users (username VARCHAR(50) PRIMARY KEY, full_name VARCHAR(150), password VARCHAR(255), role VARCHAR(50) DEFAULT 'EJECUTIVO_CUENTA', status VARCHAR(20) DEFAULT 'ACTIVE', allowed_clients TEXT DEFAULT 'ALL', allowed_modules TEXT DEFAULT 'ALL')`);

  // ── Seeds de admin/demo desde env vars, hasheadas con bcrypt ─────────────
  const seedAdminPwd = process.env.SEED_ADMIN_PASSWORD;
  const seedDemoPwd  = process.env.SEED_DEMO_PASSWORD;
  if (seedAdminPwd) {
    const hashedAdmin = await bcrypt.hash(seedAdminPwd, 12);
    await pool.query(
      `INSERT INTO users (username, full_name, password, role, status, allowed_clients, allowed_modules)
       VALUES ('admin', 'Administrador del Sistema', $1, 'ADMIN', 'ACTIVE', 'ALL', 'ALL')
       ON CONFLICT DO NOTHING`, [hashedAdmin]);
  } else if (process.env.NODE_ENV === 'production') {
    console.error('❌ [SEGURIDAD] SEED_ADMIN_PASSWORD no configurado en producción. El usuario admin no será creado.');
  } else {
    const hashedAdmin = await bcrypt.hash('admin123', 12);
    await pool.query(
      `INSERT INTO users (username, full_name, password, role, status, allowed_clients, allowed_modules)
       VALUES ('admin', 'Administrador del Sistema', $1, 'ADMIN', 'ACTIVE', 'ALL', 'ALL')
       ON CONFLICT DO NOTHING`, [hashedAdmin]);
    console.warn('⚠️  [SEGURIDAD] Usuario admin creado con contraseña por defecto (dev). Configure SEED_ADMIN_PASSWORD.');
  }
  if (seedDemoPwd) {
    const hashedDemo = await bcrypt.hash(seedDemoPwd, 12);
    await pool.query(
      `INSERT INTO users (username, full_name, password, role, status, allowed_clients, allowed_modules)
       VALUES ('demo', 'Usuario Demo', $1, 'DEMO', 'ACTIVE', 'ALL', 'ALL')
       ON CONFLICT DO NOTHING`, [hashedDemo]);
  } else if (process.env.NODE_ENV !== 'production') {
    const hashedDemo = await bcrypt.hash('demo', 12);
    await pool.query(
      `INSERT INTO users (username, full_name, password, role, status, allowed_clients, allowed_modules)
       VALUES ('demo', 'Usuario Demo', $1, 'DEMO', 'ACTIVE', 'ALL', 'ALL')
       ON CONFLICT DO NOTHING`, [hashedDemo]);
  }

  // Migrar contraseñas en texto plano heredadas (legacy) a bcrypt
  const plainUsers = await pool.query("SELECT username, password FROM users WHERE password NOT LIKE '$2b$%' AND password NOT LIKE '$2a$%'");
  for (const u of plainUsers.rows) {
    const hashed = await bcrypt.hash(u.password, 12);
    await pool.query('UPDATE users SET password = $1 WHERE username = $2', [hashed, u.username]);
  }

  // ── Kits ─────────────────────────────────────────────────────────────────
  await pool.query(`CREATE TABLE IF NOT EXISTS kits (kit_sku VARCHAR(100), client_id VARCHAR(50), description VARCHAR(255), PRIMARY KEY (kit_sku, client_id))`);
  await pool.query(`CREATE TABLE IF NOT EXISTS kit_components (id SERIAL PRIMARY KEY, kit_sku VARCHAR(100), kit_client_id VARCHAR(50), component_sku VARCHAR(100), qty NUMERIC(12,2) DEFAULT 1, UNIQUE(kit_sku, kit_client_id, component_sku))`);
  await pool.query(`CREATE TABLE IF NOT EXISTS kit_orders (id VARCHAR(100) PRIMARY KEY, kit_sku VARCHAR(100), client_id VARCHAR(50), qty_to_build INTEGER, status VARCHAR(20) DEFAULT 'COMPLETED', location_output VARCHAR(50) DEFAULT 'PISO-RECEPCION', created_by VARCHAR(50), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, notes TEXT)`);
  await pool.query(`ALTER TABLE kit_orders ADD COLUMN IF NOT EXISTS type VARCHAR(20) DEFAULT 'BUILT'`).catch(silentExists('schema-init'));
  await pool.query(`ALTER TABLE kit_orders ADD COLUMN IF NOT EXISTS result_lpn VARCHAR(100)`).catch(silentExists('schema-init'));

  // ── Portal de clientes ───────────────────────────────────────────────────
  await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS portal_enabled BOOLEAN DEFAULT FALSE`).catch(silentExists('schema-init'));
  await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS portal_password VARCHAR(255)`).catch(silentExists('schema-init'));
  await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS portal_email VARCHAR(150)`).catch(silentExists('schema-init'));

  // ── Notificaciones ───────────────────────────────────────────────────────
  await pool.query(`CREATE TABLE IF NOT EXISTS notifications (id SERIAL PRIMARY KEY, type VARCHAR(50), title VARCHAR(200), message TEXT, client_id VARCHAR(50), sku VARCHAR(100), severity VARCHAR(20) DEFAULT 'INFO', read BOOLEAN DEFAULT FALSE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);

  // ── Transporte ───────────────────────────────────────────────────────────
  await pool.query(`CREATE TABLE IF NOT EXISTS carriers (id VARCHAR(50) PRIMARY KEY, name VARCHAR(150), rut VARCHAR(20), contact VARCHAR(150), phone VARCHAR(50), email VARCHAR(150), active BOOLEAN DEFAULT TRUE)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS shipments (id VARCHAR(100) PRIMARY KEY, dispatch_doc_id VARCHAR(100), carrier_id VARCHAR(50), driver_name VARCHAR(150), driver_rut VARCHAR(20), plate VARCHAR(20), status VARCHAR(30) DEFAULT 'PENDING', scheduled_date DATE, pickup_date TIMESTAMP, delivery_date TIMESTAMP, destination_address TEXT, notes TEXT, created_by VARCHAR(50), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
  await pool.query(`ALTER TABLE shipments ADD COLUMN IF NOT EXISTS doc_num VARCHAR(100)`).catch(silentExists('schema-init'));
  await pool.query(`ALTER TABLE shipments ADD COLUMN IF NOT EXISTS client_id VARCHAR(50)`).catch(silentExists('schema-init'));
  await pool.query(`ALTER TABLE shipments ADD COLUMN IF NOT EXISTS destination VARCHAR(255)`).catch(silentExists('schema-init'));

  // ── API Keys ─────────────────────────────────────────────────────────────
  await pool.query(`CREATE TABLE IF NOT EXISTS api_keys (id SERIAL PRIMARY KEY, key_hash VARCHAR(255) UNIQUE, key_prefix VARCHAR(12), name VARCHAR(100), client_id VARCHAR(50), permissions TEXT DEFAULT 'read', active BOOLEAN DEFAULT TRUE, last_used TIMESTAMP, created_by VARCHAR(50), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);

  // ── Login history ────────────────────────────────────────────────────────
  await pool.query(`CREATE TABLE IF NOT EXISTS login_history (id SERIAL PRIMARY KEY, username VARCHAR(50), ip VARCHAR(60), success BOOLEAN DEFAULT TRUE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`).catch(silentExists('schema-init'));

  // ── Idempotencia de documentos (LOG-09) ──────────────────────────────────
  await pool.query(`CREATE TABLE IF NOT EXISTS processed_docs (
    doc_num VARCHAR(200),
    doc_type VARCHAR(50),
    client_id VARCHAR(50) DEFAULT '',
    processed_by VARCHAR(50),
    processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (doc_num, doc_type, client_id)
  )`).catch(silentExists('schema-init'));
  await pool.query(`ALTER TABLE processed_docs ADD COLUMN IF NOT EXISTS client_id VARCHAR(50) DEFAULT ''`).catch(silentExists('schema-init'));
  await pool.query(`ALTER TABLE processed_docs DROP CONSTRAINT IF EXISTS processed_docs_pkey`).catch(e => console.error('[schema-init] drop processed_docs pk:', e.message));
  await pool.query(`ALTER TABLE processed_docs ADD PRIMARY KEY (doc_num, doc_type, client_id)`).catch(e => { if (!String(e.message).includes('already exists') && !String(e.message).includes('multiple primary keys')) console.error('[schema-init]', e.message); });
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_processed_docs_docnum ON processed_docs(doc_num, doc_type, client_id)`).catch(silentExists('schema-init'));

  // ── stock_min / stock_max ────────────────────────────────────────────────
  await pool.query(`ALTER TABLE master_skus ADD COLUMN IF NOT EXISTS stock_min NUMERIC(12,2) DEFAULT 0`).catch(silentExists('schema-init'));
  await pool.query(`ALTER TABLE master_skus ADD COLUMN IF NOT EXISTS stock_max NUMERIC(12,2) DEFAULT 0`).catch(silentExists('schema-init'));

  // ── Índices de rendimiento ───────────────────────────────────────────────
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_inv_sku        ON inventory_lpns(sku)`).catch(silentExists('schema-init'));
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_inv_client     ON inventory_lpns(client_id)`).catch(silentExists('schema-init'));
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_inv_sku_client ON inventory_lpns(sku, client_id)`).catch(silentExists('schema-init'));
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_inv_status     ON inventory_lpns(status)`).catch(silentExists('schema-init'));
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_inv_location   ON inventory_lpns(location_id)`).catch(silentExists('schema-init'));
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_inv_qty        ON inventory_lpns(qty) WHERE qty > 0`).catch(silentExists('schema-init'));
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_audit_type     ON audit_log(type)`).catch(silentExists('schema-init'));
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_audit_sku      ON audit_log(sku)`).catch(silentExists('schema-init'));
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_audit_client   ON audit_log(client_id)`).catch(silentExists('schema-init'));
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_audit_user     ON audit_log(username)`).catch(silentExists('schema-init'));
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_audit_created  ON audit_log(created_at DESC)`).catch(silentExists('schema-init'));
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_login_user     ON login_history(username)`).catch(silentExists('schema-init'));

  // ── Datos semilla para demo (Modo Propio) ────────────────────────────────
  if (process.env.SEED_DEMO_DATA === 'true' || process.env.NODE_ENV !== 'production') {
    const seedLog = (msg) => console.log('[seed]', msg);
    try {
      await pool.query(`INSERT INTO clients (id,name,contact,email) VALUES
        ('PROPIO','Bodega Propia','Administrador','admin@empresa.cl')
        ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, contact=EXCLUDED.contact, email=EXCLUDED.email`);

      await pool.query(`DELETE FROM inventory_lpns WHERE id LIKE 'LPN-DEMO-%' OR id LIKE 'LPN-PROPIO-%' OR id LIKE 'DEMO-%'`);
      await pool.query(`DELETE FROM audit_log WHERE glosa LIKE '%[DEMO]%' OR glosa LIKE '%REC-DEMO-%' OR glosa LIKE '%GD-DEMO-%' OR glosa LIKE '%OC-DEMO-%'`);
      await pool.query(`DELETE FROM master_skus WHERE client_id='PROPIO' AND (sku LIKE 'ELEC-%' OR sku LIKE 'HERR-%' OR sku LIKE 'OFIC-%' OR sku LIKE 'CONS-%')`);
      await pool.query(`DELETE FROM processed_docs WHERE doc_num LIKE '%DEMO%'`).catch(() => {});
      seedLog('datos demo previos eliminados');

      await pool.query(`INSERT INTO master_skus (sku,client_id,"desc",category,uom,stock_min,stock_max,weight,requires_lot,requires_serial) VALUES
        ('ELEC-TV-55','PROPIO','Smart TV 55" 4K UHD','Electrónica','UN',5,50,18.5,false,true),
        ('ELEC-LAPTOP-15','PROPIO','Laptop 15" Core i7 16GB','Electrónica','UN',3,30,2.1,false,true),
        ('ELEC-MOUSE-WL','PROPIO','Mouse inalámbrico ergonómico','Electrónica','UN',20,200,0.15,false,false),
        ('ELEC-TECLADO-MEC','PROPIO','Teclado mecánico RGB','Electrónica','UN',10,100,1.2,false,false),
        ('HERR-TALADRO-18V','PROPIO','Taladro inalámbrico 18V','Herramientas','UN',2,20,2.5,true,false),
        ('HERR-LLAVE-SET','PROPIO','Set llaves combinadas 12 pzs','Herramientas','UN',5,50,3.8,false,false),
        ('HERR-SIERRA-CIRC','PROPIO','Sierra circular 7-1/4"','Herramientas','UN',2,15,4.2,true,false),
        ('HERR-CASCO-SEG','PROPIO','Casco de seguridad industrial','Herramientas','UN',10,80,0.45,false,false),
        ('OFIC-PAPEL-A4','PROPIO','Papel bond A4 resma 500 hojas','Oficina','UN',20,200,2.5,false,false),
        ('OFIC-TONER-HP','PROPIO','Tóner HP LaserJet negro','Oficina','UN',3,30,0.9,true,false),
        ('OFIC-CARPETA','PROPIO','Carpeta archivador lomo ancho','Oficina','UN',30,300,0.35,false,false),
        ('CONS-AGUA-2L','PROPIO','Agua mineral 2L pack x6','Consumo','PACK',10,100,12.0,true,false),
        ('CONS-CAFE-1K','PROPIO','Café tostado molido 1kg','Consumo','UN',5,50,1.0,true,false)
        ON CONFLICT (sku,client_id) DO UPDATE SET "desc"=EXCLUDED."desc", category=EXCLUDED.category, stock_min=EXCLUDED.stock_min, stock_max=EXCLUDED.stock_max`);

      await pool.query(`INSERT INTO locations_master (location_id,zone_code) VALUES
        ('RACK-A-01','ZONA-A'),('RACK-A-02','ZONA-A'),('RACK-A-03','ZONA-A'),
        ('RACK-B-01','ZONA-B'),('RACK-B-02','ZONA-B'),('RACK-B-03','ZONA-B'),
        ('RACK-C-01','ZONA-C'),('RACK-C-02','ZONA-C'),
        ('PICKING-01','PICKING'),('PICKING-02','PICKING'),
        ('CAMARA-FRIA-01','CAMARA'),('CUARENTENA-01','CUARENTENA')
        ON CONFLICT (location_id) DO NOTHING`);

      await pool.query(`INSERT INTO inventory_lpns (id,client_id,sku,qty,status,location_id,batch_number,serial_number,expiry_date,glosa,created_at) VALUES
        ('LPN-PROPIO-0001','PROPIO','ELEC-TV-55',1,'DISPONIBLE','RACK-A-01','LOTE-2026-01','SN-TV55-001',NULL,'[DEMO] Stock inicial',NOW()-INTERVAL '10 days'),
        ('LPN-PROPIO-0002','PROPIO','ELEC-TV-55',1,'DISPONIBLE','RACK-A-01','LOTE-2026-01','SN-TV55-002',NULL,'[DEMO] Stock inicial',NOW()-INTERVAL '10 days'),
        ('LPN-PROPIO-0003','PROPIO','ELEC-TV-55',1,'DISPONIBLE','RACK-A-01','LOTE-2026-01','SN-TV55-003',NULL,'[DEMO] Stock inicial',NOW()-INTERVAL '10 days'),
        ('LPN-PROPIO-0004','PROPIO','ELEC-LAPTOP-15',1,'DISPONIBLE','RACK-A-02','LOTE-2026-01','SN-LAP15-001',NULL,'[DEMO]',NOW()-INTERVAL '8 days'),
        ('LPN-PROPIO-0005','PROPIO','ELEC-LAPTOP-15',1,'DISPONIBLE','RACK-A-02','LOTE-2026-01','SN-LAP15-002',NULL,'[DEMO]',NOW()-INTERVAL '8 days'),
        ('LPN-PROPIO-0006','PROPIO','ELEC-MOUSE-WL',80,'DISPONIBLE','RACK-A-03','LOTE-2026-02',NULL,NULL,'[DEMO]',NOW()-INTERVAL '7 days'),
        ('LPN-PROPIO-0007','PROPIO','ELEC-TECLADO-MEC',25,'DISPONIBLE','RACK-A-03','LOTE-2026-02',NULL,NULL,'[DEMO]',NOW()-INTERVAL '7 days'),
        ('LPN-PROPIO-0008','PROPIO','HERR-TALADRO-18V',12,'DISPONIBLE','RACK-B-01','LOTE-H-2026-A',NULL,NULL,'[DEMO]',NOW()-INTERVAL '6 days'),
        ('LPN-PROPIO-0009','PROPIO','HERR-LLAVE-SET',30,'DISPONIBLE','RACK-B-02','LOTE-H-2026-B',NULL,NULL,'[DEMO]',NOW()-INTERVAL '6 days'),
        ('LPN-PROPIO-0010','PROPIO','HERR-SIERRA-CIRC',6,'DISPONIBLE','RACK-B-03','LOTE-H-2026-C',NULL,NULL,'[DEMO]',NOW()-INTERVAL '6 days'),
        ('LPN-PROPIO-0011','PROPIO','HERR-CASCO-SEG',45,'DISPONIBLE','RACK-B-03','LOTE-H-2026-D',NULL,NULL,'[DEMO]',NOW()-INTERVAL '6 days'),
        ('LPN-PROPIO-0012','PROPIO','OFIC-PAPEL-A4',120,'DISPONIBLE','RACK-C-01','LOTE-O-2026-A',NULL,NULL,'[DEMO]',NOW()-INTERVAL '5 days'),
        ('LPN-PROPIO-0013','PROPIO','OFIC-PAPEL-A4',80,'DISPONIBLE','PICKING-01','LOTE-O-2026-A',NULL,NULL,'[DEMO] Reposición picking',NOW()-INTERVAL '2 days'),
        ('LPN-PROPIO-0014','PROPIO','OFIC-TONER-HP',18,'DISPONIBLE','RACK-C-01','LOTE-O-2026-B',NULL,NULL,'[DEMO]',NOW()-INTERVAL '5 days'),
        ('LPN-PROPIO-0015','PROPIO','OFIC-CARPETA',150,'DISPONIBLE','RACK-C-02','LOTE-O-2026-C',NULL,NULL,'[DEMO]',NOW()-INTERVAL '5 days'),
        ('LPN-PROPIO-0016','PROPIO','CONS-AGUA-2L',40,'DISPONIBLE','CAMARA-FRIA-01','LOTE-C-2026-A',NULL,(NOW() + INTERVAL '180 days')::date,'[DEMO]',NOW()-INTERVAL '3 days'),
        ('LPN-PROPIO-0017','PROPIO','CONS-CAFE-1K',22,'DISPONIBLE','RACK-C-02','LOTE-C-2026-B',NULL,(NOW() + INTERVAL '365 days')::date,'[DEMO]',NOW()-INTERVAL '3 days'),
        ('LPN-PROPIO-0018','PROPIO','HERR-TALADRO-18V',2,'CUARENTENA','CUARENTENA-01','LOTE-H-2026-A',NULL,NULL,'[DEMO] Daño en embalaje',NOW()-INTERVAL '1 day'),
        ('LPN-PROPIO-0019','PROPIO','ELEC-MOUSE-WL',5,'BLOQUEADO','CUARENTENA-01','LOTE-2026-02',NULL,NULL,'[DEMO] Revisión calidad',NOW()-INTERVAL '1 day'),
        ('LPN-PROPIO-0020','PROPIO','CONS-AGUA-2L',8,'CUARENTENA','CUARENTENA-01','LOTE-C-2026-A',NULL,(NOW() + INTERVAL '180 days')::date,'[DEMO] Pendiente inspección',NOW()-INTERVAL '1 day')
        ON CONFLICT (id) DO NOTHING`);

      await pool.query(`INSERT INTO audit_log (type,sku,qty,glosa,username,client_id,created_at) VALUES
        ('INBOUND','ELEC-TV-55',5,'[DEMO] Doc: REC-DEMO-001 OC: OC-DEMO-2026-001','admin','PROPIO',NOW()-INTERVAL '10 days'),
        ('INBOUND','ELEC-LAPTOP-15',2,'[DEMO] Doc: REC-DEMO-002 OC: OC-DEMO-2026-002','admin','PROPIO',NOW()-INTERVAL '8 days'),
        ('INBOUND','ELEC-MOUSE-WL',100,'[DEMO] Doc: REC-DEMO-003','admin','PROPIO',NOW()-INTERVAL '7 days'),
        ('INBOUND','HERR-TALADRO-18V',15,'[DEMO] Doc: REC-DEMO-004','admin','PROPIO',NOW()-INTERVAL '6 days'),
        ('INBOUND','OFIC-PAPEL-A4',200,'[DEMO] Doc: REC-DEMO-005','admin','PROPIO',NOW()-INTERVAL '5 days'),
        ('INBOUND','CONS-AGUA-2L',50,'[DEMO] Doc: REC-DEMO-006','admin','PROPIO',NOW()-INTERVAL '3 days'),
        ('OUTBOUND','ELEC-TV-55',2,'[DEMO] LPN: LPN-PROPIO-0001. Doc: GD-DEMO-2026-001','admin','PROPIO',NOW()-INTERVAL '4 days'),
        ('OUTBOUND','ELEC-MOUSE-WL',20,'[DEMO] LPN: LPN-PROPIO-0006. Doc: GD-DEMO-2026-002','admin','PROPIO',NOW()-INTERVAL '3 days'),
        ('OUTBOUND','OFIC-PAPEL-A4',105,'[DEMO] LPN: LPN-PROPIO-0012. Doc: GD-DEMO-2026-003','admin','PROPIO',NOW()-INTERVAL '1 day'),
        ('RELOCATE','OFIC-PAPEL-A4',80,'[DEMO] Reubicación de RACK-C-01 a PICKING-01','admin','PROPIO',NOW()-INTERVAL '2 days')`);

      seedLog('datos demo PROPIO insertados: 13 SKUs, 20 LPNs, 10 movimientos');
    } catch (seedErr) {
      console.error('[seed] Error sembrando datos demo:', seedErr.message);
    }
  }

  // ── Normalización de datos (integridad) ──────────────────────────────────
  await pool.query(`UPDATE inventory_lpns SET serial_number = NULL WHERE serial_number = ''`)
    .catch(e => console.error('[schema-init] normalize serial_number:', e.message));

  // ── Tablas bajo demanda ──────────────────────────────────────────────────
  await pool.query(`CREATE TABLE IF NOT EXISTS document_history (id VARCHAR(100) PRIMARY KEY, module VARCHAR(20), doc_num VARCHAR(100), doc_type VARCHAR(50), glosa TEXT, username VARCHAR(50), items_json TEXT, total_qty NUMERIC(12,2), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`).catch(silentExists('schema-init'));
  await pool.query(`CREATE TABLE IF NOT EXISTS purchase_orders (id VARCHAR(100) PRIMARY KEY, doc_num VARCHAR(100), supplier VARCHAR(150), client_id VARCHAR(50), status VARCHAR(20) DEFAULT 'PENDING', created_by VARCHAR(50), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, expected_date DATE, notes TEXT)`).catch(silentExists('schema-init'));
  await pool.query(`CREATE TABLE IF NOT EXISTS returns (id VARCHAR(100) PRIMARY KEY, doc_num VARCHAR(100), doc_type VARCHAR(50), client_id VARCHAR(50), reason TEXT, status VARCHAR(20) DEFAULT 'COMPLETED', created_by VARCHAR(50), glosa TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`).catch(silentExists('schema-init'));
  await pool.query(`CREATE TABLE IF NOT EXISTS return_lines (id SERIAL PRIMARY KEY, return_id VARCHAR(100), sku VARCHAR(100), qty NUMERIC(12,2), original_lpn VARCHAR(100), new_lpn VARCHAR(100), condition VARCHAR(20) DEFAULT 'BUENO', location_id VARCHAR(50), notes TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`).catch(silentExists('schema-init'));

  await pool.query(`CREATE TABLE IF NOT EXISTS returned_lpns (
    original_lpn VARCHAR(100) PRIMARY KEY,
    return_id VARCHAR(100),
    returned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`).catch(silentExists('schema-init'));

  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_serial_per_sku
    ON inventory_lpns (sku, serial_number)
    WHERE serial_number IS NOT NULL AND serial_number <> ''`).catch(silentExists('schema-init'));

  // ── Solicitudes de reubicación (aprobación por supervisor) ───────────────
  await pool.query(`CREATE TABLE IF NOT EXISTS relocation_requests (
    id           VARCHAR(100) PRIMARY KEY,
    lpn_id       VARCHAR(100) NOT NULL,
    sku          VARCHAR(100),
    qty          NUMERIC(12,2) NOT NULL,
    location_from VARCHAR(50),
    location_to  VARCHAR(50) NOT NULL,
    glosa        TEXT,
    status       VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
    requested_by VARCHAR(50) NOT NULL,
    requested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_by  VARCHAR(50),
    resolved_at  TIMESTAMP,
    reject_reason TEXT
  )`).catch(silentExists('schema-init'));
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_reloc_req_status ON relocation_requests(status)`).catch(silentExists('schema-init'));
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_reloc_req_user   ON relocation_requests(requested_by)`).catch(silentExists('schema-init'));

  // ── Programación de salidas ──────────────────────────────────────────────
  await pool.query(`CREATE TABLE IF NOT EXISTS dispatch_schedules (
    id              VARCHAR(100) PRIMARY KEY,
    doc_num         VARCHAR(100) NOT NULL,
    client_id       VARCHAR(50),
    doc_type        VARCHAR(50),
    glosa           TEXT,
    status          VARCHAR(30) NOT NULL DEFAULT 'PROGRAMADO',
    scheduled_date  DATE NOT NULL,
    scheduled_time  TIME,
    carrier         VARCHAR(150),
    destination     VARCHAR(255),
    notes           TEXT,
    created_by      VARCHAR(50) NOT NULL,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    confirmed_by    VARCHAR(50),
    confirmed_at    TIMESTAMP
  )`).catch(silentExists('schema-init'));
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_ds_status ON dispatch_schedules(status)`).catch(silentExists('schema-init'));
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_ds_date   ON dispatch_schedules(scheduled_date)`).catch(silentExists('schema-init'));

  // ── Sistema de pickeadores ───────────────────────────────────────────────
  await pool.query(`CREATE TABLE IF NOT EXISTS pick_tasks (
    id           VARCHAR(100) PRIMARY KEY,
    doc_id       VARCHAR(100) NOT NULL,
    doc_num      VARCHAR(100) NOT NULL,
    doc_type     VARCHAR(50)  NOT NULL,
    module       VARCHAR(20)  NOT NULL,
    client_id    VARCHAR(50),
    status       VARCHAR(20)  NOT NULL DEFAULT 'PENDIENTE',
    priority     INTEGER      NOT NULL DEFAULT 5,
    created_by   VARCHAR(50)  NOT NULL,
    created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    notes        TEXT
  )`).catch(silentExists('schema-init'));
  await pool.query(`CREATE TABLE IF NOT EXISTS pick_task_lines (
    id              SERIAL       PRIMARY KEY,
    task_id         VARCHAR(100) NOT NULL REFERENCES pick_tasks(id) ON DELETE CASCADE,
    line_index      INTEGER      NOT NULL,
    sku             VARCHAR(100) NOT NULL,
    sku_desc        VARCHAR(255),
    lpn_id          VARCHAR(100),
    location_from   VARCHAR(50),
    location_to     VARCHAR(50),
    qty_requested   NUMERIC(12,2) NOT NULL,
    qty_confirmed   NUMERIC(12,2),
    batch_confirmed VARCHAR(100),
    serial_confirmed VARCHAR(100),
    status          VARCHAR(20)  NOT NULL DEFAULT 'PENDIENTE',
    assigned_to     VARCHAR(50),
    started_at      TIMESTAMP,
    confirmed_at    TIMESTAMP,
    diff_reason     TEXT,
    updated_by      VARCHAR(50),
    updated_at      TIMESTAMP
  )`).catch(silentExists('schema-init'));
  await pool.query(`ALTER TABLE pick_task_lines ADD COLUMN IF NOT EXISTS updated_by VARCHAR(50)`).catch(silentExists('schema-init'));
  await pool.query(`ALTER TABLE pick_task_lines ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP`).catch(silentExists('schema-init'));
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pick_tasks_status   ON pick_tasks(status)`).catch(silentExists('schema-init'));
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pick_tasks_doc_num  ON pick_tasks(doc_num)`).catch(silentExists('schema-init'));
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pick_tasks_module   ON pick_tasks(module)`).catch(silentExists('schema-init'));
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pick_lines_task_id  ON pick_task_lines(task_id)`).catch(silentExists('schema-init'));
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pick_lines_assigned ON pick_task_lines(assigned_to)`).catch(silentExists('schema-init'));
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pick_lines_status   ON pick_task_lines(status)`).catch(silentExists('schema-init'));
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_inventory_sku_client ON inventory_lpns(sku, client_id) WHERE qty > 0`).catch(silentExists('schema-init'));
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_inventory_client_id  ON inventory_lpns(client_id) WHERE qty > 0`).catch(silentExists('schema-init'));
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_audit_created_at     ON audit_log(created_at DESC)`).catch(silentExists('schema-init'));
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_audit_sku            ON audit_log(sku)`).catch(silentExists('schema-init'));

  // ── Anulaciones ──────────────────────────────────────────────────────────
  await pool.query(`ALTER TABLE document_history ADD COLUMN IF NOT EXISTS client_id VARCHAR(50) DEFAULT ''`).catch(silentExists('schema-init'));
  await pool.query(`ALTER TABLE document_history ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'ACTIVO'`).catch(silentExists('schema-init'));
  await pool.query(`ALTER TABLE document_history ADD COLUMN IF NOT EXISTS void_reason TEXT`).catch(silentExists('schema-init'));
  await pool.query(`ALTER TABLE document_history ADD COLUMN IF NOT EXISTS voided_by VARCHAR(50)`).catch(silentExists('schema-init'));
  await pool.query(`ALTER TABLE document_history ADD COLUMN IF NOT EXISTS voided_at TIMESTAMP`).catch(silentExists('schema-init'));
  await pool.query(`ALTER TABLE document_history ADD COLUMN IF NOT EXISTS doc_date DATE`).catch(silentExists('schema-init'));
  await pool.query(`ALTER TABLE document_history ADD COLUMN IF NOT EXISTS doc_ref VARCHAR(200)`).catch(silentExists('schema-init'));
  await pool.query(`ALTER TABLE document_history ADD COLUMN IF NOT EXISTS entered_at TIMESTAMP`).catch(silentExists('schema-init'));
  await pool.query(`CREATE TABLE IF NOT EXISTS anulation_requests (
    id            VARCHAR(100) PRIMARY KEY,
    doc_history_id VARCHAR(100) NOT NULL,
    doc_num       VARCHAR(100) NOT NULL,
    module        VARCHAR(20)  NOT NULL,
    reason        TEXT         NOT NULL,
    status        VARCHAR(20)  DEFAULT 'PENDIENTE',
    requested_by  VARCHAR(50)  NOT NULL,
    authorized_by VARCHAR(50),
    reject_reason TEXT,
    created_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    resolved_at   TIMESTAMP
  )`).catch(silentExists('schema-init'));

  // ── Solicitudes de ajuste ────────────────────────────────────────────────
  await pool.query(`CREATE TABLE IF NOT EXISTS adjustment_requests (
    id            VARCHAR(100) PRIMARY KEY,
    doc_num       VARCHAR(100) NOT NULL,
    glosa         TEXT,
    items         JSONB        NOT NULL,
    status        VARCHAR(20)  DEFAULT 'PENDIENTE',
    requested_by  VARCHAR(50)  NOT NULL,
    authorized_by VARCHAR(50),
    reject_reason TEXT,
    created_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    resolved_at   TIMESTAMP
  )`).catch(silentExists('schema-init'));

  // ── Sistemas v11.0 ───────────────────────────────────────────────────────
  await pool.query(`CREATE TABLE IF NOT EXISTS suppliers (
    id           VARCHAR(50)  PRIMARY KEY,
    name         VARCHAR(150) NOT NULL,
    rut          VARCHAR(20),
    contact_name VARCHAR(100),
    contact_email VARCHAR(150),
    contact_phone VARCHAR(30),
    address      TEXT,
    lead_time_days INTEGER DEFAULT 5,
    notes        TEXT,
    status       VARCHAR(20)  DEFAULT 'ACTIVE',
    created_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
  )`).catch(silentExists('schema-init'));

  await pool.query(`CREATE TABLE IF NOT EXISTS asns (
    id            VARCHAR(100) PRIMARY KEY,
    supplier_id   VARCHAR(50),
    supplier_name VARCHAR(150),
    expected_date DATE,
    reference     VARCHAR(150),
    status        VARCHAR(20)  DEFAULT 'ESPERANDO',
    notes         TEXT,
    created_by    VARCHAR(50),
    created_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    received_at   TIMESTAMP
  )`).catch(silentExists('schema-init'));
  await pool.query(`ALTER TABLE asns ADD COLUMN IF NOT EXISTS reference VARCHAR(150)`).catch(silentExists('schema-init'));
  await pool.query(`CREATE TABLE IF NOT EXISTS asn_lines (
    id           SERIAL PRIMARY KEY,
    asn_id       VARCHAR(100) REFERENCES asns(id) ON DELETE CASCADE,
    sku          VARCHAR(100) NOT NULL,
    qty_expected NUMERIC(12,2) DEFAULT 0,
    qty_received NUMERIC(12,2) DEFAULT 0,
    lot          VARCHAR(100),
    notes        TEXT
  )`).catch(silentExists('schema-init'));

  await pool.query(`CREATE TABLE IF NOT EXISTS pick_waves (
    id           VARCHAR(100) PRIMARY KEY,
    name         VARCHAR(150),
    status       VARCHAR(20)  DEFAULT 'BORRADOR',
    zone_filter  VARCHAR(50),
    line_count   INTEGER      DEFAULT 0,
    created_by   VARCHAR(50),
    created_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    released_at  TIMESTAMP,
    completed_at TIMESTAMP
  )`).catch(silentExists('schema-init'));
  await pool.query(`CREATE TABLE IF NOT EXISTS pick_wave_lines (
    id           SERIAL PRIMARY KEY,
    wave_id      VARCHAR(100) REFERENCES pick_waves(id) ON DELETE CASCADE,
    task_line_id VARCHAR(100)
  )`).catch(silentExists('schema-init'));

  await pool.query(`CREATE TABLE IF NOT EXISTS packing_orders (
    id               VARCHAR(100) PRIMARY KEY,
    dispatch_doc_num VARCHAR(100),
    client_id        VARCHAR(50),
    status           VARCHAR(20)  DEFAULT 'PENDIENTE',
    packed_by        VARCHAR(50),
    carton_count     INTEGER      DEFAULT 0,
    total_weight_kg  NUMERIC(10,2),
    notes            TEXT,
    created_by       VARCHAR(50),
    created_at       TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    packed_at        TIMESTAMP
  )`).catch(silentExists('schema-init'));
  await pool.query(`CREATE TABLE IF NOT EXISTS packing_lines (
    id               SERIAL PRIMARY KEY,
    packing_order_id VARCHAR(100) REFERENCES packing_orders(id) ON DELETE CASCADE,
    lpn_id           VARCHAR(100),
    sku              VARCHAR(100),
    sku_desc         VARCHAR(255),
    qty_expected     NUMERIC(12,2) DEFAULT 0,
    qty_packed       NUMERIC(12,2) DEFAULT 0,
    carton_num       INTEGER       DEFAULT 1,
    status           VARCHAR(20)   DEFAULT 'PENDIENTE'
  )`).catch(silentExists('schema-init'));

  await pool.query(`CREATE TABLE IF NOT EXISTS docks (
    id       VARCHAR(50)  PRIMARY KEY,
    name     VARCHAR(100) NOT NULL,
    type     VARCHAR(20)  DEFAULT 'BOTH',
    capacity INTEGER      DEFAULT 1,
    status   VARCHAR(20)  DEFAULT 'DISPONIBLE',
    notes    TEXT
  )`).catch(silentExists('schema-init'));
  await pool.query(`ALTER TABLE docks ADD COLUMN IF NOT EXISTS capacity INTEGER DEFAULT 1`).catch(silentExists('schema-init'));
  await pool.query(`CREATE TABLE IF NOT EXISTS dock_appointments (
    id           VARCHAR(100) PRIMARY KEY,
    dock_id      VARCHAR(50),
    doc_num      VARCHAR(100),
    module       VARCHAR(20),
    carrier_name VARCHAR(100),
    driver_name  VARCHAR(100),
    plate        VARCHAR(20),
    scheduled_at TIMESTAMP    NOT NULL,
    duration_mins INTEGER     DEFAULT 60,
    status       VARCHAR(20)  DEFAULT 'PROGRAMADA',
    notes        TEXT,
    created_by   VARCHAR(50),
    created_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
  )`).catch(silentExists('schema-init'));

  await pool.query(`CREATE TABLE IF NOT EXISTS invoices (
    id           VARCHAR(100) PRIMARY KEY,
    invoice_num  VARCHAR(50),
    client_id    VARCHAR(50)  NOT NULL,
    period_start DATE         NOT NULL,
    period_end   DATE         NOT NULL,
    status       VARCHAR(20)  DEFAULT 'BORRADOR',
    subtotal     NUMERIC(14,2) DEFAULT 0,
    tax_rate     NUMERIC(5,2)  DEFAULT 19,
    tax_amount   NUMERIC(14,2) DEFAULT 0,
    total        NUMERIC(14,2) DEFAULT 0,
    notes        TEXT,
    created_by   VARCHAR(50),
    created_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    issued_at    TIMESTAMP,
    paid_at      TIMESTAMP
  )`).catch(silentExists('schema-init'));
  await pool.query(`CREATE TABLE IF NOT EXISTS invoice_lines (
    id         SERIAL PRIMARY KEY,
    invoice_id VARCHAR(100) REFERENCES invoices(id) ON DELETE CASCADE,
    concept    VARCHAR(200) NOT NULL,
    unit       VARCHAR(30)  DEFAULT 'UN',
    qty        NUMERIC(10,2) DEFAULT 1,
    unit_price NUMERIC(12,2) DEFAULT 0,
    total      NUMERIC(14,2) DEFAULT 0
  )`).catch(silentExists('schema-init'));

  await pool.query(`ALTER TABLE returns ADD COLUMN IF NOT EXISTS inspection_status VARCHAR(20) DEFAULT 'PENDIENTE'`).catch(silentExists('schema-init'));
  await pool.query(`ALTER TABLE returns ADD COLUMN IF NOT EXISTS disposition VARCHAR(20) DEFAULT 'RESTOCK'`).catch(silentExists('schema-init'));
  await pool.query(`ALTER TABLE returns ADD COLUMN IF NOT EXISTS inspected_by VARCHAR(50)`).catch(silentExists('schema-init'));
  await pool.query(`ALTER TABLE returns ADD COLUMN IF NOT EXISTS inspected_at TIMESTAMP`).catch(silentExists('schema-init'));
  await pool.query(`ALTER TABLE returns ADD COLUMN IF NOT EXISTS inspection_notes TEXT`).catch(silentExists('schema-init'));
  await pool.query(`ALTER TABLE return_lines ADD COLUMN IF NOT EXISTS qty_ok NUMERIC(12,2)`).catch(silentExists('schema-init'));
  await pool.query(`ALTER TABLE return_lines ADD COLUMN IF NOT EXISTS qty_damaged NUMERIC(12,2) DEFAULT 0`).catch(silentExists('schema-init'));

  await pool.query(`CREATE TABLE IF NOT EXISTS cycle_counts (
    id           VARCHAR(100) PRIMARY KEY,
    zone_code    VARCHAR(50),
    status       VARCHAR(20)  DEFAULT 'PENDING',
    created_by   VARCHAR(50),
    created_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP,
    notes        TEXT
  )`).catch(silentExists('schema-init'));
  await pool.query(`CREATE TABLE IF NOT EXISTS cycle_count_lines (
    id           SERIAL PRIMARY KEY,
    count_id     VARCHAR(100),
    sku          VARCHAR(100),
    location_id  VARCHAR(50),
    expected_qty NUMERIC(12,2),
    counted_qty  NUMERIC(12,2),
    difference   NUMERIC(12,2),
    status       VARCHAR(20)  DEFAULT 'PENDING',
    counted_by   VARCHAR(50),
    counted_at   TIMESTAMP
  )`).catch(silentExists('schema-init'));

  await pool.query(`CREATE TABLE IF NOT EXISTS billing_invoices (
    id           VARCHAR(100) PRIMARY KEY,
    client_id    VARCHAR(50),
    period       VARCHAR(7),
    month        INTEGER,
    year         INTEGER,
    subtotal     NUMERIC(14,2) DEFAULT 0,
    tax_rate     NUMERIC(5,2)  DEFAULT 0,
    tax_amount   NUMERIC(14,2) DEFAULT 0,
    total        NUMERIC(14,2) DEFAULT 0,
    currency     VARCHAR(10)   DEFAULT 'CLP',
    status       VARCHAR(20)   DEFAULT 'EMITIDA',
    notes        TEXT,
    charges_json TEXT,
    issued_by    VARCHAR(50),
    issued_at    TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
    paid_at      TIMESTAMP,
    due_date     DATE
  )`).catch(silentExists('schema-init'));
  await pool.query(`CREATE TABLE IF NOT EXISTS client_tariffs (
    id          SERIAL PRIMARY KEY,
    client_id   VARCHAR(50),
    tariff_type VARCHAR(50),
    unit_price  NUMERIC(12,4) DEFAULT 0,
    currency    VARCHAR(10)   DEFAULT 'CLP',
    description TEXT,
    active      BOOLEAN       DEFAULT TRUE,
    created_at  TIMESTAMP     DEFAULT CURRENT_TIMESTAMP
  )`).catch(silentExists('schema-init'));
  await pool.query(`CREATE TABLE IF NOT EXISTS storage_events (
    id          SERIAL PRIMARY KEY,
    client_id   VARCHAR(50),
    event_type  VARCHAR(50),
    sku         VARCHAR(100),
    lpn_id      VARCHAR(100),
    qty         NUMERIC(12,2),
    weight_kg   NUMERIC(12,4) DEFAULT 0,
    location_id VARCHAR(50),
    event_date  DATE          DEFAULT CURRENT_DATE,
    billed      BOOLEAN       DEFAULT FALSE,
    bill_period VARCHAR(20),
    unit_price  NUMERIC(12,4) DEFAULT 0,
    total_amount NUMERIC(12,2) DEFAULT 0
  )`).catch(silentExists('schema-init'));

  await pool.query(`CREATE TABLE IF NOT EXISTS system_config (
    key        VARCHAR(100) PRIMARY KEY,
    value      TEXT,
    updated_by VARCHAR(50),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`).catch(silentExists('schema-init'));

  await pool.query(`CREATE TABLE IF NOT EXISTS sku_resources (
    id SERIAL PRIMARY KEY,
    sku VARCHAR(100),
    client_id VARCHAR(50),
    resource_type VARCHAR(20) DEFAULT 'MATERIAL',
    resource_name VARCHAR(150),
    qty_per_unit NUMERIC(12,4) DEFAULT 1,
    unit VARCHAR(30) DEFAULT 'UN',
    hours_per_unit NUMERIC(10,4) DEFAULT 0,
    time_unit VARCHAR(10) DEFAULT 'HORAS',
    personnel_count INTEGER DEFAULT 1,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(sku, client_id, resource_type, resource_name)
  )`).catch(silentExists('schema-init'));
  await pool.query(`ALTER TABLE sku_resources ADD COLUMN IF NOT EXISTS time_unit VARCHAR(10) DEFAULT 'HORAS'`).catch(silentExists('schema-init'));

  // ── Índices de unicidad ──────────────────────────────────────────────────
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_master_skus_barcode ON master_skus(barcode) WHERE barcode IS NOT NULL AND barcode <> ''`).catch(silentExists('schema-init'));
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_carriers_rut ON carriers(rut) WHERE rut IS NOT NULL AND rut <> ''`).catch(silentExists('schema-init'));
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_email ON clients(email) WHERE email IS NOT NULL AND email <> ''`).catch(silentExists('schema-init'));
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_portal_email ON clients(portal_email) WHERE portal_email IS NOT NULL AND portal_email <> ''`).catch(silentExists('schema-init'));
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_client_tariffs_type ON client_tariffs(client_id, tariff_type)`).catch(silentExists('schema-init'));
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_cycle_counts_zone_active ON cycle_counts(zone_code) WHERE status IN ('PENDING','EN_PROCESO')`).catch(silentExists('schema-init'));
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_pick_tasks_doc_active ON pick_tasks(doc_num, module, client_id) WHERE status NOT IN ('COMPLETADA','CANCELADA')`).catch(silentExists('schema-init'));
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_purchase_orders_docnum ON purchase_orders(doc_num, client_id)`).catch(silentExists('schema-init'));
}

module.exports = { id: '001_initial', run };
