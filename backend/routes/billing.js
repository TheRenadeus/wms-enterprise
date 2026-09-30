// Facturación / cobro 3PL: storage events, reporte de cargos, analytics, facturas
// e invoices (documento tributario). Extraído de server.js (COD-02).
const express = require('express');
const { pool, mapDbError, isUniqueViolation } = require('../db');
const { requireAuth, requireJefe, requireJefeOrAbove, checkClientAccess } = require('../middleware');
const { genLpnId } = require('../helpers');

const router = express.Router();

router.post('/storage/register-event', requireJefeOrAbove, async (req, res) => {
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

router.get('/report/billing/:client_id', requireAuth, async (req, res) => {
  try {
    const data = await calcBillingCharges(req.params.client_id, req.query.month, req.query.year);
    res.json(data);
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});

// ============ ANÁLISIS DE INVENTARIO ============

// Ingresos de SKU: agrupa inventory_lpns por SKU con totales y fecha último ingreso
router.get('/analytics/sku-entries', requireAuth, async (req, res) => {
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
router.get('/analytics/client-movements', requireAuth, async (req, res) => {
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
router.post('/billing/invoices', requireJefeOrAbove, checkClientAccess('write', { required: true }), async (req, res) => {
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

router.get('/billing/invoices', requireAuth, async (req, res) => {
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

router.patch('/billing/invoices/:id/status', requireJefeOrAbove, async (req, res) => {
  const { status, notes } = req.body;
  const allowed = ['EMITIDA','PAGADA','ANULADA','VENCIDA'];
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Estado inválido.' });
  try {
    await pool.query(
      `UPDATE billing_invoices SET status=$1, paid_at=${status==='PAGADA'?'NOW()':'paid_at'}, notes=COALESCE($2,notes) WHERE id=$3`,
      [status, notes||null, req.params.id]
    );
    res.json({ success:true });
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});

// Resumen de todos los clientes para un período
router.get('/billing/summary', requireJefeOrAbove, async (req, res) => {
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
router.post('/client-tariffs', requireJefe, checkClientAccess('write', { required: true }), async (req, res) => {
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

router.delete('/client-tariffs/:id', requireJefe, async (req, res) => {
  try {
    await pool.query(`DELETE FROM client_tariffs WHERE id = $1`, [req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});

router.get('/client-tariffs/:client_id', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM client_tariffs WHERE client_id = $1 ORDER BY created_at DESC`, [req.params.client_id]);
    res.json(result.rows);
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});

router.get('/invoices', requireJefeOrAbove, async (req, res) => {
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
router.post('/invoices/generate', requireJefe, checkClientAccess('write', { required: true }), async (req, res) => {
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
router.post('/invoices/:id/issue', requireJefe, async (req, res) => {
  try {
    await pool.query(`UPDATE invoices SET status='EMITIDA', issued_at=NOW() WHERE id=$1 AND status='BORRADOR'`, [req.params.id]);
    res.json({ success: true });
  } catch(e){ res.status(500).json({ error: mapDbError(e) }); }
});
router.post('/invoices/:id/pay', requireJefe, async (req, res) => {
  try {
    await pool.query(`UPDATE invoices SET status='PAGADA', paid_at=NOW() WHERE id=$1 AND status='EMITIDA'`, [req.params.id]);
    res.json({ success: true });
  } catch(e){ res.status(500).json({ error: mapDbError(e) }); }
});
router.delete('/invoices/:id', requireJefe, async (req, res) => {
  try { await pool.query(`DELETE FROM invoices WHERE id=$1 AND status='BORRADOR'`, [req.params.id]); res.json({ success: true }); }
  catch(e){ res.status(500).json({ error: mapDbError(e) }); }
});

module.exports = router;
