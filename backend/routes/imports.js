// Import masivo (XLSX/CSV) + plantillas descargables. Extraído de server.js (COD-02).
const express = require('express');
const XLSX = require('xlsx');
const { pool, mapDbError } = require('../db');
const { requireAuth, requireStockWrite, requireJefe, stockWriteLimiter, checkClientAccess, checkBatchSkuClientAccess } = require('../middleware');
const { genLpnId, logStorageEvent } = require('../helpers');
const {
  parseFile, getImportRows, validateStockRows, TEMPLATES,
  xlsxHeaderStyle, xlsxDescStyle, xlsxExampleStyle, applyRowStyles,
} = require('../import-export-helpers');

const router = express.Router();

// checkClientAccess/checkBatchSkuClientAccess validan sobre req.body.items[], pero
// las rutas de import masivo reciben su payload en `rows` (o `data` base64). Sin
// este puente, esos middlewares nunca ven una sola fila y no bloquean nada.
const attachRowsAsItems = (req, res, next) => {
  req._importRows = getImportRows(req.body);
  req.body.items = req._importRows || [];
  next();
};

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
router.post('/import/:type/preview', requireAuth, (req, res) => {
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
router.post('/import/:type/validate', requireAuth, async (req, res) => {
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

router.post('/import/skus', requireStockWrite, async (req, res) => {
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

router.post('/import/clients', requireJefe, async (req, res) => {
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

router.post('/import/inventory', requireStockWrite, async (req, res) => {
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

router.post('/import/receive', stockWriteLimiter, requireStockWrite, attachRowsAsItems, checkClientAccess('write'), checkBatchSkuClientAccess(), async (req, res) => {
  const { username, client_id, doc_num } = req.body;
  const rows = req._importRows;
  if (!rows) return res.status(400).json({ error: 'Se requiere `rows` (filas) o `data` (base64).' });
  if (rows.length > 10000) return res.status(400).json({ error: 'Máximo 10.000 filas por importación' });
  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');
    // Integridad: si la recepción especifica client_id, todas las filas se validan
    // contra ese cliente (forceClient). Solo las válidas se insertan.
    const { valid, errors } = await validateStockRows(dbClient, rows, { forceClient: client_id || null, defaultClient: 'GENERAL', defaultLocation: 'PISO-RECEPCION' });
    const validRows = valid.map(v => ({ ...v, lpnId: genLpnId('REC') }));
    // REN-03: INSERT multi-fila por lote en vez de una query por fila. Se trocea
    // de a 1000 filas para no superar el límite de parámetros de Postgres (65535).
    const CHUNK = 1000;
    for (let i = 0; i < validRows.length; i += CHUNK) {
      const chunk = validRows.slice(i, i + CHUNK);
      const invValues = chunk.map((_, idx) => `($${idx*9+1},$${idx*9+2},$${idx*9+3},$${idx*9+4},'DISPONIBLE',$${idx*9+5},$${idx*9+6},$${idx*9+7},$${idx*9+8},$${idx*9+9})`).join(',');
      const invParams = chunk.flatMap(r => [r.lpnId, r.sku, r.qty, r.client_id, r.batch, r.expiry, r.serial, r.location, r.glosa || `Recepción masiva ${doc_num || ''}`]);
      await dbClient.query(`INSERT INTO inventory_lpns (id,sku,qty,client_id,status,batch_number,expiry_date,serial_number,location_id,glosa) VALUES ${invValues}`, invParams);
      const audValues = chunk.map((_, idx) => `('INBOUND',$${idx*4+1},$${idx*4+2},$${idx*4+3},$${idx*4+4})`).join(',');
      const audParams = chunk.flatMap(r => [r.sku, r.qty, `Recepción masiva Doc:${doc_num || 'N/A'} LPN:${r.lpnId}`, username || 'IMPORT']);
      await dbClient.query(`INSERT INTO audit_log (type,sku,qty,glosa,username) VALUES ${audValues}`, audParams);
    }
    // Cobro 3PL: se mantiene fila por fila (lookup de tarifa por cliente; no-op si es cliente propio).
    for (const r of validRows) {
      await logStorageEvent(dbClient, { client_id: r.client_id, event_type: 'MOVIMIENTO_IN', sku: r.sku, lpn_id: r.lpnId, qty: r.qty, location_id: r.location });
    }
    await dbClient.query('COMMIT');
    res.json({ imported: validRows.length, success: validRows.length, errors });
  } catch(err) {
    await dbClient.query('ROLLBACK');
    return res.status(500).json({ error: mapDbError(err) });
  } finally { dbClient.release(); }
});

router.post('/import/dispatch', stockWriteLimiter, requireStockWrite, attachRowsAsItems, checkClientAccess('write'), checkBatchSkuClientAccess(), async (req, res) => {
  const { username, doc_num } = req.body;
  const rows = req._importRows;
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

module.exports = router;
