// Entradas de stock (recepción manual, OC, ASN, importaciones): validación común
// contra el maestro del cliente del documento y alta de LPN con kardex y cobro 3PL.
// El cliente siempre es el del documento; nunca se deduce del "primer" dueño de un
// código de SKU, porque el mismo código puede existir en varios clientes.
const { validateStockRows } = require('./import-export-helpers');
const { genLpnId, logStorageEvent } = require('./helpers');

const httpError = (status, message, extra = {}) => Object.assign(new Error(message), { status }, extra);

// Series ya usadas (en stock o repetidas en la entrada): el índice único (sku, serie)
// haría fallar el insert completo con un error genérico.
async function erroresDeSerie(db, valid) {
  const conSerie = valid.filter((v) => v.serial);
  if (!conSerie.length) return [];
  const errors = [];
  const vistas = new Set();
  for (const v of conSerie) {
    const k = `${v.sku}||${v.serial}`;
    if (vistas.has(k)) errors.push({ row: v.row, sku: v.sku, message: `Serie '${v.serial}' repetida` });
    vistas.add(k);
  }
  const r = await db.query('SELECT sku, serial_number FROM inventory_lpns WHERE serial_number = ANY($1)', [conSerie.map((v) => v.serial)]);
  const existentes = new Set(r.rows.map((x) => `${String(x.sku).toUpperCase()}||${x.serial_number}`));
  for (const v of conSerie) {
    if (existentes.has(`${v.sku}||${v.serial}`)) errors.push({ row: v.row, sku: v.sku, message: `Serie '${v.serial}' ya existe para ${v.sku}` });
  }
  return errors;
}

// Cliente del documento: el indicado o, si no viene, el único dueño de los SKU.
async function clienteDelDocumento(db, indicado, skus) {
  const c = String(indicado ?? '').trim().toUpperCase();
  if (c) return c;
  const lista = [...new Set(skus.map((s) => String(s ?? '').trim().toUpperCase()).filter(Boolean))];
  if (lista.length) {
    const r = await db.query('SELECT DISTINCT client_id FROM master_skus WHERE sku = ANY($1) AND deleted_at IS NULL', [lista]);
    if (r.rows.length === 1) return String(r.rows[0].client_id).toUpperCase();
  }
  throw httpError(400, 'Indique el cliente del documento: no se puede deducir de los productos.');
}

// rows: [{ sku, qty, location_id, batch_number, expiry_date, serial_number, glosa }]
// Devuelve { valid, errors } (errors vacío = todo se puede ingresar).
async function validarEntrada(db, rows, clientId) {
  const { valid, errors } = await validateStockRows(db, rows, { forceClient: clientId, defaultLocation: 'PISO-RECEPCION' });
  errors.push(...await erroresDeSerie(db, valid));
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  for (const v of valid) {
    if (!v.expiry) continue;
    const d = new Date(v.expiry);
    if (Number.isNaN(d.getTime())) errors.push({ row: v.row, sku: v.sku, message: `Fecha de vencimiento inválida: ${v.expiry}` });
    else if (d < hoy) errors.push({ row: v.row, sku: v.sku, message: `El vencimiento ${v.expiry} ya pasó` });
  }
  return { valid, errors };
}

// Respuesta 422 con el detalle de una entrada rechazada completa.
const rechazoEntrada = (errors) => httpError(422, `No se ingresó nada: ${errors.map((e) => `${e.sku}: ${e.message}`).join('; ')}`, { errors });

// Crea un LPN DISPONIBLE por fila validada, con su kardex de entrada y el cobro 3PL.
async function crearLpnsEntrada(db, valid, { prefijo, glosaLpn, glosaKardex, username }) {
  const creados = [];
  for (const v of valid) {
    const lpnId = genLpnId(prefijo);
    await db.query(
      `INSERT INTO inventory_lpns (id, sku, sku_version, qty, client_id, status, batch_number, expiry_date, serial_number, location_id, glosa)
       VALUES ($1, $2, COALESCE((SELECT current_version FROM master_skus WHERE sku=$10 AND client_id=$11), 1), $3, $4, 'DISPONIBLE', $5, $6, $7, $8, $9)`,
      [lpnId, v.sku, v.qty, v.client_id, v.batch, v.expiry, v.serial, v.location, v.glosa || glosaLpn || '', v.sku, v.client_id]);
    await db.query(
      `INSERT INTO audit_log (type, sku, qty, glosa, username, client_id) VALUES ('INBOUND', $1, $2, $3, $4, $5)`,
      [v.sku, v.qty, glosaKardex(lpnId, v), username, v.client_id]);
    await logStorageEvent(db, { client_id: v.client_id, event_type: 'MOVIMIENTO_IN', sku: v.sku, lpn_id: lpnId, qty: v.qty, location_id: v.location });
    creados.push({ lpnId, sku: v.sku, qty: v.qty, batch: v.batch, expDate: v.expiry, serial: v.serial, location_id: v.location, client_id: v.client_id });
  }
  return creados;
}

module.exports = { httpError, erroresDeSerie, clienteDelDocumento, validarEntrada, rechazoEntrada, crearLpnsEntrada };
