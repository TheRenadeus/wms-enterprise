// Escrituras/operaciones de inventario: status, receive/dispatch/adjust batch,
// relocate, bulk-load, history, snapshot, fefo. Extraído de server.js (COD-02).
const express = require('express');
const { pool, mapDbError, isUniqueViolation } = require('../db');
const {
  requireAuth, requireAdmin, requireJefe, requireStockWrite, stockWriteLimiter,
  checkClientAccess, checkBatchSkuClientAccess, checkLpnClientAccess,
} = require('../middleware');
const { genLpnId, logStorageEvent } = require('../helpers');
const { consumeComponentTracked } = require('../kitConsumo');

const router = express.Router();

// Transiciones de estado permitidas
const STATUS_TRANSITIONS = {
  'DISPONIBLE':  ['BLOQUEADO', 'CUARENTENA', 'RETENIDO'],
  'BLOQUEADO':   ['DISPONIBLE', 'CUARENTENA', 'RETENIDO'],
  'CUARENTENA':  ['DISPONIBLE', 'BLOQUEADO', 'RETENIDO'],
  'RETENIDO':    ['DISPONIBLE', 'BLOQUEADO', 'CUARENTENA'],
  'DESPACHADO':  [], // terminal — no se puede cambiar
};

router.post('/inventory/status', requireStockWrite, checkLpnClientAccess('id'), async (req, res) => {
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
router.get('/processed-docs/exists', requireAuth, async (req, res) => {
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

router.post('/receive_batch', stockWriteLimiter, requireStockWrite, checkClientAccess('write'), checkBatchSkuClientAccess(), async (req, res) => {
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

// Carga directa de stock (alta masiva sin ASN/OC). Pensado para carga inicial
// de inventario por parte de un administrador. Genera 1 LPN por ítem en
// PISO-RECEPCION con estado DISPONIBLE y deja auditoría tipo CARGA_INICIAL.
router.post('/inventory/bulk-load', requireAdmin, async (req, res) => {
  const { client_id, items, motivo } = req.body;
  if (!client_id) return res.status(400).json({ error: 'client_id es requerido.' });
  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Se requiere al menos un ítem en items.' });
  }
  const glosa = (motivo && String(motivo).trim()) || 'Carga inicial de stock';
  const user = req.user?.username || 'SYSTEM';
  const ts = Date.now();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const lpnsCreated = [];
    let totalQty = 0;
    for (let i = 0; i < items.length; i++) {
      const sku = String(items[i]?.sku || '').trim();
      const qty = parseFloat(items[i]?.qty);
      if (!sku || isNaN(qty) || qty <= 0) {
        throw new Error(`Ítem #${i + 1} inválido: se requiere sku y qty > 0.`);
      }
      // Verificar que el SKU existe para ese cliente y obtener su versión vigente.
      const skuRow = await client.query(
        `SELECT current_version FROM master_skus WHERE sku = $1 AND client_id = $2 LIMIT 1`,
        [sku, client_id]
      );
      if (skuRow.rows.length === 0) {
        throw new Error(`El SKU '${sku}' no existe para el cliente ${client_id}.`);
      }
      const currentVersion = skuRow.rows[0].current_version || 1;
      const lpnId = `LPN-${ts}-${i}`;

      await client.query(
        `INSERT INTO inventory_lpns (id, sku, sku_version, qty, client_id, status, location_id, glosa, created_at)
         VALUES ($1, $2, $3, $4, $5, 'DISPONIBLE', 'PISO-RECEPCION', $6, NOW())`,
        [lpnId, sku, currentVersion, qty, client_id, glosa]
      );

      await client.query(
        `INSERT INTO audit_log (type, sku, qty, glosa, username) VALUES ('CARGA_INICIAL', $1, $2, $3, $4)`,
        [sku, qty, `${glosa}. LPN: ${lpnId}`, user]
      );

      // Cobro 3PL: registrar movimiento de entrada (no-op si cliente propio).
      await logStorageEvent(client, { client_id, event_type: 'MOVIMIENTO_IN', sku, lpn_id: lpnId, qty, location_id: 'PISO-RECEPCION' });

      lpnsCreated.push(lpnId);
      totalQty += qty;
    }
    await client.query('COMMIT');
    res.json({ success: true, loaded: lpnsCreated.length, total_qty: totalQty, lpns_created: lpnsCreated });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error bulk-load:', err.message);
    res.status(400).json({ error: mapDbError(err) });
  } finally { client.release(); }
});

router.post('/dispatch_batch', stockWriteLimiter, requireStockWrite, checkClientAccess('write'), checkBatchSkuClientAccess(), async (req, res) => {
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

router.post('/relocate', requireStockWrite, checkClientAccess('write'), checkLpnClientAccess('id'), async (req, res) => {
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

router.post('/adjust_batch', stockWriteLimiter, requireJefe, checkClientAccess('write'), checkBatchSkuClientAccess(), async (req, res) => {
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

router.get('/inventory/history', requireAuth, async (req, res) => {
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

router.get('/inventory/snapshot', requireAuth, async (req, res) => {
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

router.get('/inventory/fefo/:sku', requireAuth, async (req, res) => {
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

// ============ HISTORIAL LPN ============
router.get('/lpn/search', requireAuth, async (req, res) => {
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

router.get('/lpn/history/:lpnId', requireAuth, async (req, res) => {
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

module.exports = router;
