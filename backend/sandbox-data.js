// ── SANDBOX DEMO DATA ─────────────────────────────────────────────────────────
// Datos simulados para el modo sandbox. Cada usuario demo recibe estos datos
// en vez de consultar la base de datos real.

const DEMO_CLIENTS = [
  { id: 'ACME', name: 'ACME Corp', contact: 'Juan Pérez', email: 'juan@acme.cl' },
  { id: 'RETAIL-X', name: 'Retail Express', contact: 'María López', email: 'maria@retailx.cl' },
  { id: 'FARMA-SUR', name: 'Farma del Sur', contact: 'Carlos Vega', email: 'carlos@farmasur.cl' },
];

const DEMO_SKUS = [
  { sku: 'LAPTOP-15PRO', client_id: 'ACME', desc: 'Laptop 15" Pro i7 16GB', category: 'Electrónica', uom: 'UN', weight: 2.1, abc_class: 'A', traceability: 'SERIAL', barcode: '7801234000101', requires_lot: false, requires_serial: true, stock_min: 5, stock_max: 50 },
  { sku: 'MOUSE-WRLS', client_id: 'ACME', desc: 'Mouse Inalámbrico Ergonómico', category: 'Electrónica', uom: 'UN', weight: 0.12, abc_class: 'B', traceability: 'NONE', barcode: '7801234000201', requires_lot: false, requires_serial: false, stock_min: 20, stock_max: 200 },
  { sku: 'MONITOR-27', client_id: 'ACME', desc: 'Monitor 27" 4K IPS', category: 'Electrónica', uom: 'UN', weight: 5.5, abc_class: 'A', traceability: 'SERIAL', barcode: '7801234000301', requires_lot: false, requires_serial: true, stock_min: 3, stock_max: 30 },
  { sku: 'TECLADO-MEC', client_id: 'ACME', desc: 'Teclado Mecánico RGB', category: 'Electrónica', uom: 'UN', weight: 0.8, abc_class: 'C', traceability: 'NONE', barcode: '7801234000401', requires_lot: false, requires_serial: false, stock_min: 10, stock_max: 100 },
  { sku: 'CABLE-USBC', client_id: 'ACME', desc: 'Cable USB-C 2m', category: 'Accesorios', uom: 'UN', weight: 0.05, abc_class: 'C', traceability: 'NONE', barcode: '7801234000501', requires_lot: false, requires_serial: false, stock_min: 50, stock_max: 500 },
  { sku: 'CAMISA-M', client_id: 'RETAIL-X', desc: 'Camisa Algodón Talla M', category: 'Ropa', uom: 'UN', weight: 0.3, abc_class: 'A', traceability: 'LOT', barcode: '7802345000101', requires_lot: true, requires_serial: false, stock_min: 30, stock_max: 300 },
  { sku: 'JEANS-32', client_id: 'RETAIL-X', desc: 'Jeans Slim Fit 32', category: 'Ropa', uom: 'UN', weight: 0.6, abc_class: 'A', traceability: 'LOT', barcode: '7802345000201', requires_lot: true, requires_serial: false, stock_min: 20, stock_max: 200 },
  { sku: 'ZAPATILLA-42', client_id: 'RETAIL-X', desc: 'Zapatilla Running 42', category: 'Calzado', uom: 'PAR', weight: 0.9, abc_class: 'B', traceability: 'LOT', barcode: '7802345000301', requires_lot: true, requires_serial: false, stock_min: 15, stock_max: 150 },
  { sku: 'POLERA-L', client_id: 'RETAIL-X', desc: 'Polera Deportiva Talla L', category: 'Ropa', uom: 'UN', weight: 0.25, abc_class: 'B', traceability: 'NONE', barcode: '7802345000401', requires_lot: false, requires_serial: false, stock_min: 40, stock_max: 400 },
  { sku: 'IBUPROFENO-400', client_id: 'FARMA-SUR', desc: 'Ibuprofeno 400mg x 20', category: 'Medicamentos', uom: 'CAJA', weight: 0.08, abc_class: 'A', traceability: 'LOT', barcode: '7803456000101', requires_lot: true, requires_serial: false, stock_min: 100, stock_max: 1000 },
  { sku: 'PARACETAMOL-500', client_id: 'FARMA-SUR', desc: 'Paracetamol 500mg x 30', category: 'Medicamentos', uom: 'CAJA', weight: 0.1, abc_class: 'A', traceability: 'LOT', barcode: '7803456000201', requires_lot: true, requires_serial: false, stock_min: 80, stock_max: 800 },
  { sku: 'VITAMINA-C', client_id: 'FARMA-SUR', desc: 'Vitamina C 1000mg x 60', category: 'Suplementos', uom: 'FRASCO', weight: 0.15, abc_class: 'B', traceability: 'LOT', barcode: '7803456000301', requires_lot: true, requires_serial: false, stock_min: 50, stock_max: 500 },
  { sku: 'ALCOHOL-GEL', client_id: 'FARMA-SUR', desc: 'Alcohol Gel 500ml', category: 'Higiene', uom: 'UN', weight: 0.55, abc_class: 'C', traceability: 'LOT', barcode: '7803456000401', requires_lot: true, requires_serial: false, stock_min: 60, stock_max: 600 },
];

// Formato del location_id: {warehouse}-{zone}-{aisle}-{col}-{level}
// Esto encaja con el patrón que espera DigitalTwinView (Mapa 3D).
const DEMO_LOCATIONS = [
  // Zona RES (reserva) — 3 pasillos x 4 columnas x 2 niveles = 24 ubicaciones
  ...Array.from({ length: 3 }, (_, a) => Array.from({ length: 4 }, (_, c) => Array.from({ length: 2 }, (_, l) => ({
    location_id: `B1-RES-A${String(a+1).padStart(2,'0')}-${String(c+1).padStart(2,'0')}-${String(l+1).padStart(2,'0')}`,
    zone_code: 'RES', aisle: `A${String(a+1).padStart(2,'0')}`, level: String(l+1).padStart(2,'0'),
    max_weight: 800, max_pallets: 4, loc_type: 'RACK',
  })))).flat(2),
  // Zona PCK (picking) — 2 pasillos x 5 columnas x 2 niveles = 20 ubicaciones
  ...Array.from({ length: 2 }, (_, a) => Array.from({ length: 5 }, (_, c) => Array.from({ length: 2 }, (_, l) => ({
    location_id: `B1-PCK-A${String(a+1).padStart(2,'0')}-${String(c+1).padStart(2,'0')}-${String(l+1).padStart(2,'0')}`,
    zone_code: 'PCK', aisle: `A${String(a+1).padStart(2,'0')}`, level: String(l+1).padStart(2,'0'),
    max_weight: 500, max_pallets: 2, loc_type: 'RACK',
  })))).flat(2),
  // Zona STG (playa de tránsito) — 1 pasillo x 4 columnas x 1 nivel
  ...Array.from({ length: 4 }, (_, c) => ({
    location_id: `B1-STG-A01-${String(c+1).padStart(2,'0')}-01`,
    zone_code: 'STG', aisle: 'A01', level: '01', max_weight: 2000, max_pallets: 8, loc_type: 'BULK',
  })),
  // Muelles
  { location_id: 'DOCK-IN',  zone_code: 'DOCK', aisle: '00', level: '00', max_weight: 5000, max_pallets: 20, loc_type: 'DOCK' },
  { location_id: 'DOCK-OUT', zone_code: 'DOCK', aisle: '00', level: '00', max_weight: 5000, max_pallets: 20, loc_type: 'DOCK' },
  { location_id: 'PISO-RECEPCION', zone_code: 'DOCK', aisle: '00', level: '00', max_weight: 5000, max_pallets: 20, loc_type: 'DOCK' },
];

const now = new Date();
const daysAgo = (n) => new Date(now - n * 86400000).toISOString();
const hoursAgo = (n) => new Date(now - n * 3600000).toISOString();

const DEMO_INVENTORY = [
  // LAPTOP-15PRO es serializado (1 serie = 1 unidad): 12 unidades = 12 LPNs de qty 1,
  // cada uno con su serie única. El primero mantiene el id LPN-DEMO-A001 (referenciado
  // en auditoría y pick-tasks demo).
  ...Array.from({ length: 12 }, (_, i) => ({
    id: i === 0 ? 'LPN-DEMO-A001' : `LPN-DEMO-A001-${String(i + 1).padStart(2, '0')}`,
    sku: 'LAPTOP-15PRO', client_id: 'ACME', qty: 1, location_id: 'B1-RES-A01-01-01',
    status: 'DISPONIBLE', batch_number: null, serial_number: `SN-LP-${String(i + 1).padStart(4, '0')}`,
    expiry_date: null, created_at: daysAgo(15),
  })),
  { id: 'LPN-DEMO-A002', sku: 'MOUSE-WRLS', client_id: 'ACME', qty: 85, location_id: 'B1-RES-A01-01-02', status: 'DISPONIBLE', batch_number: null, serial_number: null, expiry_date: null, created_at: daysAgo(12) },
  // MONITOR-27 es serializado: 8 unidades = 8 LPNs de qty 1. El primero conserva LPN-DEMO-A003.
  ...Array.from({ length: 8 }, (_, i) => ({
    id: i === 0 ? 'LPN-DEMO-A003' : `LPN-DEMO-A003-${String(i + 1).padStart(2, '0')}`,
    sku: 'MONITOR-27', client_id: 'ACME', qty: 1, location_id: 'B1-RES-A01-02-01',
    status: 'DISPONIBLE', batch_number: null, serial_number: `SN-MON-${String(i + 1).padStart(4, '0')}`,
    expiry_date: null, created_at: daysAgo(10),
  })),
  { id: 'LPN-DEMO-A004', sku: 'TECLADO-MEC', client_id: 'ACME', qty: 42, location_id: 'B1-RES-A01-02-02', status: 'DISPONIBLE', batch_number: null, serial_number: null, expiry_date: null, created_at: daysAgo(8) },
  { id: 'LPN-DEMO-A005', sku: 'CABLE-USBC', client_id: 'ACME', qty: 230, location_id: 'B1-RES-A01-03-01', status: 'DISPONIBLE', batch_number: null, serial_number: null, expiry_date: null, created_at: daysAgo(5) },
  { id: 'LPN-DEMO-R001', sku: 'CAMISA-M', client_id: 'RETAIL-X', qty: 120, location_id: 'B1-RES-A02-01-01', status: 'DISPONIBLE', batch_number: 'LOT-2025-A', serial_number: null, expiry_date: null, created_at: daysAgo(20) },
  { id: 'LPN-DEMO-R002', sku: 'JEANS-32', client_id: 'RETAIL-X', qty: 65, location_id: 'B1-RES-A02-01-02', status: 'DISPONIBLE', batch_number: 'LOT-2025-B', serial_number: null, expiry_date: null, created_at: daysAgo(18) },
  { id: 'LPN-DEMO-R003', sku: 'ZAPATILLA-42', client_id: 'RETAIL-X', qty: 38, location_id: 'B1-RES-A02-02-01', status: 'RETENIDO', batch_number: 'LOT-2025-C', serial_number: null, expiry_date: null, created_at: daysAgo(14) },
  { id: 'LPN-DEMO-R004', sku: 'POLERA-L', client_id: 'RETAIL-X', qty: 200, location_id: 'B1-PCK-A01-01-01', status: 'DISPONIBLE', batch_number: null, serial_number: null, expiry_date: null, created_at: daysAgo(7) },
  { id: 'LPN-DEMO-F001', sku: 'IBUPROFENO-400', client_id: 'FARMA-SUR', qty: 450, location_id: 'B1-PCK-A01-02-01', status: 'DISPONIBLE', batch_number: 'LOTE-F-2025-01', serial_number: null, expiry_date: '2026-12-31', created_at: daysAgo(25) },
  { id: 'LPN-DEMO-F002', sku: 'PARACETAMOL-500', client_id: 'FARMA-SUR', qty: 320, location_id: 'B1-PCK-A01-03-01', status: 'DISPONIBLE', batch_number: 'LOTE-F-2025-02', serial_number: null, expiry_date: '2026-08-15', created_at: daysAgo(22) },
  { id: 'LPN-DEMO-F003', sku: 'VITAMINA-C', client_id: 'FARMA-SUR', qty: 180, location_id: 'B1-PCK-A02-01-01', status: 'DISPONIBLE', batch_number: 'LOTE-F-2025-03', serial_number: null, expiry_date: '2027-03-01', created_at: daysAgo(16) },
  { id: 'LPN-DEMO-F004', sku: 'ALCOHOL-GEL', client_id: 'FARMA-SUR', qty: 95, location_id: 'B1-PCK-A02-02-01', status: 'CUARENTENA', batch_number: 'LOTE-F-2025-04', serial_number: null, expiry_date: '2026-06-30', created_at: daysAgo(3) },
  { id: 'LPN-DEMO-F005', sku: 'IBUPROFENO-400', client_id: 'FARMA-SUR', qty: 60, location_id: 'B1-STG-A01-01-01', status: 'DISPONIBLE', batch_number: 'LOTE-F-2025-05', serial_number: null, expiry_date: '2025-09-01', created_at: daysAgo(45) },
];

const DEMO_STATUSES = [
  { id: 'DISPONIBLE', label: 'Disponible', color: 'emerald', blocks_dispatch: false },
  { id: 'RETENIDO', label: 'Retenido', color: 'red', blocks_dispatch: true },
  { id: 'CUARENTENA', label: 'Cuarentena', color: 'amber', blocks_dispatch: true },
  { id: 'DAÑADO', label: 'Dañado', color: 'red', blocks_dispatch: true },
  { id: 'EN_TRANSITO', label: 'En Tránsito', color: 'blue', blocks_dispatch: true },
];

const DEMO_DOC_TYPES = [
  { id: 'GUIA_DESPACHO', label: 'Guía de Despacho', flow: 'BOTH' },
  { id: 'FACTURA', label: 'Factura Electrónica', flow: 'BOTH' },
  { id: 'NOTA_CREDITO', label: 'Nota de Crédito', flow: 'INBOUND' },
  { id: 'OC', label: 'Orden de Compra', flow: 'INBOUND' },
  { id: 'TRANSFERENCIA', label: 'Transferencia Interna', flow: 'BOTH' },
];

const DEMO_AUDIT = [
  { id: 1, type: 'INBOUND', sku: 'LAPTOP-15PRO', client_id: 'ACME', qty: 12, lpn_id: 'LPN-DEMO-A001', location_id: 'A-01-01', username: 'jefe_bodega', glosa: 'Recepción GD-4521 proveedor TechDistrib', created_at: daysAgo(15) },
  { id: 2, type: 'INBOUND', sku: 'MOUSE-WRLS', client_id: 'ACME', qty: 85, lpn_id: 'LPN-DEMO-A002', location_id: 'A-01-02', username: 'jefe_bodega', glosa: 'Recepción GD-4521 proveedor TechDistrib', created_at: daysAgo(12) },
  { id: 3, type: 'INBOUND', sku: 'CAMISA-M', client_id: 'RETAIL-X', qty: 120, lpn_id: 'LPN-DEMO-R001', location_id: 'B-01-01', username: 'operador1', glosa: 'Recepción FC-8890 Retail Express', created_at: daysAgo(20) },
  { id: 4, type: 'OUTBOUND', sku: 'MOUSE-WRLS', client_id: 'ACME', qty: 15, lpn_id: 'LPN-DEMO-A002', location_id: 'A-01-02', username: 'picker_demo', glosa: 'Despacho GD-5010 a cliente final', created_at: daysAgo(6) },
  { id: 5, type: 'RELOC', sku: 'IBUPROFENO-400', client_id: 'FARMA-SUR', qty: 450, lpn_id: 'LPN-DEMO-F001', location_id: 'C-01-02', username: 'jefe_bodega', glosa: 'Reubicación desde DOCK-IN a C-01-02', created_at: daysAgo(24) },
  { id: 6, type: 'INBOUND', sku: 'ALCOHOL-GEL', client_id: 'FARMA-SUR', qty: 95, lpn_id: 'LPN-DEMO-F004', location_id: 'B-01-01', username: 'operador1', glosa: 'Recepción OC-3301 FarmaSur — pendiente QC', created_at: daysAgo(3) },
  { id: 7, type: 'STATUS', sku: 'ALCOHOL-GEL', client_id: 'FARMA-SUR', qty: 95, lpn_id: 'LPN-DEMO-F004', location_id: 'B-01-01', username: 'auditor1', glosa: 'Cambio estado DISPONIBLE → CUARENTENA por inspección QC', created_at: daysAgo(2) },
  { id: 8, type: 'ADJUST', sku: 'ZAPATILLA-42', client_id: 'RETAIL-X', qty: -2, lpn_id: 'LPN-DEMO-R003', location_id: 'B-02-01', username: 'jefe_bodega', glosa: 'Ajuste por daño en manipulación — 2 pares dañados', created_at: daysAgo(10) },
  { id: 9, type: 'OUTBOUND', sku: 'JEANS-32', client_id: 'RETAIL-X', qty: 25, lpn_id: 'LPN-DEMO-R002', location_id: 'B-01-02', username: 'picker_demo', glosa: 'Despacho GD-5044 tienda centro', created_at: daysAgo(4) },
  { id: 10, type: 'INBOUND', sku: 'POLERA-L', client_id: 'RETAIL-X', qty: 200, lpn_id: 'LPN-DEMO-R004', location_id: 'C-01-01', username: 'operador1', glosa: 'Recepción GD-5100 temporada verano', created_at: daysAgo(7) },
  { id: 11, type: 'OUTBOUND', sku: 'LAPTOP-15PRO', client_id: 'ACME', qty: 3, lpn_id: 'LPN-DEMO-A001', location_id: 'A-01-01', username: 'picker_demo', glosa: 'Despacho FC-5200 orden corporativa', created_at: hoursAgo(8) },
  { id: 12, type: 'INBOUND', sku: 'MONITOR-27', client_id: 'ACME', qty: 8, lpn_id: 'LPN-DEMO-A003', location_id: 'A-01-03', username: 'jefe_bodega', glosa: 'Recepción FC-5180 restock monitores', created_at: daysAgo(10) },
];

const DEMO_STATS = {
  total_units: 1905,
  total_lpns: 32,
  total_skus: 13,
  total_locations: 12,
  occupied_locations: 10,
};

const DEMO_DISPATCH_KPIS = {
  total_dispatched_7d: 43,
  total_dispatched_30d: 187,
  avg_dispatch_time_min: 28,
  on_time_rate: 94.2,
  returns_rate: 2.1,
};

const DEMO_WEEKLY_DISPATCH = [
  { day: 'Lun', inbound: 35, outbound: 22 },
  { day: 'Mar', inbound: 28, outbound: 31 },
  { day: 'Mié', inbound: 42, outbound: 18 },
  { day: 'Jue', inbound: 15, outbound: 27 },
  { day: 'Vie', inbound: 50, outbound: 40 },
  { day: 'Sáb', inbound: 8, outbound: 12 },
  { day: 'Dom', inbound: 0, outbound: 0 },
];

const DEMO_NOTIFICATIONS = [
  { id: 1, type: 'STOCK_MIN', severity: 'WARNING', message: 'LAPTOP-15PRO (ACME) bajo stock mínimo: 12 unidades (mín: 5)', read: false, created_at: hoursAgo(2) },
  { id: 2, type: 'EXPIRY', severity: 'CRITICAL', message: 'IBUPROFENO-400 lote LOTE-F-2025-05 vence el 2025-09-01 — 60 unidades', read: false, created_at: hoursAgo(5) },
  { id: 3, type: 'QC_HOLD', severity: 'WARNING', message: 'ALCOHOL-GEL lote LOTE-F-2025-04 en CUARENTENA — pendiente inspección QC', read: false, created_at: daysAgo(2) },
  { id: 4, type: 'DISPATCH', severity: 'INFO', message: 'Despacho FC-5200 completado — 3 laptops a orden corporativa', read: true, created_at: hoursAgo(8) },
  { id: 5, type: 'PICK_ASSIGN', severity: 'INFO', message: 'Nueva tarea de picking asignada: GD-5301 — 2 líneas pendientes', read: false, created_at: hoursAgo(1) },
  { id: 6, type: 'DOCK', severity: 'INFO', message: 'Cita de muelle confirmada: Muelle 1 mañana 08:00-10:00 — ASN-2025-002 FarmaLab', read: false, created_at: hoursAgo(3) },
  { id: 7, type: 'KIT', severity: 'INFO', message: 'Orden de kit PACK-SALUD #2 en curso — 10 unidades por armar', read: true, created_at: hoursAgo(6) },
  { id: 8, type: 'WAVE', severity: 'WARNING', message: 'Ola OLA-002 ACME Urgente tiene 3 líneas sin asignar — prioridad alta', read: false, created_at: hoursAgo(4) },
  { id: 9, type: 'ADJUST', severity: 'WARNING', message: 'Solicitud de ajuste pendiente: MOUSE-WRLS +2 unidades detectadas en conteo cíclico', read: false, created_at: daysAgo(1) },
  { id: 10, type: 'RETURN', severity: 'INFO', message: 'Devolución DEV-001 procesada: 5 camisas reingresadas en buen estado', read: true, created_at: daysAgo(9) },
];

const DEMO_STOCK_ALERTS = [
  { sku: 'IBUPROFENO-400', client_id: 'FARMA-SUR', current_qty: 510, stock_min: 100, stock_max: 1000, alert_type: 'EXPIRY_SOON', detail: 'Lote LOTE-F-2025-05 vence 2025-09-01' },
  { sku: 'LAPTOP-15PRO', client_id: 'ACME', current_qty: 12, stock_min: 5, stock_max: 50, alert_type: 'LOW_STOCK', detail: 'Stock actual 12 — mínimo configurado 5' },
  { sku: 'ALCOHOL-GEL', client_id: 'FARMA-SUR', current_qty: 95, stock_min: 60, stock_max: 600, alert_type: 'QC_HOLD', detail: 'Lote LOTE-F-2025-04 en cuarentena — 95 unidades bloqueadas' },
  { sku: 'CABLE-USBC', client_id: 'ACME', current_qty: 230, stock_min: 50, stock_max: 500, alert_type: 'OK', detail: 'Stock normal' },
];

const DEMO_DOC_HISTORY = [
  { id: 1, module: 'receive', doc_num: 'GD-4521', doc_type: 'GUIA_DESPACHO', client_id: 'ACME', username: 'jefe_bodega', total_qty: 97, lines_count: 2, glosa: 'Recepción proveedor TechDistrib', status: 'CERRADO', created_at: daysAgo(15) },
  { id: 2, module: 'receive', doc_num: 'FC-8890', doc_type: 'FACTURA', client_id: 'RETAIL-X', username: 'operador1', total_qty: 120, lines_count: 1, glosa: 'Recepción Retail Express', status: 'CERRADO', created_at: daysAgo(20) },
  { id: 3, module: 'dispatch', doc_num: 'GD-5010', doc_type: 'GUIA_DESPACHO', client_id: 'ACME', username: 'picker_demo', total_qty: 15, lines_count: 1, glosa: 'Despacho a cliente final', status: 'CERRADO', created_at: daysAgo(6) },
  { id: 4, module: 'dispatch', doc_num: 'GD-5044', doc_type: 'GUIA_DESPACHO', client_id: 'RETAIL-X', username: 'picker_demo', total_qty: 25, lines_count: 1, glosa: 'Despacho tienda centro', status: 'CERRADO', created_at: daysAgo(4) },
  { id: 5, module: 'receive', doc_num: 'GD-5100', doc_type: 'GUIA_DESPACHO', client_id: 'RETAIL-X', username: 'operador1', total_qty: 200, lines_count: 1, glosa: 'Recepción temporada verano', status: 'CERRADO', created_at: daysAgo(7) },
  { id: 6, module: 'receive', doc_num: 'OC-3301', doc_type: 'OC', client_id: 'FARMA-SUR', username: 'operador1', total_qty: 95, lines_count: 1, glosa: 'Recepción FarmaSur — pendiente QC', status: 'CERRADO', created_at: daysAgo(3) },
  { id: 7, module: 'dispatch', doc_num: 'FC-5200', doc_type: 'FACTURA', client_id: 'ACME', username: 'picker_demo', total_qty: 3, lines_count: 1, glosa: 'Orden corporativa', status: 'EN_CURSO', created_at: hoursAgo(8) },
  { id: 8, module: 'receive', doc_num: 'FC-5180', doc_type: 'FACTURA', client_id: 'ACME', username: 'jefe_bodega', total_qty: 8, lines_count: 1, glosa: 'Restock monitores', status: 'CERRADO', created_at: daysAgo(10) },
  { id: 9, module: 'adjust', doc_num: 'AJ-001', doc_type: 'TRANSFERENCIA', client_id: 'RETAIL-X', username: 'jefe_bodega', total_qty: 2, lines_count: 1, glosa: 'Ajuste por daño zapatillas', status: 'CERRADO', created_at: daysAgo(10) },
  { id: 10, module: 'dispatch', doc_num: 'GD-5300', doc_type: 'GUIA_DESPACHO', client_id: 'RETAIL-X', username: 'jefe_bodega', total_qty: 45, lines_count: 2, glosa: 'Pedido temporada', status: 'EN_CURSO', created_at: hoursAgo(3) },
];

const DEMO_CYCLE_COUNTS = [
  { id: 1, name: 'Conteo Zona A — Electrónica', zone: 'A', status: 'COMPLETADO', total_locations: 5, counted_locations: 5, discrepancies: 1, created_by: 'auditor1', created_at: daysAgo(8), completed_at: daysAgo(7) },
  { id: 2, name: 'Conteo Zona B — Ropa y Calzado', zone: 'B', status: 'EN_CURSO', total_locations: 3, counted_locations: 1, discrepancies: 0, created_by: 'auditor1', created_at: daysAgo(1), completed_at: null },
  { id: 3, name: 'Conteo Zona C — Bulk', zone: 'C', status: 'PENDIENTE', total_locations: 2, counted_locations: 0, discrepancies: 0, created_by: 'jefe_bodega', created_at: hoursAgo(2), completed_at: null },
];

const DEMO_PURCHASE_ORDERS = [
  { id: 1, po_num: 'OC-2025-001', supplier_id: 1, supplier_name: 'TechDistrib Chile', client_id: 'ACME', status: 'CERRADA', expected_date: daysAgo(12), items: [{ sku: 'LAPTOP-15PRO', qty_ordered: 12, qty_received: 12 }, { sku: 'MOUSE-WRLS', qty_ordered: 85, qty_received: 85 }], created_by: 'admin', created_at: daysAgo(20) },
  { id: 2, po_num: 'OC-2025-002', supplier_id: 3, supplier_name: 'FarmaLab S.A.', client_id: 'FARMA-SUR', status: 'ABIERTA', expected_date: daysAgo(-3), items: [{ sku: 'IBUPROFENO-400', qty_ordered: 500, qty_received: 0 }, { sku: 'VITAMINA-C', qty_ordered: 200, qty_received: 0 }], created_by: 'jefe_bodega', created_at: daysAgo(10) },
  { id: 3, po_num: 'OC-2025-003', supplier_id: 2, supplier_name: 'Textil del Pacífico', client_id: 'RETAIL-X', status: 'PARCIAL', expected_date: daysAgo(1), items: [{ sku: 'CAMISA-M', qty_ordered: 200, qty_received: 120 }, { sku: 'JEANS-32', qty_ordered: 100, qty_received: 0 }], created_by: 'operador1', created_at: daysAgo(14) },
];

const DEMO_CARRIERS = [
  { id: 1, name: 'Chilexpress', contact: 'soporte@chilexpress.cl', phone: '+56 2 2345 6789', active: true },
  { id: 2, name: 'Starken', contact: 'operaciones@starken.cl', phone: '+56 2 3456 7890', active: true },
  { id: 3, name: 'Blue Express', contact: 'comercial@bluex.cl', phone: '+56 2 4567 8901', active: true },
];

const DEMO_SHIPMENTS = [
  { id: 1, carrier_id: 1, carrier_name: 'Chilexpress', doc_num: 'GD-5010', status: 'ENTREGADO', tracking: 'CX-990012345', destination: 'Santiago Centro', created_at: daysAgo(6), delivered_at: daysAgo(4) },
  { id: 2, carrier_id: 2, carrier_name: 'Starken', doc_num: 'GD-5044', status: 'EN_TRANSITO', tracking: 'SK-887654321', destination: 'Viña del Mar', created_at: daysAgo(4), delivered_at: null },
  { id: 3, carrier_id: 3, carrier_name: 'Blue Express', doc_num: 'FC-5200', status: 'PENDIENTE', tracking: null, destination: 'Concepción', created_at: hoursAgo(8), delivered_at: null },
];

const DEMO_PICK_TASKS = [
  { id: 1, doc_num: 'GD-5300', priority: 1, status: 'PENDIENTE', assigned_to: null, sku: 'CAMISA-M', client_id: 'RETAIL-X', qty_requested: 30, qty_picked: 0, lpn_id: 'LPN-DEMO-R001', location_id: 'B-01-01', created_at: hoursAgo(3) },
  { id: 2, doc_num: 'GD-5300', priority: 1, status: 'PENDIENTE', assigned_to: null, sku: 'JEANS-32', client_id: 'RETAIL-X', qty_requested: 15, qty_picked: 0, lpn_id: 'LPN-DEMO-R002', location_id: 'B-01-02', created_at: hoursAgo(3) },
  { id: 3, doc_num: 'GD-5301', priority: 3, status: 'EN_CURSO', assigned_to: 'picker_demo', sku: 'MONITOR-27', client_id: 'ACME', qty_requested: 2, qty_picked: 1, lpn_id: 'LPN-DEMO-A003', location_id: 'A-01-03', created_at: hoursAgo(1) },
  { id: 4, doc_num: 'GD-5301', priority: 3, status: 'COMPLETADA', assigned_to: 'picker_demo', sku: 'TECLADO-MEC', client_id: 'ACME', qty_requested: 5, qty_picked: 5, lpn_id: 'LPN-DEMO-A004', location_id: 'A-02-01', created_at: hoursAgo(2), completed_at: hoursAgo(1) },
];

const DEMO_PICK_STATS = {
  total: 4,
  pendiente: 2,
  en_curso: 1,
  completada: 1,
  avg_pick_time_min: 12,
};

const DEMO_DISPATCH_SCHEDULES = [
  { id: 1, client_id: 'RETAIL-X', carrier_name: 'Chilexpress', scheduled_date: daysAgo(-1), time_window: '09:00-12:00', status: 'CONFIRMADO', notes: 'Pedido temporada — 45 bultos', doc_num: 'GD-5300', created_at: daysAgo(2) },
  { id: 2, client_id: 'ACME', carrier_name: 'Blue Express', scheduled_date: daysAgo(-2), time_window: '14:00-17:00', status: 'PENDIENTE', notes: 'Orden corporativa urgente', doc_num: 'GD-5301', created_at: daysAgo(1) },
];

const DEMO_SUPPLIERS = [
  { id: 1, name: 'TechDistrib Chile', contact: 'ventas@techdistrib.cl', phone: '+56 2 1111 2222', active: true },
  { id: 2, name: 'Textil del Pacífico', contact: 'despacho@textilpacifico.cl', phone: '+56 2 3333 4444', active: true },
  { id: 3, name: 'FarmaLab S.A.', contact: 'logistica@farmalab.cl', phone: '+56 2 5555 6666', active: true },
];

const DEMO_RETURNS = [
  { id: 1, doc_num: 'DEV-001', original_doc: 'GD-4980', client_id: 'RETAIL-X', reason: 'Talla incorrecta', status: 'PROCESADA', items: [{ sku: 'CAMISA-M', qty: 5, condition: 'BUEN_ESTADO' }], created_at: daysAgo(9) },
];

const DEMO_DOCKS = [
  { id: 1, name: 'Muelle 1 - Recepción', type: 'INBOUND', status: 'LIBRE' },
  { id: 2, name: 'Muelle 2 - Despacho', type: 'OUTBOUND', status: 'OCUPADO' },
  { id: 3, name: 'Muelle 3 - Mixto', type: 'BOTH', status: 'LIBRE' },
];

const DEMO_USERS = [
  { username: 'admin', full_name: 'Administrador del Sistema', role: 'ADMIN', status: 'ACTIVE', allowed_clients: 'ALL', allowed_modules: 'ALL' },
  { username: 'jefe_bodega', full_name: 'Roberto Muñoz', role: 'EJECUTIVO_CUENTA', status: 'ACTIVE', allowed_clients: 'ALL', allowed_modules: 'ALL' },
  { username: 'auditor1', full_name: 'Carolina Reyes', role: 'AUDITOR', status: 'ACTIVE', allowed_clients: 'ALL', allowed_modules: '["dashboard","inventory","doc-history","audit","lpn-history"]' },
  { username: 'picker_demo', full_name: 'Miguel Torres', role: 'PICKER', status: 'ACTIVE', allowed_clients: 'ALL', allowed_modules: '["picker-queue","inventory","digital-twin","relocate"]' },
  { username: 'operador1', full_name: 'Andrés Silva', role: 'EJECUTIVO_CUENTA', status: 'ACTIVE', allowed_clients: 'ALL', allowed_modules: 'ALL' },
];

const DEMO_KITS = [
  {
    id: 1, sku: 'SET-OFICINA', client_id: 'ACME', desc: 'Set Oficina Ejecutivo', status: 'ACTIVO',
    components: [
      { sku: 'LAPTOP-15PRO', qty_per_kit: 1 },
      { sku: 'MOUSE-WRLS', qty_per_kit: 1 },
      { sku: 'TECLADO-MEC', qty_per_kit: 1 },
      { sku: 'MONITOR-27', qty_per_kit: 1 },
    ],
    created_at: daysAgo(30),
  },
  {
    id: 2, sku: 'PACK-SALUD', client_id: 'FARMA-SUR', desc: 'Pack Salud Familiar', status: 'ACTIVO',
    components: [
      { sku: 'IBUPROFENO-400', qty_per_kit: 2 },
      { sku: 'PARACETAMOL-500', qty_per_kit: 2 },
      { sku: 'VITAMINA-C', qty_per_kit: 1 },
    ],
    created_at: daysAgo(20),
  },
];

const DEMO_KIT_ORDERS = [
  { id: 1, kit_id: 1, kit_sku: 'SET-OFICINA', client_id: 'ACME', qty: 3, status: 'COMPLETADA', created_by: 'jefe_bodega', created_at: daysAgo(5), completed_at: daysAgo(4) },
  { id: 2, kit_id: 2, kit_sku: 'PACK-SALUD', client_id: 'FARMA-SUR', qty: 10, status: 'EN_CURSO', created_by: 'operador1', created_at: hoursAgo(6), completed_at: null },
];

const DEMO_ASNS = [
  { id: 1, supplier_id: 1, supplier_name: 'TechDistrib Chile', client_id: 'ACME', doc_num: 'ASN-2025-001', status: 'RECIBIDO', expected_date: daysAgo(12), items: [{ sku: 'LAPTOP-15PRO', qty_expected: 12, qty_received: 12 }, { sku: 'MOUSE-WRLS', qty_expected: 85, qty_received: 85 }], created_at: daysAgo(15) },
  { id: 2, supplier_id: 3, supplier_name: 'FarmaLab S.A.', client_id: 'FARMA-SUR', doc_num: 'ASN-2025-002', status: 'PENDIENTE', expected_date: daysAgo(-3), items: [{ sku: 'IBUPROFENO-400', qty_expected: 500, qty_received: 0 }, { sku: 'VITAMINA-C', qty_expected: 200, qty_received: 0 }], created_at: daysAgo(5) },
  { id: 3, supplier_id: 2, supplier_name: 'Textil del Pacífico', client_id: 'RETAIL-X', doc_num: 'ASN-2025-003', status: 'PARCIAL', expected_date: daysAgo(1), items: [{ sku: 'CAMISA-M', qty_expected: 200, qty_received: 120 }, { sku: 'JEANS-32', qty_expected: 100, qty_received: 0 }], created_at: daysAgo(7) },
];

const DEMO_WAVES = [
  { id: 1, name: 'OLA-001 Retail Express', status: 'COMPLETADA', client_id: 'RETAIL-X', total_lines: 3, completed_lines: 3, created_by: 'jefe_bodega', created_at: daysAgo(4), completed_at: daysAgo(3) },
  { id: 2, name: 'OLA-002 ACME Urgente', status: 'EN_CURSO', client_id: 'ACME', total_lines: 4, completed_lines: 1, created_by: 'jefe_bodega', created_at: hoursAgo(4), completed_at: null },
  { id: 3, name: 'OLA-003 Multi-cliente', status: 'PENDIENTE', client_id: null, total_lines: 6, completed_lines: 0, created_by: 'operador1', created_at: hoursAgo(1), completed_at: null },
];

const DEMO_PACKING_ORDERS = [
  { id: 1, doc_num: 'GD-5044', client_id: 'RETAIL-X', status: 'EMPACADA', total_items: 25, packed_items: 25, box_count: 3, weight_kg: 15.5, packer: 'operador1', created_at: daysAgo(4), completed_at: daysAgo(3) },
  { id: 2, doc_num: 'GD-5300', client_id: 'RETAIL-X', status: 'EN_CURSO', total_items: 45, packed_items: 12, box_count: 1, weight_kg: 4.2, packer: 'operador1', created_at: hoursAgo(2), completed_at: null },
  { id: 3, doc_num: 'FC-5200', client_id: 'ACME', status: 'PENDIENTE', total_items: 3, packed_items: 0, box_count: 0, weight_kg: 0, packer: null, created_at: hoursAgo(6), completed_at: null },
];

const DEMO_INVOICES = [
  { id: 1, client_id: 'ACME', client_name: 'ACME Corp', period: '2025-04', total_clp: 1250000, status: 'PAGADA', items: [{ desc: 'Almacenaje (120 pallet/día)', qty: 120, unit_price: 500, total: 60000 }, { desc: 'Movimientos IN', qty: 15, unit_price: 1500, total: 22500 }, { desc: 'Movimientos OUT', qty: 12, unit_price: 2000, total: 24000 }], created_at: daysAgo(30), paid_at: daysAgo(20) },
  { id: 2, client_id: 'RETAIL-X', client_name: 'Retail Express', period: '2025-04', total_clp: 2180000, status: 'PENDIENTE', items: [{ desc: 'Almacenaje (350 pallet/día)', qty: 350, unit_price: 500, total: 175000 }, { desc: 'Movimientos IN', qty: 28, unit_price: 1500, total: 42000 }, { desc: 'Movimientos OUT', qty: 35, unit_price: 2000, total: 70000 }], created_at: daysAgo(5), paid_at: null },
  { id: 3, client_id: 'FARMA-SUR', client_name: 'Farma del Sur', period: '2025-05', total_clp: 890000, status: 'BORRADOR', items: [{ desc: 'Almacenaje (180 pallet/día)', qty: 180, unit_price: 500, total: 90000 }, { desc: 'Movimientos IN', qty: 8, unit_price: 1500, total: 12000 }], created_at: hoursAgo(12), paid_at: null },
];

const DEMO_DOCK_APPOINTMENTS = [
  { id: 1, dock_id: 1, dock_name: 'Muelle 1 - Recepción', type: 'INBOUND', carrier_name: 'TechDistrib Chile', doc_num: 'ASN-2025-002', scheduled_date: daysAgo(-3), time_window: '08:00-10:00', status: 'CONFIRMADA', vehicle_plate: 'ABCD-12', driver_name: 'Pedro Soto', notes: 'Carga farmacéutica — cadena de frío', created_at: daysAgo(5) },
  { id: 2, dock_id: 2, dock_name: 'Muelle 2 - Despacho', type: 'OUTBOUND', carrier_name: 'Chilexpress', doc_num: 'GD-5300', scheduled_date: daysAgo(-1), time_window: '10:00-12:00', status: 'EN_PROGRESO', vehicle_plate: 'WXYZ-34', driver_name: 'Luis Bravo', notes: 'Pedido temporada Retail Express', created_at: daysAgo(2) },
  { id: 3, dock_id: 3, dock_name: 'Muelle 3 - Mixto', type: 'INBOUND', carrier_name: 'Textil del Pacífico', doc_num: 'ASN-2025-003', scheduled_date: daysAgo(-2), time_window: '14:00-16:00', status: 'PENDIENTE', vehicle_plate: null, driver_name: null, notes: 'Reposición ropa temporada', created_at: daysAgo(3) },
];

const DEMO_ADJUST_REQUESTS = [
  { id: 1, lpn_id: 'LPN-DEMO-R003', sku: 'ZAPATILLA-42', client_id: 'RETAIL-X', location_id: 'B-02-01', qty_system: 40, qty_physical: 38, diff: -2, reason: 'Daño en manipulación — 2 pares con caja aplastada', status: 'APROBADA', requested_by: 'auditor1', approved_by: 'jefe_bodega', created_at: daysAgo(10), resolved_at: daysAgo(9) },
  { id: 2, lpn_id: 'LPN-DEMO-A002', sku: 'MOUSE-WRLS', client_id: 'ACME', location_id: 'A-01-02', qty_system: 85, qty_physical: 87, diff: 2, reason: 'Sobrante detectado en conteo cíclico — 2 unidades no registradas en recepción', status: 'PENDIENTE', requested_by: 'auditor1', approved_by: null, created_at: daysAgo(1), resolved_at: null },
  { id: 3, lpn_id: 'LPN-DEMO-F005', sku: 'IBUPROFENO-400', client_id: 'FARMA-SUR', location_id: 'B-02-01', qty_system: 60, qty_physical: 60, diff: 0, reason: 'Producto próximo a vencer — solicitud de cambio a estado DAÑADO', status: 'RECHAZADA', requested_by: 'operador1', approved_by: 'jefe_bodega', created_at: daysAgo(3), resolved_at: daysAgo(2) },
];

const DEMO_RELOCATE_REQUESTS = [
  { id: 1, lpn_id: 'LPN-DEMO-F004', sku: 'ALCOHOL-GEL', client_id: 'FARMA-SUR', from_location: 'B-01-01', to_location: 'C-01-02', reason: 'Mover a zona de cuarentena para inspección QC', status: 'COMPLETADA', requested_by: 'auditor1', executed_by: 'operador1', created_at: daysAgo(2), completed_at: daysAgo(1) },
  { id: 2, lpn_id: 'LPN-DEMO-R004', sku: 'POLERA-L', client_id: 'RETAIL-X', from_location: 'C-01-01', to_location: 'B-02-01', reason: 'Consolidar zona B para preparar despacho masivo', status: 'PENDIENTE', requested_by: 'jefe_bodega', executed_by: null, created_at: hoursAgo(4), completed_at: null },
];

const DEMO_KEYS = [
  { id: 1, key_prefix: 'wms_pk_live_', name: 'ERP Integration - ACME', permissions: 'READ_ONLY', client_id: 'ACME', created_by: 'admin', created_at: daysAgo(60), last_used: daysAgo(1), active: true },
  { id: 2, key_prefix: 'wms_pk_test_', name: 'Test Key - Desarrollo', permissions: 'READ_ONLY', client_id: null, created_by: 'admin', created_at: daysAgo(30), last_used: daysAgo(15), active: false },
];

const DEMO_SYSTEM_CONFIG = {
  operation_mode: 'HYBRID',
  company_name: 'WMS Demo Corp',
  system_name: 'WMS Enterprise — Sandbox',
  own_client_id: 'PROPIO',
  own_client_name: 'Bodega Propia',
  '3pl_pallet_day_price': '500',
  '3pl_movement_in_price': '1500',
  '3pl_movement_out_price': '2000',
  '3pl_currency': 'CLP',
  maintenance_mode: 'false',
  disabled_modules: '[]',
  license_modules: '[]',
  license_client: 'Demo Corp',
  license_expiry: '2027-12-31',
  license_max_users: '99',
};

// Filtra datos según el escenario (modo de operación)
function getDataForScenario(scenario) {
  const mode = scenario || 'HYBRID';
  const config = { ...DEMO_SYSTEM_CONFIG, operation_mode: mode };

  if (mode === 'PROPIO') {
    config.own_client_id = 'PROPIO';
    config.own_client_name = 'Mi Bodega';
    // En modo PROPIO, todos los datos usan client_id='PROPIO'
    const skus = DEMO_SKUS.map(s => ({ ...s, client_id: 'PROPIO' }));
    const inv = DEMO_INVENTORY.map(i => ({ ...i, client_id: 'PROPIO' }));
    const audit = DEMO_AUDIT.map(a => ({ ...a, client_id: 'PROPIO' }));
    return { skus, inventory: inv, audit, clients: [], config };
  }

  if (mode === '3PL') {
    return { skus: DEMO_SKUS, inventory: DEMO_INVENTORY, audit: DEMO_AUDIT, clients: DEMO_CLIENTS, config };
  }

  // HYBRID
  const propioSkus = DEMO_SKUS.slice(0, 5).map(s => ({ ...s, client_id: 'PROPIO' }));
  const allSkus = [...propioSkus, ...DEMO_SKUS.slice(5)];
  const propioInv = DEMO_INVENTORY.slice(0, 5).map(i => ({ ...i, client_id: 'PROPIO' }));
  const allInv = [...propioInv, ...DEMO_INVENTORY.slice(5)];
  const propioAudit = DEMO_AUDIT.slice(0, 4).map(a => ({ ...a, client_id: 'PROPIO' }));
  const allAudit = [...propioAudit, ...DEMO_AUDIT.slice(4)];
  return { skus: allSkus, inventory: allInv, audit: allAudit, clients: DEMO_CLIENTS, config };
}

// Mapa de rutas → datos
const { getState, applyInventoryOverlay } = require('./sandbox-state');

function getSandboxResponse(path, scenario, user) {
  const sd = getDataForScenario(scenario);
  const state = user ? getState(user) : null;

  // Aplicar overlay al inventario base
  const liveInventory = state ? applyInventoryOverlay(state, sd.inventory) : sd.inventory;
  const liveAudit = state ? [...state.audit, ...sd.audit] : sd.audit;
  const livePickTasks = state ? [...state.pickTasks, ...DEMO_PICK_TASKS] : DEMO_PICK_TASKS;
  const liveRelocateReqs = state ? [...state.relocateRequests, ...DEMO_RELOCATE_REQUESTS] : DEMO_RELOCATE_REQUESTS;
  const liveDispatchSch = state ? [...state.dispatchSchedules, ...DEMO_DISPATCH_SCHEDULES] : DEMO_DISPATCH_SCHEDULES;
  const liveDockAppts = state ? [...state.dockAppointments, ...DEMO_DOCK_APPOINTMENTS] : DEMO_DOCK_APPOINTMENTS;
  const liveAdjustReqs = state ? [...state.adjustRequests, ...DEMO_ADJUST_REQUESTS] : DEMO_ADJUST_REQUESTS;
  const liveCycleCount = state ? [...state.cycleCount, ...DEMO_CYCLE_COUNTS] : DEMO_CYCLE_COUNTS;

  const routes = {
    '/api/inventory':           liveInventory,
    '/api/skus':                sd.skus,
    '/api/locations':           DEMO_LOCATIONS,
    '/api/stats':               DEMO_STATS,
    '/api/audit':               liveAudit,
    '/api/clients':             sd.clients,
    '/api/statuses':            DEMO_STATUSES,
    '/api/document_types':      DEMO_DOC_TYPES,
    '/api/users':               DEMO_USERS,
    '/api/kits':                DEMO_KITS,
    '/api/system/config':       sd.config,
    '/api/alerts/stock':        DEMO_STOCK_ALERTS,
    '/api/notifications':       DEMO_NOTIFICATIONS,
    '/api/carriers':            DEMO_CARRIERS,
    '/api/shipments':           DEMO_SHIPMENTS,
    '/api/keys':                DEMO_KEYS,
    '/api/kit-orders':          DEMO_KIT_ORDERS,
    '/api/stats/dispatch-kpis': DEMO_DISPATCH_KPIS,
    '/api/stats/weekly-dispatch': DEMO_WEEKLY_DISPATCH,
    '/api/relocate-requests':   liveRelocateReqs,
    '/api/pick-tasks':          livePickTasks,
    '/api/picker/queue':        livePickTasks.filter(t => t.status !== 'COMPLETADA'),
    '/api/pick-tasks/stats':    DEMO_PICK_STATS,
    '/api/dispatch-schedules':  liveDispatchSch,
    '/api/adjust-requests':     liveAdjustReqs,
    '/api/suppliers':           DEMO_SUPPLIERS,
    '/api/asns':                DEMO_ASNS,
    '/api/pick-waves':          DEMO_WAVES,
    '/api/packing-orders':      DEMO_PACKING_ORDERS,
    '/api/returns':             DEMO_RETURNS,
    '/api/docks':               DEMO_DOCKS,
    '/api/dock-appointments':   liveDockAppts,
    '/api/invoices':            DEMO_INVOICES,
    '/api/doc-history':         DEMO_DOC_HISTORY,
    '/api/document-history':    DEMO_DOC_HISTORY,
    '/api/cycle-counts':        liveCycleCount,
    '/api/cycle-count':         liveCycleCount,
    '/api/purchase-orders':     DEMO_PURCHASE_ORDERS,
    '/api/anulation-requests':  [],
    '/api/report/occupation':   DEMO_LOCATIONS.map(l => {
      const items = liveInventory.filter(i => i.location_id === l.location_id);
      const totalQty = items.reduce((s, i) => s + i.qty, 0);
      return { location_id: l.location_id, zone_code: l.zone_code, loc_type: l.loc_type, lpn_count: items.length, total_qty: totalQty, max_pallets: l.max_pallets, occupancy_pct: Math.min(100, Math.round((items.length / l.max_pallets) * 100)) };
    }),
    '/api/billing/summary':     { clients: DEMO_CLIENTS.map(c => ({ client_id: c.id, client_name: c.name, total_clp: DEMO_INVOICES.find(i => i.client_id === c.id)?.total_clp || 0, invoice_count: DEMO_INVOICES.filter(i => i.client_id === c.id).length })), total_revenue: DEMO_INVOICES.reduce((s,i) => s + i.total_clp, 0) },
    '/api/system/metrics':      { uptime_hours: 720, total_requests_24h: 3482, avg_response_ms: 45, active_users: 5, db_size_mb: 128, cache_hit_rate: 94.2 },
  };

  // Coincidencia exacta (sin query string)
  const cleanPath = path.split('?')[0];
  if (routes[cleanPath] !== undefined) return routes[cleanPath];

  // Rutas con prefijo
  if (cleanPath.startsWith('/api/pick-tasks/by-doc/')) return DEMO_PICK_TASKS;
  if (cleanPath.startsWith('/api/inventory/snapshot')) return liveInventory;
  if (cleanPath.startsWith('/api/inventory/history')) return [];
  if (cleanPath.startsWith('/api/doc-history/')) return DEMO_DOC_HISTORY;
  if (cleanPath.startsWith('/api/document-history/')) return DEMO_DOC_HISTORY;
  if (cleanPath.startsWith('/api/cycle-counts/')) return DEMO_CYCLE_COUNTS;
  if (cleanPath.startsWith('/api/cycle-count/')) return DEMO_CYCLE_COUNTS;
  if (cleanPath.startsWith('/api/purchase-orders/')) return DEMO_PURCHASE_ORDERS;
  if (cleanPath.startsWith('/api/advanced-reports')) return { summary: DEMO_STATS, dispatch_kpis: DEMO_DISPATCH_KPIS, weekly: DEMO_WEEKLY_DISPATCH };
  if (cleanPath.startsWith('/api/client-tariffs/')) return [
    { id: 1, tariff_type: 'ALMACENAJE', unit_price: 500, description: 'Almacenaje por pallet/día' },
    { id: 2, tariff_type: 'MOVIMIENTO_IN', unit_price: 1500, description: 'Recepción por movimiento' },
    { id: 3, tariff_type: 'MOVIMIENTO_OUT', unit_price: 2000, description: 'Despacho por movimiento' },
  ];
  if (cleanPath.startsWith('/api/lpn/history/')) {
    const lpnId = cleanPath.split('/').pop();
    const item = DEMO_INVENTORY.find(i => i.id === lpnId);
    if (item) {
      const events = DEMO_AUDIT.filter(a => a.lpn_id === lpnId);
      return { lpn: item, events };
    }
    return { lpn: null, events: [] };
  }
  if (cleanPath.startsWith('/api/kit-availability')) return { available: true, components: [] };
  if (cleanPath.startsWith('/api/sku-resources')) return [];
  if (cleanPath.startsWith('/api/login-history')) return [];
  if (cleanPath.startsWith('/api/billing/invoices')) return DEMO_INVOICES;
  if (cleanPath.startsWith('/api/reports/')) return [];

  return null; // null = no interceptar, dejar pasar al handler real
}

module.exports = { getSandboxResponse };
