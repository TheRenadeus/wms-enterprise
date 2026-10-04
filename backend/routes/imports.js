// Import masivo (XLSX/CSV) + plantillas descargables. Extraído de server.js (COD-02).
const crypto = require('crypto');
const express = require('express');
const XLSX = require('xlsx');
const { pool, mapDbError } = require('../db');
const { requireAuth, requireStockWrite, requireJefe, stockWriteLimiter, checkClientAccess, checkBatchSkuClientAccess } = require('../middleware');
const { genLpnId, logStorageEvent } = require('../helpers');
const { erroresDeSerie } = require('../stock-entrante');
const { clientAllowed, scopeCondition, OWN_CLIENTS } = require('../scope');
const {
  getImportRows, validateStockRows, TEMPLATES, MAX_IMPORT_ROWS,
  xlsxHeaderStyle, xlsxDescStyle, xlsxExampleStyle, applyRowStyles,
} = require('../import-export-helpers');

const router = express.Router();

const txt = (v) => (v === undefined || v === null ? '' : String(v).trim());

// checkClientAccess/checkBatchSkuClientAccess validan sobre req.body.items[], pero
// las rutas de import masivo reciben su payload en `rows` (o `data` base64). Este
// paso lee las filas (el archivo, en un hilo aparte y con tiempo límite) y las
// expone como items para esos middlewares.
const attachRows = (type) => async (req, res, next) => {
  try {
    req._importRows = await getImportRows(req.body, type);
  } catch (e) {
    return res.status(e.status || 400).json({ error: e.status ? e.message : 'No se pudo leer el archivo.' });
  }
  if (!req._importRows) return res.status(400).json({ error: 'Se requiere `rows` (filas) o `data` (base64).' });
  req.body.items = req._importRows;
  next();
};

// Importación todo-o-nada: con una sola fila con error no se escribe nada.
const rechazarFilas = (res, errors) => res.status(422).json({
  error: `${errors.length} ${errors.length === 1 ? 'fila tiene' : 'filas tienen'} errores: no se importó nada. Corrija el archivo y vuelva a importarlo completo.`,
  errors,
  success: 0,
});

// Registra el documento en processed_docs dentro de la transacción. Devuelve false
// si ya existía (ese documento ya se importó).
async function registrarDocumento(db, docNum, docType, clientId, username) {
  const r = await db.query(
    `INSERT INTO processed_docs (doc_num, doc_type, client_id, processed_by) VALUES ($1,$2,$3,$4)
     ON CONFLICT DO NOTHING RETURNING doc_num`,
    [docNum, docType, clientId || '', username]);
  return r.rowCount === 1;
}

const huella = (rows) => crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex').slice(0, 40);

// LPN + kardex de entrada, de a 1000 filas (límite de parámetros de PostgreSQL).
async function insertarStock(db, rows, { glosaLpn, glosaKardex, username }) {
  const CHUNK = 1000;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const invValues = chunk.map((_, idx) => `($${idx*9+1},$${idx*9+2},$${idx*9+3},$${idx*9+4},'DISPONIBLE',$${idx*9+5},$${idx*9+6},$${idx*9+7},$${idx*9+8},$${idx*9+9})`).join(',');
    const invParams = chunk.flatMap(r => [r.lpnId, r.sku, r.qty, r.client_id, r.batch, r.expiry, r.serial, r.location, r.glosa || glosaLpn]);
    await db.query(`INSERT INTO inventory_lpns (id,sku,qty,client_id,status,batch_number,expiry_date,serial_number,location_id,glosa) VALUES ${invValues}`, invParams);
    const audValues = chunk.map((_, idx) => `('INBOUND',$${idx*5+1},$${idx*5+2},$${idx*5+3},$${idx*5+4},$${idx*5+5})`).join(',');
    const audParams = chunk.flatMap(r => [r.sku, r.qty, glosaKardex(r), username, r.client_id]);
    await db.query(`INSERT INTO audit_log (type,sku,qty,glosa,username,client_id) VALUES ${audValues}`, audParams);
  }
}

router.get('/templates/:type', (req, res) => {
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
router.post('/import/:type/preview', requireAuth, async (req, res) => {
  const { data, filename } = req.body;
  if (typeof data !== 'string' || !data) return res.status(400).json({ error: 'Sin datos' });
  try {
    const rows = await getImportRows({ data, filename }, req.params.type);
    const headers = rows.length > 0 ? Object.keys(rows[0]) : (TEMPLATES[req.params.type]?.headers || []);
    res.json({ headers, rows: rows.slice(0, 5), total: rows.length });
  } catch (e) { res.status(e.status || 400).json({ error: e.status ? e.message : 'No se pudo leer el archivo.' }); }
});

// Dry-run de duplicados contra la BD (no inserta nada). Devuelve, por fila,
// errores/advertencias de serie/lote repetido y a nivel documento si ya fue
// procesado. Usado por el panel de previsualización antes de confirmar.
//  - receive: serie ya en stock (error), serie repetida en archivo (error),
//             lote ya con stock para el SKU (advertencia), documento procesado.
//  - dispatch: LPN inexistente o sin stock (error), documento procesado.
router.post('/import/:type/validate', requireAuth, async (req, res) => {
  const type = req.params.type;
  const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
  if (rows.length > MAX_IMPORT_ROWS || rows.some(r => r === null || typeof r !== 'object')) return res.status(400).json({ error: 'Filas no válidas.' });
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

// Escritura por cliente: si una sola fila apunta a un cliente fuera del alcance del
// usuario se rechaza el archivo completo (no se importa a medias).
router.post('/import/skus', stockWriteLimiter, requireStockWrite, attachRows('skus'), checkClientAccess('write'), async (req, res) => {
  const username = req.user.username;
  const rows = req._importRows;
  // success = total procesados; inserted = nuevos; updated = existentes modificados;
  // versioned = SKUs cuyo control de lote/serie cambió con stock activo → bump de versión.
  const results = { success: 0, inserted: 0, updated: 0, versioned: [], errors: [] };
  const truthy = (v) => v === true || v === 'true' || v === 'TRUE' || v === '1' || v === 1;
  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');
    // Mapa código de fabricante (mayúsculas) → id, para resolver manufacturer_code de cada fila.
    const mfMap = new Map();
    (await dbClient.query(`SELECT id, code FROM manufacturers`)).rows.forEach(m => mfMap.set(String(m.code).toUpperCase(), m.id));
    const clientSet = new Set([...OWN_CLIENTS, ...(await dbClient.query('SELECT id FROM clients')).rows.map(c => String(c.id).toUpperCase())]);

    // 1) Validar todo el archivo antes de escribir.
    const errors = [];
    const seenKeys = new Set();
    const prepared = [];
    rows.forEach((r, i) => {
      const fila = i + 2;
      const fail = (m) => errors.push(`Fila ${fila}: ${m}`);
      const sku = txt(r.sku).toUpperCase();
      const desc = txt(r.desc);
      if (!sku || !desc) return fail('SKU y descripción son obligatorios');
      const client = txt(r.client_id).toUpperCase() || 'GENERAL';
      if (!clientSet.has(client)) return fail(`el cliente '${client}' no existe`);
      const key = `${sku}||${client}`;
      if (seenKeys.has(key)) return fail(`SKU '${sku}' repetido en el archivo`);
      seenKeys.add(key);
      const largos = { sku: [sku, 100], descripción: [desc, 255], categoría: [txt(r.category), 100], uom: [txt(r.uom), 20], barcode: [txt(r.barcode), 100] };
      for (const [campo, [v, max]] of Object.entries(largos)) if (v.length > max) return fail(`${campo} supera ${max} caracteres`);
      const abc = txt(r.abc_class).toUpperCase();
      if (abc && !['A', 'B', 'C'].includes(abc)) return fail(`abc_class debe ser A, B o C`);
      const medidas = {};
      for (const f of ['weight', 'length', 'width', 'height']) {
        const raw = txt(r[f]);
        const n = raw === '' ? 0 : Number(raw.replace(',', '.'));
        if (!Number.isFinite(n) || n < 0) return fail(`${f} debe ser un número mayor o igual a 0`);
        medidas[f] = n;
      }
      const mfCode = txt(r.manufacturer_code) || null;
      const mfId = mfCode ? (mfMap.get(mfCode.toUpperCase()) ?? null) : null;
      if (mfCode && mfId === null) return fail(`el fabricante '${mfCode}' no existe en el maestro`);
      prepared.push({
        sku, client, desc, category: txt(r.category) || 'General', uom: txt(r.uom) || 'UN', ...medidas,
        abc: abc || null, barcode: txt(r.barcode) || null, mfId, mfCode,
        mfSku: txt(r.manufacturer_sku) || null, brand: txt(r.brand) || null,
        newLot: truthy(r.requires_lot), newSerial: truthy(r.requires_serial),
      });
    });
    if (errors.length) { await dbClient.query('ROLLBACK'); return rechazarFilas(res, errors); }

    // 2) Escribir.
    for (const p of prepared) {
      const exists = await dbClient.query(`SELECT requires_lot, requires_serial, current_version FROM master_skus WHERE sku=$1 AND client_id=$2 LIMIT 1 FOR UPDATE`, [p.sku, p.client]);
      if (!exists.rows.length) {
        await dbClient.query(`
          INSERT INTO master_skus (sku, client_id, "desc", category, uom, weight, length, width, height, abc_class, requires_lot, requires_serial, barcode, manufacturer_id, manufacturer_code, manufacturer_sku, brand)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
        `, [p.sku, p.client, p.desc, p.category, p.uom, p.weight, p.length, p.width, p.height, p.abc, p.newLot, p.newSerial, p.barcode, p.mfId, p.mfCode, p.mfSku, p.brand]);
        results.inserted++;
      } else {
        const cur = exists.rows[0];
        // Actualizar siempre los campos no versionados.
        await dbClient.query(`
          UPDATE master_skus SET "desc"=$1, category=$2, uom=$3, weight=$4, length=$5, width=$6, height=$7, abc_class=$8, barcode=$9, manufacturer_id=$12, manufacturer_code=$13, manufacturer_sku=$14, brand=$15
          WHERE sku=$10 AND client_id=$11
        `, [p.desc, p.category, p.uom, p.weight, p.length, p.width, p.height, p.abc, p.barcode, p.sku, p.client, p.mfId, p.mfCode, p.mfSku, p.brand]);

        const criticalChange = (p.newLot !== cur.requires_lot) || (p.newSerial !== cur.requires_serial);
        if (criticalChange) {
          // Solo cuenta el stock de este cliente: el mismo código en otro cliente es otro producto.
          const stockRow = await dbClient.query(`SELECT COALESCE(SUM(qty),0)::numeric AS total FROM inventory_lpns WHERE sku=$1 AND client_id=$2 AND qty>0`, [p.sku, p.client]);
          const stock = parseFloat(stockRow.rows[0].total) || 0;
          if (stock > 0) {
            // Cambio crítico con stock → bump de versión de control + snapshot.
            const vr = await dbClient.query(`SELECT * FROM create_sku_version($1, $2, $3::jsonb, $4, $5)`,
              [p.sku, p.client, JSON.stringify({ requires_lot: p.newLot, requires_serial: p.newSerial }), 'Cambio de control de lote/serie por importación masiva', username]);
            results.versioned.push({ sku: p.sku, client_id: p.client, from: cur.current_version, to: vr.rows[0].new_version });
          } else {
            // Sin stock → actualizar in-place sin bump.
            await dbClient.query(`UPDATE master_skus SET requires_lot=$1, requires_serial=$2 WHERE sku=$3 AND client_id=$4`, [p.newLot, p.newSerial, p.sku, p.client]);
            await dbClient.query(`
              INSERT INTO sku_version_history (sku, client_id, version, requires_lot, requires_serial, changed_by, reason)
              VALUES ($1,$2,$3,$4,$5,$6,'Cambio sin stock — importación masiva')
              ON CONFLICT (sku, client_id, version) DO UPDATE SET requires_lot=EXCLUDED.requires_lot, requires_serial=EXCLUDED.requires_serial, changed_at=NOW(), changed_by=EXCLUDED.changed_by, reason=EXCLUDED.reason
            `, [p.sku, p.client, cur.current_version, p.newLot, p.newSerial, username]);
          }
        }
        results.updated++;
      }
      results.success++;
    }
    await dbClient.query('COMMIT');
  } catch(err) {
    await dbClient.query('ROLLBACK').catch(() => {});
    return res.status(500).json({ error: mapDbError(err) });
  } finally { dbClient.release(); }
  res.json(results);
});

router.post('/import/clients', stockWriteLimiter, requireJefe, attachRows('clients'), async (req, res) => {
  const rows = req._importRows;
  // Con alcance acotado solo se actualizan clientes propios; crear clientes nuevos
  // queda para quien ve todos.
  const ajenos = [...new Set(rows.map(r => txt(r.id).toUpperCase()).filter(id => id && !clientAllowed(req.clientScope, id)))];
  if (ajenos.length) return res.status(403).json({ error: `Acceso denegado al cliente '${ajenos[0]}'.` });
  const errors = [];
  const seen = new Set();
  const prepared = [];
  rows.forEach((r, i) => {
    const fail = (m) => errors.push(`Fila ${i + 2}: ${m}`);
    const id = txt(r.id).toUpperCase();
    const name = txt(r.name);
    const contact = txt(r.contact);
    const email = txt(r.email);
    if (!id || !name) return fail('ID y nombre son obligatorios');
    if (seen.has(id)) return fail(`el cliente '${id}' está repetido en el archivo`);
    seen.add(id);
    if (id.length > 50 || name.length > 150 || contact.length > 150 || email.length > 150) return fail('algún campo supera el largo permitido');
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(`email '${email}' no válido`);
    prepared.push({ id, name, contact, email });
  });
  if (errors.length) return rechazarFilas(res, errors);
  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');
    for (const c of prepared) {
      await dbClient.query(`INSERT INTO clients (id, name, contact, email) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, contact=EXCLUDED.contact, email=EXCLUDED.email`,
        [c.id, c.name, c.contact, c.email]);
    }
    await dbClient.query('COMMIT');
  } catch(err) {
    await dbClient.query('ROLLBACK').catch(() => {});
    return res.status(500).json({ error: mapDbError(err) });
  } finally { dbClient.release(); }
  res.json({ success: prepared.length, errors: [] });
});

router.post('/import/inventory', stockWriteLimiter, requireStockWrite, attachRows('inventory'), checkClientAccess('write'), async (req, res) => {
  const username = req.user.username;
  const rows = req._importRows;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Integridad: validar cada fila contra el maestro (existe+activo, pertenece al
    // cliente, lote/serie, ubicación). Con una sola fila con error no se carga nada.
    const { valid, errors } = await validateStockRows(client, rows, { defaultClient: 'GENERAL', defaultLocation: 'PISO-RECEPCION' });
    errors.push(...await erroresDeSerie(client, valid));
    if (errors.length) { await client.query('ROLLBACK'); return rechazarFilas(res, errors); }
    if (!valid.length) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'El archivo no tiene filas para importar.' }); }
    // La carga inicial no se repite: el mismo contenido importado dos veces duplicaría el stock.
    const firma = huella(valid.map(({ row, qtyRaw, ...v }) => v));
    if (!await registrarDocumento(client, `IMP-${firma}`, 'IMPORT_INVENTARIO', '', username)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Este mismo contenido ya se importó antes; no se volvió a cargar.' });
    }
    const validRows = valid.map(v => ({ ...v, lpnId: genLpnId('IMP') }));
    await insertarStock(client, validRows, { glosaLpn: 'Carga masiva', glosaKardex: (r) => `Importación masiva. LPN: ${r.lpnId}`, username });
    await client.query('COMMIT');
    res.json({ imported: validRows.length, success: validRows.length, errors: [] });
  } catch(err) {
    await client.query('ROLLBACK').catch(() => {});
    return res.status(500).json({ error: mapDbError(err) });
  } finally { client.release(); }
});

router.post('/import/receive', stockWriteLimiter, requireStockWrite, attachRows('receive'), checkClientAccess('write'), checkBatchSkuClientAccess(), async (req, res) => {
  const { client_id } = req.body;
  const docNum = txt(req.body.doc_num).toUpperCase() || null;
  const username = req.user.username;
  const rows = req._importRows;
  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');
    // Integridad: si la recepción especifica client_id, todas las filas se validan
    // contra ese cliente (forceClient). Con una sola fila con error no se recibe nada.
    const { valid, errors } = await validateStockRows(dbClient, rows, { forceClient: client_id || null, defaultClient: 'GENERAL', defaultLocation: 'PISO-RECEPCION' });
    errors.push(...await erroresDeSerie(dbClient, valid));
    if (errors.length) { await dbClient.query('ROLLBACK'); return rechazarFilas(res, errors); }
    if (!valid.length) { await dbClient.query('ROLLBACK'); return res.status(400).json({ error: 'El archivo no tiene filas para importar.' }); }
    // Un documento se recibe una sola vez.
    if (docNum && !await registrarDocumento(dbClient, docNum, 'IMPORT_RECEPCION', txt(client_id).toUpperCase(), username)) {
      await dbClient.query('ROLLBACK');
      return res.status(409).json({ error: `El documento '${docNum}' ya fue recibido. No se volvió a cargar.` });
    }
    const validRows = valid.map(v => ({ ...v, lpnId: genLpnId('REC') }));
    await insertarStock(dbClient, validRows, {
      glosaLpn: `Recepción masiva ${docNum || ''}`.trim(),
      glosaKardex: (r) => `Recepción masiva Doc:${docNum || 'N/A'} LPN:${r.lpnId}`,
      username,
    });
    // Cobro 3PL: se mantiene fila por fila (lookup de tarifa por cliente; no-op si es cliente propio).
    for (const r of validRows) {
      await logStorageEvent(dbClient, { client_id: r.client_id, event_type: 'MOVIMIENTO_IN', sku: r.sku, lpn_id: r.lpnId, qty: r.qty, location_id: r.location });
    }
    await dbClient.query('COMMIT');
    res.json({ imported: validRows.length, success: validRows.length, errors: [] });
  } catch(err) {
    await dbClient.query('ROLLBACK').catch(() => {});
    return res.status(500).json({ error: mapDbError(err) });
  } finally { dbClient.release(); }
});

router.post('/import/dispatch', stockWriteLimiter, requireStockWrite, attachRows('dispatch'), checkClientAccess('write'), checkBatchSkuClientAccess(), async (req, res) => {
  const docNum = txt(req.body.doc_num).toUpperCase() || null;
  const username = req.user.username;
  const rows = req._importRows;
  const errors = [];
  let success = 0;
  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');
    if (docNum && !await registrarDocumento(dbClient, docNum, 'IMPORT_DESPACHO', txt(req.body.client_id).toUpperCase(), username)) {
      await dbClient.query('ROLLBACK');
      return res.status(409).json({ error: `El documento '${docNum}' ya fue despachado. No se volvió a procesar.` });
    }
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const fila = i + 2;
      const sku = txt(r.sku).toUpperCase();
      const qty = Number(txt(r.qty_to_pick).replace(',', '.'));
      if (!sku || !Number.isFinite(qty) || qty <= 0) { errors.push(`Fila ${fila}: sku y qty_to_pick (número mayor a 0) son obligatorios`); continue; }
      let remaining = qty;
      // lpn_id opcional: celda vacía, espacios o "NaN" → null (selección FEFO automática).
      const lpnRaw = txt(r.lpn_id);
      const lpnId = (lpnRaw === '' || lpnRaw.toLowerCase() === 'nan') ? null : lpnRaw;
      // Cliente de la fila (columna client_id opcional, o el del documento).
      const rowClient = txt(r.client_id || req.body.client_id).toUpperCase() || null;
      // LPN elegibles (con JOIN para filtro de estado, sin FOR UPDATE), solo de
      // clientes dentro del alcance del usuario.
      const params = [sku];
      let extra = '';
      if (lpnId) { params.push(lpnId); extra += ` AND i.id=$${params.length}`; }
      if (rowClient) { params.push(rowClient); extra += ` AND i.client_id=$${params.length}`; }
      extra += ` AND ${scopeCondition(req.clientScope, 'i.client_id', params)}`;
      const eligible = (await dbClient.query(
        `SELECT i.id, i.client_id FROM inventory_lpns i
         LEFT JOIN statuses st ON i.status = st.id
         WHERE i.sku=$1 AND i.qty>0 AND COALESCE(st.blocks_outbound, FALSE) = FALSE${extra}
         ORDER BY i.created_at ASC`,
        params
      )).rows;
      // Un mismo código de SKU puede existir en varios clientes: sin cliente explícito
      // no se adivina de quién descontar.
      if (!rowClient && new Set(eligible.map(e => e.client_id)).size > 1) {
        errors.push(`Fila ${fila}: el SKU ${sku} tiene stock de varios clientes; indique client_id`);
        continue;
      }
      const eligibleIds = eligible.map(e => e.id);
      // Bloquear solo inventory_lpns (sin JOIN) para evitar error PG con outer join + FOR UPDATE
      const lpns = eligibleIds.length === 0 ? [] : (await dbClient.query(
        `SELECT id, qty, client_id FROM inventory_lpns WHERE id = ANY($1::varchar[]) AND qty>0 ORDER BY created_at ASC FOR UPDATE`,
        [eligibleIds]
      )).rows;
      const available = lpns.reduce((s, l) => s + parseFloat(l.qty), 0);
      if (available < qty) { errors.push(`Fila ${fila}: Stock insuficiente para ${sku} (faltan ${qty - available})`); continue; }
      const byClient = new Map();
      for (const lpn of lpns) {
        if (remaining <= 0) break;
        const take = Math.min(remaining, parseFloat(lpn.qty));
        await dbClient.query(`UPDATE inventory_lpns SET qty=qty-$1 WHERE id=$2`, [take, lpn.id]);
        byClient.set(lpn.client_id, (byClient.get(lpn.client_id) || 0) + take);
        remaining -= take;
      }
      for (const [cid, q] of byClient) {
        await dbClient.query(`INSERT INTO audit_log (type, sku, qty, glosa, username, client_id) VALUES ('OUTBOUND', $1, $2, $3, $4, $5)`,
          [sku, q, `Despacho masivo Doc:${docNum || 'N/A'}`, username, cid]);
        // Cobro 3PL: movimiento de salida al dueño real del stock descontado.
        await logStorageEvent(dbClient, { client_id: cid, event_type: 'MOVIMIENTO_OUT', sku, qty: q });
      }
      success++;
    }
    // Todo o nada: con una fila con error se deshace el despacho completo.
    if (errors.length) { await dbClient.query('ROLLBACK'); return rechazarFilas(res, errors); }
    await dbClient.query('DELETE FROM inventory_lpns WHERE qty <= 0');
    await dbClient.query('COMMIT');
  } catch(err) {
    await dbClient.query('ROLLBACK').catch(() => {});
    return res.status(500).json({ error: mapDbError(err) });
  } finally { dbClient.release(); }
  res.json({ success, errors: [] });
});

module.exports = router;
