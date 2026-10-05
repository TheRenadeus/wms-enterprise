// Escrituras/operaciones de inventario: status, receive/dispatch/adjust batch,
// relocate, bulk-load, history, snapshot, fefo. Extraído de server.js (COD-02).
const express = require('express');
const { pool, mapDbError, isUniqueViolation, userError } = require('../db');
const {
  requireAuth, requireAdmin, requireJefe, requireStockWrite, stockWriteLimiter,
  checkClientAccess, checkBatchSkuClientAccess, checkLpnClientAccess,
} = require('../middleware');
const { genLpnId, logStorageEvent, registrarHistorial } = require('../helpers');
const { consumeComponentTracked } = require('../kitConsumo');
const { clienteDelDocumento, validarEntrada, rechazoEntrada, crearLpnsEntrada, clientesEquivalentes, duenosDeSkus } = require('../stock-entrante');
const { clientAllowed, scopeCondition, auditScopeCondition } = require('../scope');

const httpError = (status, message) => Object.assign(new Error(message), { status });

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
  if (!clientAllowed(req.clientScope, client_id || '')) return res.json({ exists: false });
  try {
    const r = await pool.query(
      'SELECT 1 FROM processed_docs WHERE doc_num=$1 AND doc_type=$2 AND client_id=$3 LIMIT 1',
      [String(doc_num).toUpperCase(), String(doc_type || '').toUpperCase(), String(client_id || '').toUpperCase()]
    );
    res.json({ exists: r.rows.length > 0 });
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

router.post('/receive_batch', stockWriteLimiter, requireStockWrite, checkClientAccess('write'), checkBatchSkuClientAccess(), async (req, res) => {
  const { items, docNum, glosa, docType } = req.body;
  const username = req.user.username;
  if (!docNum) return res.status(400).json({ error: 'docNum es requerido para trazabilidad.' });
  if (!items || !Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'Se requiere al menos un ítem.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Cliente del documento: el indicado (ya validado contra el alcance) o el único
    // dueño de los SKU. Nunca el "primero" de un código compartido entre clientes.
    const docClientId = await clienteDelDocumento(client, req.body.client_id, items.map(it => it?.sku));
    // Verificar idempotencia: si este doc ya fue procesado para este cliente, rechazar (LOG-09)
    const already = await client.query('SELECT doc_num FROM processed_docs WHERE doc_num=$1 AND doc_type=$2 AND client_id=$3', [docNum.toUpperCase(), (docType||'REC').toUpperCase(), docClientId]);
    if (already.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `El documento '${docNum}' ya fue procesado previamente para este cliente. No se puede registrar dos veces.` });
    }
    // Misma validación que las importaciones: el SKU es del cliente, lote/serie
    // cuando el SKU los exige, serie única, vencimiento válido y ubicación existente.
    const filas = items.map(it => ({
      sku: it?.sku, qty: it?.qty, location_id: it?.location_id, batch_number: it?.batch,
      expiry_date: it?.expDate, serial_number: it?.serial,
    }));
    const { valid, errors } = await validarEntrada(client, filas, docClientId);
    if (errors.length) throw rechazoEntrada(errors);
    const aplicados = await crearLpnsEntrada(client, valid, {
      prefijo: 'LPN', glosaLpn: glosa || '', username,
      glosaKardex: (lpnId) => `Doc: [${docType || 'N/A'}] ${docNum}. LPN: ${lpnId}`,
    });
    await registrarHistorial(client, {
      module: 'receive', docNum, docType, glosa, username, items: aplicados, clientId: docClientId,
      docDate: req.body.docDate, docRef: req.body.docRef, enteredAt: req.body.docEnteredAt,
    });
    // Registrar documento como procesado para evitar doble ingreso
    await client.query('INSERT INTO processed_docs(doc_num,doc_type,client_id,processed_by) VALUES($1,$2,$3,$4)',
      [docNum.toUpperCase(), (docType||'REC').toUpperCase(), docClientId, username]);
    // Cerrar tareas de picking pendientes asociadas a este documento. Sin .catch: un
    // error aquí abortaría la transacción y el COMMIT sería un ROLLBACK silencioso.
    await client.query(`UPDATE pick_tasks SET status='COMPLETADA' WHERE doc_num=$1 AND module='receive' AND status IN ('PENDIENTE','EN_PROCESO')`, [docNum.toUpperCase()]);
    await client.query(`UPDATE pick_task_lines ptl SET status='COMPLETADA', updated_at=NOW() FROM pick_tasks pt WHERE ptl.task_id=pt.id AND pt.doc_num=$1 AND pt.module='receive' AND ptl.status='PENDIENTE'`, [docNum.toUpperCase()]);
    await client.query('COMMIT');
    // Respuesta consistente { imported, errors }. Transaccional (todo-o-nada):
    // si llegó aquí, todas las filas válidas se insertaron. `success` se mantiene
    // por compatibilidad con el flujo de recepción manual (handleCommitAPI).
    res.json({ success: true, imported: aplicados.length, errors: [] });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (isUniqueViolation(err)) return res.status(409).json({ error: `El documento '${docNum}' ya fue procesado previamente para este cliente. No se puede registrar dos veces.` });
    console.error("Error Receive:", err.message);
    res.status(err.status || (err.severity ? 500 : 400)).json({ error: userError(err), ...(err.errors ? { errors: err.errors } : {}) });
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
  const { items, docNum, glosa, docType, usePickConfirmations, allow_substitutes: allowSubstFlag } = req.body;
  const username = req.user.username;
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
    // Batch: una query para allow_substitutes de todos los SKUs y una para el
    // stock disponible de los que aplican, en vez de 2 queries por SKU.
    const itemsConDeficit = [];
    const skuList = Object.keys(skuTotals);
    if (skuList.length > 0) {
      const metaRes = await pool.query(`SELECT sku, allow_substitutes FROM master_skus WHERE sku = ANY($1)`, [skuList]);
      const metaBySku = new Map();
      for (const r of metaRes.rows) { if (!metaBySku.has(r.sku)) metaBySku.set(r.sku, r.allow_substitutes); }
      const substitutableSkus = skuList.filter(s => metaBySku.get(s));
      if (substitutableSkus.length > 0) {
        const availRes = await pool.query(
          `SELECT sku, COALESCE(SUM(qty),0)::float AS total FROM inventory_lpns
            WHERE sku = ANY($1) AND qty>0 AND status='DISPONIBLE' GROUP BY sku`, [substitutableSkus]
        );
        const availBySku = new Map(availRes.rows.map(r => [r.sku, parseFloat(r.total) || 0]));
        for (const s of substitutableSkus) {
          const reqQty = skuTotals[s];
          const qtyAvailable = availBySku.get(s) || 0;
          if (qtyAvailable < reqQty) {
            itemsConDeficit.push({
              sku: s, qty_solicitada: reqQty, qty_disponible: qtyAvailable,
              deficit: reqQty - qtyAvailable,
              substitutes_url: `/api/skus/${encodeURIComponent(s)}/substitutes?qty=${reqQty - qtyAvailable}`,
            });
          }
        }
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
    // Un despacho es de un solo cliente y ese cliente tiene que estar en el alcance del usuario.
    if (dispClientId && !clientAllowed(req.clientScope, dispClientId)) {
      throw httpError(403, `Acceso denegado al cliente '${dispClientId}'.`);
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

    const aplicados = [];
    for (let it of items) {
      const docGlosa = glosa || '';
      const user = username;

      // ── KITTING Modo A: línea de kit explotada al vuelo ──────────────────────
      // El kit es VIRTUAL: no genera stock propio. Se descuenta cada componente de
      // la receta (FEFO 'auto' o LPN elegidos 'manual'), se registra trazabilidad en
      // kit_componente_consumido (origen_tipo='despacho') y un Kardex OUTBOUND por
      // componente. Todo en la MISMA transacción del despacho.
      if (it.isKit) {
        const kitSku = String(it.sku || '').toUpperCase();
        const kitClient = String(it.client_id || '').toUpperCase();
        const qtyKits = parseInt(it.qtyKits ?? it.qty ?? it.qtyToPick);
        if (!kitSku || !kitClient) throw new Error('Línea de kit sin SKU o cliente.');
        if (!clientAllowed(req.clientScope, kitClient)) throw httpError(403, `Acceso denegado al cliente '${kitClient}'.`);
        if (kitClient !== dispClientId) throw httpError(400, 'Un despacho no puede mezclar mercancía de distintos clientes.');
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
              `INSERT INTO audit_log (type, sku, qty, glosa, username, client_id) VALUES ('OUTBOUND', $1, $2, $3, $4, $5)`,
              [comp.component_sku, cc.cantidad,
               `[KIT] Componente de ${qtyKits}x ${kitSku}. Doc: [${docType || 'N/A'}] ${docNum}. LPN origen: ${cc.lpn_id}.${cc.lote ? ` Lote: ${cc.lote}.` : ''}${cc.serie ? ` Serie: ${cc.serie}.` : ''} ${docGlosa}`,
               user, kitClient]);
            await logStorageEvent(client, { client_id: kitClient || null, event_type: 'MOVIMIENTO_OUT', sku: comp.component_sku, lpn_id: cc.lpn_id, qty: cc.cantidad });
            aplicados.push({ sku: comp.component_sku, lpnId: cc.lpn_id, qtyToPick: cc.cantidad, qty: cc.cantidad, location: cc.ubicacion, serial: cc.serie, batch: cc.lote, expiry: cc.vence, kit: kitSku, client_id: kitClient });
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
        `SELECT id, qty, status, sku, client_id, location_id, serial_number, batch_number, expiry_date FROM inventory_lpns WHERE id = $1 FOR UPDATE`, [lpnId]
      );
      const lpnRow = lpnLock.rows[0];
      if (!lpnRow || !clientAllowed(req.clientScope, lpnRow.client_id)) throw httpError(404, `LPN ${lpnId} no encontrado.`);
      // El LPN tiene que ser del SKU declarado y del mismo cliente que el resto del documento.
      if (String(lpnRow.sku).toUpperCase() !== sku.toUpperCase()) {
        throw httpError(400, `El LPN ${lpnId} no corresponde al SKU ${sku}.`);
      }
      if (String(lpnRow.client_id || '').toUpperCase() !== dispClientId) {
        throw httpError(400, 'Un despacho no puede mezclar mercancía de distintos clientes.');
      }
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
        `INSERT INTO audit_log (type, sku, qty, glosa, username, client_id) VALUES ('OUTBOUND', $1, $2, $3, $4, $5)`,
        [lpnRow.sku, qtyToPick, `LPN: ${lpnId}. Doc: [${docType || 'N/A'}] ${docNum}.${batchInfo}${serialInfo} ${docGlosa}`, user, lpnRow.client_id]
      );

      // Cobro 3PL: registrar evento de movimiento de salida (no-op si cliente propio)
      await logStorageEvent(client, { client_id: dispClientId || null, event_type: 'MOVIMIENTO_OUT', sku, lpn_id: lpnId, qty: qtyToPick });
      aplicados.push({ sku: lpnRow.sku, lpnId, qtyToPick, qty: qtyToPick, location: lpnRow.location_id, serial: lpnRow.serial_number,
        batch: lpnRow.batch_number, expiry: lpnRow.expiry_date, client_id: lpnRow.client_id });
    }
    // Borrar solo LPNs que este dispatch dejó en 0; evita carrera con otras
    // sesiones que pudieran estar insertando filas con qty=0 transitorio.
    if (lpnsToDelete.length > 0) {
      await client.query('DELETE FROM inventory_lpns WHERE id = ANY($1::varchar[]) AND qty <= 0', [lpnsToDelete]);
    }
    if (!aplicados.length) throw httpError(400, 'El despacho no tiene cantidades para descontar.');
    await registrarHistorial(client, {
      module: 'dispatch', docNum, docType, glosa, username, items: aplicados, clientId: dispClientId,
      docDate: req.body.docDate, docRef: req.body.docRef, enteredAt: req.body.docEnteredAt,
    });
    // Registrar documento como procesado para evitar doble despacho
    await client.query('INSERT INTO processed_docs(doc_num,doc_type,client_id,processed_by) VALUES($1,$2,$3,$4)', [docNum.toUpperCase(), (docType||'DIS').toUpperCase(), dispClientId, username]);
    // Cerrar tareas de picking asociadas a este documento (sin .catch, ver receive_batch).
    await client.query(`UPDATE pick_tasks SET status='COMPLETADA' WHERE doc_num=$1 AND module='dispatch' AND status IN ('PENDIENTE','EN_PROCESO')`, [docNum.toUpperCase()]);
    await client.query(`UPDATE pick_task_lines ptl SET status='COMPLETADA', updated_at=NOW() FROM pick_tasks pt WHERE ptl.task_id=pt.id AND pt.doc_num=$1 AND pt.module='dispatch' AND ptl.status='PENDIENTE'`, [docNum.toUpperCase()]);
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (isUniqueViolation(err)) return res.status(409).json({ error: `El documento '${docNum}' ya fue despachado previamente para este cliente. No se puede despachar dos veces.` });
    res.status(err.status || (err.severity ? 500 : 400)).json({ error: userError(err) });
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
  } catch (err) { await client.query('ROLLBACK').catch(() => {}); res.status(err.severity ? 500 : 400).json({ error: userError(err) }); } finally { client.release(); }
});

router.post('/adjust_batch', stockWriteLimiter, requireJefe, checkClientAccess('write'), checkBatchSkuClientAccess(), async (req, res) => {
  if (!['ADMIN','SUPERADMIN'].includes(req.user.role))
    return res.status(403).json({ error: 'Solo administradores pueden aplicar ajustes directamente. Use /api/adjust-request para solicitar aprobación.' });
  const { items, docNum, glosa } = req.body;
  const username = req.user.username;
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'Se requiere al menos un ítem.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const aplicados = [];
    // Anti-reúso: el número de hoja de ajuste no se puede reutilizar por cliente.
    const adjType = 'ADJ';
    const adjClientId = await clienteDelDocumento(client, req.body.client_id, items.map(it => it?.sku));
    const equivAdj = await clientesEquivalentes(client, adjClientId);
    if (docNum) {
      const alreadyAdj = await client.query('SELECT 1 FROM processed_docs WHERE doc_num=$1 AND doc_type=$2 AND client_id=$3', [String(docNum).toUpperCase(), adjType, adjClientId]);
      if (alreadyAdj.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: `La hoja de ajuste '${docNum}' ya fue cerrada para este cliente. No se puede reutilizar.` });
      }
    }
    for (let it of items) {
      const sku = String(it?.sku ?? '').trim().toUpperCase();
      const qty = parseFloat(it?.qty);
      const dueno = (await duenosDeSkus(client, [sku], equivAdj)).get(sku);
      if (!dueno) throw httpError(400, `El SKU ${sku} no existe para el cliente ${adjClientId}.`);
      const batch = it.batch && String(it.batch).trim() !== '' ? String(it.batch).trim() : null;
      const expDate = it.expDate && String(it.expDate).trim() !== '' ? String(it.expDate).trim() : null;
      const serial = it.serial && String(it.serial).trim() !== '' ? String(it.serial).trim() : null;
      const locId = it.location_id || 'PISO-RECEPCION';
      const docGlosa = glosa || '';
      const user = username;

      if (it.action === 'ADD') {
        if (isNaN(qty) || qty <= 0) throw new Error(`La cantidad de ajuste debe ser mayor a 0 para SKU ${sku}.`);
        const lpnId = genLpnId('ADJ');
        const clientId = dueno;

        await client.query(
          `INSERT INTO inventory_lpns (id, sku, qty, client_id, status, batch_number, expiry_date, serial_number, location_id, glosa)
           VALUES ($1, $2, $3, $4, 'DISPONIBLE', $5, $6, $7, $8, $9)`,
          [lpnId, sku, qty, clientId, batch, expDate, serial, locId, docGlosa]
        );
        await client.query(
          `INSERT INTO audit_log (type, sku, qty, glosa, username, client_id) VALUES ('ADJUST_IN', $1, $2, $3, $4, $5)`,
          [sku, qty, `Ref: ${docNum || 'S/N'}. LPN: ${lpnId}`, user, clientId]
        );
        aplicados.push({ action: 'ADD', sku, qty, lpnId, client_id: clientId });
      } else {
        if (serial) {
          const resUpd = await client.query(
            'UPDATE inventory_lpns SET qty = 0 WHERE id = (SELECT id FROM inventory_lpns WHERE sku = $1 AND serial_number = $2 AND client_id = ANY($3) AND qty > 0 LIMIT 1 FOR UPDATE) RETURNING id',
            [sku, serial, equivAdj]
          );
          if(resUpd.rowCount === 0) throw new Error(`Serie ${serial} no disponible para mermar.`);
          aplicados.push({ action: 'REMOVE', sku, qty: 1, lpnId: resUpd.rows[0].id, serial });
          await client.query(
            `INSERT INTO audit_log (type, sku, qty, glosa, username, client_id) VALUES ('ADJUST_OUT', $1, $2, $3, $4, $5)`,
            [sku, 1, `Ref: ${docNum || 'S/N'}. Merma Serie ${serial}`, user, dueno]
          );
        } else {
          if (isNaN(qty) || qty <= 0) throw httpError(400, `La cantidad de merma debe ser mayor a 0 para SKU ${sku}.`);
          let remaining = qty;
          // Solo stock de este cliente y, si se indicó, de esa ubicación.
          const mermaParams = [sku, equivAdj];
          if (it.location_id) mermaParams.push(String(it.location_id));
          const check = await client.query(
            `SELECT id, qty FROM inventory_lpns WHERE sku = $1 AND client_id = ANY($2) AND qty > 0${it.location_id ? ' AND location_id = $3' : ''} ORDER BY id ASC FOR UPDATE`,
            mermaParams
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
            `INSERT INTO audit_log (type, sku, qty, glosa, username, client_id) VALUES ('ADJUST_OUT', $1, $2, $3, $4, $5)`,
            [sku, qty, `Ref: ${docNum || 'S/N'}. Merma FIFO`, user, dueno]
          );
          aplicados.push({ action: 'REMOVE', sku, qty });
        }
      }
    }
    await client.query('DELETE FROM inventory_lpns WHERE qty <= 0');
    if (docNum) await client.query('INSERT INTO processed_docs(doc_num,doc_type,client_id,processed_by) VALUES($1,$2,$3,$4)', [String(docNum).toUpperCase(), adjType, adjClientId, username]);
    await registrarHistorial(client, {
      module: 'adjust', docNum: docNum || 'S/N', docType: adjType, glosa, username, items: aplicados, clientId: adjClientId,
      docDate: req.body.docDate, docRef: req.body.docRef, enteredAt: req.body.docEnteredAt,
    });
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (isUniqueViolation(err)) return res.status(409).json({ error: `La hoja de ajuste '${docNum}' ya fue cerrada para este cliente. No se puede reutilizar.` });
    console.error("Error Adjust:", err.message);
    res.status(err.status || (err.severity ? 500 : 400)).json({ error: userError(err) });
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
    conditions.push(scopeCondition(req.clientScope, 'i.client_id', params));
    const result = await pool.query(`
      SELECT i.*, s."desc", s.uom
      FROM inventory_lpns i
      LEFT JOIN master_skus s ON i.sku = s.sku AND s.client_id = i.client_id
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
    conditions.push(scopeCondition(req.clientScope, 'i.client_id', params));

    // Calcular qty al momento de la fecha usando audit_log
    const result = await pool.query(`
      WITH lpn_created AS (
        SELECT i.id, i.sku, i.client_id, i.location_id, i.status,
               i.batch_number, i.expiry_date, i.serial_number, i.created_at,
               s."desc", s.uom
        FROM inventory_lpns i
        LEFT JOIN master_skus s ON i.sku = s.sku AND s.client_id = i.client_id
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
    q += ` AND ${scopeCondition(req.clientScope, 'client_id', params)}`;
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
    conds.push(scopeCondition(req.clientScope, 'i.client_id', params));
    const q = `SELECT i.id, i.sku, i.qty, i.status, i.location_id, i.client_id, i.batch_number, i.expiry_date, i.created_at
               FROM inventory_lpns i WHERE ${conds.join(' AND ')}
               ORDER BY i.created_at DESC LIMIT 200`;
    res.json({ lpns: (await pool.query(q, params)).rows });
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});

router.get('/lpn/history/:lpnId', requireAuth, async (req, res) => {
  try {
    const safeId = req.params.lpnId.replace(/[%_\\]/g, '\\$&');
    const current = await pool.query(`SELECT * FROM inventory_lpns WHERE id = $1`, [req.params.lpnId]);
    if (current.rows[0] && !clientAllowed(req.clientScope, current.rows[0].client_id)) {
      return res.status(404).json({ error: 'LPN no encontrado.' });
    }
    const params = [`%${safeId}%`];
    const logs = await pool.query(
      `SELECT * FROM audit_log al WHERE glosa ILIKE $1 ESCAPE '\\' AND ${auditScopeCondition(req.clientScope, 'al', params)} ORDER BY created_at ASC`,
      params
    );
    res.json({ logs: logs.rows, current: current.rows[0] || null });
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});

module.exports = router;
