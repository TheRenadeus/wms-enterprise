-- WMS Enterprise - Esquema completo de base de datos
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Estados de inventario
CREATE TABLE IF NOT EXISTS statuses (
  id VARCHAR(50) PRIMARY KEY,
  description VARCHAR(255),
  color VARCHAR(20) DEFAULT 'slate',
  blocks_outbound BOOLEAN DEFAULT FALSE
);
INSERT INTO statuses (id, description, color, blocks_outbound) VALUES
  ('DISPONIBLE', 'Disponible', 'green', false),
  ('BLOQUEADO', 'Bloqueado', 'red', true),
  ('CUARENTENA', 'En Cuarentena', 'yellow', true)
ON CONFLICT DO NOTHING;

-- Tipos de documentos
CREATE TABLE IF NOT EXISTS document_types (
  id VARCHAR(50) PRIMARY KEY,
  description VARCHAR(255),
  flow_type VARCHAR(20) DEFAULT 'BOTH'
);
INSERT INTO document_types (id, description, flow_type) VALUES
  ('GUIA_DESPACHO', 'Guía de Despacho', 'BOTH'),
  ('FACTURA', 'Factura Electrónica', 'BOTH'),
  ('ORDEN_COMPRA', 'Orden de Compra', 'INBOUND')
ON CONFLICT DO NOTHING;

-- Clientes
CREATE TABLE IF NOT EXISTS clients (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(150),
  contact VARCHAR(150),
  email VARCHAR(150)
);

-- Maestro de SKUs
CREATE TABLE IF NOT EXISTS master_skus (
  sku VARCHAR(100),
  client_id VARCHAR(50),
  "desc" VARCHAR(255),
  category VARCHAR(100) DEFAULT 'General',
  uom VARCHAR(20) DEFAULT 'UN',
  weight NUMERIC(10,2) DEFAULT 0,
  length NUMERIC(10,2) DEFAULT 0,
  width NUMERIC(10,2) DEFAULT 0,
  height NUMERIC(10,2) DEFAULT 0,
  abc_class VARCHAR(1),
  requires_lot BOOLEAN DEFAULT FALSE,
  requires_serial BOOLEAN DEFAULT FALSE,
  barcode VARCHAR(100),
  PRIMARY KEY (sku, client_id)
);

-- Ubicaciones de bodega
CREATE TABLE IF NOT EXISTS locations_master (
  location_id VARCHAR(50) PRIMARY KEY,
  zone_code VARCHAR(50)
);
INSERT INTO locations_master (location_id, zone_code) VALUES
  ('PISO-RECEPCION', 'INBOUND')
ON CONFLICT DO NOTHING;

-- Inventario LPN
CREATE TABLE IF NOT EXISTS inventory_lpns (
  id VARCHAR(100) PRIMARY KEY,
  client_id VARCHAR(50),
  sku VARCHAR(100),
  qty NUMERIC(12,2) CHECK (qty >= 0),
  status VARCHAR(50) DEFAULT 'DISPONIBLE',
  location_id VARCHAR(50),
  batch_number VARCHAR(100),
  expiry_date DATE,
  serial_number VARCHAR(100),
  glosa TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Log de auditoria
CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  type VARCHAR(20),
  sku VARCHAR(100),
  qty NUMERIC(12,2),
  glosa TEXT,
  username VARCHAR(50) DEFAULT 'SYSTEM',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Usuarios
CREATE TABLE IF NOT EXISTS users (
  username VARCHAR(50) PRIMARY KEY,
  full_name VARCHAR(150),
  password VARCHAR(100),
  role VARCHAR(50) DEFAULT 'OPERARIO',
  status VARCHAR(20) DEFAULT 'ACTIVE',
  allowed_clients TEXT DEFAULT 'ALL',
  allowed_modules TEXT DEFAULT 'ALL'
);
-- SEC-10: la cuenta 'admin' genérica de ejemplo se conserva solo para instalaciones
-- nuevas (password en texto plano de bajo riesgo, pensada para cambiarse al primer login).
INSERT INTO users (username, full_name, password, role, status, allowed_clients, allowed_modules)
VALUES ('admin', 'Administrador del Sistema', 'admin123', 'ADMIN', 'ACTIVE', 'ALL', 'ALL')
ON CONFLICT DO NOTHING;
-- SEC-10: la cuenta SUPERADMIN fija YA NO se siembra aquí en texto plano.
-- La crea/recrea ensureSuperadmin() en backend/server.js leyendo SUPERADMIN_USER/HASH
-- desde el .env de la raíz (no versionado). Ver docker-compose.yml.

-- Kits (productos compuestos)
CREATE TABLE IF NOT EXISTS kits (
  kit_sku VARCHAR(100),
  client_id VARCHAR(50),
  description VARCHAR(255),
  PRIMARY KEY (kit_sku, client_id)
);

CREATE TABLE IF NOT EXISTS kit_components (
  id SERIAL PRIMARY KEY,
  kit_sku VARCHAR(100),
  kit_client_id VARCHAR(50),
  component_sku VARCHAR(100),
  qty NUMERIC(12,2) DEFAULT 1,
  UNIQUE(kit_sku, kit_client_id, component_sku)
);

CREATE TABLE IF NOT EXISTS kit_orders (
  id VARCHAR(100) PRIMARY KEY,
  kit_sku VARCHAR(100),
  client_id VARCHAR(50),
  qty_to_build INTEGER,
  status VARCHAR(20) DEFAULT 'COMPLETED',
  location_output VARCHAR(50) DEFAULT 'PISO-RECEPCION',
  created_by VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  type VARCHAR(50),
  title VARCHAR(200),
  message TEXT,
  client_id VARCHAR(50),
  sku VARCHAR(100),
  severity VARCHAR(20) DEFAULT 'INFO',
  read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS carriers (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(150),
  rut VARCHAR(20),
  contact VARCHAR(150),
  phone VARCHAR(50),
  email VARCHAR(150),
  active BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS shipments (
  id VARCHAR(100) PRIMARY KEY,
  dispatch_doc_id VARCHAR(100),
  carrier_id VARCHAR(50),
  driver_name VARCHAR(150),
  driver_rut VARCHAR(20),
  plate VARCHAR(20),
  status VARCHAR(30) DEFAULT 'PENDING',
  scheduled_date DATE,
  pickup_date TIMESTAMP,
  delivery_date TIMESTAMP,
  destination_address TEXT,
  notes TEXT,
  created_by VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS api_keys (
  id SERIAL PRIMARY KEY,
  key_hash VARCHAR(255) UNIQUE,
  key_prefix VARCHAR(12),
  name VARCHAR(100),
  client_id VARCHAR(50),
  permissions TEXT DEFAULT 'read',
  active BOOLEAN DEFAULT TRUE,
  last_used TIMESTAMP,
  created_by VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS login_history (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50),
  ip VARCHAR(60),
  success BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS processed_docs (
  id VARCHAR(100) PRIMARY KEY,
  module VARCHAR(20),
  doc_type VARCHAR(50),
  doc_num VARCHAR(100),
  client_id VARCHAR(50),
  status VARCHAR(20) DEFAULT 'COMPLETED',
  username VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  items_json TEXT,
  total_qty NUMERIC(12,2)
);

CREATE TABLE IF NOT EXISTS document_history (
  id VARCHAR(100) PRIMARY KEY,
  module VARCHAR(20),
  doc_num VARCHAR(100),
  doc_type VARCHAR(50),
  glosa TEXT,
  username VARCHAR(50),
  items_json TEXT,
  total_qty NUMERIC(12,2),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id VARCHAR(100) PRIMARY KEY,
  doc_num VARCHAR(100),
  supplier VARCHAR(150),
  client_id VARCHAR(50),
  status VARCHAR(20) DEFAULT 'PENDING',
  created_by VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expected_date DATE,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS purchase_order_lines (
  id SERIAL PRIMARY KEY,
  po_id VARCHAR(100),
  sku VARCHAR(100),
  expected_qty NUMERIC(12,2),
  received_qty NUMERIC(12,2) DEFAULT 0,
  difference NUMERIC(12,2) DEFAULT 0,
  status VARCHAR(20) DEFAULT 'PENDING',
  notes TEXT
);

CREATE TABLE IF NOT EXISTS returns (
  id VARCHAR(100) PRIMARY KEY,
  doc_num VARCHAR(100),
  doc_type VARCHAR(50),
  client_id VARCHAR(50),
  reason TEXT,
  status VARCHAR(20) DEFAULT 'COMPLETED',
  created_by VARCHAR(50),
  glosa TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS return_lines (
  id SERIAL PRIMARY KEY,
  return_id VARCHAR(100),
  sku VARCHAR(100),
  qty NUMERIC(12,2),
  original_lpn VARCHAR(100),
  new_lpn VARCHAR(100),
  condition VARCHAR(20) DEFAULT 'BUENO',
  location_id VARCHAR(50),
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS returned_lpns (
  id VARCHAR(100) PRIMARY KEY,
  return_id VARCHAR(100),
  sku VARCHAR(100),
  client_id VARCHAR(50),
  qty NUMERIC(12,2),
  condition VARCHAR(20) DEFAULT 'BUENO',
  location_id VARCHAR(50),
  status VARCHAR(20) DEFAULT 'DISPONIBLE',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS relocation_requests (
  id SERIAL PRIMARY KEY,
  lpn_id VARCHAR(100),
  from_location VARCHAR(50),
  to_location VARCHAR(50),
  reason TEXT,
  status VARCHAR(20) DEFAULT 'PENDING',
  requested_by VARCHAR(50),
  approved_by VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS dispatch_schedules (
  id SERIAL PRIMARY KEY,
  client_id VARCHAR(50),
  carrier VARCHAR(100),
  scheduled_date DATE,
  time_window VARCHAR(50),
  status VARCHAR(20) DEFAULT 'PENDING',
  notes TEXT,
  created_by VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pick_tasks (
  id VARCHAR(100) PRIMARY KEY,
  doc_num VARCHAR(100),
  doc_type VARCHAR(50),
  client_id VARCHAR(50),
  status VARCHAR(20) DEFAULT 'PENDING',
  priority INTEGER DEFAULT 5,
  created_by VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS pick_task_lines (
  id SERIAL PRIMARY KEY,
  task_id VARCHAR(100),
  sku VARCHAR(100),
  location_id VARCHAR(50),
  lpn_id VARCHAR(100),
  requested_qty NUMERIC(12,2),
  picked_qty NUMERIC(12,2) DEFAULT 0,
  status VARCHAR(20) DEFAULT 'PENDING',
  assigned_to VARCHAR(50),
  batch_number VARCHAR(100),
  serial_number VARCHAR(100),
  started_at TIMESTAMP,
  completed_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS client_tariffs (
  id SERIAL PRIMARY KEY,
  client_id VARCHAR(50),
  tariff_type VARCHAR(50),
  unit_price NUMERIC(12,4) DEFAULT 0,
  currency VARCHAR(10) DEFAULT 'CLP',
  description TEXT,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS storage_events (
  id SERIAL PRIMARY KEY,
  client_id VARCHAR(50),
  event_type VARCHAR(50),
  sku VARCHAR(100),
  lpn_id VARCHAR(100),
  qty NUMERIC(12,2),
  weight_kg NUMERIC(12,4) DEFAULT 0,
  location_id VARCHAR(50),
  event_date DATE DEFAULT CURRENT_DATE,
  billed BOOLEAN DEFAULT FALSE,
  bill_period VARCHAR(20),
  unit_price NUMERIC(12,4) DEFAULT 0,
  total_amount NUMERIC(12,2) DEFAULT 0
);

CREATE TABLE IF NOT EXISTS system_config (
  key VARCHAR(100) PRIMARY KEY,
  value TEXT,
  updated_by VARCHAR(50),
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cycle_counts (
  id VARCHAR(100) PRIMARY KEY,
  zone_code VARCHAR(50),
  status VARCHAR(20) DEFAULT 'PENDING',
  created_by VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS cycle_count_lines (
  id SERIAL PRIMARY KEY,
  count_id VARCHAR(100),
  sku VARCHAR(100),
  location_id VARCHAR(50),
  expected_qty NUMERIC(12,2),
  counted_qty NUMERIC(12,2),
  difference NUMERIC(12,2),
  status VARCHAR(20) DEFAULT 'PENDING',
  counted_by VARCHAR(50),
  counted_at TIMESTAMP
);
