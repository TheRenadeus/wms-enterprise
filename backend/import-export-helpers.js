// Helpers compartidos entre routes/imports.js y routes/exports.js.
// Extraídos de server.js (COD-02).
const XLSX = require('xlsx');

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

module.exports = {
  parseFile, getImportRows, validateStockRows, TEMPLATES,
  xlsxHeaderStyle, xlsxDescStyle, xlsxExampleStyle, applyRowStyles,
};
