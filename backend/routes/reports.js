// Reports + stats router.
// Solo GETs de agregaciones. No tocan stock ni hacen writes.
// /report/billing/:client_id sigue inline en server.js porque depende del helper
// calcBillingCharges (mover cuando se extraiga el dominio billing).

const express = require('express');
const { pool, mapDbError } = require('../db');
const { requireAuth, requireJefeOrAbove } = require('../middleware');

const router = express.Router();

// ── /api/stats ───────────────────────────────────────────────────────────────
router.get('/stats/dispatch-kpis', requireAuth, async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);

    const dispatchedTodayQ = await pool.query(`
      SELECT COUNT(DISTINCT doc_num) AS dispatched_today, COALESCE(SUM(total_qty), 0) AS units_dispatched_today
      FROM document_history
      WHERE module = 'OUTBOUND' AND created_at::date = $1
    `, [today]);

    const pendingQ = await pool.query(`
      SELECT COUNT(*) AS pending_orders FROM purchase_orders WHERE status = 'PENDING'
    `);

    const approvedTodayQ = await pool.query(`
      SELECT COUNT(*) AS approved_today FROM purchase_orders WHERE created_at::date = $1
    `, [today]);
    const dispatchedToday = parseInt(dispatchedTodayQ.rows[0].dispatched_today) || 0;
    const approvedToday = parseInt(approvedTodayQ.rows[0].approved_today) || 0;
    const fillRate = dispatchedToday + approvedToday > 0
      ? Math.round((dispatchedToday / (dispatchedToday + approvedToday)) * 100)
      : (dispatchedToday > 0 ? 100 : null);

    const stockoutQ = await pool.query(`
      SELECT COUNT(DISTINCT a.sku) AS stockout_skus
      FROM (
        SELECT DISTINCT sku FROM audit_log
        WHERE type = 'OUTBOUND' AND created_at >= NOW() - INTERVAL '30 days'
      ) a
      WHERE NOT EXISTS (
        SELECT 1 FROM inventory_lpns il
        WHERE il.sku = a.sku AND il.qty > 0 AND il.status = 'DISPONIBLE'
      )
    `);

    const avgTimeQ = await pool.query(`
      SELECT ROUND(AVG(EXTRACT(EPOCH FROM (pickup_date - created_at))/3600)::numeric, 1) AS avg_hours
      FROM shipments
      WHERE pickup_date IS NOT NULL AND created_at >= NOW() - INTERVAL '30 days'
    `);

    const onTimeQ = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE delivery_date IS NOT NULL) AS total_delivered,
        COUNT(*) FILTER (WHERE delivery_date IS NOT NULL AND (scheduled_date IS NULL OR delivery_date::date <= scheduled_date)) AS on_time
      FROM shipments
      WHERE status = 'DELIVERED' AND created_at >= NOW() - INTERVAL '30 days'
    `);
    const totalDelivered = parseInt(onTimeQ.rows[0].total_delivered) || 0;
    const onTimeCount = parseInt(onTimeQ.rows[0].on_time) || 0;
    const onTimeRate = totalDelivered > 0 ? Math.round((onTimeCount / totalDelivered) * 100) : null;

    const returnsQ = await pool.query(`
      SELECT COALESCE(SUM(qty), 0) AS returned_units FROM return_lines
      WHERE created_at >= DATE_TRUNC('month', NOW())
    `);
    const dispatchedMonthQ = await pool.query(`
      SELECT COALESCE(SUM(qty), 0) AS dispatched_units FROM audit_log
      WHERE type = 'OUTBOUND' AND created_at >= DATE_TRUNC('month', NOW())
    `);
    const returnedUnits = parseFloat(returnsQ.rows[0].returned_units) || 0;
    const dispatchedUnits = parseFloat(dispatchedMonthQ.rows[0].dispatched_units) || 0;
    const returnsRate = dispatchedUnits > 0 ? Math.round((returnedUnits / dispatchedUnits) * 100 * 10) / 10 : 0;

    const topSkusQ = await pool.query(`
      SELECT sku, SUM(qty) AS total_dispatched
      FROM audit_log
      WHERE type = 'OUTBOUND' AND created_at >= DATE_TRUNC('month', NOW())
      GROUP BY sku ORDER BY total_dispatched DESC LIMIT 5
    `);

    res.json({
      fill_rate_today: fillRate,
      avg_dispatch_time_hours: parseFloat(avgTimeQ.rows[0].avg_hours) || 0,
      pending_orders: parseInt(pendingQ.rows[0].pending_orders) || 0,
      stockout_skus: parseInt(stockoutQ.rows[0].stockout_skus) || 0,
      dispatched_today: dispatchedToday,
      units_dispatched_today: parseFloat(dispatchedTodayQ.rows[0].units_dispatched_today) || 0,
      on_time_rate: onTimeRate,
      returns_rate: returnsRate,
      top_dispatched_skus: topSkusQ.rows
    });
  } catch (e) {
    console.error('dispatch-kpis error:', e.message);
    res.status(500).json({ error: mapDbError(e) });
  }
});

router.get('/stats/weekly-dispatch', requireAuth, async (req, res) => {
  try {
    const rows = await pool.query(`
      WITH days AS (
        SELECT generate_series(
          CURRENT_DATE - INTERVAL '6 days',
          CURRENT_DATE,
          '1 day'::interval
        )::date AS day
      ),
      daily_dispatch AS (
        SELECT
          created_at::date AS day,
          COUNT(DISTINCT doc_num) AS num_dispatches,
          COALESCE(SUM(total_qty), 0) AS units
        FROM document_history
        WHERE module = 'OUTBOUND'
          AND created_at >= CURRENT_DATE - INTERVAL '6 days'
        GROUP BY created_at::date
      ),
      daily_po AS (
        SELECT created_at::date AS day, COUNT(*) AS approved_today
        FROM purchase_orders
        WHERE created_at >= CURRENT_DATE - INTERVAL '6 days'
        GROUP BY created_at::date
      )
      SELECT
        TO_CHAR(d.day, 'YYYY-MM-DD') AS date,
        COALESCE(dd.num_dispatches, 0) AS dispatches,
        COALESCE(dd.units, 0) AS units,
        CASE
          WHEN COALESCE(dd.num_dispatches, 0) + COALESCE(dp.approved_today, 0) > 0
            THEN ROUND(COALESCE(dd.num_dispatches, 0)::numeric /
                 (COALESCE(dd.num_dispatches, 0) + COALESCE(dp.approved_today, 0)) * 100)
          WHEN COALESCE(dd.num_dispatches, 0) > 0 THEN 100
          ELSE 0
        END AS fill_rate
      FROM days d
      LEFT JOIN daily_dispatch dd ON dd.day = d.day
      LEFT JOIN daily_po dp ON dp.day = d.day
      ORDER BY d.day ASC
    `);
    res.json(rows.rows.map(r => ({
      date: r.date,
      dispatches: parseInt(r.dispatches),
      units: parseFloat(r.units),
      fill_rate: parseInt(r.fill_rate)
    })));
  } catch (e) {
    console.error('weekly-dispatch error:', e.message);
    res.status(500).json({ error: mapDbError(e) });
  }
});

// ── /api/report (legacy) ─────────────────────────────────────────────────────
router.get('/report/occupation', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        COALESCE(l.zone_code, 'SIN ZONA') as zone,
        l.location_id,
        COUNT(DISTINCT i.id) as lpn_count,
        COALESCE(SUM(i.qty), 0) as total_qty,
        COUNT(DISTINCT i.sku) as sku_count,
        COALESCE(SUM(i.qty * COALESCE(s.weight, 0)), 0) as total_kg
      FROM locations_master l
      LEFT JOIN inventory_lpns i ON l.location_id = i.location_id AND i.qty > 0
      LEFT JOIN master_skus s ON i.sku = s.sku
      GROUP BY l.zone_code, l.location_id
      ORDER BY l.zone_code, l.location_id
    `);
    const byZone = result.rows.reduce((acc, row) => {
      if (!acc[row.zone]) acc[row.zone] = { zone: row.zone, locations: [], total_lpns: 0, total_qty: 0, occupied: 0, total: 0 };
      acc[row.zone].locations.push(row);
      acc[row.zone].total_lpns += parseInt(row.lpn_count);
      acc[row.zone].total_qty += parseFloat(row.total_qty);
      acc[row.zone].total++;
      if (parseInt(row.lpn_count) > 0) acc[row.zone].occupied++;
      return acc;
    }, {});
    res.json(Object.values(byZone));
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});

router.get('/report/resources', requireAuth, async (req, res) => {
  const { date_from, date_to, client_id } = req.query;
  if (!date_from || !date_to) return res.status(400).json({ error: 'Se requieren date_from y date_to.' });
  try {
    const params = [date_from, date_to];
    const clientFilter = client_id ? ` AND dh.client_id = $3` : '';
    if (client_id) params.push(client_id);
    const result = await pool.query(`
      SELECT
        dh.id                                     AS doc_id,
        dh.doc_num,
        dh.doc_type,
        dh.client_id,
        dh.created_at::date                       AS dispatch_date,
        dh.glosa,
        item->>'sku'                              AS sku,
        SUM(COALESCE((item->>'qty')::numeric,
            (item->>'qtyToPick')::numeric, 0))    AS dispatched_qty,
        sr.resource_type,
        sr.resource_name,
        sr.unit,
        sr.qty_per_unit,
        sr.hours_per_unit,
        sr.time_unit,
        sr.personnel_count,
        SUM(COALESCE((item->>'qty')::numeric,
            (item->>'qtyToPick')::numeric, 0)
            * sr.qty_per_unit)                    AS total_resource_qty,
        SUM(COALESCE((item->>'qty')::numeric,
            (item->>'qtyToPick')::numeric, 0)
            * sr.hours_per_unit * sr.personnel_count
            * CASE WHEN sr.time_unit = 'MINUTOS'
                   THEN 1.0/60.0 ELSE 1.0 END)   AS total_hours,
        SUM(COALESCE((item->>'qty')::numeric,
            (item->>'qtyToPick')::numeric, 0)
            * sr.hours_per_unit * sr.personnel_count
            * CASE WHEN sr.time_unit = 'HORAS'
                   THEN 60.0 ELSE 1.0 END)        AS total_minutes
      FROM document_history dh,
           json_array_elements(dh.items_json::json) AS item
      JOIN sku_resources sr
        ON sr.sku = (item->>'sku')
       AND sr.client_id = dh.client_id
      WHERE dh.module = 'dispatch'
        AND COALESCE(dh.status, 'ACTIVO') = 'ACTIVO'
        AND dh.created_at::date BETWEEN $1 AND $2
        ${clientFilter}
      GROUP BY dh.id, dh.doc_num, dh.doc_type, dh.client_id, dh.created_at, dh.glosa,
               item->>'sku', sr.resource_type, sr.resource_name, sr.unit,
               sr.qty_per_unit, sr.hours_per_unit, sr.time_unit, sr.personnel_count
      ORDER BY dh.client_id, dh.created_at DESC, dh.doc_num,
               sr.resource_type, sr.resource_name
    `, params);
    res.json(result.rows);
  } catch(e) { res.status(500).json({ error: mapDbError(e) }); }
});

// ── /api/reports ─────────────────────────────────────────────────────────────
router.get('/reports/inventory-aging', requireAuth, async (req, res) => {
  const { client_id } = req.query;
  try {
    let q = `SELECT il.id, il.sku, ms.desc as sku_desc, il.qty, il.client_id, c.name as client_name,
              il.location_id, il.status, il.batch_number, il.expiry_date,
              EXTRACT(DAY FROM NOW()-il.created_at)::int as days_in_wh,
              il.created_at,
              CASE WHEN EXTRACT(DAY FROM NOW()-il.created_at) < 30 THEN 'FRESCO'
                   WHEN EXTRACT(DAY FROM NOW()-il.created_at) < 90 THEN 'NORMAL'
                   WHEN EXTRACT(DAY FROM NOW()-il.created_at) < 180 THEN 'ANTIGUO'
                   ELSE 'CRITICO' END as age_category
             FROM inventory_lpns il
             LEFT JOIN master_skus ms ON ms.sku=il.sku
             LEFT JOIN clients c ON c.id=il.client_id
             WHERE il.qty > 0`;
    const params = [];
    if (client_id) { q += ` AND il.client_id=$${params.length+1}`; params.push(client_id); }
    q += ' ORDER BY days_in_wh DESC LIMIT 1000';
    res.json((await pool.query(q, params)).rows);
  } catch(e){ res.status(500).json({ error: mapDbError(e) }); }
});

router.get('/reports/sku-rotation', requireAuth, async (req, res) => {
  const { client_id } = req.query;
  try {
    let q = `SELECT ms.sku, ms.desc, ms.client_id, ms.abc_class,
              COALESCE(SUM(CASE WHEN al.type IN ('OUTBOUND','ADJUST_OUT') AND al.created_at >= NOW()-INTERVAL '30 days' THEN al.qty ELSE 0 END),0) as dispatched_30d,
              COALESCE(SUM(CASE WHEN al.type IN ('OUTBOUND','ADJUST_OUT') AND al.created_at >= NOW()-INTERVAL '90 days' THEN al.qty ELSE 0 END),0) as dispatched_90d,
              COALESCE(SUM(CASE WHEN al.type='INBOUND' AND al.created_at >= NOW()-INTERVAL '30 days' THEN al.qty ELSE 0 END),0) as received_30d,
              COALESCE((SELECT SUM(qty) FROM inventory_lpns WHERE sku=ms.sku AND qty>0),0) as stock_actual,
              CASE WHEN COALESCE(SUM(CASE WHEN al.type IN ('OUTBOUND','ADJUST_OUT') AND al.created_at >= NOW()-INTERVAL '90 days' THEN al.qty ELSE 0 END),0) = 0 THEN 'SIN_MOVIMIENTO'
                   WHEN COALESCE(SUM(CASE WHEN al.type IN ('OUTBOUND','ADJUST_OUT') AND al.created_at >= NOW()-INTERVAL '30 days' THEN al.qty ELSE 0 END),0) > 0 THEN 'ALTA'
                   ELSE 'MEDIA' END as velocity
             FROM master_skus ms
             LEFT JOIN audit_log al ON al.sku=ms.sku
             WHERE 1=1`;
    const params = [];
    if (client_id) { q += ` AND ms.client_id=$${params.length+1}`; params.push(client_id); }
    q += ' GROUP BY ms.sku, ms.desc, ms.client_id, ms.abc_class ORDER BY dispatched_30d DESC LIMIT 500';
    res.json((await pool.query(q, params)).rows);
  } catch(e){ res.status(500).json({ error: mapDbError(e) }); }
});

router.get('/reports/picker-productivity', requireJefeOrAbove, async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT ptl.assigned_to as picker,
        COUNT(*) FILTER (WHERE ptl.status IN ('COMPLETADA','DIFERENCIA')) as lines_done,
        COUNT(*) FILTER (WHERE ptl.status='DIFERENCIA') as differences,
        COUNT(*) FILTER (WHERE ptl.status='SALTADA') as skipped,
        ROUND(AVG(EXTRACT(EPOCH FROM (ptl.confirmed_at - ptl.started_at))/60)::numeric,1) as avg_min_per_line,
        COUNT(*) FILTER (WHERE ptl.confirmed_at::date = CURRENT_DATE) as done_today
      FROM pick_task_lines ptl
      WHERE ptl.assigned_to IS NOT NULL
      GROUP BY ptl.assigned_to
      ORDER BY lines_done DESC`);
    res.json(r.rows);
  } catch(e){ res.status(500).json({ error: mapDbError(e) }); }
});

router.get('/reports/expiry-alerts', requireAuth, async (req, res) => {
  const { days = 90, client_id } = req.query;
  try {
    let q = `SELECT il.id, il.sku, ms.desc as sku_desc, il.qty, il.client_id, c.name as client_name,
              il.location_id, il.batch_number, il.expiry_date,
              EXTRACT(DAY FROM il.expiry_date - NOW())::int as days_to_expiry
             FROM inventory_lpns il
             LEFT JOIN master_skus ms ON ms.sku=il.sku
             LEFT JOIN clients c ON c.id=il.client_id
             WHERE il.qty>0 AND il.expiry_date IS NOT NULL AND il.expiry_date <= NOW() + ($1 || ' days')::interval`;
    const params = [parseInt(days)||90];
    if (client_id) { q += ` AND il.client_id=$${params.length+1}`; params.push(client_id); }
    q += ' ORDER BY il.expiry_date ASC LIMIT 500';
    res.json((await pool.query(q, params)).rows);
  } catch(e){ res.status(500).json({ error: mapDbError(e) }); }
});

router.get('/reports/zone-occupation', requireAuth, async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT lm.location_id, lm.zone_code,
        COALESCE(COUNT(il.id) FILTER (WHERE il.qty>0),0) as lpn_count,
        COALESCE(SUM(il.qty) FILTER (WHERE il.qty>0),0) as total_units,
        COUNT(DISTINCT il.sku) FILTER (WHERE il.qty>0) as distinct_skus
      FROM locations_master lm
      LEFT JOIN inventory_lpns il ON il.location_id=lm.location_id
      GROUP BY lm.location_id, lm.zone_code
      ORDER BY lm.zone_code ASC, lm.location_id ASC LIMIT 1000`);
    res.json(r.rows);
  } catch(e){ res.status(500).json({ error: mapDbError(e) }); }
});

// ── /api/reports/sku-movement ─────────────────────────────────────────────────
// Devuelve, por cliente+SKU en stock, la última recepción, último despacho,
// días sin movimiento y estado (ACTIVO/LENTO/ESTANCADO/SIN_DATOS).
// El umbral se resuelve: ?stale_days=N > system_config 'report_stale_days' > 90.
router.get('/reports/sku-movement', requireAuth, async (req, res) => {
  const { client_id, stale_days } = req.query;
  try {
    let threshold = parseInt(stale_days) || 0;
    if (!threshold) {
      const cfgRow = await pool.query(
        `SELECT value FROM system_config WHERE key = 'report_stale_days' LIMIT 1`
      );
      threshold = parseInt(cfgRow.rows[0]?.value) || 90;
    }

    const params = [];
    let clientFilter = '';
    if (client_id) {
      params.push(client_id);
      clientFilter = `AND s.client_id = $${params.length}`;
    }
    params.push(threshold);       // $N   o $1 si no hay client_id
    params.push(threshold / 2);   // $N+1

    const threshIdx  = params.length - 1;
    const halfIdx    = params.length;

    const result = await pool.query(`
      WITH last_in AS (
        SELECT sku, MAX(created_at) AS last_inbound
        FROM audit_log WHERE type = 'INBOUND'
        GROUP BY sku
      ),
      last_out AS (
        SELECT sku, MAX(created_at) AS last_outbound
        FROM audit_log WHERE type = 'OUTBOUND'
        GROUP BY sku
      ),
      stock AS (
        SELECT client_id, sku, SUM(qty)::float AS stock_actual
        FROM inventory_lpns WHERE qty > 0
        GROUP BY client_id, sku
      )
      SELECT
        s.client_id,
        c.name                                                          AS client_name,
        s.sku,
        ms."desc"                                                       AS sku_desc,
        s.stock_actual,
        li.last_inbound,
        EXTRACT(DAY FROM NOW() - li.last_inbound)::int                 AS dias_desde_recepcion,
        lo.last_outbound,
        EXTRACT(DAY FROM NOW() - lo.last_outbound)::int                AS dias_desde_despacho,
        EXTRACT(DAY FROM NOW() - COALESCE(
          GREATEST(li.last_inbound, lo.last_outbound),
          (SELECT MIN(il2.created_at) FROM inventory_lpns il2
           WHERE il2.sku = s.sku AND il2.client_id = s.client_id AND il2.qty > 0)
        ))::int                                                         AS dias_sin_movimiento,
        CASE
          WHEN EXTRACT(DAY FROM NOW() - COALESCE(
            GREATEST(li.last_inbound, lo.last_outbound),
            (SELECT MIN(il2.created_at) FROM inventory_lpns il2
             WHERE il2.sku = s.sku AND il2.client_id = s.client_id AND il2.qty > 0)
          )) IS NULL                                    THEN 'SIN_DATOS'
          WHEN EXTRACT(DAY FROM NOW() - COALESCE(
            GREATEST(li.last_inbound, lo.last_outbound),
            (SELECT MIN(il2.created_at) FROM inventory_lpns il2
             WHERE il2.sku = s.sku AND il2.client_id = s.client_id AND il2.qty > 0)
          )) >= $${threshIdx}                           THEN 'ESTANCADO'
          WHEN EXTRACT(DAY FROM NOW() - COALESCE(
            GREATEST(li.last_inbound, lo.last_outbound),
            (SELECT MIN(il2.created_at) FROM inventory_lpns il2
             WHERE il2.sku = s.sku AND il2.client_id = s.client_id AND il2.qty > 0)
          )) >= $${halfIdx}                             THEN 'LENTO'
          ELSE 'ACTIVO'
        END                                                             AS estado,
        $${threshIdx}::int                                             AS umbral_dias
      FROM stock s
      LEFT JOIN master_skus ms  ON ms.sku = s.sku AND ms.client_id = s.client_id
      LEFT JOIN clients     c   ON c.id   = s.client_id
      LEFT JOIN last_in     li  ON li.sku = s.sku
      LEFT JOIN last_out    lo  ON lo.sku = s.sku
      WHERE 1=1 ${clientFilter}
      ORDER BY dias_sin_movimiento DESC NULLS LAST
      LIMIT 1000
    `, params);

    res.json({ threshold, rows: result.rows });
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

// Guarda el umbral por defecto en system_config (JEFE o superior).
// Reutiliza la misma tabla que el resto de la configuración del sistema.
router.put('/reports/sku-movement/config', requireJefeOrAbove, async (req, res) => {
  const days = parseInt(req.body?.stale_days);
  if (!days || days < 1 || days > 3650)
    return res.status(400).json({ error: 'stale_days debe ser un número entre 1 y 3650.' });
  try {
    await pool.query(
      `INSERT INTO system_config (key, value, updated_by, updated_at)
       VALUES ('report_stale_days', $1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_by = $2, updated_at = NOW()`,
      [String(days), req.user?.username || 'SYSTEM']
    );
    res.json({ ok: true, stale_days: days });
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

// ── /api/reports/kardex ───────────────────────────────────────────────────────
// Línea de tiempo de movimientos de un SKU con saldo corriente.
// Fuente: audit_log (INBOUND/OUTBOUND/ADJUST_IN/ADJUST_OUT/RELOCATE).
// El client_id se usa solo para reconciliación de stock y descripción.
router.get('/reports/kardex', requireAuth, async (req, res) => {
  const { sku, client_id, date_from, date_to } = req.query;
  if (!sku) return res.status(400).json({ error: 'El parámetro sku es requerido.' });

  const SIGNO = {
    INBOUND:    +1, ADJUST_IN:  +1,
    OUTBOUND:   -1, ADJUST_OUT: -1,
    RELOCATE:    0,
  };

  try {
    // 1. Saldo inicial (suma de movimientos antes del período)
    let saldo_inicial = 0;
    if (date_from) {
      const siRes = await pool.query(`
        SELECT COALESCE(SUM(
          CASE
            WHEN type IN ('INBOUND','ADJUST_IN')   THEN  qty
            WHEN type IN ('OUTBOUND','ADJUST_OUT') THEN -qty
            ELSE 0
          END
        ), 0) AS saldo_inicial
        FROM audit_log
        WHERE sku = $1 AND created_at < $2
      `, [sku, date_from]);
      saldo_inicial = parseFloat(siRes.rows[0].saldo_inicial) || 0;
    }

    // 2. Movimientos del período
    const params = [sku];
    let dateFilters = '';
    if (date_from) { params.push(date_from);           dateFilters += ` AND created_at >= $${params.length}`; }
    if (date_to)   { params.push(date_to + 'T23:59:59'); dateFilters += ` AND created_at <= $${params.length}`; }

    const movRes = await pool.query(`
      SELECT id, type, qty, glosa, username, created_at
      FROM audit_log
      WHERE sku = $1 ${dateFilters}
      ORDER BY created_at ASC, id ASC
      LIMIT 2001
    `, params);

    const truncado = movRes.rows.length > 2000;
    const rawRows  = truncado ? movRes.rows.slice(0, 2000) : movRes.rows;

    // 3. Saldo corriente (calculado en JS)
    let saldo = saldo_inicial;
    const movimientos = rawRows.map(r => {
      const signo       = SIGNO[r.type] ?? 0;
      const es_reub     = r.type === 'RELOCATE';
      const delta       = parseFloat(r.qty) || 0;
      saldo            += signo * delta;
      return {
        id:            r.id,
        fecha:         r.created_at,
        tipo:          r.type,
        glosa:         r.glosa || '',
        username:      r.username || '',
        entrada:       signo > 0 ? delta : 0,
        salida:        signo < 0 ? delta : 0,
        es_reubicacion: es_reub,
        saldo:         Math.round(saldo * 1000) / 1000,
      };
    });

    // 4. Reconciliación con stock físico actual
    const stockParams = [sku];
    let stockFilter   = '';
    if (client_id) { stockParams.push(client_id); stockFilter = ` AND client_id = $${stockParams.length}`; }
    const stockRes = await pool.query(`
      SELECT COALESCE(SUM(qty), 0)::float AS stock_actual
      FROM inventory_lpns
      WHERE sku = $1 ${stockFilter} AND qty > 0
    `, stockParams);
    const stock_actual = parseFloat(stockRes.rows[0].stock_actual) || 0;
    const saldo_final  = saldo;
    const diferencia   = Math.round((saldo_final - stock_actual) * 1000) / 1000;

    // 5. Descripción del SKU
    const descParams = [sku];
    let descFilter   = '';
    if (client_id) { descParams.push(client_id); descFilter = ` AND client_id = $${descParams.length}`; }
    const descRes = await pool.query(
      `SELECT "desc" FROM master_skus WHERE sku = $1 ${descFilter} LIMIT 1`,
      descParams
    );
    const sku_desc = descRes.rows[0]?.desc || null;

    res.json({
      sku,
      sku_desc,
      client_id: client_id || null,
      saldo_inicial,
      saldo_final,
      stock_actual,
      diferencia,
      truncado,
      movimientos,
    });
  } catch (e) { res.status(500).json({ error: mapDbError(e) }); }
});

module.exports = router;
